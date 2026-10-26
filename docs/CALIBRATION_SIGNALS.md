# Calibration and signal contracts

`src/eyetracking/calibration/` owns calibration types, fixed target protocol,
quality gates and per-eye CV-selected mapping. `src/signals/` owns offline filtering,
validity, segments and velocity. `src/tests/eyeAnalysis.ts` orchestrates existing
P4 tracking and stores artifacts through the camera/storage seams.

## Calibration

- Nine fit targets, four independent validation targets, repeated center for
  drift. Coordinates are fractions of the target viewport, not visual degrees.
  Image-space eye labels remain unchanged; the measured relation learns
  rotation/sign without assuming anatomical sides or mirroring raw analysis.
- Each target is React-committed, settles at least 600 ms, then remains stationary
  for an entire 1.5-second recording through recorder finalization. Clock bridge
  RTT must fit both hold boundaries. This avoids a moving-target exposure join;
  MediaRecorder start still does not establish individual frame exposure times.
- Before capture, wait for native scroll offset zero and two consecutive stable,
  non-negative viewport measurements, with a two-second deadline and cancellation.
  Use measured dimensions/origin for context, lock scrolling while busy, and
  recheck identical geometry before every recorder start. A queued `scrollTo`
  alone does not establish the target's display position. Pursuit/Saccade use
  the same guard, including the post-countdown measurement.
- The gaze feature is the tracked pupil in the head face box, normalized by that frame's measured face size. The eye crop still follows the eye landmark so the
  pupil can be found, but position inside that moving crop is not the feature:
  it cancels gaze. Frames with no measured face are rejected. Predictions and
  estimated timestamps are excluded. Robust medians trim distant samples; every
  target/eye needs at least 30 accepted samples, 60% coverage, 250 ms PTS span
  and RMS spread <=0.04 of the face box.
- Measurement context `face-pupil-v6` keeps the current dark-core detector: exact
  connected-component pixels, quantized percentile cutoff, and no center-closeness
  penalty. The eye crop is 0.30 of the face width. v1–v5 models cannot activate.
  Native guards for both frame geometry and pupil detection prevent mixed measurements. A detector
  SUCCESS does not establish an eligible calibration observation.
- Model contract `target-cv-ridge-v1` selects affine, affine-ridge or quadratic-ridge
  using leave-one-target-out CV on the nine fit medians only. Each fold recomputes
  its own centering/scaling; λ is one of 0.001/0.01/0.1/1 for ridge candidates.
  Prefer affine unless a more complex model improves CV by at least 10%. Five
  held-out targets never tune/select a model; a failed check cannot trigger
  shopping for another candidate. Fits use Householder QR with augmented ridge
  rows. The original 1e-4 variance floor in reference-eye-crop units and 0.02
  correlation margin remain enforced.
- Both eyes must pass. Degenerate/correlated feature geometry, missing targets,
  invalid PTS, unstable fixation, head/ROI changes or poor held-out prediction
  produce `RETRY`. Fit, fit-CV and held-out median RMSE must each be ≤0.08;
  held-out median maximum must be ≤0.15 viewport fraction. Every held-out target
  must also have accepted-frame RMS ≤0.08 and p95 error ≤0.15, before filtering
  or clipping. A good median cannot hide noisy frames. These are engineering
  gates, never clinical cutoffs.
- Quadratic Jacobian determinant extrema over the fitted feature rectangle
  must retain a nonzero sign, rejecting folds/flat mappings while allowing
  rotations and mirrors. Quadratic runtime features cannot extrapolate outside
  that rectangle; affine retains its existing 10% feature margin. Saved-model
  activation recomputes fit-only selection/coefficients/errors and checks frame
  summaries. Old model contracts cannot activate, even with current v6 pixels.
- Checklist v2 counts 28 sample-quality bundles plus six mapping gates per eye
  (40 total). Legacy v1 keeps its 34-item rubric. Missing evidence is not success.
  Checklist points are not percent-correct gaze or a substitute for activation.
  Accepted-frame percentages describe agreement with instructed fixation and must
  be read with coverage/target counts; neighboring frames are correlated.
- A retry/cancel invalidates the previous active result. Versioned result,
  coefficients, provenance, per-target quality, raw detections/tracks, normalized
  observations and processed signals persist in app-private `files/eye-analysis/`.
  A latest pointer is replaced atomically. Videos remain cache references and
  can be evicted; no database/upload is added.
- Reuse is limited to 15 minutes, identical camera/resolution/FPS/detector,
  coordinate version and viewport geometry, including absolute display origin.
  Mapping rejects face-box scale changes >20%, center changes >0.3 of the face,
  unsupported feature extrapolation and off-viewport output. Recalibrate after
  changing framing, lighting, device position or session conditions. Face
  normalization reduces head translation; it does not establish head-pose or
  illumination invariance.
- Recorded Pursuit/Saccade now requires a usable calibration; target-only preview
  remains available. Captured eye signals are saved with the calibration ID and
  linked from the existing stimulus artifact. Engineering metrics consume these signals through [eye-test contracts](EYE_TESTS.md).

## Signal processing

- Tracking rejects failed/partial decoder output and requires 1:1 encoded/decoded
  counts with a complete, strictly increasing real PTS array. ROI propagation
  requires measured landmarks and consistent bracketing PTS; face-proportion
  estimates and missing/inconsistent PTS cannot provide a calibrated trajectory.

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
  each segment. Large local motion preserves its complete window support to avoid
  false reversals at mixed raw/filtered edges. This offline filter uses future
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

Independent APK testing and aggregate export: [Batch 3 verification](BATCH3_VALIDATION.md).

Per-version changes and verified evidence:
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
Regression candidates are supported as an engineering approach by
[Severitt et al.](https://bop.unibe.ch/JEMR/article/view/9261); performance on this
phone still requires owner-operated physical validation.
