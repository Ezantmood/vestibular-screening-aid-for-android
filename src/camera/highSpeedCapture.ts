// P1 high-speed capture — loader behind the camera seam.
// Android-only native module; resolves to null in Expo Go / on iOS / web,
// in which case callers get a "Development Build required" error (no crash).
// Mode enumeration reuses the P0.1 read-only probe; this module only captures.
// The native side re-validates every mode against live Camera2 data and
// rejects anything that is not an exact advertised (size, FPS range) pair.

import { requireOptionalNativeModule } from 'expo';

import type {
  HighSpeedTestParams,
  HighSpeedTestReport,
} from '../../modules/expo-camera2-high-speed/src/ExpoCamera2HighSpeed.types';

export type { HighSpeedTestParams, HighSpeedTestReport };

interface ExpoCamera2HighSpeedNativeModule {
  startHighSpeedTest(
    cameraId: string,
    width: number,
    height: number,
    fpsMin: number,
    fpsMax: number,
    durationSec: number,
  ): Promise<HighSpeedTestReport>;
  cancelHighSpeedTest(): Promise<boolean>;
}

const nativeModule =
  requireOptionalNativeModule<ExpoCamera2HighSpeedNativeModule>('ExpoCamera2HighSpeed');

export function isHighSpeedCaptureAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.startHighSpeedTest === 'function';
}

/**
 * Run one constrained high-speed validation test (~10 s). Resolves with the
 * raw native report (session state, sensor timestamps, recording status).
 * Rejects for invalid modes / missing permission / missing native module.
 */
export async function startHighSpeedTest(
  params: HighSpeedTestParams,
): Promise<HighSpeedTestReport> {
  if (!isHighSpeedCaptureAvailable()) {
    throw new Error(
      'High-speed capture needs an Expo Development Build on Android (not available in Expo Go). ' +
        'Build with the development profile and run on-device.',
    );
  }
  try {
    return await (nativeModule as ExpoCamera2HighSpeedNativeModule).startHighSpeedTest(
      params.cameraId,
      params.width,
      params.height,
      params.fpsMin,
      params.fpsMax,
      params.durationSec,
    );
  } catch (e) {
    throw new Error(`High-speed test failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function cancelHighSpeedTest(): Promise<boolean> {
  if (!isHighSpeedCaptureAvailable()) {
    return false;
  }
  try {
    return await (nativeModule as ExpoCamera2HighSpeedNativeModule).cancelHighSpeedTest();
  } catch {
    return false;
  }
}
