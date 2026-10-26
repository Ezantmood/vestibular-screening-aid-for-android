import assert from './assert';
import {
  classifyFramingState,
  FramingReadiness,
  type FramingObservation,
  type FramingGateSet,
} from '../src/eyetracking/framing';
import {
  CALIBRATION_FRAMING_GATES,
  CALIBRATION_PREVIEW_ASPECT,
  classifyCalibrationFraming,
} from '../src/eyetracking/calibration/geometry';
import { fitCalibration, CALIBRATION_POLICY } from '../src/eyetracking/calibration/calibration';
import { syntheticCalibrationTakes, SYNTHETIC_CONTEXT } from '../src/tests/validation/selfChecks';

const box = (width: number, height: number): FramingObservation => ({
  faceFound: true,
  faceLeft: (1 - width) / 2,
  faceRight: (1 + width) / 2,
  faceTop: (1 - height) / 2,
  faceBottom: (1 + height) / 2,
  leftEyeLandmark: true,
  rightEyeLandmark: true,
  leftEyeOpenProb: 0.9,
  rightEyeOpenProb: 0.9,
});
const heightOnly: FramingGateSet = { ...CALIBRATION_FRAMING_GATES };
delete heightOnly.TOO_FAR_WIDTH_FRAC;
const wide = box(0.86, 0.48),
  near = box(0.95, 0.534375),
  far = box(0.5, 0.3);
assert.equal(classifyFramingState(wide, heightOnly), 'TOO_FAR');
assert.equal(classifyFramingState(near, heightOnly), 'TOO_CLOSE');
assert.equal(classifyCalibrationFraming(wide), 'READY');
assert.equal(classifyCalibrationFraming(near), 'TOO_CLOSE');
assert.equal(classifyCalibrationFraming(far), 'TOO_FAR');

// Sweep REAL pixel aspect ratios in an upright 9:16 view, not arbitrary
// independent normalized width/height. Near-square boxes had NO green scale.
const sweeps = [];
for (const aspect of [0.55, 0.65, 0.75, 0.85, 0.9, 1, 1.15, 1.35]) {
  let oldReady = 0,
    newReady = 0;
  for (let step = 5; step <= 190; step++) {
    const h = step / 200,
      obs = box((h * aspect) / CALIBRATION_PREVIEW_ASPECT, h);
    if (classifyFramingState(obs, heightOnly) === 'READY') oldReady++;
    if (classifyCalibrationFraming(obs) === 'READY') newReady++;
  }
  assert.ok(newReady > 0);
  if (aspect >= 0.9) assert.equal(oldReady, 0);
  sweeps.push({ aspect, oldReady, newReady });
}

// Width is an occupancy alternative only: it cannot bypass clipping, eyes,
// centering, malformed geometry, or an explicitly stricter eye-open gate.
assert.equal(classifyCalibrationFraming({ ...wide, faceLeft: 0 }), 'FACE_PARTIAL');
assert.equal(classifyCalibrationFraming({ ...wide, leftEyeOpenProb: 0.1 }), 'EYES_NOT_VISIBLE');
assert.equal(classifyCalibrationFraming({ ...wide, leftEyeOpenProb: NaN }), 'EYES_NOT_VISIBLE');
assert.equal(classifyCalibrationFraming({ ...wide, faceLeft: NaN }), 'NO_FACE');
const off = box(0.81, 0.45);
assert.equal(
  classifyCalibrationFraming({
    ...off,
    faceTop: off.faceTop! + 0.13,
    faceBottom: off.faceBottom! + 0.13,
  }),
  'OFF_CENTER',
);
assert.equal(
  classifyFramingState(
    { ...wide, leftEyeOpenProb: 0.6 },
    { ...CALIBRATION_FRAMING_GATES, EYE_OPEN_PROB: 0.8 },
  ),
  'EYES_NOT_VISIBLE',
);

// Operator follows current guidance: stop on first good box instead of moving
// closer while the debouncer still retains TOO_FAR. Green needs three samples.
const readiness = new FramingReadiness(3);
for (let i = 0; i < 3; i++) readiness.push(far, CALIBRATION_FRAMING_GATES);
let state = readiness.push(wide, CALIBRATION_FRAMING_GATES);
assert.equal(state.observed, 'READY');
assert.equal(state.stable, 'TOO_FAR');
assert.equal(state.settling, true);
assert.equal(state.ready, false);
state = readiness.push(near, CALIBRATION_FRAMING_GATES);
assert.equal(state.observed, 'TOO_CLOSE');
assert.equal(state.stable, 'TOO_FAR');
assert.equal(state.ready, false);
assert.equal(state.settling, false);
for (let i = 0; i < 3; i++) state = readiness.push(wide, CALIBRATION_FRAMING_GATES);
assert.equal(state.ready, true);
state = readiness.push({ ...wide, faceFound: false }, CALIBRATION_FRAMING_GATES);
assert.equal(state.stable, 'READY');
assert.equal(state.observed, 'NO_FACE');
assert.equal(state.ready, false); // never use debounced old green to enable Start
state = readiness.reset();
assert.equal(state.ready, false);
assert.equal(state.observed, 'NO_FACE');

// A green preflight cannot manufacture a valid calibration from bad mapping.
const takes = syntheticCalibrationTakes();
for (const t of takes) if (t.target.role === 'validation') for (const s of t.samples) s.x! += 0.1;
const result = fitCalibration({
  id: 'framing-simulation',
  createdAtMs: 1000,
  context: SYNTHETIC_CONTEXT,
  takes,
});
assert.equal(result.verdict, 'RETRY');
assert.equal(CALIBRATION_POLICY.minConfidence, 0.5);
assert.equal(CALIBRATION_POLICY.minCoverage, 0.6);
assert.equal(CALIBRATION_POLICY.maxValidationRmse, 0.08);
console.log(
  JSON.stringify({ framingReadinessChecks: 'PASS', simulationOnly: true, aspectSweeps: sweeps }),
);
