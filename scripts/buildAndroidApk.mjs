import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Reuse the generated Expo Android project. Build only; never install, launch,
// enumerate devices, start Metro, or connect to a phone.
const variants = {
  batch3: {
    task: 'Batch3',
    native: 'batch3',
    name: 'vestibular-batch3.apk',
    verify: 'verifyBatch3Apk.mjs',
  },
  development: {
    task: 'Debug',
    native: 'debug',
    name: 'vestibular-development.apk',
    verify: 'verifyDevelopmentApk.mjs',
  },
  clinician: {
    task: 'Clinician',
    native: 'clinician',
    name: 'vestibular-clinician.apk',
    verify: 'verifyClinicianApk.mjs',
    phone: 'vestibular-clinic.apk',
  },
};
const variant = process.argv[2] ?? 'batch3';
const settings = variants[variant];
if (!settings) throw new Error('Expected batch3, development, or clinician variant.');
const env = { ...process.env };
// The offline measurement APK has no network, so it cannot confirm email.
if (variant === 'batch3') env.EXPO_PUBLIC_AUTH_REQUIRED = '0';
execFileSync('npx', ['expo', 'prebuild', '--no-install', '--platform', 'android'], {
  stdio: 'inherit',
  env,
});
execFileSync(
  './gradlew',
  [
    `:app:assemble${settings.task}`,
    ':expo-pupil-detector:testDebugUnitTest',
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
console.log(`${variant} APK: ${destination}\nSHA-256: ${digest}`);
// One short download name for physical testing; development remains optional.
// This directory contains APK artifacts only, never phone recordings/evidence.
const phoneDir = resolve('artifacts/phone');
mkdirSync(phoneDir, { recursive: true });
const phoneName = settings.phone ?? (variant === 'batch3' ? 'vestibular.apk' : settings.name);
// Preserve a complete file for any download already in progress during a rebuild.
const phonePath = resolve(phoneDir, phoneName);
copyFileSync(destination, `${phonePath}.tmp`);
renameSync(`${phonePath}.tmp`, phonePath);
writeFileSync(resolve(phoneDir, `${phoneName}.sha256`), `${digest}  ${phoneName}\n`);
