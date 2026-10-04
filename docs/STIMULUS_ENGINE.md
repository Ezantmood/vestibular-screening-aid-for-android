# Stimulus contracts

`src/tests/stimulus/` owns configuration, trajectories, presentation logging,
clock mapping and recording analysis. `StimulusScreen` renders the target and
uses the existing preview/countdown/capture controls.

- Smooth Pursuit: horizontal sine, center 0.5, amplitude 0.35, period 4 s.
- Horizontal Saccade: 1 s center fixation, then alternate left/right every 1 s.
- Defaults are 10 s engineering exercises, not validated clinical protocols.
  Coordinates are display fractions; viewport dimensions are React Native dp.
- Trajectories use absolute monotonic elapsed time; delayed renders do not
  accumulate timer drift. Frame callbacks request updates; React layout effects
  log committed positions separately. These are not measured photon onsets.
- A session has explicit running/completed/cancelled outcomes. Stop, background,
  unmount and viewport changes cancel pending updates. Missing/out-of-session
  frame timestamps never receive target measurements.
- Native `elapsedRealtime` is bracketed by JS `performance.now`, recording bridge
  round-trip uncertainty. Frame joins use decoded PTS, never frame-index/FPS
  substitution. Planned target and last committed target are separate fields;
  committed positions are held, never interpolated into unobserved onsets.
- Current MediaRecorder anchor is **record-start-estimate** with unknown exposure
  offset (`uncertaintyUs: null`). It must not be used as a precise latency clock.
  The join API also accepts a future measured frame anchor with stated uncertainty.
- Raw config, commit timestamps, viewport, capture metadata, frame PTS and join
  statuses are saved as versioned JSON in app-private `cache/stimulus/`, beside
  the video reference. Cache is temporary and can be evicted; no database/upload.

No calibration, filtering, pupil-to-gaze mapping, latency, velocity, gain or
clinical score is calculated. Validation: [device report](device-probes/STIMULUS_ENGINE.md).
