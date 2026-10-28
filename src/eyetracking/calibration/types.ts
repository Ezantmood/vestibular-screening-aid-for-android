import type { EyeContour } from '../pupil/eyeGeometry';
import type { EyeSide } from '../pupil/pupilTypes';

export const CALIBRATION_COORDINATE_VERSION = 'eye-contour-pupil-v11' as const;
export const CALIBRATION_MODEL_VERSION = 'target-cv-ridge-v1' as const;
export const currentPupilMeasurement = (version: unknown): boolean =>
  version === CALIBRATION_COORDINATE_VERSION;

export interface CalibrationContext {
  cameraId: string;
  width: number;
  height: number;
  fps: number;
  /** CW correction of sensor pixels for the portrait-locked capture. */
  faceRotationDegrees?: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportLeft: number;
  viewportTop: number;
  detectorId: 'percentile-dark';
  coordinateVersion: typeof CALIBRATION_COORDINATE_VERSION;
}
export interface CalibrationTarget {
  id: string;
  x: number;
  y: number;
  role: 'fit' | 'validation';
}
export interface EyeObservation {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  x: number | null;
  y: number | null;
  confidence: number;
  /** Eye crop. It follows the eye landmark so the pupil stays inside the image. */
  roi: { x: number; y: number; width: number; height: number };
  /** Head box for the gaze feature. Null means this frame had no face.
   * Omitted means legacy data; it cannot fit or use the current model. */
  face?: { x: number; y: number; width: number; height: number } | null;
  faceRotation?: number | null;
  eyeContour?: EyeContour | null;
  estimated: boolean;
}
/** Target remains committed before recorder start until AFTER finalization.
 * No moving-target PTS/exposure join is inferred from MediaRecorder start. */
export interface CalibrationTake {
  target: CalibrationTarget;
  presentedJsUs: number;
  releasedJsUs: number;
  recordStartNativeUs: number;
  recordEndNativeUs: number;
  bridge: { nativeMinusJsUs: number; roundTripUs: number };
  completed: boolean;
  samples: EyeObservation[];
  filePath: string;
}
/** Why a decoded frame was not kept. Counts are mutually exclusive. */
export interface SampleBlocks {
  noPupil: number;
  lowConfidence: number;
  noFace: number;
  noEyeContour: number;
  outsideFace: number;
  badTime: number;
  estimated: number;
  trimmed: number;
}
export interface TargetQuality {
  targetId: string;
  eyeSide: EyeSide;
  total: number;
  accepted: number;
  coverage: number;
  spanUs: number;
  spread: number | null;
  x: number | null;
  y: number | null;
  rejected: number;
  reasons: string[];
  blocks: SampleBlocks;
  predictionError?: { x: number; y: number; distance: number };
  /** Held-out accepted frames, before filtering or clipping. Descriptive only;
   * adjacent frames are correlated, not independent validation trials. */
  validationFrames?: {
    accepted: number;
    withinTolerance: number;
    withinTolerancePercent: number;
    rmse: number;
    p95Error: number;
  };
}
export type GazeModelFamily = 'affine' | 'affine-ridge' | 'quadratic-ridge';
export interface GazeRegression {
  family: GazeModelFamily;
  lambda: number;
  featureCenter: { x: number; y: number };
  featureScale: { x: number; y: number };
  /** Standardized basis [1,x,y] or [1,x,y,x²,xy,y²]; length is validated. */
  coefficientsX: number[];
  coefficientsY: number[];
}
export interface EyeCalibration extends GazeRegression {
  eyeSide: EyeSide;
  /** Reference face box (historical field name retained for stored artifacts). */
  referenceRoi: EyeObservation['roi'];
  referenceRotation?: number | null;
  featureBounds: { minX: number; maxX: number; minY: number; maxY: number };
  fitRmse: number;
  fitCvRmse: number;
  validationRmse: number;
  validationMaxError: number;
  /** Worst target RMS / p95 over the five held-out frame distributions. */
  validationFrameRmse: number;
  validationFrameP95Error: number;
  validationBias: { x: number; y: number };
  quality: number;
}
export interface CalibrationResult {
  schemaVersion: 1;
  modelVersion: typeof CALIBRATION_MODEL_VERSION;
  id: string;
  createdAtMs: number;
  context: CalibrationContext;
  verdict: 'VALID' | 'RETRY';
  reasons: string[];
  targetQuality: TargetQuality[];
  /** Candidates may be retained after rejection for diagnostics; use mapCalibration. */
  models: Partial<Record<EyeSide, EyeCalibration>>;
  synchronization: 'stationary-target-recording';
  units: 'target-viewport-fraction';
  policy: CalibrationPolicy;
}
export interface CalibrationPolicy {
  settleUs: number;
  minSamples: number;
  minCoverage: number;
  minSpanUs: number;
  minConfidence: number;
  maxSpread: number;
  maxValidationRmse: number;
  maxValidationError: number;
  maxFitRmse: number;
  maxFitCvRmse: number;
  maxValidationFrameRmse: number;
  maxValidationFrameP95Error: number;
  maxAgeMs: number;
}
