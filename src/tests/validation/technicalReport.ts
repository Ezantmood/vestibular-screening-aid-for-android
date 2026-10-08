import type { CalibrationResult, CalibrationContext } from '../../eyetracking/calibration/types';
import { CALIBRATION_POLICY, calibrationUsable } from '../../eyetracking/calibration/calibration';
import { CALIBRATION_TARGETS } from '../../eyetracking/calibration/protocol';
import { TEST_POLICY } from '../metrics/quality';
import { SELF_CHECK_IDS, type SelfCheckResult } from './selfChecks';

import { VALIDATION_FAILURE_CODES, type ValidationFailure } from './failures';

export const BATCH3_BUILD = 'batch3-20261008-r1';
export const NATIVE_CHECK_IDS = [
  'native-component-isolation-percentile-dark',
  'native-center-percentile-dark',
  'native-component-isolation-contrast-normalized',
  'native-center-contrast-normalized',
  'native-missing-is-null',
  'native-hinted-isolation',
  'native-invalid-geometry',
] as const;
export type NativeCheckResult = {
  id: (typeof NATIVE_CHECK_IDS)[number];
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
};
const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const number = (v: unknown, min = 0, max = 1e12) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const side = (v: unknown) => (v === 'left' || v === 'right' ? v : null);
const calReasons = new Set([
  'INVALID_CONTEXT',
  'INCOMPLETE_SEQUENCE',
  'INVALID_SEQUENCE_ORDER',
  'INVALID_TARGET',
  'INVALID_HOLD_CLOCK',
  'TARGET_NOT_HELD',
  'INVALID_PTS',
  'INSUFFICIENT_COVERAGE',
  'INVALID_PTS_SPAN',
  'UNSTABLE_FIXATION',
  'HEAD_OR_ROI_MOVED',
  'MISSING_TARGET_FEATURES',
  'DEGENERATE_FEATURES',
  'SINGULAR_FIT',
  'POOR_FIT',
  'POOR_VALIDATION',
]);
const testReasons = new Set([
  'TEST_NOT_COMPLETED',
  'UNSYNCHRONIZED',
  'INVALID_PTS',
  'INVALID_PRESENTATIONS',
  'INVALID_TARGET_TRAJECTORY',
  'STALE_PRESENTATIONS',
  'INSUFFICIENT_SIGNAL',
  'LOW_TRACKING_QUALITY',
  'UNBOUNDED_EXPOSURE_OFFSET',
  'INSUFFICIENT_TARGET_MOTION',
  'INSUFFICIENT_SMOOTH_SUPPORT',
  'NO_VALID_RESPONSES',
  'LOW_RESPONSE_VALIDITY',
  'MISSING_CALIBRATION',
  'INVALID_TEST',
  'MISSING_TARGET_STEP',
  'INCOMPLETE_WINDOW',
  'BLINK_OR_DROPOUT',
  'UNSTABLE_BASELINE',
  'NO_RESPONSE',
  'WRONG_DIRECTION',
  'ANTICIPATORY_RESPONSE',
  'LATE_RESPONSE',
  'INCOMPLETE_RESPONSE',
  'INSUFFICIENT_COVERAGE',
  'LOW_CONFIDENCE',
  'LONG_DROPOUT',
  'INSUFFICIENT_TEMPORAL_COVERAGE',
  'UNBOUNDED_SYNCHRONIZATION',
  'MISSING_SYNCHRONIZATION',
  'INVALID_SYNCHRONIZATION',
  'INCOMPLETE_STIMULUS',
  'PRESENTATION_GAPS',
  'INVALID_SIGNAL',
  'INSUFFICIENT_GAIN_SUPPORT',
  'POOR_RESPONSE_VALIDITY',
]);
/** Never pass through arbitrary errors, paths, IDs or free text. */
function reasons(v: unknown, allowed: Set<string>): string[] {
  return [
    ...new Set(
      list(v).map((r) => {
        const tokens = typeof r === 'string' ? r.split(':') : [];
        const code = tokens.find((t) => allowed.has(t));
        return code ?? 'UNRECOGNIZED_REASON';
      }),
    ),
  ].slice(0, 40);
}
const knownTarget = (v: unknown) => CALIBRATION_TARGETS.find((t) => t.id === v)?.id ?? null;
export function parseLocalEvidence(json: string | null): unknown {
  try {
    return json === null ? null : (JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

export function calibrationTechnicalSummary(artifact: unknown) {
  const a = record(artifact),
    r = record(a.result),
    context = record(r.context),
    models = record(r.models);
  // Validate structural/model/quality gates at the saved creation time; this
  // does not activate the model or replace the workflow's capture-time check.
  const modelChecksPass = calibrationUsable(
    r as unknown as CalibrationResult,
    context as unknown as CalibrationContext,
    number(r.createdAtMs, 0, Number.MAX_SAFE_INTEGER) ?? NaN,
  );
  const versionCurrent = context.coordinateVersion === 'decoded-roi-v2';
  const verdict = r.verdict === 'VALID' || r.verdict === 'RETRY' ? r.verdict : 'UNAVAILABLE';
  const targets = list(r.targetQuality)
    .slice(0, 28)
    .map((value) => {
      const q = record(value);
      return {
        target: knownTarget(q.targetId),
        eye: side(q.eyeSide),
        total: number(q.total),
        accepted: number(q.accepted),
        coverage: number(q.coverage, 0, 1),
        spread: number(q.spread, 0, 2),
        reasons: reasons(q.reasons, calReasons),
      };
    })
    .filter((q) => q.eye && q.target);
  const savedStages = list(a.diagnostics);
  const fallbackStages = list(a.replays).flatMap((value) => {
    const replay = record(value);
    return (['left', 'right'] as const).map((eye) => {
      const raw = list(replay.rawResults)
        .map(record)
        .filter((r) => r.eyeSide === eye);
      const tracked = list(replay.tracked)
        .map(record)
        .filter((t) => t.eyeSide === eye);
      const success = raw.filter(
        (r) => r.failureReason === null && number(r.centroidXInFrame) !== null,
      );
      const observed = tracked.filter((t) => number(t.trackedCentroidX) !== null);
      const eligible = observed.filter(
        (t) => (number(t.trackingConfidence, 0, 1) ?? 0) >= CALIBRATION_POLICY.minConfidence,
      );
      const q = targets.find((q) => q.target === replay.condition && q.eye === eye);
      return {
        target: replay.condition,
        eye,
        total: raw.length,
        detectorSuccess: success.length,
        detectorConfident: success.filter(
          (r) => (number(r.confidence, 0, 1) ?? 0) >= CALIBRATION_POLICY.minConfidence,
        ).length,
        tracked: observed.length,
        gateRejected: tracked.filter((t) => t.gateRejected === true).length,
        trackedConfident: eligible.length,
        rejectedAfterConfidence: Math.max(0, eligible.length - (q?.accepted ?? 0)),
        accepted: q?.accepted ?? 0,
      };
    });
  });
  const stageCounts = (savedStages.length ? savedStages : fallbackStages)
    .slice(0, 28)
    .map((value) => {
      const d = record(value);
      return {
        target: knownTarget(d.target),
        eye: side(d.eye),
        total: number(d.total),
        detectorSuccess: number(d.detectorSuccess),
        detectorConfident: number(d.detectorConfident),
        tracked: number(d.tracked),
        gateRejected: number(d.gateRejected),
        trackedConfident: number(d.trackedConfident),
        rejectedAfterConfidence: number(d.rejectedAfterConfidence),
        accepted: number(d.accepted),
      };
    })
    .filter((d) => d.eye && d.target);
  return {
    verdict,
    versionCurrent,
    modelChecksPass,
    reasons: reasons(r.reasons, calReasons),
    targetCount: list(a.takes).length,
    decodedFrames: list(a.replays).reduce<number>(
      (sum, value) => sum + (number(record(value).decodedFrames) ?? 0),
      0,
    ),
    eyes: (['left', 'right'] as const).map((eye) => {
      const rows = targets.filter((q) => q.eye === eye),
        m = record(models[eye]);
      const total = rows.reduce((s, q) => s + (q.total ?? 0), 0),
        accepted = rows.reduce((s, q) => s + (q.accepted ?? 0), 0);
      return {
        eye,
        total,
        accepted,
        coverage: total > 0 ? accepted / total : null,
        passingTargets: rows.filter((q) => q.reasons.length === 0).length,
        modelPresent: Object.keys(m).length > 0,
        fitRmse: number(m.fitRmse),
        validationRmse: number(m.validationRmse),
        validationMaxError: number(m.validationMaxError),
      };
    }),
    targets,
    stageCounts,
  };
}
/** Reliable metrics are absent unless the entire test is GOOD_DATA and the workflow
 * established a current VALID calibration. Estimates stay local in the debug panel. */
function eyeTestTechnicalSummary(value: unknown, calibrationConfirmed: boolean) {
  const r = record(value);
  const status = ['GOOD_DATA', 'POOR_DATA', 'INVALID'].includes(String(r.status))
    ? String(r.status)
    : 'NOT_RUN';
  const sync = record(r.synchronization);
  const publish =
    calibrationConfirmed &&
    status === 'GOOD_DATA' &&
    sync.source === 'measured-frame' &&
    number(sync.uncertaintyMs) !== null;
  const metric = (v: unknown) => (publish ? number(v) : null);
  return {
    status: calibrationConfirmed || status === 'NOT_RUN' ? status : 'INVALID',
    reliableMetrics: publish,
    reasons: reasons(r.reasons, testReasons),
    synchronization: {
      physicalOnsetMeasured: false,
      source:
        record(r.synchronization).source === 'measured-frame'
          ? 'measured-frame'
          : 'unbounded-or-unavailable',
      uncertaintyMs: number(record(r.synchronization).uncertaintyMs),
    },
    pursuit: list(r.pursuit)
      .slice(0, 2)
      .map((v) => {
        const e = record(v);
        return {
          eye: side(e.eyeSide),
          coverage: number(record(e.quality).coverage, 0, 1),
          pursuitGain: metric(e.pursuitGain),
          trackingRmse: metric(e.trackingRmse),
          catchUpCandidates: metric(e.catchUpCandidateCount),
        };
      }),
    saccades: list(r.saccades)
      .slice(0, 2)
      .map((v) => {
        const e = record(v);
        return {
          eye: side(e.eyeSide),
          coverage: number(record(e.quality).coverage, 0, 1),
          expectedResponses: number(e.expectedResponses),
          validResponses: number(e.validResponses),
          failures: reasons(
            list(e.responses)
              .map((v) => record(v).reason)
              .filter(Boolean),
            testReasons,
          ),
          latencyMs: metric(e.medianLatencyMs),
          peakVelocityPerSecond: metric(e.medianPeakVelocityPerSecond),
          accuracy: metric(e.medianAccuracy),
          overshoot: metric(e.medianOvershoot),
          undershoot: metric(e.medianUndershoot),
        };
      }),
  };
}
export function buildTechnicalReport(args: {
  selfChecks?: readonly SelfCheckResult[];
  nativeChecks?: readonly NativeCheckResult[];
  calibrationArtifact?: unknown;
  pursuit?: unknown;
  saccades?: unknown;
  /** Only true for the in-memory workflow with matching calibration ID/context at capture. */
  calibrationConfirmed?: boolean;
  interrupted?: boolean;
  failures?: readonly ValidationFailure[];
}) {
  const calibration = calibrationTechnicalSummary(args.calibrationArtifact);
  const current =
    args.calibrationConfirmed === true &&
    calibration.versionCurrent &&
    calibration.modelChecksPass &&
    calibration.verdict === 'VALID';
  return {
    schemaVersion: 1,
    kind: 'batch3-technical-report',
    build: BATCH3_BUILD,
    privacy: {
      aggregateOnly: true,
      includesImages: false,
      includesVideo: false,
      includesIdentifiers: false,
      includesTrajectories: false,
    },
    selfChecks: SELF_CHECK_IDS.map((id) => ({
      id,
      status:
        args.selfChecks?.find((c) => c.id === id)?.status === 'PASS'
          ? 'PASS'
          : args.selfChecks?.some((c) => c.id === id)
            ? 'FAIL'
            : 'NOT_RUN',
    })),
    nativeChecks: NATIVE_CHECK_IDS.map((id) => ({
      id,
      status:
        args.nativeChecks?.find((c) => c.id === id)?.status === 'PASS'
          ? 'PASS'
          : args.nativeChecks?.find((c) => c.id === id)?.status === 'FAIL'
            ? 'FAIL'
            : 'UNAVAILABLE',
    })),
    physicalWorkflow: {
      interrupted: args.interrupted === true,
      failures: (args.failures ?? [])
        .filter(
          (f) =>
            ['calibration', 'pursuit', 'saccades'].includes(f.stage) &&
            VALIDATION_FAILURE_CODES.includes(f.code),
        )
        .slice(-10)
        .map((f) => ({ stage: f.stage, code: f.code })),
      calibrationConfirmed: current,
      calibration,
      pursuit: eyeTestTechnicalSummary(args.pursuit, current),
      saccades: eyeTestTechnicalSummary(args.saccades, current),
    },
    units: {
      error: 'target-viewport-fraction',
      velocity: 'target-viewport-fraction/s',
      latency: 'ms',
    },
    policies: { calibration: { ...CALIBRATION_POLICY }, eyeTests: { ...TEST_POLICY } },
  };
}
