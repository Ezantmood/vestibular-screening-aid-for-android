import {
  percentileDarkDetector,
  contrastNormalizedDetector,
} from '../../eyetracking/pupil/detectors';
import {
  buildSuccessResult,
  mapBoxFromRotatedToOriginal,
} from '../../eyetracking/pupil/coordinates';
import { finalTrack } from '../../eyetracking/tracking/twoPassTracking';
import {
  fitCalibration,
  calibrationUsable,
  mapCalibration,
} from '../../eyetracking/calibration/calibration';
import { CALIBRATION_TARGETS } from '../../eyetracking/calibration/protocol';
import {
  CALIBRATION_COORDINATE_VERSION,
  type CalibrationContext,
  type CalibrationTake,
} from '../../eyetracking/calibration/types';
import { processTrackingSignals } from '../../signals/trackingSignals';
import { analyzeEyeTest } from '../metrics/analysis';
import {
  beginStimulus,
  defaultStimulus,
  finishStimulus,
  recordPresentation,
  targetAt,
} from '../stimulus/engine';
import { stableTargetViewport, targetViewportVisible } from '../stimulus/viewport';
import type { MvpTestId } from '../types';
import { trackingDecodeFailure } from '../../eyetracking/tracking/decodeIntegrity';
import { propagateRois } from '../../eyetracking/tracking/roiPropagation';
import { CaptureCancelled } from '../../camera/recordingPreparation';
import { FramingReadiness } from '../../eyetracking/framing';
import {
  CALIBRATION_FRAMING_GATES,
  classifyCalibrationFraming,
} from '../../eyetracking/calibration/geometry';

export const SELF_CHECK_IDS = [
  'component-isolation-percentile',
  'component-isolation-contrast',
  'quantized-pupil-percentile',
  'quantized-pupil-contrast',
  'eccentric-pupil-not-penalized',
  'uniform-and-ambiguous-remain-missing',
  'calibration-affine-held-out',
  'calibration-nonlinear-cv',
  'calibration-frame-noise-rejected',
  'calibration-model-contract',
  'framing-wide-face-reachable',
  'framing-current-sample-readiness',
  'target-board-fully-visible',
  'calibration-sensor-direction',
  'calibration-canthi-anchor',
  'calibration-missing-contour',
  'calibration-requires-face-anchor',
  'calibration-head-movement-rejected',
  'rotated-face-rect-roundtrip',
  'calibration-missing-right',
  'calibration-poor-validation',
  'calibration-expiry-and-version',
  'pursuit-calibrated-pipeline',
  'saccade-calibrated-pipeline',
  'rejected-calibration-blocks-both-tests',
  'blink-and-dropout-remain-missing',
  'viewport-scroll-race',
  'viewport-cancel',
  'partial-decode-rejected',
  'estimated-roi-rejected',
  'missing-roi-pts-rejected',
] as const;
export interface SelfCheckResult {
  id: (typeof SELF_CHECK_IDS)[number];
  /** UNAVAILABLE means the runner did not return a result, not an assertion failure. */
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
}
export const SYNTHETIC_CONTEXT: CalibrationContext = {
  cameraId: 'synthetic',
  width: 1920,
  height: 1080,
  fps: 120,
  viewportWidth: 340,
  viewportHeight: 180,
  viewportLeft: 16,
  viewportTop: 100,
  detectorId: 'percentile-dark',
  coordinateVersion: CALIBRATION_COORDINATE_VERSION,
};
/** Synthetic anatomical boundary, deliberately independent of the pupil. */
export function syntheticEyeContour(box: { x: number; y: number; width: number; height: number }) {
  return Array.from({ length: 16 }, (_, i) => ({
    x: box.x + box.width / 2 + (box.width / 2) * Math.cos((i * Math.PI) / 8),
    y: box.y + box.height / 2 + box.width * 0.16 * Math.sin((i * Math.PI) / 8),
  }));
}
export function syntheticCalibrationTakes(): CalibrationTake[] {
  return CALIBRATION_TARGETS.map((target, j) => ({
    target: { ...target },
    presentedJsUs: j * 5_000_000,
    releasedJsUs: j * 5_000_000 + 3_000_000,
    recordStartNativeUs: j * 5_000_000 + 1_000_000,
    recordEndNativeUs: j * 5_000_000 + 2_500_000,
    bridge: { nativeMinusJsUs: 0, roundTripUs: 1000 },
    completed: true,
    filePath: 'synthetic-only',
    samples: (['left', 'right'] as const).flatMap((eyeSide) =>
      Array.from({ length: 120 }, (_, frameIndex) => ({
        frameIndex,
        decodedPtsUs: frameIndex * 8333,
        eyeSide,
        x: 0.3 + 0.25 * target.x,
        y: 0.3 + 0.25 * target.y,
        confidence: 0.9,
        roi: { x: 100, y: 200, width: 100, height: 100 },
        face: { x: 100, y: 200, width: 100, height: 100 },
        eyeContour: syntheticEyeContour({ x: 100, y: 200, width: 100, height: 100 }),
        estimated: false,
      })),
    ),
  }));
}
function ensure(value: boolean): void {
  if (!value) throw new Error('SELF_CHECK_FAILED');
}
const syntheticFit = (takes = syntheticCalibrationTakes()) =>
  fitCalibration({
    id: 'synthetic-only',
    createdAtMs: 1000,
    context: SYNTHETIC_CONTEXT,
    takes,
  });
/** An off-center disconnected blob lies INSIDE the pupil component's bbox.
 * It is too small to be a candidate, but used to contaminate the outer component. */
export function nestedComponentImage(withBlob: boolean) {
  const width = 120,
    height = 120;
  const data = new Float64Array(width * height).fill(190);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x - 60, y - 60) < 22) data[y * width + x] = 25;
      if (Math.hypot(x - 68, y - 60) < 10) data[y * width + x] = 190;
      if (withBlob && Math.hypot(x - 70, y - 60) < 2.5) data[y * width + x] = 0;
    }
  return { width, height, data };
}
function pipeline(testId: MvpTestId, rejected = false, blink = false) {
  const calibration = syntheticFit();
  if (rejected) calibration.verdict = 'RETRY';
  const session = beginStimulus(defaultStimulus(testId), 0);
  for (let t = 0; t < session.config.durationUs; t += 16_667)
    recordPresentation(session, targetAt(session.config, t)!, t, t);
  finishStimulus(session, 10_010_000, false);
  const raw = (['left', 'right'] as const).flatMap((eyeSide) => {
    const seq = [];
    for (let frameIndex = 0, t = 0; t < 10_000_000; frameIndex++, t += 8333) {
      const seconds = t / 1_000_000;
      let x = 0.5 + 0.35 * Math.sin((Math.PI / 2) * seconds);
      if (testId === 'horizontal-saccades') {
        const step = Math.floor(seconds);
        const to = step === 0 ? 0.5 : step % 2 ? 0.15 : 0.85;
        const from = step <= 1 ? 0.5 : step % 2 ? 0.85 : 0.15;
        const f = Math.max(0, Math.min(1, (seconds - step - 0.2) / 0.05));
        x = from + (to - from) * f;
      }
      const r = buildSuccessResult({
        frameIndex,
        decodedPtsUs: t,
        eyeSide,
        detectorId: 'percentile-dark',
        box: { roiX: 100, roiY: 200, roiWidth: 100, roiHeight: 100 },
        centroid: {
          centroidXInRoi: (0.3 + 0.25 * x) * 100,
          centroidYInRoi: 42.5,
          candidateWidth: 20,
          candidateHeight: 20,
          confidence: 0.9,
        },
      });
      r.eyeContour = syntheticEyeContour({ x: 100, y: 200, width: 100, height: 100 });
      seq.push(
        blink && seconds > 1.18 && seconds < 1.23
          ? {
              ...r,
              failureReason: 'EYE_CLOSED_OR_OCCLUDED' as const,
              centroidXInFrame: null,
              centroidYInFrame: null,
              centroidXInRoi: null,
              centroidYInRoi: null,
              normalizedX: null,
              normalizedY: null,
              confidence: 0,
            }
          : r,
      );
    }
    return seq;
  });
  const { left, right } = finalTrack(raw);
  const signals = processTrackingSignals(
    {
      rawResults: raw,
      tracked: [...left, ...right],
      faceAnchors: Array.from({ length: left.length }, () => ({
        x: 100,
        y: 200,
        width: 100,
        height: 100,
      })),
    },
    calibration,
    SYNTHETIC_CONTEXT,
    1000,
  );
  const result = analyzeEyeTest({
    session,
    bridge: { nativeMinusJsUs: 0, roundTripUs: 1000 },
    anchor: { source: 'measured-frame', mediaPtsUs: 0, nativeElapsedUs: 0, uncertaintyUs: 500 },
    calibration,
    calibrationValid: calibrationUsable(calibration, SYNTHETIC_CONTEXT, 1000),
    signals,
  });
  return { result, signals, raw };
}
/** Explicit simulations only. Never writes fixtures to calibration storage or camera paths. */
export async function runBatch3SelfChecks(): Promise<SelfCheckResult[]> {
  const plateau = (detector: typeof percentileDarkDetector) => {
    for (const radius of [24, 28])
      for (const level of [25, 60, 90]) {
        const data = Float64Array.from({ length: 120 * 120 }, (_, i) =>
          Math.hypot((i % 120) - 58, Math.floor(i / 120) - 62) < radius ? level : 190,
        );
        const out = detector.detect({ width: 120, height: 120, data });
        ensure(
          out.success &&
            out.confidence >= 0.5 &&
            Math.abs(out.centroidXInRoi! - 58) < 1 &&
            Math.abs(out.centroidYInRoi! - 62) < 1,
        );
      }
  };
  const tests: Record<SelfCheckResult['id'], () => void | Promise<void>> = {
    'calibration-requires-face-anchor': () => {
      const takes = syntheticCalibrationTakes();
      for (const t of takes) for (const s of t.samples) delete s.face;
      ensure(syntheticFit(takes).verdict === 'RETRY');
    },
    'calibration-head-movement-rejected': () => {
      const result = syntheticFit();
      const s = syntheticCalibrationTakes()[4].samples[0];
      ensure(
        mapCalibration(
          result,
          { ...s, roi: { ...s.roi, x: 150 }, face: { ...s.face!, x: 150 } },
          SYNTHETIC_CONTEXT,
          1000,
        ) === null,
      );
    },
    'rotated-face-rect-roundtrip': () => {
      const b = mapBoxFromRotatedToOriginal(100, 920, 700, 1720, 270, 1920, 1080);
      ensure(b.left === 200 && b.top === 100 && b.right === 1000 && b.bottom === 700);
    },
    'quantized-pupil-percentile': () => plateau(percentileDarkDetector),
    'quantized-pupil-contrast': () => plateau(contrastNormalizedDetector),
    'eccentric-pupil-not-penalized': () => {
      const disk = (w: number, h: number, cx: number, cy: number, r: number) => ({
        width: w,
        height: h,
        data: Float64Array.from({ length: w * h }, (_, i) =>
          Math.hypot((i % w) - cx, Math.floor(i / w) - cy) < r ? 25 : 190,
        ),
      });
      for (const detector of [percentileDarkDetector, contrastNormalizedDetector]) {
        const center = detector.detect(disk(120, 120, 60, 60, 16));
        const side = detector.detect(disk(140, 110, 100, 28, 16));
        ensure(
          center.success &&
            side.success &&
            center.confidence >= 0.5 &&
            side.confidence >= 0.5 &&
            Math.abs(center.confidence - side.confidence) <= 0.08 &&
            Math.abs(side.centroidXInRoi! - 100) < 3 &&
            Math.abs(side.centroidYInRoi! - 28) < 3,
        );
      }
    },
    'uniform-and-ambiguous-remain-missing': () => {
      for (const detector of [percentileDarkDetector, contrastNormalizedDetector]) {
        for (const level of [25, 60, 110, 180]) {
          const out = detector.detect({
            width: 120,
            height: 120,
            data: new Float64Array(120 * 120).fill(level),
          });
          ensure(!out.success && out.centroidXInRoi === null && out.centroidYInRoi === null);
        }
        const data = Float64Array.from({ length: 120 * 120 }, (_, i) => {
          const x = i % 120,
            y = Math.floor(i / 120);
          return Math.hypot(x - 35, y - 60) < 18 || Math.hypot(x - 85, y - 60) < 18 ? 25 : 190;
        });
        const out = detector.detect({ width: 120, height: 120, data });
        ensure(!out.success && out.centroidXInRoi === null && out.centroidYInRoi === null);
      }
    },
    'component-isolation-percentile': () => {
      const a = percentileDarkDetector.detect(nestedComponentImage(false));
      const b = percentileDarkDetector.detect(nestedComponentImage(true));
      ensure(a.success && b.success && Math.abs(a.centroidXInRoi! - b.centroidXInRoi!) < 1e-9);
    },
    'component-isolation-contrast': () => {
      const a = contrastNormalizedDetector.detect(nestedComponentImage(false));
      const b = contrastNormalizedDetector.detect(nestedComponentImage(true));
      ensure(a.success && b.success && Math.abs(a.centroidXInRoi! - b.centroidXInRoi!) < 1e-9);
    },
    'calibration-affine-held-out': () => {
      const c = syntheticFit();
      ensure(calibrationUsable(c, SYNTHETIC_CONTEXT, 1000));
      ensure(c.models.left!.validationRmse < 1e-6);
    },
    'calibration-nonlinear-cv': () => {
      const takes = syntheticCalibrationTakes(),
        curvature = 0.65;
      const feature = (t: number) =>
        (curvature - 1 + Math.sqrt(1 - 2 * curvature + 4 * curvature * t)) / (2 * curvature);
      for (const t of takes)
        for (const s of t.samples) {
          s.x = 0.3 + 0.25 * feature(t.target.x);
          s.y = 0.3 + 0.25 * feature(t.target.y);
        }
      const c = syntheticFit(takes);
      ensure(
        calibrationUsable(c, SYNTHETIC_CONTEXT, 1000) &&
          c.models.left!.family === 'quadratic-ridge' &&
          c.models.left!.fitCvRmse < 0.001 &&
          c.models.left!.validationFrameRmse < 0.001,
      );
      for (const t of takes) {
        const p = mapCalibration(c, t.samples[0], SYNTHETIC_CONTEXT, 1000);
        ensure(!!p && Math.hypot(p.x - t.target.x, p.y - t.target.y) < 0.001);
      }
    },
    'calibration-frame-noise-rejected': () => {
      const takes = syntheticCalibrationTakes();
      for (const t of takes)
        for (const s of t.samples) {
          const noise = s.frameIndex % 2 ? 0.001 : -0.001;
          s.face = { x: 200, y: 200, width: 600, height: 800 };
          s.eyeContour = syntheticEyeContour(s.face);
          s.roi = {
            x: 200 + (0.4 + 0.005 * t.target.x + noise) * 600 - 90,
            y: 200 + (0.4 + 0.005 * t.target.y + noise) * 800 - 90,
            width: 180,
            height: 180,
          };
          s.x = s.y = 0.5;
        }
      const c = syntheticFit(takes);
      ensure(
        c.verdict === 'RETRY' &&
          c.reasons.some((r) => r.startsWith('NOISY_VALIDATION:')) &&
          !calibrationUsable(c, SYNTHETIC_CONTEXT, 1000),
      );
    },
    'calibration-model-contract': () => {
      const c = syntheticFit();
      delete (c as Partial<typeof c>).modelVersion;
      ensure(!calibrationUsable(c, SYNTHETIC_CONTEXT, 1000));
    },
    'target-board-fully-visible': () => {
      const bounds = { left: 0, top: 24, width: 412, height: 820 };
      ensure(!targetViewportVisible({ left: 16, top: 310, width: 380, height: 697 }, bounds));
      ensure(targetViewportVisible({ left: 16, top: 40, width: 380, height: 720 }, bounds));
    },
    'calibration-canthi-anchor': () => {
      const c = syntheticFit();
      const s = syntheticCalibrationTakes()[4].samples[0];
      const before = mapCalibration(c, s, SYNTHETIC_CONTEXT, 1000);
      const after = mapCalibration(
        c,
        { ...s, face: { ...s.face!, x: s.face!.x + 8 } },
        SYNTHETIC_CONTEXT,
        1000,
      );
      ensure(before !== null && JSON.stringify(before) === JSON.stringify(after));
    },
    'calibration-missing-contour': () => {
      const takes = syntheticCalibrationTakes();
      for (const t of takes) for (const s of t.samples) s.eyeContour = [];
      ensure(syntheticFit(takes).verdict === 'RETRY');
    },
    'calibration-sensor-direction': () => {
      const takes = syntheticCalibrationTakes();
      for (const t of takes) for (const s of t.samples) s.faceRotation = 90;
      const c = fitCalibration({
        id: 'synthetic-direction',
        createdAtMs: 1000,
        context: { ...SYNTHETIC_CONTEXT, faceRotationDegrees: 270 },
        takes,
      });
      ensure(c.verdict === 'RETRY' && c.reasons.includes('ORIENTATION_CHANGED:left'));
    },
    'framing-wide-face-reachable': () => {
      ensure(
        classifyCalibrationFraming({
          faceFound: true,
          faceLeft: 0.07,
          faceRight: 0.93,
          faceTop: 0.26,
          faceBottom: 0.74,
          leftEyeLandmark: true,
          rightEyeLandmark: true,
          leftEyeOpenProb: 0.9,
          rightEyeOpenProb: 0.9,
        }) === 'READY',
      );
    },
    'framing-current-sample-readiness': () => {
      const sample = {
        faceFound: true,
        faceLeft: 0.07,
        faceRight: 0.93,
        faceTop: 0.26,
        faceBottom: 0.74,
        leftEyeLandmark: true,
        rightEyeLandmark: true,
        leftEyeOpenProb: 0.9,
        rightEyeOpenProb: 0.9,
      };
      const readiness = new FramingReadiness(3);
      ensure(readiness.push(sample, CALIBRATION_FRAMING_GATES).settling);
      readiness.push(sample, CALIBRATION_FRAMING_GATES);
      ensure(readiness.push(sample, CALIBRATION_FRAMING_GATES).ready);
      ensure(!readiness.push({ ...sample, faceFound: false }, CALIBRATION_FRAMING_GATES).ready);
    },
    'calibration-missing-right': () => {
      const takes = syntheticCalibrationTakes();
      for (const t of takes) t.samples = t.samples.filter((s) => s.eyeSide === 'left');
      const c = syntheticFit(takes);
      ensure(c.verdict === 'RETRY' && !c.models.right);
    },
    'calibration-poor-validation': () => {
      const takes = syntheticCalibrationTakes();
      for (const t of takes.filter((t) => t.target.role === 'validation'))
        for (const s of t.samples) s.x! += 0.1;
      ensure(syntheticFit(takes).verdict === 'RETRY');
    },
    'calibration-expiry-and-version': () => {
      const c = syntheticFit();
      ensure(!calibrationUsable(c, SYNTHETIC_CONTEXT, 1_000_000));
      ensure(
        !calibrationUsable(
          c,
          {
            ...SYNTHETIC_CONTEXT,
            coordinateVersion: 'decoded-roi-v1',
          } as unknown as CalibrationContext,
          1000,
        ),
      );
    },
    'pursuit-calibrated-pipeline': () => {
      const { result } = pipeline('smooth-pursuit');
      ensure(result.status === 'GOOD_DATA' && Math.abs(result.pursuit[0].pursuitGain! - 1) < 0.01);
    },
    'saccade-calibrated-pipeline': () => {
      const { result } = pipeline('horizontal-saccades');
      ensure(
        result.status === 'GOOD_DATA' &&
          result.saccades.every(
            (e) => e.validResponses === 9 && Math.abs(e.medianAccuracy! - 1) < 0.01,
          ),
      );
    },
    'rejected-calibration-blocks-both-tests': () => {
      for (const id of ['smooth-pursuit', 'horizontal-saccades'] as const) {
        const { result, signals } = pipeline(id, true);
        ensure(
          result.status === 'INVALID' &&
            signals.every((e) => e.calibrated!.qualityAfter.usable === 0),
        );
        ensure(
          result.pursuit.every((e) => e.pursuitGain === null) &&
            result.saccades.every((e) => e.medianPeakVelocityPerSecond === null),
        );
      }
      const c = syntheticFit();
      c.verdict = 'RETRY';
      ensure(
        mapCalibration(c, syntheticCalibrationTakes()[0].samples[0], SYNTHETIC_CONTEXT, 1000) ===
          null,
      );
    },
    'blink-and-dropout-remain-missing': () => {
      const { result, signals } = pipeline('horizontal-saccades', false, true);
      ensure(result.saccades[0].responses[0].reason === 'BLINK_OR_DROPOUT');
      ensure(signals.every((e) => e.calibrated!.interpolatedSamples === 0));
    },
    'viewport-scroll-race': async () => {
      let n = 0;
      const v = await stableTargetViewport(
        async () => ({ left: 16, top: ++n === 1 ? -201 : 100, width: 340, height: 180 }),
        { ready: () => n > 2 },
      );
      ensure(n === 4 && v.top === 100);
    },
    'partial-decode-rejected': () => {
      const good = {
        error: null,
        encodedSampleCount: 3,
        decodedFrameCount: 3,
        decodedPtsUs: [0, 8333, 16666],
      };
      ensure(trackingDecodeFailure(good) === null);
      ensure(trackingDecodeFailure({ ...good, decodedFrameCount: 2 }) === 'FRAME_COUNT_MISMATCH');
      ensure(trackingDecodeFailure({ ...good, error: 'synthetic' }) === 'DECODE_FAILED');
    },
    'estimated-roi-rejected': () => {
      const eye = { x: 100, y: 200, width: 100, height: 100, usable: true, estimated: true };
      const rois = propagateRois({
        faceSamples: [0, 2].map((frameIndex) => ({
          frameIndex,
          ptsUs: frameIndex * 8333,
          faceDetected: true,
          faceBox: null,
          leftEye: eye,
          rightEye: eye,
          rotationApplied: 0,
          error: null,
        })),
        decodedPtsUsList: [0, 8333, 16666],
        frameCount: 3,
      });
      ensure(rois.every((r) => r.missingReason !== null));
    },
    'missing-roi-pts-rejected': () => {
      const eye = { x: 100, y: 200, width: 100, height: 100, usable: true, estimated: false };
      const rois = propagateRois({
        faceSamples: [0, 2].map((frameIndex) => ({
          frameIndex,
          ptsUs: frameIndex * 8333,
          faceDetected: true,
          faceBox: null,
          leftEye: eye,
          rightEye: eye,
          rotationApplied: 0,
          error: null,
        })),
        decodedPtsUsList: [0, null, 16666],
        frameCount: 3,
      });
      ensure(rois.filter((r) => r.frameIndex === 1).every((r) => r.missingReason !== null));
    },
    'viewport-cancel': async () => {
      try {
        await stableTargetViewport(async () => ({ left: 16, top: 100, width: 340, height: 180 }), {
          cancelled: () => true,
        });
      } catch (e) {
        ensure(e instanceof CaptureCancelled);
        return;
      }
      ensure(false);
    },
  };
  const results: SelfCheckResult[] = [];
  for (const id of SELF_CHECK_IDS) {
    try {
      await tests[id]();
      results.push({ id, status: 'PASS' });
    } catch {
      results.push({ id, status: 'FAIL' });
    }
    // Keep the UI responsive between substantial pure-domain checks.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return results;
}
