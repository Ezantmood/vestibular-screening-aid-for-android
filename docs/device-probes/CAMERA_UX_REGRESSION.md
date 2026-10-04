# Camera UI / capture regression — 2026-10-05

Device: Xiaomi 2312DRA50G, Android 13 / API 33. JDK 21 arm64 debug build.
Checks exercise camera controls and screen workflows; they do not establish
pupil/tracking accuracy or a clinical verdict.

## Shared capture controls

A temporary React harness mounted the real `CameraCapturePanel` and
`usePreviewCapture`, using the device's advertised fixed modes:

| Check                                      | Result                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Cancel during 3-second countdown           | Returns to preview; native recording=false; no recorder-start event                         |
| Stop a 10-second front 1080p120 take early | SUCCESS, manualStop=true, 210 encoded samples / 1.8242 s; 105 real CaptureResult timestamps |
| Close, change mode, reopen rear 720p240    | SUCCESS, 487 encoded samples / 2.0287 s; 122 CaptureResult timestamps                       |
| Close and reopen front camera              | PREVIEW, valid surface                                                                      |
| App leaves foreground, then returns        | IDLE, previewActive=false, camera owner=null                                                |

The initial stop test exposed Expo's serial default module queue: the stop
request waited behind the recording. Stop/cancel now dispatch their atomic
flags on the main queue; recorder work and finalization remain asynchronous.
CaptureResult timings remain batched HAL metadata, distinct from encoded PTS.

Front TextureView: 1124×1183 px, buffer 1920×1080, sensor orientation 270°,
frontFacing=true, mirrorPreview=true, extraRotationDeg=0. Native transform
remains centered CONTENT → DISPLAY cover: diag(1, 1.6891142, 1), ty=-407.6111.
No additional rotation/mirroring was introduced.

## Screen workflows

Temporary effects invoked the real manual-screen capture handlers, rather
than replacing native results. These technical runs bypassed the face-readiness
gate; they do not constitute a new manual framing/overlay acceptance. FRONT 1080p120, 10 seconds per screen:

- P1: preview → countdown → recording → saved report → camera closed — pass.
- P2: same capture → offline video/eye-region analysis → result — pass.
- P3: same capture → offline analysis → both detector batches → result — pass.
- P4: same capture → dense offline tracking → result → camera closed — pass (about 4 min 53 s offline on this run).

P3.5 live preview also passed two consecutive early-stop takes without reopening:
228 encoded/228 decoded frames at 1.9079 s; 230/230 at 1.9246 s. The real stop
handler entered its disabled saving state; background release returned to the
ready screen. P0.1 probe displayed 2 cameras. Mode-picker layout was inspected
on-device with the selected mode and scrollable options.

Home layout was inspected on-device. Screen accessibility hierarchies were
checked for the Vietnamese controls and back navigation. Camera video and
analysis images stayed in the app's device-local cache; only numeric/text
metadata was collected. Temporary auto-run edits were restored byte-for-byte before the final manual
Home launch. No camera session starts automatically from Home.
