import { requireOptionalNativeModule } from 'expo';

interface EyeAnalysisStorageModule {
  setEyeAnalysisKeepAwake(enabled: boolean): Promise<boolean>;
  saveEyeAnalysis(kind: 'calibration' | 'signal', json: string): Promise<string>;
  loadCalibrationResult(): Promise<string | null>;
  invalidateCalibrationResult(): Promise<boolean>;
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
export const invalidateCalibration = () => storage().invalidateCalibrationResult();
export const setEyeAnalysisKeepAwake = (enabled: boolean) =>
  storage().setEyeAnalysisKeepAwake(enabled);
