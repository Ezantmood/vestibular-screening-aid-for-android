import { matchFrame } from '../stimulus/synchronization';
import { targetAt } from '../stimulus/engine';
import type { EyeTestInput, JoinedEyeSample, RapidMovement, TestQuality } from './types';

/** Engineering detection/support gates in viewport units, never clinical cutoffs. */
export const TEST_POLICY = {
  minCoverage: 0.5,
  goodCoverage: 0.8,
  goodConfidence: 0.55,
  minTemporalCoverage: 0.45,
  goodTemporalCoverage: 0.75,
  maxGoodGapMs: 150,
  maxPresentationGapMs: 100,
  rapidVelocityPerSecond: 1,
  rapidMinDurationMs: 10,
  rapidMaxDurationMs: 150,
  rapidMinDisplacement: 0.02,
  rapidMarginMs: 40,
  minGainSupportMs: 2000,
  baselineMs: 200,
  minBaselineSpanMs: 100,
  maxBaselineSpread: 0.04,
  maxBaselineTargetError: 0.1,
  minResponseLatencyMs: 80,
  maxResponseLatencyMs: 600,
  endpointHoldMs: 40,
  maxEndpointSpread: 0.025,
  maxResponseDurationMs: 200,
  maxSaccadeIntervalMs: 25,
} as const;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
export function joinEye(input: EyeTestInput): JoinedEyeSample[] {
  return (input.signal?.samples ?? []).map((signal) => ({
    signal,
    target: matchFrame(input.session, signal.raw.decodedPtsUs, input.bridge, input.anchor),
  }));
}
export function continuous(a: JoinedEyeSample, b: JoinedEyeSample): boolean {
  return (
    a.signal.usable &&
    b.signal.usable &&
    b.signal.velocityUsable &&
    a.signal.segmentId === b.signal.segmentId &&
    b.signal.raw.frameIndex === a.signal.raw.frameIndex + 1 &&
    a.target.presented !== null &&
    b.target.presented !== null &&
    a.target.elapsedUs !== null &&
    b.target.elapsedUs !== null &&
    ['matched', 'estimated'].includes(a.target.status) &&
    ['matched', 'estimated'].includes(b.target.status)
  );
}
export function testQuality(input: EyeTestInput, joined: JoinedEyeSample[]): TestQuality {
  const reasons: string[] = [];
  const { session, signal, anchor, bridge } = input;
  if (!input.calibrationValid || !signal || signal.options.coordinateSpace !== 'screen-normalized')
    reasons.push('MISSING_CALIBRATION');
  if (
    session.outcome !== 'completed' ||
    session.endJsUs === null ||
    session.endJsUs - session.startJsUs < session.config.durationUs
  )
    reasons.push('TEST_NOT_COMPLETED');
  if (!anchor || !bridge) reasons.push('UNSYNCHRONIZED');
  const ptsInvalid = signal?.samples.some((s) =>
    s.reasons.some((r) =>
      ['invalid-timestamp', 'nonmonotonic-timestamp', 'estimated-timestamp'].includes(r),
    ),
  );
  if (ptsInvalid) reasons.push('INVALID_PTS');
  const presentations = session.presentations;
  if (
    !presentations.length ||
    presentations.some(
      (p, i) =>
        ![p.x, p.y, p.elapsedUs, p.requestedElapsedUs].every(Number.isFinite) ||
        p.elapsedUs < 0 ||
        p.elapsedUs >= session.config.durationUs ||
        p.requestedElapsedUs > p.elapsedUs ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1 ||
        (i > 0 && p.elapsedUs <= presentations[i - 1].elapsedUs),
    )
  )
    reasons.push('INVALID_PRESENTATIONS');
  if (
    presentations.some((p) => {
      const expected = targetAt(session.config, p.requestedElapsedUs);
      return (
        !expected ||
        Math.abs(expected.x - p.x) > 1e-8 ||
        expected.y !== p.y ||
        expected.segment !== p.segment
      );
    })
  )
    reasons.push('INVALID_TARGET_TRAJECTORY');
  let maxCommitGap = presentations[0]?.elapsedUs ?? session.config.durationUs;
  for (let i = 1; i < presentations.length; i++)
    maxCommitGap = Math.max(
      maxCommitGap,
      presentations[i].elapsedUs - presentations[i - 1].elapsedUs,
    );
  maxCommitGap = Math.max(
    maxCommitGap,
    session.config.durationUs - (presentations.at(-1)?.elapsedUs ?? 0),
  );
  if (maxCommitGap > TEST_POLICY.maxPresentationGapMs * 1000) reasons.push('STALE_PRESENTATIONS');
  const inRun = joined.filter((s) =>
    ['matched', 'estimated', 'not-presented'].includes(s.target.status),
  );
  const accepted = inRun.filter((s) => s.signal.usable && s.target.presented !== null);
  const coverage = inRun.length ? accepted.length / inRun.length : 0;
  let supportUs = 0;
  const intervals: number[] = [];
  for (let i = 1; i < joined.length; i++) {
    if (!continuous(joined[i - 1], joined[i])) continue;
    const dt = joined[i].signal.velocityDtUs!;
    supportUs += dt;
    intervals.push(dt / 1000);
  }
  const temporalCoverage = supportUs / session.config.durationUs;
  let longestGapUs = 0;
  let previous = 0;
  for (const sample of accepted) {
    const t = sample.target.elapsedUs!;
    longestGapUs = Math.max(longestGapUs, t - previous);
    previous = t;
  }
  longestGapUs = Math.max(longestGapUs, session.config.durationUs - previous);
  if (coverage < TEST_POLICY.minCoverage || temporalCoverage < TEST_POLICY.minTemporalCoverage)
    reasons.push('INSUFFICIENT_SIGNAL');
  const invalid = reasons.some((r) => r !== 'STALE_PRESENTATIONS');
  const confidence = median(accepted.map((s) => s.signal.confidence));
  if (
    coverage < TEST_POLICY.goodCoverage ||
    temporalCoverage < TEST_POLICY.goodTemporalCoverage ||
    longestGapUs / 1000 > TEST_POLICY.maxGoodGapMs ||
    (confidence ?? 0) < TEST_POLICY.goodConfidence
  )
    reasons.push('LOW_TRACKING_QUALITY');
  if (anchor && (anchor.source === 'record-start-estimate' || anchor.uncertaintyUs === null))
    reasons.push('UNBOUNDED_EXPOSURE_OFFSET');
  return {
    status: invalid ? 'INVALID' : reasons.length ? 'POOR_DATA' : 'GOOD_DATA',
    reasons,
    totalFrames: inRun.length,
    usableFrames: accepted.length,
    coverage,
    temporalCoverage,
    medianConfidence: confidence,
    medianIntervalMs: median(intervals),
    longestGapMs: longestGapUs / 1000,
    reasonCounts: signal?.reasonCounts ?? {},
  };
}

/** Consecutive fast intervals with observed low-speed boundaries. No gap bridging. */
export function rapidMovements(joined: JoinedEyeSample[], threshold: number): RapidMovement[] {
  const out: RapidMovement[] = [];
  for (let i = 1; i < joined.length; i++) {
    const first = joined[i];
    if (!continuous(joined[i - 1], first) || Math.abs(first.signal.velocityXPerSecond!) < threshold)
      continue;
    const start = i - 1;
    const direction = Math.sign(first.signal.velocityXPerSecond!);
    let end = i;
    while (
      end + 1 < joined.length &&
      continuous(joined[end], joined[end + 1]) &&
      direction * joined[end + 1].signal.velocityXPerSecond! >= threshold
    )
      end++;
    const before = joined[start];
    const after = joined[end + 1];
    const durationMs =
      (joined[end].signal.raw.decodedPtsUs! - before.signal.raw.decodedPtsUs!) / 1000;
    const displacement = joined[end].signal.processedX! - before.signal.processedX!;
    if (
      before.signal.velocityUsable &&
      Math.abs(before.signal.velocityXPerSecond!) < threshold &&
      after &&
      continuous(joined[end], after) &&
      Math.abs(after.signal.velocityXPerSecond!) < threshold &&
      end - start >= 2 &&
      durationMs >= TEST_POLICY.rapidMinDurationMs &&
      durationMs <= TEST_POLICY.rapidMaxDurationMs &&
      Math.abs(displacement) >= TEST_POLICY.rapidMinDisplacement
    ) {
      const interval = joined.slice(start + 1, end + 1);
      out.push({
        startIndex: start,
        endIndex: end,
        onsetPtsUs: before.signal.raw.decodedPtsUs!,
        endPtsUs: joined[end].signal.raw.decodedPtsUs!,
        durationMs,
        displacement,
        peakVelocity: Math.max(...interval.map((s) => Math.abs(s.signal.velocityXPerSecond!))),
        rawPeakVelocity: Math.max(
          ...interval.map((s, n) => {
            const prev = joined[start + n].signal;
            return Math.abs(((s.signal.raw.x! - prev.raw.x!) * 1_000_000) / s.signal.velocityDtUs!);
          }),
        ),
      });
    }
    i = end;
  }
  return out;
}
