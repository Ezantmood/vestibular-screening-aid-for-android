import { savedCalibrationAuditImages } from '../src/eyetracking/calibration/display';
import { buildSuccessResult } from '../src/eyetracking/pupil/coordinates';
import { reconcilePupilBatch } from '../src/eyetracking/pupil/reconcileBatch';
import assert from './assert';
import { eyeCoordinateFrame, pupilInEyeFrame } from '../src/eyetracking/pupil/eyeGeometry';
import { gazeFeature, fitCalibration } from '../src/eyetracking/calibration/calibration';
import { calibrationEvidence } from '../src/eyetracking/calibration/evidence';
import { selectRegression } from '../src/eyetracking/calibration/regression';
import {
  syntheticCalibrationTakes,
  syntheticEyeContour,
  SYNTHETIC_CONTEXT,
} from '../src/tests/validation/selfChecks';
import { propagateRois } from '../src/eyetracking/tracking/roiPropagation';
import type { FramePipelineFaceSample } from '../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';

const contour = syntheticEyeContour({ x: 100, y: 150, width: 100, height: 100 });
const pupil = { x: 145, y: 205 };
const base = pupilInEyeFrame(pupil, contour)!;
assert.ok(Math.abs(base.x - 0.45) < 1e-12 && Math.abs(base.y - 0.55) < 1e-12);
// Physical rotation, translation and scale of the SAME pupil/anatomy preserve gaze.
for (const rotation of [0, 90, 180, 270])
  for (const scale of [0.5, 1, 1.4]) {
    const angle = (-rotation * Math.PI) / 180;
    const transform = (p: { x: number; y: number }) => ({
      x: 700 + scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)),
      y: 700 + scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)),
    });
    const mapped = pupilInEyeFrame(transform(pupil), contour.map(transform), rotation)!;
    assert.ok(Math.abs(mapped.x - base.x) < 1e-12 && Math.abs(mapped.y - base.y) < 1e-12);
  }
assert.equal(eyeCoordinateFrame(contour.slice(1)), null);
assert.equal(eyeCoordinateFrame(contour.map((p) => ({ ...p, y: 200 }))), null);
assert.equal(eyeCoordinateFrame(contour.map((p) => ({ ...p, x: NaN }))), null);

// Known pupil excursions of only a few pixels; unrelated face-box wobble must
// not manufacture gaze. Same data/targets compare the old and new features.
const takes = syntheticCalibrationTakes();
for (let t = 0; t < takes.length; t++)
  for (const sample of takes[t].samples) {
    const pupilX = 500 + 5 * (takes[t].target.x - 0.5),
      pupilY = 500 + 5 * (takes[t].target.y - 0.5);
    sample.roi = { x: pupilX - 100, y: pupilY - 100, width: 200, height: 200 };
    sample.x = sample.y = 0.5;
    sample.face = {
      x: 200 + [0, 9, -7, 4, -10, 8, -3, 5, -9, 7, -6, 1, -5, 9][t],
      y: 150 + [8, -5, 2, -9, 6, -4, 9, -8, 1, -5, 7, -3, 6, -9][t],
      width: 800,
      height: 1000,
    };
    sample.eyeContour = syntheticEyeContour({ x: 440, y: 440, width: 120, height: 120 });
  }
const result = fitCalibration({
  id: 'synthetic-anchor-wobble',
  createdAtMs: 1000,
  context: SYNTHETIC_CONTEXT,
  takes,
});
assert.equal(result.verdict, 'VALID', result.reasons.join(','));
const oldPoints = takes
  .filter((t) => t.target.role === 'fit')
  .map((t) => {
    const sample = t.samples[0];
    return {
      x: (sample.roi.x + 100 - sample.face!.x) / sample.face!.width,
      y: (sample.roi.y + 100 - sample.face!.y) / sample.face!.height,
      targetX: t.target.x,
      targetY: t.target.y,
    };
  });
const oldCv = selectRegression(oldPoints).selected!.fitCvRmse;
assert.ok(oldCv > 0.08);
assert.ok(result.models.left!.fitCvRmse < 1e-9);
const sample = takes[4].samples[0];
assert.equal(gazeFeature({ ...sample, eyeContour: undefined }), null);
const samePupilNewBox = {
  ...sample,
  face: { ...sample.face!, x: sample.face!.x + 12, y: sample.face!.y - 8 },
};
assert.equal(
  JSON.stringify(gazeFeature(sample)),
  JSON.stringify({ ...gazeFeature(samePupilNewBox)!, box: sample.face! }),
);

const key = (frameIndex: number, contourAvailable: boolean): FramePipelineFaceSample => ({
  frameIndex,
  ptsUs: frameIndex * 8333,
  faceDetected: true,
  faceBox: { x: 0, y: 0, width: 400, height: 500 },
  rotationApplied: 0,
  error: null,
  leftEye: {
    x: 80,
    y: 120,
    width: 160,
    height: 160,
    usable: true,
    estimated: false,
    contour: contourAvailable ? [...contour] : null,
  },
  rightEye: null,
});
const rois = propagateRois({
  faceSamples: [key(0, true), key(2, false), key(4, true)],
  decodedPtsUsList: [0, 8333, 16666, 24999, 33332],
  frameCount: 5,
  requireEyeContour: true,
});
assert.equal(rois.filter((r) => r.eyeSide === 'left' && r.missingReason === null).length, 2);
assert.ok(
  rois
    .filter((r) => r.eyeSide === 'left' && r.frameIndex > 0 && r.frameIndex < 4)
    .every((r) => r.missingReason !== null),
);

const artifact = {
  result,
  takes,
  patient: 'PRIVATE_PATIENT',
  account: 'PRIVATE_ACCOUNT',
  path: 'PRIVATE_PATH',
};
const exported = calibrationEvidence(artifact);
const json = JSON.stringify(exported);
assert.ok(!json.includes('PRIVATE_') && !json.includes('synthetic-only'));
assert.equal(exported.takes.length, 14);
assert.equal(exported.takes[0].samples.length, 240);
assert.equal(exported.takes[0].samples[0].eyeContour!.length, 16);
assert.equal(JSON.stringify(artifact.takes), JSON.stringify(takes));

const request = {
  frameIndex: 0,
  decodedPtsUs: 0,
  eyeSide: 'left' as const,
  roiX: 80,
  roiY: 120,
  roiWidth: 160,
  roiHeight: 160,
  eyeContour: contour,
  condition: 'synthetic',
};
const detection = {
  ...buildSuccessResult({
    frameIndex: 0,
    decodedPtsUs: 0,
    eyeSide: 'left',
    detectorId: 'percentile-dark',
    box: request,
    centroid: {
      centroidXInRoi: 65,
      centroidYInRoi: 85,
      candidateWidth: 20,
      candidateHeight: 20,
      confidence: 0.9,
    },
  }),
  eyeContour: contour.map((p) => ({ ...p })),
};
assert.equal(reconcilePupilBatch([request], [detection], 'percentile-dark')[0].failureReason, null);
detection.eyeContour[0].x += 0.25;
assert.equal(
  reconcilePupilBatch([request], [detection], 'percentile-dark')[0].failureReason,
  'INVALID_GEOMETRY',
);
assert.equal(
  reconcilePupilBatch([request], [{ ...detection, eyeContour: undefined }], 'percentile-dark')[0]
    .failureReason,
  'INVALID_GEOMETRY',
);

const images = savedCalibrationAuditImages({
  replays: [
    {
      condition: 'fit-0-0',
      auditOverlays: [
        '/data/user/0/app/cache/pupildebug/p3_left_f80.jpg',
        '/data/user/0/app/files/clinic-vault-v1.bin',
        'https://example.invalid/eye.jpg',
      ],
    },
  ],
});
assert.equal(images.length, 1);
assert.equal(images[0].paths.length, 1);
assert.equal(
  savedCalibrationAuditImages({
    replays: [{ condition: 'PRIVATE_PATIENT', auditOverlays: ['/cache/pupildebug/a.jpg'] }],
  }).length,
  0,
);
assert.equal(savedCalibrationAuditImages({ replays: null }).length, 0);
// Old target grids must be exported as recorded, never relabeled with the current grid.
const legacy = structuredClone(artifact);
legacy.result.context.coordinateVersion =
  'decoded-roi-v1' as typeof legacy.result.context.coordinateVersion;
legacy.takes[0].target.x = 0.18;
const legacyExport = calibrationEvidence(legacy);
assert.equal(legacyExport.takes[0].target.x, 0.18);
assert.equal(legacyExport.technical, null);
assert.equal(legacyExport.storedModelErrors[0].fitRmse, legacy.result.models.left!.fitRmse);
console.log(
  JSON.stringify({
    eyeGeometryChecks: 'PASS',
    simulationOnly: true,
    oldFaceBoxCvRmse: oldCv,
    canthusCvRmse: result.models.left!.fitCvRmse,
    exportPrivacy: 'PASS',
  }),
);
