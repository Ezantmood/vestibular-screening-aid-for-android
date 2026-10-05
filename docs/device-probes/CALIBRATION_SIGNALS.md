# Calibration / signal validation — 2026-10-05

Xiaomi Redmi Note 13 Pro 5G (2312DRA50G), Android 13/API 33.
FRONT 1920×1080 fixed [120,120], existing Camera2/P4 pipeline.

## Automated checks

- Existing P3, P3.5, P4 and stimulus execution suites pass.
- New calibration suite checks a known rotated/mirrored affine relation,
  held-out prediction, missing/incomplete/duplicate targets, hold boundaries,
  unbounded/invalid clock samples, degenerate features, poor validation,
  confidence/coverage, head/ROI changes, expiry/context and immutable inputs.
- New signal suite checks exact velocity for irregular-PTS linear motion,
  missing/blink/long gaps, invalid/duplicate/reversed/estimated PTS, weak
  isolated spikes, preservation of sustained rapid steps, denoising and raw
  preservation. No clinical metric or diagnosis is implemented.
- JDK 21 arm64 `:app:assembleDebug` passed; updated APK installed successfully.

## Device evidence

A temporary effect invoked the real CalibrationScreen handlers, React target
commits, preview camera and sequential native recording. It bypassed the manual
face-readiness button gate. No pupil, frame or target measurements were injected.
The test did not confirm that a participant fixated each target; it cannot
establish gaze accuracy.

All 14 actual target recordings succeeded: 180–182 encoded samples each,
2,526 total, with preview/session re-preparation between takes. Device-local
videos and the raw/processed artifact are excluded from Git.

The 9,287,041-byte versioned artifact was read back successfully. Analysis took
about 6 min 25 s after capture. The result was **RETRY**, correctly blocked:

| Engineering calibration evidence   | Image-space left | Image-space right |
| ---------------------------------- | ---------------: | ----------------: |
| Accepted calibration observations  |    1,575 / 2,526 |     1,750 / 2,526 |
| Per-target accepted coverage range |        5.0–92.2% |        28.9–90.6% |
| Fit RMSE (viewport fraction)       |           0.3435 |            0.3372 |
| Held-out RMSE (viewport fraction)  |           0.2328 |            0.2855 |
| Held-out maximum error             |           0.3096 |            0.4163 |
| Mapping confidence                 |                0 |                 0 |

Reasons included insufficient coverage, head/ROI changes, poor fit and poor
independent validation. No timing-hold failure was found. Candidate coefficients
are retained for diagnostics but are unusable. A supervised successful fixation
run and gaze accuracy across sessions/lighting remain unverified.

## Signal quality on the actual 14 recordings

Raw detector/tracker data was preserved and processed separately for each eye
and recording. Pooled triplet residuals below compare the same usable support;
they are ROI-coordinate noise proxies, not gaze accuracy or clinical metrics.

| Evidence                               |      Image-space left |     Image-space right |
| -------------------------------------- | --------------------: | --------------------: |
| Usable signal before → after           | 1,728 → 1,728 / 2,526 | 1,912 → 1,912 / 2,526 |
| Coverage before → after                |         68.4% → 68.4% |         75.7% → 75.7% |
| Median triplet residual before → after |   0.003911 → 0.001404 |   0.003981 → 0.001518 |
| Comparable triplets                    |                 1,458 |                 1,701 |
| Smoothed observed samples              |                 1,454 |                 1,699 |
| Isolated weak outliers rejected        |                     0 |                     0 |
| Missing/low-confidence gap groups      |                   156 |                   107 |
| Longest bracketed missing interval     |            518.900 ms |            502.055 ms |
| Usable actual-PTS velocities           |                 1,566 |                 1,796 |
| Interpolated samples                   |                     0 |                     0 |

No extra valid samples were created; segment starts after missing intervals
have null velocity. Blink/outlier/long-dropout rejection is also covered by
controlled execution tests; this device run did not establish a controlled
blink or multi-second occlusion ground truth. High-confidence false locks may
remain, and the offline filter can change fine motion dynamics. The rejected
calibration produces no usable viewport trajectory.

## Regression and remaining limits

All six execution suites, strict typecheck and lint pass. Existing preview/
recording and full-rate P4 decoding/tracking executed on all 14 recordings;
encoded/decoded counts matched. Final pure-domain replay checked all 5,052
real eye slots: raw unchanged, rejected calibration unmappable, no fabricated
positions and no cross-gap derivative. The native artifact read-back passed. No Pursuit/Saccade metric, clinical threshold or
diagnosis is implemented.

The wireless ADB connection changed ports repeatedly. Recordings and analysis
continued locally; the artifact survived reconnection. Keeping the active
calibration/analysis screen awake was added and releases on background,
completion and unmount, preserving any pre-existing window flag. Final native
compilation and Android Metro export passed. The last APK reinstall was
interrupted by ADB loss; runtime validation of this last helper and final manual
Home launch remain unverified. All temporary test effects were removed; App.tsx
was restored to manual Home.

Follow-up review found a screen-awake race between a delayed native enable and
replacement of a busy screen. The final hook uses shared owner aggregation and
serialized native writes. Deferred tests cover replacement during enable/disable,
background/foreground, final release and native failure recovery; all seven
execution suites, typecheck/lint and Android export pass. This follow-up does
not change the native method API or the measured calibration/signal data.
