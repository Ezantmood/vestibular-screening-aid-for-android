// P3 coordinate semantics — pure mapping between frame / ROI / normalized
// spaces. Every function keeps full floating-point precision; callers round
// only for display.
//
// Spaces:
// - Frame: original decoded-frame pixels (landscape sensor space for
//   high-speed video). ROI boxes from P2 are already mapped back from the
//   0°/90°/270° detection fallback, so the pupil stage works axis-aligned.
// - ROI: pixels relative to the ROI top-left corner.
// - Normalized: ROI position divided by ROI size, normally in [0,1].
//
// Front-camera mirroring is NOT corrected here: `normalizedX` is measured in
// image pixels, so a mirrored sensor flips the x-axis meaning. Side labels
// stay image-space (see `pupilTypes.ts`). Nothing here mixes rotated-image,
// raw-frame, or display coordinates.

import type { EyeSide, PupilDetectorId, PupilDetectionResult } from './pupilTypes';

export interface RoiBox {
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
}

export function isValidRoiBox(box: RoiBox, frameWidth: number, frameHeight: number): boolean {
  if (!Number.isFinite(box.roiWidth) || !Number.isFinite(box.roiHeight)) {
    return false;
  }
  if (box.roiWidth <= 0 || box.roiHeight <= 0) {
    return false;
  }
  if (!Number.isFinite(box.roiX) || !Number.isFinite(box.roiY)) {
    return false;
  }
  if (box.roiX < 0 || box.roiY < 0) {
    return false;
  }
  if (box.roiX + box.roiWidth > frameWidth || box.roiY + box.roiHeight > frameHeight) {
    return false;
  }
  return true;
}

/** ROI-space centroid → frame-space centroid (plain translation). */
export function roiToFrame(
  box: RoiBox,
  centroidXInRoi: number,
  centroidYInRoi: number,
): { x: number; y: number } {
  return { x: box.roiX + centroidXInRoi, y: box.roiY + centroidYInRoi };
}

/** ROI-space centroid → normalized [0,1]-ish position inside the ROI. */
export function normalizeInRoi(
  box: RoiBox,
  centroidXInRoi: number,
  centroidYInRoi: number,
): { x: number; y: number } {
  return { x: centroidXInRoi / box.roiWidth, y: centroidYInRoi / box.roiHeight };
}

/** Frame-space centroid → ROI-space centroid (inverse translation). */
export function frameToRoi(
  box: RoiBox,
  centroidXInFrame: number,
  centroidYInFrame: number,
): { x: number; y: number } {
  return { x: centroidXInFrame - box.roiX, y: centroidYInFrame - box.roiY };
}

export interface SuccessCentroid {
  centroidXInRoi: number;
  centroidYInRoi: number;
  candidateWidth: number;
  candidateHeight: number;
  confidence: number;
}

/** Build a success result with all three coordinate frames filled in. */
export function buildSuccessResult(args: {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  detectorId: PupilDetectorId;
  box: RoiBox;
  centroid: SuccessCentroid;
}): PupilDetectionResult {
  const frame = roiToFrame(args.box, args.centroid.centroidXInRoi, args.centroid.centroidYInRoi);
  const normalized = normalizeInRoi(
    args.box,
    args.centroid.centroidXInRoi,
    args.centroid.centroidYInRoi,
  );
  return {
    frameIndex: args.frameIndex,
    decodedPtsUs: args.decodedPtsUs,
    eyeSide: args.eyeSide,
    detectorId: args.detectorId,
    roiX: args.box.roiX,
    roiY: args.box.roiY,
    roiWidth: args.box.roiWidth,
    roiHeight: args.box.roiHeight,
    centroidXInRoi: args.centroid.centroidXInRoi,
    centroidYInRoi: args.centroid.centroidYInRoi,
    centroidXInFrame: frame.x,
    centroidYInFrame: frame.y,
    normalizedX: normalized.x,
    normalizedY: normalized.y,
    candidateWidth: args.centroid.candidateWidth,
    candidateHeight: args.centroid.candidateHeight,
    confidence: args.centroid.confidence,
    failureReason: null,
  };
}

/**
 * Map a point from a CW-rotated detection candidate back to original (W×H)
 * frame coords. Mirrors the P2 native `mapPointToOriginal` so rotation
 * handling stays testable in pure TS. Only 0/90/270 are valid.
 */
export function mapPointFromRotatedToOriginal(
  x: number,
  y: number,
  rotationDeg: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  if (rotationDeg === 90) {
    return { x: y, y: frameHeight - 1 - x };
  }
  if (rotationDeg === 270) {
    return { x: frameWidth - 1 - y, y: x };
  }
  return { x, y };
}

/**
 * Map an axis-aligned box [l, t, r, b] from a CW-rotated candidate back to
 * original frame coords. Mirrors the P2 native `mapBoxToOriginal`.
 */
export function mapBoxFromRotatedToOriginal(
  left: number,
  top: number,
  right: number,
  bottom: number,
  rotationDeg: number,
  frameWidth: number,
  frameHeight: number,
): { left: number; top: number; right: number; bottom: number } {
  const clampX = (v: number): number => Math.min(Math.max(v, 0), frameWidth);
  const clampY = (v: number): number => Math.min(Math.max(v, 0), frameHeight);
  if (rotationDeg === 90) {
    return {
      left: clampX(top),
      top: clampY(frameHeight - right),
      right: clampX(bottom),
      bottom: clampY(frameHeight - left),
    };
  }
  if (rotationDeg === 270) {
    return {
      left: clampX(frameWidth - bottom),
      top: clampY(left),
      right: clampX(frameWidth - top),
      bottom: clampY(right),
    };
  }
  return { left, top, right, bottom };
}
