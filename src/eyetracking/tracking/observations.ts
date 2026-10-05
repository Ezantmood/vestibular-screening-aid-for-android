import type { PupilDetectionResult } from '../pupil/pupilTypes';
import type { EyeObservation } from '../calibration/types';
import type { PupilTrackingResult } from './trackingTypes';

/** Normalize accepted observations against each frame's ROI. Never use predictions. */
export function trackingObservations(
  raw: readonly PupilDetectionResult[],
  tracked: readonly PupilTrackingResult[],
): EyeObservation[] {
  const rois = new Map(raw.map((r) => [`${r.eyeSide}:${r.frameIndex}`, r]));
  return tracked.map((t) => {
    const r = rois.get(`${t.eyeSide}:${t.frameIndex}`);
    const roi = r
      ? { x: r.roiX, y: r.roiY, width: r.roiWidth, height: r.roiHeight }
      : { x: 0, y: 0, width: 0, height: 0 };
    const valid =
      r?.decodedPtsUs === t.decodedPtsUs &&
      t.trackedCentroidX !== null &&
      t.trackedCentroidY !== null &&
      roi.width > 0 &&
      roi.height > 0;
    return {
      frameIndex: t.frameIndex,
      decodedPtsUs: t.decodedPtsUs,
      eyeSide: t.eyeSide,
      x: valid ? (t.trackedCentroidX! - roi.x) / roi.width : null,
      y: valid ? (t.trackedCentroidY! - roi.y) / roi.height : null,
      confidence: t.trackingConfidence,
      roi,
      estimated: t.ptsEstimated,
    };
  });
}
