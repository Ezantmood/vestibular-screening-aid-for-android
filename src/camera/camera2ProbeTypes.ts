// P0.1 Camera2 capability probe — domain types.
// Re-exported from the Android-only local native module so UI/tests depend on
// this seam, never on the native module directly. See docs/ARCHITECTURE.md.
export type {
  Camera2ProbeResult,
  FpsRange,
  HardwareLevel,
  HighSpeedVideoEntry,
  LensFacing,
} from '../../modules/expo-camera2-probe/src/ExpoCamera2Probe.types';

/** A (size, fps) combination the debug screen highlights. */
export interface HighSpeedTarget {
  label: string;
  width: number;
  height: number;
  fps: number;
}

/** Debug highlights required by P0.1 — not device assumptions, just report targets. */
export const HIGH_SPEED_TARGETS: HighSpeedTarget[] = [
  { label: '1920×1080 @ 120fps', width: 1920, height: 1080, fps: 120 },
  { label: '1280×720 @ 120fps', width: 1280, height: 720, fps: 120 },
  { label: '1280×720 @ 240fps', width: 1280, height: 720, fps: 240 },
];
