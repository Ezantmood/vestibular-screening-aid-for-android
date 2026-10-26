// P2 frame-pipeline loader behind the camera seam.
// Android-only native module; resolves to null in Expo Go / iOS / web,
// in which case callers get a "Development Build required" error (no crash).

import { requireOptionalNativeModule } from 'expo';
import { currentPupilMeasurement } from '../eyetracking/calibration/types';

import type {
  FramePipelineParams,
  FramePipelineReport,
} from '../../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';

export type { FramePipelineParams, FramePipelineReport };

interface ExpoFramePipelineNativeModule {
  readonly measurementVersion?: string;
  analyzeVideoFile(
    filePath: string,
    expectedFps: number,
    faceSampleCount: number,
    saveDebugFrames: boolean,
    faceRotationDegrees: number | null,
  ): Promise<FramePipelineReport>;
}

const nativeModule =
  requireOptionalNativeModule<ExpoFramePipelineNativeModule>('ExpoFramePipeline');

export function isFramePipelineAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.analyzeVideoFile === 'function';
}

export function assertCurrentFramePipeline(): void {
  if (!isFramePipelineAvailable() || !currentPupilMeasurement(nativeModule?.measurementVersion))
    throw new Error(
      'Cần cập nhật APK có frame geometry eye-contour-pupil-v8. Fast Refresh không cập nhật native.',
    );
}

/** Default offline face subset: 9 evenly-spaced frames (no 120fps realtime). */
export const DEFAULT_FACE_SAMPLE_COUNT = 9;

export interface AnalyzeVideoOptions {
  filePath: string;
  expectedFps: number;
  faceSampleCount?: number;
  saveDebugFrames?: boolean;
  faceRotationDegrees?: number;
}

/**
 * Decode + analyze one P1 high-speed MP4 offline. Resolves with the raw
 * native report (encoded/media timelines, MAD duplicate stats, face/eye ROI
 * feasibility, debug-artifact paths). Debug JPEGs stay in device-local cache.
 */
export async function analyzeVideoFile(options: AnalyzeVideoOptions): Promise<FramePipelineReport> {
  if (!isFramePipelineAvailable()) {
    throw new Error(
      'Frame-pipeline analysis needs an Expo Development Build on Android (not available in Expo Go). ' +
        'Build with the development profile and run on-device.',
    );
  }
  if (
    options.faceRotationDegrees !== undefined &&
    ![0, 90, 180, 270].includes(options.faceRotationDegrees)
  )
    throw new Error('Invalid face rotation metadata.');
  const params = {
    filePath: options.filePath,
    expectedFps: options.expectedFps,
    faceSampleCount: options.faceSampleCount ?? DEFAULT_FACE_SAMPLE_COUNT,
    saveDebugFrames: options.saveDebugFrames ?? true,
  };
  try {
    return await (nativeModule as ExpoFramePipelineNativeModule).analyzeVideoFile(
      params.filePath,
      params.expectedFps,
      params.faceSampleCount,
      params.saveDebugFrames,
      options.faceRotationDegrees ?? null,
    );
  } catch (e) {
    throw new Error(
      `Frame-pipeline analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
