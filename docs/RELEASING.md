# Releases

GitHub Releases is the per-version record for changes, binaries, verification and
pending device work. Keep README and `docs/` focused on current setup, contracts
and acceptance procedures; do not add dated Batch 3 run logs to the source tree.

## Prepare a version

1. Update `app.json` version/versionCode and the diagnostic build/model contracts
   when required. Update the current-state summary in `docs/STATUS.md`.
2. Run `npm run check`, `npm test`, `npm run format` and review the changes.
   Commit the intended source; do not rewrite history or force-push.
3. Build both variants from that clean commit with JDK 21:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:clinic
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:batch3
npm run release:prepare -- v0.2.7-beta.1
```

Preparation requires matching clean source commits and current verified APKs.
It creates an explicit allowlisted package in `artifacts/releases/<tag>/`:
`vestibular-clinic.apk`, `vestibular.apk`, `SHA256SUMS`, `release-manifest.json`.
The manifest records version, code, source commit and binary hashes. `artifacts/`
is ignored by Git. The preparation script does not publish anything.

## Publish when authorized

Write cohesive release notes to a local file and pass that file to GitHub CLI's
`--notes-file`; preserve real newlines. Describe the concrete change, what passed
on the computer, what was measured on hardware and what remains pending. Avoid
clinical accuracy claims derived from simulations. Use a prerelease while
physical acceptance is pending. Keep previous releases/tags available.

Push only to the configured repository. Create a tag on the verified source,
prepare a draft release with only the four named assets above, verify uploaded
sizes/digests, then publish. Check the published tag, notes and asset metadata.
Update README's current-release link for the next version.

Raw videos/images, calibration exports, patient data, local investigation notes,
credentials and temporary signed download URLs never belong in the assets.
