import { NativeModule, requireNativeModule } from 'expo';

import type { HighSpeedTestReport } from './ExpoCamera2HighSpeed.types';

export type {
  HighSpeedRecordingStatus,
  HighSpeedSessionState,
  HighSpeedTestParams,
  HighSpeedTestReport,
} from './ExpoCamera2HighSpeed.types';

declare class ExpoCamera2HighSpeedModule extends NativeModule<Record<string, never>> {
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

// Android-only local module. Direct require — throws when the native module
// is missing (e.g. Expo Go / iOS / web). The app seam in
// src/camera/highSpeedCapture.ts uses requireOptionalNativeModule instead so
// the debug screen can show a "Development Build required" hint.
export default requireNativeModule<ExpoCamera2HighSpeedModule>('ExpoCamera2HighSpeed');
