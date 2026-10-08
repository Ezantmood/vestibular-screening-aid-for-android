import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
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
};
const variant = process.argv[2] ?? 'batch3';
const settings = variants[variant];
if (!settings) throw new Error('Expected batch3 or development variant.');
execFileSync('npx', ['expo', 'prebuild', '--no-install', '--platform', 'android'], {
  stdio: 'inherit',
});
execFileSync(
  './gradlew',
  [
    `:app:assemble${settings.task}`,
    ':expo-pupil-detector:testDebugUnitTest',
    '-PreactNativeArchitectures=arm64-v8a',
  ],
  {
    cwd: resolve('android'),
    stdio: 'inherit',
    env: process.env,
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
