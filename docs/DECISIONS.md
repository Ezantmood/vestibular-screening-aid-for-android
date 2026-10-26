# Design decisions

- Android-first, React Native/TypeScript/Expo, with Kotlin Camera2 modules behind
  the `src/camera/` seam. Expo Go is insufficient for the native measurement path.
- The front camera is the self-contained eye-test camera. Rear-camera high-speed
  modes are benchmarks. Capability verdicts require an exact advertised fixed
  size/FPS pair; front 240 fps is not claimed.
- One camera owner controls preview and recording. Display mirroring/cover
  transforms do not alter decoded measurement pixels. Build scripts do not
  install, launch or inspect a phone.
- Decoded MediaCodec PTS is the frame clock. Batched Camera2 callbacks and
  MediaRecorder start are not individual exposure timestamps. Reject incomplete
  decode, invalid geometry/PTS and inconsistent cross-pass results.
- ML Kit locates face/eye regions, not ground-truth pupils. Exact luminance
  connected components supply pupil observations. Predicted tracker positions
  constrain search only; missing observations stay missing.
- Gaze features use pupil position relative to the face, not the moving eye crop.
  Nine stationary fit targets and five independent checks establish a guarded
  mapping. Fit-target CV chooses affine/ridge/quadratic; held-out medians and
  frame distributions must pass. [Calibration contracts](CALIBRATION_SIGNALS.md).
- Signals preserve original observations and use actual PTS within continuous
  segments. No interpolation or velocity crosses a missing interval.
- Firebase Authentication handles account identity. Patient/session/settings
  data remains in an on-device AES-256-GCM vault with a keystore-held key. PDF
  uses HTML/system fonts for Vietnamese. A corrupt vault is not overwritten.
- A completed clinic calibration step may still allow recording after RETRY,
  but rejected mapping never supplies screen-position metrics. Independent
  engineering tests keep the stricter calibrated workflow.
- Version changes, binaries and verification history belong in GitHub Releases.
  Source docs retain current architecture, contracts and reproducible procedures.
  Computer simulations, local replay and physical evidence remain distinct;
  none alone establishes clinical accuracy or diagnosis.

[Current state](STATUS.md) ·
[Release history](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases)
