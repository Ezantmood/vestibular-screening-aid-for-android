# Physical-device Camera2 probe — Xiaomi 2312DRA50G / Android 13

Source of truth: raw Android Camera2 report from the read-only probe
(`modules/expo-camera2-probe`, P0.1), read on-device via
`CameraManager.cameraIdList` + `CameraCharacteristics` only.
Nothing here is inferred from Xiaomi's stock Camera app / slow-motion modes.

- Device: Xiaomi `2312DRA50G` (Redmi Note 13 Pro 5G, codename `garnet`)
- OS: Android 13 / API 33 (build `TKQ1.221114.001`)
- Captured: 2026-09-29, Expo Development Build, wireless ADB + `adb reverse`
- Probe commit: `4b33fbb`
- Cameras exposed by Camera2: `0`, `1`
  (`dumpsys media.camera` lists extra physical sub-cameras; Camera2 exposes
  the two logical cameras below.) No per-camera errors.

## Camera 0 — rear (BACK)

- camera ID: `0`
- lens facing: BACK
- hardware level: LEVEL_3
- sensor orientation: 90°
- normal AE FPS ranges (`CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES`):
  `[1, 5] [5, 5] [10, 10] [14, 14] [15, 15] [12, 24] [24, 24] [7, 30] [14, 30] [30, 30]`
- constrained high-speed capability
  (`REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO`): supported
- all high-speed resolutions (`getHighSpeedVideoSizes()`): `1280×720`,
  `720×480`, `640×480`, `1920×1080`
- exact FPS ranges per high-speed resolution
  (`getHighSpeedVideoFpsRangesFor(size)`):
  - `1280×720`: `[30, 120] [120, 120] [30, 240] [240, 240]`
  - `720×480`: `[30, 120] [120, 120] [30, 240] [240, 240]`
  - `640×480`: `[30, 120] [120, 120] [30, 240] [240, 240]`
  - `1920×1080`: `[30, 120] [120, 120]`

## Camera 1 — front (FRONT)

- camera ID: `1`
- lens facing: FRONT
- hardware level: LEVEL_3
- sensor orientation: 270°
- normal AE FPS ranges: `[10, 10] [15, 15] [12, 24] [24, 24] [10, 30] [30, 30]`
- constrained high-speed capability: supported
- all high-speed resolutions: `1280×720`, `720×480`, `640×480`, `1920×1080`
- exact FPS ranges per high-speed resolution:
  - `1280×720`: `[30, 120] [120, 120]`
  - `720×480`: `[30, 120] [120, 120]`
  - `640×480`: `[30, 120] [120, 120]`
  - `1920×1080`: `[30, 120] [120, 120]`

## Required evidence (strict reading: YES = fixed `[fps, fps]` advertised)

- 1920×1080 @ 120fps — rear: YES (fixed `[120, 120]` advertised);
  front: YES (fixed `[120, 120]` advertised)
- 1280×720 @ 120fps — rear: YES (fixed `[120, 120]` advertised);
  front: YES (fixed `[120, 120]` advertised)
- 1280×720 @ 240fps — rear: YES (fixed `[240, 240]` advertised);
  front: NO (not advertised — max range tops at `[30, 120]`)

## P0.1 verdict

Both rear and front camera results recorded from the raw Camera2 report.
P0.1 is complete. No tracking/recording was implemented (out of scope).
High-speed feasibility (actually opening/sustaining these modes) is P1 work.
