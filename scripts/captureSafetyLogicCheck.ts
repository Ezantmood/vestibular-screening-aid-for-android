import assert from './assert';
import { CaptureCancelled, prepareRecording } from '../src/camera/recordingPreparation';

async function check() {
  let cancelled = false;
  let recorderStarts = 0;
  let release!: () => void;
  const capture = async (prepare?: Parameters<typeof prepareRecording>[1]) => {
    await prepareRecording(() => cancelled, prepare);
    recorderStarts++;
  };
  await capture();
  assert.equal(recorderStarts, 1);
  let stimulusStarts = 0;
  cancelled = false;
  const guarded = capture(async (isCancelled) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    if (isCancelled()) throw new CaptureCancelled('background/unmount during setup');
    stimulusStarts++;
  });
  await Promise.resolve();
  cancelled = true;
  release();
  try {
    await guarded;
    throw new Error('Expected no late stimulus after cancellation');
  } catch (error) {
    assert.ok(error instanceof CaptureCancelled);
  }
  assert.equal(stimulusStarts, 0);
  assert.equal(recorderStarts, 1);
  cancelled = true;
  let preparations = 0;
  try {
    await capture(() => {
      preparations++;
    });
    throw new Error('Expected cancellation before setup');
  } catch (error) {
    assert.ok(error instanceof CaptureCancelled);
  }
  assert.equal(preparations, 0);
  cancelled = false;
  const pending = capture(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  cancelled = true;
  release();
  try {
    await pending;
    throw new Error('Expected cancellation during async viewport/clock setup');
  } catch (error) {
    assert.ok(error instanceof CaptureCancelled);
  }
  assert.equal(recorderStarts, 1);
  cancelled = false;
  const geometryError = new Error('viewport changed during countdown');
  try {
    await capture(async () => {
      throw geometryError;
    });
    throw new Error('Expected viewport rejection');
  } catch (error) {
    assert.equal(error, geometryError);
  }
  assert.equal(recorderStarts, 1);
  await capture(async () => {
    preparations++;
  });
  assert.equal(preparations, 1);
  assert.equal(recorderStarts, 2);
  console.log(
    'Capture safety checks: PASS (async preparation, cancel/unmount race, viewport rejection before recorder start, retry)',
  );
}
void check();
