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

/** Raw report returned by the native module after each test. */
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
