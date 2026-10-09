# Status

## Completed (bootstrap)

- Expo SDK 57 + TypeScript scaffold (`blank-typescript`), Android-first `app.json` (package `com.vestibular.screeningaid`).
- Domain structure: `ui/ patients/ tests/ camera/ eyetracking/ signals/ metrics/ storage/ config/ utils/`.
- Minimal `HomeScreen` boot check wired via `App.tsx`.
- Tooling: ESLint (`eslint-config-expo`, flat), Prettier, `typecheck`/`lint`/`check` scripts; `eas.json` dev profile stubbed for later.
- Docs: README, AGENTS, `docs/{PROJECT_SPEC,ARCHITECTURE,ROADMAP,DECISIONS,STATUS}.md`.

## Verification (2026-09-24, Expo SDK 57, Node 25)

- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm run format` — pass.
- `npx expo-doctor` — 21/21 pass.
- App entry (`App.tsx` → `HomeScreen`) verified by type/lint; runtime boot check in Expo Go is the next manual step on the Redmi device.
- No camera/tracking/auth/DB code present by design (stubs only).

## Next task (was: Camera2 capability probe)

**P0.1 COMPLETE (2026-09-29, verified on-device, rear + front recorded):**
Full physical-device report stored in
`docs/device-probes/XIAOMI_2312DRA50G_ANDROID13.md` (source of truth: raw
Camera2 report, not Xiaomi slow-motion modes).
`modules/expo-camera2-probe` (Android-only Kotlin local module) queries the real
Camera2 API for every `CameraManager.cameraIdList` camera: ID, lens facing,
hardware level, sensor orientation, AE FPS ranges, constrained-high-speed-video
flag, all `getHighSpeedVideoSizes()` + per-size `getHighSpeedVideoFpsRangesFor()`.
TS seam: `src/camera/camera2Probe{,Types}.ts`; debug UI: `Camera2ProbeScreen`.
Nothing hard-coded, nothing inferred from Xiaomi slow-motion modes.

- Strict verdicts (`getHighSpeedTargetVerdict`): a target fps is YES only with a
  fixed `[fps, fps]` range; matching just a range maximum is UPPER, never
  support; interior matches (e.g. 120 inside `[30, 240]`) are NOT_ADVERTISED.
  Verified by 7/7 passing execution tests on synthetic Camera2 data.
- Permission review (API 29+): verified against AOSP that none of the six probe
  keys needs CAMERA permission (only lens/sensor calibration keys are gated);
  reads stay null-safe. No permission declared/requested; camera never opened.

## Verification (P0.1 on-device report)

- `npm run check` (typecheck + lint) — pass. `npx prettier --check .` — pass.
- `npx expo prebuild --no-install --platform android` — pass; autolinking
  resolves `com.vestibular.screeningaid.camera2probe.ExpoCamera2ProbeModule`.
- Full native compile — **pass**: `:app:assembleDebug` BUILD SUCCESSFUL
  (193 tasks, 0 failed; `:expo-camera2-probe:compileDebugKotlin` OK;
  arm64-only `app-debug.apk`, 46 MB).
  Build env (Mac arm64): SDK at `~/Library/Android/sdk`
  (platform-tools 37.0.1, platforms/build-tools 35+36), Gradle 9.3.1.
  Build must run under JDK 21 (`JAVA_HOME=.../openjdk@21`): JDK 26 breaks
  AGP 8.12 prefab (JVM restricted-method warning parsed as fatal).
- On-device acceptance — **pass** (wireless ADB, `adb reverse` for Metro):
  Dev Build installs, launches, loads the native module, enumerates cameras
  without crashing, and displays every required field.
  Device: Xiaomi 2312DRA50G (Redmi Note 13 Pro 5G, garnet),
  Android 13 / API 33 (`TKQ1.221114.001`). Cameras reported: `0`, `1`.
- Camera 0 (BACK): LEVEL_3, 90°, constrained high-speed supported.
  AE ranges: `[1, 5] [5, 5] [10, 10] [14, 14] [15, 15] [12, 24] [24, 24]`
  `[7, 30] [14, 30] [30, 30]`.
  High-speed: `1280×720: [30, 120] [120, 120] [30, 240] [240, 240]`;
  `720×480`, `640×480`: same; `1920×1080: [30, 120] [120, 120]`.
  Verdicts: 1080p120 YES (fixed), 720p120 YES (fixed), 720p240 YES (fixed).
- Camera 1 (FRONT): LEVEL_3, 270°, constrained high-speed supported.
  AE ranges: `[10, 10] [15, 15] [12, 24] [24, 24] [10, 30] [30, 30]`.
  High-speed: `1280×720`, `720×480`, `640×480`, `1920×1080` — each
  `[30, 120] [120, 120]` only.
  Verdicts: 1080p120 YES (fixed), 720p120 YES (fixed), 720p240 NO.
- No per-camera errors. (`dumpsys media.camera` lists extra physical
  sub-cameras; Camera2 exposes the two logical cameras above.)

## Next task

**Phase 2 go/no-go (not started):** both cameras advertise fixed 120fps ranges
(incl. front 1080p120/720p120); only the rear camera offers fixed 240fps.
No tracking/recording was implemented (out of scope for P0.1).

## P1 — High-speed capture + frame timing validation (code-complete, on-device measurement pending)

- New Android-only module `modules/expo-camera2-high-speed` (Kotlin, autolinked;
  read-only probe untouched). Opens the camera, runs a real
  `CameraConstrainedHighSpeedCaptureSession` (`createHighSpeedRequestList` +
  `setRepeatingBurst`) on a video-only MediaRecorder surface (app-private
  cache, no audio → no mic permission), collects `SENSOR_TIMESTAMP` +
  frame numbers, then cross-checks the file with MediaExtractor
  (sample count + duration; nulls when unavailable, never invented).
- Safety in native code: mode must EXACTLY match a live Camera2-advertised
  `(size, [fps, fps])` pair (`[30, 240]` is never rewritten); CAMERA must be
  granted; all camera/recorder/thread resources released in `finally`, plus
  cancel + `OnDestroy` force-close so the camera is never left locked.
- `app.json` declares `android.permission.CAMERA` only; runtime flow via
  `PermissionsAndroid` handles granted / denied / permanently-denied
  (→ Settings) / unavailable (Expo Go). UI shows camera ID, front/back,
  resolution, exact range; lists only fixed ranges sorted 1080p120 →
  720p120 → 720p240 from live probe data.
- Timing stats (`src/camera/frameTiming.ts`, pure + execution-tested on
  synthetic data: perfect 120fps → 120.00 obs/0 gaps; 1 dropped frame →
  1 gap + 1 estimated miss; edge cases throw): samples, duration, mean,
  median, min, max, observed FPS, jitter stddev, p95, large gaps (>1.5×T),
  estimated missing frames Σ(round(dt/T)−1) — documented estimate, not proof.

## Verification (P1, 2026-09-29)

- `npm run check` — pass. `npx prettier --check .` — pass.
- Frame-timing execution tests on synthetic data — pass (see STATUS history).
- `npx expo prebuild --platform android` — pass (`android.permission.CAMERA`
  in manifest; both native modules autolinked).
- `:app:assembleDebug` BUILD SUCCESSFUL (JDK 21); `:expo-camera2-high-speed:compileDebugKotlin`
  OK after fixing `createHighSpeedRequestList` to the instance API (it is not static).
- Deployed to Xiaomi 2312DRA50G over wireless ADB (`adb reverse` + Metro on
  `:8081` already running): install Success, MainActivity launches, JS bundle
  loads, no fatal/logcat errors.
- P0.1 probe screen untouched (Home still lists it; verified in UI dump).
- On-device 10 s measurements — DONE 2026-09-29, all four P0.1-advertised
  fixed modes (rear 1080p120 / 720p120 / 720p240, front 1080p120): every
  session CONFIGURED, every recording SUCCESS with file output, no camera
  errors. Encoder-side (MediaExtractor) sustains ≈116 fps for 120 modes and
  ≈227 fps for the 240 mode. Observed Camera2/HAL callback behavior during
  constrained high-speed batching: CaptureResult callbacks arrived at ≈60 Hz
  regardless of stream rate, so per-frame timing must come from video frames,
  not `onCaptureCompleted`. Full table + raw blocks:
  `docs/device-probes/P1_HIGH_SPEED_VALIDATION.md`. Wireless-ADB shell lacks
  INJECT_EVENTS/`pm grant`, so runs used a temporary auto-run harness
  (reverted; final APK rebuilt from the manual-only tree, reinstalled and
  launch-verified).
- Recommendation (technical): proceed with rear 1920×1080 @ fixed 120fps
  (reliable session, ≈116 fps sustained, max spatial detail); keep 720p240
  as temporal benchmark; next prototype needs a frame-level timing path.
  (Superseded by the P2 architecture correction: FRONT 1080p120 is the
  primary MVP eye-tracking candidate, rear modes are benchmarks —
  see `docs/DECISIONS.md` §12.)

## P2 — High-speed frame decode + eye ROI feasibility (COMPLETE 2026-09-29, verified on-device)

- Architecture correction applied: FRONT 1920×1080 @ fixed 120fps is the
  primary MVP candidate (user looks at the display while the camera observes
  the eyes); rear 1080p120 / 720p240 are benchmarks (`docs/DECISIONS.md`
  §12–14). `HighSpeedTestScreen` mode order retouched (front first); P0.1/P1
  logic untouched. P1 wording revised: ~60 Hz CaptureResult cadence is now
  described as observed Camera2/HAL callback behavior during constrained
  high-speed batching, never as the per-video-frame clock.
- New Android-only module `modules/expo-frame-pipeline` (Kotlin, autolinked;
  ML Kit `face-detection:16.1.7` for the ROI pass only). One offline call
  decodes a P1 MP4 via MediaExtractor + MediaCodec (no surface, CPU YUV —
  never `getFrameAtTime` as primary): sequential index + decoded PTS (µs) +
  size per frame; encoded/media PTS timeline stats (mean/median/min/max/p95,
  effective FPS, non-monotonic/duplicate-PTS/large-gap counts; nominal
  8.333 ms @120fps); downsampled-Y (96×54, no RGB) MAD duplicate candidates
  (≤1.5 candidate / 1.5–5.0 low-motion-not-duplicate, longest run, stats);
  ML Kit face/eye ROI on ≤9 offline frames with 0°/90°/270° rotation fallback
  (ROIs only, never pupil tracking); begin/mid/end JPEGs + eye crops to
  device-local cache (never git).
- TS seam: `framePipeline.ts` loader, `videoTimeline.ts` + `frameChange.ts`
  pure logic, `framePipelineReport.ts` copyable report with separate
  `FRAME_PIPELINE_*` / `EYE_ROI_*` verdicts, `faceRoi.ts` isolated ROI
  interface (pupil stage reuses the decoder untouched). Debug UI
  `FramePipelineScreen` (front default, 64-frame validation ROI sample)
  wired into Home. Validation sampling raised to 50–100 (native cap 120,
  prompt bitmap recycling, 8 s detection timeout); screen analyzes 64
  evenly spread offline frames. No pupil/gaze/
  stimulus/metric/diagnosis code (out of scope).

## Verification (P2, 2026-09-29, on-device — Xiaomi 2312DRA50G / Android 13 / API 33)

- `npm run check` (typecheck + lint) — pass. `npx prettier --check .` — pass.
- Pure-logic execution checks (node, synthetic data) — pass (see prior entry).
- `npx expo prebuild --platform android` — pass (all three native modules
  autolinked).
- `:app:assembleDebug` BUILD SUCCESSFUL (JDK 21).
- On-device validation — DONE (current wireless-ADB pairing
  `192.168.1.189:43123`, `adb reverse` + Metro `:8081`; temp auto-run
  harness reverted, final manual APK reinstalled + launch-verified). FRONT
  1920×1080 `[120,120]`, 2× ~10 s clips (still self-test + motion control):
  - Clip A (still): encoded 1178 / decoded 1178 / 9.849 s / **119.50 fps**;
    PTS mean 8.368 / median 8.333 / max 8.500 ms; non-monotonic 0, dup-PTS 0,
    large gaps 0. MAD median 1.39 (static content; 74% under the pre-device
    1.5 candidate threshold — see noise-floor note). ROI 64 frames: face
    89.1%, both-eyes 89.1%, eye boxes ~92–205 px.
  - Clip B (motion): encoded 1176 / decoded 1176 / 9.832 s / **119.50 fps**;
    identical PTS stats; 0/0/0 anomalies. MAD median 2.04, max 13.74
    (motion-responsive — encoder not freezing). ROI: face 92.2%,
    both-eyes 92.2%, eye boxes ~98–137 px.
  - Threshold finding: static-scene MAD noise floor ≈1.1–1.5 sits inside the
    pre-device ≤1.5 candidate band; zero exact-duplicate evidence (no 0.0
    MAD) in ~2350 comparisons. Motion control is the authoritative freeze
    check. Verdicts: **FRAME_PIPELINE_PASS**, **EYE_ROI_PASS**. Full tables:
    `docs/device-probes/P2_FRAME_DECODE_EYE_ROI.md`. Recordings/frames/crops
    remain on-device (app-private cache), never committed.
- P2 COMPLETE. P3 (pupil centroid tracking) is technically unblocked but not
  started.

## P3 — Pupil detection + centroid prototype (COMPLETE, verified on-device)

- New Android-only module `modules/expo-pupil-detector` (Kotlin, autolinked,
  dependency-free: no OpenCV, no ML Kit, no ML model). One offline call
  `analyzeVideoPupils(filePath, detectorId, saveOverlays, requestsJson)`
  replays the P2-style MediaExtractor + MediaCodec decode in a single
  sequential pass, copies exact Y-plane luminance for requested frames only
  (no JPEG round-trip in the measurement path), and localizes the pupil per
  eye ROI immediately (one frame held at a time). Debug overlays (ROI crop +
  candidate box + centroid crosshair + confidence/failure label) go to
  device-local cache `pupildebug/` — never git.
- Two lightweight candidates behind one detector interface:
  `percentile-dark` (blur → 12th-percentile dark gate → components → evidence
  scoring) and `contrast-normalized` (percentile contrast stretch → gate +
  morphological open → same machinery, shape-heavy weights). Scoring evidence:
  darkness, area prior, bbox-fill/aspect ellipse proxy, centrality, border
  contact penalty, surround contrast. Explicit failures (`NO_FACE`,
  `NO_EYE_ROI`, `EYE_CLOSED_OR_OCCLUDED`, `NO_PUPIL_CANDIDATE`,
  `AMBIGUOUS_CANDIDATES`, `LOW_CONFIDENCE`, `INVALID_GEOMETRY`) always carry
  null centroids — never fabricated. A background-subtraction variant was
  dropped during synthetic checks (it cancels large uniform pupils).
- TS domain `src/eyetracking/pupil/` (`pupilTypes`, `coordinates`,
  `detectors`, `pupilReport`): explicit frame/ROI/normalized semantics, full
  float precision, image-space side labels (mirroring unresolved, documented).
  37/37 synthetic logic checks pass (centroid, transforms, scoring, failures,
  rotation mapping, verdict gates). Orchestration (`src/camera/pupilDetector.ts`)
  yields one result per sampled eye slot (upstream misses → TS-side
  `NO_FACE`/`NO_EYE_ROI`). Debug UI `PupilValidationScreen` (FRONT 1080p120
  default, both detectors, manual visual-audit toggle) wired into Home.
  Shared `src/camera/fixedModes.ts` extracted (behavior-identical); all debug
  screens gained 160 px bottom clearance (system nav bar covered buttons).

## Verification (P3, on-device — Xiaomi 2312DRA50G / Android 13 / API 33)

- `npm run check` (typecheck + lint) — pass. `npx prettier --check .` — pass.
- Synthetic logic checks (node, compiled tsc output) — 37/37 pass.
- `npx expo prebuild --platform android` — pass (all four native modules
  autolinked).
- `:app:assembleDebug` BUILD SUCCESSFUL (JDK 21).
- On-device validation — DONE (FRONT 1920×1080 `[120,120]`, 7 × ~10 s clips:
  center/left/right/up/down/blink/head-move; temp auto-run harness reverted,
  final manual APK rebuilt + launch-verified). 80 eye slots per condition per
  detector (40 frames × 2 sides), 560 per detector: **percentile-dark
  330/560 = 58.9%**, **contrast-normalized 334/560 = 59.6%**; core poses
  (center/left/right/down) 71–88% per condition; `up` ~40–44%, `blink`
  15–20%, `head-move` ~34–36% — all failing honestly (lid occlusion, closed
  eyes, motion blur). Per-side coverage is balanced (L ≈ R within 2.5pp).
  Visual audit of 16 representative overlays: every success crosshair falls
  on the pupil, every failure is marker-free. Verdict: **PUPIL_DETECTION_PASS**
  (feasibility, not validated gaze accuracy — no ground truth yet). Baseline:
  `percentile-dark` (simpler, fewer ambiguous outcomes). Full tables:
  `docs/device-probes/P3_PUPIL_DETECTION.md`. Recordings/frames/crops stay
  on-device (app-private cache), never committed.
- P3 COMPLETE. P4 (tracking continuity / confidence / robustness) is
  technically unblocked but not started.

## P3.5 — Live front-camera preview + framing guidance (COMPLETE, validated on-device 2026-10-02)

- Same `expo-camera2-high-speed` Kotlin module, additive only (P1 one-shot
  path untouched; `cameraOwner` enforces preview XOR one-shot). New native
  view `ExpoCamera2HighSpeedPreview` (TextureView): owns the preview Surface
  (default buffer 1920×1080 so it satisfies HS requirements); module runs ONE
  constrained session [preview + idle recorder] at fixed [120,120];
  `recorder.start()` begins a take with no session change (preview never
  drops); stop re-prepares + recreates the session around the same preview
  surface. Surface-destroy / unmount / module-destroy all force-close (no
  camera leaks). Framing sampler: ~2 Hz ML Kit FAST face pass on downscaled
  transformed-DISPLAY `getBitmap()` snapshots (never P3 pupil code, never
  120fps); boxes emitted directly as DISPLAY view fractions. Transform =
  centered TextureView CONTENT → DISPLAY cover correction over the
  platform-oriented/mirrored surface (front mirror preserved exactly once);
  TS `buildTextureViewMatrix` lockstep, `buildPreviewMatrix` is the
  DISPLAY → ANALYSIS audit mapping only. Framing states + 3-sample
  stabilizer in `src/eyetracking/framing.ts` (UX gates only). Debug UI
  `LivePreviewValidationScreen` (Home entry): open → live preview → guide →
  READY-gated 10 s record (logged override available) → auto P2-decode
  regression panel + transform audit. Full results + three verdicts:
  `docs/device-probes/P3_5_LIVE_PREVIEW.md`.

## Verification (P3.5, on-device — Xiaomi 2312DRA50G / Android 13 / API 33)

- `npm run check` (typecheck + lint) — pass. `npx prettier --check .` — pass.
- Synthetic logic checks (node, compiled tsc output) — pass
  (`scripts/p35LogicCheck.ts`: matrix math, cover/centering/aspect,
  rotation/mirror order, classification priority, eye-visibility rules,
  stabilizer debouncing).
- `npx expo prebuild --platform android` — pass (view autolinked from the
  same module; no config change needed).
- `:app:assembleDebug` BUILD SUCCESSFUL (JDK 21).
- Validation found + fixed 4 P3.5 bugs (JS view-manager arity, missing view
  style → no surface, transform-before-layout → letterbox bars, DISPLAY →
  BUFFER inverse replaced by CONTENT → DISPLAY correction); rebuilt +
  reinstalled + re-validated (see device doc + alignment-fix section below).
- On-device 2026-10-02, FRONT 1920×1080 `[120,120]`, 2× ~10 s takes (no app
  restart between; unmount → re-enter → reopen verified): preview visible,
  upright, fills box, natural mirror, persists through recording; all
  framing states triggered, READY practical, stabilizer flicker-free.
  - Take #1: encoded 1202 / decoded 1202 (1:1) / 10.050 s / **119.50 fps**;
    median 8.333 / p95 8.478 ms; 0/0/0 anomalies (matches P2 baseline).
  - Take #2: encoded 1198 / decoded 1198 (1:1) / 10.083 s / **118.71 fps**;
    median 8.333 / p95 8.478 ms; 0/0 non-monotonic/dup, 3 isolated large
    gaps (25/25/42 ms, ~8 frames, investigated: no freeze — sharp moving
    frames, 1:1 decode, ordinary encoder jitter, not a blocker).
  - Verdicts: **LIVE_PREVIEW_PASS**, **FRAMING_GUIDANCE_PASS**,
    **HIGH_SPEED_REGRESSION_PASS**. Recordings/frames/screenshots stayed
    local, never committed.
- P3.5 COMPLETE. P4 (tracking continuity / confidence / robustness) is
  technically unblocked but not started.

## P3.5 preview alignment fix (2026-10-02)

- Replaced the incorrectly applied DISPLAY → BUFFER inverse with a centered
  TextureView CONTENT → DISPLAY correction. Android already sensor-orients
  and front-mirrors preview surfaces; FRONT keeps that mirror exactly once.
  Rear preview stays unmirrored; live Camera2 metadata supplies orientation
  and lens facing. Recording/decoded analysis pixels are unaffected.
- Native child uses Android layout; RN preview fills its container absolutely;
  surface resize restores the high-speed buffer dimensions. Framing reads
  transformed DISPLAY snapshots directly, with one bounded in-flight pass and
  complete bitmap recycling. Opening/closing clears stale overlay state.
- `npm run check`, `npx prettier --check .` — pass.
- P3.5 logic checks — 52/52 pass, including 480 camera/view/rotation/mirror
  configurations testing coverage, centering, aspect, and Android matrix order.
- `:app:assembleDebug` (JDK 21, arm64) — BUILD SUCCESSFUL.
- APK installation + final manual app launch — pass on Xiaomi 2312DRA50G.
  Native geometry/session smoke — pass on FRONT 1920×1080 `[120,120]`:
  TextureView 1124×1320 px matches RN 374.667×440 dp at density 3;
  centered, all four display corners covered; native/TS matrix max error
  0.0000272. Both first open and reopen configure successfully; closing
  releases the session/owner. Framing delivered 7 DISPLAY samples
  (480×563 px, 2 face detections). Temporary JS auto-open harness restored
  byte-for-byte before final manual launch; no camera pixels exported.
- Manual visual/selfie-direction, READY guidance, and recording-regression
  verdicts remain pending; numeric geometry smoke is not those verdicts.

## Camera controls / UI upgrade (2026-10-05)

- Vietnamese Home cards, back navigation, accessible action buttons, compact
  camera/exercise selectors, processing states, result summaries and device-local
  image viewer. Technical diagnostics remain available under expandable details.
- P1/P2/P3/manual P4 share live preview/framing, a cancellable 3-second countdown,
  elapsed recording feedback, early stop/save and release on unmount/background.
  Captured metadata stays attached to its result when selection changes. Home
  opens manually; it no longer triggers the temporary P4 auto-run flags.
- Fixed native stop/cancel requests waiting behind the blocking recording on
  Expo's default module queue. Atomic flags dispatch independently; real batched
  CaptureResult timings are included in preview recording reports for P1.
- `npm run check`, changed-source Prettier check, P3.5 52/52 logic checks — pass.
  JDK 21 arm64 Android build and installation — pass on Xiaomi 2312DRA50G.
- Device regressions: countdown cancellation, front early stop, rear 720p240,
  close/reopen/background release, real P1/P2/P3/P4 capture-to-result handlers,
  P3.5 repeat recording + 1:1 decode, probe and picker layout — pass. P4 offline
  analysis took about 4 min 53 s for this 10-second run; UI reports processing.
  Evidence and acceptance limits: `docs/device-probes/CAMERA_UX_REGRESSION.md`.
- All temporary test routing/effects were restored before final manual Home launch.

## Pupil Tracking Robustness — 2026-10-05

- Completed the existing P4 implementation: full-rate offline tracking,
  per-eye confidence/loss/recovery states, PTS ROI interpolation, ROI-relative
  head-motion priors, protected blink/loss slots, fresh measured rescue only,
  strict timestamp/geometry checks and no gap filling. Removed temporary
  autorun/replay routes; existing camera controls remain integrated.
- Xiaomi regression replay: 1208 frames / 2416 eye slots, 70.70% valid overall,
  242 reacquisitions, 9 accepted rescues; no fabricated coordinates reported.
  Controlled long-occlusion and visual-audit acceptance remain unverified.
- Details and limits: [P4 evidence](device-probes/P4_TRACKING.md).

## Stimulus Engine — 2026-10-05

- Added deterministic horizontal Smooth Pursuit and stepwise Horizontal Saccade,
  10 s configuration, monotonic timelines, committed-target logs, stop/background/
  unmount cancellation, native clock bridge and decoded-PTS joins. Versioned
  metadata is saved in app-private cache with viewport and capture references.
- Final Xiaomi runs: Pursuit 1202 decoded frames / 497 target commits; early-stop
  Saccade 280 frames / 122 commits. PTS strictly increasing, no missing timestamps;
  both files and metadata read back. Camera/encoder exposure mapping remains
  estimated; physical display onset has not been measured.
- `npm test` covers P3/P3.5/P4/stimulus regressions. Native JDK 21 arm64 build,
  APK install and production-screen device runs passed.
- Contracts: [Stimulus Engine](STIMULUS_ENGINE.md); measured results:
  [device validation](device-probes/STIMULUS_ENGINE.md).
- Scope ends here. Calibration, Signal Processing, clinical metrics and subsequent
  phases remain unimplemented.

Final clean-tree verification: `npm run check`, `npm run format`, all four
`npm test` suites, Android Metro export and JDK 21 `:app:assembleDebug` passed.
Manual Home launch on Xiaomi shows the new stimulus entry and opens no camera;
Android camera service reports no active client after cleanup. No test harness remains.

## Calibration + Signal Processing — 2026-10-05

- Implemented per-eye ROI-normalized calibration with nine fit targets,
  four independent checks and repeated center; separate stationary recordings
  avoid assuming a moving-target exposure offset. Coverage/fixation/PTS/geometry/
  head-ROI/held-out gates fail closed to RETRY. Versioned mapping and quality
  persist locally; retry/cancel invalidates stale results. Reuse checks camera,
  viewport dimensions/origin, expiry and per-frame ROI stability.
- Recorded eye exercises require usable calibration. Signal Processing preserves
  raw detector/tracker/normalized observations, filters only observed samples,
  rejects conservative weak isolated spikes, splits missing/blink/dropout/PTS
  gaps and computes confidence-bearing velocity from actual PTS. No interpolation
  or nominal frame interval is used; no clinical or Pursuit/Saccade metric added.
- Xiaomi: all 14 target recordings saved, 2,526 encoded/decoded frames, 5,052 eye
  slots. Calibration correctly RETRY: held-out RMSE left/right 0.2328/0.2855
  viewport fraction, plus insufficient coverage and head/ROI changes. Signal
  coverage remains 68.4%/75.7%; median same-support noise proxy falls
  0.003911→0.001404 / 0.003981→0.001518, with zero fabricated/interpolated samples.
- Six execution suites, `npm run check`, `npm run format`, final Android Metro
  export and JDK 21 arm64 native build passed. Latest pure-domain code was also
  replayed on all 5,052 real eye slots: raw unchanged, RETRY unmappable, no
  cross-gap derivative. New Kotlin persistence compiled and initial APK installed;
  the artifact survived ADB reconnection and read-back.
- Screen-awake support preserves a pre-existing window flag and releases its
  own flag on completion/background/unmount. The final APK installed on Xiaomi
  on 2026-10-06; all 16 actual window-flag checks passed, including repeated
  enable/release, prior-owner preservation, background/resume and busy unmount.
  Temporary test effects were removed; App.tsx is restored to manual Home.
- Successful supervised calibration, accuracy across sessions/lighting and
  controlled blink/multi-second occlusion remain unverified. Offline processing
  took about 6 min 25 s for the 14 recordings; detector false locks and filter
  effects on fine dynamics remain limitations.
- Contracts: [Calibration and signals](CALIBRATION_SIGNALS.md). Full measured
  evidence: [Xiaomi validation](device-probes/CALIBRATION_SIGNALS.md).
- Scope stops here; metrics, clinical thresholds, interpretation and diagnosis
  remain unimplemented.

Follow-up verification: fixed an async screen-awake ownership race found during
review. A shared coordinator serializes native writes and aggregates active
owners; completion of a disposed effect cannot clear a newer run's flag. Added
five deferred lifecycle/failure execution cases. All seven suites, typecheck,
lint and Android export pass.

Runtime follow-up — 2026-10-06: wireless ADB pairing restored; final APK install
and manual Home launch passed. Home displays entries 07/08 and opens no camera.
Native Camera2 probe returned BACK 0 and FRONT 1 without errors. The existing
9,287,041-byte RETRY artifact survived the update byte-for-byte;
`loadCalibration()` returned null. No new calibration/trajectory measurements
were collected; the measured quality and remaining limits above are unchanged.

## Smooth Pursuit + Horizontal Saccade — 2026-10-06

- Completed these two existing stimulus exercises through P4 tracking, per-eye
  calibration, processed signals and engineering results. Pursuit: smooth
  velocity harmonic gain, tracking RMSE and bracketed rapid/catch-up candidates.
  Horizontal Saccade: actual committed steps, baseline/response validity,
  commit-relative latency (explicit estimate with current camera anchor), sampled
  peak velocity/raw comparison, primary accuracy and endpoint over/undershoot.
- Results show per-eye tracking and calibrated support separately, GOOD_DATA /
  POOR_DATA / INVALID, explicit response failures, units and JSON provenance.
  No diagnosis/clinical cutoffs, new test type, patient/session database or report
  subsystem. Existing raw/signal/timeline artifacts are reused. Normal capture
  retains its calibration guard; explicit debug capture can save an INVALID run.
- Xiaomi: two completed 10-second real captures, 1,202 encoded/decoded frames
  each, 119.504 FPS, no missing/reversed PTS. Pupil signal coverage L/R:
  Pursuit 19.3%/20.4%; Saccade 40.8%/67.6%. Calibration remains RETRY; both
  tests correctly INVALID, calibrated metrics N/A, Saccade 0/9 eligible responses
  per eye. These are not measured physiological failures or successful gaze
  validation. All 4,808 real eye slots replay without fabricated positions,
  interpolation, cross-gap derivatives or changes to saved raw/processed data.
- Metrics pass controlled synthetic references, including fitted calibration
  through both exercises; nine regression suites cover P1/P2, P3/P3.5/P4,
  stimulus, calibration, signals, screen-awake and 31 eye-test check groups.
  Synthetic Saccade: 199.9 ms median latency, 14.000 viewport fractions/s peak,
  accuracy 1.000. Successful calibrated human metrics, visual degrees, physical
  onset, external gaze accuracy and controlled device blinks remain unverified.
- Definitions: [Eye-test contracts](EYE_TESTS.md). Actual measurements and final
  validation: [Xiaomi evidence](device-probes/EYE_TESTS.md).
- Scope stops after these two tests; all other requested exclusions stay untouched.

Final verification: `npm run check`, `npm run format`, all nine `npm test` suites
(31 eye-test groups), Android Metro export and JDK 21 arm64 native build passed.
Final APK reinstalled successfully; manual Home has the two-test entry, no active
camera client and no temporary harness. Original RETRY calibration survives
byte-for-byte; final metric JSON artifacts were saved and read back on-device.

## Eye-test robustness follow-up — 2026-10-07

- Fixed Saccade onset confirmation counting two samples instead of elapsed PTS:
  valid sustained 240-fps responses previously all became NO_RESPONSE. Actual
  duration now accumulates without crossing blink/dropout or a target step.
- Fixed false reversals from mixed raw/filtered edges of rapid movement. Protect
  the whole local motion window while preserving raw, missing slots and segments.
- Calibration mapping validates/copies models once per replay, retaining all
  per-frame guards. Node benchmark on a synthetic VALID model, 2,404 observations,
  median of 25 warmed runs: 9.300 → 0.123 ms; coordinates identical. This measures
  mapping only, not the native/offline pipeline runtime.
- Reconcile native results per requested eye slot: missing/duplicate/invalid
  identity cannot inflate coverage. Actual P3 decoded PTS must match requested
  P2 PTS; mismatch is rejected and warnings retained in debug artifacts.
- Re-measure target dimensions/origin after countdown and prepare asynchronously
  before recorder start, with cancellation checked again after preparation.
- Eleven regression suites (33 eye-test groups), strict type/lint and Android
  native build pass. Xiaomi rejects an injected 1 µs PTS mismatch and a viewport
  resize during countdown; stable async preparation still records successfully.
  Full native replay preserves all 2,404 original PTS/failure/centroid/confidence
  outcomes from the stored 1,202-frame Saccade clip, with zero warnings/errors.
  Both actual eye tests remain INVALID because the calibration is RETRY; no new
  valid human gaze metrics or expanded feature scope is claimed. Details:
  [follow-up evidence](device-probes/EYE_TESTS.md#robustness-follow-up-2026-10-07).

## User calibration recheck — 2026-10-07

- Read the newly recorded 14-target artifact: 2,523 encoded/decoded frames,
  result `cal-1791346355283`, **RETRY**. Calibration accepted coverage is 73.3%
  left / 9.1% right; left held-out RMSE 0.3885 exceeds the 0.08 viewport gate,
  and right has no eligible model. No usable gaze or eye-test metric is claimed.
- Found and fixed a viewport race: measuring immediately after queued scroll
  saved `viewportTop=-201`. Wait for native scroll completion and stable visible
  geometry, use measured dimensions, lock scrolling and recheck each take.
  Xiaomi preflight reproduced top -179 and correctly measured 114.67 after scroll.
- All 5,046 real eye slots pass integrity replay; original artifact hash unchanged.
  Twelve regression suites, strict type/lint, formatting, Android export and native
  build pass. Manual Home restored; temporary QA effects removed.
  Details: [new calibration evidence](device-probes/CALIBRATION_SIGNALS.md#user-calibration-recheck--2026-10-07).

## Batch 3 offline review — 2026-10-08

- Scope remains Calibration, Smooth Pursuit and Horizontal Saccade. No Batch 4.
  Phone/remote/ADB access is prohibited; this batch used only computer evidence.
- Fixed bounding-box contamination of connected-component centroid/confidence
  in TS and Kotlin and contrast-domain weights. Pure stateless native CV core is
  shared with independent checks. Measurement version v2 blocks stale models.
- Strict measured ROI/PTS bracketing and full decoder integrity now fail closed.
  Per-target diagnostics distinguish detector, tracking and calibration loss.
- Added an independent APK, 15 JS / seven native self-checks, manual physical
  three-stage flow, and allowlisted local JSON export. Reliable metric fields
  are null unless current VALID calibration and GOOD_DATA both hold.
- Fourteen regression suites, native CV JVM checks, typecheck/lint/format and
  standalone build/binary verification pass. Local replay preserves 9,854 real
  eye slots; both old eye tests remain INVALID. Original calibration unchanged.
- Latest human calibration remains RETRY (left/right coverage 73.3%/9.1%, left
  validation RMSE 0.3885, no right model). No new reliable metrics are claimed.
  Xiaomi runtime, export and new supervised recordings are pending owner testing.
  [Instructions](BATCH3_VALIDATION.md) · [findings](device-probes/BATCH3_OFFLINE_REVIEW.md).

## Development Build workflow repair — 2026-10-08

- Reused EAS development profile, existing Android package/key and four Kotlin
  modules. Added missing SDK-compatible `expo-dev-client` and launcher plugin;
  updated Expo 57.0.24 → 57.0.27 within SDK 57 for dependency compatibility.
- `npm start` explicitly serves Metro over LAN with the development QR.
  Default Expo Metro/Babel already provides Fast Refresh. Android build scripts
  share local Gradle compilation; `npm run android` is now build-only.
- Development APK has the Expo launcher, registered `exp+vestibular-screening-aid`
  scheme, debug flag and LAN HTTP/network permission. Offline Batch 3 remains
  non-debuggable with an embedded bundle and no Internet permission. Both use
  the same package/signature and replace each other on compatible installation.
- Strict check/format, 14 regression suites, native CV checks, Expo compatibility
  and 21/21 expo-doctor checks pass. Both APK builds/binary checks pass. Local
  Metro manifest/bundle and an actual HMR module update to a loopback client pass;
  the temporary source edit was restored. QR PNG decodes to the CLI launch URL.
- No ADB, Wireless Debugging, remote inspection/control, device install/launch
  or new physical measurement. The owner must verify Redmi APK installation,
  LAN/QR opening and visible Fast Refresh. Calibration/test verdicts are unchanged.
  [Install, QR and rebuild rules](DEVELOPMENT_BUILD.md). Scope stops before Batch 4.

Workflow clarification: the default physical-test download is now the single
standalone `artifacts/phone/vestibular.apk`, copied/checksummed by the shared build
script. Running it needs no Metro/8081; the transfer server is needed only to
download the update. Development Build remains optional for Fast Refresh.
Camera2 missing-module guidance now identifies the wrong/incomplete app binary
on Home and in the camera seam, without changing native/quality gates. No phone
access or new physical measurement was performed. Stock Expo tunnel was not used
because the installed CLI attempts ADB reversal; documented LAN remains available.

2026-10-08 computer verification of this clarification: typecheck/lint/format and
all 14 logic suites passed; Batch 3 APK build and native JVM checks passed. Binary
inspection confirmed four custom Kotlin modules, embedded JS, valid signature,
no INTERNET permission and disabled backup. APK SHA-256:
`b51a80e8b963738fde1ee7d3e2c6fe0b0744ada34ddd43c76f2ee7a72d9da302`.
The shared build bounds Gradle workers to two on the 8 GiB Mac and publishes the
verified download alias atomically. Redmi installation/runtime remains pending.

2026-10-08 APK transfer follow-up: owner reports Redmi Chrome timeout. Mac IP,
listening server, local HTTP and allowed firewall rules checked successfully;
earlier interrupted inbound requests do not prove the owner's exact failure cause.
Published the same verified APK/checksum as a private GitHub prerelease
[batch3-6c6b088](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/batch3-6c6b088).
Authenticated HTTPS download/read-back SHA-256 matches the local APK. No repository
visibility change, raw/private evidence upload, phone access or app-code change.
HTTPS avoids the LAN dependency; owner GitHub sign-in/download/install remains a
physical handoff. Calibration/test status is unchanged, and Batch 4 remains closed.

2026-10-09 installation follow-up: owner reports `vestibular.apk`, 38 MB,
**không hỗ trợ loại tệp**; the app displaying that message is not yet confirmed.
Fresh authenticated GitHub download matches SHA-256 and 39,730,168-byte size.
ZIP integrity, binary manifest, embedded bundle, v2 signature and 16 KiB ZIP
alignment pass; minimum API is 24 and native ABI is arm64-v8a. These results
do not validate the phone's local copy or prove a particular installer failure.
APK verification now also checks single-package, minimum API, ABI and launcher.
Install guidance uses Xiaomi File Manager's APK category to reach Android's
installer. Native/app bytes are unchanged; physical installation remains pending.

Owner then clarified the exact flow: Zalo QR → GitHub sign-in → **APK kiểm thử
độc lập** → **The file type is not supported**. This establishes a Zalo/GitHub
file-opening failure, not a confirmed Android installer rejection. Corrected the
handoff to Chrome and direct binary download. A temporary GitHub CDN redirect was
tested without login: HTTP 200, `attachment; filename=vestibular.apk`, correct
APK MIME, 39,730,168 bytes and matching SHA-256. The direct QR passes independent
ZXing decoding. Only the asset-limited expiring link is handed to the owner;
account token and signed URL/QR remain outside Git. Repository/app bytes unchanged.
Phone Chrome download and installation remain owner checks; no phone access.

2026-10-09 owner confirms the APK downloaded and updated successfully. The
installation handoff is resolved by owner report; app runtime and physical
calibration/tracking quality are not yet verified. Next: Home **09 — Kiểm thử
Batch 3 độc lập**, run self-tests, then the physical Calibration → Pursuit →
Saccade workflow and export its anonymized technical JSON, including failed or
stopped stages. Until that evidence arrives, the last measured calibration remains
RETRY and no new reliable physical metrics are claimed. Batch 4 remains closed.

2026-10-09 technical-report review: owner supplied schema-1 build
`batch3-20261008-r1` after reporting self-test PASS and physical calibration capture.
The supplied JSON exactly matches `buildTechnicalReport({})`: 15 JS NOT_RUN,
seven native UNAVAILABLE, zero calibration targets/frames, both tests NOT_RUN,
no failure codes or reliable metrics. This does not disprove the owner's actions
or establish a missing native module. Code inspection confirms screen unmount
discarded the diagnostic snapshot, and a saved-calibration read exception could
discard completed checks. The report cannot identify which path occurred.

Schema-2 build `batch3-20261009-r2` distinguishes NOT_RUN from UNAVAILABLE,
retains independent check outcomes on storage failure, requires every expected
check to PASS, blocks empty exports and retains only the latest aggregate report
across screen navigation within one app process. Leaving capture records a
cancelled stage while the camera still unmounts; starting a new workflow resets
physical evidence. No model is restored from the report cache, no new disk/session
storage is added, and calibration/tracking/metric gates are unchanged. Fresh
physical calibration and both eye-test results remain unverified; Batch 4 closed.

Computer verification of r2: typecheck/lint/format and all 15 regression suites
PASS, including the unchanged 33 eye-test groups and 15 APK JS simulations.
Batch 3 APK/native build and seven production CV cases PASS. Binary checks confirm
the r2 embedded bundle, four custom modules, same signing certificate, no Internet
permission, disabled backup, ZIP integrity, v2 signature and 16 KiB alignment.
APK is 39,736,460 bytes; SHA-256
`d792e9140a44d16deb875e8a77dc3bca2d971e4685d419eea1278fdc62422ad1`.
Published only APK/checksum in the private
[r2 prerelease](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/batch3-20261009-r2),
targeting source commit `5a5c53d`. No other matching Batch 3 technical report was
found in Downloads. Physical export/navigation behavior and recovery of saved
calibration on the updated Redmi remain owner checks; no phone was accessed.
Anonymous HTTPS read-back matches the full APK size/SHA-256 with the expected
attachment filename and APK MIME. A temporary asset-only download QR passes
independent ZXing decoding; signed URL/QR and account credentials stay outside Git.
