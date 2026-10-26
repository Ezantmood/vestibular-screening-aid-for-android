# Status

## Current implementation

- Android-first clinician app: account/sign-in, encrypted on-device patient chart,
  eye-test instructions/recording, saved traces, report and PDF.
- Active engineering scope remains Batch 3: calibration, Smooth Pursuit and
  Horizontal Saccade. Batch 4 is not started.
- Calibration uses `face-pupil-v7` measurements and `target-cv-ridge-v1` models.
  Fit-target-only CV selects affine/ridge/quadratic mapping. Held-out target and
  frame-error checks must pass for both eyes; old models require recalibration.
- Decoder geometry/PTS integrity, explicit missing observations, native/JS
  contract checks and camera release/cancellation guards remain enforced.
- Portrait framing accepts sufficient height or width, with current-sample hints
  and stable READY/start checks. The lamp is a framing preflight; post-recording
  calibration quality gates are independent and unchanged.

## Evidence and next acceptance

The owner can now reach the green framing lamp and complete a recording, but
calibration remains RETRY. The next observed blocker was clipped lower targets:
the old board used window height without subtracting clinician chrome. A shared
full-screen stage with native safe-area insets and a four-edge visibility guard
replace that layout. Portrait
camera metadata now fixes face-analysis direction across all frames/targets;
legacy detector fallback could change directions independently of phone motion.
Computer regression checks are distinct from physical acceptance. No fresh Redmi
result after these repairs, physical VALID or clinical accuracy is established.

Next owner acceptance: use a current APK, run in-app self-checks, repeat fresh
calibration, inspect pupil overlays and export the aggregate technical report.
Only proceed to reliable moving-test metrics when calibration, synchronization
and signal quality independently pass. See [verification workflow](BATCH3_VALIDATION.md).

## Versions and verification history

Per-version changes, APKs/checksums, source commits, computer verification and
pending device work are maintained in
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
This file is a current-state summary, not a release log. Recorded videos,
screenshots, personal calibration artifacts and patient data stay out of Git/Releases.
