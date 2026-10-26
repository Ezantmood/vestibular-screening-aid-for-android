# Calibration and signal contracts

`src/eyetracking/calibration/` owns calibration types, fixed target protocol,
quality gates and per-eye CV-selected mapping. `src/signals/` owns offline filtering,
validity, segments and velocity. `src/tests/eyeAnalysis.ts` orchestrates existing
P4 tracking and stores artifacts through the camera/storage seams.

## Calibration

- Preview framing is a UX preflight, not a pupil-accuracy or distance measurement.
  It accepts face height ≥0.60 OR width ≥0.80 of the upright view, with the
  existing clipping, maximum size, eyes and centering checks. This avoids an
  unreachable height-only gate for wide boxes in a portrait preview. Guidance
  follows the current observation; green/start requires three stable READY
  observations and a currently READY sample. Recording via the explicit
  technical override never bypasses the measured calibration gates below.

- Nine fit targets, four independent validation targets, repeated center for
  drift. Coordinates are fractions of the target viewport, not visual degrees.
  Image-space eye labels remain unchanged; the measured relation learns
  rotation/sign without assuming anatomical sides or mirroring raw analysis.
- Each target is React-committed, settles at least 600 ms, then remains stationary
  for an entire 1.5-second recording through recorder finalization. Clock bridge
  RTT must fit both hold boundaries. This avoids a moving-target exposure join;
  MediaRecorder start still does not establish individual frame exposure times.
- Calibration and Pursuit/Saccade share a native full-screen target window;
  account headers, banners, results and preview scrolling remain underneath.
  A modal-local native SafeAreaProvider/View excludes status/navigation bars and
  display cutouts, including enforced edge-to-edge Android windows.
  The board flexes into the actual remaining area, reserving a fixed text/control
  footer. No target is placed by a fraction of the whole application window.
  Before each recorder start, require two stable native measurements inside the
  measured visible container (all four edges), at least 128×128 dp, with timeout
  and cancellation. A resize cancels the take. Capture never requires scrolling.
- Upright portrait capture passes the probed Camera2 sensor orientation through
  the context into offline face analysis. Every frame/target uses that one CW
  correction (0/90/180/270); no rotated fallback may replace a miss. The report
  retains requested rotation and observed rotation counts. Unknown metadata
  blocks core capture. Legacy/debug files may still infer directions and warn;
  a detector direction change is not proof that the owner rotated the phone.
- The pupil is measured only inside the anatomical 16-point eyelid contour from
  [ML Kit](https://developers.google.com/ml-kit/vision/face-detection/android).
  The crop is centered on that contour. Its dark cutoff uses aperture pixels;
  components touching the lid boundary are rejected rather than reporting a
  biased partial centroid. Missing/closed/malformed contours fail closed in the
  calibration and recorded-eye-test paths. Legacy engineering crop probes may
  still run unmasked and cannot establish a usable calibration.
- The gaze feature is pupil position relative to the two canthi, using the
  longest contour chord and its perpendicular, normalized by chord length.
  Whole-face boxes remain head-movement guards and never define gaze. Eye crops
  remain search windows, not gaze references. Contours/crops are propagated only
  between adjacent valid, same-orientation keyframes using real PTS; every pupil
  is still detected from that decoded frame's pixels, never interpolated.
  Predictions and estimated timestamps are excluded. Every target/eye needs
  > =30 accepted samples, >=60% coverage, >=250 ms PTS span and RMS spread <=0.04
  > canthus lengths. This spread gate is stricter in pixels than the old face-box
  > units; screen-error gates are unchanged.
- Measurement context `eye-contour-pupil-v8` keeps exact component pixels,
  quantized percentile inclusion and the existing confidence gate, and adds the
  anatomical mask/canthus reference. v1–v7 measurements cannot activate. Native
  contracts and echoed mask geometry prevent mixing masked/unmasked results.
  Confidence and detector SUCCESS still do not establish a correct pupil.
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
  summaries. Old model contracts cannot activate, even with current v7 pixels.
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
  canthus normalization reduces translation/roll/scale effects; it does not establish head-pose or
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

The calibration result has **Xuất số đo hiệu chỉnh (JSON)** for a local share
sheet containing allowlisted numeric observations and technical summaries,
without account/patient records, paths, photos or videos. ROI images can be
shared individually from their enlarged view. Saved numeric evidence and
image references remain inspectable after reopening, including rejected models.
