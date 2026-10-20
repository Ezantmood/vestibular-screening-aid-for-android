import assert from './assert';
import {
  fitCalibration,
  mapCalibration,
  calibrationUsable,
  createCalibrationMapper,
  gazeFeature,
  stableNormalizedPoint,
} from '../src/eyetracking/calibration/calibration';
import { trackingObservations } from '../src/eyetracking/tracking/observations';
import type { PupilTrackingResult } from '../src/eyetracking/tracking/trackingTypes';
import { CALIBRATION_TARGETS } from '../src/eyetracking/calibration/protocol';
import type { CalibrationContext, CalibrationTake } from '../src/eyetracking/calibration/types';
import { buildSuccessResult } from '../src/eyetracking/pupil/coordinates';
import { finalTrack } from '../src/eyetracking/tracking/twoPassTracking';
import { processTrackingSignals } from '../src/signals/trackingSignals';
import { calibrationInsights, calibrationFeedback } from '../src/eyetracking/calibration/insights';
import { currentPupilMeasurement } from '../src/eyetracking/calibration/types';

const context: CalibrationContext = {
  cameraId: '1',
  width: 1920,
  height: 1080,
  fps: 120,
  viewportWidth: 340,
  viewportHeight: 180,
  viewportLeft: 16,
  viewportTop: 100,
  detectorId: 'percentile-dark',
  coordinateVersion: 'face-pupil-v5',
};
const time = 100_000;
function fixture(): CalibrationTake[] {
  return CALIBRATION_TARGETS.map((target, j) => ({
    target: { ...target },
    presentedJsUs: j * 5_000_000,
    releasedJsUs: j * 5_000_000 + 3_000_000,
    recordStartNativeUs: j * 5_000_000 + 1_000_000,
    recordEndNativeUs: j * 5_000_000 + 2_500_000,
    bridge: { nativeMinusJsUs: 0, roundTripUs: 1000 },
    completed: true,
    filePath: 'local.mp4',
    samples: (['left', 'right'] as const).flatMap((eyeSide) =>
      Array.from({ length: 100 }, (_, frameIndex) => ({
        frameIndex,
        decodedPtsUs: frameIndex * 9000,
        eyeSide,
        // Rotated and mirrored relation: affine fit must learn both without anatomy assumptions.
        x: 0.3 + 0.25 * target.y + 0.02 * target.x + (frameIndex % 2 ? 0.001 : -0.001),
        y: 0.7 - 0.25 * target.x + 0.01 * target.y + (frameIndex % 3 ? 0.001 : -0.001),
        confidence: 0.85,
        roi: { x: 100, y: 200, width: 100, height: 80 },
        estimated: false,
      })),
    ),
  }));
}
const fit = (takes = fixture()) =>
  fitCalibration({ id: 'test', createdAtMs: time, context, takes });
const result = fit();
assert.equal(currentPupilMeasurement(undefined), false);
assert.equal(currentPupilMeasurement('decoded-roi-v3'), false);
assert.equal(currentPupilMeasurement('decoded-roi-v4'), false);
assert.equal(currentPupilMeasurement('face-pupil-v5'), true);
const stable = stableNormalizedPoint([
  { x: 0.6, y: 0.5, roi: { width: 100, height: 100 } },
  { x: 0.55, y: 0.5, roi: { width: 200, height: 100 } },
]);
assert.ok(Math.abs(stable!.x - (0.5 + 10 / 150)) < 1e-9);
assert.equal(stable!.y, 0.5);
assert.equal(
  calibrationUsable(
    {
      ...result,
      context: { ...result.context, coordinateVersion: 'decoded-roi-v2' },
    } as unknown as typeof result,
    context,
    time,
  ),
  false,
);
const insights = calibrationInsights(result);
assert.equal(insights[0].fitTargetsWithFeatures, 9);
assert.ok(insights[0].targetCorrelation.featureXTargetY! > 0.99);
assert.ok(insights[0].targetCorrelation.featureYTargetX! < -0.99);
assert.ok(insights[0].validationAxisRmse!.x < 0.01);
assert.ok(insights[0].centerRepeatFeatureDistance! < 0.01);
assert.equal(calibrationFeedback(result).length, 1);
assert.equal(calibrationInsights(null)[0].featureSpanX, null);
assert.equal(
  calibrationInsights({
    targetQuality: [{ targetId: 'fit-0-0', eyeSide: 'left', x: NaN, y: 0.5 }],
  })[0].fitTargetsWithFeatures,
  0,
);
assert.equal(
  calibrationUsable({ schemaVersion: 1 } as unknown as typeof result, context, time),
  false,
);
assert.equal(calibrationUsable({ ...result, targetQuality: [] }, context, time), false);
assert.equal(result.verdict, 'VALID', result.reasons.join(','));
assert.ok(result.models.left!.validationRmse < 0.01);
const input = fixture()[4].samples[10];
const mapped = mapCalibration(result, input, context, time + 1000);
assert.ok(mapped && Math.abs(mapped.x - 0.5) < 0.02 && Math.abs(mapped.y - 0.5) < 0.02);
const observations = fixture()[4].samples;
const rawResults = observations.map((s) =>
  buildSuccessResult({
    frameIndex: s.frameIndex,
    decodedPtsUs: s.decodedPtsUs,
    eyeSide: s.eyeSide,
    detectorId: 'percentile-dark',
    box: { roiX: s.roi.x, roiY: s.roi.y, roiWidth: s.roi.width, roiHeight: s.roi.height },
    centroid: {
      centroidXInRoi: s.x! * s.roi.width,
      centroidYInRoi: s.y! * s.roi.height,
      candidateWidth: 20,
      candidateHeight: 20,
      confidence: s.confidence,
    },
  }),
);
const tracks = finalTrack(rawResults);
const replay = { rawResults, tracked: [...tracks.left, ...tracks.right] };
const replayBefore = JSON.stringify(replay);
const batchSignals = processTrackingSignals(replay, result, context, time + 1000);
for (const eye of batchSignals) {
  assert.equal(eye.calibrated!.qualityAfter.coverage, 1);
  const samples = observations.filter((s) => s.eyeSide === eye.eyeSide);
  eye.calibrated!.raw.forEach((s, i) => {
    const expected = mapCalibration(result, samples[i], context, time + 1000)!;
    assert.ok(Math.abs(s.x! - expected.x) < 1e-12);
    assert.ok(Math.abs(s.y! - expected.y) < 1e-12);
  });
}
const rejectedSignals = processTrackingSignals(
  replay,
  { ...result, verdict: 'RETRY' },
  context,
  time,
);
assert.ok(rejectedSignals.every((eye) => eye.calibrated!.qualityAfter.usable === 0));
assert.equal(JSON.stringify(replay), replayBefore);
const mapper = createCalibrationMapper(result, context, time + 1000);
for (const sample of fixture().flatMap((take) => take.samples))
  assert.equal(
    JSON.stringify(mapper(sample)),
    JSON.stringify(mapCalibration(result, sample, context, time + 1000)),
  );
const mutable = fit();
const snapshot = createCalibrationMapper(mutable, context, time + 1000);
mutable.models.left!.coefficientsX[0] = 100;
mutable.models.left!.featureBounds.minX = 100;
mutable.models.left!.referenceRoi.x = 1000;
mutable.verdict = 'RETRY';
assert.equal(JSON.stringify(snapshot(input)), JSON.stringify(mapped));
assert.equal(createCalibrationMapper(mutable, context, time)(input), null);
assert.equal(createCalibrationMapper(result, context, time + 16 * 60_000)(input), null);
for (const bad of [
  { ...input, frameIndex: -1 },
  { ...input, frameIndex: 1.5 },
  { ...input, decodedPtsUs: -1 },
  { ...input, decodedPtsUs: NaN },
  { ...input, x: -0.01 },
  { ...input, y: 1.01 },
  { ...input, confidence: NaN },
  { ...input, roi: { ...input.roi, x: NaN } },
])
  assert.equal(mapper(bad), null);
assert.equal(calibrationUsable(result, { ...context, cameraId: '0' }, time), false);
assert.equal(calibrationUsable(result, { ...context, viewportHeight: 181 }, time), false);
assert.equal(
  calibrationUsable(result, { ...context, viewportTop: context.viewportTop + 1 }, time),
  false,
);
assert.equal(calibrationUsable(result, context, time + 16 * 60_000), false);
assert.equal(calibrationUsable(result, context, time - 1), false);
assert.equal(mapCalibration(result, { ...input, estimated: true }, context, time), null);
assert.equal(mapCalibration(result, { ...input, decodedPtsUs: null }, context, time), null);
assert.equal(
  JSON.stringify(
    mapCalibration(result, { ...input, roi: { ...input.roi, x: 400 } }, context, time + 1000),
  ),
  JSON.stringify(mapped),
);
assert.equal(mapCalibration(result, { ...input, x: 0.99 }, context, time), null);
let takes = fixture();
takes[0].samples = [];
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
takes.pop();
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
takes[0].target = { ...takes[1].target };
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
takes[0].completed = false;
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
takes[0].presentedJsUs = 900_000;
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
takes[0].releasedJsUs = 2_000_000;
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
takes[0].bridge.roundTripUs = Infinity;
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
for (const t of takes)
  for (const s of t.samples) {
    s.x = 0.5;
    s.y = 0.5;
  }
assert.equal(fit(takes).verdict, 'RETRY');
takes = fixture();
for (const t of takes) if (t.target.role === 'validation') for (const s of t.samples) s.x! += 0.1;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('POOR_VALIDATION')));
const shifted = calibrationInsights(fit(takes))[0];
assert.ok(shifted.validationAxisRmse!.y > 0.2);
assert.ok(shifted.centerRepeatFeatureDistance! > 0.09);
assert.ok(calibrationFeedback(fit(takes)).some((m) => m.includes('ánh xạ chưa đạt')));
takes = fixture();
takes[0].samples[2].decodedPtsUs = 0;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('INVALID_PTS')));
takes = fixture();
for (const s of takes[0].samples) s.roi.width *= 1.8;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('HEAD_OR_ROI_MOVED')));
takes = fixture();
for (const s of takes[0].samples) s.confidence = 0.2;
const lowConfidence = fit(takes);
assert.equal(lowConfidence.verdict, 'RETRY');
assert.ok(lowConfidence.targetQuality[0].blocks.lowConfidence > 0);
assert.ok(calibrationFeedback(lowConfidence).some((line) => line.includes('độ tin cậy dưới 0,5')));
const before = JSON.stringify(takes);
fit(takes);
assert.equal(JSON.stringify(takes), before);
assert.equal(mapCalibration(fit(takes), input, context, time), null);
// Bad order and impossible media duration must never create an accepted model.
takes = fixture();
[takes[0], takes[1]] = [takes[1], takes[0]];
assert.ok(fit(takes).reasons.includes('INVALID_SEQUENCE_ORDER'));
takes = fixture();
for (const s of takes[0].samples) s.decodedPtsUs! *= 10;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('INVALID_PTS_SPAN')));
const face = { x: 100, y: 80, width: 600, height: 800 };
const crop = { width: 90, height: 70 };
const chased = fit(
  CALIBRATION_TARGETS.map((target, j) => {
    const gazeX = 0.35 + 0.2 * target.x;
    const gazeY = 0.4 + 0.15 * target.y;
    const frameX = face.x + gazeX * face.width;
    const frameY = face.y + gazeY * face.height;
    const roi = {
      x: frameX - crop.width / 2,
      y: frameY - crop.height / 2,
      width: crop.width,
      height: crop.height,
    };
    return {
      target: { ...target },
      presentedJsUs: j * 5_000_000,
      releasedJsUs: j * 5_000_000 + 3_000_000,
      recordStartNativeUs: j * 5_000_000 + 1_000_000,
      recordEndNativeUs: j * 5_000_000 + 2_500_000,
      bridge: { nativeMinusJsUs: 0, roundTripUs: 1000 },
      completed: true,
      filePath: 'local.mp4',
      samples: (['left', 'right'] as const).flatMap((eyeSide) =>
        Array.from({ length: 100 }, (_, frameIndex) => ({
          frameIndex,
          decodedPtsUs: frameIndex * 9000,
          eyeSide,
          x: 0.5,
          y: 0.5,
          confidence: 0.9,
          roi,
          face,
          estimated: false,
        })),
      ),
    };
  }),
);
assert.equal(chased.verdict, 'VALID', chased.reasons.join(','));
const pupil = [500, 560];
const anchors = [
  { x: 200, y: 100, width: 800, height: 900 },
  { x: 200, y: 100, width: 800, height: 900 },
];
const raw = pupil.map((x, frameIndex) =>
  buildSuccessResult({
    frameIndex,
    decodedPtsUs: frameIndex,
    eyeSide: 'left',
    detectorId: 'percentile-dark',
    box: { roiX: x - 60, roiY: 340, roiWidth: 120, roiHeight: 120 },
    centroid: {
      centroidXInRoi: 60,
      centroidYInRoi: 60,
      candidateWidth: 20,
      candidateHeight: 20,
      confidence: 0.9,
    },
  }),
);
const trackedPupil: PupilTrackingResult[] = pupil.map((x, frameIndex) => ({
  frameIndex,
  decodedPtsUs: frameIndex,
  eyeSide: 'left',
  rawCentroidX: x,
  rawCentroidY: 400,
  rawConfidence: 0.9,
  rawFailure: null,
  rescued: false,
  trackingState: 'TRACKED',
  trackingConfidence: 0.9,
  trackedCentroidX: x,
  trackedCentroidY: 400,
  predictedCentroidX: null,
  predictedCentroidY: null,
  searchRadiusPx: null,
  gateRejected: false,
  failureReason: null,
  dropoutDurationUs: 0,
  ptsEstimated: false,
}));
const observed = trackingObservations(raw, trackedPupil, anchors);
assert.ok(observed.every((sample) => sample.x !== null && Math.abs(sample.x - 0.5) < 1e-9));
assert.ok(Math.abs(gazeFeature(observed[0])!.x - (500 - 200) / 800) < 1e-9);
assert.ok(Math.abs(gazeFeature(observed[1])!.x - (560 - 200) / 800) < 1e-9);
const overhang = {
  ...observed[0],
  roi: { x: 180, y: 400, width: 40, height: 40 },
  x: 0,
  y: 0.5,
};
assert.ok(Math.abs(gazeFeature(overhang)!.x - (180 - 200) / 800) < 1e-9);
const mismatched = {
  ...observed[0],
  roi: { x: 5000, y: 400, width: 40, height: 40 },
  x: 1,
  y: 0.5,
};
assert.equal(gazeFeature(mismatched), null);
console.log(
  'Calibration checks: PASS (held targets, independent validation, degeneracy, coverage, drift, context, expiry, raw preservation, face anchor)',
);
