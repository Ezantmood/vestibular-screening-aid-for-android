# Roadmap

## Phase 0 — Bootstrap (done)

Expo TS scaffold, domain folder structure, HomeScreen boot check, lint/type tooling, docs. No clinical/native code.

## Phase 1 — Camera2 capability probe (done as P0.1; see docs/STATUS.md)

On the Redmi Note 13 Pro 5G, probe Camera2: available resolutions, fps ranges (esp. ≥120 fps), front-camera limits, and whether Expo Go suffices. Output: short capability report + go/no-go for Dev Build. No tracking yet.

## Phase 2 — Dev Build + native camera seam

EAS Development Build, Kotlin Camera2 module behind `CameraService`, frame pipeline to TS.

## Phase 3 — MVP tests

Stimulus UI + recording + signal processing + metrics for Smooth Pursuit and Horizontal Saccades, plus local storage/reporting.

### Phase 3.5 — Live preview + framing (COMPLETE, validated on-device 2026-10-02)

Front-camera live preview inside the high-speed session + framing/READY gate:
LIVE_PREVIEW_PASS, FRAMING_GUIDANCE_PASS, HIGH_SPEED_REGRESSION_PASS on the
Redmi (take #1 119.50 fps clean; take #2 118.71 fps with 3 small isolated
gaps investigated, not a freeze). See `docs/STATUS.md` and
`docs/device-probes/P3_5_LIVE_PREVIEW.md`. P3 stays complete; P4 not started
(technically unblocked).

## Phase 4 — Validation & hardening

Repeatability checks, UX on device, clinical review. No diagnosis claims.

Do not start Phase 1+ until asked. Update `docs/STATUS.md` as phases move.
