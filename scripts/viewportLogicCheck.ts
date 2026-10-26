import assert from './assert';
import {
  stableTargetViewport,
  targetViewportVisible,
  type TargetViewport,
} from '../src/tests/stimulus/viewport';
import { CALIBRATION_TARGETS } from '../src/eyetracking/calibration/protocol';
import { portraitFaceRotation, type FixedMode } from '../src/camera/fixedModes';
import { CaptureCancelled } from '../src/camera/recordingPreparation';

const visible: TargetViewport = { left: 16, top: 100, width: 374.6666666666667, height: 180 };
async function rejected(run: () => Promise<unknown>, cancelled = false) {
  try {
    await run();
    throw new Error('Expected viewport rejection');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (cancelled) assert.ok(error instanceof CaptureCancelled);
    else assert.ok(error.message.includes('target'));
  }
}
async function check() {
  // Reproduce the clinician layout: even a positive, stable origin hid the
  // bottom fit row under the navigation bar. A scroll lock cannot repair it.
  const window = { left: 0, top: 0, width: 412, height: 820 };
  const oldBoard = { left: 16, top: 310, width: 380, height: 697 };
  assert.equal(targetViewportVisible(oldBoard, window), false);
  assert.ok(oldBoard.top + oldBoard.height * 0.88 > window.height);
  let time = 0;
  await rejected(() =>
    stableTargetViewport(
      async () => {
        time += 10;
        return oldBoard;
      },
      { bounds: () => window, now: () => time, timeoutMs: 35 },
    ),
  );
  // Native stage bounds are independent of account/banner/header heights.
  // All 14 dots, including their full radius, fit on short/tall windows and
  // when a larger footer is reserved for accessibility text.
  for (const width of [320, 393, 412, 600]) {
    for (const height of [480, 640, 820, 960]) {
      for (const footer of [60, 120, 160]) {
        for (const [top, bottom] of [
          [0, 0],
          [24, 24],
          [48, 48],
          [60, 96],
        ]) {
          const bounds = { left: 0, top, width, height: height - top - bottom };
          const board = {
            left: 16,
            top: top + 16,
            width: width - 32,
            height: bounds.height - footer - 32,
          };
          assert.ok(targetViewportVisible(board, bounds));
          for (const p of CALIBRATION_TARGETS) {
            assert.ok(p.x * board.width >= 10 && (1 - p.x) * board.width >= 10);
            assert.ok(p.y * board.height >= 10 && (1 - p.y) * board.height >= 10);
          }
        }
      }
    }
  }
  for (const bad of [
    { ...visible, left: 40, width: 400 },
    { ...visible, top: 700, height: 180 },
    { ...visible, height: NaN },
  ])
    assert.equal(targetViewportVisible(bad, window), false);
  const mode: FixedMode = {
    cameraId: '1',
    lensFacing: 'FRONT',
    width: 1920,
    height: 1080,
    fpsMin: 120,
    fpsMax: 120,
    label: 'fixture',
  };
  for (const rotation of [0, 90, 180, 270])
    assert.equal(portraitFaceRotation({ ...mode, sensorOrientation: rotation }), rotation);
  for (const rotation of [null, undefined, 45, NaN, 360])
    assert.throws(() => portraitFaceRotation({ ...mode, sensorOrientation: rotation }));
  // Reproduce the actual -201 dp origin while native scrollTo is still queued.
  let samples = 0;
  const result = await stableTargetViewport(
    async () => {
      samples++;
      return samples === 1 ? { ...visible, top: -201 } : { ...visible };
    },
    { ready: () => samples >= 3 },
  );
  assert.equal(samples, 4);
  assert.equal(JSON.stringify(result), JSON.stringify(visible));
  // A reused native object must not overwrite the previous observed geometry.
  const mutable = { ...visible };
  samples = 0;
  const moved = await stableTargetViewport(async () => {
    mutable.top = samples++ === 0 ? 100 : 120;
    return mutable;
  });
  assert.equal(samples, 3);
  assert.equal(moved.top, 120);
  for (const bad of [
    { ...visible, top: -201 },
    { ...visible, left: -1 },
    { ...visible, width: 0 },
    { ...visible, height: NaN },
  ]) {
    let elapsed = 0;
    let recorderStarts = 0;
    await rejected(async () => {
      await stableTargetViewport(
        async () => {
          elapsed += 10;
          return bad;
        },
        {
          now: () => elapsed,
          timeoutMs: 35,
        },
      );
      recorderStarts++;
    });
    assert.equal(recorderStarts, 0);
  }
  let elapsed = 0;
  await rejected(() =>
    stableTargetViewport(
      async () => {
        elapsed += 10;
        return { ...visible, top: elapsed };
      },
      { now: () => elapsed, timeoutMs: 35 },
    ),
  );
  await rejected(() => stableTargetViewport(() => new Promise(() => {}), { timeoutMs: 20 }));
  await rejected(() => stableTargetViewport(async () => visible, { cancelled: () => true }), true);
  let cancelled = false;
  let release!: (viewport: TargetViewport) => void;
  const pending = stableTargetViewport(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    {
      cancelled: () => cancelled,
    },
  );
  cancelled = true;
  release(visible);
  await rejected(() => pending, true);
  console.log(
    'Viewport checks: PASS (clipped lower targets rejected, 768 stage/font/inset geometry cases, sensor metadata, scroll race, movement, timeout, cancellation)',
  );
}
void check();
