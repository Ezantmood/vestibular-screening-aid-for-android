import assert from './assert';
import { trackingDecodeFailure } from '../src/eyetracking/tracking/decodeIntegrity';
import { propagateRois } from '../src/eyetracking/tracking/roiPropagation';
import { runBatch3SelfChecks } from '../src/tests/validation/selfChecks';
async function check() {
  const decode = {
    error: null,
    encodedSampleCount: 3,
    decodedFrameCount: 3,
    decodedPtsUs: [0, 8333, 16666],
  };
  assert.equal(trackingDecodeFailure(decode), null);
  assert.equal(trackingDecodeFailure({ ...decode, error: 'failure' }), 'DECODE_FAILED');
  assert.equal(trackingDecodeFailure({ ...decode, decodedFrameCount: 2 }), 'FRAME_COUNT_MISMATCH');
  assert.equal(trackingDecodeFailure({ ...decode, decodedPtsUs: [0, 0, 16666] }), 'INVALID_PTS');
  assert.equal(trackingDecodeFailure({ ...decode, decodedPtsUs: [0, null, 16666] }), 'INVALID_PTS');
  const eye = { x: 100, y: 200, width: 100, height: 100, usable: true, estimated: false };
  const samples = [0, 2].map((frameIndex) => ({
    frameIndex,
    ptsUs: frameIndex * 8333,
    faceDetected: true,
    faceBox: null,
    leftEye: eye,
    rightEye: { ...eye, estimated: true },
    rotationApplied: 0,
    error: null,
  }));
  const rois = propagateRois({
    faceSamples: samples,
    decodedPtsUsList: decode.decodedPtsUs,
    frameCount: 3,
  });
  assert.equal(rois.filter((r) => r.eyeSide === 'left' && r.missingReason === null).length, 3);
  assert.equal(rois.filter((r) => r.eyeSide === 'right' && r.missingReason === null).length, 0);
  const noTime = propagateRois({
    faceSamples: samples,
    decodedPtsUsList: [0, null, 16666],
    frameCount: 3,
  });
  assert.ok(noTime.find((r) => r.eyeSide === 'left' && r.frameIndex === 1)!.missingReason !== null);
  const badKey = propagateRois({
    faceSamples: [{ ...samples[0], ptsUs: 1 }, samples[1]],
    decodedPtsUsList: decode.decodedPtsUs,
    frameCount: 3,
  });
  assert.ok(badKey.find((r) => r.eyeSide === 'left' && r.frameIndex === 1)!.missingReason !== null);
  const checks = await runBatch3SelfChecks();
  for (const c of checks) assert.equal(c.status, 'PASS', c.id);
  console.log(
    `Batch 3 independent self-checks: ${checks.length}/${checks.length} PASS (synthetic, no human gaze claim)`,
  );
}
void check();
