import assert from './assert';
import {
  fitCalibration,
  mapCalibration,
  calibrationUsable,
} from '../src/eyetracking/calibration/calibration';
import { CALIBRATION_TARGETS } from '../src/eyetracking/calibration/protocol';
import type { CalibrationContext, CalibrationTake } from '../src/eyetracking/calibration/types';

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
  coordinateVersion: 'decoded-roi-v1',
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
  mapCalibration(result, { ...input, roi: { ...input.roi, x: 400 } }, context, time),
  null,
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
takes = fixture();
takes[0].samples[2].decodedPtsUs = 0;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('INVALID_PTS')));
takes = fixture();
for (const s of takes[0].samples) s.roi.width *= 1.8;
assert.ok(fit(takes).reasons.some((r) => r.startsWith('HEAD_OR_ROI_MOVED')));
takes = fixture();
for (const s of takes[0].samples) s.confidence = 0.2;
assert.equal(fit(takes).verdict, 'RETRY');
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
console.log(
  'Calibration checks: PASS (held targets, independent validation, degeneracy, coverage, drift, context, expiry, raw preservation)',
);
