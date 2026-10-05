import assert from './assert';
import { createScreenAwakeCoordinator } from '../src/camera/screenAwake';

function harness() {
  const calls: { enabled: boolean; resolve: () => void; reject: (error: Error) => void }[] = [];
  const errors: unknown[] = [];
  const coordinator = createScreenAwakeCoordinator(
    (enabled) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ enabled, resolve, reject });
      }),
    (error) => errors.push(error),
  );
  return { calls, errors, coordinator };
}
// Native promises are deferred explicitly; let their continuations drain.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function checks() {
  {
    const { coordinator, calls } = harness();
    const old = coordinator.createOwner(true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].enabled, true);
    old.release();
    const replacement = coordinator.createOwner(true);
    // A delayed old enable cannot send a compensating false to the new owner.
    calls[0].resolve();
    await flush();
    assert.equal(calls.length, 1);
    old.setActive(false);
    old.release();
    assert.equal(calls.length, 1);
    replacement.release();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].enabled, false);
    calls[1].resolve();
    await flush();
  }
  {
    const { coordinator, calls } = harness();
    const a = coordinator.createOwner(true);
    const b = coordinator.createOwner(true);
    a.setActive(false);
    calls[0].resolve();
    await flush();
    assert.equal(calls.length, 1); // B still owns the foreground flag.
    b.setActive(false);
    assert.equal(calls[1].enabled, false);
    a.setActive(true);
    b.setActive(true);
    assert.equal(calls.length, 2); // Never overlap native writes.
    calls[1].resolve();
    await flush();
    assert.equal(calls.length, 3);
    assert.equal(calls[2].enabled, true);
    a.release();
    b.release();
    calls[2].resolve();
    await flush();
    assert.equal(calls.length, 4);
    assert.equal(calls[3].enabled, false);
    calls[3].resolve();
    await flush();
  }
  {
    const { coordinator, calls } = harness();
    const old = coordinator.createOwner(true);
    calls[0].resolve();
    await flush();
    old.release();
    const replacement = coordinator.createOwner(true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].enabled, false);
    calls[1].resolve();
    await flush();
    assert.equal(calls.length, 3);
    assert.equal(calls[2].enabled, true);
    calls[2].resolve();
    await flush();
    replacement.release();
    assert.equal(calls[3].enabled, false);
    calls[3].resolve();
    await flush();
  }
  {
    const { coordinator, calls, errors } = harness();
    const owner = coordinator.createOwner(true);
    calls[0].reject(new Error('Activity unavailable'));
    await flush();
    assert.equal(errors.length, 1);
    assert.equal(calls.length, 1); // Failed unchanged state must not spin.
    owner.setActive(true);
    assert.equal(calls.length, 2);
    calls[1].resolve();
    await flush();
    owner.release();
    calls[2].reject(new Error('Activity unavailable'));
    await flush();
    assert.equal(errors.length, 2);
    const inactive = coordinator.createOwner(false);
    assert.equal(calls.length, 4);
    assert.equal(calls[3].enabled, false); // Retry unknown native state.
    calls[3].resolve();
    await flush();
    inactive.release();
    assert.equal(calls.length, 4);
  }
  {
    const { coordinator, calls, errors } = harness();
    const owner = coordinator.createOwner(true);
    owner.setActive(false);
    calls[0].reject(new Error('Activity unavailable'));
    await flush();
    assert.equal(errors.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].enabled, false); // Apply the state changed while pending.
    calls[1].resolve();
    await flush();
    owner.release();
    assert.equal(calls.length, 2);
  }
  console.log(
    'Screen-awake checks: PASS (ownership, deferred races, background, release, recovery)',
  );
}
void checks();
