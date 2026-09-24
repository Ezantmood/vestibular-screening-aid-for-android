# Decisions

Recorded bootstrap decisions. Rationale is one line each; revisit only with new device/data constraints.

1. **Android-first** — single test device (Redmi Note 13 Pro 5G); avoids iOS camera-API divergence during MVP.
2. **React Native + TypeScript + Expo** — one codebase, OTA/Go iteration, strict types for clinical code paths.
3. **Expo Go for bootstrap, Expo Development Build later** — no custom native code yet; Dev Build (+ `eas.json`) reserved for Camera2 work.
4. **Kotlin for Android native modules** — Google-recommended, Camera2 samples/interop are Kotlin-first.
5. **Camera2 planned for high-speed capture** — stock Expo camera APIs don't guarantee high-fps/front-camera control; probe first (Phase 1).
6. **MVP = Smooth Pursuit + Horizontal Saccades** — smallest pair covering pursuit + saccadic systems; registry in `src/tests/registry.ts`.
