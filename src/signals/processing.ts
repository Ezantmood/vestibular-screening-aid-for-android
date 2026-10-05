import type {
  ProcessedSignalSample,
  SignalInputSample,
  SignalOptions,
  SignalProcessingResult,
  SignalQuality,
} from './types';

function median(values: number[]): number | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
function distance(a: SignalInputSample, b: SignalInputSample): number {
  return Math.hypot(a.x! - b.x!, a.y! - b.y!);
}
function quality(samples: ProcessedSignalSample[], processed: boolean): SignalQuality {
  const residuals: number[] = [];
  let usable = 0;
  const confidence: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const b = samples[i];
    if (b.usable) {
      usable++;
      confidence.push(b.confidence);
    }
    if (i === 0 || i === samples.length - 1 || !b.usable) continue;
    const a = samples[i - 1];
    const c = samples[i + 1];
    if (!a.usable || !c.usable || a.segmentId !== b.segmentId || b.segmentId !== c.segmentId)
      continue;
    const f =
      (b.raw.decodedPtsUs! - a.raw.decodedPtsUs!) / (c.raw.decodedPtsUs! - a.raw.decodedPtsUs!);
    const x = (s: ProcessedSignalSample) => (processed ? s.processedX! : s.raw.x!);
    const y = (s: ProcessedSignalSample) => (processed ? s.processedY! : s.raw.y!);
    residuals.push(Math.hypot(x(b) - x(a) - f * (x(c) - x(a)), y(b) - y(a) - f * (y(c) - y(a))));
  }
  return {
    total: samples.length,
    usable,
    coverage: samples.length ? usable / samples.length : 0,
    medianConfidence: median(confidence),
    tripletResidualMedian: median(residuals),
    triplets: residuals.length,
  };
}
/** Offline local linear regression on real PTS within a continuous segment.
 * No resampling/gap filling; only observed positions receive filtered values. */
function localFit(neighbors: ProcessedSignalSample[], center: number, axis: 'x' | 'y'): number {
  let weight = 0;
  let sumT = 0;
  let sumTT = 0;
  let sumV = 0;
  let sumTV = 0;
  for (const n of neighbors) {
    const t = (n.raw.decodedPtsUs! - center) / 1_000_000;
    const w = n.raw.confidence;
    const v = n.raw[axis]!;
    weight += w;
    sumT += w * t;
    sumTT += w * t * t;
    sumV += w * v;
    sumTV += w * t * v;
  }
  const determinant = weight * sumTT - sumT * sumT;
  return Math.abs(determinant) < 1e-14
    ? sumV / weight
    : (sumV * sumTT - sumT * sumTV) / determinant;
}
export function processTrajectory(
  input: readonly SignalInputSample[],
  config: Partial<SignalOptions> = {},
): SignalProcessingResult {
  const pixel = config.coordinateSpace === 'frame-px';
  const options: SignalOptions = {
    coordinateSpace: 'eye-roi-normalized',
    minConfidence: 0.35,
    maxGapUs: 50_000,
    halfWindowUs: 16_000,
    outlierDistance: pixel ? 12 : 0.08,
    neighborDistance: pixel ? 3 : 0.02,
    preserveMotionDistance: pixel ? 8 : 0.05,
    ...config,
  };
  if (
    !['frame-px', 'eye-roi-normalized', 'screen-normalized'].includes(options.coordinateSpace) ||
    !Object.values(options)
      .filter((v) => typeof v === 'number')
      .every((v) => Number.isFinite(v) && v > 0) ||
    options.minConfidence > 1 ||
    options.halfWindowUs > options.maxGapUs
  )
    throw new Error('Invalid signal processing configuration.');
  const eyes = new Set(input.map((s) => s.eyeSide).filter((s) => s !== undefined));
  if (eyes.size > 1) throw new Error('Process each eye separately.');
  const raw = input.map((s) => ({ ...s }));
  let highWaterPts = -Infinity;
  let highWaterFrame = -1;
  const samples: ProcessedSignalSample[] = raw.map((s) => {
    const out: ProcessedSignalSample = {
      raw: { ...s },
      processedX: null,
      processedY: null,
      confidence: 0,
      usable: false,
      velocityUsable: false,
      velocityConfidence: 0,
      velocityXPerSecond: null,
      velocityYPerSecond: null,
      speedPerSecond: null,
      velocityDtUs: null,
      segmentId: null,
      reasons: [],
    };
    if (s.decodedPtsUs === null || !Number.isFinite(s.decodedPtsUs) || s.decodedPtsUs < 0)
      out.reasons.push('invalid-timestamp');
    else {
      if (s.decodedPtsUs <= highWaterPts || s.frameIndex <= highWaterFrame)
        out.reasons.push('nonmonotonic-timestamp');
      highWaterPts = Math.max(highWaterPts, s.decodedPtsUs);
    }
    if (!Number.isInteger(s.frameIndex) || s.frameIndex < 0) out.reasons.push('invalid-timestamp');
    if (Number.isInteger(s.frameIndex) && s.frameIndex >= 0)
      highWaterFrame = Math.max(highWaterFrame, s.frameIndex);
    if (s.estimated) out.reasons.push('estimated-timestamp');
    if (s.missingReason) out.reasons.push(s.missingReason);
    if (s.x === null || s.y === null) out.reasons.push('missing');
    else if (![s.x, s.y].every(Number.isFinite)) out.reasons.push('invalid-coordinate');
    else if (s.x < 0 || s.y < 0 || (options.coordinateSpace !== 'frame-px' && (s.x > 1 || s.y > 1)))
      out.reasons.push('invalid-coordinate');
    if (!Number.isFinite(s.confidence) || s.confidence < options.minConfidence || s.confidence > 1)
      out.reasons.push('low-confidence');
    out.usable = out.reasons.length === 0;
    if (out.usable) {
      out.processedX = s.x;
      out.processedY = s.y;
      out.confidence = s.confidence;
      if (s.rescued) out.reasons.push('rescued');
    }
    return out;
  });
  // Reject only weak isolated reversals, never high-confidence/sustained steps.
  const outlierIndices: number[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const c = samples[i + 1];
    if (
      ![a, b, c].every((s) => s.usable) ||
      b.raw.confidence >= 0.65 ||
      c.raw.decodedPtsUs! - a.raw.decodedPtsUs! > options.maxGapUs
    )
      continue;
    if (
      distance(a.raw, c.raw) < options.neighborDistance &&
      distance(a.raw, b.raw) > options.outlierDistance &&
      distance(b.raw, c.raw) > options.outlierDistance
    )
      outlierIndices.push(i);
  }
  let segment = 0;
  let previous: ProcessedSignalSample | null = null;
  const segmentSamples = () => {
    segment = 0;
    previous = null;
    for (const s of samples) {
      if (!s.usable) {
        previous = null;
        s.segmentId = null;
        continue;
      }
      if (
        !previous ||
        s.raw.decodedPtsUs! - previous.raw.decodedPtsUs! > options.maxGapUs ||
        s.raw.frameIndex !== previous.raw.frameIndex + 1
      )
        segment++;
      s.segmentId = segment;
      previous = s;
    }
  };
  segmentSamples();
  const qualityBefore = quality(samples, false);
  for (const i of outlierIndices) {
    const s = samples[i];
    s.usable = false;
    s.processedX = null;
    s.processedY = null;
    s.confidence = 0;
    s.reasons.push('isolated-outlier');
  }
  segmentSamples();
  const segments = segment;
  const qualityRawOnProcessedSupport = quality(samples, false);
  const gaps: SignalProcessingResult['gaps'] = [];
  let i = 0;
  while (i < samples.length) {
    if (samples[i].usable) {
      i++;
      continue;
    }
    const start = i;
    while (i < samples.length && !samples[i].usable) i++;
    const startPtsUs =
      start > 0 ? samples[start - 1].raw.decodedPtsUs : samples[start].raw.decodedPtsUs;
    const endPtsUs =
      i < samples.length ? samples[i].raw.decodedPtsUs : samples[i - 1].raw.decodedPtsUs;
    const durationUs =
      startPtsUs !== null && endPtsUs !== null && endPtsUs > startPtsUs
        ? endPtsUs - startPtsUs
        : null;
    gaps.push({ startPtsUs, endPtsUs, durationUs, missingSamples: i - start, kind: 'missing' });
  }
  for (let n = 1; n < samples.length; n++) {
    const a = samples[n - 1];
    const b = samples[n];
    if (a.usable && b.usable && a.segmentId !== b.segmentId) {
      b.reasons.push('gap-before');
      gaps.push({
        startPtsUs: a.raw.decodedPtsUs,
        endPtsUs: b.raw.decodedPtsUs,
        durationUs: b.raw.decodedPtsUs! - a.raw.decodedPtsUs!,
        missingSamples: 0,
        kind: 'timestamp-gap',
      });
    }
  }
  let smoothed = 0;
  for (let n = 0; n < samples.length; n++) {
    const s = samples[n];
    if (!s.usable) continue;
    const neighbors: ProcessedSignalSample[] = [s];
    for (const direction of [-1, 1]) {
      for (let j = n + direction; j >= 0 && j < samples.length; j += direction) {
        const next = samples[j];
        if (
          !next.usable ||
          next.segmentId !== s.segmentId ||
          Math.abs(next.raw.decodedPtsUs! - s.raw.decodedPtsUs!) > options.halfWindowUs
        )
          break;
        neighbors.push(next);
      }
    }
    if (neighbors.some((v) => distance(v.raw, s.raw) > options.preserveMotionDistance)) {
      s.reasons.push('motion-preserved');
      continue;
    }
    if (neighbors.length >= 3) {
      s.processedX = localFit(neighbors, s.raw.decodedPtsUs!, 'x');
      s.processedY = localFit(neighbors, s.raw.decodedPtsUs!, 'y');
      s.confidence = Math.min(...neighbors.map((v) => v.raw.confidence));
      s.reasons.push('smoothed');
      smoothed++;
    }
  }
  for (let n = 0; n < samples.length; n++) {
    const s = samples[n];
    if (!s.usable) continue;
    const prev = n > 0 ? samples[n - 1] : null;
    if (!prev?.usable || prev.segmentId !== s.segmentId) {
      s.reasons.push('segment-start');
      continue;
    }
    const dt = s.raw.decodedPtsUs! - prev.raw.decodedPtsUs!;
    const vx = ((s.processedX! - prev.processedX!) * 1_000_000) / dt;
    const vy = ((s.processedY! - prev.processedY!) * 1_000_000) / dt;
    const speed = Math.hypot(vx, vy);
    if (![vx, vy, speed].every(Number.isFinite)) continue;
    s.velocityXPerSecond = vx;
    s.velocityYPerSecond = vy;
    s.speedPerSecond = speed;
    s.velocityDtUs = dt;
    s.velocityConfidence = Math.min(s.confidence, prev.confidence);
    s.velocityUsable = true;
  }
  const reasonCounts: SignalProcessingResult['reasonCounts'] = {};
  for (const s of samples)
    for (const reason of s.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  const units =
    options.coordinateSpace === 'frame-px' ? 'decoded-frame-px' : options.coordinateSpace;
  return {
    schemaVersion: 1,
    options,
    units,
    velocityUnits: units + '/s',
    raw,
    samples,
    qualityBefore,
    qualityRawOnProcessedSupport,
    qualityAfter: quality(samples, true),
    segments,
    outliers: outlierIndices.length,
    smoothed,
    velocitySamples: samples.filter((s) => s.velocityUsable).length,
    reasonCounts,
    gaps,
    interpolatedSamples: 0,
  };
}
