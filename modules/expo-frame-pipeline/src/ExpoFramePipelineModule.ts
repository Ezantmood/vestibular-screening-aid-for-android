import { NativeModule, requireNativeModule } from 'expo';

import type { FramePipelineReport } from './ExpoFramePipeline.types';

export type {
  FaceDetectorStatus,
  FramePipelineEyeBox,
  FramePipelineFaceSample,
  FramePipelineParams,
  FramePipelineReport,
} from './ExpoFramePipeline.types';

declare class ExpoFramePipelineModule extends NativeModule<Record<string, never>> {
  analyzeVideoFile(
    filePath: string,
    expectedFps: number,
    faceSampleCount: number,
    saveDebugFrames: boolean,
  ): Promise<FramePipelineReport>;
}

// Android-only local module. Direct require — throws when the native module
// is missing (e.g. Expo Go / iOS / web). The app seam in
// src/camera/framePipeline.ts uses requireOptionalNativeModule instead so the
// debug screen can show a "Development Build required" hint.
export default requireNativeModule<ExpoFramePipelineModule>('ExpoFramePipeline');
