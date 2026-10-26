import { CALIBRATION_POLICY } from './calibration';
import { calibrationProgress } from './progress';
import { CALIBRATION_TARGETS } from './protocol';
import { evaluateRegression, regressionRmse, selectRegression } from './regression';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Uses the SAME fit-target-only selector as production. Reporting the five
 * held-out errors never changes selection. No coefficients/features exported. */
export function calibrationModelComparison(value: unknown) {
  const result = record(value),
    progress = calibrationProgress(value);
  const rows: unknown[] = Array.isArray(result.targetQuality) ? result.targetQuality : [];
  return progress.eyes.map((eye) => {
    const empty = { eye: eye.eye, selectedByFitCv: null, candidates: [] };
    if (!progress.versionCurrent)
      return { ...empty, status: 'LEGACY_OR_MISSING_MEASUREMENTS' as const };
    if (eye.samples.passed !== CALIBRATION_TARGETS.length)
      return { ...empty, status: 'BLOCKED_SAMPLE_QUALITY' as const };
    if (
      Array.isArray(result.reasons) &&
      result.reasons.some(
        (r) => r === `DEGENERATE_FEATURES:${eye.eye}` || r === `SINGULAR_FIT:${eye.eye}`,
      )
    )
      return { ...empty, status: 'BLOCKED_FEATURE_GEOMETRY' as const };
    const points = CALIBRATION_TARGETS.flatMap((target) => {
      const q = rows.map(record).find((q) => q.eyeSide === eye.eye && q.targetId === target.id)!;
      if (!finite(q.x) || !finite(q.y) || q.x < -0.25 || q.x > 1.25 || q.y < -0.25 || q.y > 1.25)
        return [];
      return [{ x: q.x, y: q.y, targetX: target.x, targetY: target.y, role: target.role }];
    });
    if (points.length !== CALIBRATION_TARGETS.length)
      return { ...empty, status: 'MISSING_FEATURES' as const };
    const fit = points.filter((p) => p.role === 'fit'),
      validation = points.filter((p) => p.role === 'validation');
    const selection = selectRegression(fit);
    return {
      eye: eye.eye,
      status: selection.selected ? ('FIT_TARGET_CV' as const) : ('UNFIT' as const),
      selectedByFitCv: selection.selected
        ? {
            model: selection.selected.regression.family,
            lambda: selection.selected.regression.lambda,
          }
        : null,
      candidates: selection.candidates.map((c) => {
        const checks = validation.map((p) => {
          const v = evaluateRegression(c.regression, p.x, p.y);
          return Math.hypot(v.x - p.targetX, v.y - p.targetY);
        });
        const validationRmse = regressionRmse(c.regression, validation),
          validationMaxError = Math.max(...checks);
        return {
          model: c.regression.family,
          lambda: c.regression.lambda,
          fitCvRmse: c.fitCvRmse,
          fitRmse: c.fitRmse,
          geometrySafe: c.geometrySafe,
          validationRmse,
          validationMaxError,
          errorGatesPass:
            c.geometrySafe &&
            c.fitCvRmse <= CALIBRATION_POLICY.maxFitCvRmse &&
            c.fitRmse <= CALIBRATION_POLICY.maxFitRmse &&
            validationRmse <= CALIBRATION_POLICY.maxValidationRmse &&
            validationMaxError <= CALIBRATION_POLICY.maxValidationError,
        };
      }),
    };
  });
}
