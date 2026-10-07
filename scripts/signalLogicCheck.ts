import assert from './assert';
import { processTrajectory } from '../src/signals/processing';
import type { SignalInputSample } from '../src/signals/types';

const pts = [0, 7000, 16000, 25000, 32000, 45000, 51000];
const ramp: SignalInputSample[] = pts.map((decodedPtsUs, frameIndex) => ({
  frameIndex,
  decodedPtsUs,
  x: 0.2 + (decodedPtsUs / 1_000_000) * 2,
  y: 0.4,
  confidence: 0.9,
}));
const processed = processTrajectory(ramp);
for (const s of processed.samples.slice(1)) assert.ok(Math.abs(s.velocityXPerSecond! - 2) < 1e-8);
assert.equal(processed.samples[0].velocityXPerSecond, null);
assert.equal(processed.interpolatedSamples, 0);
const before = JSON.stringify(ramp);
processTrajectory(ramp);
assert.equal(JSON.stringify(ramp), before);
const dropout = ramp.map((s) => ({ ...s }));
dropout[2].x = null;
const dropped = processTrajectory(dropout);
assert.equal(dropped.samples[2].processedX, null);
assert.equal(dropped.samples[3].velocityXPerSecond, null);
assert.notEqual(dropped.samples[1].segmentId, dropped.samples[3].segmentId);
const gap = ramp.map((s) => ({ ...s }));
for (let i = 3; i < gap.length; i++) gap[i].decodedPtsUs! += 500_000;
const g = processTrajectory(gap);
assert.equal(g.samples[3].velocityXPerSecond, null);
assert.ok(g.gaps.some((v) => v.durationUs! >= 500_000));
for (const timestamp of [null, NaN, -1, 7000]) {
  const data = ramp.map((s) => ({ ...s }));
  data[2].decodedPtsUs = timestamp;
  const p = processTrajectory(data);
  assert.equal(p.samples[2].processedX, null);
  assert.equal(p.samples[3].velocityXPerSecond, null);
}
const estimated = ramp.map((s) => ({ ...s, estimated: true }));
assert.equal(processTrajectory(estimated).qualityAfter.usable, 0);
const spike = Array.from({ length: 9 }, (_, frameIndex) => ({
  frameIndex,
  decodedPtsUs: frameIndex * 8000,
  x: frameIndex === 4 ? 0.8 : 0.5,
  y: 0.5,
  confidence: frameIndex === 4 ? 0.5 : 0.9,
}));
const sp = processTrajectory(spike);
assert.equal(sp.outliers, 1);
assert.equal(sp.samples[4].processedX, null);
assert.equal(sp.raw[4].x, 0.8);
assert.equal(sp.samples[5].velocityXPerSecond, null);
spike[4].confidence = 0.9;
assert.equal(processTrajectory(spike).outliers, 0);
const step = spike.map((s, i) => ({ ...s, confidence: 0.9, x: i < 4 ? 0.4 : 0.7 }));
const st = processTrajectory(step);
assert.equal(st.samples[4].processedX, 0.7);
assert.equal(st.samples[3].processedX, 0.4);
assert.equal(st.outliers, 0);
// Regression: mixed raw/filtered support used to create >1 fraction/s reverse
// spikes after a monotonic 240-fps ramp had already reached its endpoint.
for (const dt of [4167, 2000]) {
  const rapid = Array.from({ length: 180 }, (_, frameIndex) => ({
    frameIndex,
    decodedPtsUs: frameIndex * dt,
    x: 0.15 + 0.7 * Math.max(0, Math.min(1, (frameIndex * dt - 80_656) / 50_000)),
    y: 0.5,
    confidence: 0.9,
  }));
  const processed = processTrajectory(rapid, { coordinateSpace: 'screen-normalized' });
  assert.ok(processed.samples.every((s) => (s.velocityXPerSecond ?? 0) >= -1e-8));
  assert.equal(processed.samples.at(-1)!.raw.x, 0.85);
  assert.ok(Math.abs(processed.samples.at(-1)!.processedX! - 0.85) < 1e-10);
}
const noise = Array.from({ length: 200 }, (_, frameIndex) => ({
  frameIndex,
  decodedPtsUs: frameIndex * 8000,
  x: 0.5 + (frameIndex % 2 ? 0.008 : -0.008),
  y: 0.5,
  confidence: 0.9,
}));
const n = processTrajectory(noise);
assert.ok(n.qualityAfter.tripletResidualMedian! < n.qualityBefore.tripletResidualMedian!);
const blink = dropout.map((s, i): SignalInputSample =>
  i === 2 ? { ...s, missingReason: 'blink-or-occluded' } : s,
);
assert.ok(processTrajectory(blink).samples[2].reasons.includes('blink-or-occluded'));
assert.throws(() =>
  processTrajectory([
    { ...ramp[0], eyeSide: 'left' },
    { ...ramp[1], eyeSide: 'right' },
  ]),
);
assert.throws(() => processTrajectory(ramp, { maxGapUs: -1 }));
assert.equal(processTrajectory([]).qualityAfter.coverage, 0);
const invalid = ramp.map((s) => ({ ...s }));
invalid[2].x = NaN;
assert.equal(processTrajectory(invalid).samples[2].processedX, null);
invalid[2].x = 1.1;
assert.equal(processTrajectory(invalid).samples[2].processedX, null);
const reversed = ramp.map((s) => ({ ...s }));
reversed[2].decodedPtsUs = 1000;
assert.equal(processTrajectory(reversed).samples[2].processedX, null);
const longer = Array.from({ length: 300 }, (_, frameIndex): SignalInputSample => ({
  frameIndex,
  decodedPtsUs: frameIndex * 10000,
  x: frameIndex > 5 && frameIndex < 280 ? null : 0.5,
  y: frameIndex > 5 && frameIndex < 280 ? null : 0.5,
  confidence: 0.9,
}));
const longResult = processTrajectory(longer);
assert.equal(longResult.samples[280].velocityXPerSecond, null);
assert.equal(longResult.interpolatedSamples, 0);
assert.ok(longResult.gaps[0].durationUs! > 2_000_000);
console.log(
  'Signal checks: PASS (irregular PTS velocity, blink/loss/gaps, spikes, rapid steps, denoise, confidence, immutable raw)',
);
