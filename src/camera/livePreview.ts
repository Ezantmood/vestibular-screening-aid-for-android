// P3.5 live preview — loader behind the camera seam.
// Android-only native module (same `ExpoCamera2HighSpeed` Kotlin module as
// P1, extended additively); resolves to null in Expo Go / on iOS / web, in
// which case callers get a "Development Build required" error (no crash).
//
// Single camera ownership is enforced natively: live preview XOR the P1/P3
// one-shot `startHighSpeedTest`. The P1/P2/P3 one-shot behavior is untouched.

import { requireOptionalNativeModule } from 'expo';

import type {
  LivePreviewState,
  NativeFramingSample,
  OpenPreviewReport,
  PreviewRecordingReport,
  PreviewStateSnapshot,
  PreviewStatusEvent,
  PreviewTransformInfo,
} from '../../modules/expo-camera2-high-speed/src/ExpoCamera2HighSpeed.types';

export type {
  LivePreviewState,
  NativeFramingSample,
  OpenPreviewReport,
  PreviewRecordingReport,
  PreviewStateSnapshot,
  PreviewStatusEvent,
  PreviewTransformInfo,
};

interface ExpoCamera2HighSpeedPreviewNativeModule {
  openPreviewCamera(
    cameraId: string,
    width: number,
    height: number,
    fpsMin: number,
    fpsMax: number,
  ): Promise<OpenPreviewReport>;
  startPreviewRecording(durationSec: number): Promise<PreviewRecordingReport>;
  stopPreviewRecording(): Promise<{ recording: boolean; stopRequested: boolean }>;
  closePreviewCamera(): Promise<boolean>;
  getPreviewState(): Promise<PreviewStateSnapshot>;
  startFraming(intervalMs: number): Promise<boolean>;
  stopFraming(): Promise<boolean>;
  getPreviewTransformInfo(): Promise<PreviewTransformInfo>;
}

const nativeModule =
  requireOptionalNativeModule<ExpoCamera2HighSpeedPreviewNativeModule>('ExpoCamera2HighSpeed');

export function isLivePreviewAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.openPreviewCamera === 'function';
}

function needModule(): ExpoCamera2HighSpeedPreviewNativeModule {
  if (!isLivePreviewAvailable()) {
    throw new Error(
      'Live preview needs an Expo Development Build on Android (not available in Expo Go). ' +
        'Build with the development profile and run on-device.',
    );
  }
  return nativeModule as ExpoCamera2HighSpeedPreviewNativeModule;
}

/**
 * Open the camera with a live preview burst (high-speed session with the
 * preview surface + an idle recorder surface). Resolves when the preview is
 * streaming; the preview stays up until `closePreviewCamera`.
 */
export async function openPreviewCamera(
  cameraId: string,
  width: number,
  height: number,
  fpsMin: number,
  fpsMax: number,
): Promise<OpenPreviewReport> {
  try {
    return await needModule().openPreviewCamera(cameraId, width, height, fpsMin, fpsMax);
  } catch (e) {
    throw new Error(`openPreviewCamera failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Start recording on the live session (preview keeps streaming — only
 * `recorder.start()` runs). Blocks until the duration elapses or
 * `stopPreviewRecording` is called; resolves with the file + extractor
 * cross-check. Preview is rebuilt for the next take automatically.
 */
export async function startPreviewRecording(durationSec: number): Promise<PreviewRecordingReport> {
  try {
    return await needModule().startPreviewRecording(durationSec);
  } catch (e) {
    throw new Error(`startPreviewRecording failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function stopPreviewRecording(): Promise<boolean> {
  if (!isLivePreviewAvailable()) {
    return false;
  }
  try {
    const result = await (
      nativeModule as ExpoCamera2HighSpeedPreviewNativeModule
    ).stopPreviewRecording();
    return result.stopRequested || !result.recording;
  } catch {
    return false;
  }
}

export async function closePreviewCamera(): Promise<boolean> {
  if (!isLivePreviewAvailable()) {
    return false;
  }
  try {
    return await (nativeModule as ExpoCamera2HighSpeedPreviewNativeModule).closePreviewCamera();
  } catch {
    return false;
  }
}

export async function getPreviewState(): Promise<PreviewStateSnapshot> {
  try {
    return await needModule().getPreviewState();
  } catch (e) {
    throw new Error(`getPreviewState failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Start the ~2 Hz lightweight framing sampler (face/eye boxes only). */
export async function startFraming(intervalMs = 500): Promise<boolean> {
  if (!isLivePreviewAvailable()) {
    return false;
  }
  try {
    return await (nativeModule as ExpoCamera2HighSpeedPreviewNativeModule).startFraming(intervalMs);
  } catch {
    return false;
  }
}

export async function stopFraming(): Promise<boolean> {
  if (!isLivePreviewAvailable()) {
    return false;
  }
  try {
    return await (nativeModule as ExpoCamera2HighSpeedPreviewNativeModule).stopFraming();
  } catch {
    return false;
  }
}

export async function getPreviewTransformInfo(): Promise<PreviewTransformInfo> {
  try {
    return await needModule().getPreviewTransformInfo();
  } catch (e) {
    throw new Error(
      `getPreviewTransformInfo failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
