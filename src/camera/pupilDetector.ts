// P3 pupil seam — loader + orchestration behind the camera seam.
// Android-only native module; resolves to null in Expo Go / iOS / web,
// in which case callers get a "Development Build required" error (no crash).
//
// Orchestration rule: every sampled eye slot produces exactly one
// `PupilDetectionResult`. Upstream misses become explicit TS-side failures
// (NO_FACE / NO_EYE_ROI) with null centroids; only usable eye ROIs go to the
// native detector. Denominators therefore stay honest and no position is
// ever fabricated.

import { requireOptionalNativeModule } from 'expo';

import type {
  PupilBatchReport,
  PupilRoiRequest,
} from '../../modules/expo-pupil-detector/src/ExpoPupilDetector.types';
import type { FramePipelineFaceSample } from '../../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';
import type {
  EyeSide,
  PupilDetectionResult,
  PupilDetectorId,
  PupilFailureReason,
} from '../eyetracking/pupil/pupilTypes';

export type { PupilBatchReport, PupilRoiRequest };

const VALID_FAILURES: ReadonlySet<string> = new Set([
  'NO_FACE',
  'NO_EYE_ROI',
  'EYE_CLOSED_OR_OCCLUDED',
  'NO_PUPIL_CANDIDATE',
  'AMBIGUOUS_CANDIDATES',
  'LOW_CONFIDENCE',
  'INVALID_GEOMETRY',
]);

interface ExpoPupilDetectorNativeModule {
  analyzeVideoPupils(
    filePath: string,
    detectorId: string,
    saveOverlays: boolean,
    requestsJson: string,
  ): Promise<PupilBatchReport>;
}

const nativeModule =
  requireOptionalNativeModule<ExpoPupilDetectorNativeModule>('ExpoPupilDetector');

export function isPupilDetectorAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.analyzeVideoPupils === 'function';
}

export interface PupilBatchOptions {
  filePath: string;
  detectorId: PupilDetectorId;
  saveOverlays?: boolean;
  requests: PupilRoiRequest[];
}

/** Run one native pupil batch over usable eye ROIs. */
export async function analyzeVideoPupils(options: PupilBatchOptions): Promise<PupilBatchReport> {
  if (!isPupilDetectorAvailable()) {
    throw new Error(
      'Pupil detection needs an Expo Development Build on Android (not available in Expo Go). ' +
        'Build with the development profile and run on-device.',
    );
  }
  try {
    return await (nativeModule as ExpoPupilDetectorNativeModule).analyzeVideoPupils(
      options.filePath,
      options.detectorId,
      options.saveOverlays ?? true,
      JSON.stringify(options.requests),
    );
  } catch (e) {
    throw new Error(`Pupil detection failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function upstreamFailure(args: {
  sample: FramePipelineFaceSample;
  eyeSide: EyeSide;
  detectorId: PupilDetectorId;
  reason: PupilFailureReason;
}): PupilDetectionResult {
  const eye = args.eyeSide === 'left' ? args.sample.leftEye : args.sample.rightEye;
  return {
    frameIndex: args.sample.frameIndex,
    decodedPtsUs: args.sample.ptsUs,
    eyeSide: args.eyeSide,
    detectorId: args.detectorId,
    roiX: eye?.x ?? 0,
    roiY: eye?.y ?? 0,
    roiWidth: eye?.width ?? 0,
    roiHeight: eye?.height ?? 0,
    centroidXInRoi: null,
    centroidYInRoi: null,
    centroidXInFrame: null,
    centroidYInFrame: null,
    normalizedX: null,
    normalizedY: null,
    candidateWidth: null,
    candidateHeight: null,
    confidence: 0,
    failureReason: args.reason,
  };
}

function toFailureReason(raw: string | null): PupilFailureReason | null {
  if (raw === null) {
    return null;
  }
  return VALID_FAILURES.has(raw) ? (raw as PupilFailureReason) : 'INVALID_GEOMETRY';
}

/**
 * Build the full per-eye-slot result list: TS-side NO_FACE / NO_EYE_ROI for
 * upstream misses plus one native batch for usable ROIs. `condition` labels
 * every result of this run for per-condition statistics.
 */
export async function runPupilBatch(args: {
  filePath: string;
  faceSamples: FramePipelineFaceSample[];
  detectorId: PupilDetectorId;
  saveOverlays?: boolean;
  condition: string;
}): Promise<{ results: PupilDetectionResult[]; report: PupilBatchReport | null }> {
  const upstream: PupilDetectionResult[] = [];
  const requests: PupilRoiRequest[] = [];
  for (const sample of args.faceSamples) {
    for (const eyeSide of ['left', 'right'] as const) {
      if (!sample.faceDetected) {
        upstream.push(
          upstreamFailure({ sample, eyeSide, detectorId: args.detectorId, reason: 'NO_FACE' }),
        );
        continue;
      }
      const eye = eyeSide === 'left' ? sample.leftEye : sample.rightEye;
      if (eye === null || eye.usable !== true) {
        upstream.push(
          upstreamFailure({ sample, eyeSide, detectorId: args.detectorId, reason: 'NO_EYE_ROI' }),
        );
        continue;
      }
      requests.push({
        frameIndex: sample.frameIndex,
        decodedPtsUs: sample.ptsUs,
        eyeSide,
        roiX: eye.x,
        roiY: eye.y,
        roiWidth: eye.width,
        roiHeight: eye.height,
        condition: args.condition,
      });
    }
  }
  if (requests.length === 0) {
    return { results: upstream, report: null };
  }
  const report = await analyzeVideoPupils({
    filePath: args.filePath,
    detectorId: args.detectorId,
    saveOverlays: args.saveOverlays,
    requests,
  });
  const native: PupilDetectionResult[] = report.results.map((r) => ({
    frameIndex: r.frameIndex,
    decodedPtsUs: r.decodedPtsUs,
    eyeSide: r.eyeSide,
    detectorId: args.detectorId,
    roiX: r.roiX,
    roiY: r.roiY,
    roiWidth: r.roiWidth,
    roiHeight: r.roiHeight,
    centroidXInRoi: r.centroidXInRoi,
    centroidYInRoi: r.centroidYInRoi,
    centroidXInFrame: r.centroidXInFrame,
    centroidYInFrame: r.centroidYInFrame,
    normalizedX: r.normalizedX,
    normalizedY: r.normalizedY,
    candidateWidth: r.candidateWidth,
    candidateHeight: r.candidateHeight,
    confidence: r.confidence,
    failureReason: toFailureReason(r.failureReason),
  }));
  return { results: [...upstream, ...native], report };
}
