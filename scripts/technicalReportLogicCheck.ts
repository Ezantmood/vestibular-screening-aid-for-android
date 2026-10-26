import assert from './assert';
import { validationFailureCode, type ValidationFailure } from '../src/tests/validation/failures';
import { CaptureCancelled } from '../src/camera/recordingPreparation';
import {
  buildTechnicalReport,
  parseLocalEvidence,
  calibrationTechnicalSummary,
} from '../src/tests/validation/technicalReport';
import { syntheticCalibrationTakes, SYNTHETIC_CONTEXT } from '../src/tests/validation/selfChecks';
import { fitCalibration } from '../src/eyetracking/calibration/calibration';
import { calibrationDiagnostics } from '../src/tests/validation/calibrationDiagnostics';

const takes = syntheticCalibrationTakes();
assert.equal(
  calibrationTechnicalSummary({ result: { models: { left: { family: ['affine'] } } } }).eyes[0]
    .modelFamily,
  null,
);
const result = fitCalibration({
  id: 'PERSONAL_SENTINEL',
  createdAtMs: 1791346313820,
  context: SYNTHETIC_CONTEXT,
  takes,
});
const artifact = {
  result,
  takes,
  replays: [],
  filePath: '/PERSONAL_SENTINEL/video.mp4',
  name: 'PERSONAL_SENTINEL',
  raw: [1, 2, 3],
};
const eye = {
  status: 'POOR_DATA',
  calibrationId: 'PERSONAL_SENTINEL',
  reasons: ['left:UNBOUNDED_EXPOSURE_OFFSET', '/PERSONAL_SENTINEL/error'],
  pursuit: [
    {
      eyeSide: 'left',
      quality: { coverage: 0.9 },
      pursuitGain: 1,
      trackingRmse: 0.01,
      rawCentroidX: 1000,
    },
  ],
  saccades: [
    {
      eyeSide: 'right',
      quality: { coverage: 0.9 },
      medianLatencyMs: 200,
      medianPeakVelocityPerSecond: 14,
      medianAccuracy: 1,
      medianOvershoot: 0,
      medianUndershoot: 0,
      responses: [{ reason: 'BLINK_OR_DROPOUT', patientName: 'PERSONAL_SENTINEL' }],
    },
  ],
};
const report = buildTechnicalReport({
  calibrationArtifact: artifact,
  pursuit: eye,
  saccades: eye,
  calibrationConfirmed: true,
});
const json = JSON.stringify(report);
for (const secret of [
  'PERSONAL_SENTINEL',
  'filePath',
  'rawCentroid',
  'coefficients',
  'referenceRoi',
  'createdAtMs',
  '1791346313820',
  'coefficientsX',
  'featureBounds',
  'targetQuality',
])
  assert.ok(!json.includes(secret));
assert.equal(report.physicalWorkflow.pursuit.reliableMetrics, false);
assert.equal(report.physicalWorkflow.calibration.insights[0].fitTargetsWithFeatures, 9);
assert.ok(
  report.physicalWorkflow.calibration.insights[0].targetCorrelation.featureXTargetX! > 0.99,
);
assert.equal(report.physicalWorkflow.pursuit.pursuit[0].pursuitGain, null);
assert.equal(report.physicalWorkflow.saccades.saccades[0].latencyMs, null);
assert.equal(report.physicalWorkflow.saccades.saccades[0].accuracy, null);
assert.ok(report.physicalWorkflow.saccades.reasons.includes('UNBOUNDED_EXPOSURE_OFFSET'));
assert.ok(report.physicalWorkflow.saccades.reasons.includes('UNRECOGNIZED_REASON'));
const good = {
  ...eye,
  status: 'GOOD_DATA',
  synchronization: { source: 'measured-frame', uncertaintyMs: 1 },
};
const noCalibration = buildTechnicalReport({
  calibrationArtifact: artifact,
  pursuit: good,
  calibrationConfirmed: false,
});
assert.equal(noCalibration.physicalWorkflow.pursuit.status, 'INVALID');
assert.equal(noCalibration.physicalWorkflow.pursuit.pursuit[0].pursuitGain, null);
const retry = buildTechnicalReport({
  calibrationArtifact: { ...artifact, result: { ...result, verdict: 'RETRY' } },
  pursuit: good,
  calibrationConfirmed: true,
});
assert.equal(retry.physicalWorkflow.calibrationConfirmed, false);
assert.equal(retry.physicalWorkflow.pursuit.reliableMetrics, false);
const allowed = buildTechnicalReport({
  calibrationArtifact: artifact,
  pursuit: good,
  calibrationConfirmed: true,
});
assert.equal(allowed.physicalWorkflow.pursuit.pursuit[0].pursuitGain, 1);
const malformed = buildTechnicalReport({
  calibrationArtifact: { result: { verdict: 'VALID', context: SYNTHETIC_CONTEXT } },
  pursuit: good,
  calibrationConfirmed: true,
});
assert.equal(malformed.physicalWorkflow.pursuit.reliableMetrics, false);
const unbounded = buildTechnicalReport({
  calibrationArtifact: artifact,
  pursuit: { ...good, synchronization: { source: 'record-start-estimate', uncertaintyMs: null } },
  calibrationConfirmed: true,
});
assert.equal(unbounded.physicalWorkflow.pursuit.reliableMetrics, false);
const legacy = buildTechnicalReport({
  calibrationArtifact: {
    result: { ...result, context: { ...result.context, coordinateVersion: 'decoded-roi-v1' } },
  },
  pursuit: good,
  calibrationConfirmed: true,
});
assert.equal(legacy.physicalWorkflow.calibrationConfirmed, false);
assert.equal(legacy.physicalWorkflow.pursuit.reliableMetrics, false);
assert.equal(parseLocalEvidence('{broken'), null);
for (const v of [null, 123, [], { result: {} }])
  assert.equal(calibrationTechnicalSummary(v).verdict, 'UNAVAILABLE');
const counts = calibrationDiagnostics(result);
assert.equal(counts.length, 28);
assert.equal(counts[0].accepted, 120);
assert.equal(counts[0].detectorSuccess, 0);
assert.equal(
  validationFailureCode(new Error('/PERSONAL_SENTINEL/native.mp4')),
  'CAPTURE_OR_ANALYSIS_FAILED',
);
assert.equal(validationFailureCode(new Error('FRAME_COUNT_MISMATCH')), 'FRAME_COUNT_MISMATCH');
assert.equal(validationFailureCode(new CaptureCancelled()), 'CAPTURE_CANCELLED');
const failures = buildTechnicalReport({
  failures: [
    { stage: 'calibration', code: 'DECODE_FAILED' },
    { stage: 'PERSONAL_SENTINEL', code: 'PERSONAL_SENTINEL' },
  ] as unknown as ValidationFailure[],
});
assert.equal(failures.physicalWorkflow.failures.length, 1);
assert.ok(!JSON.stringify(failures).includes('PERSONAL_SENTINEL'));
console.log(
  'Technical report checks: PASS (allowlist privacy, malformed evidence, stage counts, metric guards, old model version, safe stage failures)',
);

// Newly added diagnostic subtrees remain allowlisted, including malformed native data.
const richStages = calibrationDiagnostics(result, [], takes);
const rich = richStages[0] as unknown as Record<string, unknown>;
rich.pipeline = { frameWidth: 1920, effectiveFps: 119.5, patientName: 'PERSONAL_SENTINEL' };
rich.image = {
  meanY: { count: 1, min: 70, median: 80, max: 90, note: 'PERSONAL_SENTINEL' },
  patientName: 'PERSONAL_SENTINEL',
};
rich.hold = {
  roundTripUs: 1000,
  settleMarginUs: -50,
  releaseMarginUs: 2000,
  timestamp: 'PERSONAL_SENTINEL',
};
const richReport = calibrationTechnicalSummary({ ...artifact, diagnostics: richStages });
assert.equal(richReport.stageCounts[0].pipeline.frameWidth, 1920);
assert.equal(richReport.stageCounts[0].image.meanY.median, 80);
assert.equal(richReport.stageCounts[0].hold.settleMarginUs, -50);
assert.ok(!JSON.stringify(richReport).includes('PERSONAL_SENTINEL'));

const failedDecode = buildTechnicalReport({
  failures: [
    {
      stage: 'calibration',
      code: 'FRAME_COUNT_MISMATCH',
      decode: {
        stage: 'pupil-decode',
        encoded: 180,
        decoded: 179,
        width: 1920,
        height: 1080,
        patientName: 'PERSONAL_SENTINEL',
      } as NonNullable<ValidationFailure['decode']>,
    },
  ],
});
assert.equal(failedDecode.physicalWorkflow.failures[0].decode?.decoded, 179);
assert.ok(!JSON.stringify(failedDecode).includes('PERSONAL_SENTINEL'));
