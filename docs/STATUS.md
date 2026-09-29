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
