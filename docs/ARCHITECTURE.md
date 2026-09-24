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

## Future native seam (no code yet)

```
src/camera/CameraService (TS interface)
  └─ Phase 2+: Kotlin module (Camera2 API) via Expo Dev Build / config plugin
```

See `docs/PROJECT_SPEC.md` for scope, `docs/ROADMAP.md` for phase order.
