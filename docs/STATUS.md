# Status

## Current implementation

- Android-first clinician app: account/sign-in, encrypted on-device patient chart,
  eye-test instructions/recording, saved traces, report and PDF.
- Active engineering scope remains Batch 3: calibration, Smooth Pursuit and
  Horizontal Saccade. Batch 4 is not started.
- Calibration uses `face-pupil-v6` measurements and `target-cv-ridge-v1` models.
  Fit-target-only CV selects affine/ridge/quadratic mapping. Held-out target and
  frame-error checks must pass for both eyes; old models require recalibration.
- Decoder geometry/PTS integrity, explicit missing observations, native/JS
  contract checks and camera release/cancellation guards remain enforced.

## Evidence and next acceptance

The latest owner-reported physical calibration remains RETRY despite adequate
accepted coverage. No physical VALID or clinical accuracy is established for
this algorithm. Computer simulations verify software behavior only.

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
