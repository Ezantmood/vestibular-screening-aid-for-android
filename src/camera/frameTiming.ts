// P1 frame-timing statistics — pure functions over Camera2 SENSOR_TIMESTAMP data.
// All calculations use nanoseconds internally; display values are milliseconds.

export interface FrameTimingStats {
  /** Number of capture timestamps collected. */
  sampleCount: number;
  /** Observed duration: last − first timestamp, seconds. */
  durationSec: number;
  /** Expected frame interval for the target fps, milliseconds. */
  expectedIntervalMs: number;
  meanIntervalMs: number;
  medianIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  /** Effective observed fps = (n − 1) / duration. */
  observedFps: number;
  /** Interval jitter: population standard deviation, milliseconds. */
  jitterStddevMs: number;
  p95IntervalMs: number;
  /** Intervals longer than 1.5× the expected interval. */
  largeGapCount: number;
  /**
   * ESTIMATE, not proof: sum over intervals of (round(dt / T) − 1) for
   * intervals spanning ≥2 expected periods. A single noisy interval can
   * inflate this; always inspect maxIntervalMs / raw timestamps alongside.
   */
  estimatedMissingFrames: number;
  /** Documents the heuristic so reports stay honest. */
  heuristic: string;
}

const LARGE_GAP_FACTOR = 1.5;

export function droppedFrameHeuristicDescription(targetFps: number): string {
  const expectedMs = 1000 / targetFps;
  return (
    `Estimate only: an interval > ${LARGE_GAP_FACTOR}× the expected ` +
    `${expectedMs.toFixed(4)} ms counts as a large gap; each such interval ` +
    `contributes round(dt/T)−1 estimated missing frames. ` +
    `Noisy intervals can mimic drops — not proof of a dropped frame.`
  );
}

/**
 * Compute timing statistics from raw Camera2 SENSOR_TIMESTAMP values (ns).
 * Throws when fewer than 2 timestamps are available.
 */
export function computeFrameTimingStats(
  timestampsNs: number[],
  targetFps: number,
): FrameTimingStats {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error(`Invalid target fps: ${targetFps}.`);
  }
  if (timestampsNs.length < 2) {
    throw new Error(`Need at least 2 capture timestamps, got ${timestampsNs.length}.`);
  }
  const expectedNs = 1_000_000_000 / targetFps;
  const sorted = [...timestampsNs].sort((a, b) => a - b);
  const intervalsNs: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const dt = sorted[i] - sorted[i - 1];
    if (dt > 0) {
      intervalsNs.push(dt);
    }
  }
  if (intervalsNs.length === 0) {
    throw new Error('Capture timestamps are not strictly increasing.');
  }
  const durationNs = sorted[sorted.length - 1] - sorted[0];
  const sum = intervalsNs.reduce((acc, dt) => acc + dt, 0);
  const meanNs = sum / intervalsNs.length;
  const ordered = [...intervalsNs].sort((a, b) => a - b);
  const medianNs =
    ordered.length % 2 === 1
      ? ordered[(ordered.length - 1) / 2]
      : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
  const variance =
    intervalsNs.reduce((acc, dt) => acc + (dt - meanNs) * (dt - meanNs), 0) / intervalsNs.length;
  const p95Index = Math.min(ordered.length - 1, Math.ceil(0.95 * ordered.length) - 1);
  const largeGapThresholdNs = LARGE_GAP_FACTOR * expectedNs;
  let largeGapCount = 0;
  let estimatedMissingFrames = 0;
  for (const dt of intervalsNs) {
    if (dt > largeGapThresholdNs) {
      largeGapCount += 1;
      estimatedMissingFrames += Math.max(0, Math.round(dt / expectedNs) - 1);
    }
  }
  const toMs = (ns: number): number => ns / 1_000_000;
  return {
    sampleCount: timestampsNs.length,
    durationSec: durationNs / 1_000_000_000,
    expectedIntervalMs: toMs(expectedNs),
    meanIntervalMs: toMs(meanNs),
    medianIntervalMs: toMs(medianNs),
    minIntervalMs: toMs(ordered[0]),
    maxIntervalMs: toMs(ordered[ordered.length - 1]),
    observedFps: (timestampsNs.length - 1) / (durationNs / 1_000_000_000),
    jitterStddevMs: toMs(Math.sqrt(variance)),
    p95IntervalMs: toMs(ordered[p95Index]),
    largeGapCount,
    estimatedMissingFrames,
    heuristic: droppedFrameHeuristicDescription(targetFps),
  };
}

/** Format the copyable technical validation report required by P1. */
export function formatValidationReport(args: {
  deviceModel: string;
  androidRelease: string;
  apiLevel: number;
  cameraId: string;
  lensFacing: string;
  width: number;
  height: number;
  fpsMin: number;
  fpsMax: number;
  sessionState: string;
  stats: FrameTimingStats;
  recordingStatus: string;
  filePath: string | null;
  extractorSampleCount: number | null;
  extractorDurationUs: number | null;
  error: string | null;
}): string {
  const s = args.stats;
  const lines = [
    `Device: ${args.deviceModel}`,
    `Android: ${args.androidRelease} / API ${args.apiLevel}`,
    ``,
    `Camera: ${args.cameraId} ${args.lensFacing}`,
    `Mode: ${args.width}x${args.height}`,
    `Requested range: [${args.fpsMin},${args.fpsMax}]`,
    ``,
    `Session: ${args.sessionState}`,
    `Capture duration: ${s.durationSec.toFixed(2)} s`,
    `Timestamp samples: ${s.sampleCount}`,
    ``,
    `Expected interval: ${s.expectedIntervalMs.toFixed(3)} ms`,
    `Mean interval: ${s.meanIntervalMs.toFixed(3)} ms`,
    `Median interval: ${s.medianIntervalMs.toFixed(3)} ms`,
    `Min interval: ${s.minIntervalMs.toFixed(3)} ms`,
    `Max interval: ${s.maxIntervalMs.toFixed(3)} ms`,
    `P95 interval: ${s.p95IntervalMs.toFixed(3)} ms`,
    `Jitter (stddev): ${s.jitterStddevMs.toFixed(3)} ms`,
    ``,
    `Observed FPS: ${s.observedFps.toFixed(2)}`,
    `Large gaps: ${s.largeGapCount}`,
    `Estimated missing frames: ${s.estimatedMissingFrames}`,
    ``,
    `Recording: ${args.recordingStatus}`,
    `File: ${args.filePath ?? '(none)'}`,
  ];
  if (args.extractorSampleCount !== null || args.extractorDurationUs !== null) {
    lines.push(
      `Encoder cross-check: samples=${args.extractorSampleCount ?? '?'} ` +
        `durationUs=${args.extractorDurationUs ?? '?'}`,
    );
  } else {
    lines.push(`Encoder cross-check: unavailable`);
  }
  if (args.error !== null && args.error !== '') {
    lines.push(`Error: ${args.error}`);
  }
  return lines.join('\n');
}
