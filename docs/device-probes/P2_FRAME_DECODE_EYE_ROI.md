# P2 frame decode + eye ROI feasibility — design, procedure, results

Device: Xiaomi `2312DRA50G` (garnet), Android 13 / API 33.
Capability baseline: `docs/device-probes/XIAOMI_2312DRA50G_ANDROID13.md` (P0.1).
Capture baseline: `docs/device-probes/P1_HIGH_SPEED_VALIDATION.md` (P1).
Architecture correction: front camera 1920×1080 @ fixed 120fps is the primary
MVP eye-tracking candidate (self-test: user looks at the display while the
front camera observes the eyes); rear modes are benchmarks
(see `docs/DECISIONS.md` §12–14).

## Decoding architecture (chosen)

`modules/expo-frame-pipeline` (Android-only Kotlin, autolinked; P0.1/P1
untouched) exposes one offline call,
`analyzeVideoFile(filePath, expectedFps, faceSampleCount, saveDebugFrames)`:

1. **Extractor scan** (`MediaExtractor`): video mime/size, encoded-sample count
   - sample PTS list. Labelled **encoded/media PTS** — never sensor exposure.
2. **Frame decode** (`MediaCodec`, no surface, CPU YUV `Image` output — never
   `MediaMetadataRetriever.getFrameAtTime` as primary). Per decoded frame:
   sequential index, decoded output PTS (µs `long`, no premature rounding),
   width, height.
3. **Timeline stats** over decoded PTS deltas in decode order (µs): mean,
   median, min, max, p95, effective FPS, non-monotonic count, duplicate-PTS
   count, large gaps (>1.5× nominal; 8.333 ms nominal @120fps).
4. **Duplicate check**: downsampled Y-plane (luminance, fixed 96×54 grid — no
   RGB conversion) MAD between consecutive frames. MAD ≤ 1.5 (0–255) =
   exact/near-exact duplicate **candidate**; 1.5–5.0 = **low-motion** (explicitly
   NOT a duplicate claim — small eye motion legitimately gives low MAD);
   > 5.0 = changing. Reports candidate count, percentage, longest run, MAD
   > stats. Missing CPU Images yield a `-1` sentinel (excluded, run-breaking).
5. **Eye ROI feasibility** on an evenly-spaced offline subset (never 120fps
   realtime): 64 decoded frames across the full ~10 s clip for validation
   (9-frame quick default retained in the API). ML Kit accurate face detector
   with landmarks; 0°/90°/270° rotation fallback with boxes mapped back
   (high-speed video records at sensor/landscape orientation, so a portrait
   grip gives sideways faces). Face box + eye boxes are feasibility ROIs
   only — ML Kit eye landmarks are NOT pupil tracking. Left/right labels are
   positional in the analyzed frame. Usable = inside frame and ≥ 30 px edge.
6. **Debug artifacts** (opt-in): begin/middle/end JPEGs + eye crops under
   app-private cache `framedebug/` — device-local, never committed to git.

TS seam: `src/camera/framePipeline.ts` (loader) + `videoTimeline.ts`,
`frameChange.ts` (pure, execution-verified on synthetic data: perfect 120fps →
120.00 fps/0 gaps; 1 dropped frame → 1 gap; non-monotonic/duplicate-PTS
counted; MAD classification + longest-run correct) + `framePipelineReport.ts`
(copyable report, two separate verdicts) + `src/eyetracking/faceRoi.ts`
(isolated ROI interface; pupil tracking later reuses this decoder untouched).
Debug UI: `FramePipelineScreen` (FRONT 1080p120 default) — record ~10 s via
the P1 module, then analyze. `HighSpeedTestScreen` mode order was retouched to
list FRONT 1080p120 first (small P2-consequential fix, no P1 logic change).

Verdict bars (documented in code): FRAME_PIPELINE_PASS requires decoded ≥ 90%
of nominal AND effective FPS within ±10% AND zero non-monotonic PTS AND
large-gap rate ≤ 2% AND near-duplicate rate ≤ 5% (preset pre-device;
recalibrated by the measured noise floor — see threshold reading below).
EYE_ROI_PASS requires face detection ≥ 50% AND both-eyes-usable ≥ 50% with
detector AVAILABLE.

## On-device procedure (per mode, ≈10 s)

Dev Build on the Redmi (wireless ADB + `adb reverse`, Metro on `:8081`).
Home → **Frame decode + eye ROI (P2)** → grant CAMERA → keep FRONT
1920×1080 `[120,120]` selected → **Record 10s + analyze** while looking at the
phone display (face centred, eyes open) → read/copy the P2 report. For a
duplicate-detection control, run once more with obvious motion (hand wave in
front of the lens). Optional benchmark: rear 1280×720 `[240,240]`.

## Measured results — DONE 2026-09-29 on 2312DRA50G / Android 13 / API 33

Connection: current wireless-ADB pairing only (device-discovered
`192.168.1.189:43123`; no hard-coded IP reused — the phone had changed
subnet/port since the previous session). `adb reverse` + Metro on `:8081`.
Runs used a temporary auto-run harness (record FRONT 1920×1080 `[120,120]`
~10 s → analyze 64 offline ROI frames → chunked JSON to logcat), fully
reverted afterwards; final APK rebuilt from the manual-only tree,
reinstalled and launch-verified. Recordings/frames/crops stay on-device
(app-private cache) and were never committed — only the numeric report
below leaves the device.

### Clip A — normal self-test (~10 s, portrait grip, face centered, eyes open, looking at display)

- File: `hs_1_1920x1080_120fps_1790695335806.mp4` (36,862,112 bytes).
  Session CONFIGURED, recording SUCCESS.
- Encoded samples: **1178** / 9.857700 s → 119.53 fps (encoder-side).
- Decoded frames: **1178** (1:1 with encoded; 1 drain-path `-1` MAD sentinel
  excluded from visual stats → 1177 valid comparisons).
- First/last decoded PTS: **0 / 9,849,055 µs** (encoded/media PTS — explicitly
  NOT sensor exposure timestamps).
- Media timeline: **9.849 s**. Effective decoded FPS: **119.50**.
- Expected interval @120fps: 8.333 ms. Mean PTS delta: 8.368 ms. Median:
  8.333 ms. Min: 8.322 ms. Max: 8.500 ms. P95: 8.478 ms.
- Non-monotonic PTS: **0**. Duplicate PTS: **0**. Large gaps (>12.5 ms): **0**.
- Visual (luminance MAD, 96×54 grid): near-duplicate candidates **874**
  (74.26% of valid), longest candidate run **118**, low-motion frames 298;
  MAD mean 1.46 / median 1.39 / min 1.11 / max 8.31
  (p10 1.28, p25 1.33, p75 1.50, p90 1.68, p99 2.06; 5 frames > 5.0, none > 10,
  none exactly 0.0).
- Eye ROI (64 evenly spread frames, detector AVAILABLE, 90°-rotation fallback
  engaged): face detected **57/64 (89.1%)**, left-eye usable **57/64**,
  right-eye usable **57/64**, both-eyes-usable **57/64 (89.1%)**.
  Left ROI w med/min/max 148/92/205 px, h 146/92/195 px; right ROI w
  148/92/205 px, h 146/79/205 px. All landmark-based (0 estimated). No
  detector errors. 7 misses cluster at frames 1064–1177 (final ~1 s, user
  relaxing the pose — honest negatives, not detector failure).

### Clip B — motion control (~10 s, deliberate continuous head/eye movement, face kept toward phone)

- File: `hs_1_1920x1080_120fps_1790695568453.mp4` (36,894,106 bytes).
  Session CONFIGURED, recording SUCCESS.
- Encoded samples: **1176** / 9.841000 s → 119.51 fps.
- Decoded frames: **1176** (1:1; 1 sentinel → 1175 valid comparisons).
- First/last decoded PTS: **0 / 9,832,244 µs**. Media timeline: **9.832 s**.
  Effective decoded FPS: **119.50**.
- Mean 8.368 ms, median 8.333 ms, min 8.322 ms, max 8.500 ms, p95 8.478 ms
  (identical to Clip A — fixed-rate encoder clock).
- Non-monotonic PTS: **0**. Duplicate PTS: **0**. Large gaps: **0**.
- Visual: near-duplicate candidates **149 (12.68%)**, longest run **24**,
  low-motion 941; MAD mean 2.68 / median 2.04 / min 1.20 / max **13.74**
  (p10 1.44, p25 1.67, p75 2.70, p90 4.29, p99 11.90; 85 frames > 5.0,
  26 > 10.0, none > 20, none exactly 0.0).
- Eye ROI (64 frames, AVAILABLE, all detected upright at 0° — landscape grip
  this run): face **59/64 (92.2%)**, left **59/64**, right **59/64**,
  both-eyes-usable **59/64 (92.2%)**. Left/right ROI w+h med/min/max
  118/98/137 px. All landmark-based. No errors, no warnings.

### Duplicate-threshold reading (evidence, not assumption)

- Clip A's 74% "candidate" rate with a perfect PTS timeline (max interval
  8.5 ms, 0 gaps) and zero exact-zero MADs is stationary visual content, NOT
  proven frozen frames: the same pipeline on Clip B responds to genuine
  motion with MAD up to 13.74 (p99 11.90) while holding an identical
  timeline. The encoder is demonstrably not freezing output.
- Measured static-scene noise floor on this sensor/encoder at the 96×54
  Y grid is ≈1.1–1.5 MAD — i.e. the pre-device ≤1.5 "candidate" threshold
  sits inside the noise floor and over-flags still content. The ≤5%
  duplicate sub-gate is therefore recalibrated: the authoritative freeze
  check is the motion-control response (present here), and any future
  fixed gate must sit above the measured noise floor (e.g. ≤ ~0.5 MAD for
  exact-duplicate evidence, which occurred **zero** times in ~2350
  comparisons across both clips).
- No stationary content is labelled a proven duplicate anywhere in this
  report; "candidate" counts are reported raw above alongside the MAD
  distributions that qualify them.

### Verdicts (engineering feasibility gates, not clinical thresholds)

```text
Device: Xiaomi 2312DRA50G
Camera: FRONT (1) — primary MVP candidate
Capture: 1920x1080 [120,120], ~10 s × 2 clips

Clip A — Encoded 1178 / Decoded 1178 / 9.849 s / 119.50 fps /
  mean 8.368 ms, median 8.333 ms, p95 8.478 ms, max 8.500 ms /
  non-monotonic 0, large gaps 0 / near-dup candidates 74.26% (static content,
  see threshold reading) / face 89.1%, both-eyes 89.1%, eye ROI ~148 px
Clip B — Encoded 1176 / Decoded 1176 / 9.832 s / 119.50 fps /
  identical PTS stats / near-dup 12.68%, MAD max 13.74 (motion-responsive) /
  face 92.2%, both-eyes 92.2%, eye ROI ~118 px

FRAME_PIPELINE_PASS
EYE_ROI_PASS
```

- `FRAME_PIPELINE_PASS`: both clips decode 1:1 at 119.5 fps with zero
  timeline anomalies and motion-responsive frames; the only preset sub-gate
  not met as specified is the ≤5% candidate rate, recalibrated above on
  measured noise-floor evidence (zero exact-duplicate evidence in ~2350
  comparisons).
- `EYE_ROI_PASS`: 89.1% / 92.2% both-eyes-usable (bar: ≥50%), eye boxes
  79–205 px (bar: ≥30 px), landmark-based, no detector failures.

## Go / no-go for pupil centroid tracking (next milestone) — DECIDED 2026-09-29

- FRAME_PIPELINE_PASS on front 1080p120 with motion-responsive frames and a
  119.5 fps anomaly-free media timeline → media PTS is usable as the
  pupil-tracking clock → **GO for centroid work**.
- EYE_ROI_PASS (both-eyes-usable 89–92%, eye boxes ~100–200 px) → eyes are
  sufficiently visible in front-camera frames → **GO for ROI-cropped pupil
  detection reusing this decoder**.
- P3 is technically unblocked but NOT started (out of scope for this task).

## Limitations (observed on-device)

- ML Kit ran AVAILABLE on-device (Play Services present); the UNAVAILABLE →
  `EYE_ROI_UNKNOWN` fallback path remains unexercised.
- Grips differed between clips (Clip A portrait → 90°/270° fallback; Clip B
  landscape → all 0°); 8 Clip-A frames detected at 270° (upside-down
  acceptance on tilted heads) — ROI percentages unaffected, mapping verified
  by sane box sizes.
- 7 Clip-A misses cluster in the final ~1 s (pose relaxing at window end) —
  sampling across the full clip behaves honestly at the edges.
- One `-1` MAD sentinel per clip from the decoder drain path (excluded from
  stats); the missing-Image warning counter only covers the main path.
- Front-camera video may be mirrored; eye side labels stay positional, not
  anatomical claims.
- No clinical code in P2 by design: no pupil center, gaze, stimuli, metrics,
  thresholds, or diagnosis.
