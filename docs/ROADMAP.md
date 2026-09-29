# Roadmap

## Phase 0 — Bootstrap (done)

Expo TS scaffold, domain folder structure, HomeScreen boot check, lint/type tooling, docs. No clinical/native code.

## Phase 1 — Camera2 capability probe (done as P0.1; see docs/STATUS.md)

On the Redmi Note 13 Pro 5G, probe Camera2: available resolutions, fps ranges (esp. ≥120 fps), front-camera limits, and whether Expo Go suffices. Output: short capability report + go/no-go for Dev Build. No tracking yet.

## Phase 2 — Dev Build + native camera seam

EAS Development Build, Kotlin Camera2 module behind `CameraService`, frame pipeline to TS.

## Phase 3 — MVP tests

Stimulus UI + recording + signal processing + metrics for Smooth Pursuit and Horizontal Saccades, plus local storage/reporting.

## Phase 4 — Validation & hardening

Repeatability checks, UX on device, clinical review. No diagnosis claims.

Do not start Phase 1+ until asked. Update `docs/STATUS.md` as phases move.
