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
