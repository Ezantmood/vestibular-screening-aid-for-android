import { createCalibrationMapper } from '../eyetracking/calibration/calibration';
import type { CalibrationContext, CalibrationResult } from '../eyetracking/calibration/types';
import type { PupilDetectionResult } from '../eyetracking/pupil/pupilTypes';
import type { PupilTrackingResult } from '../eyetracking/tracking/trackingTypes';
import { trackingObservations } from '../eyetracking/tracking/observations';
import { processTrajectory } from './processing';
import type { SignalInputSample } from './types';

export function processTrackingSignals(
  replay: {
    rawResults: readonly PupilDetectionResult[];
    tracked: readonly PupilTrackingResult[];
  },
  calibration?: CalibrationResult,
  context?: CalibrationContext,
  nowMs = Date.now(),
) {
  const mapper =
    calibration && context ? createCalibrationMapper(calibration, context, nowMs) : null;
  const observations = trackingObservations(replay.rawResults, replay.tracked);
  return (['left', 'right'] as const).map((eyeSide) => {
    const obs = observations.filter((s) => s.eyeSide === eyeSide);
    const track = new Map(
      replay.tracked.filter((t) => t.eyeSide === eyeSide).map((t) => [t.frameIndex, t]),
    );
    const normalized: SignalInputSample[] = obs.map((s) => ({
      frameIndex: s.frameIndex,
      decodedPtsUs: s.decodedPtsUs,
      eyeSide,
      x: s.x,
      y: s.y,
      confidence: s.confidence,
      estimated: s.estimated,
      rescued: track.get(s.frameIndex)?.rescued,
      ...(s.x === null
        ? {
            missingReason:
              track.get(s.frameIndex)?.trackingState === 'BLINK_OR_OCCLUDED'
                ? ('blink-or-occluded' as const)
                : ('tracking-dropout' as const),
          }
        : {}),
    }));
    const pupil = processTrajectory(normalized, { coordinateSpace: 'eye-roi-normalized' });
    const normalizedByFrame = new Map(normalized.map((s) => [s.frameIndex, s]));
    const calibrated =
      calibration && context
        ? processTrajectory(
            obs.map((s): SignalInputSample => {
              const mapped = mapper!(s);
              return {
                frameIndex: s.frameIndex,
                decodedPtsUs: s.decodedPtsUs,
                eyeSide,
                x: mapped?.x ?? null,
                y: mapped?.y ?? null,
                confidence: mapped?.confidence ?? 0,
                estimated: s.estimated,
                rescued: track.get(s.frameIndex)?.rescued,
                ...(mapped
                  ? {}
                  : {
                      missingReason:
                        s.x === null
                          ? normalizedByFrame.get(s.frameIndex)?.missingReason
                          : 'calibration-invalid',
                    }),
              };
            }),
            { coordinateSpace: 'screen-normalized' },
          )
        : null;
    return { eyeSide, pupil, calibrated };
  });
}
