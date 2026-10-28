# Status

## Current implementation

- Android-first clinician app: account/sign-in, encrypted on-device patient chart,
  eye-test instructions/recording, saved traces, report and PDF.
- Routine build/release delivery contains only `vestibular-clinic.apk`. The
  separate engineering APK is no longer distributed. Existing engineering code
  and domain/native self-checks remain; calibration and eye-test recording use
  the clinician exam flow.
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

The owner reports that the latest APK still returns RETRY on Redmi. Supplied v9
numeric evidence now has accepted observations for both eyes, but several targets
fail sample coverage and all mapping gates fail. Recomputing the exported samples
with the production fitter reproduces the reported rejection. Encoded/decoded
counts and reported PTS checks pass; they do not establish optical alignment.
The numeric export omits exact APK identity and fresh-capture/replay provenance.

Owner ROI screenshots show visible eyes, anatomical-mask overlays and examples of
ambiguous or marginal-confidence detection. They are resized gallery thumbnails,
not source Y-plane PNGs or independently labelled pupil centers. They do not
establish the cause of every rejected frame or the poorly observed vertical axis.
Stored sensor-oriented crops alone do not establish a rotation bug.

Unchanged native production code has a reproduced localization weakness: its
darkest-4%-component weighted centroid follows internal shading even when the
synthetic pupil boundary and true center stay fixed. A single synthetic pupil
with two dark lobes can also produce ambiguity or a high-confidence false center.
The localization stress check fails. This confirms an estimator limitation, not
its exact contribution to the physical run. Existing v9 fixes remove demonstrated
crop-padding/background dependencies but do not solve dark-core localization.

Next acceptance: evaluate boundary-supported center estimation against fixed-boundary
shading, true two-axis motion, occlusion and false-candidate controls, then inspect
exact source PNGs and saved-video sequences from the same failed capture. Detector
overlays are not ground truth. Only a supported detector repair should lead to
another APK and fresh physical calibration. Preserve all mapping/confidence gates.
Source PNGs and marked images have individual sharing under **Ảnh kiểm tra đồng tử**.
No physical VALID or clinical accuracy is established.

The 0.2.12 layout repair restores scrolling and explicit recording-check access;
browser checks use a mocked camera and Android scrolling remains unverified. It
does not complete vertical/anti-saccade metric alignment. See the
[0.2.12 test release](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/v0.2.12-beta.1)
for verification evidence and claim boundaries.

The 0.2.12 beta delivery now contains only the clinician APK, unchanged from its
verified clean source commit. Its extra engineering APK was withdrawn at the
owner's request; the checksum/manifest and release notes reflect one APK.
Computer verification covers type/lint,
format, all 22 logic suites, 25 native JVM tests and binary/native-contract checks.
Its signing certificate matches published 0.2.10. Browser checks reproduce the
scroll failure in 15/15 old-screen cases and reach/invoke controls in 15/15
repaired cases using a mocked native camera. An isolated deliberate test failure
remains FAIL and causes exit 1. No phone was accessed or controlled by the agent.
Owner-provided calibration results remain RETRY; acceptance is unresolved.
Only proceed to reliable moving-test metrics when calibration, synchronization
and signal quality independently pass. See [verification workflow](BATCH3_VALIDATION.md).

## Versions and verification history

Per-version changes, APKs/checksums, source commits, computer verification and
pending device work are maintained in
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
This file is a current-state summary, not a release log. Recorded videos,
screenshots, personal calibration artifacts and patient data stay out of Git/Releases.
