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
  The crop is centered on that contour. Production `percentile-dark` with a
  contour now uses the v10 boundary estimator: masked smoothing, connected
  regions over 2-Y threshold steps, and ≤18% area change across adjacent cuts.
  Region area/size/aspect gates remain 0.3–28% of the aperture, ≥6 px and ≤2.5.
  Thresholds propose regions; they never supply an intensity-weighted center.
- Outer region edges exclude enclosed reflection holes and a 2-px lid margin.
  A normalized conic fit proposes an ellipse; measured outward gradient peaks
  refine its edges at subpixel positions. Require ≥48/64 supported directions,
  ≥16 opposing pairs and no unsupported arc >90 degrees. Outline contrast must
  be ≥6 Y and peak above the adjacent brightness ramps. Fit RMS must be
  ≤max(1.25 px, 6% of the smaller semiaxis). Missing, poorly supported or
  severely occluded outlines return null, with no dark-core/crop-center fallback.
  Centers repeated across thresholds are one hypothesis; competing centers
  retain the existing ambiguity margin. A motion prior can only reject a
  measured center, never relax its outline checks or resolve ambiguity.
- Confidence uses measured outline contrast, fit residual, angular support and
  region stability. The calibration confidence gate remains ≥0.5; confidence
  is not a probability of locating the anatomical pupil correctly. Unmasked
  engineering and `contrast-normalized` probes retain their reference paths;
  they cannot establish a usable production calibration. Missing/malformed
  anatomical contours fail closed in calibration and recorded eye tests.
- The v9 darkest-core method can drift under internal shading and mistake two
  dark lobes of one pupil for competitors. V10 has explicit controls for those
  failures. Synthetic success and rejection do not establish Redmi accuracy;
  exact source pixels and independent center checks remain required. The
  custom region/edge checks have independent acceptance tests; related
  [PuRe research](https://arxiv.org/abs/1712.08900) motivates edge validation
  without transferring its reported performance to this phone.
- Result-screen replay re-decodes saved v8/v9/v10 capture videos with the current
  detector. Target sequence, hold clocks, viewport and original capture time are
  validated/preserved; old pupil numbers are discarded. Replay never renews age
  or counts as a fresh physical test. Audit images include unmarked lossless
  grayscale PNGs from the exact decoded Y crop plus marked JPEGs; rejection
  counters identify region stability, ellipse/outline rejection and prior filtering.
  V10 region counters sum evaluated threshold levels; hypothesis count deduplicates
  repeated centers. Outline RMS, support, contrast and stability are exported. Missing samples
  have `NO_VALID_SAMPLES`, not an unmeasured `UNSTABLE_FIXATION` claim.
- The gaze feature is pupil position relative to the two canthi, using the
  longest contour chord and its perpendicular, normalized by chord length.
  Whole-face boxes remain head-movement guards and never define gaze. Eye crops
  remain search windows, not gaze references. Contours/crops are propagated only
  between adjacent valid, same-orientation keyframes using real PTS; every pupil
  is still detected from that decoded frame's pixels, never interpolated.
  Predictions and estimated timestamps are excluded. Every target/eye needs
  ≥30 accepted samples, ≥60% coverage, ≥250 ms PTS span and RMS spread ≤0.04
  canthus lengths. This spread gate is stricter in pixels than the old face-box
  units; screen-error gates are unchanged.
- Measurement context `eye-contour-pupil-v10` retains the anatomical mask/canthus
  reference and replaces dark-core centroiding with boundary-supported ellipse
  centers. Native/JS contracts and echoed masks prevent mixed measurements.
  V1–v9 models cannot activate; replay must re-decode pixels and fit a new v10
  model. Existing model family selection and every mapping/frame-error gate stay
  unchanged. Neither detector SUCCESS nor an ellipse overlay is ground truth.
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

Clinician APK testing and local calibration export: [Batch 3 verification](BATCH3_VALIDATION.md).

Per-version changes and verified evidence:
[GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
Regression candidates are supported as an engineering approach by
[Severitt et al.](https://bop.unibe.ch/JEMR/article/view/9261); performance on this
phone still requires owner-operated physical validation.

The calibration result has **Xuất số đo hiệu chỉnh (JSON)** for a local share
sheet containing allowlisted numeric observations and technical summaries,
without account/patient records, paths, photos or videos. The export identifies
the exporting build separately from the saved analysis build and labels fresh
capture versus saved-video replay when recorded; legacy provenance stays unknown. ROI images can be
shared individually from their enlarged view. Saved numeric evidence and
image references remain inspectable after reopening, including rejected models.

Eye-analysis JSON uses a shared 64 MB UTF-8 read/write ceiling so contour evidence
can persist at full precision. Oversized payloads fail explicitly; no samples
are removed to fit storage. The latest calibration pointer is replaced atomically.
