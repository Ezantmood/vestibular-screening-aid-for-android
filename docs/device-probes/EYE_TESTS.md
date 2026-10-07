# Eye tests — Xiaomi verification, 2026-10-06

Xiaomi Redmi Note 13 Pro 5G (2312DRA50G), Android 13/API 33,
FRONT 1920×1080 fixed [120,120]. No clinical interpretation.

## Actual runs

A temporary harness invoked the real StimulusScreen camera/capture/analysis
handlers and its actual rendered target. Normal capture returned at the missing
calibration gate. Two explicit debug captures then ran the full native P2 decode,
P3 detection, P4 tracking and signal processing. Face readiness was bypassed;
participant fixation/head position was not supervised. No calibration, pupil,
gaze, response or frame measurement was substituted.

| Measured evidence                | Smooth Pursuit | Horizontal Saccade |
| -------------------------------- | -------------: | -----------------: |
| Stimulus outcome                 |      completed |          completed |
| React target commits             |            418 |                420 |
| Encoded / decoded frames         |  1,202 / 1,202 |      1,202 / 1,202 |
| Effective PTS FPS                |     119.504081 |         119.504081 |
| Missing / nonmonotonic PTS       |          0 / 0 |              0 / 0 |
| Estimated frame/target joins     |          1,188 |              1,190 |
| Clock bridge RTT                 |       0.498 ms |           0.475 ms |
| Usable pupil signal, L / R       |      232 / 245 |          491 / 812 |
| Pupil coverage, L / R            |  19.3% / 20.4% |      40.8% / 67.6% |
| Median pupil confidence, L / R   |  0.557 / 0.550 |      0.593 / 0.621 |
| Tracking dropout slots, L / R    |      959 / 952 |          682 / 381 |
| Usable pupil velocity slots, L/R |      189 / 221 |          415 / 764 |
| Capture-to-signal-artifact time  |      181.538 s |          235.370 s |
| Test result                      |        INVALID |            INVALID |

The existing calibration remains RETRY (40 reasons, including insufficient
coverage, head/ROI movement, poor fit and held-out validation). The active loader
returns null. There is **no usable calibrated trajectory** in these captures.
Consequently pursuit gain, tracking RMSE and catch-up count are N/A; Saccade
latency, peak velocity, accuracy, overshoot and undershoot are N/A, with 0/9
eligible responses per eye (`MISSING_CALIBRATION`). This is an invalid test,
not evidence of an absent physiological response. Raw pupil velocity is in ROI
units and is not presented as calibrated Saccade peak velocity.

These runs have no controlled blink ground truth; zero samples were classified
as blink/occlusion. Dropout/weak tracking remains explicit. Camera/exposure offset
is unknown and React commit is not photon onset. Successful calibrated human
Pursuit/Saccade metrics remain unverified.

## Artifacts and replay

Videos remain on-device. JSON metadata was read back through `run-as`, checked
and kept outside Git under ignored `debug-artifacts/eye-tests/`.

- Capture timelines: `timeline_809038669349876.json` (Pursuit),
  `timeline_809278785299785.json` (Saccade), in native `cache/stimulus/`.
- Signal artifacts: `signal_809038538409147.json`,
  `signal_809278662574837.json`, in native `files/eye-analysis/`.
- Final domain replay also adds explicit raw tracking quality to the result;
  these results were re-saved through the real stimulus cache seam as
  `timeline_809488097381007.json` / `timeline_809488190676944.json`, read back,
  and rendered through `EyeTestResults` on-device. Original target/video/PTS/signal references
  and invalid calibration status are preserved.
- All **4,808 real eye slots** were audited: tracked coordinates equal accepted
  raw measurements, raw/processed signals replay identically, RETRY maps no
  observation, no interpolation or cross-gap derivative, and encoded/decoded/
  timeline counts match. Both tests remain INVALID under the final metric code.
- The prior cancelled Saccade recording (280 frames,
  `timeline_646817693170630.json`) was replayed under the new analyzer and stays
  INVALID with `TEST_NOT_COMPLETED` and null metrics.

## Controlled checks

`npm test` runs nine suites: camera timing/PTS/MAD, P3, P3.5, P4, stimulus,
calibration, signal, screen-awake and eye-test metrics. The metric suite covers
31 groups: irregular PTS, harmonic gains 1/0.6/0.8 and phase lag, measured
stationary eye, rapid/catch-up exclusion, blink/baseline dropout, recovery,
wrong direction, anticipation, late/absent/truncated responses, endpoint
overshoot/undershoot, delayed commits, missing target steps, corrupt/missing/
estimated PTS, invalid calibration/coordinates, cancellation/incomplete tests,
independent eyes, raw preservation and fitted calibration-to-metric integration.

Controlled **synthetic** Saccade reference: 9/9 valid responses, median
commit-relative latency **199.9 ms**, sampled peak **14.000 viewport fractions/s**,
accuracy **1.000**; overshoot/undershoot zero within numeric tolerance. A 10%
primary amplitude change produces accuracy 0.9/1.1 and first-step undershoot/
overshoot 0.035. Under the unbounded recording anchor, precise latency stays
null and only the labelled estimate is returned. These are calculator checks,
not measured human eye metrics.

Final strict typecheck, lint, Prettier, all nine suites and Android Metro export
passed. JDK 21 arm64 native `:app:assembleDebug` passed (244 tasks; 5 executed,
239 up-to-date). APK reinstall returned Success. Manual Home includes the two-test
entry and calibration/signal entries; camera service has no active clients. Both
actual INVALID results rendered with explicit raw tracking coverage and N/A
metrics. All temporary capture, replay and UI effects were removed; App.tsx starts
manual Home. The 9,287,041-byte original RETRY calibration survived byte-for-byte
(SHA-256 `3be98329bae4b2179b3b0f2e41ebff42e2c368405387a51969bff78bd74aa55e`).

Remaining limits: supervised successful calibration/fixation, external gaze
reference, camera exposure and display onset measurement, visual degrees,
filter/sampling effects on onset and peak velocity, high-confidence false locks,
and clinical validation. Contract: [Eye tests](../EYE_TESTS.md).

## Robustness follow-up, 2026-10-07

Baseline: commit `9de774b`. Synthetic regression reproduced 0/9 eligible Saccade
responses at 240 fps from the fixed two-interval duration check. After the elapsed
PTS fix, a monotonic reference also exposed filter-created reversals after the
endpoint. Preserving complete rapid-motion window support fixes that artifact.
The reference now returns 9/9 responses at 120/240/500 fps and irregular cadence;
blink during onset remains invalid with null latency/peak. Eleven suites pass,
including 33 eye-test groups, native slot reconciliation and deferred capture
preparation/cancellation failures.

Node 25 benchmark on Mac, synthetic VALID affine calibration, 2,404 observations,
10 warm-up and 25 measured batches: median old per-frame validation **9.300 ms**,
validated snapshot **0.123 ms** (about 75.6× for this mapping step), including
snapshot construction. All mapped coordinates/confidences equal baseline.
It does not measure native decode/ML Kit runtime or establish an overall speedup.

Pure production replay of both stored real captures audited 4,808 slots. Raw
coordinates/PTS, accepted support, coverage and segment boundaries are unchanged;
no interpolated samples or derivatives across gaps. The corrected filter changes
3/2 processed pupil positions L/R in Pursuit and 4/13 in Saccade, maximum difference
0.00872 ROI fraction. Both tests remain INVALID with all calibrated metrics N/A.
No new supervised human gaze measurement was collected.

Xiaomi native/device checks used temporary effects that call production seams:

- The stored Saccade MP4 decodes 1,202 frames. A correct PTS request returns its
  original measured centroid (frame 0, PTS 0, X 1087.3897782010085). An injected
  frame-1 PTS 8334 instead of actual 8333 µs produces INVALID_GEOMETRY, null
  centroid and the exact requested/decoded mismatch warning.
- Production StimulusScreen's target width was changed to 240 dp during countdown.
  The final viewport recheck rejected it before recording; busy cleared and the
  camera returned to preview for retry.
- Production capture hook awaited 150 ms setup, then recorded a 1.2-second smoke
  take successfully with preview active and 72 batched sensor callbacks. This is
  lifecycle verification, not a successful calibrated eye test or an FPS claim.
- Full dense P3 replay of the stored Saccade video returned **2,404/2,404 slots**,
  decoded 1,202 frames, zero changed PTS/failure/centroid/confidence measurements,
  no warnings/error. The detector batch took 118.724 s; this excludes P2 ML Kit,
  rescue and metric processing. Failed detector confidence remains intact for
  audit; only absent/ambiguous slot identity creates a synthetic null failure.

JDK 21 arm64 Android build passed (244 tasks; 13 executed). APK reinstall succeeded.
Final production typecheck/lint, Prettier, all eleven suites and Android Hermes
export pass. Temporary effects/input were removed, manual Home restored, camera
clients empty, original RETRY calibration SHA unchanged. Remaining measurement
limitations from the original runs still apply.
