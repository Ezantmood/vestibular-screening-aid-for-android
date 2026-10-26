import assert from './assert';
import { syntheticCalibrationTakes, SYNTHETIC_CONTEXT } from '../src/tests/validation/selfChecks';
import {
  fitCalibration,
  mapCalibration,
  calibrationUsable,
} from '../src/eyetracking/calibration/calibration';
import { mapBoxFromRotatedToOriginal } from '../src/eyetracking/pupil/coordinates';
import { propagateFaceAnchors, propagateRois } from '../src/eyetracking/tracking/roiPropagation';
import type { FramePipelineFaceSample } from '../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';
import {
  pupilDecodeFailure,
  PipelineDecodeError,
} from '../src/eyetracking/tracking/decodeIntegrity';
import { calibrationDiagnostics } from '../src/tests/validation/calibrationDiagnostics';

const fit = (takes = syntheticCalibrationTakes()) =>
  fitCalibration({ id: 'audit-simulation', createdAtMs: 1000, context: SYNTHETIC_CONTEXT, takes });
// Independent half-open edge round trips, not copies of inverse formulas.
for (const [l, t, r, b] of [
  [200, 100, 1000, 700],
  [0, 0, 1920, 1080],
  [1919, 1079, 1920, 1080],
]) {
  assert.equal(
    JSON.stringify(mapBoxFromRotatedToOriginal(1080 - b, l, 1080 - t, r, 90, 1920, 1080)),
    JSON.stringify({ left: l, top: t, right: r, bottom: b }),
  );
  assert.equal(
    JSON.stringify(mapBoxFromRotatedToOriginal(t, 1920 - r, b, 1920 - l, 270, 1920, 1080)),
    JSON.stringify({ left: l, top: t, right: r, bottom: b }),
  );
}
const good = fit();
assert.equal(good.verdict, 'VALID', good.reasons.join(','));
const orientedTakes = syntheticCalibrationTakes();
for (const t of orientedTakes) for (const s of t.samples) s.faceRotation = 270;
const orientedContext = { ...SYNTHETIC_CONTEXT, faceRotationDegrees: 270 };
const oriented = fitCalibration({
  id: 'orientation-fixture',
  createdAtMs: 1000,
  context: orientedContext,
  takes: orientedTakes,
});
assert.equal(oriented.verdict, 'VALID', oriented.reasons.join(','));
assert.ok(calibrationUsable(oriented, orientedContext, 1000));
const wrongDirection = fitCalibration({
  id: 'wrong-direction',
  createdAtMs: 1000,
  context: { ...orientedContext, faceRotationDegrees: 90 },
  takes: orientedTakes,
});
assert.equal(wrongDirection.verdict, 'RETRY');
assert.ok(wrongDirection.reasons.includes('ORIENTATION_CHANGED:left'));
oriented.models.left!.referenceRotation = 90;
assert.equal(calibrationUsable(oriented, orientedContext, 1000), false);
let takes = syntheticCalibrationTakes();
for (const take of takes) for (const s of take.samples) delete s.face;
const noHead = fit(takes);
assert.equal(noHead.verdict, 'RETRY');
assert.equal(noHead.targetQuality[0].blocks.noFace, 120);
assert.equal(mapCalibration(good, takes[0].samples[0], SYNTHETIC_CONTEXT, 1000), null);
// Fit and mapping consume the same normalized feature despite correlated size/noise.
takes = syntheticCalibrationTakes();
for (const take of takes)
  for (const s of take.samples) {
    const phase = s.frameIndex % 3;
    const size = [100, 110, 90][phase];
    s.x! += [-0.002, 0, 0.002][phase];
    s.roi = { x: 100, y: 200, width: size, height: size };
    s.face = { ...s.roi };
  }
const resized = fit(takes);
assert.equal(resized.verdict, 'VALID', resized.reasons.join(','));
assert.ok(Math.abs(resized.targetQuality[0].x! - (0.3 + 0.25 * takes[0].target.x)) < 1e-12);
for (const take of takes) {
  const s = take.samples[1];
  const p = mapCalibration(resized, s, SYNTHETIC_CONTEXT, 1000)!;
  assert.ok(Math.abs(p.x - take.target.x) < 1e-9 && Math.abs(p.y - take.target.y) < 1e-9);
}
// A moving eye crop must not erase real pupil motion or trip a head guard.
const s = syntheticCalibrationTakes()[4].samples[0];
const p = mapCalibration(good, s, SYNTHETIC_CONTEXT, 1000)!;
const recrop = { ...s, roi: { ...s.roi, x: s.roi.x - 10 }, x: s.x! + 0.1 };
assert.equal(
  JSON.stringify(mapCalibration(good, recrop, SYNTHETIC_CONTEXT, 1000)),
  JSON.stringify(p),
);
for (const factor of [0.7, 1.3]) {
  const face = { ...s.face!, width: s.face!.width * factor };
  assert.equal(mapCalibration(good, { ...s, face }, SYNTHETIC_CONTEXT, 1000), null);
}
const shifted = {
  ...s,
  roi: { ...s.roi, x: s.roi.x + 50 },
  face: { ...s.face!, x: s.face!.x + 50 },
};
assert.equal(mapCalibration(good, shifted, SYNTHETIC_CONTEXT, 1000), null);
takes = syntheticCalibrationTakes();
for (const t of takes)
  for (const obs of t.samples) {
    if (t.target.id === 'check-center') {
      obs.face!.x += 50;
      obs.roi.x += 50;
    }
  }
assert.ok(fit(takes).reasons.some((r) => r.startsWith('HEAD_OR_ROI_MOVED')));
// Inconsistent saved coverage and null spread cannot activate a stored result.
for (const change of [{ coverage: 0.99 }, { spread: null }, { accepted: 100.5 }]) {
  const corrupted = fit();
  Object.assign(corrupted.targetQuality[0], change);
  assert.equal(calibrationUsable(corrupted, SYNTHETIC_CONTEXT, 1000), false);
}
takes = syntheticCalibrationTakes();
takes[0].samples[0].frameIndex = 0.5;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('INVALID_PTS')));
const eye = { x: 100, y: 200, width: 100, height: 100, usable: true, estimated: false };
const sample = (frameIndex: number, rotationApplied: number): FramePipelineFaceSample => ({
  frameIndex,
  ptsUs: frameIndex * 10000,
  faceDetected: true,
  faceBox: { x: 90, y: 180, width: 200, height: 300 },
  leftEye: eye,
  rightEye: eye,
  rotationApplied,
  error: null,
});
const propagation = {
  faceSamples: [sample(0, 90), sample(2, 270)],
  decodedPtsUsList: [0, 10000, 20000],
  frameCount: 3,
};
assert.equal(propagateFaceAnchors(propagation)[1], null);
assert.ok(
  propagateRois(propagation)
    .filter((r) => r.frameIndex === 1)
    .every((r) => r.missingReason !== null),
);
const diagnostics = calibrationDiagnostics(noHead);
assert.equal(diagnostics[0].blocks.noFace, 120);
assert.equal(diagnostics[0].detectorConfidence.median, null);
assert.equal(diagnostics[0].image.meanY.median, null);
assert.ok(good.targetQuality.every((q) => q.predictionError!.distance < 1e-9));
console.log(
  'Calibration audit regressions: PASS (rotation, missing head, normalized scale parity, movement guards, corrupt activation, clock, diagnostics)',
);

const firstDecode = { decodedFrameCount: 120, width: 1920, height: 1080 };
const pixelDecode = { decodedFrameCount: 120, frameWidth: 1920, frameHeight: 1080, error: null };
assert.equal(pupilDecodeFailure(firstDecode, pixelDecode), null);
assert.equal(
  pupilDecodeFailure(firstDecode, { ...pixelDecode, decodedFrameCount: 119 }),
  'FRAME_COUNT_MISMATCH',
);
assert.equal(
  pupilDecodeFailure(firstDecode, { ...pixelDecode, frameHeight: 1088 }),
  'FRAME_COUNT_MISMATCH',
);
assert.equal(
  pupilDecodeFailure(firstDecode, { ...pixelDecode, error: 'DECODE_NO_EOS' }),
  'DECODE_FAILED',
);

// Correct units preserve the original variance floor, including its rejection
// of insufficient displacement, without penalizing a larger face anchor.
for (const amplitude of [0.25, 0.005, 0.00005]) {
  const takes = syntheticCalibrationTakes();
  for (const t of takes)
    for (const s of t.samples) {
      const face = { x: 200, y: 200, width: 600, height: 800 };
      const frameX = face.x + (0.4 + amplitude * t.target.x) * face.width;
      const frameY = face.y + (0.4 + amplitude * t.target.y) * face.height;
      s.x = 0.5;
      s.y = 0.5;
      s.face = face;
      s.roi = { x: frameX - 90, y: frameY - 90, width: 180, height: 180 };
    }
  const result = fit(takes);
  if (amplitude === 0.00005) {
    assert.equal(result.verdict, 'RETRY');
    assert.ok(result.reasons.some((r) => r.startsWith('DEGENERATE_FEATURES')));
    continue;
  }
  assert.equal(result.verdict, 'VALID', result.reasons.join(','));
  assert.ok(result.models.left!.validationRmse < 1e-8);
  for (const t of takes)
    if (t.target.role === 'validation')
      for (const s of t.samples) s.roi.x += amplitude * 0.4 * s.face!.width;
  assert.ok(fit(takes).reasons.some((r) => r.startsWith('POOR_VALIDATION')));
}
const lineTakes = syntheticCalibrationTakes();
for (const t of lineTakes) for (const s of t.samples) s.y = s.x;
assert.ok(fit(lineTakes).reasons.some((r) => r.startsWith('DEGENERATE_FEATURES')));

const changedCoefficients = fit();
changedCoefficients.models.left!.coefficientsX[0] += 0.1;
assert.equal(calibrationUsable(changedCoefficients, SYNTHETIC_CONTEXT, 1000), false);

const decodeError = new PipelineDecodeError('FRAME_COUNT_MISMATCH', 'pupil-decode', {
  encoded: 180,
  decoded: 179,
  width: 1920,
  height: 1080,
});
assert.ok(decodeError.describe().includes('pupil-decode'));
assert.ok(decodeError.describe().includes('decoded=179'));
