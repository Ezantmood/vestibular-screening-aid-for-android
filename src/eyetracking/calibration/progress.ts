import { CALIBRATION_POLICY, calibrationUsable } from './calibration';
import { CALIBRATION_TARGETS } from './protocol';
import {
  CALIBRATION_MODEL_VERSION,
  currentPupilMeasurement,
  type CalibrationResult,
} from './types';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
type Gate = boolean | null;
function rate(gates: Gate[]) {
  const passed = gates.filter((g) => g === true).length;
  const evaluated = gates.filter((g) => g !== null).length;
  return {
    passed,
    evaluated,
    total: gates.length,
    // Missing evidence never shrinks the denominator or counts as success.
    percent: evaluated ? Math.round((1000 * passed) / gates.length) / 10 : null,
  };
}

/** One bundled sample-quality gate per target/eye, plus six mapping gates per
 * eye: 28 + 12 = 40. Legacy v1 results retain their 34-item rubric. NOT gaze accuracy,
 * probability of success, or permission to use a model. No learned weights. */
export function calibrationProgress(value: unknown) {
  const result = record(value);
  const rows: unknown[] = Array.isArray(result.targetQuality) ? result.targetQuality : [];
  const models = record(result.models);
  const modelVersionCurrent = result.modelVersion === CALIBRATION_MODEL_VERSION;
  const eyes = (['left', 'right'] as const).map((eye) => {
    const sampleGates = CALIBRATION_TARGETS.map((target): Gate => {
      const matches = rows.map(record).filter((q) => q.eyeSide === eye && q.targetId === target.id);
      if (matches.length !== 1) return matches.length ? false : null;
      const q = matches[0];
      if (
        !finite(q.total) ||
        !Number.isInteger(q.total) ||
        q.total <= 0 ||
        !finite(q.accepted) ||
        !Number.isInteger(q.accepted) ||
        q.accepted < 0 ||
        q.accepted > q.total ||
        !finite(q.coverage) ||
        Math.abs(q.coverage - q.accepted / q.total) > 1e-12 ||
        !Array.isArray(q.reasons)
      )
        return false;
      if (
        q.reasons.length ||
        q.accepted < CALIBRATION_POLICY.minSamples ||
        q.coverage < CALIBRATION_POLICY.minCoverage
      )
        return false;
      if (!finite(q.spanUs) || !finite(q.spread)) return null;
      return (
        q.spanUs >= CALIBRATION_POLICY.minSpanUs &&
        q.spread >= 0 &&
        q.spread <= CALIBRATION_POLICY.maxSpread
      );
    });
    const model = record(models[eye]);
    const modelGates = [
      [model.fitRmse, CALIBRATION_POLICY.maxFitRmse],
      [model.validationRmse, CALIBRATION_POLICY.maxValidationRmse],
      [model.validationMaxError, CALIBRATION_POLICY.maxValidationError],
      ...(modelVersionCurrent
        ? [
            [model.fitCvRmse, CALIBRATION_POLICY.maxFitCvRmse],
            [model.validationFrameRmse, CALIBRATION_POLICY.maxValidationFrameRmse],
            [model.validationFrameP95Error, CALIBRATION_POLICY.maxValidationFrameP95Error],
          ]
        : []),
    ].map(([value, limit]): Gate =>
      finite(value) && finite(limit) && value >= 0 ? value <= limit : null,
    );
    return {
      eye,
      samples: rate(sampleGates),
      mapping: rate(modelGates),
      all: rate([...sampleGates, ...modelGates]),
    };
  });
  const passed = eyes.reduce((s, e) => s + e.all.passed, 0);
  const evaluated = eyes.reduce((s, e) => s + e.all.evaluated, 0);
  const total = eyes.reduce((s, e) => s + e.all.total, 0);
  const typed = value as CalibrationResult;
  return {
    schema: modelVersionCurrent
      ? ('calibration-gates-v2' as const)
      : ('calibration-gates-v1' as const),
    meaning: 'engineering-gate-pass-rate' as const,
    versionCurrent: currentPupilMeasurement(record(result.context).coordinateVersion),
    modelVersionCurrent,
    usableAtCreation: calibrationUsable(typed, typed?.context, typed?.createdAtMs),
    overall: {
      passed,
      evaluated,
      total,
      percent: evaluated ? Math.round((1000 * passed) / total) / 10 : null,
    },
    eyes,
  };
}

export function calibrationProgressText(value: unknown): string {
  const score = calibrationProgress(value);
  if (score.overall.percent === null) return 'Chưa đủ dữ liệu để tính điểm tiêu chí hiệu chỉnh.';
  const { passed, evaluated, total, percent } = score.overall;
  return `Điểm tiêu chí kỹ thuật: ${percent}/100 (${passed}/${total} đạt; ${total - evaluated} chưa đo). Đây không phải % độ chính xác nhìn. ${score.versionCurrent && score.modelVersionCurrent ? '' : 'Dữ liệu/model phiên bản cũ; cần đo lại. '}${score.usableAtCreation ? 'Model đạt kiểm tra lúc lưu; khi dùng vẫn phải kiểm tra thời hạn và bối cảnh.' : 'Chưa đủ điều kiện sử dụng ánh xạ.'}`;
}

/** Recompute ratios from bounded counts, never trust a saved percentage. */
export function calibrationFrameSummary(value: unknown, expectedAccepted: unknown) {
  const v = record(value);
  if (
    !finite(v.accepted) ||
    !Number.isInteger(v.accepted) ||
    v.accepted <= 0 ||
    v.accepted > 1e12 ||
    v.accepted !== expectedAccepted ||
    !finite(v.withinTolerance) ||
    !Number.isInteger(v.withinTolerance) ||
    v.withinTolerance < 0 ||
    v.withinTolerance > v.accepted ||
    !finite(v.rmse) ||
    v.rmse < 0 ||
    v.rmse > 1e12 ||
    !finite(v.p95Error) ||
    v.p95Error < 0 ||
    v.p95Error > 1e12
  )
    return null;
  return {
    accepted: v.accepted,
    withinTolerance: v.withinTolerance,
    withinTolerancePercent: (100 * v.withinTolerance) / v.accepted,
    rmse: v.rmse,
    p95Error: v.p95Error,
  };
}

export function calibrationFrameProgress(value: unknown) {
  const result = record(value);
  const rows: unknown[] = Array.isArray(result.targetQuality) ? result.targetQuality : [];
  const checks = CALIBRATION_TARGETS.filter((t) => t.role === 'validation');
  return (['left', 'right'] as const).map((eye) => {
    const frames = checks.flatMap((target) => {
      const matches = rows.map(record).filter((q) => q.eyeSide === eye && q.targetId === target.id);
      if (matches.length !== 1) return [];
      const q = matches[0],
        f = calibrationFrameSummary(q.validationFrames, q.accepted);
      if (
        !f ||
        !finite(q.total) ||
        !Number.isInteger(q.total) ||
        q.total < f.accepted ||
        q.total > 1e12
      )
        return [];
      return [{ ...f, total: q.total }];
    });
    const accepted = frames.reduce((s, f) => s + f.accepted, 0);
    const total = frames.reduce((s, f) => s + f.total, 0);
    const withinTolerance = frames.reduce((s, f) => s + f.withinTolerance, 0);
    return {
      eye,
      measuredTargets: frames.length,
      totalTargets: checks.length,
      accepted,
      total,
      withinTolerance,
      acceptedCoveragePercent: total ? (100 * accepted) / total : null,
      withinTolerancePercent: accepted ? (100 * withinTolerance) / accepted : null,
      tolerance: CALIBRATION_POLICY.maxValidationRmse,
      rmse: accepted
        ? Math.sqrt(frames.reduce((s, f) => s + f.rmse ** 2 * f.accepted, 0) / accepted)
        : null,
    };
  });
}
