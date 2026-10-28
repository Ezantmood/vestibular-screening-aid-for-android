# Releases

GitHub Releases is the per-version record for changes, binaries, verification and
pending device work. Keep README and `docs/` focused on current setup, contracts
and acceptance procedures; do not add dated Batch 3 run logs to the source tree.
The owner has authorized commit, push and GitHub Release delivery at the end of
each completed task. This is the default handoff; local APK/LAN delivery alone is
not completion. No repeated permission request is needed for routine publication.
Every delivery contains exactly one APK: `vestibular-clinic.apk`. Do not build
or publish an additional offline/Batch 3 or Development APK for routine work.

## Prepare a version

1. Update `app.json` version/versionCode and the diagnostic build/model contracts
   when required. Update the current-state summary in `docs/STATUS.md`.
2. Run `npm run check`, `npm test`, `npm run format` and review the changes.
   Commit the intended source; do not rewrite history or force-push.
3. Build the clinician APK from that clean commit with JDK 21:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:clinic
npm run release:prepare -- v0.2.13-beta.1
```

Preparation requires a matching clean source commit and the current verified APK.
It creates an explicit allowlisted package in `artifacts/releases/<tag>/`:
`vestibular-clinic.apk`, `SHA256SUMS`, `release-manifest.json`.
The manifest records version, code, source commit and binary hashes. `artifacts/`
is ignored by Git. The preparation script does not publish anything.

## Publish

Write cohesive release notes to a local file and pass that file to GitHub CLI's
`--notes-file`; preserve real newlines. Describe the concrete change, what passed
on the computer, what was measured on hardware and what remains pending. Avoid
clinical accuracy claims derived from simulations. Use a prerelease while
physical acceptance is pending. Keep previous releases/tags available.

Push only to the configured repository. Create a tag on the verified source,
prepare a draft release with only the three named assets above, verify uploaded
sizes/digests, then publish. Check the published tag, notes and asset metadata.
Update README's current-release link for the next version.
For packaging/documentation-only changes, an existing release can be updated
without rebuilding an unchanged app: retain its original source commit and APK
checksum. Never relabel an older APK as built from the new workflow commit.

Raw videos/images, calibration exports, patient data, local investigation notes,
credentials and temporary signed download URLs never belong in the assets.
