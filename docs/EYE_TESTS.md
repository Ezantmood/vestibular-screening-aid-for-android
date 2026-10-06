# Pursuit and Horizontal Saccade contracts

Only these two engineering tests are implemented. No diagnostic interpretation.
Stimulus defaults remain unchanged; [stimulus](STIMULUS_ENGINE.md) and
[calibration/signal](CALIBRATION_SIGNALS.md) contracts still apply.

## Pipeline and result

`completeEyeTestRecording` runs the existing full-rate P4 replay once, maps each
accepted eye observation using calibration valid **at recording time**, processes
actual PTS segments, calculates per-eye metrics, and saves results in the existing
stimulus JSON (schema 2). It reuses P4 decoded PTS instead of decoding twice.
The linked signal artifact retains raw detection/tracking and raw/processed
calibrated trajectories, confidence, rejection reasons and derivatives. No new
session/database/reporting subsystem is introduced.

Normal capture requires usable calibration with matching camera/viewport context.
The explicit debug recording button permits missing calibration: tracking and
pupil signals are saved, test is INVALID and calibrated metrics remain null.
Candidate coefficients from RETRY are never used. Offline analysis uses the
capture-time calibration snapshot so processing delay does not expire valid data.

The screen shows test/eye quality, support, units, metric values and every Saccade
response including its failure reason. JSON details link to both local artifacts.
L/R are image-space sides; there is no binocular averaging or invented gaze.

## Smooth Pursuit

- Pursuit gain is fitted horizontal **smooth velocity harmonic amplitude** divided
  by the committed target's fitted position harmonic amplitude times angular
  frequency. Both sine/cosine coefficients and a constant offset are fitted on
  real elapsed time with interval weighting. This avoids division near turning
  points and is insensitive to a constant alignment phase shift; it does not
  prove that the exposure offset is constant or measured.
- Velocity intervals above the engineering rapid-motion gate are excluded from
  gain. Fully bracketed rapid candidates also exclude a 40 ms margin on both
  sides. Minimum smooth support and support in all four phase quadrants are
  required. Missing support never becomes gain zero; a measured stationary eye
  with sufficient valid data can legitimately have gain zero.
- Tracking RMSE uses processed 2D gaze against the last committed target, with
  real-interval weighting. It includes rapid movements and is alignment-dependent.
- Rapid candidates need consecutive fast intervals, measured low-speed boundaries,
  minimum duration/displacement and an uninterrupted signal segment. Catch-up
  candidates additionally move toward the target and reduce positional error.
  Counts are candidates for debugging, not clinically validated saccade labels.
  Blink/dropout cannot create an event across a gap.

Velocity-amplitude gain and exclusion of saccades are consistent with the
measurement approach in [Ke et al., 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5446489/).
Our viewport-unit gates and fitting/support policy are engineering choices and
are not validated against that study's visual-angle measurements.

## Horizontal Saccade

- Each **committed** step has a separate response. Delayed/skipped presentation
  never substitutes a planned onset. Baseline must continuously observe stable
  fixation near the previous target. The first sustained rapid response wins;
  wrong-direction or anticipatory motion is not replaced by later corrections.
- Onset is the preceding PTS boundary of the first sustained high-velocity
  interval. Peak velocity is the largest observed absolute horizontal derivative
  during the primary response, with a raw same-support peak also reported.
  Gaps, inadequate time resolution, direction reversal, truncated movement or
  failure to observe a stable endpoint invalidate the response.
- Accuracy = signed primary displacement / absolute target step amplitude.
  Values may exceed 1. Endpoint is the median of the first observed stable hold
  after the primary response. Signed endpoint error is relative to the new target;
  overshoot = max(error, 0), undershoot = max(-error, 0), in viewport fractions.
  These measure the primary endpoint, not a later corrected fixation or maximum
  transient excursion. Medians include only valid responses; all exclusions and
  denominators remain visible. There is no degree/s conversion.
- `estimatedLatencyMs` is relative to React commit under the current unknown
  camera offset. `latencyMs` stays null for record-start-estimate or unbounded
  anchors. A future measured frame anchor can populate commit-relative latency
  with anchor/bridge, sampling and filter-window uncertainty, but does not measure
  photon onset. The UI always identifies the clock and estimate.

## Quality and limits

All policy values live in [`TEST_POLICY`](../src/tests/metrics/quality.ts).
They are engineering gates, not normal/abnormal clinical thresholds.

GOOD_DATA requires sufficient coverage, confidence, continuous time support and
presentation cadence. POOR_DATA retains supported metrics with explicit reasons,
including the present unbounded exposure offset or one invalid eye. INVALID
includes absent/rejected calibration, cancelled/incomplete run, corrupt PTS/target
history, insufficient signal/smooth support, or no valid Saccade response. Missing
metrics are null/N/A. Response failures distinguish incomplete windows, blink/
dropout, unstable baseline, absent response, wrong direction, anticipation, late
response, missing target step and incomplete response.

Unsupervised device runs cannot establish fixation or gaze accuracy. High-confidence
pupil false locks can survive P4; filtering and camera sampling can alter onset and
sampled peak velocity. Catch-up classification and target-error metrics depend on
estimated synchronization. Viewing geometry, visual-angle conversion, external
reference eye tracker and clinical validation remain absent. Verification and real
measurements: [device evidence](device-probes/EYE_TESTS.md).
