# Decisions

Recorded bootstrap decisions. Rationale is one line each; revisit only with new device/data constraints.

1. **Android-first** — single test device (Redmi Note 13 Pro 5G); avoids iOS camera-API divergence during MVP.
2. **React Native + TypeScript + Expo** — one codebase, OTA/Go iteration, strict types for clinical code paths.
3. **Expo Go for bootstrap, Expo Development Build later** — no custom native code yet; Dev Build (+ `eas.json`) reserved for Camera2 work.
4. **Kotlin for Android native modules** — Google-recommended, Camera2 samples/interop are Kotlin-first.
5. **Camera2 planned for high-speed capture** — stock Expo camera APIs don't guarantee high-fps/front-camera control; probe first (Phase 1).
6. **MVP = Smooth Pursuit + Horizontal Saccades** — smallest pair covering pursuit + saccadic systems; registry in `src/tests/registry.ts`.
7. **P0.1 probe = Android-only local Expo module, read-only** — `modules/expo-camera2-probe` (Kotlin, autolinked, no app.json plugin entry); TS loads it via `requireOptionalNativeModule` so Expo Go degrades to a Dev-Build hint. No CAMERA permission: verified against AOSP that all six probe keys are basic info, only lens/sensor calibration keys are permission-gated on API 29+.
8. **High-speed verdicts are strict, raw ranges authoritative** — a target fps counts as YES only with a fixed `[fps, fps]` range; matching only a range maximum is reported distinctly as UPPER, never as support.
9. **P1 capture = separate `expo-camera2-high-speed` module, probe stays read-only** — capture validates each mode against live Camera2 data natively (exact size + range match or reject); enumeration reuses the P0.1 probe.
10. **P1 recording = video-only MediaRecorder surface, no preview** — no audio source (no mic permission), app-private cache file; a preview SurfaceView is deferred as desirable-not-required.
11. **P1 dropped-frame counts are documented estimates** — large gap > 1.5×T, missing ≈ Σ(round(dt/T)−1); raw timestamps + session events ship in every report; MediaExtractor sample/duration cross-check is best-effort (nulls, never invented).
12. **P2 MVP camera = FRONT 1920×1080 @ fixed 120fps** — the self-contained mobile test has the user look at the phone display while the camera observes the eyes, so the front camera is the primary eye-tracking candidate. Rear 1080p120 / 720p240 remain technical benchmark modes, not the default clinical-test camera.
13. **~60 Hz CaptureResult cadence is observed Camera2/HAL callback behavior during constrained high-speed batching, not a proven Xiaomi hardware cap** — earlier notes called it a "Xiaomi limitation"; the sustained encoder-side rate (≈116 fps for 120 modes) shows video frames keep flowing, so `onCaptureCompleted` must never be used as the per-video-frame clock. Per-frame timing comes from decoded media PTS.
14. **P2 decode = MediaExtractor + MediaCodec frame-by-frame (no surface), luminance MAD duplicate check, ML Kit ROI behind an isolated interface** — never `MediaMetadataRetriever.getFrameAtTime` as primary; PTS values are labelled encoded/media PTS, never sensor exposure; MAD ≤ 1.5 (0–255, 96×54 Y grid) is a near-duplicate _candidate_ and 1.5–5.0 is low-motion (not a duplicate claim); ML Kit face/eye boxes are feasibility ROIs only, never pupil tracking, so OpenCV/custom pupil stages later reuse this decoder untouched.
