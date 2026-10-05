# Calibration and signal contracts

`src/eyetracking/calibration/` owns calibration types, fixed target protocol,
quality gates and per-eye affine mapping. `src/signals/` owns offline filtering,
validity, segments and velocity. `src/tests/eyeAnalysis.ts` orchestrates existing
P4 tracking and stores artifacts through the camera/storage seams.

## Calibration

- Nine fit targets, four independent validation targets, repeated center for
  drift. Coordinates are fractions of the target viewport, not visual degrees.
  Image-space eye labels remain unchanged; the measured affine relation learns
  rotation/sign without assuming anatomical sides or mirroring raw analysis.
- Each target is React-committed, settles at least 600 ms, then remains stationary
  for an entire 1.5-second recording through recorder finalization. Clock bridge
  RTT must fit both hold boundaries. This avoids a moving-target exposure join;
  MediaRecorder start still does not establish individual frame exposure times.
- Features are accepted tracked centroids normalized against each frame's eye
  ROI. Predictions and estimated timestamps are excluded. Raw P3/P4 values stay
  separate. Robust medians trim distant samples; every target/eye needs at least
  30 accepted samples, 60% coverage, 250 ms PTS span and RMS spread <=0.04 ROI.
- Both eyes must pass. Degenerate/correlated feature geometry, missing targets,
  invalid PTS, unstable fixation, head/ROI changes or poor held-out prediction
  produce `RETRY`. Fit/validation RMSE <=0.08 and validation maximum <=0.15
  viewport fraction are engineering gates, never clinical cutoffs.
- A retry/cancel invalidates the previous active result. Versioned result,
  coefficients, provenance, per-target quality, raw detections/tracks, normalized
  observations and processed signals persist in app-private `files/eye-analysis/`.
  A latest pointer is replaced atomically. Videos remain cache references and
  can be evicted; no database/upload is added.
- Reuse is limited to 15 minutes, identical camera/resolution/FPS/detector,
  coordinate version and viewport geometry, including absolute display origin.
  Mapping rejects ROI scale changes >20%, center changes >0.3 ROI, unsupported
  feature extrapolation and off-viewport output. Recalibrate after changing
  framing, lighting, device position or session conditions. ROI normalization
  reduces translation/scale sensitivity; it does not establish head-pose or
  illumination invariance.
- Recorded Pursuit/Saccade now requires a usable calibration; target-only preview
  remains available. Captured eye signals are saved with the calibration ID and
  linked from the existing stimulus artifact. No eye-test metric is calculated.

## Signal processing

- Process one eye and one coordinate space at a time. Store the original ordered
  input plus original detector/tracker output. Real decoded media PTS is the
  time axis; missing, estimated, duplicate, reversed and invalid timestamps are
  rejected rather than replaced with nominal FPS.
- All missing/blink/dropout samples remain null. Missing samples, skipped frame
  indices and PTS gaps >50 ms split segments. No interpolation or resampling is
  performed, including short gaps; no filter or derivative crosses a boundary.
- Reject only isolated weak spikes (<0.65 confidence) that return to consistent
  neighbors within 50 ms. High-confidence and sustained rapid steps are kept.
  A strong detector false lock can therefore survive: this is conservative
  outlier handling, not a guarantee of pupil accuracy.
- Confidence-weighted local linear filtering uses a +/-16 ms PTS window within
  each segment. Large local motion is preserved. This offline filter uses future
  neighbors and may still alter fine dynamics; no real-time/clinical validation
  is claimed. Filtered observations are explicitly distinct from raw samples.
- Backward velocity uses actual consecutive PTS differences, with units of
  ROI fraction/s, viewport fraction/s or decoded px/s. Segment starts and invalid
  intervals have null velocity. Confidence is bounded by supporting samples.
- Quality includes coverage, confidence, segment/gap/reason counts and median
  time-weighted triplet residual before/after. The latter is a noise proxy that
  also includes real trajectory curvature. A raw comparison on the exact
  processed support is saved to expose any effect of outlier rejection.

Verification and measured limitations: [device evidence](device-probes/CALIBRATION_SIGNALS.md).
