import assert from './assert';
import { analyzeEyeTest } from '../src/tests/metrics/analysis';
import {
  beginStimulus,
  defaultStimulus,
  finishStimulus,
  recordPresentation,
  targetAt,
} from '../src/tests/stimulus/engine';
import { processTrajectory } from '../src/signals/processing';
import type { SignalInputSample } from '../src/signals/types';
import type { MvpTestId } from '../src/tests/types';
import type { FrameTimeAnchor } from '../src/tests/stimulus/synchronization';
import {
  fitCalibration,
  mapCalibration,
  calibrationUsable,
} from '../src/eyetracking/calibration/calibration';
import { CALIBRATION_TARGETS } from '../src/eyetracking/calibration/protocol';
import type { CalibrationContext } from '../src/eyetracking/calibration/types';

let checks = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    checks++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}
const bridge = { nativeMinusJsUs: 0, roundTripUs: 1000 };
const anchor: FrameTimeAnchor = {
  mediaPtsUs: 50_000,
  nativeElapsedUs: 0,
  source: 'measured-frame',
  uncertaintyUs: 500,
};
function run(testId: MvpTestId) {
  const session = beginStimulus(defaultStimulus(testId), 0);
  for (let t = 0; t < 10_000_000; t += 16_667)
    recordPresentation(session, targetAt(session.config, t)!, t, t);
  finishStimulus(session, 10_010_000, false);
  return session;
}
function raw(gaze: (t: number) => number | null): SignalInputSample[] {
  const samples: SignalInputSample[] = [];
  for (let t = 0, i = 0; t < 10_000_000; t += [8000, 9000, 8000][i % 3], i++) {
    const x = gaze(t / 1_000_000);
    samples.push({
      frameIndex: i,
      decodedPtsUs: 50_000 + t,
      x,
      y: x === null ? null : 0.5,
      confidence: 0.9,
      eyeSide: 'left',
      ...(x === null ? { missingReason: 'blink-or-occluded' as const } : {}),
    });
  }
  return samples;
}
const pursuit =
  (gain = 1, lag = 0) =>
  (t: number) =>
    0.5 + gain * 0.35 * Math.sin((Math.PI / 2) * (t - lag));
function stepGaze(latency = 0.2, scale = 1) {
  return (t: number) => {
    const step = Math.floor(t);
    if (step === 0) return 0.5;
    const to = step % 2 ? 0.15 : 0.85;
    const from = step === 1 ? 0.5 : step % 2 ? 0.85 : 0.15;
    const f = Math.max(0, Math.min(1, (t - step - latency) / 0.05));
    return from + (to - from) * f * scale;
  };
}
function args(testId: MvpTestId, data = raw(testId === 'smooth-pursuit' ? pursuit() : stepGaze())) {
  const signal = processTrajectory(data, { coordinateSpace: 'screen-normalized' });
  return {
    session: run(testId),
    bridge,
    anchor,
    calibration: { id: 'synthetic-cal' },
    calibrationValid: true,
    signals: [
      { eyeSide: 'left' as const, calibrated: signal },
      { eyeSide: 'right' as const, calibrated: signal },
    ],
  };
}
check('pursuit gain 1 with actual irregular PTS', () => {
  const r = analyzeEyeTest(args('smooth-pursuit'));
  assert.equal(r.status, 'GOOD_DATA');
  assert.ok(Math.abs(r.pursuit[0].pursuitGain! - 1) < 0.005);
  assert.equal(r.pursuit[0].catchUpCandidateCount, 0);
});
check('gain 0.6 and phase lag remain distinct from alignment error', () => {
  const r = analyzeEyeTest(args('smooth-pursuit', raw(pursuit(0.6, 0.25))));
  assert.ok(Math.abs(r.pursuit[0].pursuitGain! - 0.6) < 0.005);
  assert.ok(r.pursuit[0].trackingRmse! > 0.09);
});
check('stationary eye has gain 0, not a data-quality failure', () => {
  const r = analyzeEyeTest(
    args(
      'smooth-pursuit',
      raw(() => 0.5),
    ),
  );
  assert.equal(r.status, 'GOOD_DATA');
  assert.ok(r.pursuit[0].pursuitGain! < 1e-8);
});
check('unbounded synchronization never yields good test or precise latency', () => {
  const a = args('horizontal-saccades');
  a.anchor = { ...anchor, source: 'record-start-estimate', uncertaintyUs: null };
  const r = analyzeEyeTest(a);
  assert.equal(r.status, 'POOR_DATA');
  assert.equal(r.saccades[0].medianLatencyMs, null);
  assert.ok(Math.abs(r.saccades[0].medianEstimatedLatencyMs! - 200) < 15);
});
check('nine valid saccades and actual-PTS peak, accuracy and bounded commit latency', () => {
  const r = analyzeEyeTest(args('horizontal-saccades'));
  const e = r.saccades[0];
  assert.equal(e.validResponses, 9);
  assert.equal(r.status, 'GOOD_DATA');
  assert.ok(Math.abs(e.medianLatencyMs! - 200) < 15);
  assert.ok(Math.abs(e.medianPeakVelocityPerSecond! - 14) < 0.1);
  assert.ok(Math.abs(e.medianAccuracy! - 1) < 0.01);
  assert.ok(e.medianOvershoot! < 0.001);
  assert.ok(e.medianUndershoot! < 0.001);
  assert.ok(e.responses[0].latencyUncertaintyMs! > 16);
  console.log(
    'Synthetic saccade reference:',
    JSON.stringify({
      latencyMs: e.medianLatencyMs,
      peak: e.medianPeakVelocityPerSecond,
      accuracy: e.medianAccuracy,
    }),
  );
});
check('overshoot / undershoot directional and accuracy not clamped', () => {
  for (const scale of [0.9, 1.1]) {
    const r = analyzeEyeTest(args('horizontal-saccades', raw(stepGaze(0.2, scale)))).saccades[0]
      .responses[0];
    assert.equal(r.status, 'VALID');
    assert.ok(Math.abs(r.accuracy! - scale) < 0.01);
    assert.ok(Math.abs((scale > 1 ? r.overshoot! : r.undershoot!) - 0.035) < 0.002);
  }
});
check('blink at first onset invalidates that response and recovery permits later responses', () => {
  const gaze = stepGaze();
  const r = analyzeEyeTest(
    args(
      'horizontal-saccades',
      raw((t) => (t > 1.18 && t < 1.23 ? null : gaze(t))),
    ),
  );
  assert.equal(r.saccades[0].responses[0].reason, 'BLINK_OR_DROPOUT');
  assert.equal(r.saccades[0].responses[0].peakVelocityPerSecond, null);
  assert.ok(r.saccades[0].validResponses >= 7);
  assert.ok(r.saccades[0].quality.reasonCounts['blink-or-occluded']! > 0);
});
check('wrong direction is not replaced by a later corrective response', () => {
  const gaze = stepGaze();
  const r = analyzeEyeTest(
    args(
      'horizontal-saccades',
      raw((t) => (t >= 1 && t < 2 ? 1 - gaze(t) : gaze(t))),
    ),
  );
  assert.equal(r.saccades[0].responses[0].reason, 'WRONG_DIRECTION');
});
check('anticipatory responses', () => {
  const r = analyzeEyeTest(args('horizontal-saccades', raw(stepGaze(0.02))));
  assert.equal(r.saccades[0].responses[0].reason, 'ANTICIPATORY_RESPONSE');
});
check('late responses', () => {
  const r = analyzeEyeTest(args('horizontal-saccades', raw(stepGaze(0.7))));
  assert.equal(r.saccades[0].responses[0].reason, 'LATE_RESPONSE');
});
check('no response yields null metrics', () => {
  const r = analyzeEyeTest(
    args(
      'horizontal-saccades',
      raw(() => 0.5),
    ),
  );
  assert.equal(r.status, 'INVALID');
  assert.equal(r.saccades[0].responses[0].reason, 'NO_RESPONSE');
  assert.equal(r.saccades[0].medianPeakVelocityPerSecond, null);
});
check('missing calibration for both tests', () => {
  for (const id of ['smooth-pursuit', 'horizontal-saccades'] as const) {
    const a = args(id);
    a.calibrationValid = false;
    const r = analyzeEyeTest(a);
    assert.equal(r.status, 'INVALID');
    if (id === 'smooth-pursuit') assert.equal(r.pursuit[0].pursuitGain, null);
    else assert.ok(r.saccades[0].responses.every((s) => s.accuracy === null));
  }
});
check('cancelled tests cannot report metrics', () => {
  for (const id of ['smooth-pursuit', 'horizontal-saccades'] as const) {
    const a = args(id);
    a.session.outcome = 'cancelled';
    const r = analyzeEyeTest(a);
    assert.equal(r.status, 'INVALID');
  }
});
check('incomplete test labelled completed still invalid', () => {
  const a = args('smooth-pursuit');
  a.session.endJsUs = 5_000_000;
  assert.equal(analyzeEyeTest(a).status, 'INVALID');
});
check('low coverage and long dropout remain null', () => {
  const a = args(
    'smooth-pursuit',
    raw((t) => (t > 1 && t < 9 ? null : pursuit()(t))),
  );
  const r = analyzeEyeTest(a);
  assert.equal(r.status, 'INVALID');
  assert.equal(r.pursuit[0].pursuitGain, null);
  assert.equal(a.signals[0].calibrated.interpolatedSamples, 0);
});
check('poor but sufficient coverage', () => {
  const r = analyzeEyeTest(
    args(
      'smooth-pursuit',
      raw((t) => (t > 2 && t < 4 ? null : pursuit()(t))),
    ),
  );
  assert.equal(r.status, 'POOR_DATA');
  assert.ok(r.pursuit[0].pursuitGain !== null);
});
check('one unusable eye is visible and does not contaminate other eye', () => {
  const a = args('smooth-pursuit');
  a.signals[1].calibrated = processTrajectory(
    raw(() => null),
    { coordinateSpace: 'screen-normalized' },
  );
  const r = analyzeEyeTest(a);
  assert.equal(r.status, 'POOR_DATA');
  assert.ok(r.pursuit[0].pursuitGain! > 0.99);
  assert.equal(r.pursuit[1].pursuitGain, null);
});
check('duplicate, reversed, missing and estimated PTS fail closed', () => {
  for (const pts of [null, -1, 50_000]) {
    const data = raw(pursuit());
    data[100].decodedPtsUs = pts;
    assert.equal(analyzeEyeTest(args('smooth-pursuit', data)).status, 'INVALID');
  }
  const data = raw(pursuit());
  data[100].estimated = true;
  assert.equal(analyzeEyeTest(args('smooth-pursuit', data)).status, 'INVALID');
});
check('never use ROI coordinates as calibrated viewport', () => {
  const a = args('smooth-pursuit');
  a.signals[0].calibrated.options.coordinateSpace = 'eye-roi-normalized';
  assert.equal(analyzeEyeTest(a).status, 'INVALID');
});
check('missing and stale presentations', () => {
  const a = args('horizontal-saccades');
  a.session.presentations = a.session.presentations.filter((p) => p.segment !== 2);
  const r = analyzeEyeTest(a);
  assert.equal(r.saccades[0].responses[1].reason, 'MISSING_TARGET_STEP');
  const b = args('smooth-pursuit');
  b.session.presentations = [];
  assert.equal(analyzeEyeTest(b).status, 'INVALID');
});
check('target geometry corruption detected', () => {
  const a = args('smooth-pursuit');
  a.session.presentations[20].x += 0.1;
  assert.equal(analyzeEyeTest(a).status, 'INVALID');
});
check('raw input and stimulus remain immutable', () => {
  const a = args('horizontal-saccades');
  const before = JSON.stringify(a);
  analyzeEyeTest(a);
  assert.equal(JSON.stringify(a), before);
});
check('catch-up candidate needs observed fast motion, error reduction and boundaries', () => {
  const gaze = (t: number) =>
    pursuit(1, 0.1)(t) + (t >= 4.45 && t <= 4.8 ? Math.min(1, (t - 4.45) / 0.025) * 0.035 : 0);
  const r = analyzeEyeTest(args('smooth-pursuit', raw(gaze)));
  assert.ok(r.pursuit[0].rapidMovementCandidates.length >= 1);
  assert.ok(r.pursuit[0].catchUpCandidateCount! >= 1);
  assert.ok(r.pursuit[0].excludedRapidIntervals > 0);
});
check('blink cannot create rapid movements through gaps', () => {
  const r = analyzeEyeTest(
    args(
      'smooth-pursuit',
      raw((t) => (t > 4.1 && t < 4.5 ? null : pursuit()(t))),
    ),
  );
  assert.equal(r.pursuit[0].rapidMovementCandidates.length, 0);
});
check('low confidence, NaN and tracking failure never contribute a velocity', () => {
  const data = raw(stepGaze());
  for (const s of data)
    if (s.decodedPtsUs! > 1_230_000 && s.decodedPtsUs! < 1_290_000) s.confidence = 0.1;
  const a = args('horizontal-saccades', data);
  const r = analyzeEyeTest(a);
  assert.equal(r.saccades[0].responses[0].status, 'INVALID');
  assert.ok(
    a.signals[0].calibrated.samples
      .filter((s) => s.reasons.includes('low-confidence'))
      .every((s) => s.velocityXPerSecond === null),
  );
});
check('fitted calibration → observed ROI sample → calibrated signal → pursuit metrics', () => {
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
  const roi = { x: 100, y: 200, width: 100, height: 80 };
  const calibration = fitCalibration({
    id: 'synthetic-fitted',
    createdAtMs: 1000,
    context,
    takes: CALIBRATION_TARGETS.map((target, j) => ({
      target,
      presentedJsUs: j * 5_000_000,
      releasedJsUs: j * 5_000_000 + 3_000_000,
      recordStartNativeUs: j * 5_000_000 + 1_000_000,
      recordEndNativeUs: j * 5_000_000 + 2_500_000,
      bridge: { nativeMinusJsUs: 0, roundTripUs: 1000 },
      completed: true,
      filePath: 'synthetic.mp4',
      samples: (['left', 'right'] as const).flatMap((eyeSide) =>
        Array.from({ length: 100 }, (_, frameIndex) => ({
          frameIndex,
          decodedPtsUs: frameIndex * 9000,
          eyeSide,
          x: 0.3 + 0.25 * target.y + 0.02 * target.x,
          y: 0.7 - 0.25 * target.x + 0.01 * target.y,
          confidence: 0.9,
          roi,
          estimated: false,
        })),
      ),
    })),
  });
  assert.equal(calibration.verdict, 'VALID');
  assert.equal(calibrationUsable(calibration, context, 1000 + 16 * 60_000), false);
  for (const testId of ['smooth-pursuit', 'horizontal-saccades'] as const) {
    const calibrated = raw(testId === 'smooth-pursuit' ? pursuit(0.8) : stepGaze()).map((s) => {
      const observation = {
        frameIndex: s.frameIndex,
        decodedPtsUs: s.decodedPtsUs,
        eyeSide: 'left' as const,
        x: 0.3 + 0.25 * s.y! + 0.02 * s.x!,
        y: 0.7 - 0.25 * s.x! + 0.01 * s.y!,
        confidence: 0.9,
        roi,
        estimated: false,
      };
      const mapped = mapCalibration(calibration, observation, context, 2000);
      return {
        ...s,
        x: mapped?.x ?? null,
        y: mapped?.y ?? null,
        confidence: mapped?.confidence ?? 0,
      };
    });
    const r = analyzeEyeTest({ ...args(testId, calibrated), calibration });
    assert.equal(r.status, 'GOOD_DATA');
    if (testId === 'smooth-pursuit') assert.ok(Math.abs(r.pursuit[0].pursuitGain! - 0.8) < 0.005);
    else assert.equal(r.saccades[0].validResponses, 9);
  }
});
check('tracking quality remains visible when calibration is missing', () => {
  const a = args('smooth-pursuit');
  const pupil = processTrajectory(raw(() => 0.5));
  const r = analyzeEyeTest({
    ...a,
    calibrationValid: false,
    signals: a.signals.map((s) => ({ ...s, pupil })),
  });
  assert.equal(r.status, 'INVALID');
  assert.equal(r.tracking[0].coverage, 1);
  assert.equal(r.pursuit[0].pursuitGain, null);
});
check('blink in baseline', () => {
  const gaze = stepGaze();
  const r = analyzeEyeTest(
    args(
      'horizontal-saccades',
      raw((t) => (t > 0.9 && t < 0.93 ? null : gaze(t))),
    ),
  );
  assert.equal(r.saccades[0].responses[0].reason, 'BLINK_OR_DROPOUT');
});
check('unstable baseline', () => {
  const gaze = stepGaze();
  const r = analyzeEyeTest(
    args(
      'horizontal-saccades',
      raw((t) => (t > 0.8 && t < 1 ? 0.5 + 0.08 * Math.sin(t * 80) : gaze(t))),
    ),
  );
  assert.equal(r.saccades[0].responses[0].reason, 'UNSTABLE_BASELINE');
});
check('unfinished primary response', () => {
  const gaze = stepGaze();
  const r = analyzeEyeTest(
    args(
      'horizontal-saccades',
      raw((t) => (t > 1.2 && t < 1.45 ? 0.5 - (t - 1.2) * 1.4 : gaze(t))),
    ),
  );
  assert.equal(r.saccades[0].responses[0].reason, 'INCOMPLETE_RESPONSE');
});
check('latency follows delayed actual commit rather than planned step', () => {
  const gaze = stepGaze();
  const a = args(
    'horizontal-saccades',
    raw((t) => gaze(Math.max(0, t - 0.05))),
  );
  a.session.presentations = a.session.presentations
    .map((p) => ({ ...p, elapsedUs: p.elapsedUs + 50_000 }))
    .filter((p) => p.elapsedUs < 10_000_000);
  const r = analyzeEyeTest(a);
  assert.ok(Math.abs(r.saccades[0].medianLatencyMs! - 200) < 15);
});
console.log(
  `Eye test checks: ${checks}/${checks} PASS (engineering synthetic data; no device gaze claim)`,
);
