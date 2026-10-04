import { analyzeVideoFile } from '../../camera/framePipeline';
import {
  getMonotonicTimeUs,
  saveStimulusTimeline,
  type PreviewRecordingReport,
} from '../../camera/livePreview';
import type { StimulusRun } from './engine';
import { clockBridge, matchFrame, type ClockBridge } from './synchronization';

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
/** Save raw target/commit/PTS data for future metrics; calculate no clinical metrics. */
export async function analyzeStimulusRecording(
  session: StimulusRun,
  capture: PreviewRecordingReport,
  bridge: ClockBridge,
  viewport: { width: number; height: number },
): Promise<string> {
  if (!capture.filePath) throw new Error('Missing recording file.');
  const decoded = await analyzeVideoFile({
    filePath: capture.filePath,
    expectedFps: capture.fpsMax,
    faceSampleCount: 1,
    saveDebugFrames: false,
  });
  const firstPts = decoded.decodedPtsUs.find((p) => p !== null);
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
  const frames = decoded.decodedPtsUs.map((pts, frameIndex) => ({
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
      schemaVersion: 1,
      summary,
      session,
      bridge,
      anchor,
      viewport: { ...viewport, units: 'dp' },
      presentationClock: 'react-commit',
      capture,
      frames,
    }),
  );
  console.log('STIMULUS_RESULT ' + JSON.stringify({ ...summary, timelinePath }));
  return JSON.stringify({ ...summary, timelinePath }, null, 2);
}
