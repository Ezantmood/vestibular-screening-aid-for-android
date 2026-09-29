// P2 eye ROI feasibility — isolated interface for face/eye regions.
//
// The decoder (MediaExtractor + MediaCodec in `expo-frame-pipeline`) is the
// stable seam: it hands decoded frames downstream. Face/eye ROI detection is
// one consumer of those frames; pupil centroid tracking (next milestone, e.g.
// OpenCV/custom CV) will be another consumer behind its own interface — it
// must reuse the decoder WITHOUT rewriting video decoding.
//
// ML Kit face/eye landmarks used here are feasibility ROIs only and are NEVER
// pupil tracking.

export interface EyeRoiBox {
  x: number;
  y: number;
  width: number;
  height: number;
  usable: boolean;
  /** True when estimated from face-box proportions (no landmark). */
  estimated: boolean;
}

export interface FaceRoiSample {
  frameIndex: number;
  ptsUs: number | null;
  faceDetected: boolean;
  faceBox: { x: number; y: number; width: number; height: number } | null;
  leftEye: EyeRoiBox | null;
  rightEye: EyeRoiBox | null;
}

/** Later milestone: pupil localization consumes decoded frames via this shape. */
export interface PupilDetectorInput {
  frameIndex: number;
  ptsUs: number | null;
  /** Device-local bitmap/JPEG path from the debug-artifact pass (or memory). */
  framePath: string | null;
  eyeRoi: EyeRoiBox;
}

export type EyeRoiVerdict = 'EYE_ROI_PASS' | 'EYE_ROI_FAIL' | 'EYE_ROI_UNKNOWN';

/** Feasibility bar for P2: at least half the sampled frames usable. */
export const FACE_DETECTION_PASS_RATE = 0.5;
export const BOTH_EYES_PASS_RATE = 0.5;

export function faceDetectionRate(samples: FaceRoiSample[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  const detected = samples.filter((s) => s.faceDetected).length;
  return detected / samples.length;
}

export function bothEyesUsableRate(samples: FaceRoiSample[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  const usable = samples.filter(
    (s) => s.leftEye?.usable === true && s.rightEye?.usable === true,
  ).length;
  return usable / samples.length;
}

export function eyeRoiVerdict(args: {
  faceDetectorStatus: string;
  faceDetectionRate: number | null;
  bothEyesUsableRate: number | null;
}): EyeRoiVerdict {
  if (args.faceDetectorStatus !== 'AVAILABLE') {
    return 'EYE_ROI_UNKNOWN';
  }
  if (args.faceDetectionRate === null || args.bothEyesUsableRate === null) {
    return 'EYE_ROI_UNKNOWN';
  }
  return args.faceDetectionRate >= FACE_DETECTION_PASS_RATE &&
    args.bothEyesUsableRate >= BOTH_EYES_PASS_RATE
    ? 'EYE_ROI_PASS'
    : 'EYE_ROI_FAIL';
}
