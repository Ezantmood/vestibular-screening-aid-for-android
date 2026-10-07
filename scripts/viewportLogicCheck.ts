import assert from './assert';
import { stableTargetViewport, type TargetViewport } from '../src/tests/stimulus/viewport';
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
    'Viewport checks: PASS (real negative-origin race, scroll readiness, movement, invalid geometry, missing callback timeout, cancellation)',
  );
}
void check();
