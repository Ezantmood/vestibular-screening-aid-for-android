// P4 synthetic logic checks — runs with plain node after `tsc` compile to
// /tmp (see header command). Covers: state machine, PTS-gap tolerance,
// null-PTS fallback, blink/loss honesty (no fabrication), reacquisition,
// temporal-gate behavior (rapid movement not rejected), rescue merge,
// dropout/reacquisition stats, per-eye independence, coordinate contract,
// and verdict gates.
//
// Run: npx tsc --ignoreConfig scripts/p4LogicCheck.ts
//   src/eyetracking/tracking/pupilTracker.ts
//   src/eyetracking/tracking/twoPassTracking.ts
//   src/eyetracking/tracking/trackingReport.ts
//   src/eyetracking/tracking/trackingTypes.ts
//   src/eyetracking/pupil/pupilTypes.ts
//   --outDir /tmp/p4check --module commonjs --target es2020
//   --esModuleInterop --skipLibCheck && node /tmp/p4check/scripts/p4LogicCheck.js
import type {
  EyeSide,
  PupilDetectionResult,
  PupilFailureReason,
} from '../src/eyetracking/pupil/pupilTypes';
import type { PupilTrackingResult } from '../src/eyetracking/tracking/trackingTypes';
import {
  EyeTracker,
  GATE_RESEED_AFTER_US,
  trackBothEyes,
  trackEyeResults,
} from '../src/eyetracking/tracking/pupilTracker';
import {
  aggregateTrackingStats,
  aggregateTrackingStatsForRuns,
  trackingRobustnessVerdict,
} from '../src/eyetracking/tracking/trackingReport';
import { propagateRois } from '../src/eyetracking/tracking/roiPropagation';
import type { FramePipelineFaceSample } from '../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';
import { buildRescueHints, mergeRescuedResults } from '../src/eyetracking/tracking/twoPassTracking';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL - ${name} ${detail}`);
  }
}

let frameSeq = 0;
function okResult(
  patch: Partial<PupilDetectionResult> & { eyeSide: EyeSide },
): PupilDetectionResult {
  const i = frameSeq++;
  const { eyeSide, ...rest } = patch;
  return {
    frameIndex: i,
    decodedPtsUs: i * 8333,
    eyeSide,
    detectorId: 'percentile-dark',
    roiX: 800,
    roiY: 400,
    roiWidth: 120,
    roiHeight: 100,
    centroidXInRoi: 60,
    centroidYInRoi: 50,
    centroidXInFrame: 860,
    centroidYInFrame: 450,
    normalizedX: 0.5,
    normalizedY: 0.5,
    candidateWidth: 34,
    candidateHeight: 32,
    confidence: 0.6,
    failureReason: null,
    ...rest,
  };
}

function failResult(
  frameIndex: number,
  ptsUs: number | null,
  eyeSide: EyeSide,
  reason: PupilFailureReason,
  withRoi = true,
): PupilDetectionResult {
  return {
    frameIndex,
    decodedPtsUs: ptsUs,
    eyeSide,
    detectorId: 'percentile-dark',
    roiX: withRoi ? 800 : 0,
    roiY: withRoi ? 400 : 0,
    roiWidth: withRoi ? 120 : 0,
    roiHeight: withRoi ? 100 : 0,
    centroidXInRoi: null,
    centroidYInRoi: null,
    centroidXInFrame: null,
    centroidYInFrame: null,
    normalizedX: null,
    normalizedY: null,
    candidateWidth: null,
    candidateHeight: null,
    confidence: 0,
    failureReason: reason,
  };
}

// 1. First valid measurement initializes TRACKED with raw preserved.
{
  frameSeq = 0;
  const out = trackEyeResults([okResult({ eyeSide: 'left' })]);
  check('first-valid-TRACKED', out[0].trackingState === 'TRACKED', out[0].trackingState);
  check('tracked-equals-raw', out[0].trackedCentroidX === 860 && out[0].trackedCentroidY === 450);
  check('dropout-zero-on-valid', out[0].dropoutDurationUs === 0);
  check('no-failure-on-valid', out[0].failureReason === null);
}

// 2. Missing before any valid stays UNINITIALIZED, never fabricated.
{
  frameSeq = 0;
  const out = trackEyeResults([
    failResult(0, 0, 'left', 'NO_FACE', false),
    failResult(1, 8333, 'left', 'NO_PUPIL_CANDIDATE'),
  ]);
  check(
    'pre-init-UNINITIALIZED',
    out.every((t) => t.trackingState === 'UNINITIALIZED'),
    out.map((t) => t.trackingState).join(','),
  );
  check(
    'pre-init-no-tracked',
    out.every((t) => t.trackedCentroidX === null && t.trackedCentroidY === null),
  );
}

// 3. Short gap → TEMPORARILY_LOST / BLINK, dropout measured, no fabrication.
{
  frameSeq = 0;
  const seq = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    failResult(1, 8333, 'left', 'NO_PUPIL_CANDIDATE'),
    failResult(2, 16666, 'left', 'NO_PUPIL_CANDIDATE'),
    okResult({ eyeSide: 'left', frameIndex: 3, decodedPtsUs: 25000 }),
  ];
  const out = trackEyeResults(seq);
  check(
    'short-gap-TEMPORARILY_LOST',
    out[1].trackingState === 'TEMPORARILY_LOST',
    out[1].trackingState,
  );
  check('short-gap-dropout', out[1].dropoutDurationUs === 8333, String(out[1].dropoutDurationUs));
  check(
    'short-gap-no-tracked',
    out[1].trackedCentroidX === null && out[2].trackedCentroidX === null,
  );
  check('short-gap-reacquire-TRACKED', out[3].trackingState === 'TRACKED', out[3].trackingState);
  const blink = trackEyeResults([
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    failResult(1, 8333, 'left', 'EYE_CLOSED_OR_OCCLUDED'),
  ]);
  check(
    'closed-eyes-BLINK',
    blink[1].trackingState === 'BLINK_OR_OCCLUDED',
    blink[1].trackingState,
  );
  check('blink-no-tracked', blink[1].trackedCentroidX === null);
}

// 4. Timeout ladder: REACQUIRING after 500 ms, LOST after 2000 ms (PTS-based).
{
  frameSeq = 0;
  const seq: PupilDetectionResult[] = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
  ];
  for (let i = 1; i <= 320; i++) {
    seq.push(failResult(i, i * 8333, 'left', 'NO_PUPIL_CANDIDATE'));
  }
  const out = trackEyeResults(seq);
  const at600ms = out.find((t) => (t.decodedPtsUs ?? 0) >= 600_000);
  const at2500ms = out.find((t) => (t.decodedPtsUs ?? 0) >= 2_500_000);
  check(
    'reacquiring-after-500ms',
    at600ms?.trackingState === 'REACQUIRING',
    at600ms?.trackingState ?? '?',
  );
  check('lost-after-2000ms', at2500ms?.trackingState === 'LOST', at2500ms?.trackingState ?? '?');
  check('lost-no-tracked', at2500ms?.trackedCentroidX === null);
  check(
    'lost-dropout-duration',
    (at2500ms?.dropoutDurationUs ?? 0) >= 2_400_000,
    String(at2500ms?.dropoutDurationUs),
  );
}

// 5. Reacquisition from LOST returns to TRACKED on a real measurement.
{
  frameSeq = 0;
  const seq: PupilDetectionResult[] = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
  ];
  for (let i = 1; i <= 300; i++) {
    seq.push(failResult(i, i * 8333, 'left', 'NO_FACE'));
  }
  seq.push(okResult({ eyeSide: 'left', frameIndex: 301, decodedPtsUs: 301 * 8333 }));
  const out = trackEyeResults(seq);
  const last = out[out.length - 1];
  check('reacquire-from-LOST', last.trackingState === 'TRACKED', last.trackingState);
  check(
    'reacquire-tracked-on-pupil',
    last.trackedCentroidX === 860 && last.trackedCentroidY === 450,
  );
}

// 6. P3.5-style irregular gaps (25/25/42 ms) do not break the tracker.
{
  frameSeq = 0;
  const pts = [0, 8333, 33333, 58333, 100000, 108333];
  const seq = pts.map((p, i) => okResult({ eyeSide: 'right', frameIndex: i, decodedPtsUs: p }));
  const out = trackEyeResults(seq);
  check(
    'irregular-gaps-stay-TRACKED',
    out.every((t) => t.trackingState === 'TRACKED' || t.trackingState === 'LOW_CONFIDENCE'),
    out.map((t) => t.trackingState).join(','),
  );
  check(
    'irregular-gaps-no-estimate',
    out.every((t) => t.ptsEstimated === false),
  );
}

// 7. Null PTS falls back to nominal timing and flags ptsEstimated.
{
  frameSeq = 0;
  const seq = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: null }),
    okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: null }),
    failResult(2, null, 'left', 'NO_PUPIL_CANDIDATE'),
  ];
  const out = trackEyeResults(seq);
  check(
    'null-pts-tracks',
    out[0].trackingState === 'TRACKED' && out[1].trackingState === 'TRACKED',
  );
  check(
    'null-pts-flagged',
    out.every((t) => t.ptsEstimated === true),
  );
  check(
    'null-pts-dropout-estimated',
    Math.abs(out[2].dropoutDurationUs - 8333) <= 1,
    String(out[2].dropoutDurationUs),
  );
}

// 8. Rapid movement: high-confidence far jump accepted; low-conf far jump rejected.
{
  frameSeq = 0;
  const base = okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0, confidence: 0.6 });
  const farHigh = {
    ...okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333, confidence: 0.8 }),
    centroidXInRoi: 110,
    centroidXInFrame: 910,
    normalizedX: 110 / 120,
  };
  const outHigh = trackEyeResults([base, farHigh]);
  check(
    'high-conf-jump-accepted',
    outHigh[1].trackingState === 'TRACKED',
    outHigh[1].trackingState,
  );
  check('high-conf-jump-tracked', outHigh[1].trackedCentroidX === 910);
  check('high-conf-jump-not-rejected', outHigh[1].gateRejected === false);
  const farLow = {
    ...okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333, confidence: 0.4 }),
    centroidXInRoi: 110,
    centroidXInFrame: 910,
    normalizedX: 110 / 120,
  };
  const outLow = trackEyeResults([base, farLow]);
  check('low-conf-jump-rejected', outLow[1].gateRejected === true);
  check('low-conf-jump-no-tracked', outLow[1].trackedCentroidX === null);
  check('low-conf-jump-raw-preserved', outLow[1].rawCentroidX === 910);
}

// 9. Rescued measurements accepted with capped confidence.
{
  frameSeq = 0;
  const base = okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0, confidence: 0.6 });
  const rescued = {
    ...okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333, confidence: 0.5 }),
    rescued: true,
  };
  const out = trackEyeResults([base, rescued]);
  check('rescued-accepted', out[1].trackedCentroidX === 860 && out[1].rescued === true);
  check('rescued-capped', out[1].trackingConfidence <= 0.55, String(out[1].trackingConfidence));
}

// 10. Long-gap re-seed: far measurement after >500 ms accepted (not rejected).
{
  frameSeq = 0;
  const seq = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    {
      ...okResult({
        eyeSide: 'left',
        frameIndex: 100,
        decodedPtsUs: GATE_RESEED_AFTER_US + 100_000,
      }),
      centroidXInRoi: 110,
      centroidXInFrame: 910,
      normalizedX: 110 / 120,
    },
  ];
  const out = trackEyeResults(seq);
  check('long-gap-reseed', out[1].trackingState === 'TRACKED' && out[1].gateRejected === false);
}

// 11. Weak raw confidence → LOW_CONFIDENCE with measurement retained.
{
  frameSeq = 0;
  const out = trackEyeResults([
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0, confidence: 0.6 }),
    okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333, confidence: 0.36 }),
  ]);
  check('weak-LOW_CONFIDENCE', out[1].trackingState === 'LOW_CONFIDENCE', out[1].trackingState);
  check('weak-tracked-kept', out[1].trackedCentroidX === 860);
}

// 12. Per-eye independence.
{
  frameSeq = 0;
  const both = trackBothEyes([
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    failResult(0, 0, 'right', 'NO_PUPIL_CANDIDATE'),
    okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333 }),
    failResult(1, 8333, 'right', 'NO_PUPIL_CANDIDATE'),
  ]);
  check(
    'left-tracks',
    both.left.every((t) => t.trackingState === 'TRACKED'),
  );
  check(
    'right-uninitialized',
    both.right.every((t) => t.trackingState === 'UNINITIALIZED' && t.trackedCentroidX === null),
  );
}

// 13. Coordinate contract: tracked echoes analysis/frame coords exactly.
{
  frameSeq = 0;
  const r = okResult({
    eyeSide: 'right',
    centroidXInRoi: 37.5,
    centroidYInRoi: 61.25,
    centroidXInFrame: 837.5,
    centroidYInFrame: 461.25,
    normalizedX: 37.5 / 120,
    normalizedY: 61.25 / 100,
  });
  const out = trackEyeResults([r]);
  check(
    'analysis-coords-preserved',
    out[0].trackedCentroidX === 837.5 && out[0].trackedCentroidY === 461.25,
    `${out[0].trackedCentroidX},${out[0].trackedCentroidY}`,
  );
}

// 14. Rescue hints: eligible failed slot hinted; stale/no-ROI skipped.
{
  frameSeq = 0;
  const inputs = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    failResult(1, 8333, 'left', 'LOW_CONFIDENCE'),
    failResult(2, 900000, 'left', 'NO_PUPIL_CANDIDATE'),
    failResult(3, 910000, 'left', 'NO_FACE', false),
  ];
  const hints = buildRescueHints(inputs);
  check(
    'hint-for-fresh-failure',
    hints.some((h) => h.frameIndex === 1),
    JSON.stringify(hints.length),
  );
  check(
    'no-hint-stale-prior',
    !hints.some((h) => h.frameIndex === 2),
    JSON.stringify(hints.length),
  );
  check('no-hint-without-roi', !hints.some((h) => h.frameIndex === 3));
  const hint = hints.find((h) => h.frameIndex === 1);
  check('hint-prior-in-roi', (hint?.priorXInRoi ?? -1) === 60 && (hint?.priorYInRoi ?? -1) === 50);
  check('hint-radius-positive', (hint?.searchRadiusPx ?? 0) > 0);
}

// 15. Merge: only successful rescues replace, tagged.
{
  frameSeq = 0;
  const std = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    failResult(1, 8333, 'left', 'LOW_CONFIDENCE'),
    failResult(2, 16666, 'left', 'NO_PUPIL_CANDIDATE'),
  ];
  const rescued = [
    okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333 }),
    failResult(2, 16666, 'left', 'NO_PUPIL_CANDIDATE'),
  ];
  const merged = mergeRescuedResults(std, rescued);
  check('merge-rescued-tagged', merged[1].rescued === true && merged[1].failureReason === null);
  check(
    'merge-keeps-honest-failure',
    merged[2].rescued !== true && merged[2].failureReason !== null,
  );
  check('merge-keeps-success', merged[0].rescued !== true);
}

// 16. Stats + verdict on a blink-like sequence.
{
  frameSeq = 0;
  const raw: PupilDetectionResult[] = [];
  for (let i = 0; i < 40; i++) {
    const pts = i * 8333;
    if (i >= 15 && i < 25) {
      raw.push(failResult(i, pts, 'left', 'EYE_CLOSED_OR_OCCLUDED'));
    } else {
      raw.push(okResult({ eyeSide: 'left', frameIndex: i, decodedPtsUs: pts }));
    }
  }
  const tracked = trackEyeResults(raw);
  const stats = aggregateTrackingStats({ raw, tracked });
  const side = stats.sides[0];
  check('stats-no-fabrication', stats.noFabricatedPositions && stats.gapsNeverFabricated);
  check('stats-one-dropout', side.dropoutCount === 1, String(side.dropoutCount));
  check('stats-blink-states', side.blinkCount === 10, String(side.blinkCount));
  check('stats-reacquired', side.reacquisitions === 1, String(side.reacquisitions));
  check('stats-longest-run', side.longestRunSamples === 15, String(side.longestRunSamples));
  check(
    'stats-dropout-duration-gap-based',
    side.dropoutMedianUs === 11 * 8333,
    String(side.dropoutMedianUs),
  );
  const verdict = trackingRobustnessVerdict({ stats, visualAuditPassed: true });
  check('blink-seq-PASS', verdict === 'TRACKING_ROBUSTNESS_PASS', verdict);
  check(
    'audit-gate',
    trackingRobustnessVerdict({ stats, visualAuditPassed: false }) === 'TRACKING_ROBUSTNESS_FAIL',
  );
}

// 17. Verdict FAIL cases.
{
  frameSeq = 0;
  // No reacquisition anywhere → FAIL.
  const raw = [
    okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 }),
    failResult(1, 8333, 'left', 'NO_PUPIL_CANDIDATE'),
  ];
  const tracked = trackEyeResults(raw);
  const stats = aggregateTrackingStats({ raw, tracked });
  check(
    'no-reacquisition-FAIL',
    trackingRobustnessVerdict({ stats, visualAuditPassed: true }) === 'TRACKING_ROBUSTNESS_FAIL',
  );
  // Fabricated coordinate → FAIL.
  const bad: PupilTrackingResult[] = [
    {
      ...tracked[0],
      trackedCentroidX: 1,
      trackedCentroidY: 1,
      rawCentroidX: null,
      rawCentroidY: null,
    },
  ];
  const badStats = aggregateTrackingStats({ raw: [raw[0]], tracked: bad });
  check(
    'fabrication-FAIL',
    trackingRobustnessVerdict({ stats: badStats, visualAuditPassed: true }) ===
      'TRACKING_ROBUSTNESS_FAIL',
  );
}

// 18. EyeTracker class stepwise + reset.
{
  const t = new EyeTracker();
  check('init-state', t.currentState === 'UNINITIALIZED', t.currentState);
  frameSeq = 100;
  t.step(okResult({ eyeSide: 'right', frameIndex: 100, decodedPtsUs: 0 }));
  check('step-tracks', t.currentState === 'TRACKED', t.currentState);
  t.reset();
  check('reset-state', t.currentState === 'UNINITIALIZED', t.currentState);
}

// 19. Multi-run pooling: boundaries never crossed, conditions exact.
{
  frameSeq = 0;
  const mkRun = (
    cond: string,
    blinkAt: number[],
  ): { condition: string; raw: PupilDetectionResult[]; tracked: PupilTrackingResult[] } => {
    const raw: PupilDetectionResult[] = [];
    for (let i = 0; i < 20; i++) {
      raw.push(
        blinkAt.includes(i)
          ? failResult(i, i * 8333, 'left', 'EYE_CLOSED_OR_OCCLUDED')
          : okResult({ eyeSide: 'left', frameIndex: i, decodedPtsUs: i * 8333 }),
      );
    }
    return { condition: cond, raw, tracked: trackEyeResults(raw) };
  };
  const runs = [mkRun('center', []), mkRun('blink', [8, 9, 10])];
  const pooled = aggregateTrackingStatsForRuns(runs);
  check('pooled-evaluated', pooled.evaluated === 40, String(pooled.evaluated));
  check(
    'pooled-one-dropout',
    pooled.sides[0].dropoutCount === 1,
    String(pooled.sides[0].dropoutCount),
  );
  check('pooled-conditions', pooled.conditions.length === 2, String(pooled.conditions.length));
  check(
    'pooled-condition-rates',
    pooled.conditions[0].trackedValidRate === 1 && (pooled.conditions[1].trackedValidRate ?? 0) < 1,
    JSON.stringify(pooled.conditions.map((c) => c.trackedValidRate)),
  );
  check(
    'pooled-no-cross-boundary-dropout',
    pooled.sides[0].dropoutMaxUs !== null && pooled.sides[0].dropoutMaxUs < 500_000,
    String(pooled.sides[0].dropoutMaxUs),
  );
}

// 20. ROI propagation: keyframes exact, interpolation, no crossing of invalid samples.
function faceSample(
  frameIndex: number,
  ptsUs: number | null,
  leftX: number | null,
): FramePipelineFaceSample {
  const eye: FramePipelineFaceSample['leftEye'] =
    leftX === null
      ? null
      : { x: leftX, y: 400, width: 120, height: 100, usable: true, estimated: false };
  return {
    frameIndex,
    ptsUs,
    faceDetected: eye !== null,
    faceBox: eye !== null ? { x: 700, y: 300, width: 400, height: 400 } : null,
    leftEye: eye,
    rightEye: null,
    rotationApplied: 0,
    error: null,
  };
}
{
  const samples = [
    faceSample(0, 0, 800),
    faceSample(10, 83330, 820),
    faceSample(20, 166660, null),
    faceSample(30, 249990, 840),
    faceSample(38, 316654, 860),
  ];
  const ptsList: (number | null)[] = [];
  for (let f = 0; f < 40; f++) {
    ptsList.push(f * 8333);
  }
  const rois = propagateRois({ faceSamples: samples, decodedPtsUsList: ptsList, frameCount: 40 });
  const left = rois.filter((r) => r.eyeSide === 'left');
  const at = (f: number): (typeof left)[number] =>
    left.find((r) => r.frameIndex === f) as (typeof left)[number];
  check('prop-keyframe-exact', at(0).keyframe && at(0).roiX === 800 && at(0).decodedPtsUs === 0);
  check('prop-midpoint', !at(5).keyframe && at(5).roiX === 810, String(at(5).roiX));
  check('prop-true-pts', at(5).decodedPtsUs === 5 * 8333, String(at(5).decodedPtsUs));
  check(
    'prop-no-cross-invalid',
    at(15).missingReason !== null && at(25).missingReason !== null,
    `${at(15).missingReason}/${at(25).missingReason}`,
  );
  check('prop-before-first-missing', at(0).missingReason === null);
  const last = left.filter((r) => r.frameIndex === 39)[0];
  check('prop-after-last-missing', last.missingReason !== null, String(last.missingReason));
  check(
    'prop-interpolated-clean-interval',
    at(34).missingReason === null && at(34).roiX === 850,
    `${at(34).missingReason}/${at(34).roiX}`,
  );
}

// 21. Median-relative gaps: sparse sampling is not a "large gap"; real encoder gaps are.
{
  frameSeq = 0;
  // 80 samples at ~125 ms spacing, all valid: no large gaps expected.
  const sparse: PupilDetectionResult[] = [];
  for (let i = 0; i < 80; i++) {
    sparse.push(okResult({ eyeSide: 'left', frameIndex: i * 15, decodedPtsUs: i * 125000 }));
  }
  const st = trackEyeResults(sparse);
  const stats = aggregateTrackingStats({ raw: sparse, tracked: st });
  check(
    'sparse-no-large-gaps',
    stats.sides[0].largeGapCount === 0,
    String(stats.sides[0].largeGapCount),
  );
  // Full-rate with a 42 ms encoder gap: detected and survived.
  frameSeq = 0;
  const dense: PupilDetectionResult[] = [];
  let pts = 0;
  for (let i = 0; i < 40; i++) {
    if (i === 20) {
      pts += 42000;
    } else {
      pts += 8333;
    }
    dense.push(okResult({ eyeSide: 'left', frameIndex: i, decodedPtsUs: pts }));
  }
  const dt = trackEyeResults(dense);
  const ds = aggregateTrackingStats({ raw: dense, tracked: dt });
  check('encoder-gap-detected', ds.sides[0].largeGapCount === 1, String(ds.sides[0].largeGapCount));
  check(
    'encoder-gap-survived',
    ds.sides[0].gapSurvivedCount === 1,
    String(ds.sides[0].gapSurvivedCount),
  );
}

// Additional robustness regressions: blink protection, ROI movement, PTS interpolation.
{
  const base = okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 });
  const blink = failResult(1, 8333, 'left', 'EYE_CLOSED_OR_OCCLUDED');
  check('blink-never-hinted', buildRescueHints([base, blink]).length === 0);
  const fakeRescue = okResult({ eyeSide: 'left', frameIndex: 1, decodedPtsUs: 8333 });
  check(
    'blink-never-merged',
    mergeRescuedResults([blink], [fakeRescue])[0].centroidXInFrame === null,
  );
  const moved = { ...base, frameIndex: 1, decodedPtsUs: 8333, roiX: 1000, centroidXInFrame: 1060 };
  const result = trackEyeResults([base, moved]);
  check(
    'head-translation-no-false-dropout',
    result[1].trackedCentroidX === 1060 && !result[1].gateRejected,
  );
  const failedMoved = { ...failResult(1, 8333, 'left', 'LOW_CONFIDENCE'), roiX: 1000 };
  check('rescue-prior-follows-head', buildRescueHints([base, failedMoved])[0].priorXInRoi === 60);
  check(
    'stale-PTS-rescue-not-merged',
    mergeRescuedResults([failedMoved], [{ ...moved, decodedPtsUs: 9000 }])[0].failureReason ===
      'LOW_CONFIDENCE',
  );
  const pts = [0, 1000, 9000, 10000];
  const rois = propagateRois({
    faceSamples: [faceSample(0, 0, 800), faceSample(3, 10000, 900)],
    decodedPtsUsList: pts,
    frameCount: 4,
  });
  check(
    'ROI-interpolation-uses-time',
    rois.find((r) => r.frameIndex === 1 && r.eyeSide === 'left')?.roiX === 810,
  );
  const tracker = new EyeTracker();
  tracker.step(base);
  let rejected = false;
  try {
    tracker.step(base);
  } catch {
    rejected = true;
  }
  check('duplicate-PTS-rejected', rejected);
  const lost = tracker.step(failResult(100, 3_000_000, 'left', 'NO_FACE', false));
  check('lost-confidence-zero', lost.trackingConfidence === 0);
}

{
  const base = okResult({ eyeSide: 'left', frameIndex: 0, decodedPtsUs: 0 });
  const accepted = trackEyeResults([base])[0];
  check(
    'altered-raw-coordinate-rejected-by-audit',
    !aggregateTrackingStats({ raw: [base], tracked: [{ ...accepted, trackedCentroidX: 999 }] })
      .noFabricatedPositions,
  );
  check(
    'partial-coordinate-rejected-by-audit',
    !aggregateTrackingStats({ raw: [base], tracked: [{ ...accepted, trackedCentroidY: null }] })
      .noFabricatedPositions,
  );
  const invalid = trackEyeResults([{ ...base, centroidXInFrame: NaN }])[0];
  check(
    'nonfinite-detection-never-tracked',
    invalid.trackedCentroidX === null && invalid.failureReason === 'INVALID_GEOMETRY',
  );
  const tracker = new EyeTracker();
  tracker.step(base);
  let mixed = false;
  try {
    tracker.step({ ...base, frameIndex: 1, decodedPtsUs: 8333, eyeSide: 'right' });
  } catch {
    mixed = true;
  }
  check('streaming-eye-mixing-rejected', mixed);
  check('stale-prediction-cleared', tracker.predictAt(3_000_000) === null);
}

console.log(failures === 0 ? `\nP4 checks: ALL PASS` : `\nP4 checks: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
