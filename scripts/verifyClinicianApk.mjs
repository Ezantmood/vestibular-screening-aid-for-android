import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Binary inspection only: no install, emulator, ADB, or network operation.
const apk = resolve(process.argv[2] ?? 'artifacts/phone/vestibular-clinic.apk');
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  resolve(homedir(), 'Library/Android/sdk');
const root = resolve(sdk, 'build-tools');
const version = readdirSync(root)
  .filter((entry) => existsSync(resolve(root, entry, 'aapt')))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
assert.ok(version, 'Android build-tools missing');
const tools = resolve(root, version);
const badging = execFileSync(resolve(tools, 'aapt'), ['dump', 'badging', apk], {
  encoding: 'utf8',
});
assert.ok(badging.includes("name='com.vestibular.screeningaid' versionCode='10'"));
assert.ok(!/\bsplit=/.test(badging.split('\n')[0]), 'Supply a single APK, not a split package');
assert.ok(/^native-code:.*'arm64-v8a'/m.test(badging), 'Redmi arm64 libraries missing');
assert.ok(badging.includes('android.permission.CAMERA'));
assert.ok(badging.includes('android.permission.INTERNET'), 'Clinician sign-in needs INTERNET');
assert.ok(!badging.includes('application-debuggable'), 'APK must not be debuggable');
const entries = execFileSync('unzip', ['-Z', '-1', apk], { encoding: 'utf8' });
assert.ok(
  entries.split('\n').includes('assets/index.android.bundle'),
  'Embedded JS bundle missing',
);
const bundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
assert.ok(bundle.includes('vestibular-screening-aid'), 'Firebase project was not inlined');
const measurementBundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], {
  maxBuffer: 64 * 1024 * 1024,
});
assert.ok(
  measurementBundle.includes(Buffer.from('face-pupil-v6')),
  'Current JS coordinate contract missing',
);
assert.ok(
  measurementBundle.includes(Buffer.from('batch3-20261026-calibration-ridge-v7')),
  'Current diagnostic build missing',
);
assert.ok(
  measurementBundle.includes(Buffer.from('target-cv-ridge-v1')),
  'Current calibration model contract missing',
);
const dexEntries = entries.split('\n').filter((entry) => /^classes\d*\.dex$/.test(entry));
assert.ok(
  dexEntries.some((entry) =>
    execFileSync('unzip', ['-p', apk, entry], { maxBuffer: 64 * 1024 * 1024 }).includes(
      Buffer.from('face-pupil-v6'),
    ),
  ),
  'Current native measurement contract missing',
);
execFileSync(resolve(tools, 'apksigner'), ['verify', apk], { stdio: 'inherit' });
console.log(JSON.stringify({ clinicianApkChecks: 'PASS' }));
