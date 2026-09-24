// P0.1 Camera2 capability probe — native module surface types.
// Values are produced by the Android-only Kotlin module
// (modules/expo-camera2-probe/android/.../ExpoCamera2ProbeModule.kt).
// Nothing is hard-coded: every field comes from CameraCharacteristics.

export interface FpsRange {
  min: number;
  max: number;
}

export interface HighSpeedVideoEntry {
  width: number;
  height: number;
  fpsRanges: FpsRange[];
}

export type LensFacing = 'BACK' | 'FRONT' | 'EXTERNAL' | 'UNKNOWN';

export type HardwareLevel = 'LEGACY' | 'LIMITED' | 'FULL' | 'LEVEL_3' | 'EXTERNAL' | 'UNKNOWN';

export interface Camera2ProbeResult {
  cameraId: string;
  lensFacing: LensFacing;
  hardwareLevel: HardwareLevel;
  /** Degrees; null when SENSOR_ORIENTATION is missing. */
  sensorOrientation: number | null;
  /** Normal AE target FPS ranges (CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES). */
  aeFpsRanges: FpsRange[];
  /** True when REQUEST_AVAILABLE_CAPABILITIES contains CONSTRAINED_HIGH_SPEED_VIDEO. */
  constrainedHighSpeedVideoSupported: boolean;
  /** Every getHighSpeedVideoSizes() entry with its getHighSpeedVideoFpsRangesFor(size). */
  highSpeedVideoSizes: HighSpeedVideoEntry[];
  /** Per-camera failure message; null when the camera was read successfully. */
  error: string | null;
}
