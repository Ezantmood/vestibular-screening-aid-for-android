import assert from './assert';
import { computeFrameTimingStats } from '../src/camera/frameTiming';
import { computeVideoTimelineStats } from '../src/camera/videoTimeline';
import { classifyFrameMad, computeFrameChangeStats } from '../src/camera/frameChange';

const timestamps = Array.from({ length: 121 }, (_, i) => (i * 1_000_000_000) / 120);
const before = JSON.stringify(timestamps);
const timing = computeFrameTimingStats(timestamps, 120);
assert.ok(Math.abs(timing.observedFps - 120) < 1e-9);
assert.equal(timing.largeGapCount, 0);
assert.equal(timing.estimatedMissingFrames, 0);
assert.equal(JSON.stringify(timestamps), before);
const dropped = computeFrameTimingStats(
  timestamps.filter((_, i) => i !== 50),
  120,
);
assert.equal(dropped.largeGapCount, 1);
assert.equal(dropped.estimatedMissingFrames, 1);
assert.throws(() => computeFrameTimingStats([], 120));
assert.throws(() => computeFrameTimingStats(timestamps, 0));

const pts = Array.from({ length: 1201 }, (_, i) => Math.round((i * 1_000_000) / 120));
const timeline = computeVideoTimelineStats(pts, 120);
assert.equal(timeline.effectiveFps, 120);
assert.equal(timeline.nonMonotonicCount, 0);
assert.equal(timeline.duplicatePtsCount, 0);
assert.equal(timeline.largeGapCount, 0);
const malformed = [...pts];
malformed[10] = malformed[9];
malformed[20] = malformed[19] - 1;
const malformedStats = computeVideoTimelineStats(malformed, 120);
assert.equal(malformedStats.duplicatePtsCount, 1);
assert.equal(malformedStats.nonMonotonicCount, 2);
assert.equal(computeVideoTimelineStats([0], 120).effectiveFps, null);
assert.equal(computeVideoTimelineStats([0, 0], 120).effectiveFps, null);
assert.throws(() => computeVideoTimelineStats([], 120));
assert.throws(() => computeVideoTimelineStats(pts, -1));

assert.equal(classifyFrameMad(-1), 'skipped');
assert.equal(classifyFrameMad(NaN), 'skipped');
assert.equal(classifyFrameMad(0), 'near-duplicate-candidate');
assert.equal(classifyFrameMad(2), 'low-motion');
assert.equal(classifyFrameMad(10), 'changing');
const changes = computeFrameChangeStats([0, 0.5, -1, 0.5, 2, 10]);
assert.equal(changes.validComparisons, 5);
assert.equal(changes.nearDuplicateCount, 3);
assert.equal(changes.longestDuplicateRun, 2);
assert.equal(changes.lowMotionCount, 1);
assert.equal(computeFrameChangeStats([-1, NaN]).madMedian, null);
console.log(
  'Camera pipeline checks: PASS (P1 timing/missing estimates, P2 real PTS order/gaps, MAD candidates/sentinels)',
);
