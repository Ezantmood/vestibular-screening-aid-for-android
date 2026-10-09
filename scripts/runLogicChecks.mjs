import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'vestibular-logic-'));
const checks = [
  'cameraPipelineLogicCheck',
  'p3LogicCheck',
  'p35LogicCheck',
  'p4LogicCheck',
  'stimulusLogicCheck',
  'calibrationLogicCheck',
  'signalLogicCheck',
  'screenAwakeLogicCheck',
  'eyeTestLogicCheck',
  'pupilBatchLogicCheck',
  'captureSafetyLogicCheck',
  'viewportLogicCheck',
  'batch3LogicCheck',
  'technicalReportLogicCheck',
  'diagnosticRunLogicCheck',
];
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
  for (const name of checks)
    execFileSync('node', [join(output, 'scripts', `${name}.js`)], { stdio: 'inherit' });
} finally {
  rmSync(output, { recursive: true, force: true });
}
