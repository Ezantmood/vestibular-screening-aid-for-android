import { SELF_CHECK_IDS, type SelfCheckResult } from './selfChecks';
import { NATIVE_CHECK_IDS, type NativeCheckResult } from './technicalReport';
import type { DiagnosticFailureCode } from './failures';

export type SavedCalibrationRead = 'NOT_RUN' | 'AVAILABLE' | 'NOT_FOUND' | 'INVALID' | 'FAILED';
export interface DiagnosticRunResult {
  selfChecks: SelfCheckResult[];
  nativeChecks: NativeCheckResult[];
  savedEvidence: unknown;
  savedCalibrationRead: SavedCalibrationRead;
  failureCodes: DiagnosticFailureCode[];
}

/** Missing, duplicate or malformed bridge results never count as PASS. */
export function normalizeChecks<Id extends string>(ids: readonly Id[], value: unknown) {
  const rows = Array.isArray(value) ? (value as unknown[]) : [];
  return ids.map((id) => {
    const matches = rows.filter(
      (r): r is Record<string, unknown> =>
        typeof r === 'object' && r !== null && 'id' in r && r.id === id,
    );
    const status = matches.length === 1 ? matches[0].status : null;
    const normalized: 'PASS' | 'FAIL' | 'UNAVAILABLE' =
      status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'UNAVAILABLE';
    return { id, status: normalized };
  });
}

export function diagnosticChecksPassed(
  js: readonly SelfCheckResult[],
  native: readonly NativeCheckResult[],
): boolean {
  return (
    normalizeChecks(SELF_CHECK_IDS, js).every((c) => c.status === 'PASS') &&
    normalizeChecks(NATIVE_CHECK_IDS, native).every((c) => c.status === 'PASS')
  );
}

/** Storage failure cannot erase completed checks. Exceptions are never exported. */
export async function runValidationDiagnostics(deps: {
  runJs: () => Promise<unknown>;
  runNative: () => Promise<unknown>;
  readSaved: () => Promise<string | null>;
}): Promise<DiagnosticRunResult> {
  const [js, native, saved] = await Promise.allSettled([
    Promise.resolve().then(deps.runJs),
    Promise.resolve().then(deps.runNative),
    Promise.resolve().then(deps.readSaved),
  ]);
  const selfChecks = normalizeChecks(SELF_CHECK_IDS, js.status === 'fulfilled' ? js.value : null);
  const nativeChecks = normalizeChecks(
    NATIVE_CHECK_IDS,
    native.status === 'fulfilled' ? native.value : null,
  );
  const failureCodes: DiagnosticFailureCode[] = [];
  if (selfChecks.some((c) => c.status === 'UNAVAILABLE'))
    failureCodes.push('JS_SELF_CHECKS_UNAVAILABLE');
  if (nativeChecks.some((c) => c.status === 'UNAVAILABLE'))
    failureCodes.push('NATIVE_SELF_CHECKS_UNAVAILABLE');
  let savedEvidence: unknown = null;
  let savedCalibrationRead: SavedCalibrationRead;
  if (saved.status === 'rejected') {
    savedCalibrationRead = 'FAILED';
    failureCodes.push('SAVED_CALIBRATION_READ_FAILED');
  } else if (saved.value === null) {
    savedCalibrationRead = 'NOT_FOUND';
  } else {
    try {
      const value: unknown = JSON.parse(saved.value);
      const result =
        typeof value === 'object' && value !== null && 'result' in value ? value.result : null;
      if (
        typeof result !== 'object' ||
        result === null ||
        !('verdict' in result) ||
        (result.verdict !== 'VALID' && result.verdict !== 'RETRY')
      )
        throw new Error('INVALID_SAVED_CALIBRATION');
      savedEvidence = value;
      savedCalibrationRead = 'AVAILABLE';
    } catch {
      savedCalibrationRead = 'INVALID';
      failureCodes.push('SAVED_CALIBRATION_INVALID');
    }
  }
  return { selfChecks, nativeChecks, savedEvidence, savedCalibrationRead, failureCodes };
}
