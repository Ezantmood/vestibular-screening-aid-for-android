import type { CalibrationResult } from '../../eyetracking/calibration/types';
import type { PupilDetectionResult } from '../../eyetracking/pupil/pupilTypes';
import type { PupilTrackingResult } from '../../eyetracking/tracking/trackingTypes';

/** Counts distinguish detector SUCCESS from features accepted by calibration. */
export function calibrationDiagnostics(
  result: CalibrationResult,
  replays: readonly {
    condition: string;
    rawResults: readonly PupilDetectionResult[];
    tracked: readonly PupilTrackingResult[];
  }[] = [],
) {
  return result.targetQuality.map((q) => {
    const replay = replays.find((r) => r.condition === q.targetId);
    const raw = replay?.rawResults.filter((r) => r.eyeSide === q.eyeSide) ?? [];
    const tracked = replay?.tracked.filter((r) => r.eyeSide === q.eyeSide) ?? [];
    const success = raw.filter((r) => r.failureReason === null && r.centroidXInFrame !== null);
    const observed = tracked.filter((t) => t.trackedCentroidX !== null);
    const eligible = observed.filter((t) => t.trackingConfidence >= result.policy.minConfidence);
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
      reasons: q.reasons,
    };
  });
}
