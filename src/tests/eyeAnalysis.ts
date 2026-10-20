import type {
  CalibrationContext,
  CalibrationResult,
  CalibrationTake,
} from '../eyetracking/calibration/types';
import { calibrationDiagnostics } from './validation/calibrationDiagnostics';
import { fitCalibration } from '../eyetracking/calibration/calibration';
import { calibrationInsights, calibrationFeedback } from '../eyetracking/calibration/insights';
import {
  analyzeFileForTracking,
  type ReplayRunResult,
} from '../eyetracking/tracking/denseTrackAnalysis';
import { trackingObservations } from '../eyetracking/tracking/observations';
import { processTrackingSignals } from '../signals/trackingSignals';
import { saveCalibrationArtifact } from '../storage/calibrationStore';
import { saveEyeAnalysis } from '../camera/eyeAnalysisStorage';

export { processTrackingSignals } from '../signals/trackingSignals';
export type CapturedCalibrationTake = Omit<CalibrationTake, 'samples'>;
export async function analyzeCalibrationTakes(args: {
  id: string;
  createdAtMs?: number;
  context: CalibrationContext;
  takes: CapturedCalibrationTake[];
  progress?: (index: number) => void;
  cancelled?: () => boolean;
}) {
  const takes: CalibrationTake[] = [];
  const replays: ReplayRunResult[] = [];
  const signals: ReturnType<typeof processTrackingSignals>[] = [];
  for (let i = 0; i < args.takes.length; i++) {
    if (args.cancelled?.()) throw new Error('Đã hủy phân tích calibration.');
    args.progress?.(i + 1);
    const take = args.takes[i];
    const replay = await analyzeFileForTracking({
      filePath: take.filePath,
      condition: take.target.id,
      faceSampleCount: 24,
      detectorId: 'percentile-dark',
      expectedFps: args.context.fps,
      saveAuditOverlays: false,
    });
    takes.push({
      ...take,
      samples: trackingObservations(replay.rawResults, replay.tracked, replay.faceAnchors),
    });
    replays.push(replay);
    signals.push(processTrackingSignals(replay));
  }
  if (args.cancelled?.()) throw new Error('Đã hủy phân tích calibration.');
  const result = fitCalibration({
    id: args.id,
    context: args.context,
    createdAtMs: args.createdAtMs ?? Date.now(),
    takes,
  });
  const diagnostics = calibrationDiagnostics(result, replays);
  const artifact = { schemaVersion: 1 as const, result, takes, replays, signals, diagnostics };
  const path = await saveCalibrationArtifact(artifact);
  const summary = {
    id: result.id,
    verdict: result.verdict,
    reasons: result.reasons,
    models: result.models,
    targets: result.targetQuality,
    diagnostics,
    insights: calibrationInsights(result),
    feedback: calibrationFeedback(result),
    path,
    signals: signals.map((eyes, i) => ({
      target: takes[i].target.id,
      eyes: eyes.map((eye) => ({
        eyeSide: eye.eyeSide,
        before: eye.pupil.qualityBefore,
        beforeOnProcessedSupport: eye.pupil.qualityRawOnProcessedSupport,
        after: eye.pupil.qualityAfter,
        outliers: eye.pupil.outliers,
        gaps: eye.pupil.gaps.length,
        velocitySamples: eye.pupil.velocitySamples,
      })),
    })),
  };
  console.log('CALIBRATION_RESULT ' + JSON.stringify(summary));
  return {
    result,
    summary,
    path,
    evidence: {
      result,
      diagnostics,
      takes: takes.map((t) => ({ target: t.target })),
      replays: replays.map((r) => ({ decodedFrames: r.decodedFrames })),
    },
  };
}
export async function analyzeEyeRecording(
  filePath: string,
  fps: number,
  calibration?: CalibrationResult,
  context?: CalibrationContext,
  recordedAtMs = Date.now(),
) {
  const replay = await analyzeFileForTracking({
    filePath,
    condition: 'signal-validation',
    faceSampleCount: 60,
    detectorId: 'percentile-dark',
    expectedFps: fps,
    saveAuditOverlays: false,
  });
  // Offline processing may take minutes. Reuse is evaluated at capture time;
  // a valid take must not expire merely because the decoder was slow.
  const signals = processTrackingSignals(replay, calibration, context, recordedAtMs);
  const artifact = {
    schemaVersion: 1,
    createdAtMs: Date.now(),
    recordedAtMs,
    replay,
    calibrationId: calibration?.id ?? null,
    signals,
  };
  const path = await saveEyeAnalysis('signal', JSON.stringify(artifact));
  const summary = {
    path,
    decodedFrames: replay.decodedFrames,
    warnings: replay.warnings,
    calibrationId: calibration?.id ?? null,
    eyes: signals.map((eye) => ({
      eyeSide: eye.eyeSide,
      before: eye.pupil.qualityBefore,
      beforeOnProcessedSupport: eye.pupil.qualityRawOnProcessedSupport,
      after: eye.pupil.qualityAfter,
      outliers: eye.pupil.outliers,
      reasonCounts: eye.pupil.reasonCounts,
      gaps: eye.pupil.gaps,
      velocitySamples: eye.pupil.velocitySamples,
      interpolatedSamples: eye.pupil.interpolatedSamples,
      calibratedCoverage: eye.calibrated?.qualityAfter.coverage ?? null,
    })),
  };
  console.log('SIGNAL_RESULT ' + JSON.stringify(summary));
  return { summary, signals, replay, path };
}

export async function analyzeSignalRecording(
  filePath: string,
  fps: number,
  calibration?: CalibrationResult,
  context?: CalibrationContext,
) {
  return (await analyzeEyeRecording(filePath, fps, calibration, context)).summary;
}
