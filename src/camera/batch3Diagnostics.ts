import { requireOptionalNativeModule } from 'expo';
import { NATIVE_CHECK_IDS, type NativeCheckResult } from '../tests/validation/technicalReport';

interface DiagnosticsNative {
  exportTechnicalReport(json: string): Promise<boolean>;
}
interface PupilChecksNative {
  runPupilSelfChecks(): Promise<unknown>;
}
const io = requireOptionalNativeModule<DiagnosticsNative>('ExpoCamera2HighSpeed');
const pupil = requireOptionalNativeModule<PupilChecksNative>('ExpoPupilDetector');
export async function runNativePupilChecks(): Promise<NativeCheckResult[]> {
  try {
    const result = await pupil?.runPupilSelfChecks();
    return NATIVE_CHECK_IDS.map((id) => {
      const match: unknown = Array.isArray(result)
        ? result.find(
            (r: unknown) => typeof r === 'object' && r !== null && 'id' in r && r.id === id,
          )
        : null;
      const status =
        typeof match === 'object' && match !== null && 'status' in match ? match.status : null;
      return {
        id,
        status: status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'UNAVAILABLE',
      };
    });
  } catch {
    return NATIVE_CHECK_IDS.map((id) => ({ id, status: 'UNAVAILABLE' }));
  }
}
export async function exportTechnicalReport(json: string): Promise<boolean> {
  if (!io?.exportTechnicalReport) throw new Error('Cần APK Batch 3 mới để xuất báo cáo.');
  return io.exportTechnicalReport(json);
}
