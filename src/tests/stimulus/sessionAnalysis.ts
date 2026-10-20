import { analyzeVideoFile } from '../../camera/framePipeline';
import {
  getMonotonicTimeUs,
  saveStimulusTimeline,
  type PreviewRecordingReport,
} from '../../camera/livePreview';
import type { StimulusRun } from './engine';
import { clockBridge, matchFrame, type ClockBridge } from './synchronization';
import type { CalibrationContext, CalibrationResult } from '../../eyetracking/calibration/types';
import { calibrationUsable } from '../../eyetracking/calibration/calibration';
import { tracesFromProcessed } from '../../clinic/trace';
import { analyzeEyeRecording } from '../eyeAnalysis';
import { analyzeEyeTest } from '../metrics/analysis';
import type { EyeTestResult } from '../metrics/types';

/** Lowest-RTT of five bracketed samples reduces JS/native scheduling uncertainty. */
export async function sampleStimulusClock(): Promise<ClockBridge> {
  let best: ClockBridge | null = null;
  for (let i = 0; i < 5; i++) {
    const before = performance.now() * 1000;
    const native = await getMonotonicTimeUs();
    const sample = clockBridge(before, native, performance.now() * 1000);
    if (best === null || sample.roundTripUs < best.roundTripUs) best = sample;
  }
  return best!;
}
/** Save target/commit/PTS and engineering results through the existing cache seam. */
export async function analyzeStimulusRecording(
  session: StimulusRun,
  capture: PreviewRecordingReport,
  bridge: ClockBridge,
  viewport: { width: number; height: number },
  eyeAnalysis?: {
    calibration: CalibrationResult | null;
    signalPath: string;
    result: EyeTestResult;
  },
  decodedPtsUs?: (number | null)[],
): Promise<string> {
  if (!capture.filePath) throw new Error('Missing recording file.');
  const pts =
    decodedPtsUs ??
    (
      await analyzeVideoFile({
        filePath: capture.filePath,
        expectedFps: capture.fpsMax,
        faceSampleCount: 1,
        saveDebugFrames: false,
      })
    ).decodedPtsUs;
  const firstPts = pts.find((p) => p !== null);
  // MediaRecorder offers no exposure-to-PTS mapping. Do not convert this
  // boundary approximation into a claimed exact camera/frame anchor.
  const anchor =
    firstPts === undefined
      ? null
      : {
          mediaPtsUs: firstPts,
          nativeElapsedUs: capture.testStartNs / 1000,
          source: 'record-start-estimate' as const,
          uncertaintyUs: null,
        };
  const frames = pts.map((pts, frameIndex) => ({
    frameIndex,
    ...matchFrame(session, pts, bridge, anchor),
  }));
  const summary = {
    outcome: session.outcome,
    testId: session.config.testId,
    presentations: session.presentations.length,
    decodedFrames: frames.length,
    estimatedMatches: frames.filter((m) => m.status === 'estimated').length,
    missingPts: frames.filter((m) => m.status === 'missing-timestamp').length,
    bridgeRoundTripUs: bridge.roundTripUs,
    synchronization: 'record-start-estimate',
    exposureOffsetUncertaintyUs: null,
    filePath: capture.filePath,
  };
  const timelinePath = await saveStimulusTimeline(
    JSON.stringify({
      schemaVersion: 2,
      summary,
      session,
      bridge,
      anchor,
      viewport: { ...viewport, units: 'dp' },
      presentationClock: 'react-commit',
      capture,
      frames,
      eyeAnalysis: eyeAnalysis ?? null,
    }),
  );
  console.log('STIMULUS_RESULT ' + JSON.stringify({ ...summary, timelinePath }));
  return JSON.stringify({ ...summary, timelinePath }, null, 2);
}

/** One real P4 replay → calibrated/processed signals → metrics → debug artifact. */
export async function completeEyeTestRecording(args: {
  session: StimulusRun;
  capture: PreviewRecordingReport;
  bridge: ClockBridge;
  viewport: { width: number; height: number };
  context: CalibrationContext;
  calibration: CalibrationResult | null;
  recordedAtMs: number;
}) {
  if (!args.capture.filePath) throw new Error('Missing recording file.');
  const calibrationValid =
    args.calibration !== null &&
    calibrationUsable(args.calibration, args.context, args.recordedAtMs);
  const eye = await analyzeEyeRecording(
    args.capture.filePath,
    args.capture.fpsMax,
    calibrationValid ? args.calibration! : undefined,
    args.context,
    args.recordedAtMs,
  );
  const firstPts = eye.replay.decodedPtsUs.find((p) => p !== null);
  const anchor =
    firstPts === undefined
      ? null
      : {
          mediaPtsUs: firstPts,
          nativeElapsedUs: args.capture.testStartNs / 1000,
          source: 'record-start-estimate' as const,
          uncertaintyUs: null,
        };
  const result = analyzeEyeTest({
    session: args.session,
    bridge: args.bridge,
    anchor,
    calibration: args.calibration,
    calibrationValid,
    signals: eye.signals,
  });
  const timeline = JSON.parse(
    await analyzeStimulusRecording(
      args.session,
      args.capture,
      args.bridge,
      args.viewport,
      { calibration: args.calibration, signalPath: eye.path, result },
      eye.replay.decodedPtsUs,
    ),
  ) as unknown;
  console.log('EYE_TEST_RESULT ' + JSON.stringify(result));
  const trace = tracesFromProcessed(
    eye.signals.map((signal) => ({
      eyeSide: signal.eyeSide,
      samples: (signal.calibrated ?? signal.pupil).samples,
    })),
  );
  return { result, timeline, signal: eye.summary, trace };
}
