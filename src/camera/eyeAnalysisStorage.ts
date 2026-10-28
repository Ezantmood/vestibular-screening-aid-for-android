import { requireOptionalNativeModule } from 'expo';

interface EyeAnalysisStorageModule {
  setEyeAnalysisKeepAwake(enabled: boolean): Promise<boolean>;
  saveEyeAnalysis(kind: 'calibration' | 'signal', json: string): Promise<string>;
  loadCalibrationResult(): Promise<string | null>;
  invalidateCalibrationResult(): Promise<boolean>;
  loadCalibrationEvidence?(): Promise<string | null>;
  loadCalibrationCapture?(): Promise<string | null>;
  retainCalibrationCapture?(json: string): Promise<string>;
}
const native = requireOptionalNativeModule<EyeAnalysisStorageModule>('ExpoCamera2HighSpeed');
function storage(): EyeAnalysisStorageModule {
  if (!native || typeof native.saveEyeAnalysis !== 'function')
    throw new Error('Cần cài Android Development Build mới để lưu calibration / signal.');
  return native;
}
export const saveEyeAnalysis = (kind: 'calibration' | 'signal', json: string) =>
  storage().saveEyeAnalysis(kind, json);
export const readCalibrationJson = () => storage().loadCalibrationResult();
export const readCalibrationEvidenceJson = () =>
  storage().loadCalibrationEvidence?.() ?? storage().loadCalibrationResult();
export const readCalibrationCaptureJson = async () =>
  (await storage().loadCalibrationCapture?.()) ?? null;
export const retainCalibrationCapture = (json: string) => {
  const module = storage();
  if (!module.retainCalibrationCapture)
    throw new Error('Cần cập nhật APK có lưu video hiệu chỉnh bền vững.');
  return module.retainCalibrationCapture(json).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Capture video is missing'))
      throw new Error(
        'Một video của lượt cũ không còn trên máy. Không thể khôi phục pixel từ JSON. Các video đã giữ trong bản mới sẽ không phụ thuộc cache.',
      );
    throw error;
  });
};
export const invalidateCalibration = () => storage().invalidateCalibrationResult();
export const setEyeAnalysisKeepAwake = (enabled: boolean) =>
  storage().setEyeAnalysisKeepAwake(enabled);
