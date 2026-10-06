import { defaultStimulus, targetAt } from './stimulus/engine';
import { continuous, joinEye, median, testQuality, TEST_POLICY } from './metrics/quality';
import type {
  EyeTestInput,
  JoinedEyeSample,
  SaccadeEyeResult,
  SaccadeResponse,
} from './metrics/types';

export const HORIZONTAL_SACCADES_ID = 'horizontal-saccades' as const;
export const createStimulus = () => defaultStimulus(HORIZONTAL_SACCADES_ID);

function responseForStep(
  input: EyeTestInput,
  joined: JoinedEyeSample[],
  step: number,
): SaccadeResponse {
  const { session } = input;
  const fromX = targetAt(session.config, (step - 1) * session.config.saccadeHoldUs)!.x;
  const toX = targetAt(session.config, step * session.config.saccadeHoldUs)!.x;
  const commit = session.presentations.find((p) => p.segment === step);
  const response: SaccadeResponse = {
    step,
    targetCommitUs: commit?.elapsedUs ?? null,
    fromX,
    toX,
    status: 'INVALID',
    reason: null,
    onsetPtsUs: null,
    endPtsUs: null,
    latencyMs: null,
    estimatedLatencyMs: null,
    latencyUncertaintyMs: null,
    durationMs: null,
    peakVelocityPerSecond: null,
    rawPeakVelocityPerSecond: null,
    accuracy: null,
    endpointError: null,
    overshoot: null,
    undershoot: null,
  };
  const fail = (reason: SaccadeResponse['reason']) => ({ ...response, reason });
  if (!input.calibrationValid || !input.signal) return fail('MISSING_CALIBRATION');
  if (!commit || !session.presentations.some((p) => p.segment === step - 1))
    return fail('MISSING_TARGET_STEP');
  const nextCommit =
    session.presentations.find((p) => p.segment > step)?.elapsedUs ?? session.config.durationUs;
  const baseline = joined.filter(
    (s) =>
      s.target.elapsedUs !== null &&
      s.target.elapsedUs >= commit.elapsedUs - TEST_POLICY.baselineMs * 1000 &&
      s.target.elapsedUs < commit.elapsedUs,
  );
  if (
    baseline.length < 3 ||
    baseline.at(-1)!.target.elapsedUs! - baseline[0].target.elapsedUs! <
      TEST_POLICY.minBaselineSpanMs * 1000
  )
    return fail('INCOMPLETE_WINDOW');
  if (
    baseline.some(
      (s, i) =>
        !s.signal.usable ||
        s.target.presented?.segment !== step - 1 ||
        (i > 0 && !continuous(baseline[i - 1], s)),
    )
  )
    return fail('BLINK_OR_DROPOUT');
  const baseX = median(baseline.map((s) => s.signal.processedX!))!;
  if (
    Math.max(...baseline.map((s) => s.signal.processedX!)) -
      Math.min(...baseline.map((s) => s.signal.processedX!)) >
      TEST_POLICY.maxBaselineSpread ||
    Math.abs(baseX - fromX) > TEST_POLICY.maxBaselineTargetError ||
    baseline.some(
      (s) =>
        s.signal.velocityUsable &&
        Math.abs(s.signal.velocityXPerSecond!) >= TEST_POLICY.rapidVelocityPerSecond,
    )
  )
    return fail('UNSTABLE_BASELINE');
  const first = joined.indexOf(baseline.at(-1)!);
  let onset = -1;
  for (let i = first + 1; i < joined.length; i++) {
    const s = joined[i];
    if (s.target.elapsedUs === null || s.target.elapsedUs >= nextCommit) break;
    if (!continuous(joined[i - 1], s)) return fail('BLINK_OR_DROPOUT');
    if (Math.abs(s.signal.velocityXPerSecond!) < TEST_POLICY.rapidVelocityPerSecond) continue;
    const next = joined[i + 1];
    if (!next || !continuous(s, next)) return fail('BLINK_OR_DROPOUT');
    if (
      Math.sign(s.signal.velocityXPerSecond!) * next.signal.velocityXPerSecond! <
      TEST_POLICY.rapidVelocityPerSecond
    )
      continue;
    const duration =
      (next.signal.raw.decodedPtsUs! - joined[i - 1].signal.raw.decodedPtsUs!) / 1000;
    if (duration < TEST_POLICY.rapidMinDurationMs) continue;
    onset = i;
    break;
  }
  if (onset < 0) {
    const last = joined
      .filter((s) => s.target.elapsedUs !== null && s.target.elapsedUs < nextCommit)
      .at(-1);
    return fail(
      last && last.target.elapsedUs! - commit.elapsedUs >= TEST_POLICY.maxResponseLatencyMs * 1000
        ? 'NO_RESPONSE'
        : 'INCOMPLETE_WINDOW',
    );
  }
  const direction = Math.sign(toX - fromX);
  const start = joined[onset - 1];
  const apparentLatencyMs = (start.target.elapsedUs! - commit.elapsedUs) / 1000;
  if (direction * joined[onset].signal.velocityXPerSecond! <= 0) return fail('WRONG_DIRECTION');
  if (apparentLatencyMs < TEST_POLICY.minResponseLatencyMs) return fail('ANTICIPATORY_RESPONSE');
  if (apparentLatencyMs > TEST_POLICY.maxResponseLatencyMs) return fail('LATE_RESPONSE');
  let end = onset;
  while (end + 1 < joined.length) {
    const next = joined[end + 1];
    if (!continuous(joined[end], next)) return fail('BLINK_OR_DROPOUT');
    if (
      next.target.elapsedUs! >= nextCommit ||
      next.signal.raw.decodedPtsUs! - start.signal.raw.decodedPtsUs! >
        TEST_POLICY.maxResponseDurationMs * 1000
    )
      return fail('INCOMPLETE_RESPONSE');
    if (Math.abs(next.signal.velocityXPerSecond!) < TEST_POLICY.rapidVelocityPerSecond) break;
    if (direction * next.signal.velocityXPerSecond! <= 0) return fail('INCOMPLETE_RESPONSE');
    end++;
  }
  const endpoint: JoinedEyeSample[] = [joined[end]];
  for (let i = end + 1; i < joined.length; i++) {
    const prev = joined[i - 1];
    const next = joined[i];
    if (!continuous(prev, next)) return fail('BLINK_OR_DROPOUT');
    if (
      next.target.elapsedUs! >= nextCommit ||
      Math.abs(next.signal.velocityXPerSecond!) >= TEST_POLICY.rapidVelocityPerSecond
    )
      return fail('INCOMPLETE_RESPONSE');
    endpoint.push(next);
    if (
      next.signal.raw.decodedPtsUs! - joined[end].signal.raw.decodedPtsUs! >=
      TEST_POLICY.endpointHoldMs * 1000
    )
      break;
  }
  if (
    endpoint.at(-1)!.signal.raw.decodedPtsUs! - joined[end].signal.raw.decodedPtsUs! <
      TEST_POLICY.endpointHoldMs * 1000 ||
    Math.max(...endpoint.map((s) => s.signal.processedX!)) -
      Math.min(...endpoint.map((s) => s.signal.processedX!)) >
      TEST_POLICY.maxEndpointSpread
  )
    return fail('INCOMPLETE_RESPONSE');
  const movement = joined.slice(onset, end + 1);
  if (movement.some((s) => s.signal.velocityDtUs! > TEST_POLICY.maxSaccadeIntervalMs * 1000))
    return fail('INCOMPLETE_RESPONSE');
  const endpointX = median(endpoint.map((s) => s.signal.processedX!))!;
  const displacement = direction * (endpointX - baseX);
  if (displacement < TEST_POLICY.rapidMinDisplacement) return fail('INCOMPLETE_RESPONSE');
  const endpointError = direction * (endpointX - toX);
  const bounded = input.anchor?.source === 'measured-frame' && input.anchor.uncertaintyUs !== null;
  return {
    ...response,
    status: 'VALID',
    reason: null,
    onsetPtsUs: start.signal.raw.decodedPtsUs!,
    endPtsUs: joined[end].signal.raw.decodedPtsUs!,
    latencyMs: bounded ? apparentLatencyMs : null,
    estimatedLatencyMs: bounded ? null : apparentLatencyMs,
    latencyUncertaintyMs: bounded
      ? (input.anchor!.uncertaintyUs! +
          input.bridge!.roundTripUs / 2 +
          joined[onset].signal.velocityDtUs! +
          input.signal.options.halfWindowUs) /
        1000
      : null,
    durationMs: (joined[end].signal.raw.decodedPtsUs! - start.signal.raw.decodedPtsUs!) / 1000,
    peakVelocityPerSecond: Math.max(...movement.map((s) => Math.abs(s.signal.velocityXPerSecond!))),
    rawPeakVelocityPerSecond: Math.max(
      ...movement.map(
        (s, n) =>
          (Math.abs(s.signal.raw.x! - joined[onset + n - 1].signal.raw.x!) * 1_000_000) /
          s.signal.velocityDtUs!,
      ),
    ),
    accuracy: displacement / Math.abs(toX - fromX),
    endpointError,
    overshoot: Math.max(0, endpointError),
    undershoot: Math.max(0, -endpointError),
  };
}

export function analyzeHorizontalSaccades(
  input: EyeTestInput,
  eyeSide: 'left' | 'right',
): SaccadeEyeResult {
  const joined = joinEye(input);
  const quality = testQuality(input, joined);
  const expectedResponses = Math.max(
    0,
    Math.ceil(input.session.config.durationUs / input.session.config.saccadeHoldUs) - 1,
  );
  const responses = Array.from({ length: expectedResponses }, (_, i) => {
    const r = responseForStep(
      quality.status === 'INVALID' ? { ...input, calibrationValid: false } : input,
      joined,
      i + 1,
    );
    return quality.status === 'INVALID' && input.calibrationValid
      ? { ...r, reason: 'INVALID_TEST' as const }
      : r;
  });
  const valid = responses.filter((r) => r.status === 'VALID');
  const responseValidity = expectedResponses ? valid.length / expectedResponses : 0;
  if (valid.length === 0) {
    quality.status = 'INVALID';
    quality.reasons.push('NO_VALID_RESPONSES');
  } else if (responseValidity < 0.8 && quality.status !== 'INVALID') {
    quality.status = 'POOR_DATA';
    quality.reasons.push('LOW_RESPONSE_VALIDITY');
  }
  const values = (key: keyof SaccadeResponse) =>
    valid.map((r) => r[key]).filter((x): x is number => typeof x === 'number');
  return {
    eyeSide,
    quality,
    expectedResponses,
    validResponses: valid.length,
    responseValidity,
    responses,
    medianLatencyMs: median(values('latencyMs')),
    medianEstimatedLatencyMs: median(values('estimatedLatencyMs')),
    medianPeakVelocityPerSecond: median(values('peakVelocityPerSecond')),
    medianAccuracy: median(values('accuracy')),
    medianOvershoot: median(values('overshoot')),
    medianUndershoot: median(values('undershoot')),
  };
}
