# Architecture

One job: dependency rules and where future native code plugs in. Spec/roadmap live elsewhere.

## Layers

```
UI (src/ui) -> Test engine (src/tests) -> Eye tracking (src/eyetracking)
  -> Signals (src/signals) -> Metrics (src/metrics) -> Storage (src/storage)
Camera (src/camera) + Patients (src/patients) are cross-cutting services.
```

## Rules

1. `App.tsx` only composes `src/ui/screens/*`. No logic in entry.
2. Domain folders own their types; no cross-imports except downward through the layer order above.
3. **Camera seam:** everything depends on `CameraService` interface in `src/camera/CameraService.ts` — never directly on `expo-camera` or native modules. Future Kotlin/Camera2 module implements this interface behind the same seam.
4. `tests/registry.ts` is the single source of truth for available tests.
5. Stubs stay stubs until their roadmap phase; mark with `TODO (Phase N)`.

## Native seam

```
src/camera/CameraService (TS interface, still stub)
src/camera/camera2Probe{,Types}.ts ──optional──▶ ExpoCamera2Probe (Kotlin, Android-only)
  └─ P0.1: read-only capability probe via Expo Dev Build (`expo run:android`).
src/camera/highSpeedCapture.ts + frameTiming.ts ──optional──▶ ExpoCamera2HighSpeed (Kotlin, Android-only)
  └─ P1: constrained high-speed session + MediaRecorder file + SENSOR_TIMESTAMP
     report; debug UI `HighSpeedTestScreen`. Mode list comes from the P0.1 probe;
     the module re-validates exact (size, range) pairs natively.
     CaptureResult callbacks are an observed ~60 Hz batched stream here — never
     the per-video-frame clock (see docs/DECISIONS.md).
src/camera/framePipeline.ts + videoTimeline.ts + frameChange.ts + framePipelineReport.ts
  ──optional──▶ ExpoFramePipeline (Kotlin, Android-only)
  └─ P2: offline MediaExtractor + MediaCodec decode of a P1 MP4 (no surface,
     CPU YUV Image); encoded/media PTS timeline (never sensor exposure);
     downsampled-Y MAD duplicate candidates; debug UI `FramePipelineScreen`
     (FRONT 1080p120 default, rear = benchmark).
src/camera/livePreview.ts + previewTransform.ts ──optional──▶ ExpoCamera2HighSpeed
  (same Kotlin module, additive P3.5 API) + ExpoCamera2HighSpeedPreview view
  └─ P3.5: ONE constrained high-speed session (preview TextureView Surface +
     idle MediaRecorder Surface, 1920×1080 fixed [120,120]); open/preview →
     recorder.start() (no session change) → stop/re-prepare → preview
     resumes. `cameraOwner` keeps preview XOR one-shot capture. Debug UI
     `LivePreviewValidationScreen` (READY-gated 10 s record + P2-decode
     regression panel + transform audit).
src/eyetracking/framing.ts (pure classification + stabilization, UX gates
  only — never pupil tracking, never consumed by analysis coordinates)
  └─ P3.5: NO_FACE / FACE_PARTIAL / TOO_CLOSE / TOO_FAR / OFF_CENTER /
     EYES_NOT_VISIBLE / READY over DISPLAY view fractions from a ~2 Hz
     ML Kit snapshot pass.
src/eyetracking/faceRoi.ts (isolated ROI interface; ML Kit boxes are feasibility
  only, never pupil tracking)
  └─ P2: face/eye ROI consumer of decoded frames.
src/eyetracking/pupil/ (pupilTypes + coordinates + detectors + pupilReport,
  pure + execution-tested; two candidates behind one detector interface)
src/camera/pupilDetector.ts ──optional──▶ ExpoPupilDetector (Kotlin, Android-only)
  └─ P3: single-frame pupil localization reusing the P2 decode pattern
     (exact Y-plane pixels, no ML Kit/OpenCV here); one PupilDetectionResult
     per eye slot, failures carry null centroids. P4 adds hinted second-pass
     entry `analyzeVideoPupilsWithPrior` (same decode, prior-constrained
     candidates + relaxed gate, `p4r_` overlays); requests without priors
     behave exactly like P3. Debug UIs `PupilValidationScreen` (FRONT
     1080p120 default, both detectors) and `TrackingValidationScreen`
     (P4: dense tracking over every decoded frame, 120 ROI keyframes).
src/eyetracking/tracking/ (pupilTracker + twoPassTracking + trackingReport,
  roiPropagation + denseTrackAnalysis, pure + execution-tested; per-eye
  PTS-based state machine)
  └─ P4: TRACKED / LOW_CONFIDENCE / TEMPORARILY_LOST / BLINK_OR_OCCLUDED /
     REACQUIRING / LOST over decoded PTS (never assumed frame interval);
     tracked == accepted raw (raw sequence preserved for P7), predictions
     exposed separately, missing stays missing. Full-rate tracks via ROI
     propagation: 120 ML Kit keyframes interpolated to every decoded frame
     (strict bracketing — blinks/occlusions/ROI loss are never interpolated
     across); targeted overlay batches for audit frames only. Never
     consumes gaze, degrees, stimuli, or clinical logic.
src/camera/pupilDetector.ts ──optional──▶ ExpoPupilDetector (Kotlin, Android-only)
  └─ P3: single-frame pupil localization reusing the P2 decode pattern
     (exact Y-plane pixels, no ML Kit/OpenCV here); one PupilDetectionResult
     per eye slot, failures carry null centroids. Debug UI
     `PupilValidationScreen` (FRONT 1080p120 default, both detectors).
     Phase 2+: capture/frames behind `CameraService` (see docs/ROADMAP.md).
```

See `docs/PROJECT_SPEC.md` for scope, `docs/ROADMAP.md` for phase order.

Camera test UI shares `src/ui/components/Camera{UI,ModePicker,CapturePanel,ImageGallery}`
and `src/ui/hooks/usePreviewCapture`: preview → cancellable countdown → record/stop →
local result, with camera release on unmount/background. Native calls remain behind
`src/camera/livePreview.ts`; P1–P4 consume the saved preview-session file through their
existing analysis seams. CaptureResult callback timing and encoded-video timing stay
separate. Regression evidence: `docs/device-probes/CAMERA_UX_REGRESSION.md`.

P4 robustness uses PTS interpolation and ROI-relative priors to tolerate head
translation/scale changes. Explicit blink/upstream loss/ambiguity cannot be
rescued; stale predictions are cleared, confidence decays to zero, and report
checks require tracked coordinates to equal the actual accepted measurement.
Current device evidence and limits: `docs/device-probes/P4_TRACKING.md`.

Stimulus Engine: `src/tests/stimulus/{engine,synchronization,sessionAnalysis}`
owns deterministic Pursuit/Saccade trajectories, committed-target history,
clock bridges and PTS joins. `StimulusScreen` renders and records via the
existing camera seam; native clock samples and JSON cache writes are additive
module methods. Contracts: `docs/STIMULUS_ENGINE.md`.

Calibration: `src/eyetracking/calibration/` owns per-eye mapping, stationary
target protocol, quality and context guards. Signal Processing: `src/signals/`
owns raw/processed separation, real-PTS segments, filtering and velocity.
`src/tests/eyeAnalysis.ts` orchestrates P4 through both domains; artifacts
persist via `src/storage/calibrationStore.ts` and the additive camera storage
seam. Screens consume these services. Contracts: `docs/CALIBRATION_SIGNALS.md`.

Eye tests: `src/tests/{smoothPursuit,horizontalSaccades,metrics/}` owns per-eye
engineering metrics, quality and response validity. `completeEyeTestRecording`
reuses the existing tracking/calibration/signal and cache seams; `EyeTestResults`
renders the measured outputs. Definitions and limits: [Eye tests](EYE_TESTS.md).
