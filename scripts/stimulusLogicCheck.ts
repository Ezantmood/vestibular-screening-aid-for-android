import {
  beginStimulus,
  defaultStimulus,
  finishStimulus,
  recordPresentation,
  targetAt,
} from '../src/tests/stimulus/engine';
import { clockBridge, matchFrame } from '../src/tests/stimulus/synchronization';
const assert = {
  equal(a: unknown, b: unknown) {
    if (a !== b) throw new Error(`Expected ${String(b)}, got ${String(a)}`);
  },
  ok(value: boolean) {
    if (!value) throw new Error('Assertion failed');
  },
  throws(fn: () => unknown) {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('Expected rejection');
  },
};
const pursuit = defaultStimulus('smooth-pursuit');
assert.equal(targetAt(pursuit, 0)?.x, 0.5);
assert.ok(Math.abs(targetAt(pursuit, 1_000_000)!.x - 0.85) < 1e-12);
assert.ok(Math.abs(targetAt(pursuit, 3_000_000)!.x - 0.15) < 1e-12);
assert.equal(targetAt(pursuit, -1), null);
assert.equal(targetAt(pursuit, pursuit.durationUs), null);
assert.equal(targetAt(pursuit, NaN), null);
const saccade = defaultStimulus('horizontal-saccades');
assert.equal(targetAt(saccade, 999_999)?.x, 0.5);
assert.ok(Math.abs(targetAt(saccade, 1_000_000)!.x - 0.15) < 1e-12);
assert.ok(Math.abs(targetAt(saccade, 2_000_000)!.x - 0.85) < 1e-12);
assert.equal(targetAt(saccade, 2_300_000)?.segment, 2);
assert.throws(() => beginStimulus({ ...pursuit, amplitude: NaN }, 0));
assert.throws(() => beginStimulus({ ...pursuit, durationUs: Infinity }, 0));
const run = beginStimulus(saccade, 100_000);
recordPresentation(run, targetAt(saccade, 0)!, 0, 100_100);
recordPresentation(run, targetAt(saccade, 1_000_000)!, 1_000_000, 1_120_000);
assert.throws(() => recordPresentation(run, targetAt(saccade, 0)!, 0, 100_050));
const bridge = clockBridge(50_000, 1_051_000, 52_000);
assert.equal(bridge.nativeMinusJsUs, 1_000_000);
assert.equal(bridge.roundTripUs, 2000);
assert.throws(() => clockBridge(2, 4, 1));
const anchor = {
  mediaPtsUs: 77_000,
  nativeElapsedUs: 1_100_000,
  source: 'measured-frame' as const,
  uncertaintyUs: 500,
};
assert.equal(matchFrame(run, null, bridge, anchor).status, 'missing-timestamp');
assert.equal(matchFrame(run, 77_000, bridge, null).status, 'unsynchronized');
assert.equal(matchFrame(run, 77_000, bridge, anchor).status, 'not-presented');
const joined = matchFrame(run, 1_087_000, bridge, anchor);
assert.equal(joined.status, 'matched');
assert.equal(joined.elapsedUs, 1_010_000);
assert.equal(joined.planned?.segment, 1);
assert.equal(joined.presented?.segment, 0); // delayed UI commit, never invented onset
assert.equal(joined.uncertaintyUs, 1500);
const estimate = matchFrame(run, 1_087_000, bridge, {
  ...anchor,
  source: 'record-start-estimate',
  uncertaintyUs: null,
});
assert.equal(estimate.status, 'estimated');
assert.equal(estimate.uncertaintyUs, null);
finishStimulus(run, 1_200_000, true);
assert.equal(matchFrame(run, 1_177_000, bridge, anchor).status, 'outside-run');
const count = run.presentations.length;
recordPresentation(run, targetAt(saccade, 0)!, 0, 1_300_000);
assert.equal(run.presentations.length, count);
finishStimulus(run, 2_000_000, false);
assert.equal(run.outcome, 'cancelled');
console.log(
  'Stimulus checks: ALL PASS (trajectory, boundaries, drift, commit delay, clocks, PTS, cancellation)',
);
