# Batch 3 — calibration and eye-test verification

Scope: Calibration → Smooth Pursuit → Horizontal Saccade. The owner operates the
Redmi; no Wireless Debugging, ADB, remote inspection, CLI install or CLI launch.

## Get the correct build

Use the current APK and release notes from
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
`vestibular-clinic.apk` is the clinician app. `vestibular.apk` is the offline
engineering app with screen 09, **Kiểm thử Batch 3 độc lập**. Both embed JS/native
code and run without Metro. They share a package and are alternative installs.
The owner installs/updates through Android's file manager; preserve existing
local evidence before starting a new calibration.

For live JS iteration use [Development Build + owner-operated Metro](DEVELOPMENT_BUILD.md).
Expo Go cannot load these Camera2 modules. Fast Refresh cannot update native code.

## Build on the computer

```bash
npm install
npm run check
npm test
npm run format
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:batch3
```

The script prebuilds Android, assembles an arm64 APK, runs native JVM tests and
verifies signature, embedded build/model/native contracts and manifest. Outputs:
`artifacts/batch3/`, with the handoff copy `artifacts/phone/vestibular.apk`.
The offline variant has no INTERNET permission. The clinician build deliberately
retains INTERNET for accounts; use `npm run build:clinic` for that variant.
Neither command connects to a phone. [Release packaging](RELEASING.md).

## Owner-operated acceptance

1. Keep/export any existing technical report needed for comparison. Install the
   current update and confirm its build tag on screen 09 against the Release.
2. Run **Chạy self-test tự động**: 31 JS simulations and 14 production native
   CV self-checks. These do not open the camera or establish human gaze accuracy.
3. Start Calibration → Pursuit → Saccade. Choose front 1920×1080 at its probed
   fixed 120 fps, frame both eyes in portrait, keep the phone/head steady and
   follow all 14 stationary targets. The target window opens separately: verify
   both top and bottom rows are fully visible with normal/large system text,
   without scrolling; the Cancel button must remain accessible. The preview
   must stay available after cancellation/retry. Allow finalization before moving.
   Check requestedFaceRotation against the probed portrait sensor orientation;
   observed directions must stay consistent. Inspect ROI before attributing any
   residual head-box instability to physical movement.
   The lamp accepts sufficient face height OR width while preserving clipping,
   eye visibility and centering checks. On **Giữ nguyên vị trí**, stop adjusting
   and wait for stable green. A green lamp establishes framing only; calibration
   still needs all measured quality gates. The expandable technical recording
   option can collect evidence without a green lamp; it cannot force VALID.
4. Inspect the calibration feedback and representative ROI overlays. The crop
   must contain the eye, the cyan polygon must follow its eyelids, and the red
   marker must lie on the pupil. A missing/closed contour must not fall back to
   an unmasked dark blob. Use **Xuất số đo hiệu chỉnh (JSON)** on the result screen
   to save numeric evidence; tap an ROI image then **Chia sẻ ảnh ROI** for pixels. Overlays are
   detector replays, not manual ground truth. Check each eye's coverage, fit-CV,
   held-out target errors, per-frame RMS/p95 and worst targets.
5. Repeat at least three full calibrations under the same conditions and once
   after reopening. Record every RETRY as well as every VALID. Do not lower
   confidence, coverage or error gates to force passage.
6. Test occlusion, head/phone movement, changed orientation and cancellation/retry.
   Confirm rejection/invalidation and absent calibrated metrics on invalid data.
7. Only after calibration passes, validate both moving eye protocols. PTS, exposure
   uncertainty, coverage and response quality have independent gates. A passed
   calibration does not establish moving-test synchronization or clinical accuracy.
8. Export **báo cáo kỹ thuật JSON** from screen 09 to an owner-chosen local folder.
   It contains allowlisted aggregate diagnostics, not raw images/positions,
   coefficients, patient records or paths. Export before closing the app or
   starting another workflow; the workflow summary is retained in-process.

## Interpretation

The checklist is an engineering score, not percent-correct gaze. Current models
use a 40-item rubric; legacy models retain the historical 34-item rubric and
cannot activate. Compare results only with their build/model versions and
conditions. Accepted-frame percentages must be read alongside accepted coverage.

Use [calibration contracts](CALIBRATION_SIGNALS.md) and [eye-test contracts](EYE_TESTS.md)
for exact units, gates and limitations. Simulation, saved-data replay and physical
measurements are distinct evidence. Release notes record what was actually run;
Batch 4 remains outside this workflow.
