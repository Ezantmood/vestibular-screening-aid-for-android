# Batch 3 — independent APK verification

This workflow covers Calibration → Smooth Pursuit → Horizontal Saccade only.
Do not start Batch 4. Do not connect to, remotely access or control the Xiaomi;
Wireless Debugging and ADB are not part of this workflow.
**Default physical workflow:** install one APK and open **Vestibular Screening Aid**
from the phone Home screen. Camera and JS are included; no Expo Go, QR or port 8081.
For owner-operated Metro + QR + Fast Refresh while developing use the separate
[Development APK workflow](DEVELOPMENT_BUILD.md). The offline APK below cannot
connect to Metro; installing the Development APK updates the same app package.

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
- `artifacts/phone/vestibular.apk` (same verified APK, short download name)
- `artifacts/phone/vestibular.apk.sha256`

It never installs, launches, or connects to a phone. Generated Android/Gradle
outputs and APK binaries are ignored by Git. The config plugin recreates the
variant after prebuild. The APK embeds the production JS/Hermes bundle, is not
debuggable, disables Android backup, and has no Internet/network-state, overlay
or broad storage permissions. Face detection is the existing bundled ML Kit
dependency. No Metro, Expo Go, development server, account or upload is required.
The development signing key is for internal verification, not Play Store release.
Package/version are `com.vestibular.screeningaid` / 0.1.1 (code 2).

## Physical verification by the device owner

Use **Chrome on Redmi** for the
[direct APK download](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/download/batch3-20261009-r2/vestibular.apk).
If a QR opens inside Zalo, use its menu to open the URL in Chrome (or copy the
URL into Chrome's address bar). The reported **The file type is not supported**
occurred while opening the release asset in the Zalo/GitHub flow, before any
confirmed Android installer failure. Change the opening app before changing APKs.
For this stable private GitHub URL, sign in with a repository-authorized account
in **Chrome**; Zalo's login may not carry over. A 404 while signed out/wrong account
does not mean the APK is missing. This download works independently of the Mac,
LAN IP, Metro or port 8082. The release contains only the verified APK and checksum,
never recordings, calibration evidence or personal reports. Repository stays private.

During assisted handoff, a maintainer can obtain GitHub's temporary asset-only
HTTPS redirect using the [release asset API](https://docs.github.com/en/rest/releases/assets).
Verify an unauthenticated download's byte count, attachment filename and SHA-256
before sharing it with the owner. This skips GitHub login/asset preview; still
open it in Chrome. State its actual expiry. Never share the GitHub account token,
commit the signed URL/QR, or change repository visibility for this workaround.

Optional LAN transfer, if phone-to-Mac access works: serve only the prepared APK directory:

```bash
python3 -m http.server 8082 --bind 0.0.0.0 --directory artifacts/phone
```

On the same LAN, the owner opens `http://<Mac-LAN-IP>:8082/vestibular.apk`, installs
the downloaded update, then opens **Vestibular Screening Aid** directly. Port 8082
is only for transferring the APK; it can be stopped after download and is never
needed to run the app. The same app/package is updated; do not uninstall to switch.
Mac loopback/LAN checks cannot establish phone reachability. If Redmi Chrome
times out, use the HTTPS release above; changing the QR alone cannot fix that route.

1. After downloading, open Xiaomi's built-in **Quản lý tệp / File Manager** from
   the phone Home screen → **APK** (or **Downloads**) → **vestibular.apk**.
   This opens Android's installer. A release asset showing 38 MB does not prove a
   file was saved to Downloads; finish the Chrome download before this step.
   If Android blocks the source, follow **Settings → Allow from this source** for
   **File Manager**, then return and choose **Install / Update**. Prefer an update
   over uninstalling, to preserve existing private calibration evidence.
   [Xiaomi's APK opening instructions](https://www.mi.com/global/support/faq/details/KA-113603/).
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
   The current build keeps the aggregate report when leaving/reopening screen 09
   in the same app process. Leaving an active physical stage cancels that stage
   and records `WORKFLOW_CANCELLED`; it does not resume camera capture on return.
   Export before closing the app or starting a new workflow. Nothing is written
   to new session storage; retained reports cannot activate calibration models.

Reading the saved calibration during self-test is read-only, includes RETRY,
and never activates an old or expired model. This read-back alone does not
establish a completed physical workflow. Older measurement versions require
fresh calibration. If the APK cannot update because its signing key differs,
keep the original installation/evidence and report the installer error first.
After a schema-1 empty export, update without uninstalling, run self-test and
export immediately to inspect the calibration already saved, before recording
again. `savedCalibrationRead` distinguishes available evidence, no saved file,
invalid data and read failure; `physicalWorkflow.started=false` means this is
saved-data inspection, not a newly completed three-stage physical test.
An unsupported-file message from a viewer does not by itself establish APK/OS
incompatibility. If File Manager or the actual Android installer also rejects it,
record that app's name and exact error before changing the native build. Computer
checks validate the published APK, not the phone's local download or installation.

## Report contract

The small, versioned JSON uses an explicit allowlist: build tag, fixed check IDs,
NOT_RUN/PASS/FAIL/UNAVAILABLE, stage statuses, target/eye counts, confidence-gate counts,
coverage, fit/validation errors, failure codes and the unchanged engineering policies.
No arbitrary exception text, recording timestamps, device/participant IDs,
calibration IDs, file paths, affine coefficients, ROIs, raw pupil coordinates,
trajectories, images or videos are included. Unknown reasons become a fixed code.
The export does not request network or broad storage access.
Schema 2 (`batch3-20261009-r2`) distinguishes checks not run from unavailable
results, records self-test completion and saved-calibration read status, and
includes only fixed diagnostic failure codes. Reading saved calibration failing
cannot erase JS/native check results or activate a model. All 15 JS and seven
native checks must PASS to start a physical workflow; partial/duplicate bridge
results cannot unlock it. Empty reports cannot be exported, but failed self-tests
remain exportable. Schema 1 lacks this distinction: native UNAVAILABLE alone is
not proof that a module is missing, and an empty report is not a physical result.
The Android exporter now accepts schemas 1 and 2; this native change requires an
APK update, including for Development Build. Fast Refresh alone cannot update it.
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

`npm test` runs 15 suites, including the same APK JS simulations, strict ROI/PTS
and partial-decoder rejection, regression of the two tests, and report privacy/
metric guards, storage-read failures and aggregate retention across navigation.
Native JUnit runs seven production CV cases without Android or a
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
