import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Binary inspection only: no install, emulator, ADB, or network operation.
const apk = resolve(process.argv[2] ?? 'artifacts/batch3/vestibular-batch3.apk');
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  resolve(homedir(), 'Library/Android/sdk');
const root = resolve(sdk, 'build-tools');
const version = readdirSync(root)
  .filter((v) => existsSync(resolve(root, v, 'aapt')))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
assert.ok(version, 'Android build-tools missing');
const tools = resolve(root, version);
const badging = execFileSync(resolve(tools, 'aapt'), ['dump', 'badging', apk], {
  encoding: 'utf8',
});
assert.ok(badging.includes("name='com.vestibular.screeningaid' versionCode='2'"));
assert.ok(!/\bsplit=/.test(badging.split('\n')[0]), 'Supply a single APK, not a split package');
assert.ok(badging.includes("sdkVersion:'24'"), 'Unexpected minimum Android API');
assert.ok(/^native-code:.*'arm64-v8a'/m.test(badging), 'Redmi arm64 libraries missing');
assert.ok(
  badging.includes("launchable-activity: name='com.vestibular.screeningaid.MainActivity'"),
  'App launcher missing',
);
assert.ok(badging.includes('android.permission.CAMERA'));
for (const permission of [
  'INTERNET',
  'ACCESS_NETWORK_STATE',
  'SYSTEM_ALERT_WINDOW',
  'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE',
])
  assert.ok(
    !badging.includes(`android.permission.${permission}`),
    `Unexpected permission ${permission}`,
  );
assert.ok(!badging.includes('application-debuggable'), 'APK must not be debuggable');
const manifest = execFileSync(
  resolve(tools, 'aapt'),
  ['dump', 'xmltree', apk, 'AndroidManifest.xml'],
  { encoding: 'utf8' },
);
assert.ok(/android:allowBackup[^\n]*0x0/.test(manifest), 'Backup must be disabled');
const entries = execFileSync('unzip', ['-Z', '-1', apk], { encoding: 'utf8' });
assert.ok(
  entries.split('\n').includes('assets/index.android.bundle'),
  'Embedded JS bundle missing',
);
execFileSync(resolve(tools, 'apksigner'), ['verify', apk], { stdio: 'inherit' });
console.log(
  JSON.stringify(
    {
      standaloneApkChecks: 'PASS',
      embeddedBundle: true,
      debuggable: false,
      internetPermission: false,
      backup: false,
      signatureValid: true,
      singleApk: true,
      minimumAndroidApi: 24,
      arm64Included: true,
      sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
    },
    null,
    2,
  ),
);
