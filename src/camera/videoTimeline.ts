// P2 video timeline — pure functions over ENCODED/MEDIA presentation timestamps.
// Units stay in microseconds internally; callers convert to ms only for display.
// These PTS values come from MediaExtractor/MediaCodec and are NEVER claimed to
// be sensor exposure timestamps.

export interface VideoTimelineStats {
  /** Number of PTS values (decoded frames or encoded samples). */
  sampleCount: number;
  /** Last − first PTS, microseconds (null when <2 samples). */
  durationUs: number | null;
  /** Last − first PTS, seconds. */
  durationSec: number | null;
  meanIntervalUs: number | null;
  medianIntervalUs: number | null;
  minIntervalUs: number | null;
  maxIntervalUs: number | null;
  p95IntervalUs: number | null;
  /** (n − 1) / duration — the effective media rate. */
  effectiveFps: number | null;
  /** Intervals with dt <= 0 in file/decode order. */
  nonMonotonicCount: number;
  /** Intervals with dt == 0. */
  duplicatePtsCount: number;
  /** Positive intervals longer than 1.5× the nominal interval. */
  largeGapCount: number;
  largeGapThresholdUs: number;
}

const LARGE_GAP_FACTOR = 1.5;

/**
 * Compute timeline statistics in decode/file order (order matters: shuffling
 * would hide non-monotonic timestamps). Throws when fewer than 1 sample or
 * when nominal fps is invalid. Returns nulls (never invented values) when
 * fewer than 2 samples or no positive interval exists.
 */
export function computeVideoTimelineStats(ptsUs: number[], nominalFps: number): VideoTimelineStats {
  if (!Number.isFinite(nominalFps) || nominalFps <= 0) {
    throw new Error(`Invalid nominal fps: ${nominalFps}.`);
  }
  const thresholdUs = (1_000_000 / nominalFps) * LARGE_GAP_FACTOR;
  if (ptsUs.length === 0) {
    throw new Error('Need at least 1 presentation timestamp.');
  }
  if (ptsUs.length === 1) {
    return {
      sampleCount: 1,
      durationUs: null,
      durationSec: null,
      meanIntervalUs: null,
      medianIntervalUs: null,
      minIntervalUs: null,
      maxIntervalUs: null,
      p95IntervalUs: null,
      effectiveFps: null,
      nonMonotonicCount: 0,
      duplicatePtsCount: 0,
      largeGapCount: 0,
      largeGapThresholdUs: thresholdUs,
    };
  }
  let nonMonotonicCount = 0;
  let duplicatePtsCount = 0;
  let largeGapCount = 0;
  const deltas: number[] = [];
  for (let i = 1; i < ptsUs.length; i += 1) {
    const dt = ptsUs[i] - ptsUs[i - 1];
    if (dt <= 0) {
      nonMonotonicCount += 1;
      if (dt === 0) {
        duplicatePtsCount += 1;
      }
      continue;
    }
    deltas.push(dt);
    if (dt > thresholdUs) {
      largeGapCount += 1;
    }
  }
  const durationUs = ptsUs[ptsUs.length - 1] - ptsUs[0];
  const durationSec = durationUs > 0 ? durationUs / 1_000_000 : null;
  if (deltas.length === 0) {
    return {
      sampleCount: ptsUs.length,
      durationUs,
      durationSec,
      meanIntervalUs: null,
      medianIntervalUs: null,
      minIntervalUs: null,
      maxIntervalUs: null,
      p95IntervalUs: null,
      effectiveFps: null,
      nonMonotonicCount,
      duplicatePtsCount,
      largeGapCount,
      largeGapThresholdUs: thresholdUs,
    };
  }
  const ordered = [...deltas].sort((a, b) => a - b);
  const mean = deltas.reduce((acc, dt) => acc + dt, 0) / deltas.length;
  const median =
    ordered.length % 2 === 1
      ? ordered[(ordered.length - 1) / 2]
      : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
  const p95Index = Math.min(ordered.length - 1, Math.ceil(0.95 * ordered.length) - 1);
  return {
    sampleCount: ptsUs.length,
    durationUs,
    durationSec,
    meanIntervalUs: mean,
    medianIntervalUs: median,
    minIntervalUs: ordered[0],
    maxIntervalUs: ordered[ordered.length - 1],
    p95IntervalUs: ordered[p95Index],
    effectiveFps: durationUs > 0 ? (ptsUs.length - 1) / (durationUs / 1_000_000) : null,
    nonMonotonicCount,
    duplicatePtsCount,
    largeGapCount,
    largeGapThresholdUs: thresholdUs,
  };
}
