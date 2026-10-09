import { NativeModule, requireNativeModule } from 'expo';

import type { PupilBatchReport } from './ExpoPupilDetector.types';

export type {
  NativePupilDetectorId,
  PupilBatchReport,
  PupilResultOut,
  PupilRoiRequest,
} from './ExpoPupilDetector.types';

declare class ExpoPupilDetectorModule extends NativeModule<Record<string, never>> {
  readonly measurementVersion: string;
  analyzeVideoPupils(
    filePath: string,
    detectorId: string,
    saveOverlays: boolean,
    requestsJson: string,
  ): Promise<PupilBatchReport>;
}

// Android-only local module. Direct require — throws when the native module
// is missing (e.g. Expo Go / iOS / web). The app seam in
// src/camera/pupilDetector.ts uses requireOptionalNativeModule instead so the
// debug screen can show a "Development Build required" hint.
export default requireNativeModule<ExpoPupilDetectorModule>('ExpoPupilDetector');
