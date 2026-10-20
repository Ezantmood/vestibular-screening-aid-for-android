import { CALIBRATION_TARGETS } from './protocol';
import { currentPupilMeasurement } from './types';
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
/** Solve 3x3 normal equations with scaled pivoting; refuse singular features. */
function solve(rows: number[][], values: number[]): [number, number, number] | null {
  const a = Array.from({ length: 3 }, (_, i) => [
    ...Array.from({ length: 3 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
    rows.reduce((s, r, j) => s + r[i] * values[j], 0),
  ]);
  for (let k = 0; k < 3; k++) {
    let pivot = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-8) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const scale = a[k][k];
    for (let j = k; j < 4; j++) a[k][j] /= scale;
    for (let i = 0; i < 3; i++)
      if (i !== k) {
        const factor = a[i][k];
        for (let j = k; j < 4; j++) a[i][j] -= factor * a[k][j];
      }
  }
  const result: [number, number, number] = [a[0][3], a[1][3], a[2][3]];
  return result.every(Number.isFinite) ? result : null;
}
function evaluate(c: [number, number, number], x: number, y: number): number {
  return c[0] + c[1] * x + c[2] * y;
}
type Box = EyeObservation['roi'];

function emptyBlocks(): SampleBlocks {
  return {
    noPupil: 0,
    lowConfidence: 0,
    noFace: 0,
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
function featureMiss(sample: EyeObservation): 'noPupil' | 'noFace' | 'outsideFace' {
  if (!pupilInCrop(sample)) return 'noPupil';
  if (sample.face !== undefined && (sample.face === null || !finiteRoi(sample.face)))
    return 'noFace';
  return 'outsideFace';
}
/** Gaze feature. A face box is the head anchor: pupil position in that box.
 * The eye crop follows the landmark, so position inside the crop cancels gaze.
 * The crop is larger than the tight face rectangle, so a real pupil may sit
 * slightly outside 0..1. Values beyond that margin are a coordinate mismatch.
 * Samples with no face field keep the older ROI-normalized feature.
 * `box` is the coordinate frame used to compare size, not a position lock. */
export function gazeFeature(sample: EyeObservation): { x: number; y: number; box: Box } | null {
  if (!pupilInCrop(sample)) return null;
  if (sample.face === undefined) return { x: sample.x!, y: sample.y!, box: sample.roi };
  if (sample.face === null || !finiteRoi(sample.face)) return null;
  const frameX = sample.roi.x + sample.x! * sample.roi.width;
  const frameY = sample.roi.y + sample.y! * sample.roi.height;
  const x = (frameX - sample.face.x) / sample.face.width;
  const y = (frameY - sample.face.y) / sample.face.height;
  if (![x, y].every((value) => Number.isFinite(value) && value >= -0.25 && value <= 1.25))
    return null;
  return { x, y, box: sample.face };
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
      const stable = stableNormalizedPoint(
        accepted.map((row) => ({
          x: row.feature.x,
          y: row.feature.y,
          roi: row.feature.box,
        })),
      );
      const x = stable?.x ?? null;
      const y = stable?.y ?? null;
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
      if (spread === null || spread > policy.maxSpread) reasons.push('UNSTABLE_FIXATION');
      // The eye crop may move between targets because the landmark follows gaze.
      // Inside one held target it should stay still. The face box is the feature
      // origin, so it is not a position lock.
      const ref = accepted.length ? medianBox(accepted.map((row) => row.sample.roi)) : null;
      if (ref && accepted.some((row) => !roiCompatible(row.sample.roi, ref)))
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
      acceptedBoxes.push(...accepted.map((row) => row.sample.roi));
    }
    const referenceRoi = medianBox(acceptedBoxes);
    // Size must stay stable across targets. Position may change: the eye
    // landmark follows gaze, and the face box is already the feature origin.
    if (
      acceptedBoxes.length > 0 &&
      (!finiteRoi(referenceRoi) ||
        acceptedBoxes.some((box) => !roiScaleCompatible(box, referenceRoi)))
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
    if (varX < 1e-4 || varY < 1e-4 || 1 - cov ** 2 / (varX * varY) < 0.02) {
      result.reasons.push(`DEGENERATE_FEATURES:${side}`);
      continue;
    }
    const rows = fits.map((p) => [1, p.q!.x!, p.q!.y!]);
    const cx = solve(
      rows,
      fits.map((p) => p.target.x),
    );
    const cy = solve(
      rows,
      fits.map((p) => p.target.y),
    );
    if (!cx || !cy) {
      result.reasons.push(`SINGULAR_FIT:${side}`);
      continue;
    }
    const residual = (p: (typeof fits)[number]) => ({
      x: evaluate(cx, p.q!.x!, p.q!.y!) - p.target.x,
      y: evaluate(cy, p.q!.x!, p.q!.y!) - p.target.y,
    });
    const fitRmse = Math.sqrt(
      fits.reduce((a, p) => {
        const e = residual(p);
        return a + e.x ** 2 + e.y ** 2;
      }, 0) / fits.length,
    );
    const errors = checks.map(residual);
    const validationRmse = Math.sqrt(
      errors.reduce((a, e) => a + e.x ** 2 + e.y ** 2, 0) / errors.length,
    );
    const validationMaxError = Math.max(...errors.map((e) => Math.hypot(e.x, e.y)));
    if (fitRmse > policy.maxFitRmse) result.reasons.push(`POOR_FIT:${side}`);
    if (validationRmse > policy.maxValidationRmse || validationMaxError > policy.maxValidationError)
      result.reasons.push(`POOR_VALIDATION:${side}`);
    const model: EyeCalibration = {
      eyeSide: side,
      coefficientsX: cx,
      coefficientsY: cy,
      referenceRoi,
      featureBounds: {
        minX: Math.min(...featureX),
        maxX: Math.max(...featureX),
        minY: Math.min(...featureY),
        maxY: Math.max(...featureY),
      },
      fitRmse,
      validationRmse,
      validationMaxError,
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
export function calibrationUsable(
  result: CalibrationResult,
  context: CalibrationContext,
  nowMs: number,
): boolean {
  try {
    return (
      result.schemaVersion === 1 &&
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
            [q.x, q.y, q.accepted, q.total, q.coverage, q.spanUs, q.spread].every(
              Number.isFinite,
            ) &&
            q.accepted >= CALIBRATION_POLICY.minSamples &&
            q.total >= q.accepted &&
            q.coverage >= CALIBRATION_POLICY.minCoverage &&
            q.coverage <= 1 &&
            q.spanUs >= CALIBRATION_POLICY.minSpanUs &&
            q.spread! >= 0 &&
            q.spread! <= CALIBRATION_POLICY.maxSpread
          );
        }),
      ) &&
      (['left', 'right'] as const).every((side) => {
        const model = result.models[side];
        return (
          !!model &&
          model.coefficientsX.length === 3 &&
          model.coefficientsY.length === 3 &&
          [
            ...model.coefficientsX,
            ...model.coefficientsY,
            model.quality,
            model.fitRmse,
            model.validationRmse,
            model.validationMaxError,
          ].every(Number.isFinite) &&
          model.quality >= 0 &&
          model.quality <= 1 &&
          model.fitRmse >= 0 &&
          model.validationRmse >= 0 &&
          model.validationMaxError >= 0 &&
          model.fitRmse <= CALIBRATION_POLICY.maxFitRmse &&
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
  const dx = (b.maxX - b.minX) * 0.1;
  const dy = (b.maxY - b.minY) * 0.1;
  if (
    feature.x < b.minX - dx ||
    feature.x > b.maxX + dx ||
    feature.y < b.minY - dy ||
    feature.y > b.maxY + dy
  )
    return null;
  const x = evaluate(model.coefficientsX, feature.x, feature.y);
  const y = evaluate(model.coefficientsY, feature.x, feature.y);
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
