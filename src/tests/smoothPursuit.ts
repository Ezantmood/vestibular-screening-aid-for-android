import { defaultStimulus } from './stimulus/engine';
import { continuous, joinEye, rapidMovements, testQuality, TEST_POLICY } from './metrics/quality';
import type { EyeTestInput, PursuitEyeResult } from './metrics/types';

export const SMOOTH_PURSUIT_ID = 'smooth-pursuit' as const;
export const createStimulus = () => defaultStimulus(SMOOTH_PURSUIT_ID);

/** Weighted harmonic regression y = offset + a*cos(wt) + b*sin(wt).
 * Fitting both phases avoids turning an unknown constant exposure offset into gain loss. */
function harmonic(points: { t: number; y: number; weight: number }[], omega: number) {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const p of points) {
    const row = [1, Math.cos(omega * p.t), Math.sin(omega * p.t)];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += p.weight * row[i] * row[j];
      matrix[i][3] += p.weight * row[i] * p.y;
    }
  }
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    if (Math.abs(matrix[pivot][i]) < 1e-9) return null;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const scale = matrix[i][i];
    for (let j = i; j < 4; j++) matrix[i][j] /= scale;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = matrix[k][i];
      for (let j = i; j < 4; j++) matrix[k][j] -= f * matrix[i][j];
    }
  }
  const [offset, a, b] = matrix.map((row) => row[3]);
  const totalWeight = points.reduce((sum, p) => sum + p.weight, 0);
  const rmse = Math.sqrt(
    points.reduce(
      (sum, p) =>
        sum +
        p.weight * (p.y - offset - a * Math.cos(omega * p.t) - b * Math.sin(omega * p.t)) ** 2,
      0,
    ) / totalWeight,
  );
  return { amplitude: Math.hypot(a, b), rmse };
}

export function analyzeSmoothPursuit(
  input: EyeTestInput,
  eyeSide: 'left' | 'right',
): PursuitEyeResult {
  const joined = joinEye(input);
  const quality = testQuality(input, joined);
  const result: PursuitEyeResult = {
    eyeSide,
    quality,
    pursuitGain: null,
    gainSupportMs: 0,
    gainFitRmsePerSecond: null,
    trackingRmse: null,
    rapidMovementCandidates: [],
    catchUpCandidateCount: null,
    excludedRapidIntervals: 0,
  };
  if (quality.status === 'INVALID') return result;
  const omega = (2 * Math.PI * 1_000_000) / input.session.config.pursuitPeriodUs;
  const targetPoints = input.session.presentations.map((p, i, ps) => ({
    t: p.elapsedUs / 1_000_000,
    y: p.x,
    weight: ((ps[i + 1]?.elapsedUs ?? input.session.config.durationUs) - p.elapsedUs) / 1_000_000,
  }));
  const targetFit = harmonic(targetPoints, omega);
  if (!targetFit || targetFit.amplitude < input.session.config.amplitude * 0.5) {
    quality.status = 'INVALID';
    quality.reasons.push('INSUFFICIENT_TARGET_MOTION');
    return result;
  }
  const targetPeakVelocity = targetFit.amplitude * omega;
  const threshold = Math.max(TEST_POLICY.rapidVelocityPerSecond, targetPeakVelocity * 2.5);
  result.rapidMovementCandidates = rapidMovements(joined, threshold);
  result.catchUpCandidateCount = result.rapidMovementCandidates.filter((event) => {
    const a = joined[event.startIndex];
    const b = joined[event.endIndex];
    const errorBefore = a.target.presented!.x - a.signal.processedX!;
    const errorAfter = b.target.presented!.x - b.signal.processedX!;
    return (
      event.displacement * errorBefore > 0 && Math.abs(errorBefore) - Math.abs(errorAfter) > 0.01
    );
  }).length;
  let squaredError = 0;
  let errorWeight = 0;
  const points: { t: number; y: number; weight: number }[] = [];
  const phaseSupport = [0, 0, 0, 0];
  for (let i = 1; i < joined.length; i++) {
    const a = joined[i - 1];
    const b = joined[i];
    if (!continuous(a, b)) continue;
    const dt = b.signal.velocityDtUs!;
    squaredError +=
      dt *
      ((b.signal.processedX! - b.target.presented!.x) ** 2 +
        (b.signal.processedY! - b.target.presented!.y) ** 2);
    errorWeight += dt;
    // Exclude every fast interval, including truncated candidates, plus event margins.
    const midPts = (a.signal.raw.decodedPtsUs! + b.signal.raw.decodedPtsUs!) / 2;
    if (
      Math.abs(b.signal.velocityXPerSecond!) >= threshold ||
      result.rapidMovementCandidates.some(
        (e) =>
          midPts >= e.onsetPtsUs - TEST_POLICY.rapidMarginMs * 1000 &&
          midPts <= e.endPtsUs + TEST_POLICY.rapidMarginMs * 1000,
      )
    ) {
      result.excludedRapidIntervals++;
      continue;
    }
    const tUs = (a.target.elapsedUs! + b.target.elapsedUs!) / 2;
    points.push({ t: tUs / 1_000_000, y: b.signal.velocityXPerSecond!, weight: dt / 1_000_000 });
    phaseSupport[
      Math.floor(
        ((tUs % input.session.config.pursuitPeriodUs) * 4) / input.session.config.pursuitPeriodUs,
      )
    ] += dt;
    result.gainSupportMs += dt / 1000;
  }
  result.trackingRmse = errorWeight ? Math.sqrt(squaredError / errorWeight) : null;
  const fit = harmonic(points, omega);
  if (
    result.gainSupportMs < TEST_POLICY.minGainSupportMs ||
    phaseSupport.some((s) => s < 100_000) ||
    !fit
  ) {
    quality.status = 'INVALID';
    quality.reasons.push('INSUFFICIENT_SMOOTH_SUPPORT');
    result.trackingRmse = null;
    result.catchUpCandidateCount = null;
    return result;
  }
  result.pursuitGain = fit.amplitude / targetPeakVelocity;
  result.gainFitRmsePerSecond = fit.rmse;
  return result;
}
