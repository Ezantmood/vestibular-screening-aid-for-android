import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'vestibular-logic-'));
const checks = [
  'cameraPipelineLogicCheck',
  'p3LogicCheck',
  'p35LogicCheck',
  'framingReadinessLogicCheck',
  'p4LogicCheck',
  'stimulusLogicCheck',
  'calibrationLogicCheck',
  'calibrationAuditLogicCheck',
  'calibrationReplayLogicCheck',
  'eyeGeometryLogicCheck',
  'calibrationProgressLogicCheck',
  'calibrationRegressionLogicCheck',
  'signalLogicCheck',
  'screenAwakeLogicCheck',
  'eyeTestLogicCheck',
  'pupilBatchLogicCheck',
  'captureSafetyLogicCheck',
  'viewportLogicCheck',
  'batch3LogicCheck',
  'technicalReportLogicCheck',
  'diagnosticRunLogicCheck',
  'authLogicCheck',
  'clinicLogicCheck',
];
console.log(
  'Evidence: computer logic/synthetic checks. Physical Redmi calibration and gaze accuracy are NOT evaluated by this command.',
);
try {
  execFileSync(
    'node',
    [
      'node_modules/typescript/bin/tsc',
      '--ignoreConfig',
      ...checks.map((name) => `scripts/${name}.ts`),
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
  const suites = [];
  for (const name of checks) {
    try {
      execFileSync('node', [join(output, 'scripts', `${name}.js`)], {
        stdio: 'inherit',
        env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
      });
      suites.push({ name, status: 'PASS' });
    } catch {
      suites.push({ name, status: 'FAIL' });
      process.exitCode = 1;
    }
  }
  console.log(
    JSON.stringify({
      evidenceClass: 'computer-logic-and-simulation',
      suites,
      passed: suites.filter((suite) => suite.status === 'PASS').length,
      failed: suites.filter((suite) => suite.status === 'FAIL').length,
      physicalRedmiCalibration: 'NOT_EVALUATED',
      gazeAccuracy: 'NOT_EVALUATED',
    }),
  );
} finally {
  rmSync(output, { recursive: true, force: true });
}
