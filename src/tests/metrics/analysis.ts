import type { CalibrationResult } from '../../eyetracking/calibration/types';
import type { SignalProcessingResult } from '../../signals/types';
import { analyzeHorizontalSaccades } from '../horizontalSaccades';
import { analyzeSmoothPursuit } from '../smoothPursuit';
import { validateStimulus, type StimulusRun } from '../stimulus/engine';
import type { ClockBridge, FrameTimeAnchor } from '../stimulus/synchronization';
import { TEST_POLICY } from './quality';
import type { EyeTestResult } from './types';

/** Pure metric analysis. Calibration validity is checked at capture time by the caller. */
export function analyzeEyeTest(args: {
  session: StimulusRun;
  bridge: ClockBridge | null;
  anchor: FrameTimeAnchor | null;
  calibration: Pick<CalibrationResult, 'id'> | null;
  calibrationValid: boolean;
  signals: {
    eyeSide: 'left' | 'right';
    calibrated: SignalProcessingResult | null;
    pupil?: SignalProcessingResult;
  }[];
}): EyeTestResult {
  validateStimulus(args.session.config);
  const inputs = (['left', 'right'] as const).map((eyeSide) => ({
    eyeSide,
    session: args.session,
    bridge: args.bridge,
    anchor: args.anchor,
    calibrationValid: args.calibrationValid && args.calibration !== null,
    signal: args.signals.find((s) => s.eyeSide === eyeSide)?.calibrated ?? null,
  }));
  const pursuit =
    args.session.config.testId === 'smooth-pursuit'
      ? inputs.map((input) => analyzeSmoothPursuit(input, input.eyeSide))
      : [];
  const saccades =
    args.session.config.testId === 'horizontal-saccades'
      ? inputs.map((input) => analyzeHorizontalSaccades(input, input.eyeSide))
      : [];
  const eyes = [...pursuit, ...saccades];
  const status = eyes.every((e) => e.quality.status === 'INVALID')
    ? 'INVALID'
    : eyes.every((e) => e.quality.status === 'GOOD_DATA')
      ? 'GOOD_DATA'
      : 'POOR_DATA';
  return {
    schemaVersion: 1,
    testId: args.session.config.testId,
    status,
    reasons: eyes.flatMap((e) => e.quality.reasons.map((r) => `${e.eyeSide}:${r}`)),
    calibrationId: args.calibration?.id ?? null,
    synchronization: {
      source: args.anchor?.source ?? 'unavailable',
      uncertaintyMs:
        args.anchor?.uncertaintyUs !== null &&
        args.anchor?.uncertaintyUs !== undefined &&
        args.bridge
          ? (args.anchor.uncertaintyUs + args.bridge.roundTripUs / 2) / 1000
          : null,
      presentationClock: 'react-commit',
      physicalOnsetMeasured: false,
    },
    units: {
      position: 'target-viewport-fraction',
      velocity: 'target-viewport-fraction/s',
      latency: 'ms',
      gainAndAccuracy: 'ratio',
    },
    pursuit,
    saccades,
    tracking: args.signals.flatMap((s) =>
      s.pupil
        ? [
            {
              eyeSide: s.eyeSide,
              totalFrames: s.pupil.qualityAfter.total,
              usableFrames: s.pupil.qualityAfter.usable,
              coverage: s.pupil.qualityAfter.coverage,
              medianConfidence: s.pupil.qualityAfter.medianConfidence,
              blinkSamples: s.pupil.reasonCounts['blink-or-occluded'] ?? 0,
              dropoutSamples: s.pupil.reasonCounts['tracking-dropout'] ?? 0,
              segments: s.pupil.segments,
              velocitySamples: s.pupil.velocitySamples,
            },
          ]
        : [],
    ),
    policy: { ...TEST_POLICY },
  };
}
