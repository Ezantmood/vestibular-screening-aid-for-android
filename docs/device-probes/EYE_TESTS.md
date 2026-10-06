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
