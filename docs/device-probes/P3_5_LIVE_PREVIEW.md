# P3.5 — Live front-camera preview + framing guidance (device validation)

Device: Xiaomi 2312DRA50G (Redmi Note 13 Pro 5G, garnet),
Android 13 / API 33. FRONT camera, 1920×1080, fixed [120,120].

Status: **VALIDATED ON-DEVICE 2026-10-02 — all three verdicts PASS.**

Connection: wireless ADB (ports changed several times as the phone roamed
Wi-Fi: 192.168.1.236:38347 → 10.7.151.33:xxxx → 10.7.86.245:xxxx; verified
`ro.product.model=2312DRA50G`, `garnet`, release 13, SDK 33 each time).
`adb reverse tcp:8081` + Metro dev-build workflow; CAMERA permission already
granted. Wireless ADB lacks INJECT_EVENTS, so all UI steps were manual.

## P3.5 bugs found during validation (fixed, in-tree, re-validated)

1. **Wrong `requireNativeViewManager` arity** (JS): called with only the view
   name, so RN looked for `ViewManagerAdapter_ExpoCamera2HighSpeedPreview`.
   Correct form is `(moduleName, viewName)` →
   `ViewManagerAdapter_ExpoCamera2HighSpeed_ExpoCamera2HighSpeedPreview`.
   JS-only fix, hot-reloaded, no rebuild needed.
2. **Native view had no size** (JS): the preview view missed `flex: 1`, laid
   out at 0×0, its SurfaceTexture surface never created →
   `ERR_NO_PREVIEW_SURFACE`. Fixed by defaulting the view style to fill.
3. **Transform applied before layout** (Kotlin): `applyTransform()` ran in
   `onSurfaceTextureAvailable` while width/height were still 0 and never
   re-ran → default fit transform (letterbox bars, image not covering the
   box). Fixed with an `OnLayoutChangeListener` re-apply + `post{}` after
   surface-available.
4. **Preview alignment correction** (Kotlin + TS): the initial DISPLAY →
   BUFFER inverse construction was replaced with a centered TextureView
   CONTENT → DISPLAY correction — the platform already sensor-orients and
   front-mirrors the surface, so the matrix only undoes that stretch,
   applies uniform cover (all four view corners stay inside the image), and
   compensates display rotation; the front selfie mirror is preserved
   exactly once (correction only when requested display behavior differs).
   Rebuilt (`:app:assembleDebug` SUCCESS), reinstalled, operator-confirmed
   the image fills the box upright with a natural mirror. See also
   `docs/STATUS.md` (“P3.5 preview alignment fix”) for the numeric smoke
   (view/corner coverage, native/TS matrix agreement).

## Preview architecture (as validated)

ONE `CameraConstrainedHighSpeedCaptureSession`: preview TextureView Surface
(default buffer 1920×1080) + MediaRecorder Surface (prepared idle at open),
fixed [120,120]. Record-start is only `recorder.start()`; stop re-prepares
and recreates the session around the same preview surface. `cameraOwner`
enforces preview XOR one-shot P1/P3 capture (one-shot path byte-identical).

## Manual live-preview findings (operator-confirmed on the phone)

- LIVE PREVIEW VISIBLE: yes — front image live in the preview box.
- Upright in normal portrait use: yes; not stretched; aspect correct.
- Center-crop reasonable: after fix #3 the image fills the whole box; face
  easy to center without extra adjusting.
- Selfie mirror feels natural; moving left/right behaves as a mirror.
- No severe delay; no freeze (screenshot showed a live frame; states below
  updated at ~2 Hz throughout).
- Preview REMAINS VISIBLE during recording, stays upright, REC indicator +
  elapsed timer shown, framing UI does not corrupt the preview.

## Orientation / mirror / coordinate contract (as validated)

- TextureView transform = centered CONTENT → DISPLAY correction
  (`ExpoHighSpeedPreviewView.buildTextureViewMatrix`, lockstep with TS
  `buildTextureViewMatrix`): undo the platform stretch, uniform cover (no
  non-uniform scaling — faces look normal), display-rotation compensation
  about the view centre. Sensor-orientation swap (landscape sensor buffers)
  and the front selfie mirror come from the platform/live Camera2
  characteristics; the matrix preserves the front mirror exactly once and
  never mirrors analysis pixels. A `extraRotationDeg` escape hatch exists
  (default 0, documented) but was not needed.
- TS `buildPreviewMatrix` is the DISPLAY → decoded-ANALYSIS audit mapping
  only (never applied to the view): P2 proved the recorded Redmi front
  pixels need 90° CW in portrait, which is where that 90° lives.
- Face-box overlay tracked the face while moving center/left/right/up/down
  (operator); boxes not horizontally reversed; no rotation drift; correct
  after center-crop. The overlay consumes DISPLAY fractions only (framing
  sampler reads transformed DISPLAY snapshots; bitmap space decided at
  runtime by aspect).
- P3 analysis/ROI/normalized coordinates UNCHANGED (no pupil-code edits).
  Anatomical left/right stays image-space and unresolved (documented, not
  renamed).

## Framing-guidance findings (operator-confirmed)

All states intentionally triggered and observed: NO_FACE (leave frame),
TOO_FAR, TOO_CLOSE, FACE_PARTIAL (edge), OFF_CENTER (toward edge),
EYES_NOT_VISIBLE (eyes out of usable framing), READY (good normal position).
3-sample stabilizer: no rapid flicker. READY achievable in a normal hold
(no unnatural precision). Gates unchanged (no threshold tuning to pass).
Start requires READY (override path exists, was not needed).

## Recording lifecycle (operator + file evidence)

- Record #1 (~10 s, deliberate head movement): SUCCESS, preview persisted.
- Record #2 (~10 s): SUCCESS without restarting the app — no deadlock, no
  black/frozen preview, no MediaRecorder illegal-state, no owner conflict.
- Unmount (Back) → re-enter → open: camera opens normally again.
- Two `preview_1_1920x1080_120fps_*.mp4` files in app-private cache
  (15:33 + 16:27, ~37 MB each); pulled to a local machine for analysis
  (procedure below), never committed.

## High-speed regression (preview ACTIVE, both takes)

The screen's automatic on-device P2-decode panel confirmed take #1 in-app
(1202 encoded / 1202 decoded / 119.50 fps / 8.333 ms median — matching the
off-device analysis below). Both takes were additionally pulled for
in-depth analysis (ffprobe packet PTS + full ffmpeg decode +
downscaled-luminance MAD pipe; PTS is the authoritative signal):

|                       | Take #1 (10.050 s) | Take #2 (10.083 s) | P2 baseline |
| --------------------- | ------------------ | ------------------ | ----------- |
| encoded packets       | 1202               | 1198               | ~1176–1178  |
| decoded frames        | 1202 (1:1)         | 1198 (1:1)         | 1:1         |
| effective FPS         | 119.50             | 118.71             | 119.50      |
| mean interval         | 8.368 ms           | 8.424 ms           | 8.368 ms    |
| median interval       | 8.333 ms           | 8.333 ms           | 8.333 ms    |
| p95 interval          | 8.478 ms           | 8.478 ms           | 8.478 ms    |
| min / max interval    | 8.322 / 8.500 ms   | 8.322 / 41.944 ms  | 8.322 / 8.5 |
| non-monotonic PTS     | 0                  | 0                  | 0           |
| duplicate PTS         | 0                  | 0                  | 0           |
| large gaps (>12.5 ms) | 0                  | 3 (25.2/25.2/41.9) | 0           |

Take #2 gaps at t≈0.29/3.32/5.88 s (≈2+2+4 missed frames, 0.7% of the
stream). Investigated, NOT a freeze regression: decode is still 1:1, begin/
mid/end frames are sharp with visible inter-frame head motion (no frozen
segment), no long zero-MAD run (max run 4/1211 in my off-device pipe; the
handful of exact-zero pairs also appears in gap-free take #1, consistent
with VFR-decode artifacts of the off-device pipe — P2's on-device
MediaCodec pass found zero exact-zeros). Takes were ~54 min apart, so this
is not back-to-back thermal contention; it reads as ordinary isolated
encoder jitter. Not meaningful → no re-validation required.

MAD reference (off-device 96×54 pipe): take #2 median 0.73 / max 4.62
(still framing pose); motion responsiveness confirmed visually via the
extracted begin/mid/end frames (head displacement across the take).

## Verdicts

- `LIVE_PREVIEW_PASS` — visible, upright, unstretched, natural mirror,
  persists through recording, lifecycle reopen works.
- `FRAMING_GUIDANCE_PASS` — overlay tracks, all states behave, READY
  practical, stabilizer works.
- `HIGH_SPEED_REGRESSION_PASS` — preview+recording session succeeds,
  ≈119–120 fps effective, clean PTS (take #2: 3 small isolated gaps,
  investigated, not a freeze), 1:1 decode, sequential takes work.

## Privacy

All recordings/frames/screenshots stayed on the device or a local /tmp
analysis dir (deleted after analysis) — none committed. This doc carries
numbers only.

## Remaining limitations

- Display-rotation 90/270/180 branches and the `extraRotationDeg` escape
  hatch are unvalidated (app is portrait-locked; primary path validated).
- Take #2's 3 isolated gaps are unexplained at the HAL level (see above);
  worth watching in P4 continuity work but not a blocker.
- A dev-mode yellow warning toast appears on Home (cosmetic, dev only).
