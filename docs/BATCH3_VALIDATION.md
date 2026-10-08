# Batch 3 — independent APK verification

This workflow covers Calibration → Smooth Pursuit → Horizontal Saccade only.
Do not start Batch 4. Do not connect to, remotely access or control the Xiaomi;
Wireless Debugging and ADB are not part of this workflow.

## Build on the computer

```bash
npm install
npm run check
npm test
npm run format
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:batch3
```

The local build script prebuilds Android, runs native CV unit checks, assembles
an arm64 `batch3` variant, verifies its signature/manifest/bundle, and copies:

- `artifacts/batch3/vestibular-batch3.apk`
- `artifacts/batch3/SHA256SUMS`

It never installs, launches, or connects to a phone. Generated Android/Gradle
outputs and APK binaries are ignored by Git. The config plugin recreates the
variant after prebuild. The APK embeds the production JS/Hermes bundle, is not
debuggable, disables Android backup, and has no Internet/network-state, overlay
or broad storage permissions. Face detection is the existing bundled ML Kit
dependency. No Metro, Expo Go, development server, account or upload is required.
The development signing key is for internal verification, not Play Store release.
Package/version are `com.vestibular.screeningaid` / 0.1.1 (code 2).

## Physical verification by the device owner

1. Copy the APK to the phone and install it directly with Android's installer.
   Allow installation from the chosen source if Android requests it. Prefer an
   update over uninstalling, to preserve existing private calibration evidence.
2. Open **Kiểm thử Batch 3 độc lập** (09) → **Chạy self-test tự động**.
   This runs 15 explicit JS simulations and seven checks against the production
   Kotlin CV core. Camera permission is not requested and the camera stays closed.
   Simulated calibration is never saved or activated as human calibration.
3. If both suites PASS, choose **Bắt đầu Calibration → Pursuit → Saccade**.
   For each physical stage, choose the front camera, open preview, frame the face,
   then start recording. Grant CAMERA when requested. Keep the phone/head stable,
   lighting steady, both eyes visible, and look at the yellow target.
   The app records all 14 calibration targets, analyzes them locally, then moves
   to the two existing tests in order. Each eye test records ten seconds.
4. Calibration RETRY stops the workflow; subsequent tests remain NOT_RUN.
   An INVALID eye test stops progression. POOR_DATA remains explicitly labelled.
   The cancel control closes the camera through the existing unmount cleanup.
5. Return to the workflow review and select **Xuất báo cáo kỹ thuật JSON**.
   The Android document picker requests local destinations; choose Downloads.
   Send only this JSON for review, if desired. Cancelling the picker is supported.
   Export before leaving/restarting the workflow: the three-stage report is an
   in-memory diagnostic snapshot, not new session storage.

Reading the saved calibration during self-test is read-only, includes RETRY,
and never activates an old or expired model. This read-back alone does not
establish a completed physical workflow. Older measurement versions require
fresh calibration. If the APK cannot update because its signing key differs,
keep the original installation/evidence and report the installer error first.

## Report contract

The small, versioned JSON uses an explicit allowlist: build tag, fixed check IDs,
PASS/FAIL/UNAVAILABLE, stage statuses, target/eye counts, confidence-gate counts,
coverage, fit/validation errors, failure codes and the unchanged engineering policies.
No arbitrary exception text, recording timestamps, device/participant IDs,
calibration IDs, file paths, affine coefficients, ROIs, raw pupil coordinates,
trajectories, images or videos are included. Unknown reasons become a fixed code.
The export does not request network or broad storage access.
Capture/analysis errors retain only a stage and fixed failure code (camera
preparation, cancellation, decode failure, frame-count mismatch or invalid PTS).
Failed stages can be retried in place or cancelled to export the completed evidence.

Reliable metric fields are populated only for a current VALID calibration from
this workflow and an overall GOOD_DATA test. Otherwise gain, latency, velocity,
accuracy, overshoot and undershoot are null. Existing local debug results can
retain clearly qualified estimates. MediaRecorder still provides only an
unbounded record-start alignment estimate: physical exposure/photon timing has
not been measured, so even a successful calibration does not automatically make
these tests GOOD_DATA. No visual-angle velocity or clinical diagnosis is claimed.

## Computer verification and evidence

`npm test` runs 14 suites, including the same APK JS simulations, strict ROI/PTS
and partial-decoder rejection, regression of the two tests, and report privacy/
metric guards. Native JUnit runs seven production CV cases without Android or a
camera. Simulations establish algorithm behavior, not human tracking accuracy.

Optional replay of evidence **already present on the computer**:

```bash
npm run replay:batch3 -- /local/calibration.json /local/pursuit-timeline.json /local/pursuit-signal.json /local/saccade-timeline.json /local/saccade-signal.json
```

This diagnostic expects rejected calibration evidence, verifies raw preservation,
missing support/segments and null calibrated metrics, and prints only aggregate
technical output. It does not rerun native CV without the original video pixels.

Current findings and physical verification gaps:
[Batch 3 computer evidence](device-probes/BATCH3_OFFLINE_REVIEW.md).
