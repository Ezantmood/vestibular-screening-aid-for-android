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
  ≈227 fps for the 240 mode. Xiaomi limitation: CaptureResult callbacks are
  throttled to ≈60 Hz regardless of stream rate, so per-frame timing must
  come from video frames, not `onCaptureCompleted`. Full table + raw blocks:
  `docs/device-probes/P1_HIGH_SPEED_VALIDATION.md`. Wireless-ADB shell lacks
  INJECT_EVENTS/`pm grant`, so runs used a temporary auto-run harness
  (reverted; final APK rebuilt from the manual-only tree, reinstalled and
  launch-verified).
- Recommendation (technical): proceed with rear 1920×1080 @ fixed 120fps
  (reliable session, ≈116 fps sustained, max spatial detail); keep 720p240
  as temporal benchmark; next prototype needs a frame-level timing path.
