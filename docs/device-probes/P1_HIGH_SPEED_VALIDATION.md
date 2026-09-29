# P1 high-speed validation — procedure + measured results

Device: Xiaomi `2312DRA50G` (garnet), Android 13 / API 33.
Capability baseline: `docs/device-probes/XIAOMI_2312DRA50G_ANDROID13.md` (P0.1).
Commit: P1 prototype + headless on-device runs 2026-09-29 (harness reverted;
shipped UI is fully manual).

## Procedure (per mode, ≈10 s each)

Dev Build on the Redmi (wireless ADB + `adb reverse`, Metro on `:8081`).
Home → **High-speed capture validation (P1)** → grant CAMERA → tap a
Camera2-advertised fixed mode → **Start 10s test** → read/copy the report.
Wireless-ADB shell lacks `INJECT_EVENTS` (and `pm grant`), so the four runs
below were driven by a temporary auto-run harness (auto-open screen,
auto-start one mode, log report to logcat), fully reverted afterwards —
`git status` clean, final APK rebuilt from the manual-only tree.

## Measured results (all sessions real constrained high-speed sessions)

| Mode | Session | Recording | Encoder (MediaExtractor) | CaptureResult callbacks |
|------|---------|-----------|--------------------------|-------------------------|
| 0 BACK 1920×1080 `[120,120]` | CONFIGURED | SUCCESS + file | 1144 samples / 9.867 s → **115.9 fps** | 571 @ 58.0 Hz, median 16.639 ms |
| 0 BACK 1280×720 `[120,120]` | CONFIGURED | SUCCESS + file | 1144 samples / 9.867 s → **115.9 fps** | 571 @ 58.0 Hz, median 16.639 ms |
| 0 BACK 1280×720 `[240,240]` | CONFIGURED | SUCCESS + file | 2232 samples / 9.848 s → **226.7 fps** | 556 @ 56.6 Hz, median 16.663 ms |
| 1 FRONT 1920×1080 `[120,120]` | CONFIGURED | SUCCESS + file | 1152 samples / 9.875 s → **116.7 fps** | 575 @ 58.3 Hz, median 16.737 ms |

No session failures, no camera errors, no disconnects; every run closed the
camera cleanly. No per-run errors.

## Key findings (Xiaomi/Camera2 limitations)

1. **Recording sustains the advertised rate** (encoder-side, the ground truth
   for eye-tracking frames): ≈116 fps for 120 modes, ≈227 fps for the 240
   mode — 3–6% under nominal, consistent with recorder start/stop transients.
2. **CaptureResult callbacks are throttled to ≈60 Hz** on garnet regardless of
   stream rate (120fps → every 2nd frame, 240fps → every 4th). Median cadence
   is exact (≈16.64 ms), so per-frame timing must come from the video frames
   (ImageReader/file timestamps), never from `onCaptureCompleted` alone.
3. The on-screen "Observed FPS / large gaps / estimated missing frames" are
   computed over the throttled callback stream — valid stability signal for
   that stream (jitter 2.6–5.8 ms stddev, max single gap 33–67 ms), NOT frame
   drops. Do not read them as dropped video frames.

## Raw report blocks (as produced on-device)

```text
Device: 2312DRA50G / Android: 13 / API 33
Camera 0 BACK 1920x1080 [120,120]: Session CONFIGURED, 9.83 s, 571 samples,
mean 17.252 ms, median 16.639 ms, p95 16.639 ms, max 66.556 ms,
observed (callback) 57.96 fps, recording SUCCESS, encoder 1144 samples.
Camera 0 BACK 1280x720 [120,120]: Session CONFIGURED, 9.83 s, 571 samples,
mean 17.252 ms, median 16.639 ms, p95 16.639 ms, max 49.917 ms,
observed (callback) 57.96 fps, recording SUCCESS, encoder 1144 samples.
Camera 0 BACK 1280x720 [240,240]: Session CONFIGURED, 9.80 s, 556 samples,
mean 17.654 ms, median 16.663 ms, p95 16.663 ms, max 66.651 ms,
observed (callback) 56.65 fps, recording SUCCESS, encoder 2232 samples.
Camera 1 FRONT 1920x1080 [120,120]: Session CONFIGURED, 9.84 s, 575 samples,
mean 17.145 ms, median 16.737 ms, p95 16.737 ms, max 33.473 ms,
observed (callback) 58.33 fps, recording SUCCESS, encoder 1152 samples.
```

## Recommendation (technical only, no clinical claims)

Proceed with **rear 1920×1080 @ fixed 120fps**: session configures reliably,
recording sustains ≈116 fps, and it keeps maximum spatial eye detail.
Keep 720p240 as the temporal-resolution benchmark. Next prototype needs a
frame-level path (ImageReader or file timestamps) since CaptureResult
callbacks arrive at ≈60 Hz on this device.

## P1 timing heuristic (as documented in code)

Expected T: 8.333333 ms @120fps, 4.166667 ms @240fps (ns internally).
Large gap: interval > 1.5×T. Estimated missing: Σ(round(dt/T)−1) over large
gaps — estimates, not proof. Raw `SENSOR_TIMESTAMP` arrays + session events
were captured per run.
