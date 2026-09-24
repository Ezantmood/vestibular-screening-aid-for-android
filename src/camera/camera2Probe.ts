// P0.1 Camera2 capability probe — loader behind the camera seam.
// Android-only native module; resolves to null in Expo Go / on iOS / web,
// in which case callers get a "Development Build required" error (no crash).

import { requireOptionalNativeModule } from 'expo';

import type { Camera2ProbeResult, HighSpeedTarget } from './camera2ProbeTypes';

interface ExpoCamera2ProbeNativeModule {
  getCameraCapabilities(): Promise<Camera2ProbeResult[]>;
}

const nativeModule = requireOptionalNativeModule<ExpoCamera2ProbeNativeModule>('ExpoCamera2Probe');

export function isCamera2ProbeAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.getCameraCapabilities === 'function';
}

/**
 * Query real Camera2 capabilities for every camera in CameraManager.cameraIdList.
 * Throws a human-readable Error when the native module is missing (Expo Go)
 * or when Camera2 access fails on-device (see Kotlin CodedException codes).
 */
export async function getCamera2Capabilities(): Promise<Camera2ProbeResult[]> {
  if (!isCamera2ProbeAvailable()) {
    throw new Error(
      'Camera2 probe needs an Expo Development Build on Android (not available in Expo Go). ' +
        'Build with the development profile and run on-device.',
    );
  }
  try {
    return await (nativeModule as ExpoCamera2ProbeNativeModule).getCameraCapabilities();
  } catch (e) {
    throw new Error(`Camera2 probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * True when Camera2 reports `size` with a high-speed FPS range covering `fps`.
 * A range covers fps when range.min <= fps <= range.max (constrained
 * high-speed ranges are typically fixed, e.g. [120, 120]).
 */
export function supportsHighSpeedTarget(
  camera: Camera2ProbeResult,
  target: HighSpeedTarget,
): boolean {
  return camera.highSpeedVideoSizes.some(
    (entry) =>
      entry.width === target.width &&
      entry.height === target.height &&
      entry.fpsRanges.some((range) => range.min <= target.fps && target.fps <= range.max),
  );
}

export type { Camera2ProbeResult, HighSpeedTarget };
