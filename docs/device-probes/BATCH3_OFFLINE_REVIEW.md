# Batch 3 computer review — 2026-10-08

No phone connection, Wireless Debugging, ADB, remote install, capture or access
was used. Inputs were code, existing docs and artifacts already on the computer.
The newest available human calibration remains the October 7 recording;
no new human result is claimed for October 8.

## Findings and fixes

- The October 7 artifact remains RETRY: 14 takes, 2,523 frames, 5,046 eye slots.
  Accepted calibration observations: left 1,849 (73.3%), right 230 (9.1%). Left
  held-out RMSE 0.3885 and maximum 0.4862 exceed unchanged 0.08/0.15 gates;
  right has no model. The prior viewport race is fixed in `19601a7`; that fix
  does not repair the original off-screen `viewportTop=-201` metadata.
- Detector code had a reproducible measurement defect: component intensity and
  weighted centroid included unrelated dark pixels inside its bounding box.
  Connected-component support is now retained and exclusively used, in both TS
  and Kotlin, including hinted rescue. A nested, disconnected blob must not move
  the selected outer component's centroid. Comparing the same synthetic image
  against `19601a7` shows 0.2645 px / 0.2761 px erroneous x shifts for the two
  detectors; the corrected code gives zero shift. These are controlled image
  measurements, not an improvement measured on human video. Contrast-normalized weighting also
  now uses the stretched intensity domain in which its threshold was defined.
  Percentile-dark weights and all confidence/shape/ambiguity gates are unchanged.
- Kotlin CV is now a pure, stateless production core, so the APK self-test and
  JVM tests exercise the same implementation as decoded pupil tracking, without
  a camera or shared in-flight ROI dimensions. Decoding/PTS/overlay seams remain.
- ROI propagation previously accepted face-proportion estimates as real eye
  landmarks and substituted frame fraction when PTS was missing. These slots
  now remain failures; inconsistent keyframe PTS cannot provide a bracket.
  A partial/errored decoder or invalid/count-mismatched PTS stream stops analysis.
- Measurement context is now `decoded-roi-v2`. Old models cannot be silently
  reused after the detector correction; old artifacts remain unchanged.
- Per-target diagnostics separate detector success/confident samples, observed
  tracking, motion-gate rejection, post-confidence rejection and final calibration
  acceptance. A high SUCCESS count alone cannot imply usable calibration.

The right-eye evidence has 1,979 detector SUCCESS slots, but only 532 have raw
confidence ≥0.5; 609 candidates are tracking-gate rejected. Only 259 tracked
observations reach ≥0.5, and 230 survive calibration selection. Left candidates
are also poorly related to held-out target positions. This identifies measured
quality loss; it does not establish whether the physical cause was lighting,
occlusion, false pupil locks, head movement, fixation, or ROI landmark drift.
Original pixels and supervised target ground truth are needed to distinguish
those causes. The code defects are verified independently; their contribution
to this human recording's RMSE cannot be quantified from centroid metadata.
No threshold was lowered and no saved input/model was rewritten to pass.

## Verification on the computer

- Fourteen JS regression suites PASS; the independent APK suite has 15/15
  explicit synthetic checks, including the full calibrated/processed two-test
  path, missing right-eye features, poor validation, RETRY mapping, blink,
  viewport races, estimated ROI, missing PTS and partial decoding.
- Native JUnit PASS: seven cases on the production Kotlin CV core, including
  nested components, both detectors, hinted rescue, invalid geometry and null
  failures. This is JVM verification; the native bridge on the Xiaomi remains
  pending owner execution.
- Local replay covers **9,854** stored eye slots: 5,046 from the newest
  calibration plus 4,808 from the earlier Pursuit/Saccade clips. Raw unchanged,
  missing observations not fabricated, interpolation zero, cross-gap derivatives
  zero. Refit retains the identical rejected candidate models. Both tests remain
  INVALID and have no reliable metrics. This replays domain code over saved
  measurements; it does not re-detect pupils from unavailable video pixels.
- Strict typecheck, lint, formatting and standalone Android build PASS. APK
  binary checks verify signature, embedded JS bundle, non-debuggable application,
  disabled backup and absence of Internet/network-state/overlay/broad-storage
  permissions. Export uses Android's local document picker and an allowlisted
  aggregate summary; hostile-field and metric-guard regression tests PASS.

The original local calibration SHA-256 remains
`f2e854f599b74782b690d4c5528efef6922242ee77fdce5c41ba3cbd034d2515`.

## Pending physical evidence

APK launch, camera/session lifecycle, native self-check bridge, document-picker
export, new fixation recording and three-stage progression on Xiaomi have not
been run in this batch. No VALID human calibration, reliable Pursuit gain or
Saccade latency/velocity/accuracy is claimed. Unbounded MediaRecorder exposure
alignment remains a separate limit even if a new calibration passes.

The owner can now run the self-contained APK and export the aggregate report
without giving the computer access to the device. Instructions and artifact
locations: [independent verification](../BATCH3_VALIDATION.md). Stop after this
handoff; Batch 4 is not implemented.
