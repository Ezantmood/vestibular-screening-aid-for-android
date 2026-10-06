import type { SignalProcessingResult, ProcessedSignalSample } from '../../signals/types';
import type { StimulusRun } from '../stimulus/engine';
import type { ClockBridge, FrameTimeAnchor, FrameStimulusMatch } from '../stimulus/synchronization';

export type DataStatus = 'GOOD_DATA' | 'POOR_DATA' | 'INVALID';
export interface TestQuality {
  status: DataStatus;
  reasons: string[];
  totalFrames: number;
  usableFrames: number;
  coverage: number;
  /** Continuous observed intervals / entire intended test duration. */
  temporalCoverage: number;
  medianConfidence: number | null;
  medianIntervalMs: number | null;
  longestGapMs: number;
  reasonCounts: SignalProcessingResult['reasonCounts'];
}
export interface EyeTestInput {
  session: StimulusRun;
  bridge: ClockBridge | null;
  anchor: FrameTimeAnchor | null;
  calibrationValid: boolean;
  signal: SignalProcessingResult | null;
}
export interface JoinedEyeSample {
  signal: ProcessedSignalSample;
  target: FrameStimulusMatch;
}
export interface RapidMovement {
  startIndex: number;
  endIndex: number;
  onsetPtsUs: number;
  endPtsUs: number;
  durationMs: number;
  displacement: number;
  peakVelocity: number;
  rawPeakVelocity: number;
}
export interface PursuitEyeResult {
  eyeSide: 'left' | 'right';
  quality: TestQuality;
  pursuitGain: number | null;
  gainSupportMs: number;
  gainFitRmsePerSecond: number | null;
  trackingRmse: number | null;
  rapidMovementCandidates: RapidMovement[];
  /** Error-reducing candidates; estimated alignment is explicit in the test result. */
  catchUpCandidateCount: number | null;
  excludedRapidIntervals: number;
}
export type ResponseFailure =
  | 'MISSING_CALIBRATION'
  | 'INVALID_TEST'
  | 'MISSING_TARGET_STEP'
  | 'INCOMPLETE_WINDOW'
  | 'BLINK_OR_DROPOUT'
  | 'UNSTABLE_BASELINE'
  | 'NO_RESPONSE'
  | 'WRONG_DIRECTION'
  | 'ANTICIPATORY_RESPONSE'
  | 'LATE_RESPONSE'
  | 'INCOMPLETE_RESPONSE';
export interface SaccadeResponse {
  step: number;
  targetCommitUs: number | null;
  fromX: number;
  toX: number;
  status: 'VALID' | 'INVALID';
  reason: ResponseFailure | null;
  onsetPtsUs: number | null;
  endPtsUs: number | null;
  /** Only populated for a bounded measured frame anchor (still React commit onset). */
  latencyMs: number | null;
  estimatedLatencyMs: number | null;
  latencyUncertaintyMs: number | null;
  durationMs: number | null;
  peakVelocityPerSecond: number | null;
  rawPeakVelocityPerSecond: number | null;
  accuracy: number | null;
  endpointError: number | null;
  overshoot: number | null;
  undershoot: number | null;
}
export interface SaccadeEyeResult {
  eyeSide: 'left' | 'right';
  quality: TestQuality;
  expectedResponses: number;
  validResponses: number;
  responseValidity: number;
  responses: SaccadeResponse[];
  medianLatencyMs: number | null;
  medianEstimatedLatencyMs: number | null;
  medianPeakVelocityPerSecond: number | null;
  medianAccuracy: number | null;
  medianOvershoot: number | null;
  medianUndershoot: number | null;
}
export interface EyeTestResult {
  schemaVersion: 1;
  testId: StimulusRun['config']['testId'];
  status: DataStatus;
  reasons: string[];
  calibrationId: string | null;
  synchronization: {
    source: FrameTimeAnchor['source'] | 'unavailable';
    uncertaintyMs: number | null;
    presentationClock: 'react-commit';
    physicalOnsetMeasured: false;
  };
  units: {
    position: 'target-viewport-fraction';
    velocity: 'target-viewport-fraction/s';
    latency: 'ms';
    gainAndAccuracy: 'ratio';
  };
  pursuit: PursuitEyeResult[];
  saccades: SaccadeEyeResult[];
  tracking: {
    eyeSide: 'left' | 'right';
    totalFrames: number;
    usableFrames: number;
    coverage: number;
    medianConfidence: number | null;
    blinkSamples: number;
    dropoutSamples: number;
    segments: number;
    velocitySamples: number;
  }[];
  policy: typeof import('./quality').TEST_POLICY;
}
