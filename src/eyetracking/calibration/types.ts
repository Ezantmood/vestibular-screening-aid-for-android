import type { EyeSide } from '../pupil/pupilTypes';

export const CALIBRATION_COORDINATE_VERSION = 'face-pupil-v5' as const;
export const currentPupilMeasurement = (version: unknown): boolean =>
  version === CALIBRATION_COORDINATE_VERSION;

export interface CalibrationContext {
  cameraId: string;
  width: number;
  height: number;
  fps: number;
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
   * Omitted means a legacy sample whose feature is still ROI-normalized. */
  face?: { x: number; y: number; width: number; height: number } | null;
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
}
export interface EyeCalibration {
  eyeSide: EyeSide;
  /** screen fraction = c0 + c1 * face-normalized x + c2 * face-normalized y */
  coefficientsX: [number, number, number];
  coefficientsY: [number, number, number];
  referenceRoi: EyeObservation['roi'];
  featureBounds: { minX: number; maxX: number; minY: number; maxY: number };
  fitRmse: number;
  validationRmse: number;
  validationMaxError: number;
  validationBias: { x: number; y: number };
  quality: number;
}
export interface CalibrationResult {
  schemaVersion: 1;
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
  maxAgeMs: number;
}
