import assert from './assert';
import { SELF_CHECK_IDS } from '../src/tests/validation/selfChecks';
import { NATIVE_CHECK_IDS, buildTechnicalReport } from '../src/tests/validation/technicalReport';
import {
  diagnosticChecksPassed,
  runValidationDiagnostics,
} from '../src/tests/validation/diagnosticRun';
import {
  canExportTechnicalReport,
  createReportSnapshot,
  restoreReviewReport,
} from '../src/tests/validation/reportSnapshot';

async function main() {
  const jsPass = SELF_CHECK_IDS.map((id) => ({ id, status: 'PASS' as const }));
  const nativePass = NATIVE_CHECK_IDS.map((id) => ({ id, status: 'PASS' as const }));
  const initial = buildTechnicalReport({});
  assert.ok(initial.selfChecks.every((c) => c.status === 'NOT_RUN'));
  assert.ok(initial.nativeChecks.every((c) => c.status === 'NOT_RUN'));
  assert.equal(canExportTechnicalReport(initial), false);
  assert.equal(diagnosticChecksPassed([], []), false);
  assert.equal(diagnosticChecksPassed(jsPass.slice(1), nativePass), false);
  assert.equal(diagnosticChecksPassed(jsPass, [...nativePass, nativePass[0]]), false);

  const deps = {
    runJs: async () => jsPass,
    runNative: async () => nativePass,
    readSaved: async (): Promise<string | null> => null,
  };
  const missing = await runValidationDiagnostics(deps);
  assert.equal(missing.savedCalibrationRead, 'NOT_FOUND');
  assert.equal(missing.failureCodes.length, 0);
  assert.ok(diagnosticChecksPassed(missing.selfChecks, missing.nativeChecks));
  const storageFailed = await runValidationDiagnostics({
    ...deps,
    readSaved: async () => {
      throw new Error('/PERSONAL_SENTINEL/private-calibration.json');
    },
  });
  assert.ok(diagnosticChecksPassed(storageFailed.selfChecks, storageFailed.nativeChecks));
  assert.equal(storageFailed.savedCalibrationRead, 'FAILED');
  assert.equal(storageFailed.failureCodes[0], 'SAVED_CALIBRATION_READ_FAILED');
  const safeFailure = buildTechnicalReport({
    selfChecks: storageFailed.selfChecks,
    nativeChecks: storageFailed.nativeChecks,
    selfTestCompleted: true,
    diagnosticFailures: storageFailed.failureCodes,
    savedCalibrationRead: storageFailed.savedCalibrationRead,
  });
  assert.ok(canExportTechnicalReport(safeFailure));
  assert.equal(
    safeFailure.selfChecks.filter((c) => c.status === 'PASS').length,
    SELF_CHECK_IDS.length,
  );
  assert.equal(
    safeFailure.nativeChecks.filter((c) => c.status === 'PASS').length,
    NATIVE_CHECK_IDS.length,
  );
  assert.ok(!JSON.stringify(safeFailure).includes('PERSONAL_SENTINEL'));
  for (const json of ['{broken', '{}', 'null', '[]', '{"result":{"verdict":"UNKNOWN"}}']) {
    const invalid = await runValidationDiagnostics({ ...deps, readSaved: async () => json });
    assert.equal(invalid.savedCalibrationRead, 'INVALID');
    assert.ok(diagnosticChecksPassed(invalid.selfChecks, invalid.nativeChecks));
  }
  const saved = await runValidationDiagnostics({
    ...deps,
    readSaved: async () => '{"result":{"verdict":"RETRY"}}',
  });
  assert.equal(saved.savedCalibrationRead, 'AVAILABLE');

  const nativeMissing = await runValidationDiagnostics({
    ...deps,
    runNative: () => {
      throw new Error('/PERSONAL_SENTINEL/native-module');
    },
  });
  assert.ok(nativeMissing.selfChecks.every((c) => c.status === 'PASS'));
  assert.ok(nativeMissing.nativeChecks.every((c) => c.status === 'UNAVAILABLE'));
  assert.equal(diagnosticChecksPassed(nativeMissing.selfChecks, nativeMissing.nativeChecks), false);
  assert.equal(nativeMissing.failureCodes[0], 'NATIVE_SELF_CHECKS_UNAVAILABLE');
  const jsMissing = await runValidationDiagnostics({ ...deps, runJs: async () => [] });
  assert.ok(jsMissing.nativeChecks.every((c) => c.status === 'PASS'));
  assert.ok(jsMissing.selfChecks.every((c) => c.status === 'UNAVAILABLE'));
  assert.equal(diagnosticChecksPassed(jsMissing.selfChecks, jsMissing.nativeChecks), false);
  const checkFailed = await runValidationDiagnostics({
    ...deps,
    runNative: async () => [{ ...nativePass[0], status: 'FAIL' }, ...nativePass.slice(1)],
  });
  assert.equal(checkFailed.nativeChecks[0].status, 'FAIL');
  assert.equal(diagnosticChecksPassed(checkFailed.selfChecks, checkFailed.nativeChecks), false);

  const cache = createReportSnapshot();
  cache.remember(initial);
  assert.equal(cache.read(), null);
  cache.remember(safeFailure);
  assert.equal(
    cache.read()?.selfChecks.filter((c) => c.status === 'PASS').length,
    SELF_CHECK_IDS.length,
  );
  const retryReport = buildTechnicalReport({
    selfTestCompleted: true,
    selfChecks: jsPass,
    nativeChecks: nativePass,
    workflowStarted: true,
    calibrationArtifact: {
      result: {
        verdict: 'RETRY',
        reasons: ['POOR_VALIDATION'],
        targetQuality: [{ targetId: 'fit-center', eyeSide: 'left', total: 100, accepted: 70 }],
      },
      takes: Array.from({ length: 14 }, () => ({})),
      replays: [{ decodedFrames: 180 }],
    },
  });
  cache.remember(retryReport);
  // Leaving and reopening review preserves the exact aggregate; no raw artifact is cached.
  const restored = restoreReviewReport(safeFailure, cache.read());
  assert.equal(restored.physicalWorkflow.calibration.verdict, 'RETRY');
  assert.equal(restored.physicalWorkflow.calibration.targetCount, 14);
  assert.equal(restored.physicalWorkflow.calibration.decodedFrames, 180);
  assert.equal(restored.physicalWorkflow.calibrationConfirmed, false);
  assert.equal(restored.physicalWorkflow.pursuit.reliableMetrics, false);
  assert.equal(restored.selfTest.savedCalibrationRead, 'FAILED');
  for (const stage of ['calibration', 'pursuit', 'saccades'] as const) {
    cache.remember(retryReport, stage);
    assert.equal(cache.read()?.physicalWorkflow.interrupted, true);
    assert.equal(cache.read()?.physicalWorkflow.failures.at(-1)?.stage, stage);
    assert.equal(cache.read()?.physicalWorkflow.failures.at(-1)?.code, 'WORKFLOW_CANCELLED');
    assert.equal(cache.read()?.physicalWorkflow.calibration.targetCount, 14);
  }
  const restarted = restoreReviewReport(initial, null);
  assert.equal(restarted.physicalWorkflow.calibration.targetCount, 0);
  assert.equal(createReportSnapshot().read(), null);
  assert.ok(!JSON.stringify(cache.read()).includes('filePath'));
  console.log(
    'Diagnostic run checks: PASS (empty export blocked, storage failure retains checks, complete check gates, safe errors, aggregate survives navigation, interrupted stages, fresh workflow reset)',
  );
}
void main().catch((error: unknown) => {
  setTimeout(() => {
    throw error;
  }, 0);
});
