# Status

## Current implementation

- Android-first clinician app: account/sign-in, encrypted on-device patient chart,
  eye-test instructions/recording, saved traces, report and PDF.
- Clinician navigation no longer embeds the legacy engineering menu. Camera,
  pupil/pipeline checks and screen 09 remain in the separate offline Batch 3 app;
  calibration and eye-test recording remain in the clinician exam flow.
- Active engineering scope remains Batch 3: calibration, Smooth Pursuit and
  Horizontal Saccade. Batch 4 is not started.
- Calibration uses `eye-contour-pupil-v9` measurements and `target-cv-ridge-v1` models.
  Fit-target-only CV selects affine/ridge/quadratic mapping. Held-out target and
  frame-error checks must pass for both eyes; old models require recalibration.
- Pupil search is restricted to anatomical eyelid contours; gaze is relative to
  the canthi. Face rectangles only guard head movement. Local numeric calibration
  export and individual ROI sharing are available on the result screen. The v9
  detector normalizes area, smoothing and score to the anatomical aperture;
  per-filter counters and unmarked lossless Y-plane PNGs support local diagnosis.
- Saved v8/v9 capture videos can be decoded and analyzed again without recording.
  Original target/timing metadata and capture age are preserved; old numeric
  pupil coordinates are discarded. Replay is not a fresh physical calibration.
- Decoder geometry/PTS integrity, explicit missing observations, native/JS
  contract checks and camera release/cancellation guards remain enforced.
- Portrait framing accepts sufficient height or width, with current-sample hints
  and stable READY/start checks. The lamp is a framing preflight; post-recording
  calibration quality gates are independent and unchanged.

## Evidence and next acceptance

Owner feedback on 2026-10-27: published 0.2.10 beta still fails calibration on the
Redmi. Vertical Saccade opens but cannot scroll to camera setup/start. This is a
confirmed layout defect: extended tests bypass the outer ScrollView and lacked
their own. The local repair restores scrolling and explicit recording-check
access without repeating calibration; it does not complete vertical/anti-saccade
metric alignment. Browser layout checks reproduce the old failure and exercise
the repaired controls with a mocked camera. Android behavior remains unverified.
See the [0.2.12 test release](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/v0.2.12-beta.1)
for verification evidence and claim boundaries.

Owner numeric evidence for `eye-contour-pupil-v8` is RETRY before
model fitting: 2,534 decoded frames, 0 accepted left-eye observations and 65
right-eye observations (2.57%); neither eye has a model. All 14 takes completed,
PTS are monotonic, and all 336 face keyframes yielded eye pairs. Numeric geometry
passes, but correct optical alignment and pupil visibility require ROI pixels.
Earlier screenshots with high retention and poor mapping describe the older path.
Later Redmi screenshots also show zero accepted observations for both eyes
(0/2,526 each); they contain no ROI pixels to identify the rejected component.

Computer counterfactuals using unchanged native code reproduce crop-size-dependent
candidate loss and confidence changes from background outside the eyelids.
Percentile selection uses eyelid area, while component area limits/prior and mean
brightness still use the full square crop. These are confirmed software weaknesses;
their contribution to each real rejection cannot be separated without pixels and
per-filter diagnostics. Missing samples also receive an unmeasured instability label.
No physical VALID or clinical accuracy is established.

The v9 repair removes the demonstrated crop-padding/background dependencies;
mapping, confidence and error gates are unchanged. No-sample targets are reported
separately from measured fixation spread. Computer checks do not establish phone
accuracy. Next acceptance: analyze the saved capture videos with the updated APK,
inspect source PNGs/marked ROIs and stage counters, then repeat fresh physical
calibration if detector quality supports it. Preserve mapping/error gates.
Numeric export excludes pixels; source PNGs and marked images appear under
**Ảnh kiểm tra đồng tử**, with individual sharing. A simulated detector fix is
not device acceptance.

The 0.2.12 beta delivery includes clinician and offline engineering APKs built
from the same clean source commit. Computer verification covers type/lint,
format, all 22 logic suites, 25 native JVM tests and binary/native-contract checks.
Signing certificates match published 0.2.10. Browser checks reproduce the
scroll failure in 15/15 old-screen cases and reach/invoke controls in 15/15
repaired cases using a mocked native camera. An isolated deliberate test failure
remains FAIL and causes exit 1. No phone was accessed or controlled. These APKs
have not been tested on the Redmi; calibration acceptance is unresolved.
Only proceed to reliable moving-test metrics when calibration, synchronization
and signal quality independently pass. See [verification workflow](BATCH3_VALIDATION.md).

## Versions and verification history

Per-version changes, APKs/checksums, source commits, computer verification and
pending device work are maintained in
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
This file is a current-state summary, not a release log. Recorded videos,
screenshots, personal calibration artifacts and patient data stay out of Git/Releases.
