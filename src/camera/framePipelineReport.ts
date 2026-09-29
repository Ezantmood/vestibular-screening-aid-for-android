// P2 debug report — copyable technical text with TWO separate verdicts:
// FRAME_PIPELINE_* (decode + media timeline + duplicate check) and
// EYE_ROI_* (face/eye feasibility). Never one vague PASS.

import type { FramePipelineReport } from './framePipeline';
import { eyeRoiVerdict } from '../eyetracking/faceRoi';

export type FramePipelineVerdict = 'FRAME_PIPELINE_PASS' | 'FRAME_PIPELINE_FAIL';

/**
 * Frame-pipeline bar (documented, all must hold):
 * - decoded frames ≥ 90% of nominal (duration × expected fps)
 * - effective decoded FPS within ±10% of nominal
 * - zero non-monotonic decoded PTS
 * - large-gap rate ≤ 2% of decoded intervals
 * - near-duplicate candidate rate ≤ 5% of valid MAD comparisons
 */
export function framePipelineVerdict(
  report: FramePipelineReport,
  expectedFps: number,
): FramePipelineVerdict {
  const durationUs = report.decodedDurationUs ?? report.encodedDurationUs ?? null;
  const nominalFrames =
    durationUs !== null && durationUs > 0
      ? Math.round((durationUs / 1_000_000) * expectedFps)
      : null;
  const frameCountOk =
    nominalFrames !== null ? report.decodedFrameCount >= 0.9 * nominalFrames : false;
  const fpsOk =
    report.effectiveFps !== null &&
    Math.abs(report.effectiveFps - expectedFps) <= 0.1 * expectedFps;
  const intervals = Math.max(0, report.decodedFrameCount - 1);
  const gapRate = intervals > 0 ? report.largeGapCount / intervals : 1;
  const gapsOk = intervals > 0 && gapRate <= 0.02;
  const dupOk = report.nearDuplicatePct <= 5;
  const monotonicOk = report.nonMonotonicPtsCount === 0;
  return frameCountOk && fpsOk && gapsOk && dupOk && monotonicOk
    ? 'FRAME_PIPELINE_PASS'
    : 'FRAME_PIPELINE_FAIL';
}

function ms(us: number | null): string {
  return us === null || !Number.isFinite(us) ? '?' : (us / 1000).toFixed(3);
}

function fps(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '?' : value.toFixed(2);
}

function sec(us: number | null): string {
  return us === null || !Number.isFinite(us) ? '?' : (us / 1_000_000).toFixed(3);
}

function pct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '?' : `${(value * 100).toFixed(1)}%`;
}

/** Format the copyable P2 technical report required by the milestone. */
export function formatFramePipelineReport(args: {
  deviceModel: string;
  androidRelease: string;
  apiLevel: number;
  cameraLabel: string;
  captureLabel: string;
  expectedFps: number;
  report: FramePipelineReport;
}): string {
  const { report, expectedFps } = args;
  const expectedMs = (1000 / expectedFps).toFixed(3);
  const frameVerdict = framePipelineVerdict(report, expectedFps);
  const roiVerdict = eyeRoiVerdict({
    faceDetectorStatus: report.faceDetectorStatus,
    faceDetectionRate: report.faceDetectionRate,
    bothEyesUsableRate: report.bothEyesUsableRate,
  });
  const eyeSamples = report.faceSamples.filter(
    (s) => s.leftEye?.usable === true && s.rightEye?.usable === true,
  );
  const eyeSizes = eyeSamples
    .flatMap((s) => [s.leftEye, s.rightEye])
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .map((b) => `${b.width}x${b.height}`);
  const eyeSizeText = eyeSizes.length > 0 ? eyeSizes.slice(0, 6).join(', ') : '(none)';
  const lines = [
    `Device: ${args.deviceModel}`,
    `Camera: ${args.cameraLabel}`,
    `Capture: ${args.captureLabel}`,
    ``,
    `Encoded samples: ${report.encodedSampleCount}`,
    `Decoded frames: ${report.decodedFrameCount}`,
    ``,
    `Media timeline: ${sec(report.decodedDurationUs)} s (encoded/media PTS, not sensor exposure)`,
    `Effective decoded FPS: ${fps(report.effectiveFps)}`,
    ``,
    `Expected interval: ${expectedMs} ms`,
    `Mean PTS delta: ${ms(report.meanIntervalUs)} ms`,
    `Median PTS delta: ${ms(report.medianIntervalUs)} ms`,
    `P95 PTS delta: ${ms(report.p95IntervalUs)} ms`,
    `Max PTS delta: ${ms(report.maxIntervalUs)} ms`,
    ``,
    `Non-monotonic PTS: ${report.nonMonotonicPtsCount}`,
    `Duplicate PTS: ${report.duplicatePtsCount}`,
    `Large gaps: ${report.largeGapCount}`,
    ``,
    `Near-duplicate candidates: ${report.nearDuplicateCount} (MAD <= ${report.nearDuplicateThresholdMad}, candidate only — low motion is not proof of freeze)`,
    `Duplicate percentage: ${report.nearDuplicatePct.toFixed(2)}%`,
    `Longest duplicate run: ${report.longestDuplicateRun}`,
    ``,
    `Face detection rate: ${pct(report.faceDetectionRate)} (${report.faceDetectorStatus})`,
    `Left eye ROI usable: ${pct(roiRate(report, 'leftEye'))}`,
    `Right eye ROI usable: ${pct(roiRate(report, 'rightEye'))}`,
    `Eye ROI sizes (px): ${eyeSizeText}`,
    ``,
    `Verdict:`,
    `${frameVerdict}`,
    `${roiVerdict}`,
  ];
  if (report.warnings.length > 0) {
    lines.push('', `Warnings: ${report.warnings.slice(0, 5).join(' | ')}`);
  }
  if (report.error !== null && report.error !== '') {
    lines.push(`Error: ${report.error}`);
  }
  return lines.join('\n');
}

function roiRate(report: FramePipelineReport, side: 'leftEye' | 'rightEye'): number | null {
  if (report.faceSamples.length === 0) {
    return null;
  }
  const usable = report.faceSamples.filter((s) => s[side]?.usable === true).length;
  return usable / report.faceSamples.length;
}
