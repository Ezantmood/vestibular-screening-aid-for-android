import assert from './assert';
import { fitCalibration } from '../src/eyetracking/calibration/calibration';
import { calibrationModelComparison } from '../src/eyetracking/calibration/modelComparison';
import {
  calibrationFrameProgress,
  calibrationProgress,
} from '../src/eyetracking/calibration/progress';
import {
  syntheticCalibrationTakes,
  syntheticEyeContour,
  SYNTHETIC_CONTEXT,
} from '../src/tests/validation/selfChecks';
import { calibrationTechnicalSummary } from '../src/tests/validation/technicalReport';

const fit = (takes = syntheticCalibrationTakes()) =>
  fitCalibration({ id: 'simulation', createdAtMs: 1000, context: SYNTHETIC_CONTEXT, takes });
const good = fit();
assert.equal(calibrationProgress(good).overall.percent, 100);
assert.equal(calibrationProgress(good).overall.total, 40);
assert.equal(calibrationProgress(good).usableAtCreation, true);
assert.equal(calibrationProgress(null).overall.percent, null);
assert.equal(calibrationFrameProgress(null)[0].withinTolerancePercent, null);
assert.equal(calibrationFrameProgress(good)[0].withinTolerancePercent, 100);
assert.equal(calibrationFrameProgress(good)[0].accepted, 600);
assert.equal(calibrationModelComparison(good)[0].selectedByFitCv!.model, 'affine');

// Simulated legacy-rubric failures; no physical measurements are replayed.
const historicalCounts = fit();
delete (historicalCounts as Partial<typeof historicalCounts>).modelVersion;
historicalCounts.verdict = 'RETRY';
for (const q of historicalCounts.targetQuality)
  if (q.eyeSide === 'left') q.reasons = ['INSUFFICIENT_COVERAGE'];
Object.assign(historicalCounts.models.left!, {
  fitRmse: 0.2,
  validationRmse: 0.3,
  validationMaxError: 0.4,
});
Object.assign(historicalCounts.models.right!, {
  fitRmse: 0.2,
  validationRmse: 0.3,
  validationMaxError: 0.4,
});
assert.equal(calibrationProgress(historicalCounts).overall.percent, 41.2);
assert.equal(calibrationProgress(historicalCounts).overall.passed, 14);
assert.equal(calibrationProgress(historicalCounts).eyes[0].all.percent, 0);
assert.equal(calibrationProgress(historicalCounts).eyes[1].all.percent, 82.4);
assert.equal(calibrationModelComparison(historicalCounts)[0].status, 'BLOCKED_SAMPLE_QUALITY');
const missing = fit();
missing.targetQuality = [];
assert.equal(calibrationProgress(missing).overall.total, 40);
assert.equal(calibrationProgress(missing).overall.passed, 12);
assert.equal(calibrationProgress(missing).usableAtCreation, false);
const duplicated = fit();
duplicated.targetQuality.push(duplicated.targetQuality[0]);
assert.equal(calibrationProgress(duplicated).overall.passed, 39);
assert.equal(calibrationProgress(duplicated).usableAtCreation, false);
const legacy = { ...good, context: { ...good.context, coordinateVersion: 'decoded-roi-v1' } };
assert.equal(calibrationProgress(legacy).versionCurrent, false);
assert.equal(calibrationProgress(legacy).usableAtCreation, false);
assert.equal(calibrationModelComparison(legacy)[0].status, 'LEGACY_OR_MISSING_MEASUREMENTS');

// A perfect target median can hide 0.283 viewport jitter at every held-out frame.
const noisy = syntheticCalibrationTakes();
for (const take of noisy)
  for (const s of take.samples) {
    const noise = s.frameIndex % 2 ? 0.001 : -0.001;
    s.face = { x: 200, y: 200, width: 600, height: 800 };
    s.eyeContour = syntheticEyeContour(s.face);
    const frameX = 200 + (0.4 + 0.005 * take.target.x + noise) * 600;
    const frameY = 200 + (0.4 + 0.005 * take.target.y + noise) * 800;
    s.roi = { x: frameX - 90, y: frameY - 90, width: 180, height: 180 };
    s.x = s.y = 0.5;
  }
const noisyResult = fit(noisy);
assert.equal(noisyResult.verdict, 'RETRY');
assert.ok(noisyResult.reasons.some((r) => r.startsWith('NOISY_VALIDATION')));
const frameProgress = calibrationFrameProgress(noisyResult)[0];
assert.equal(frameProgress.withinTolerancePercent, 0);
assert.ok(Math.abs(frameProgress.rmse! - Math.sqrt(0.08)) < 1e-9);
assert.equal(frameProgress.acceptedCoveragePercent, 100);

// Known nonlinear mapping: target = u + 0.5*(u-0.5)^2.
const nonlinear = syntheticCalibrationTakes();
for (const take of nonlinear)
  for (const s of take.samples) {
    s.x = 0.3 + 0.25 * (Math.sqrt(2 * take.target.x) - 0.5);
    s.y = 0.3 + 0.25 * (Math.sqrt(2 * take.target.y) - 0.5);
  }
const nonlinearResult = fit(nonlinear);
const comparison = calibrationModelComparison(nonlinearResult)[0];
assert.equal(comparison.selectedByFitCv!.model, 'quadratic-ridge');
const selected = comparison.candidates.find(
  (c) =>
    c.model === comparison.selectedByFitCv!.model &&
    c.lambda === comparison.selectedByFitCv!.lambda,
)!;
const affine = comparison.candidates.find((c) => c.model === 'affine')!;
assert.ok(selected.validationRmse < affine.validationRmse * 0.1);

// Poison ALL validation features: model/lambda choice and CV must not change.
for (const take of nonlinear)
  if (take.target.role === 'validation') for (const s of take.samples) s.x! += 0.1;
const poisoned = calibrationModelComparison(fit(nonlinear))[0];
assert.equal(JSON.stringify(poisoned.selectedByFitCv), JSON.stringify(comparison.selectedByFitCv));
assert.equal(
  JSON.stringify(poisoned.candidates.map((c) => c.fitCvRmse)),
  JSON.stringify(comparison.candidates.map((c) => c.fitCvRmse)),
);
assert.ok(poisoned.candidates.every((c) => !c.errorGatesPass));

// Recomputed/allowlisted output ignores injected percentages and private text.
const altered = fit();
altered.targetQuality.find((q) => q.validationFrames)!.validationFrames!.withinTolerancePercent =
  999;
const exported = calibrationTechnicalSummary({ result: altered });
assert.equal(exported.frameValidation[0].withinTolerancePercent, 100);
const before = JSON.stringify(altered);
const privateResult = {
  ...altered,
  name: 'PRIVATE_SENTINEL',
  progress: { name: 'PRIVATE_SENTINEL' },
};
assert.ok(
  !JSON.stringify(calibrationTechnicalSummary({ result: privateResult })).includes(
    'PRIVATE_SENTINEL',
  ),
);
assert.equal(JSON.stringify(altered), before);
console.log(
  JSON.stringify({
    calibrationProgressChecks: 'PASS',
    syntheticNonlinearComparison: {
      affineValidationRmse: affine.validationRmse,
      ridgeValidationRmse: selected.validationRmse,
    },
    syntheticMedianBlindSpot: {
      medianValidationRmse: noisyResult.models.left!.validationRmse,
      frameValidationRmse: frameProgress.rmse,
      framesWithinTolerancePercent: frameProgress.withinTolerancePercent,
    },
  }),
);
