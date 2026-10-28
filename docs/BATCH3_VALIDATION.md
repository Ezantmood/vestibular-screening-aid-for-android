# Batch 3 — clinician calibration and eye-test verification

Scope: Calibration → Smooth Pursuit → Horizontal Saccade. The owner operates the
Redmi; no Wireless Debugging, ADB, remote inspection, CLI install or CLI launch.

## One APK

Download only **vestibular-clinic.apk** from
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
It embeds JS/native code and runs without Metro. INTERNET remains available for
accounts. There is no separate engineering APK to install or alternate between.
The owner installs/updates through Android's file manager and preserves existing
local evidence before starting a new calibration.

## Computer verification

```bash
npm install
npm run check
npm test
npm run format
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:clinic
```

The build prebuilds Android, assembles the clinician arm64 APK, runs native JVM
checks and verifies signature, embedded build/model/native contracts and manifest.
Output: `artifacts/clinician/vestibular-clinic.apk`, with the same APK copied to
`artifacts/phone/vestibular-clinic.apk`. No command connects to a phone. Logic and
native self-checks remain computer verification; they do not establish human gaze
accuracy. [Release packaging](RELEASING.md).

## Owner-operated acceptance

1. Keep/export existing evidence needed for comparison. Install the clinician
   update and check its version against the Release. Open a clinician exam or
   anonymous test and select the required eye protocol.
2. First check access: the instruction page and camera setup must scroll to all
   controls. **Ghi kiểm tra khi chưa hiệu chỉnh** allows recording access without
   repeating calibration. It cannot make calibrated metrics valid.
3. For calibration, choose front 1920×1080 at its probed fixed 120 fps, frame both
   eyes in portrait and follow the 14 stationary targets with phone/head steady.
   Both top and bottom rows must remain visible with normal/large system text;
   Cancel must remain accessible. The preview must recover after cancellation
   and retry. The framing lamp accepts sufficient face height OR width while
   preserving clipping, eye visibility and centering checks. On **Giữ nguyên vị
   trí**, stop adjusting. A green lamp establishes framing only, not calibration
   quality. The explicit technical recording option cannot force VALID.
4. If saved v8/v9/v10 videos remain, **Phân tích lại video đã lưu** re-decodes those
   videos using the current detector. It preserves original capture time and
   expiry and is not a fresh physical calibration. Missing video/metadata blocks
   replay. Prefer inspecting the same failed capture before requesting another
   full sequence.
5. Inspect **Ảnh kiểm tra đồng tử**, feedback and ROI overlays. Unmarked PNGs are
   exact decoded grayscale crops: the crop must contain the eye, the cyan polygon
   must follow its eyelids. Check the yellow fitted ellipse against the visible
   pupil boundary and the red marker against its center, including the top-left
   target. The ellipse and confidence are detector hypotheses. Missing/closed
   contours must not fall back to an unmasked dark blob. Detector overlays are not
   manual ground truth. Check each eye's coverage, fit-CV, held-out target errors,
   per-frame RMS/p95 and worst targets.
6. Use **Xuất số đo hiệu chỉnh (JSON)** on the calibration result screen to save
   local numeric evidence, with export/analysis build and replay provenance. Tap an ROI image → **Chia sẻ ảnh ROI** for individual
   pixels. Do not upload patient records or private captures into Git/Releases.
7. Once detector evidence supports another physical run, acceptance requires at
   least three full calibrations under the same conditions and one after reopening.
   Keep every RETRY as well as every VALID. Test occlusion, movement, orientation
   changes and cancellation/retry; confirm rejection/invalidation and absent
   calibrated metrics on invalid data. Never lower gates to force passage.
8. Validate moving-test metrics only after calibration, synchronization and signal
   quality independently pass. Clinician results can be saved/reviewed and exported
   as PDF; a report does not establish clinical accuracy. Vertical accuracy and
   anti-saccade error rate remain unscored in the current implementation.

## Interpretation

The calibration checklist is an engineering score, not percent-correct gaze.
Current models use a 40-item rubric; legacy models cannot activate. Compare results
only with their build/model versions and conditions. Read accepted percentages
alongside accepted coverage. Use [calibration contracts](CALIBRATION_SIGNALS.md)
and [eye-test contracts](EYE_TESTS.md) for units, gates and limitations. Simulation,
saved-data replay and physical measurements are separate evidence. Batch 4 remains
outside this workflow.
