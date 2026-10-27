import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Reuse the generated Expo Android project. Build only; never install, launch,
// enumerate devices, start Metro, or connect to a phone.
const variants = {
  // Development builds are retained only for a separately requested Metro task.
  development: {
    task: 'Debug',
    native: 'debug',
    name: 'vestibular-development.apk',
    verify: 'verifyDevelopmentApk.mjs',
  },
  clinician: {
    task: 'Clinician',
    native: 'clinician',
    name: 'vestibular-clinic.apk',
    verify: 'verifyClinicianApk.mjs',
  },
};
const variant = process.argv[2] ?? 'clinician';
const settings = variants[variant];
if (!settings) throw new Error('Delivery builds use clinician only: vestibular-clinic.apk.');
const env = { ...process.env };
const sourceState = () => {
  try {
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceDirty:
        execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
    };
  } catch {
    return { sourceCommit: null, sourceDirty: true };
  }
};
const sourceAtStart = sourceState();
if (variant === 'clinician') env.EXPO_PUBLIC_AUTH_REQUIRED = '1';
execFileSync('npx', ['expo', 'prebuild', '--no-install', '--platform', 'android'], {
  stdio: 'inherit',
  env,
});
execFileSync(
  './gradlew',
  [
    `:app:assemble${settings.task}`,
    ':expo-camera2-high-speed:testDebugUnitTest',
    ':expo-pupil-detector:testDebugUnitTest',
    ':expo-frame-pipeline:testDebugUnitTest',
    '-PreactNativeArchitectures=arm64-v8a',
    // Bound memory pressure on the 8 GiB build machine.
    '--max-workers=2',
  ],
  {
    cwd: resolve('android'),
    stdio: 'inherit',
    env,
  },
);
const dir = resolve('artifacts', variant);
mkdirSync(dir, { recursive: true });
const destination = resolve(dir, settings.name);
copyFileSync(
  resolve(`android/app/build/outputs/apk/${settings.native}/app-${settings.native}.apk`),
  destination,
);
const digest = createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(resolve(dir, 'SHA256SUMS'), `${digest}  ${settings.name}\n`);
execFileSync('node', [`scripts/${settings.verify}`, destination], {
  stdio: 'inherit',
  env: process.env,
});
const app = JSON.parse(readFileSync(resolve('app.json'), 'utf8')).expo;
const sourceAtEnd = sourceState();
writeFileSync(
  resolve(dir, 'BUILD_INFO.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      variant,
      authRequired: variant === 'clinician' ? true : null,
      version: app.version,
      versionCode: app.android.versionCode,
      sourceCommit: sourceAtStart.sourceCommit,
      sourceDirty:
        sourceAtStart.sourceDirty ||
        sourceAtEnd.sourceDirty ||
        sourceAtStart.sourceCommit !== sourceAtEnd.sourceCommit,
      sha256: digest,
      bytes: readFileSync(destination).length,
      apkChecks: 'PASS',
      builtAtUtc: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`${variant} APK: ${destination}\nSHA-256: ${digest}`);
// One short download name for physical testing; development remains optional.
// This directory contains APK artifacts only, never phone recordings/evidence.
const phoneDir = resolve('artifacts/phone');
mkdirSync(phoneDir, { recursive: true });
const phoneName = settings.name;
// Preserve a complete file for any download already in progress during a rebuild.
const phonePath = resolve(phoneDir, phoneName);
copyFileSync(destination, `${phonePath}.tmp`);
renameSync(`${phonePath}.tmp`, phonePath);
writeFileSync(resolve(phoneDir, `${phoneName}.sha256`), `${digest}  ${phoneName}\n`);
