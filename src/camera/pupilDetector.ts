import type { EyeContour } from '../eyetracking/pupil/eyeGeometry';
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
import { assertCurrentFramePipeline } from './framePipeline';
import { reconcilePupilBatch } from '../eyetracking/pupil/reconcileBatch';
import {
  CALIBRATION_COORDINATE_VERSION,
  currentPupilMeasurement,
} from '../eyetracking/calibration/types';

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
  readonly measurementVersion?: string;
  analyzeVideoPupils(
    filePath: string,
    detectorId: string,
    saveOverlays: boolean,
    requestsJson: string,
  ): Promise<PupilBatchReport>;
  analyzeVideoPupilsWithPrior?(
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

export function isHintedPupilDetectorAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.analyzeVideoPupilsWithPrior === 'function';
}

/** Fast Refresh must not label old native measurements as the new detector. */
export function assertCurrentPupilDetector(): void {
  assertCurrentFramePipeline();
  if (!isPupilDetectorAvailable() || !currentPupilMeasurement(nativeModule?.measurementVersion))
    throw new Error(
      `Cần cập nhật APK có detector ${CALIBRATION_COORDINATE_VERSION}. Fast Refresh không cập nhật phần native.`,
    );
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
  assertCurrentPupilDetector();
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

export function toPupilDetectionResults(
  report: PupilBatchReport,
  detectorId: PupilDetectorId,
): PupilDetectionResult[] {
  return report.results.map((r) => ({
    frameIndex: r.frameIndex,
    decodedPtsUs: r.decodedPtsUs,
    eyeSide: r.eyeSide,
    detectorId,
    roiX: r.roiX,
    roiY: r.roiY,
    roiWidth: r.roiWidth,
    roiHeight: r.roiHeight,
    eyeContour: r.eyeContour,
    centroidXInRoi: r.centroidXInRoi,
    centroidYInRoi: r.centroidYInRoi,
    centroidXInFrame: r.centroidXInFrame,
    centroidYInFrame: r.centroidYInFrame,
    normalizedX: r.normalizedX,
    normalizedY: r.normalizedY,
    candidateWidth: r.candidateWidth,
    candidateHeight: r.candidateHeight,
    confidence: r.confidence,
    diagnostics: r.diagnostics,
    failureReason:
      r.detectorId === detectorId ? toFailureReason(r.failureReason) : 'INVALID_GEOMETRY',
  }));
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
        eyeContour: eye.contour,
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
  const native = reconcilePupilBatch(
    requests,
    toPupilDetectionResults(report, args.detectorId),
    args.detectorId,
  );
  return { results: [...upstream, ...native], report };
}

export interface DensePupilRoi {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  eyeContour?: EyeContour | null;
  condition: string;
  missingReason: PupilFailureReason | null;
}

/**
 * P4 dense batch over propagated (keyframe + interpolated) ROIs. Slots
 * with `missingReason` become explicit TS-side failures (same honesty rule
 * as the sparse path); only boxed slots reach native code. Used for
 * full-rate tracks and for targeted overlay batches alike.
 */
export async function runDensePupilBatch(args: {
  filePath: string;
  detectorId: PupilDetectorId;
  saveOverlays?: boolean;
  rois: DensePupilRoi[];
}): Promise<{ results: PupilDetectionResult[]; report: PupilBatchReport | null }> {
  const upstream: PupilDetectionResult[] = [];
  const requests: PupilRoiRequest[] = [];
  for (const roi of args.rois) {
    if (roi.missingReason !== null) {
      upstream.push({
        frameIndex: roi.frameIndex,
        decodedPtsUs: roi.decodedPtsUs,
        eyeSide: roi.eyeSide,
        detectorId: args.detectorId,
        roiX: roi.roiX,
        roiY: roi.roiY,
        roiWidth: roi.roiWidth,
        roiHeight: roi.roiHeight,
        eyeContour: roi.eyeContour,
        centroidXInRoi: null,
        centroidYInRoi: null,
        centroidXInFrame: null,
        centroidYInFrame: null,
        normalizedX: null,
        normalizedY: null,
        candidateWidth: null,
        candidateHeight: null,
        confidence: 0,
        failureReason: roi.missingReason,
      });
      continue;
    }
    requests.push({
      frameIndex: roi.frameIndex,
      decodedPtsUs: roi.decodedPtsUs,
      eyeSide: roi.eyeSide,
      roiX: roi.roiX,
      roiY: roi.roiY,
      roiWidth: roi.roiWidth,
      roiHeight: roi.roiHeight,
      eyeContour: roi.eyeContour,
      condition: roi.condition,
    });
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
  return {
    results: [
      ...upstream,
      ...reconcilePupilBatch(
        requests,
        toPupilDetectionResults(report, args.detectorId),
        args.detectorId,
      ),
    ],
    report,
  };
}

export interface HintedPupilRequest extends PupilRoiRequest {
  priorXInRoi: number;
  priorYInRoi: number;
  searchRadiusPx: number;
}

/**
 * P4 hinted second pass: re-analyze failed ROIs with a motion-model prior.
 * Only usable eye ROIs are sent (upstream misses have no box to constrain).
 * Returns rescued `PupilDetectionResult` values in the same shape; callers
 * tag them `rescued` so the tracker caps their confidence transparently.
 */
export async function runHintedPupilBatch(args: {
  filePath: string;
  detectorId: PupilDetectorId;
  saveOverlays?: boolean;
  hints: HintedPupilRequest[];
}): Promise<{ results: PupilDetectionResult[]; report: PupilBatchReport | null }> {
  if (args.hints.length === 0) {
    return { results: [], report: null };
  }
  if (!isHintedPupilDetectorAvailable()) {
    throw new Error(
      'Hinted pupil detection needs a Development Build with the P4 native entry ' +
        '(analyzeVideoPupilsWithPrior). Rebuild the app and retry.',
    );
  }
  assertCurrentPupilDetector();
  const report = await (nativeModule as ExpoPupilDetectorNativeModule).analyzeVideoPupilsWithPrior!(
    args.filePath,
    args.detectorId,
    args.saveOverlays ?? true,
    JSON.stringify(args.hints),
  );
  const results = reconcilePupilBatch(
    args.hints,
    toPupilDetectionResults(report, args.detectorId),
    args.detectorId,
  );
  return { results, report };
}
