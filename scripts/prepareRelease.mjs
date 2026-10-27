import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Local packaging only. Explicit asset allowlist; no network or publication.
const app = JSON.parse(readFileSync(resolve('app.json'), 'utf8')).expo;
const tag = process.argv[2];
assert.ok(
  typeof tag === 'string' && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag),
  'Supply a version tag',
);
assert.ok(
  tag === `v${app.version}` || tag.startsWith(`v${app.version}-`),
  'Tag must match app.json',
);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'Commit reviewed source before release preparation',
);
const output = resolve('artifacts/releases', tag);
const entries = [
  {
    variant: 'clinician',
    source: 'artifacts/clinician/vestibular-clinic.apk',
    name: 'vestibular-clinic.apk',
  },
];
const assets = entries.map((entry) => {
  const info = JSON.parse(
    readFileSync(resolve('artifacts', entry.variant, 'BUILD_INFO.json'), 'utf8'),
  );
  assert.equal(info.sourceDirty, false, 'Rebuild from clean committed source');
  assert.equal(
    info.sourceCommit,
    sourceCommit,
    'The clinician APK must come from the tagged source commit',
  );
  assert.equal(info.variant, entry.variant);
  assert.equal(info.authRequired, entry.variant === 'clinician', 'Wrong authentication mode');
  assert.equal(info.version, app.version);
  assert.equal(info.versionCode, app.android.versionCode);
  assert.equal(info.apkChecks, 'PASS');
  const bytes = readFileSync(resolve(entry.source));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, info.sha256, 'APK changed after verification');
  assert.equal(bytes.length, info.bytes);
  return {
    name: entry.name,
    variant: entry.variant,
    bytes: bytes.length,
    sha256,
    builtAtUtc: info.builtAtUtc,
  };
});
mkdirSync(output, { recursive: true });
assert.ok(
  readdirSync(output).every((name) => !/\.apk$/i.test(name) || name === 'vestibular-clinic.apk'),
  'Release directory contains another APK; archive it before preparing the single-APK release',
);
for (const entry of entries) copyFileSync(resolve(entry.source), resolve(output, entry.name));
writeFileSync(
  resolve(output, 'SHA256SUMS'),
  assets.map((a) => `${a.sha256}  ${a.name}`).join('\n') + '\n',
);
writeFileSync(
  resolve(output, 'release-manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      tag,
      version: app.version,
      versionCode: app.android.versionCode,
      sourceCommit,
      physicalAcceptance: 'pending',
      assets,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    { prepared: true, output, tag, sourceCommit, assets: assets.map((a) => a.name) },
    null,
    2,
  ),
);
