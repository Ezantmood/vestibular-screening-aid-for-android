// P4 tracking statistics — P3 raw vs P4 tracked comparison, dropout /
// reacquisition measurement, and the TRACKING_ROBUSTNESS verdict. Pure
// aggregation; no gaze, no degrees, no clinical interpretation.
//
// Engineering feasibility gates for TRACKING_ROBUSTNESS_PASS (NOT clinical
// thresholds; see docs/DECISIONS.md):
// - every tracked-valid result carries a real raw measurement (no fabrication),
// - tracked-valid rate is within 5pp below raw-valid rate (gating must not
//   destroy continuity),
// - at least one reacquisition after a >500 ms dropout was observed overall,
// - timestamp-gap frames never produced a fabricated coordinate,
// - visual overlay audit passed (human flag, not computed).

import type { PupilDetectionResult } from '../pupil/pupilTypes';
import { isPupilSuccess } from '../pupil/pupilTypes';
import { NOMINAL_FRAME_INTERVAL_US } from './pupilTracker';
import type { PupilTrackingResult, TrackingState } from './trackingTypes';

export type TrackingVerdict = 'TRACKING_ROBUSTNESS_PASS' | 'TRACKING_ROBUSTNESS_FAIL';

/** Normalized displacement above this counts as a large centroid jump (stat only). */
export const LARGE_JUMP_NORM = 0.4;
/** PTS delta above this counts as a large timestamp gap (stat only). */
export const LARGE_GAP_FACTOR = 1.5;

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length % 2 === 1
    ? ordered[(ordered.length - 1) / 2]
    : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
}

function percentile(values: number[], q: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(q * ordered.length))];
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((a, v) => a + v, 0) / values.length;
}

export interface TrackingEyeStats {
  eyeSide: 'left' | 'right';
  evaluated: number;
  rawValid: number;
  rawValidRate: number | null;
  trackedValid: number;
  trackedValidRate: number | null;
  rescued: number;
  longestRunSamples: number;
  longestRunUs: number | null;
  dropoutCount: number;
  dropoutMedianUs: number | null;
  dropoutP95Us: number | null;
  dropoutMaxUs: number | null;
  reacquisitions: number;
  reacquisitionMedianUs: number | null;
  reacquisitionP95Us: number | null;
  reacquisitionMaxUs: number | null;
  lowConfidenceCount: number;
  lostCount: number;
  reacquiringCount: number;
  blinkCount: number;
  temporarilyLostCount: number;
  gateRejectedCount: number;
  largeJumpCount: number;
  trackingConfMean: number | null;
  trackingConfMedian: number | null;
  confHistogram: number[];
  largeGapCount: number;
  gapSurvivedCount: number;
}

export interface TrackingConditionStats {
  condition: string;
  evaluated: number;
  rawValidRate: number | null;
  trackedValidRate: number | null;
  dropoutCount: number;
  dropoutMaxUs: number | null;
  reacquisitions: number;
}

export interface TrackingAggregateStats {
  evaluated: number;
  rawValid: number;
  trackedValid: number;
  sides: TrackingEyeStats[];
  conditions: TrackingConditionStats[];
  /** True when every tracked-valid result carries a real raw measurement. */
  noFabricatedPositions: boolean;
  /** True when no tracked-valid result followed a fabricated gap fill. */
  gapsNeverFabricated: boolean;
}

function hasHonestMeasurement(t: PupilTrackingResult): boolean {
  if (t.trackedCentroidX === null && t.trackedCentroidY === null) return true;
  return (
    (t.trackingState === 'TRACKED' || t.trackingState === 'LOW_CONFIDENCE') &&
    t.rawFailure === null &&
    Number.isFinite(t.trackedCentroidX) &&
    Number.isFinite(t.trackedCentroidY) &&
    t.trackedCentroidX === t.rawCentroidX &&
    t.trackedCentroidY === t.rawCentroidY
  );
}

function isTrackedValid(t: PupilTrackingResult): boolean {
  return t.trackedCentroidX !== null && t.trackedCentroidY !== null;
}

interface EyeDetail {
  eyeSide: 'left' | 'right';
  evaluated: number;
  rawValid: number;
  trackedValid: number;
  rescued: number;
  longestRunSamples: number;
  longestRunUs: number | null;
  dropoutDurations: number[];
  reacqLatencies: number[];
  lowConfidenceCount: number;
  lostCount: number;
  reacquiringCount: number;
  blinkCount: number;
  temporarilyLostCount: number;
  gateRejectedCount: number;
  largeJumpCount: number;
  confs: number[];
  largeGapCount: number;
  gapSurvivedCount: number;
}

function eyeDetail(
  eyeSide: 'left' | 'right',
  raw: PupilDetectionResult[],
  tracked: PupilTrackingResult[],
): EyeDetail {
  const rawValid = raw.filter(isPupilSuccess).length;
  const validTracked = tracked.filter(isTrackedValid);
  const rescued = tracked.filter((t) => t.rescued && isTrackedValid(t)).length;

  // Longest continuous valid tracked run (samples + PTS span).
  let longestRunSamples = 0;
  let longestRunUs: number | null = null;
  let runStart = 0;
  let inRun = false;
  for (let i = 0; i < tracked.length; i++) {
    if (isTrackedValid(tracked[i])) {
      if (!inRun) {
        inRun = true;
        runStart = i;
      }
    } else if (inRun) {
      inRun = false;
      const len = i - runStart;
      if (len > longestRunSamples) {
        longestRunSamples = len;
        const a = tracked[runStart].decodedPtsUs;
        const b = tracked[i - 1].decodedPtsUs;
        longestRunUs = a !== null && b !== null ? Math.max(0, b - a) : null;
      }
    }
  }
  if (inRun) {
    const len = tracked.length - runStart;
    if (len > longestRunSamples) {
      longestRunSamples = len;
      const a = tracked[runStart].decodedPtsUs;
      const b = tracked[tracked.length - 1].decodedPtsUs;
      longestRunUs = a !== null && b !== null ? Math.max(0, b - a) : null;
    }
  }

  // Dropouts: maximal missing spans bracketed by valid tracked fixes.
  // Duration = PTS gap from the last valid fix to the reacquiring fix
  // (authoritative PTS; nominal-interval fallback when either PTS is null).
  const dropoutDurations: number[] = [];
  const reacqLatencies: number[] = [];
  let missingStart: PupilTrackingResult | null = null;
  let lastValidBefore: PupilTrackingResult | null = null;
  let seenValid = false;
  for (const t of tracked) {
    if (isTrackedValid(t)) {
      if (missingStart !== null && seenValid && lastValidBefore !== null) {
        const a = lastValidBefore.decodedPtsUs;
        const b = t.decodedPtsUs;
        let gapUs: number;
        if (a !== null && b !== null) {
          gapUs = Math.max(0, b - a);
        } else {
          const frames = t.frameIndex - lastValidBefore.frameIndex;
          gapUs = Math.max(0, Math.round(frames * NOMINAL_FRAME_INTERVAL_US));
        }
        dropoutDurations.push(gapUs);
        reacqLatencies.push(gapUs);
      }
      seenValid = true;
      lastValidBefore = t;
      missingStart = null;
    } else if (missingStart === null) {
      missingStart = t;
    }
  }

  const countState = (s: TrackingState): number =>
    tracked.filter((t) => t.trackingState === s).length;

  // Large centroid jumps between consecutive valid TRACKED fixes (normalized).
  let largeJumpCount = 0;
  let prevValid: PupilTrackingResult | null = null;
  const rawByFrame = new Map<number, PupilDetectionResult>();
  for (const r of raw) {
    rawByFrame.set(r.frameIndex, r);
  }
  for (const t of validTracked) {
    if (prevValid !== null) {
      const r = rawByFrame.get(t.frameIndex);
      const rp = rawByFrame.get(prevValid.frameIndex);
      if (
        r?.normalizedX != null &&
        r?.normalizedY != null &&
        rp?.normalizedX != null &&
        rp?.normalizedY != null
      ) {
        const d = Math.hypot(r.normalizedX - rp.normalizedX, r.normalizedY - rp.normalizedY);
        if (d > LARGE_JUMP_NORM) {
          largeJumpCount += 1;
        }
      }
    }
    prevValid = t;
  }
  // Timestamp gaps: PTS deltas > 1.5x the RUN's own median inter-sample
  // delta (adapts to sparse offline sampling; the 8.333 ms nominal is only
  // the fallback when no measurable median exists). Survived = neither side
  // of the gap carries a fabricated coordinate. Gate-rejected frames are
  // explicit rejections (flagged), never fabrication.
  let largeGapCount = 0;
  let gapSurvivedCount = 0;
  const deltas: number[] = [];
  for (let i = 1; i < tracked.length; i++) {
    const a = tracked[i - 1].decodedPtsUs;
    const b = tracked[i].decodedPtsUs;
    if (a !== null && b !== null && b > a) {
      deltas.push(b - a);
    }
  }
  const medianDelta = median(deltas) ?? NOMINAL_FRAME_INTERVAL_US;
  for (let i = 1; i < tracked.length; i++) {
    const a = tracked[i - 1].decodedPtsUs;
    const b = tracked[i].decodedPtsUs;
    if (a === null || b === null) {
      continue;
    }
    if (b - a > LARGE_GAP_FACTOR * medianDelta) {
      largeGapCount += 1;
      const fabricated =
        (!tracked[i - 1].gateRejected &&
          tracked[i - 1].trackedCentroidX !== null &&
          tracked[i - 1].rawCentroidX === null) ||
        (!tracked[i].gateRejected &&
          tracked[i].trackedCentroidX !== null &&
          tracked[i].rawCentroidX === null);
      if (!fabricated) {
        gapSurvivedCount += 1;
      }
    }
  }

  const confs = tracked.map((t) => t.trackingConfidence);

  return {
    eyeSide,
    evaluated: tracked.length,
    rawValid,
    trackedValid: validTracked.length,
    rescued,
    longestRunSamples,
    longestRunUs,
    dropoutDurations,
    reacqLatencies,
    lowConfidenceCount: countState('LOW_CONFIDENCE'),
    lostCount: countState('LOST'),
    reacquiringCount: countState('REACQUIRING'),
    blinkCount: countState('BLINK_OR_OCCLUDED'),
    temporarilyLostCount: countState('TEMPORARILY_LOST'),
    gateRejectedCount: tracked.filter((t) => t.gateRejected).length,
    largeJumpCount,
    confs,
    largeGapCount,
    gapSurvivedCount,
  };
}

function summarizeEyeDetail(d: EyeDetail): TrackingEyeStats {
  const confHistogram = [0, 0, 0, 0, 0];
  for (const c of d.confs) {
    confHistogram[Math.min(4, Math.floor(Math.max(0, Math.min(1, c)) * 5))] += 1;
  }
  return {
    eyeSide: d.eyeSide,
    evaluated: d.evaluated,
    rawValid: d.rawValid,
    rawValidRate: d.evaluated > 0 ? d.rawValid / d.evaluated : null,
    trackedValid: d.trackedValid,
    trackedValidRate: d.evaluated > 0 ? d.trackedValid / d.evaluated : null,
    rescued: d.rescued,
    longestRunSamples: d.longestRunSamples,
    longestRunUs: d.longestRunUs,
    dropoutCount: d.dropoutDurations.length,
    dropoutMedianUs: median(d.dropoutDurations),
    dropoutP95Us: percentile(d.dropoutDurations, 0.95),
    dropoutMaxUs: d.dropoutDurations.length > 0 ? Math.max(...d.dropoutDurations) : null,
    reacquisitions: d.reacqLatencies.length,
    reacquisitionMedianUs: median(d.reacqLatencies),
    reacquisitionP95Us: percentile(d.reacqLatencies, 0.95),
    reacquisitionMaxUs: d.reacqLatencies.length > 0 ? Math.max(...d.reacqLatencies) : null,
    lowConfidenceCount: d.lowConfidenceCount,
    lostCount: d.lostCount,
    reacquiringCount: d.reacquiringCount,
    blinkCount: d.blinkCount,
    temporarilyLostCount: d.temporarilyLostCount,
    gateRejectedCount: d.gateRejectedCount,
    largeJumpCount: d.largeJumpCount,
    trackingConfMean: mean(d.confs),
    trackingConfMedian: median(d.confs),
    confHistogram,
    largeGapCount: d.largeGapCount,
    gapSurvivedCount: d.gapSurvivedCount,
  };
}

/**
 * Pool per-run per-eye details. Run boundaries are never crossed: dropouts
 * and runs are computed within each clip, then pooled (counts sum,
 * durations/latencies/confidences concatenate, longest run takes the max).
 */
function poolEyeDetails(eyeSide: 'left' | 'right', details: EyeDetail[]): EyeDetail {
  let bestSamples = 0;
  let bestUs: number | null = null;
  for (const d of details) {
    if (d.longestRunSamples > bestSamples) {
      bestSamples = d.longestRunSamples;
      bestUs = d.longestRunUs;
    } else if (d.longestRunSamples === bestSamples && d.longestRunUs !== null) {
      bestUs = bestUs === null ? d.longestRunUs : Math.max(bestUs, d.longestRunUs);
    }
  }
  const sum = (f: (d: EyeDetail) => number): number => details.reduce((a, d) => a + f(d), 0);
  const cat = <T>(f: (d: EyeDetail) => T[]): T[] => details.flatMap(f);
  return {
    eyeSide,
    evaluated: sum((d) => d.evaluated),
    rawValid: sum((d) => d.rawValid),
    trackedValid: sum((d) => d.trackedValid),
    rescued: sum((d) => d.rescued),
    longestRunSamples: bestSamples,
    longestRunUs: bestUs,
    dropoutDurations: cat((d) => d.dropoutDurations),
    reacqLatencies: cat((d) => d.reacqLatencies),
    lowConfidenceCount: sum((d) => d.lowConfidenceCount),
    lostCount: sum((d) => d.lostCount),
    reacquiringCount: sum((d) => d.reacquiringCount),
    blinkCount: sum((d) => d.blinkCount),
    temporarilyLostCount: sum((d) => d.temporarilyLostCount),
    gateRejectedCount: sum((d) => d.gateRejectedCount),
    largeJumpCount: sum((d) => d.largeJumpCount),
    confs: cat((d) => d.confs),
    largeGapCount: sum((d) => d.largeGapCount),
    gapSurvivedCount: sum((d) => d.gapSurvivedCount),
  };
}

function eyeStats(
  eyeSide: 'left' | 'right',
  raw: PupilDetectionResult[],
  tracked: PupilTrackingResult[],
): TrackingEyeStats {
  return summarizeEyeDetail(eyeDetail(eyeSide, raw, tracked));
}

export function aggregateTrackingStats(args: {
  raw: PupilDetectionResult[];
  tracked: PupilTrackingResult[];
  conditionsByKey?: Map<string, string>;
}): TrackingAggregateStats {
  const { raw, tracked } = args;
  const noFabricatedPositions = tracked.every(hasHonestMeasurement);
  const gapsNeverFabricated = noFabricatedPositions;
  const sides: TrackingEyeStats[] = (['left', 'right'] as const).map((side) =>
    eyeStats(
      side,
      raw.filter((r) => r.eyeSide === side),
      tracked.filter((t) => t.eyeSide === side),
    ),
  );
  const byCondition = new Map<
    string,
    { raw: PupilDetectionResult[]; tracked: PupilTrackingResult[] }
  >();
  const keyOf = (frameIndex: number, eyeSide: string): string =>
    args.conditionsByKey?.get(`${frameIndex}:${eyeSide}`) ?? 'unspecified';
  for (const r of raw) {
    const k = keyOf(r.frameIndex, r.eyeSide);
    const e = byCondition.get(k) ?? { raw: [], tracked: [] };
    e.raw.push(r);
    byCondition.set(k, e);
  }
  for (const t of tracked) {
    const k = keyOf(t.frameIndex, t.eyeSide);
    const e = byCondition.get(k) ?? { raw: [], tracked: [] };
    e.tracked.push(t);
    byCondition.set(k, e);
  }
  const conditions: TrackingConditionStats[] = [...byCondition.entries()].map(([condition, e]) => {
    const s = eyeStats('left', e.raw, e.tracked);
    const rawRate = e.raw.length > 0 ? e.raw.filter(isPupilSuccess).length / e.raw.length : null;
    const trackedRate =
      e.tracked.length > 0 ? e.tracked.filter(isTrackedValid).length / e.tracked.length : null;
    return {
      condition,
      evaluated: e.tracked.length,
      rawValidRate: rawRate,
      trackedValidRate: trackedRate,
      dropoutCount: s.dropoutCount,
      dropoutMaxUs: s.dropoutMaxUs,
      reacquisitions: s.reacquisitions,
    };
  });
  return {
    evaluated: tracked.length,
    rawValid: raw.filter(isPupilSuccess).length,
    trackedValid: tracked.filter(isTrackedValid).length,
    sides,
    conditions,
    noFabricatedPositions,
    gapsNeverFabricated,
  };
}

export interface TrackingRunInput {
  condition: string;
  raw: PupilDetectionResult[];
  tracked: PupilTrackingResult[];
}

/**
 * Aggregate several independent clips (e.g. one per test condition).
 * Details are computed per run per eye and pooled, so run boundaries are
 * never crossed by dropout/run/gap scans and frame indices may repeat
 * across clips. Per-condition rows are both-eyes summaries of their clip.
 */
export function aggregateTrackingStatsForRuns(runs: TrackingRunInput[]): TrackingAggregateStats {
  const allTracked = runs.flatMap((r) => r.tracked);
  const allRaw = runs.flatMap((r) => r.raw);
  const noFabricatedPositions = allTracked.every(hasHonestMeasurement);
  const gapsNeverFabricated = noFabricatedPositions;
  const sides: TrackingEyeStats[] = (['left', 'right'] as const).map((side) =>
    summarizeEyeDetail(
      poolEyeDetails(
        side,
        runs.map((run) =>
          eyeDetail(
            side,
            run.raw.filter((r) => r.eyeSide === side),
            run.tracked.filter((t) => t.eyeSide === side),
          ),
        ),
      ),
    ),
  );
  const conditions: TrackingConditionStats[] = runs.map((run) => {
    const left = eyeDetail(
      'left',
      run.raw.filter((r) => r.eyeSide === 'left'),
      run.tracked.filter((t) => t.eyeSide === 'left'),
    );
    const right = eyeDetail(
      'right',
      run.raw.filter((r) => r.eyeSide === 'right'),
      run.tracked.filter((t) => t.eyeSide === 'right'),
    );
    const rawOk = run.raw.filter(isPupilSuccess).length;
    const trackedOk = run.tracked.filter(isTrackedValid).length;
    const drops = [...left.dropoutDurations, ...right.dropoutDurations];
    const reacqs = left.reacqLatencies.length + right.reacqLatencies.length;
    return {
      condition: run.condition,
      evaluated: run.tracked.length,
      rawValidRate: run.raw.length > 0 ? rawOk / run.raw.length : null,
      trackedValidRate: run.tracked.length > 0 ? trackedOk / run.tracked.length : null,
      dropoutCount: drops.length,
      dropoutMaxUs: drops.length > 0 ? Math.max(...drops) : null,
      reacquisitions: reacqs,
    };
  });
  return {
    evaluated: allTracked.length,
    rawValid: allRaw.filter(isPupilSuccess).length,
    trackedValid: allTracked.filter(isTrackedValid).length,
    sides,
    conditions,
    noFabricatedPositions,
    gapsNeverFabricated,
  };
}

export function trackingRobustnessVerdict(args: {
  stats: TrackingAggregateStats;
  visualAuditPassed: boolean;
}): TrackingVerdict {
  const { stats } = args;
  if (stats.evaluated === 0) {
    return 'TRACKING_ROBUSTNESS_FAIL';
  }
  if (!stats.noFabricatedPositions || !stats.gapsNeverFabricated) {
    return 'TRACKING_ROBUSTNESS_FAIL';
  }
  const overallRaw = stats.evaluated > 0 ? stats.rawValid / stats.evaluated : 0;
  const overallTracked = stats.evaluated > 0 ? stats.trackedValid / stats.evaluated : 0;
  if (overallTracked < overallRaw - 0.05) {
    return 'TRACKING_ROBUSTNESS_FAIL';
  }
  const anyReacquisition = stats.sides.some((s) => s.reacquisitions > 0);
  if (!anyReacquisition) {
    return 'TRACKING_ROBUSTNESS_FAIL';
  }
  const gapsOk = stats.sides.every((s) => s.gapSurvivedCount >= s.largeGapCount);
  if (!gapsOk) {
    return 'TRACKING_ROBUSTNESS_FAIL';
  }
  return args.visualAuditPassed ? 'TRACKING_ROBUSTNESS_PASS' : 'TRACKING_ROBUSTNESS_FAIL';
}

function pct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '?' : `${(v * 100).toFixed(1)}%`;
}
function num(v: number | null, digits = 0): string {
  return v === null || !Number.isFinite(v) ? '?' : v.toFixed(digits);
}
function ms(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '?' : `${(v / 1000).toFixed(1)}ms`;
}

/** Copyable P4 technical report: P3 raw vs P4 tracked, per side + condition. */
export function formatTrackingReport(args: {
  stats: TrackingAggregateStats;
  verdict: TrackingVerdict;
  captureLabel: string;
}): string {
  const { stats, verdict } = args;
  const lines = [
    `P4 tracking continuity — ${args.captureLabel}`,
    ``,
    `Evaluated eye slots: ${stats.evaluated}`,
    `Raw P3 valid: ${stats.rawValid} (${pct(stats.evaluated > 0 ? stats.rawValid / stats.evaluated : null)})`,
    `Tracked P4 valid: ${stats.trackedValid} (${pct(stats.evaluated > 0 ? stats.trackedValid / stats.evaluated : null)})`,
    `No fabricated positions: ${stats.noFabricatedPositions ? 'yes' : 'NO — FAIL'}`,
    `Gaps never fabricated: ${stats.gapsNeverFabricated ? 'yes' : 'NO — FAIL'}`,
    ``,
  ];
  for (const s of stats.sides) {
    lines.push(
      `${s.eyeSide} eye: n=${s.evaluated} raw=${pct(s.rawValidRate)} tracked=${pct(s.trackedValidRate)} rescued=${s.rescued}`,
      `  longest run: ${s.longestRunSamples} samples (${ms(s.longestRunUs)})`,
      `  dropouts: ${s.dropoutCount} dur(med/p95/max)=${ms(s.dropoutMedianUs)}/${ms(s.dropoutP95Us)}/${ms(s.dropoutMaxUs)}`,
      `  reacquisitions: ${s.reacquisitions} lat(med/p95/max)=${ms(s.reacquisitionMedianUs)}/${ms(s.reacquisitionP95Us)}/${ms(s.reacquisitionMaxUs)}`,
      `  states: LOW_CONF=${s.lowConfidenceCount} TEMP_LOST=${s.temporarilyLostCount} BLINK=${s.blinkCount} REACQ=${s.reacquiringCount} LOST=${s.lostCount} gateRejected=${s.gateRejectedCount}`,
      `  large jumps: ${s.largeJumpCount} trackConf(mean/med)=${num(s.trackingConfMean, 2)}/${num(s.trackingConfMedian, 2)} hist[0-0.2..0.8-1]=${s.confHistogram.join('/')}`,
      `  timestamp gaps: large=${s.largeGapCount} survived=${s.gapSurvivedCount}`,
    );
  }
  if (stats.conditions.length > 0) {
    lines.push(``);
    for (const c of stats.conditions) {
      lines.push(
        `condition ${c.condition}: n=${c.evaluated} raw=${pct(c.rawValidRate)} tracked=${pct(c.trackedValidRate)} dropouts=${c.dropoutCount} maxDrop=${ms(c.dropoutMaxUs)} reacq=${c.reacquisitions}`,
      );
    }
  }
  lines.push(``, `Verdict:`, `${verdict}`);
  return lines.join('\n');
}
