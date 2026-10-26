// P2 frame pipeline — native module surface types.
// Android-only Kotlin module decodes a P1 high-speed MP4 with MediaExtractor +
// MediaCodec (frame-by-frame, never MediaMetadataRetriever as primary), builds
// an encoded/media-PTS timeline, runs a luminance frame-change check, and (on
// a small offline subset) runs ML Kit face/eye ROI feasibility. Face/eye boxes
// are NOT pupil tracking.

/** Parameters for one offline analysis of a recorded high-speed MP4. */
export interface FramePipelineParams {
  /** Absolute device path to the P1 MP4 (app-private cache). */
  filePath: string;
  /** Nominal capture rate for gap/threshold math (e.g. 120). */
  expectedFps: number;
  /** Max frames sampled for face/eye ROI (default 9). Offline only. */
  faceSampleCount?: number;
  /** Save begin/middle/end JPEGs + eye crops to app cache (debug only). */
  saveDebugFrames?: boolean;
}

export interface FramePipelineEyeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  usable: boolean;
  /** True when estimated from face-box proportions (no ML Kit landmark). */
  estimated: boolean;
}

export interface FramePipelineFaceSample {
  frameIndex: number;
  ptsUs: number | null;
  faceDetected: boolean;
  faceBox: { x: number; y: number; width: number; height: number } | null;
  leftEye: FramePipelineEyeBox | null;
  rightEye: FramePipelineEyeBox | null;
  /** Physical CW rotation (0/90/270) applied before detection, if any. */
  rotationApplied: number | null;
  headPose?: { pitch: number; yaw: number; roll: number } | null;
  error: string | null;
}

export type FaceDetectorStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED';

/** Full offline report returned by the native module. */
export interface FramePipelineReport {
  filePath: string;
  fileSizeBytes: number | null;
  mime: string | null;
  width: number;
  height: number;
  // Encoded (MediaExtractor sample) timeline — media PTS, NOT sensor exposure.
  encodedSampleCount: number;
  encodedFirstPtsUs: number | null;
  encodedLastPtsUs: number | null;
  encodedDurationUs: number | null;
  // Decoded (MediaCodec output) timeline — media PTS, NOT sensor exposure.
  decodedFrameCount: number;
  decodedFirstPtsUs: number | null;
  decodedLastPtsUs: number | null;
  decodedDurationUs: number | null;
  decodedPtsUs: number[];
  // Decoded PTS interval statistics (microseconds internally).
  meanIntervalUs: number | null;
  medianIntervalUs: number | null;
  minIntervalUs: number | null;
  maxIntervalUs: number | null;
  p95IntervalUs: number | null;
  effectiveFps: number | null;
  nonMonotonicPtsCount: number;
  duplicatePtsCount: number;
  largeGapCount: number;
  largeGapThresholdUs: number;
  // Luminance frame-change check (downsampled Y MAD, 0–255 scale).
  nearDuplicateThresholdMad: number;
  lowMotionThresholdMad: number;
  frameMad: number[];
  nearDuplicateCount: number;
  nearDuplicatePct: number;
  longestDuplicateRun: number;
  lowMotionCount: number;
  madMean: number | null;
  madMedian: number | null;
  madMin: number | null;
  madMax: number | null;
  // Eye ROI feasibility (offline subset only).
  faceDetectorStatus: FaceDetectorStatus;
  faceDetectorDetail: string | null;
  faceSamples: FramePipelineFaceSample[];
  faceDetectionRate: number | null;
  bothEyesUsableRate: number | null;
  // Debug artifacts (device-local cache paths; never committed to git).
  savedFramePaths: string[];
  savedCropPaths: string[];
  warnings: string[];
  error: string | null;
}
