import assert from './assert';
import {
  fitCalibration,
  calibrationUsable,
  mapCalibration,
  createCalibrationMapper,
} from '../src/eyetracking/calibration/calibration';
import {
  evaluateRegression,
  fitRegression,
  regressionGeometrySafe,
  regressionRmse,
  selectRegression,
} from '../src/eyetracking/calibration/regression';
import type { GazeRegression } from '../src/eyetracking/calibration/types';
import { syntheticCalibrationTakes, SYNTHETIC_CONTEXT } from '../src/tests/validation/selfChecks';

const fit = (takes = syntheticCalibrationTakes()) =>
  fitCalibration({
    id: 'regression-simulation',
    createdAtMs: 1000,
    context: SYNTHETIC_CONTEXT,
    takes,
  });
const linear = fit();
assert.equal(linear.verdict, 'VALID');
assert.equal(linear.models.left!.family, 'affine');
assert.ok(calibrationUsable(linear, SYNTHETIC_CONTEXT, 1000));

const nonlinear = syntheticCalibrationTakes();
const curvature = 0.65;
const feature = (t: number) =>
  (curvature - 1 + Math.sqrt(1 - 2 * curvature + 4 * curvature * t)) / (2 * curvature);
for (const t of nonlinear)
  for (const s of t.samples) {
    s.x = 0.3 + 0.25 * feature(t.target.x);
    s.y = 0.3 + 0.25 * feature(t.target.y);
  }
const result = fit(nonlinear),
  model = result.models.left!;
assert.equal(result.verdict, 'VALID', result.reasons.join(','));
assert.equal(model.family, 'quadratic-ridge');
assert.ok(calibrationUsable(result, SYNTHETIC_CONTEXT, 1000));
const points = nonlinear
  .filter((t) => t.target.role === 'fit')
  .map((t) => ({
    x: t.samples[0].x!,
    y: t.samples[0].y!,
    targetX: t.target.x,
    targetY: t.target.y,
  }));
const affine = fitRegression(points, { family: 'affine', lambda: 0 })!;
assert.ok(regressionRmse(affine, points) > 0.08);
assert.ok(model.fitRmse < 0.001 && model.fitCvRmse < 0.001 && model.validationRmse < 0.001);
for (const t of nonlinear) {
  const mapped = mapCalibration(result, t.samples[0], SYNTHETIC_CONTEXT, 1000)!;
  assert.ok(mapped && Math.hypot(mapped.x - t.target.x, mapped.y - t.target.y) < 0.001);
}

// A held-out failure must NOT select another family/lambda or alter coefficients.
const before = selectRegression(points).selected!;
for (const t of nonlinear)
  if (t.target.role === 'validation') for (const s of t.samples) s.x! += 0.1;
const shifted = fit(nonlinear);
assert.equal(shifted.verdict, 'RETRY');
assert.equal(shifted.models.left!.family, model.family);
assert.equal(shifted.models.left!.lambda, model.lambda);
assert.equal(
  JSON.stringify(shifted.models.left!.coefficientsX),
  JSON.stringify(model.coefficientsX),
);
assert.ok(Math.abs(shifted.models.left!.fitCvRmse - before.fitCvRmse) < 1e-12);
assert.equal(mapCalibration(shifted, nonlinear[0].samples[0], SYNTHETIC_CONTEXT, 1000), null);

// Exact Jacobian extrema reject folds/flat spots even when corner determinants
// have the same positive sign. Mirrors with a constant negative sign are valid.
const quadratic = (x: number[], y: number[]): GazeRegression => ({
  family: 'quadratic-ridge',
  lambda: 0.001,
  featureCenter: { x: 0, y: 0 },
  featureScale: { x: 1, y: 1 },
  coefficientsX: x,
  coefficientsY: y,
});
const box = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
assert.equal(regressionGeometrySafe(quadratic([0, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 0]), box), false);
assert.equal(
  regressionGeometrySafe(quadratic([0, 0, 0, 1, 0, -1], [0, 0, 0, 0, 2, 0]), box),
  false,
);
assert.equal(
  regressionGeometrySafe(quadratic([0, 1, 0, 1, 0, -1], [0, 0, -1, 0, 2, 0]), box),
  false,
);
assert.equal(regressionGeometrySafe(quadratic([0, -1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0]), box), true);

// Saved metadata/coefficients/bounds/frame quality cannot silently regain VALID.
for (const mutate of [
  (r: typeof linear) => {
    delete (r as Partial<typeof r>).modelVersion;
  },
  (r: typeof linear) => {
    r.models.left!.lambda = 123;
  },
  (r: typeof linear) => {
    r.models.left!.featureCenter.x += 0.01;
  },
  (r: typeof linear) => {
    r.models.left!.featureScale.x *= 2;
  },
  (r: typeof linear) => {
    r.models.left!.coefficientsX.push(0);
  },
  (r: typeof linear) => {
    r.models.left!.featureBounds.maxX += 0.1;
  },
  (r: typeof linear) => {
    r.models.left!.fitCvRmse = 0.09;
  },
  (r: typeof linear) => {
    r.targetQuality.find((q) => q.validationFrames)!.validationFrames!.rmse = 0.1;
  },
  (r: typeof linear) => {
    delete r.targetQuality.find((q) => q.validationFrames)!.validationFrames;
  },
]) {
  const r = fit();
  mutate(r);
  assert.equal(calibrationUsable(r, SYNTHETIC_CONTEXT, 1000), false);
}
const snapshot = createCalibrationMapper(result, SYNTHETIC_CONTEXT, 1000);
const sample = syntheticCalibrationTakes()[4].samples[0];
const normalized = evaluateRegression(model, sample.x!, sample.y!);
assert.ok(Number.isFinite(normalized.x));
const prior = snapshot(nonlinear[0].samples[0]);
result.models.left!.featureScale.x *= 10;
assert.equal(JSON.stringify(snapshot(nonlinear[0].samples[0])), JSON.stringify(prior));
assert.equal(
  createCalibrationMapper(result, SYNTHETIC_CONTEXT, 1000)(nonlinear[0].samples[0]),
  null,
);

console.log(
  JSON.stringify({
    calibrationRegressionChecks: 'PASS',
    simulationOnly: true,
    affineFitRmse: regressionRmse(affine, points),
    quadraticFitRmse: model.fitRmse,
    quadraticCvRmse: model.fitCvRmse,
    quadraticValidationRmse: model.validationRmse,
  }),
);
