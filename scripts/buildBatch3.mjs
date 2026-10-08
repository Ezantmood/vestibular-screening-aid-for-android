import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Builds locally. Deliberately never installs, launches, or connects to a phone.
execFileSync('npx', ['expo', 'prebuild', '--no-install', '--platform', 'android'], {
  stdio: 'inherit',
});
execFileSync(
  './gradlew',
  [
    ':app:assembleBatch3',
    ':expo-pupil-detector:testDebugUnitTest',
    '-PreactNativeArchitectures=arm64-v8a',
  ],
  {
    cwd: resolve('android'),
    stdio: 'inherit',
    env: process.env,
  },
);
const dir = resolve('artifacts/batch3');
mkdirSync(dir, { recursive: true });
const destination = resolve(dir, 'vestibular-batch3.apk');
copyFileSync(resolve('android/app/build/outputs/apk/batch3/app-batch3.apk'), destination);
const digest = createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(resolve(dir, 'SHA256SUMS'), `${digest}  vestibular-batch3.apk\n`);
execFileSync('node', ['scripts/verifyBatch3Apk.mjs', destination], {
  stdio: 'inherit',
  env: process.env,
});
console.log(`Standalone APK: ${destination}\nSHA-256: ${digest}`);
