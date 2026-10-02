// P1 high-speed capture — native module surface types.
// Values are produced by the Android-only Kotlin module
// (modules/expo-camera2-high-speed/android/.../ExpoCamera2HighSpeedModule.kt).
// Mode selection is driven at runtime by P0.1 probe data (Camera2-advertised
// sizes + exact FPS ranges); nothing is hard-coded per device.

/** Parameters for one ~10 s constrained high-speed validation test. */
export interface HighSpeedTestParams {
  cameraId: string;
  width: number;
  height: number;
  /** Exact advertised range — the module rejects anything else. */
  fpsMin: number;
  fpsMax: number;
  /** Capture length in seconds (≈10 for P1 validation). */
  durationSec: number;
}

export type HighSpeedSessionState = 'CONFIGURED' | 'CONFIGURE_FAILED' | 'CAMERA_ERROR' | 'CLOSED';

export type HighSpeedRecordingStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED';

/** P3.5 live-preview session state (module-owned camera, JS-driven). */
export type LivePreviewState = 'IDLE' | 'PREVIEW' | 'RECORDING';

/** Report returned by `openPreviewCamera` (preview burst running, idle recorder). */
export interface OpenPreviewReport {
  sessionState: HighSpeedSessionState;
  previewActive: boolean;
  cameraId: string;
  lensFacing: string;
  width: number;
  height: number;
  fpsMin: number;
  fpsMax: number;
  sessionEvents: string[];
  error: string | null;
}

/** Report returned by `startPreviewRecording` (blocks until stop). */
export interface PreviewRecordingReport extends OpenPreviewReport {
  previewResumed: boolean;
  manualStop: boolean;
  recordingStatus: HighSpeedRecordingStatus;
  filePath: string | null;
  fileSizeBytes: number | null;
  extractorSampleCount: number | null;
  extractorDurationUs: number | null;
}

/** Snapshot of `getPreviewState` (pollable; no events stream). */
export interface PreviewStateSnapshot {
  state: LivePreviewState;
  previewActive: boolean;
  recording: boolean;
  cameraId?: string;
  lensFacing?: string;
  width?: number;
  height?: number;
  fpsMin?: number;
  fpsMax?: number;
  previewSurfaceValid?: boolean;
  owner?: string | null;
  sessionEvents?: string[];
}

/** One lightweight native framing observation (DISPLAY view fractions). */
export interface NativeFramingSample {
  faceFound: boolean;
  faceLeft: number | null;
  faceTop: number | null;
  faceRight: number | null;
  faceBottom: number | null;
  leftEyeLandmark: boolean;
  rightEyeLandmark: boolean;
  leftEyeOpenProb: number | null;
  rightEyeOpenProb: number | null;
  bitmapWidth: number;
  bitmapHeight: number;
}

/** Native preview-surface lifecycle event. */
export interface PreviewStatusEvent {
  status: string;
  viewWidth: number;
  viewHeight: number;
}

/** TextureView CONTENT -> DISPLAY correction audit (not decoded-frame sampling). */
export interface PreviewTransformInfo {
  viewWidth: number;
  viewHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  displayRotation: number;
  sensorOrientation: number;
  frontFacing: boolean;
  matrixConvention: 'textureContentToDisplay';
  mirrorPreview: boolean;
  extraRotationDeg: number;
  matrix: number[] | null;
}

/** Raw report returned by the native module after each one-shot test. */
export interface HighSpeedTestReport {
  deviceModel: string;
  androidRelease: string;
  apiLevel: number;
  cameraId: string;
  lensFacing: string;
  width: number;
  height: number;
  fpsMin: number;
  fpsMax: number;
  sessionState: HighSpeedSessionState;
  /** Timestamped session/camera lifecycle events. */
  sessionEvents: string[];
  /** Monotonic (elapsedRealtimeNanos) test boundaries. */
  testStartNs: number;
  testEndNs: number;
  frameNumbers: number[];
  /** CaptureResult SENSOR_TIMESTAMP values, nanoseconds. */
  sensorTimestampsNs: number[];
  recordingStatus: HighSpeedRecordingStatus;
  /** App-private cache file; null when recording failed. */
  filePath: string | null;
  fileSizeBytes: number | null;
  /** MediaExtractor cross-check; null when unavailable (never invented). */
  extractorSampleCount: number | null;
  extractorDurationUs: number | null;
  error: string | null;
}
