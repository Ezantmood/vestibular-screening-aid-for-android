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

All seven execution suites, strict typecheck and lint pass. Existing preview/
recording and full-rate P4 decoding/tracking executed on all 14 recordings;
encoded/decoded counts matched. Final pure-domain replay checked all 5,052
real eye slots: raw unchanged, rejected calibration unmappable, no fabricated
positions and no cross-gap derivative. The native artifact read-back passed. No Pursuit/Saccade metric, clinical threshold or
diagnosis is implemented.

The wireless ADB connection changed ports repeatedly. Recordings and analysis
continued locally; the artifact survived reconnection. Keeping the active
calibration/analysis screen awake was added and releases on background,
completion and unmount, preserving any pre-existing window flag. Final native
compilation and Android Metro export passed. Final reinstall and runtime checks
were subsequently completed below. All temporary test effects were removed;
App.tsx was restored to manual Home.

Follow-up review found a screen-awake race between a delayed native enable and
replacement of a busy screen. The final hook uses shared owner aggregation and
serialized native writes. Deferred tests cover replacement during enable/disable,
background/foreground, final release and native failure recovery; all seven
execution suites, typecheck/lint and Android export pass. This follow-up does
not change the native method API or the measured calibration/signal data.

## Runtime follow-up — 2026-10-06

Wireless ADB pairing was restored and the final native APK installed successfully.
Manual Home displays entries 07 (Calibration) and 08 (Signal Processing), with
no active camera client. Native Camera2 probe returned BACK 0 and FRONT 1 without
errors. The existing 9,287,041-byte calibration artifact survived the update
byte-for-byte (SHA-256 matched the original read-back), remains RETRY, and
`loadCalibration()` returns null.

A temporary harness called the real native helper and shared busy hook. Actual
application window `FLAG_KEEP_SCREEN_ON` was observed through Android dumpsys,
with the default Expo developer tag temporarily released to measure the helper:
all 16 flag checks passed. These cover repeated enable/release, preserving an
existing Expo owner's flag, busy foreground/background/resume, completion,
restart and unmount. The Expo tag and manual Home were restored afterwards.
No temporary harness remains in source.

No new calibration or trajectory measurements were collected in this follow-up.
The 2026-10-05 measured results and limitations above remain unchanged.

## User calibration recheck — 2026-10-07

The user's new 14-target recording ran at FRONT 1920×1080 fixed [120,120].
All takes completed in protocol order with 2,523 encoded and decoded frames.
Result `cal-1791346355283`, captured about 11:11–11:12 local time, finished
analysis about 11:19. The 9,269,782-byte artifact was read from device-private
storage; videos stayed on-device. This result is distinct from the October 5 run.

**RETRY** has 29 reason entries. Recorded context had `viewportTop=-201`:
`scrollTo({y:0})` was queued, but the previous single-RAF measurement could
still observe the off-screen board. Context dimensions also came from the
earlier layout rather than that measurement. The original context is preserved;
there is no evidence establishing its actual display origin at each exposure.

The fix waits for native offset zero and two stable, finite, non-negative
viewport measurements, with cancellation and a two-second deadline. Context
uses measured dimensions/origin. Scrolling is locked throughout the busy run,
and each capture rechecks geometry before recording. The shared Pursuit/Saccade
measurement uses the same guard. An unstable/changed viewport prevents recording.

On Xiaomi, a temporary preflight invoked the real CalibrationScreen handler
after native scrolling: board top **-179**, offset **293.6667** before preparation;
top **114.6667**, offset **0** after the guard. No recording or calibration
invalidation was performed in this QA run. The effect and Home override were
removed; manual Home was restored. This verifies viewport preparation, not a
new successful human calibration.

| New recording evidence                         | Image-space left | Image-space right |
| ---------------------------------------------- | ---------------: | ----------------: |
| Accepted calibration observations              |    1,849 / 2,523 |       230 / 2,523 |
| Accepted calibration coverage                  |            73.3% |              9.1% |
| Targets passing per-target gates               |          11 / 14 |            0 / 14 |
| Fit RMSE (viewport fraction)                   |           0.2676 |               N/A |
| Held-out RMSE (viewport fraction)              |           0.3885 |               N/A |
| Held-out maximum error                         |           0.4862 |               N/A |
| Usable processed pupil slots (confidence ≥.35) |    1,891 / 2,523 |     1,314 / 2,523 |

Left fails ROI-movement, coverage at two fit targets, fit and held-out validation
gates. Right fails coverage at every target, with additional unstable-fixation
and ROI-movement flags; missing eligible features prevent a model. Raw detector
SUCCESS counts (1,947 left / 1,979 right) are not calibration coverage: median
SUCCESS confidence is 0.6084 / 0.4645, and tracking rejects 51 / 609 candidates.
Calibration requires accepted tracked features with confidence ≥.5. These flags
describe measurement quality, not a verified physical cause or diagnosis.

Replaying all **5,046** saved eye slots with the current domain code gives the
identical fitted RETRY result. Zero raw changes, fabricated tracked positions,
cross-gap derivatives, missing-to-valid samples, interpolation, PTS errors or
slot-count errors. Five informational rotation-fallback warnings preserve
mapped-back ROI coordinates; no decoder/PTS error was found. Mapping produces
zero usable viewport observations, including at capture time before expiry.

The original latest artifact remains byte-for-byte unchanged, SHA-256
`f2e854f599b74782b690d4c5528efef6922242ee77fdce5c41ba3cbd034d2515`.
Twelve execution suites, strict typecheck/lint, formatting, Android export and
JDK 21 arm64 native build pass. New checks cover the measured negative-origin
race, scroll readiness, changing/invalid geometry, missing callback deadline,
cancellation and preventing recorder start on failed preparation.

Fixing viewport preparation does not establish acceptable detection or gaze
accuracy for this recording. No thresholds were relaxed, no model was forced
VALID, and no valid Pursuit/Saccade metrics can be derived from this calibration.
