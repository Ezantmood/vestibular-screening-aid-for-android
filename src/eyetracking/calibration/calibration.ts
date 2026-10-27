import { pupilInEyeFrame } from '../pupil/eyeGeometry';
import { CALIBRATION_TARGETS } from './protocol';
import { CALIBRATION_MODEL_VERSION, currentPupilMeasurement } from './types';
import {
  evaluateRegression,
  selectRegression,
  validRegression,
  regressionGeometrySafe,
} from './regression';
import type {
  CalibrationContext,
  CalibrationPolicy,
  CalibrationResult,
  CalibrationTake,
  EyeCalibration,
  EyeObservation,
  SampleBlocks,
  TargetQuality,
} from './types';

/** All gates below are engineering quality gates, not clinical thresholds. */
export const CALIBRATION_POLICY: CalibrationPolicy = {
  settleUs: 600_000,
  minSamples: 30,
  minCoverage: 0.6,
  minSpanUs: 250_000,
  minConfidence: 0.5,
  maxSpread: 0.04,
  maxValidationRmse: 0.08,
  maxValidationError: 0.15,
  maxFitRmse: 0.08,
  maxFitCvRmse: 0.08,
  maxValidationFrameRmse: 0.08,
  maxValidationFrameP95Error: 0.15,
  maxAgeMs: 15 * 60_000,
};
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const ordered = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}
/** Re-express points in the take's median box size. A constant box reproduces
 * the median of the stored coordinates. */
export function stableNormalizedPoint(
  samples: readonly { x: number; y: number; roi: { width: number; height: number } }[],
): { x: number; y: number } | null {
  if (samples.length === 0) return null;
  const scaleW = median(samples.map((s) => s.roi.width));
  const scaleH = median(samples.map((s) => s.roi.height));
  if (!(scaleW > 0) || !(scaleH > 0)) return null;
  const x = median(samples.map((s) => 0.5 + (s.x - 0.5) * (s.roi.width / scaleW)));
  const y = median(samples.map((s) => 0.5 + (s.y - 0.5) * (s.roi.height / scaleH)));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
function finiteRoi(roi: EyeObservation['roi']): boolean {
  return (
    !!roi &&
    [roi.x, roi.y, roi.width, roi.height].every(Number.isFinite) &&
    roi.x >= 0 &&
    roi.y >= 0 &&
    roi.width > 0 &&
    roi.height > 0
  );
}
function roiScaleCompatible(roi: EyeObservation['roi'], ref: EyeObservation['roi']): boolean {
  return (
    finiteRoi(roi) &&
    finiteRoi(ref) &&
    Math.abs(roi.width / ref.width - 1) <= 0.2 &&
    Math.abs(roi.height / ref.height - 1) <= 0.2
  );
}
function roiCompatible(roi: EyeObservation['roi'], ref: EyeObservation['roi']): boolean {
  return (
    roiScaleCompatible(roi, ref) &&
    Math.hypot(
      (roi.x + roi.width / 2 - ref.x - ref.width / 2) / ref.width,
      (roi.y + roi.height / 2 - ref.y - ref.height / 2) / ref.height,
    ) <= 0.3
  );
}
export function sameCalibrationContext(a: CalibrationContext, b: CalibrationContext): boolean {
  return (
    (Object.keys(a) as (keyof CalibrationContext)[]).every((key) => a[key] === b[key]) &&
    (Object.keys(b) as (keyof CalibrationContext)[]).every((key) => a[key] === b[key])
  );
}
function validContext(context: CalibrationContext): boolean {
  return (
    typeof context.cameraId === 'string' &&
    context.cameraId.length > 0 &&
    context.detectorId === 'percentile-dark' &&
    (context.faceRotationDegrees === undefined ||
      [0, 90, 180, 270].includes(context.faceRotationDegrees)) &&
    currentPupilMeasurement(context.coordinateVersion) &&
    [context.viewportLeft, context.viewportTop].every((n) => Number.isFinite(n) && n >= 0) &&
    [
      context.width,
      context.height,
      context.fps,
      context.viewportWidth,
      context.viewportHeight,
    ].every((n) => Number.isFinite(n) && n > 0)
  );
}
type Box = EyeObservation['roi'];

function emptyBlocks(): SampleBlocks {
  return {
    noPupil: 0,
    lowConfidence: 0,
    noFace: 0,
    noEyeContour: 0,
    outsideFace: 0,
    badTime: 0,
    estimated: 0,
    trimmed: 0,
  };
}
function pupilInCrop(sample: EyeObservation): boolean {
  return (
    sample.x !== null &&
    sample.y !== null &&
    [sample.x, sample.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    finiteRoi(sample.roi)
  );
}
/** Why gazeFeature rejected a frame. Time, estimate and confidence are counted
 * by the fitter before this is called. */
function featureMiss(
  sample: EyeObservation,
): 'noPupil' | 'noFace' | 'noEyeContour' | 'outsideFace' {
  if (!pupilInCrop(sample)) return 'noPupil';
  if (!sample.face || !finiteRoi(sample.face)) return 'noFace';
  if (!sample.eyeContour) return 'noEyeContour';
  return 'outsideFace';
}
/** Pupil relative to the measured eyelid's canthi. The whole-face rectangle is
 * retained for the existing head-movement guard, never subtracted from gaze.
 * Missing/closed contours fail closed instead of silently using the old feature. */
export function gazeFeature(
  sample: EyeObservation,
): { x: number; y: number; box: Box; unitPx: number } | null {
  if (!pupilInCrop(sample) || !sample.face || !finiteRoi(sample.face) || !sample.eyeContour)
    return null;
  const feature = pupilInEyeFrame(
    {
      x: sample.roi.x + sample.x! * sample.roi.width,
      y: sample.roi.y + sample.y! * sample.roi.height,
    },
    sample.eyeContour,
    sample.faceRotation ?? 0,
  );
  if (!feature || ![feature.x, feature.y].every((v) => v >= -0.25 && v <= 1.25)) return null;
  return { ...feature, box: sample.face };
}

function medianBox(boxes: readonly Box[]): Box {
  return {
    x: median(boxes.map((box) => box.x)),
    y: median(boxes.map((box) => box.y)),
    width: median(boxes.map((box) => box.width)),
    height: median(boxes.map((box) => box.height)),
  };
}
function holdReasons(take: CalibrationTake, policy: CalibrationPolicy): string[] {
  const { bridge } = take;
  const times = [
    take.presentedJsUs,
    take.releasedJsUs,
    take.recordStartNativeUs,
    take.recordEndNativeUs,
    bridge.nativeMinusJsUs,
    bridge.roundTripUs,
  ];
  if (!times.every(Number.isFinite) || bridge.roundTripUs < 0 || bridge.roundTripUs > 100_000)
    return ['INVALID_HOLD_CLOCK'];
  // Require clock uncertainty to fit within BOTH stationary boundaries.
  const startJs = take.recordStartNativeUs - bridge.nativeMinusJsUs - bridge.roundTripUs / 2;
  const endJs = take.recordEndNativeUs - bridge.nativeMinusJsUs + bridge.roundTripUs / 2;
  if (
    !take.completed ||
    endJs <= startJs ||
    take.presentedJsUs + policy.settleUs > startJs ||
    take.releasedJsUs < endJs
  )
    return ['TARGET_NOT_HELD'];
  return [];
}
export function fitCalibration(args: {
  id: string;
  createdAtMs: number;
  context: CalibrationContext;
  takes: CalibrationTake[];
}): CalibrationResult {
  const policy = { ...CALIBRATION_POLICY };
  const result: CalibrationResult = {
    schemaVersion: 1,
    modelVersion: CALIBRATION_MODEL_VERSION,
    id: args.id,
    createdAtMs: args.createdAtMs,
    context: { ...args.context },
    verdict: 'RETRY',
    reasons: [],
    targetQuality: [],
    models: {},
    synchronization: 'stationary-target-recording',
    units: 'target-viewport-fraction',
    policy,
  };
  if (!validContext(args.context) || !Number.isFinite(args.createdAtMs))
    result.reasons.push('INVALID_CONTEXT');
  if (args.takes.length !== CALIBRATION_TARGETS.length) result.reasons.push('INCOMPLETE_SEQUENCE');
  if (
    args.takes.some(
      (take, i) =>
        take.target.id !== CALIBRATION_TARGETS[i]?.id ||
        (i > 0 && take.recordStartNativeUs <= args.takes[i - 1].recordEndNativeUs),
    )
  )
    result.reasons.push('INVALID_SEQUENCE_ORDER');
  for (const expected of CALIBRATION_TARGETS) {
    const matches = args.takes.filter((t) => t.target.id === expected.id);
    if (
      matches.length !== 1 ||
      matches[0].target.x !== expected.x ||
      matches[0].target.y !== expected.y ||
      matches[0].target.role !== expected.role
    ) {
      result.reasons.push(`INVALID_TARGET:${expected.id}`);
      continue;
    }
    for (const reason of holdReasons(matches[0], policy))
      result.reasons.push(`${reason}:${expected.id}`);
  }
  for (const side of ['left', 'right'] as const) {
    const acceptedBoxes: Box[] = [];
    const acceptedCrops: Box[] = [];
    const acceptedEyeWidths: number[] = [];
    const acceptedFeatures = new Map<string, { x: number; y: number }[]>();
    const rotations = new Set<number>();
    for (const take of args.takes) {
      const samples = take.samples.filter((s) => s.eyeSide === side);
      const reasons: string[] = [];
      const blocks = emptyBlocks();
      let previousPts = -Infinity;
      let previousIndex = -1;
      const usable = samples.flatMap((s) => {
        const timeValid =
          s.decodedPtsUs !== null &&
          Number.isFinite(s.decodedPtsUs) &&
          s.decodedPtsUs >= 0 &&
          s.decodedPtsUs > previousPts &&
          Number.isInteger(s.frameIndex) &&
          s.frameIndex >= 0 &&
          s.frameIndex > previousIndex;
        if (s.decodedPtsUs !== null && Number.isFinite(s.decodedPtsUs))
          previousPts = Math.max(previousPts, s.decodedPtsUs);
        previousIndex = Math.max(previousIndex, s.frameIndex);
        if (!timeValid) {
          reasons.push('INVALID_PTS');
          blocks.badTime += 1;
          return [];
        }
        if (s.estimated) {
          blocks.estimated += 1;
          return [];
        }
        if (s.faceRotation !== undefined && s.faceRotation !== null) rotations.add(s.faceRotation);
        const feature = gazeFeature(s);
        if (!feature) {
          blocks[featureMiss(s)] += 1;
          return [];
        }
        if (
          !Number.isFinite(s.confidence) ||
          s.confidence < policy.minConfidence ||
          s.confidence > 1
        ) {
          blocks.lowConfidence += 1;
          return [];
        }
        return [{ sample: s, feature }];
      });
      const mx = median(usable.map((row) => row.feature.x));
      const my = median(usable.map((row) => row.feature.y));
      const distances = usable.map((row) => Math.hypot(row.feature.x - mx, row.feature.y - my));
      const mad = median(distances);
      // Robustly trim isolated measurement errors; do not repair insufficient coverage.
      const accepted = usable.filter(
        (row) => Math.hypot(row.feature.x - mx, row.feature.y - my) <= Math.max(0.015, 3 * mad),
      );
      blocks.trimmed = usable.length - accepted.length;
      acceptedFeatures.set(
        take.target.id,
        accepted.map((row) => ({ x: row.feature.x, y: row.feature.y })),
      );
      // Aggregate exactly the feature that the mapper will consume. Rescaling
      // around 0.5 with a per-take size introduces target-dependent bias.
      const x = accepted.length ? median(accepted.map((row) => row.feature.x)) : null;
      const y = accepted.length ? median(accepted.map((row) => row.feature.y)) : null;
      const spread =
        x === null || y === null
          ? null
          : Math.sqrt(
              accepted.reduce(
                (sum, row) => sum + (row.feature.x - x) ** 2 + (row.feature.y - y) ** 2,
                0,
              ) / accepted.length,
            );
      const coverage = samples.length ? accepted.length / samples.length : 0;
      const spanUs =
        accepted.length > 1
          ? accepted[accepted.length - 1].sample.decodedPtsUs! - accepted[0].sample.decodedPtsUs!
          : 0;
      if (
        accepted.length < policy.minSamples ||
        coverage < policy.minCoverage ||
        spanUs < policy.minSpanUs
      )
        reasons.push('INSUFFICIENT_COVERAGE');
      if (spanUs > take.recordEndNativeUs - take.recordStartNativeUs + 100_000)
        reasons.push('INVALID_PTS_SPAN');
      if (spread === null) reasons.push('NO_VALID_SAMPLES');
      else if (spread > policy.maxSpread) reasons.push('UNSTABLE_FIXATION');
      // Compare the head anchor, never the eye crop which follows gaze.
      const ref = accepted.length ? medianBox(accepted.map((row) => row.feature.box)) : null;
      if (ref && accepted.some((row) => !roiCompatible(row.feature.box, ref)))
        reasons.push('HEAD_OR_ROI_MOVED');
      const quality: TargetQuality = {
        targetId: take.target.id,
        eyeSide: side,
        total: samples.length,
        accepted: accepted.length,
        rejected: samples.length - accepted.length,
        coverage,
        spanUs,
        spread,
        x,
        y,
        reasons: [...new Set(reasons)],
        blocks,
      };
      result.targetQuality.push(quality);
      for (const reason of quality.reasons)
        result.reasons.push(`${reason}:${side}:${take.target.id}`);
      acceptedBoxes.push(...accepted.map((row) => row.feature.box));
      acceptedCrops.push(...accepted.map((row) => row.sample.roi));
      acceptedEyeWidths.push(...accepted.map((row) => row.feature.unitPx));
    }
    const referenceRoi = medianBox(acceptedBoxes);
    if (
      rotations.size > 1 ||
      (args.context.faceRotationDegrees !== undefined &&
        (rotations.size !== 1 || !rotations.has(args.context.faceRotationDegrees)))
    )
      result.reasons.push(`ORIENTATION_CHANGED:${side}`);
    // Reuse the same existing 20% scale / 0.3 center-displacement guards in
    // fitting and mapping. Face normalization does not establish pose invariance.
    if (
      acceptedBoxes.length > 0 &&
      (!finiteRoi(referenceRoi) || acceptedBoxes.some((box) => !roiCompatible(box, referenceRoi)))
    )
      result.reasons.push(`HEAD_OR_ROI_MOVED:${side}`);
    const qualities = result.targetQuality.filter(
      (q) => q.eyeSide === side && q.x !== null && q.y !== null,
    );
    const fits = CALIBRATION_TARGETS.filter((t) => t.role === 'fit').map((t) => ({
      target: t,
      q: qualities.find((q) => q.targetId === t.id),
    }));
    const checks = CALIBRATION_TARGETS.filter((t) => t.role === 'validation').map((t) => ({
      target: t,
      q: qualities.find((q) => q.targetId === t.id),
    }));
    if (fits.some((p) => !p.q) || checks.some((p) => !p.q)) {
      result.reasons.push(`MISSING_TARGET_FEATURES:${side}`);
      continue;
    }
    const featureX = fits.map((p) => p.q!.x!);
    const featureY = fits.map((p) => p.q!.y!);
    const meanX = featureX.reduce((a, b) => a + b, 0) / fits.length;
    const meanY = featureY.reduce((a, b) => a + b, 0) / fits.length;
    const varX = featureX.reduce((a, x) => a + (x - meanX) ** 2, 0);
    const varY = featureY.reduce((a, y) => a + (y - meanY) ** 2, 0);
    const cov = featureX.reduce((a, x, i) => a + (x - meanX) * (featureY[i] - meanY), 0);
    // Preserve the original 1e-4 observability floor in its original eye-crop
    // units. Canthus-normalized variance is converted to reference-crop units;
    // otherwise the larger coordinate frame alone rejects sufficient motion.
    // Separately standardize the solve to avoid unit-dependent conditioning.
    const sx = Math.sqrt(varX / fits.length);
    const sy = Math.sqrt(varY / fits.length);
    const epsilon = Number.EPSILON * Math.max(1, Math.abs(meanX), Math.abs(meanY));
    const referenceCrop = medianBox(acceptedCrops);
    const cropVarianceX = varX * (median(acceptedEyeWidths) / referenceCrop.width) ** 2;
    const cropVarianceY = varY * (median(acceptedEyeWidths) / referenceCrop.height) ** 2;
    if (
      cropVarianceX < 1e-4 ||
      cropVarianceY < 1e-4 ||
      sx <= epsilon ||
      sy <= epsilon ||
      1 - cov ** 2 / (varX * varY) < 0.02
    ) {
      result.reasons.push(`DEGENERATE_FEATURES:${side}`);
      continue;
    }
    const selection = selectRegression(
      fits.map((p) => ({ x: p.q!.x!, y: p.q!.y!, targetX: p.target.x, targetY: p.target.y })),
    );
    if (!selection.selected) {
      result.reasons.push(
        `${selection.candidates.length ? 'UNSAFE_MAPPING' : 'SINGULAR_FIT'}:${side}`,
      );
      continue;
    }
    const { regression, fitCvRmse } = selection.selected;
    const residual = (p: (typeof fits)[number]) => {
      const prediction = evaluateRegression(regression, p.q!.x!, p.q!.y!);
      return { x: prediction.x - p.target.x, y: prediction.y - p.target.y };
    };
    const fitRmse = Math.sqrt(
      fits.reduce((a, p) => {
        const e = residual(p);
        return a + e.x ** 2 + e.y ** 2;
      }, 0) / fits.length,
    );
    for (const point of [...fits, ...checks]) {
      const e = residual(point);
      point.q!.predictionError = { ...e, distance: Math.hypot(e.x, e.y) };
    }
    // Target medians can look accurate while individual frames are very noisy.
    // Every held-out target must ALSO pass frame RMS and p95 gates.
    for (const point of checks) {
      const frameErrors = (acceptedFeatures.get(point.target.id) ?? [])
        .map((p) => {
          const prediction = evaluateRegression(regression, p.x, p.y);
          return Math.hypot(prediction.x - point.target.x, prediction.y - point.target.y);
        })
        .sort((a, b) => a - b);
      if (frameErrors.length && frameErrors.every(Number.isFinite)) {
        const withinTolerance = frameErrors.filter((e) => e <= policy.maxValidationRmse).length;
        point.q!.validationFrames = {
          accepted: frameErrors.length,
          withinTolerance,
          withinTolerancePercent: (100 * withinTolerance) / frameErrors.length,
          rmse: Math.sqrt(frameErrors.reduce((s, e) => s + e * e, 0) / frameErrors.length),
          p95Error: frameErrors[Math.ceil(frameErrors.length * 0.95) - 1],
        };
      }
      if (
        !point.q!.validationFrames ||
        point.q!.validationFrames!.rmse > policy.maxValidationFrameRmse ||
        point.q!.validationFrames!.p95Error > policy.maxValidationFrameP95Error
      )
        result.reasons.push(`NOISY_VALIDATION:${side}:${point.target.id}`);
    }
    const errors = checks.map(residual);
    const validationRmse = Math.sqrt(
      errors.reduce((a, e) => a + e.x ** 2 + e.y ** 2, 0) / errors.length,
    );
    const validationMaxError = Math.max(...errors.map((e) => Math.hypot(e.x, e.y)));
    if (fitRmse > policy.maxFitRmse) result.reasons.push(`POOR_FIT:${side}`);
    if (fitCvRmse > policy.maxFitCvRmse) result.reasons.push(`POOR_FIT_CV:${side}`);
    if (validationRmse > policy.maxValidationRmse || validationMaxError > policy.maxValidationError)
      result.reasons.push(`POOR_VALIDATION:${side}`);
    const model: EyeCalibration = {
      ...regression,
      eyeSide: side,
      referenceRoi,
      referenceRotation: rotations.size === 1 ? [...rotations][0] : undefined,
      featureBounds: {
        minX: Math.min(...featureX),
        maxX: Math.max(...featureX),
        minY: Math.min(...featureY),
        maxY: Math.max(...featureY),
      },
      fitRmse,
      fitCvRmse,
      validationRmse,
      validationMaxError,
      validationFrameRmse: Math.max(...checks.map((p) => p.q!.validationFrames?.rmse ?? Infinity)),
      validationFrameP95Error: Math.max(
        ...checks.map((p) => p.q!.validationFrames?.p95Error ?? Infinity),
      ),
      validationBias: {
        x: errors.reduce((a, e) => a + e.x, 0) / errors.length,
        y: errors.reduce((a, e) => a + e.y, 0) / errors.length,
      },
      quality: Math.max(0, 1 - validationRmse / policy.maxValidationRmse),
    };
    result.models[side] = model;
  }
  result.reasons = [...new Set(result.reasons)];
  if (result.reasons.length === 0 && result.models.left && result.models.right)
    result.verdict = 'VALID';
  return result;
}
/** Recalculate saved model errors: finite but altered coefficients must not retain VALID. */
function savedErrorsMatch(
  result: CalibrationResult,
  model: EyeCalibration,
  side: 'left' | 'right',
): boolean {
  if (model.eyeSide !== side) return false;
  const points = CALIBRATION_TARGETS.filter((t) => t.role === 'fit').map((t) => {
    const q = result.targetQuality.find((row) => row.eyeSide === side && row.targetId === t.id)!;
    return { x: q.x!, y: q.y!, targetX: t.x, targetY: t.y };
  });
  const selected = selectRegression(points).selected;
  if (!selected || !validRegression(model) || !regressionGeometrySafe(model, model.featureBounds))
    return false;
  const expected = selected.regression;
  const close = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  if (
    model.family !== expected.family ||
    model.lambda !== expected.lambda ||
    !close(model.fitCvRmse, selected.fitCvRmse) ||
    !(['x', 'y'] as const).every(
      (axis) =>
        close(model.featureCenter[axis], expected.featureCenter[axis]) &&
        close(model.featureScale[axis], expected.featureScale[axis]),
    ) ||
    !model.coefficientsX.every((c, i) => close(c, expected.coefficientsX[i])) ||
    !model.coefficientsY.every((c, i) => close(c, expected.coefficientsY[i])) ||
    !close(model.featureBounds.minX, Math.min(...points.map((p) => p.x))) ||
    !close(model.featureBounds.maxX, Math.max(...points.map((p) => p.x))) ||
    !close(model.featureBounds.minY, Math.min(...points.map((p) => p.y))) ||
    !close(model.featureBounds.maxY, Math.max(...points.map((p) => p.y)))
  )
    return false;
  const residuals = (role: 'fit' | 'validation') =>
    CALIBRATION_TARGETS.filter((t) => t.role === role).map((t) => {
      const q = result.targetQuality.find((row) => row.eyeSide === side && row.targetId === t.id)!;
      const prediction = evaluateRegression(model, q.x!, q.y!);
      return Math.hypot(prediction.x - t.x, prediction.y - t.y);
    });
  const fit = residuals('fit'),
    checks = residuals('validation');
  const rmse = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
  const frames = result.targetQuality.filter(
    (q) =>
      q.eyeSide === side &&
      CALIBRATION_TARGETS.some((t) => t.id === q.targetId && t.role === 'validation'),
  );
  if (
    frames.length !== 5 ||
    frames.some((q) => {
      const f = q.validationFrames;
      return (
        !f ||
        f.accepted !== q.accepted ||
        !Number.isInteger(f.withinTolerance) ||
        f.withinTolerance < 0 ||
        f.withinTolerance > f.accepted ||
        !close(f.withinTolerancePercent, (100 * f.withinTolerance) / f.accepted) ||
        !Number.isFinite(f.rmse) ||
        f.rmse < 0 ||
        f.rmse > CALIBRATION_POLICY.maxValidationFrameRmse ||
        !Number.isFinite(f.p95Error) ||
        f.p95Error < 0 ||
        f.p95Error > CALIBRATION_POLICY.maxValidationFrameP95Error
      );
    })
  )
    return false;
  return (
    Math.abs(rmse(fit) - model.fitRmse) < 1e-9 &&
    Math.abs(rmse(checks) - model.validationRmse) < 1e-9 &&
    Math.abs(Math.max(...checks) - model.validationMaxError) < 1e-9 &&
    close(model.validationFrameRmse, Math.max(...frames.map((q) => q.validationFrames!.rmse))) &&
    close(
      model.validationFrameP95Error,
      Math.max(...frames.map((q) => q.validationFrames!.p95Error)),
    ) &&
    close(
      model.quality,
      Math.max(0, 1 - model.validationRmse / CALIBRATION_POLICY.maxValidationRmse),
    )
  );
}

export function calibrationUsable(
  result: CalibrationResult,
  context: CalibrationContext,
  nowMs: number,
): boolean {
  try {
    return (
      result.schemaVersion === 1 &&
      result.modelVersion === CALIBRATION_MODEL_VERSION &&
      result.synchronization === 'stationary-target-recording' &&
      result.units === 'target-viewport-fraction' &&
      result.verdict === 'VALID' &&
      Array.isArray(result.reasons) &&
      result.reasons.length === 0 &&
      validContext(context) &&
      sameCalibrationContext(result.context, context) &&
      Number.isFinite(nowMs) &&
      nowMs >= result.createdAtMs &&
      nowMs - result.createdAtMs <= CALIBRATION_POLICY.maxAgeMs &&
      result.targetQuality.length === CALIBRATION_TARGETS.length * 2 &&
      (['left', 'right'] as const).every((side) =>
        CALIBRATION_TARGETS.every((target) => {
          const matches = result.targetQuality.filter(
            (q) => q.eyeSide === side && q.targetId === target.id,
          );
          if (matches.length !== 1) return false;
          const q = matches[0];
          return (
            Array.isArray(q.reasons) &&
            q.reasons.length === 0 &&
            q.x !== null &&
            q.y !== null &&
            q.spread !== null &&
            Number.isInteger(q.accepted) &&
            Number.isInteger(q.total) &&
            q.total > 0 &&
            Math.abs(q.coverage - q.accepted / q.total) < 1e-12 &&
            [q.x, q.y, q.accepted, q.total, q.coverage, q.spanUs, q.spread].every(
              Number.isFinite,
            ) &&
            q.accepted >= CALIBRATION_POLICY.minSamples &&
            q.total >= q.accepted &&
            q.coverage >= CALIBRATION_POLICY.minCoverage &&
            q.coverage <= 1 &&
            q.spanUs >= CALIBRATION_POLICY.minSpanUs &&
            q.spread! >= 0 &&
            q.x! >= -0.25 &&
            q.x! <= 1.25 &&
            q.y! >= -0.25 &&
            q.y! <= 1.25 &&
            q.spread! <= CALIBRATION_POLICY.maxSpread
          );
        }),
      ) &&
      (['left', 'right'] as const).every((side) => {
        const model = result.models[side];
        return (
          !!model &&
          (context.faceRotationDegrees === undefined ||
            model.referenceRotation === context.faceRotationDegrees) &&
          savedErrorsMatch(result, model, side) &&
          validRegression(model) &&
          [
            ...model.coefficientsX,
            ...model.coefficientsY,
            model.quality,
            model.fitRmse,
            model.fitCvRmse,
            model.validationRmse,
            model.validationMaxError,
            model.validationFrameRmse,
            model.validationFrameP95Error,
          ].every(Number.isFinite) &&
          model.quality >= 0 &&
          model.quality <= 1 &&
          model.fitRmse >= 0 &&
          model.fitCvRmse >= 0 &&
          model.validationRmse >= 0 &&
          model.validationMaxError >= 0 &&
          model.fitRmse <= CALIBRATION_POLICY.maxFitRmse &&
          model.fitCvRmse <= CALIBRATION_POLICY.maxFitCvRmse &&
          model.validationFrameRmse >= 0 &&
          model.validationFrameRmse <= CALIBRATION_POLICY.maxValidationFrameRmse &&
          model.validationFrameP95Error >= 0 &&
          model.validationFrameP95Error <= CALIBRATION_POLICY.maxValidationFrameP95Error &&
          model.validationRmse <= CALIBRATION_POLICY.maxValidationRmse &&
          model.validationMaxError <= CALIBRATION_POLICY.maxValidationError &&
          finiteRoi(model.referenceRoi) &&
          Object.values(model.featureBounds).every(Number.isFinite) &&
          model.featureBounds.maxX > model.featureBounds.minX &&
          model.featureBounds.maxY > model.featureBounds.minY
        );
      })
    );
  } catch {
    return false;
  }
}
export type CalibrationMapper = (
  observation: EyeObservation,
) => { x: number; y: number; confidence: number } | null;

/** Validate once at capture time and privately snapshot the small mapping models.
 * Every observation still passes time, confidence, ROI and extrapolation gates. */
export function createCalibrationMapper(
  result: CalibrationResult,
  context: CalibrationContext,
  nowMs: number,
): CalibrationMapper {
  if (!calibrationUsable(result, context, nowMs)) return () => null;
  const copyModel = (model: EyeCalibration): EyeCalibration => ({
    ...model,
    coefficientsX: [...model.coefficientsX],
    coefficientsY: [...model.coefficientsY],
    featureCenter: { ...model.featureCenter },
    featureScale: { ...model.featureScale },
    referenceRoi: { ...model.referenceRoi },
    featureBounds: { ...model.featureBounds },
  });
  const models = {
    left: copyModel(result.models.left!),
    right: copyModel(result.models.right!),
  };
  return (observation) => mapObservation(models[observation.eyeSide], observation);
}

function mapObservation(model: EyeCalibration | undefined, observation: EyeObservation) {
  const feature = gazeFeature(observation);
  if (
    !model ||
    !feature ||
    !roiCompatible(feature.box, model.referenceRoi) ||
    (model.referenceRotation !== undefined &&
      model.referenceRotation !== observation.faceRotation) ||
    observation.estimated ||
    !Number.isInteger(observation.frameIndex) ||
    observation.frameIndex < 0 ||
    observation.decodedPtsUs === null ||
    !Number.isFinite(observation.decodedPtsUs) ||
    observation.decodedPtsUs < 0 ||
    !Number.isFinite(observation.confidence) ||
    observation.confidence < CALIBRATION_POLICY.minConfidence ||
    observation.confidence > 1
  )
    return null;
  const b = model.featureBounds;
  const margin = model.family === 'quadratic-ridge' ? 0 : 0.1;
  const dx = (b.maxX - b.minX) * margin;
  const dy = (b.maxY - b.minY) * margin;
  if (
    feature.x < b.minX - dx ||
    feature.x > b.maxX + dx ||
    feature.y < b.minY - dy ||
    feature.y > b.maxY + dy
  )
    return null;
  const { x, y } = evaluateRegression(model, feature.x, feature.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y, confidence: Math.min(observation.confidence, model.quality) };
}

export function mapCalibration(
  result: CalibrationResult,
  observation: EyeObservation,
  context: CalibrationContext,
  nowMs: number,
): ReturnType<CalibrationMapper> {
  return createCalibrationMapper(result, context, nowMs)(observation);
}
