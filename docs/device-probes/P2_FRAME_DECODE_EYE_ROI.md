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
5. **Eye ROI feasibility** on a small evenly-spaced offline subset (default 9
   frames — never 120fps realtime): ML Kit accurate face detector with
   landmarks; 0°/90°/270° rotation fallback with boxes mapped back (high-speed
   video records at sensor/landscape orientation, so a portrait grip gives
   sideways faces). Face box + eye boxes are feasibility ROIs only — ML Kit
   eye landmarks are NOT pupil tracking. Left/right labels are positional in
   the analyzed frame. Usable = inside frame and ≥ 30 px edge.
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
large-gap rate ≤ 2% AND near-duplicate rate ≤ 5%. EYE_ROI_PASS requires face
detection ≥ 50% AND both-eyes-usable ≥ 50% with detector AVAILABLE.

## On-device procedure (per mode, ≈10 s)

Dev Build on the Redmi (wireless ADB + `adb reverse`, Metro on `:8081`).
Home → **Frame decode + eye ROI (P2)** → grant CAMERA → keep FRONT
1920×1080 `[120,120]` selected → **Record 10s + analyze** while looking at the
phone display (face centred, eyes open) → read/copy the P2 report. For a
duplicate-detection control, run once more with obvious motion (hand wave in
front of the lens). Optional benchmark: rear 1280×720 `[240,240]`.

## Measured results (primary test)

**Status: PENDING.** The Xiaomi was unreachable over ADB during this session
(no USB device, no `_adb-tls-connect` mDNS advertisement on the LAN, prior
wireless IP `192.168.1.77:5555` not answering), so no on-device numbers were
captured and none are invented here. Code is complete and host-verified
(typecheck + lint + prettier + prebuild + `:app:assembleDebug` BUILD
SUCCESSFUL under JDK 21; pure timeline/duplicate/verdict logic
execution-tested on synthetic data — see STATUS). Paste the on-screen P2
report below when the device run completes:

```text
(paste P2 report here — Device / Encoded samples / Decoded frames /
Media timeline / Effective decoded FPS / PTS deltas / Non-monotonic PTS /
Large gaps / Near-duplicate candidates / Face detection rate / Verdicts)
```

## Go / no-go for pupil centroid tracking (next milestone)

- FRAME_PIPELINE_PASS on front 1080p120 with duplicate % ≤ 5% → media
  timeline is usable as the pupil-tracking clock → GO for centroid work.
- EYE_ROI_PASS (face ≥ 50%, both-eyes-usable ≥ 50%, eye boxes ≥ 30 px) →
  eyes are sufficiently visible in front-camera frames → GO for ROI-cropped
  pupil detection reusing this decoder.
- Either FAIL → fix the stage (exposure/grip guidance, orientation handling,
  or decode tuning) before any pupil code.

## Limitations discovered (code review, pre-device)

- ML Kit needs Google Play Services on-device; without it the face pass
  reports `UNAVAILABLE` → `EYE_ROI_UNKNOWN` while the frame verdict stays
  independent.
- Front-camera video may be mirrored; eye side labels are positional, not
  anatomical claims.
- No clinical code in P2 by design: no pupil center, gaze, stimuli, metrics,
  thresholds, or diagnosis.
