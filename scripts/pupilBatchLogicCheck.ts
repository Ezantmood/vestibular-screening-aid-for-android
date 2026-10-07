import assert from './assert';
import { reconcilePupilBatch } from '../src/eyetracking/pupil/reconcileBatch';
import { buildSuccessResult } from '../src/eyetracking/pupil/coordinates';
import { finalTrack, buildRescueHints } from '../src/eyetracking/tracking/twoPassTracking';
import { processTrackingSignals } from '../src/signals/trackingSignals';
import type { PupilRoiRequest } from '../src/eyetracking/pupil/pupilTypes';

const requests: PupilRoiRequest[] = Array.from({ length: 4 }, (_, i) => ({
  frameIndex: Math.floor(i / 2),
  decodedPtsUs: Math.floor(i / 2) * 8333,
  eyeSide: i % 2 ? 'right' : 'left',
  roiX: 100.9,
  roiY: 200.5,
  roiWidth: 100.2,
  roiHeight: 80.9,
  condition: 'partial-native',
}));
const detectorId = 'percentile-dark';
const success = requests.map((r) =>
  buildSuccessResult({
    frameIndex: r.frameIndex,
    decodedPtsUs: r.decodedPtsUs,
    eyeSide: r.eyeSide,
    detectorId,
    box: { roiX: 100, roiY: 200, roiWidth: 100, roiHeight: 80 },
    centroid: {
      centroidXInRoi: 50,
      centroidYInRoi: 40,
      candidateWidth: 20,
      candidateHeight: 20,
      confidence: 0.9,
    },
  }),
);
const before = JSON.stringify(success);
const complete = reconcilePupilBatch(requests, [...success].reverse(), detectorId);
assert.equal(JSON.stringify(complete), before);
const partial = reconcilePupilBatch(requests, [success[0]], detectorId);
assert.equal(partial.length, 4);
assert.equal(partial[0].failureReason, null);
for (const result of partial.slice(1)) {
  assert.equal(result.failureReason, 'NATIVE_RESULT_MISSING');
  assert.equal(result.centroidXInFrame, null);
  assert.equal(result.confidence, 0);
}
assert.equal(buildRescueHints(partial).length, 0);
const tracked = finalTrack(partial);
const signals = processTrackingSignals({
  rawResults: partial,
  tracked: [...tracked.left, ...tracked.right],
});
assert.equal(signals[0].pupil.qualityAfter.coverage, 0.5);
assert.equal(signals[1].pupil.qualityAfter.coverage, 0);
assert.equal(signals[0].pupil.samples[1].processedX, null);
assert.equal(signals[0].pupil.samples[1].velocityXPerSecond, null);
assert.equal(signals[0].pupil.samples[1].raw.missingReason, 'tracking-dropout');
for (const corrupt of [
  [...success, success[0]],
  [{ ...success[0], decodedPtsUs: 42 }, ...success.slice(1)],
  [{ ...success[0], roiX: 101 }, ...success.slice(1)],
  [{ ...success[0], detectorId: 'contrast-normalized' as const }, ...success.slice(1)],
]) {
  const reconciled = reconcilePupilBatch(requests, corrupt, detectorId);
  assert.equal(reconciled.length, 4);
  assert.equal(reconciled[0].failureReason, 'INVALID_GEOMETRY');
  assert.equal(reconciled[0].centroidXInFrame, null);
}
const unexpected = reconcilePupilBatch(
  requests,
  [...success, { ...success[0], frameIndex: 999 }],
  detectorId,
);
assert.equal(JSON.stringify(unexpected), before);
const blink = reconcilePupilBatch(
  requests,
  [{ ...success[0], failureReason: 'EYE_CLOSED_OR_OCCLUDED' }, ...success.slice(1)],
  detectorId,
);
assert.equal(blink[0].centroidXInFrame, null);
assert.equal(blink[0].failureReason, 'EYE_CLOSED_OR_OCCLUDED');
assert.equal(blink[0].confidence, success[0].confidence);
const weak = {
  ...success[0],
  centroidXInRoi: null,
  centroidYInRoi: null,
  centroidXInFrame: null,
  centroidYInFrame: null,
  normalizedX: null,
  normalizedY: null,
  failureReason: 'LOW_CONFIDENCE' as const,
  confidence: 0.27,
};
assert.equal(
  JSON.stringify(reconcilePupilBatch([requests[0]], [weak], detectorId)[0]),
  JSON.stringify(weak),
);
assert.equal(JSON.stringify(success), before);
assert.equal(reconcilePupilBatch([], success, detectorId).length, 0);
console.log(
  'Pupil batch checks: PASS (partial/duplicate/wrong PTS/ROI/detector, slot coverage, blink/dropout, immutable raw)',
);
