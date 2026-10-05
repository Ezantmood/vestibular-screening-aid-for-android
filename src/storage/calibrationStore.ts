import { readCalibrationJson, saveEyeAnalysis } from '../camera/eyeAnalysisStorage';
import type { CalibrationResult } from '../eyetracking/calibration/types';
import { calibrationUsable } from '../eyetracking/calibration/calibration';

/** Fail closed for corrupt/incompatible/expired persistent artifacts. */
export async function loadCalibration(): Promise<CalibrationResult | null> {
  const json = await readCalibrationJson();
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('result' in parsed) ||
      !('schemaVersion' in parsed) ||
      parsed.schemaVersion !== 1
    )
      return null;
    // JSON is untrusted: all access/validation is guarded; no mapping before checks.
    const result = parsed.result as CalibrationResult;
    return calibrationUsable(result, result.context, Date.now()) ? result : null;
  } catch {
    return null;
  }
}
export async function saveCalibrationArtifact(
  artifact: { schemaVersion: 1; result: CalibrationResult } & Record<string, unknown>,
): Promise<string> {
  return saveEyeAnalysis('calibration', JSON.stringify(artifact));
}
