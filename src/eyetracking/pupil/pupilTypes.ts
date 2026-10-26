import type { EyeContour } from './eyeGeometry';
// P3 pupil detection — shared result / failure types.
//
// Coordinate conventions (see `coordinates.ts` for the math):
// - Frame space: original decoded-frame pixels, origin top-left, x right,
//   y down. ROI boxes arrive in this space (P2 already maps the 0°/90°/270°
//   rotation fallback back to original coords, so the pupil stage applies no
//   rotation itself).
// - ROI space: pixels relative to the eye-ROI top-left corner.
// - Normalized space: ROI-space position divided by ROI size, normally [0,1].
// - Eye side labels (`left` / `right`) follow the upstream ML Kit landmark
//   identity and are IMAGE-SPACE labels: front-camera mirroring is unresolved,
//   so they are never anatomical claims. Statistics are reported per side.
// - Full floating-point precision is kept internally; rounding is display-only.

export type EyeSide = 'left' | 'right';

export type PupilDetectorId = 'percentile-dark' | 'contrast-normalized';

export type PupilFailureReason =
  | 'NO_FACE'
  | 'NO_EYE_ROI'
  | 'EYE_CLOSED_OR_OCCLUDED'
  | 'NO_PUPIL_CANDIDATE'
  | 'AMBIGUOUS_CANDIDATES'
  | 'LOW_CONFIDENCE'
  | 'NATIVE_RESULT_MISSING'
  | 'INVALID_GEOMETRY';

export type PupilDetectionVerdict =
  'PUPIL_DETECTION_PASS' | 'PUPIL_DETECTION_FAIL' | 'PUPIL_DETECTION_UNKNOWN';

/** Descriptive image/candidate evidence from native pixels; absent in legacy artifacts. */
export interface PupilImageDiagnostics {
  meanY?: number;
  stdY?: number;
  p05Y?: number;
  p95Y?: number;
  gradientRms?: number;
  nearBlackFraction?: number;
  nearWhiteFraction?: number;
  candidateCount?: number;
  darkFraction?: number;
  thresholdY?: number | null;
  bestScore?: number;
  runnerUpScore?: number | null;
  borderTouch?: number;
}

/**
 * Single-frame pupil localization result. On failure every centroid field is
 * null (never fabricated) and `failureReason` is set. On success
 * `failureReason` is null. `confidence` is an engineering signal in [0,1],
 * not a clinical confidence value.
 */
export interface PupilDetectionResult {
  frameIndex: number;
  /** Decoded media PTS (µs), null when the upstream sample had none. */
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  detectorId: PupilDetectorId;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  /** Anatomical search mask; never a pupil position or a motion prediction. */
  eyeContour?: EyeContour | null;
  centroidXInRoi: number | null;
  centroidYInRoi: number | null;
  centroidXInFrame: number | null;
  centroidYInFrame: number | null;
  normalizedX: number | null;
  normalizedY: number | null;
  /** Fitted/selected candidate bounding size in ROI pixels (null on failure). */
  candidateWidth: number | null;
  candidateHeight: number | null;
  confidence: number;
  diagnostics?: PupilImageDiagnostics;
  failureReason: PupilFailureReason | null;
}

/** Upstream eye ROI feeding the pupil stage (frame-space box + identity). */
export interface PupilRoiRequest {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  /** Anatomical search mask; never a pupil position or a motion prediction. */
  eyeContour?: EyeContour | null;
  /** Free-form test-condition label echoed into reports (e.g. `center`). */
  condition: string;
}

export function isPupilSuccess(result: PupilDetectionResult): boolean {
  return result.failureReason === null;
}
