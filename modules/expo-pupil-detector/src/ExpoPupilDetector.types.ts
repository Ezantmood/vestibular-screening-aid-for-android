// P3 pupil detector — native module surface types.
//
// Android-only Kotlin module. It NEVER decodes independently of the P2
// approach: it replays the same MediaExtractor + MediaCodec frame-by-frame
// decode of a P1 MP4 (no surface, CPU YUV Image), but instead of running
// ML Kit it consumes eye-ROI boxes produced by the P2 pass (`faceSamples`)
// and runs a small custom-CV pupil localizer on exact Y-plane luminance
// (no JPEG round-trip in the measurement path).
//
// ML Kit remains solely responsible for face/eye localization (P2 module).
// This module has no ML Kit / OpenCV dependency by design.

/** Pupil detector candidate id (mirrors the TS `PupilDetectorId`). */
export type NativePupilDetectorId = 'percentile-dark' | 'contrast-normalized';

/** One eye ROI to localize, in original decoded-frame coordinates. */
export interface PupilRoiRequest {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: 'left' | 'right';
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  /** Free-form test-condition label echoed into the report. */
  condition: string;
  /**
   * P4 hinted second pass (all optional; absent = standard P3 path):
   * prior centroid in ROI px + search radius in ROI px.
   */
  priorXInRoi?: number | null;
  priorYInRoi?: number | null;
  searchRadiusPx?: number | null;
}

export interface PupilResultOut {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: 'left' | 'right';
  detectorId: NativePupilDetectorId;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  centroidXInRoi: number | null;
  centroidYInRoi: number | null;
  centroidXInFrame: number | null;
  centroidYInFrame: number | null;
  normalizedX: number | null;
  normalizedY: number | null;
  candidateWidth: number | null;
  candidateHeight: number | null;
  confidence: number;
  failureReason: string | null;
  condition: string;
  /** Device-local overlay JPEG (debug only, never committed). */
  overlayPath: string | null;
}

/** Batch report for one `analyzeVideoPupils` call. */
export interface PupilBatchReport {
  filePath: string;
  detectorId: NativePupilDetectorId;
  decodedFrameCount: number;
  frameWidth: number;
  frameHeight: number;
  results: PupilResultOut[];
  overlayPaths: string[];
  warnings: string[];
  error: string | null;
}
