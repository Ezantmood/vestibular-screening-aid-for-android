# P1 high-speed validation — procedure + measured results

Device: Xiaomi `2312DRA50G` (garnet), Android 13 / API 33.
Capability baseline: `docs/device-probes/XIAOMI_2312DRA50G_ANDROID13.md` (P0.1).

## Procedure (per mode, ≈10 s each)

1. Dev Build on the Redmi (wireless ADB + `adb reverse`, Metro on `:8081`).
2. Home → **High-speed capture validation (P1)** → grant CAMERA when asked.
3. The screen lists only Camera2-advertised **fixed** `[fps, fps]` modes.
4. Tap a mode → **Start 10s test** → wait → read the validation report
   (long-press to copy the full text).

## Modes to test (from P0.1 data)

| #   | Camera  | Mode               | Fixed range  | Status                |
| --- | ------- | ------------------ | ------------ | --------------------- |
| 1   | 0 BACK  | 1920×1080 @ 120fps | `[120, 120]` | PENDING on-device run |
| 2   | 0 BACK  | 1280×720 @ 120fps  | `[120, 120]` | PENDING on-device run |
| 3   | 0 BACK  | 1280×720 @ 240fps  | `[240, 240]` | PENDING on-device run |
| 4   | 1 FRONT | 1920×1080 @ 120fps | `[120, 120]` | PENDING on-device run |

Front 1280×720 @ 240fps is NOT advertised (P0.1) and is therefore not
offered by the UI — nothing to test there.

## Results

Pending: over wireless ADB the shell lacks `INJECT_EVENTS`, so `input tap`
automation is rejected by the device and the capture runs need manual taps.
Code, build, install, and launch are verified (see `docs/STATUS.md`);
measured session/timing/recording results will be pasted here after the
manual runs — one report block per mode (session, duration, samples,
mean/median/p95/max interval, observed FPS, large gaps, estimated missing
frames, recording status, encoder cross-check).

## P1 timing heuristic (recorded here so reports stay honest)

- Expected interval T: 8.333333 ms @120fps, 4.166667 ms @240fps (ns internally).
- Large gap: interval > 1.5×T. Estimated missing frames: Σ(round(dt/T)−1)
  over large gaps. Noisy intervals can mimic drops — estimates, not proof.
- Raw `SENSOR_TIMESTAMP` arrays + session events are kept in every report.
