import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import getDefaultScheme from 'expo-dev-client/getDefaultScheme.js';

// Inspect the local APK only; no install, launch, ADB, device or debugger access.
const config = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const apk = resolve(process.argv[2] ?? 'artifacts/development/vestibular-development.apk');
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
const bin = resolve(root, version);
const badging = execFileSync(resolve(bin, 'aapt'), ['dump', 'badging', apk], { encoding: 'utf8' });
assert.ok(
  badging.includes(`name='${config.android.package}' versionCode='${config.android.versionCode}'`),
);
assert.ok(badging.includes('application-debuggable'), 'Development APK must be debuggable');
assert.ok(badging.includes('android.permission.INTERNET'), 'Metro requires network permission');
assert.ok(badging.includes('android.permission.CAMERA'), 'Existing camera modules required');
const manifest = execFileSync(
  resolve(bin, 'aapt'),
  ['dump', 'xmltree', apk, 'AndroidManifest.xml'],
  { encoding: 'utf8' },
);
const scheme = getDefaultScheme(config);
assert.ok(manifest.includes(`"${scheme}"`), 'QR deep-link scheme missing');
assert.ok(
  manifest.includes('expo.modules.devlauncher.launcher.DevLauncherActivity'),
  'Development launcher missing',
);
assert.ok(
  /android:usesCleartextTraffic[^\n]*0xffffffff/.test(manifest),
  'LAN HTTP must be allowed in debug',
);
const entries = execFileSync('unzip', ['-Z', '-1', apk], { encoding: 'utf8' });
assert.ok(entries.includes('lib/arm64-v8a/'), 'arm64 libraries missing');
execFileSync(resolve(bin, 'apksigner'), ['verify', apk], { stdio: 'inherit' });
console.log(
  JSON.stringify(
    {
      developmentApkChecks: 'PASS',
      debuggable: true,
      internetPermission: true,
      cleartextLan: true,
      qrScheme: scheme,
      launcher: true,
      signatureValid: true,
      sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
    },
    null,
    2,
  ),
);
