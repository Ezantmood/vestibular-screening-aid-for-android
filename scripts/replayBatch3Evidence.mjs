import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

// Optional LOCAL evidence only. This command never connects to or reads a phone.
// Usage: node scripts/replayBatch3Evidence.mjs calibration.json [timeline.json signal.json]...
const [calibrationFile, ...testFiles] = process.argv.slice(2);
if (!calibrationFile || testFiles.length % 2)
  throw new Error('Expected local calibration file and optional timeline/signal pairs.');
const output = mkdtempSync(join(tmpdir(), 'batch3-replay-'));
const require = createRequire(import.meta.url);
try {
  execFileSync(
    'node',
    [
      'node_modules/typescript/bin/tsc',
      '--ignoreConfig',
      'src/eyetracking/calibration/calibration.ts',
      'src/signals/trackingSignals.ts',
      'src/tests/metrics/analysis.ts',
      'src/tests/validation/technicalReport.ts',
      '--rootDir',
      '.',
      '--outDir',
      output,
      '--module',
      'commonjs',
      '--target',
      'es2022',
      '--esModuleInterop',
      '--skipLibCheck',
    ],
    { stdio: 'inherit' },
  );
  const { fitCalibration } = require(join(output, 'src/eyetracking/calibration/calibration.js'));
  const { processTrackingSignals } = require(join(output, 'src/signals/trackingSignals.js'));
  const { analyzeEyeTest } = require(join(output, 'src/tests/metrics/analysis.js'));
  const { calibrationTechnicalSummary } = require(
    join(output, 'src/tests/validation/technicalReport.js'),
  );
  const cal = JSON.parse(readFileSync(calibrationFile, 'utf8'));
  const original = JSON.stringify(cal);
  const refit = fitCalibration({
    id: cal.result.id,
    createdAtMs: cal.result.createdAtMs,
    context: cal.result.context,
    takes: cal.takes,
  });
  assert.equal(
    refit.verdict,
    'RETRY',
    'This evidence is a rejected calibration; never force it valid.',
  );
  assert.deepEqual(refit.models, cal.result.models);
  let slots = 0;
  function audit(replay, result = refit, nowMs = cal.result.createdAtMs) {
    const before = JSON.stringify(replay);
    const signals = processTrackingSignals(replay, result, cal.result.context, nowMs);
    for (const eye of signals) {
      const tracked = replay.tracked.filter((t) => t.eyeSide === eye.eyeSide);
      assert.equal(eye.pupil.interpolatedSamples, 0);
      assert.equal(eye.calibrated.qualityAfter.usable, 0);
      assert.equal(eye.pupil.samples.length, tracked.length);
      for (let i = 0; i < tracked.length; i++) {
        const sample = eye.pupil.samples[i];
        if (tracked[i].trackedCentroidX === null) assert.equal(sample.usable, false);
        if (sample.velocityUsable) {
          assert.ok(i > 0 && eye.pupil.samples[i - 1].usable);
          assert.equal(sample.segmentId, eye.pupil.samples[i - 1].segmentId);
          assert.equal(sample.raw.frameIndex, eye.pupil.samples[i - 1].raw.frameIndex + 1);
        }
      }
      slots += tracked.length;
    }
    assert.equal(JSON.stringify(replay), before);
    return signals;
  }
  for (const replay of cal.replays) audit(replay);
  const tests = [];
  for (let i = 0; i < testFiles.length; i += 2) {
    const timeline = JSON.parse(readFileSync(testFiles[i], 'utf8'));
    const saved = JSON.parse(readFileSync(testFiles[i + 1], 'utf8'));
    const signals = audit(saved.replay);
    const result = analyzeEyeTest({
      session: timeline.session,
      bridge: timeline.bridge,
      anchor: timeline.anchor,
      calibration: timeline.eyeAnalysis?.calibration ?? null,
      calibrationValid: false,
      signals,
    });
    assert.equal(result.status, 'INVALID');
    assert.ok(result.pursuit.every((e) => e.pursuitGain === null));
    assert.ok(
      result.saccades.every(
        (e) =>
          e.medianLatencyMs === null &&
          e.medianPeakVelocityPerSecond === null &&
          e.medianAccuracy === null,
      ),
    );
    tests.push({ test: result.testId, status: result.status, reliableMetrics: false });
  }
  assert.equal(JSON.stringify(cal), original);
  console.log(
    JSON.stringify(
      {
        source: 'previously-saved-local-evidence',
        calibration: calibrationTechnicalSummary(cal),
        integrity: {
          eyeSlotsChecked: slots,
          rawChanged: 0,
          fabricatedMissing: 0,
          crossGapVelocity: 0,
          interpolated: 0,
        },
        tests,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(output, { recursive: true, force: true });
}
