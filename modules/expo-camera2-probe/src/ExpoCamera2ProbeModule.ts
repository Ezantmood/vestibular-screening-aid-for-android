import { NativeModule, requireNativeModule } from 'expo';

import type { Camera2ProbeResult } from './ExpoCamera2Probe.types';

export type {
  Camera2ProbeResult,
  FpsRange,
  HardwareLevel,
  HighSpeedVideoEntry,
  LensFacing,
} from './ExpoCamera2Probe.types';

declare class ExpoCamera2ProbeModule extends NativeModule<Record<string, never>> {
  getCameraCapabilities(): Promise<Camera2ProbeResult[]>;
}

// Android-only local module. Direct require — throws when the native module
// is missing (e.g. Expo Go / iOS / web). The app seam in
// src/camera/camera2Probe.ts uses requireOptionalNativeModule instead so the
// debug screen can show a "Development Build required" hint.
export default requireNativeModule<ExpoCamera2ProbeModule>('ExpoCamera2Probe');
