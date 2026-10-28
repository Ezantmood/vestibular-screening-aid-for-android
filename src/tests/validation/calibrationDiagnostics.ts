import type { CalibrationResult, CalibrationTake } from '../../eyetracking/calibration/types';
import type {
  PupilDetectionResult,
  PupilImageDiagnostics,
} from '../../eyetracking/pupil/pupilTypes';
import type { PupilTrackingResult } from '../../eyetracking/tracking/trackingTypes';
import type { TrackingPipelineDiagnostics } from '../../eyetracking/tracking/pipelineDiagnostics';
import { median } from '../../eyetracking/calibration/calibration';

export function numericSummary(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    min: finite.length ? Math.min(...finite) : null,
    median: finite.length ? median(finite) : null,
    max: finite.length ? Math.max(...finite) : null,
  };
}
export const IMAGE_DIAGNOSTIC_KEYS = [
  'meanY',
  'stdY',
  'p05Y',
  'p95Y',
  'gradientRms',
  'nearBlackFraction',
  'nearWhiteFraction',
  'candidateCount',
  'darkFraction',
  'thresholdY',
  'bestScore',
  'runnerUpScore',
  'borderTouch',
  'apertureArea',
  'apertureMeanY',
  'rawCandidateCount',
  'rejectedBoundary',
  'rejectedArea',
  'rejectedSize',
  'rejectedAspect',
  'rejectedPrior',
  'rejectedUnstable',
  'rejectedEllipse',
  'rejectedOutline',
  'thresholdLevels',
  'hypothesisCount',
  'ellipseRmsePx',
  'boundarySupport',
  'outlineContrast',
  'regionStability',
] as const satisfies readonly (keyof PupilImageDiagnostics)[];
export const DETECTION_FAILURES = [
  'NO_FACE',
  'NO_EYE_ROI',
  'EYE_CLOSED_OR_OCCLUDED',
  'NO_PUPIL_CANDIDATE',
  'AMBIGUOUS_CANDIDATES',
  'LOW_CONFIDENCE',
  'NATIVE_RESULT_MISSING',
  'INVALID_GEOMETRY',
] as const;
/** Counts distinguish detector SUCCESS from actual accepted measurements.
 * All payload keys are fixed; no exception text, image, ID, path or raw positions. */
export function calibrationDiagnostics(
  result: CalibrationResult,
  replays: readonly {
    condition: string;
    rawResults: readonly PupilDetectionResult[];
    tracked: readonly PupilTrackingResult[];
    pipelineDiagnostics?: TrackingPipelineDiagnostics;
  }[] = [],
  takes: readonly CalibrationTake[] = [],
) {
  return result.targetQuality.map((q) => {
    const replay = replays.find((r) => r.condition === q.targetId);
    const take = takes.find((t) => t.target.id === q.targetId);
    const raw = replay?.rawResults.filter((r) => r.eyeSide === q.eyeSide) ?? [];
    const tracked = replay?.tracked.filter((r) => r.eyeSide === q.eyeSide) ?? [];
    const success = raw.filter((r) => r.failureReason === null && r.centroidXInFrame !== null);
    const observed = tracked.filter((t) => t.trackedCentroidX !== null);
    const eligible = observed.filter((t) => t.trackingConfidence >= result.policy.minConfidence);
    const hold = take
      ? {
          roundTripUs: take.bridge.roundTripUs,
          settleMarginUs:
            take.recordStartNativeUs -
            take.bridge.nativeMinusJsUs -
            take.bridge.roundTripUs / 2 -
            take.presentedJsUs -
            result.policy.settleUs,
          releaseMarginUs:
            take.releasedJsUs -
            take.recordEndNativeUs +
            take.bridge.nativeMinusJsUs -
            take.bridge.roundTripUs / 2,
        }
      : null;
    return {
      target: q.targetId,
      eye: q.eyeSide,
      total: q.total,
      detectorSuccess: success.length,
      detectorConfident: success.filter((r) => r.confidence >= result.policy.minConfidence).length,
      tracked: observed.length,
      gateRejected: tracked.filter((t) => t.gateRejected).length,
      trackedConfident: eligible.length,
      rejectedAfterConfidence: Math.max(0, eligible.length - q.accepted),
      accepted: q.accepted,
      coverage: q.coverage,
      spanUs: q.spanUs,
      spread: q.spread,
      blocks: q.blocks,
      predictionError: q.predictionError ?? null,
      validationFrames: q.validationFrames ?? null,
      roiWidthPx: numericSummary(raw.map((r) => r.roiWidth)),
      roiHeightPx: numericSummary(raw.map((r) => r.roiHeight)),
      faceWidthPx: numericSummary(
        take?.samples
          .filter((s) => s.eyeSide === q.eyeSide)
          .flatMap((s) => (s.face ? [s.face.width] : [])) ?? [],
      ),
      faceHeightPx: numericSummary(
        take?.samples
          .filter((s) => s.eyeSide === q.eyeSide)
          .flatMap((s) => (s.face ? [s.face.height] : [])) ?? [],
      ),
      detectorConfidence: numericSummary(success.map((r) => r.confidence)),
      trackingConfidence: numericSummary(observed.map((t) => t.trackingConfidence)),
      longestDropoutUs: Math.max(0, ...tracked.map((t) => t.dropoutDurationUs)),
      rescuedTracked: observed.filter((t) => t.rescued).length,
      detectionFailures: Object.fromEntries(
        DETECTION_FAILURES.map((key) => [key, raw.filter((r) => r.failureReason === key).length]),
      ),
      image: Object.fromEntries(
        IMAGE_DIAGNOSTIC_KEYS.map((key) => [
          key,
          numericSummary(
            raw.flatMap((r) => {
              const value = r.diagnostics?.[key];
              return typeof value === 'number' ? [value] : [];
            }),
          ),
        ]),
      ),
      pipeline: replay?.pipelineDiagnostics ?? null,
      hold,
      reasons: q.reasons,
    };
  });
}
