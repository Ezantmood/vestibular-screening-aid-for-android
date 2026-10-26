# Status

## Current implementation

- Android-first clinician app: account/sign-in, encrypted on-device patient chart,
  eye-test instructions/recording, saved traces, report and PDF.
- Active engineering scope remains Batch 3: calibration, Smooth Pursuit and
  Horizontal Saccade. Batch 4 is not started.
- Calibration uses `eye-contour-pupil-v8` measurements and `target-cv-ridge-v1` models.
  Fit-target-only CV selects affine/ridge/quadratic mapping. Held-out target and
  frame-error checks must pass for both eyes; old models require recalibration.
- Pupil search is restricted to anatomical eyelid contours; gaze is relative to
  the canthi. Face rectangles only guard head movement. Local numeric calibration
  export and individual ROI sharing are available on the result screen.
- Decoder geometry/PTS integrity, explicit missing observations, native/JS
  contract checks and camera release/cancellation guards remain enforced.
- Portrait framing accepts sufficient height or width, with current-sample hints
  and stable READY/start checks. The lamp is a framing preflight; post-recording
  calibration quality gates are independent and unchanged.

## Evidence and next acceptance

The latest owner screenshots remain RETRY after the viewport/rotation repair:
70/100 rubric, nearly 99% overall retained samples, but only 2/871 left and
1/875 right held-out frames within tolerance. This is an unusable mapping, not
70% gaze accuracy. Screenshots alone cannot identify the pixels being tracked.

Computer regressions reproduce high-confidence dark blobs outside the eye and
face-box wobble overwhelming small pupil excursions. The current contour/canthus
path repairs these software weaknesses. Whether either caused this particular
Redmi failure, and the new physical accuracy, remain unverified. No physical
VALID or clinical accuracy is established.

Next owner acceptance: install the current APK, inspect cyan eyelid boundaries
and red pupil markers, perform fresh calibration, and use **Xuất số đo hiệu chỉnh
(JSON)** plus individual ROI sharing when investigating a rejection.
Only proceed to reliable moving-test metrics when calibration, synchronization
and signal quality independently pass. See [verification workflow](BATCH3_VALIDATION.md).

## Versions and verification history

Per-version changes, APKs/checksums, source commits, computer verification and
pending device work are maintained in
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
This file is a current-state summary, not a release log. Recorded videos,
screenshots, personal calibration artifacts and patient data stay out of Git/Releases.
