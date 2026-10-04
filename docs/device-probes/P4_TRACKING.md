# Pupil robustness verification — 2026-10-05

Device: Xiaomi 2312DRA50G, Android 13/API 33. JDK 21 arm64 debug build.
Architecture: [tracking domain](../ARCHITECTURE.md); engineering gates are in
`src/eyetracking/tracking/pupilTracker.ts`, not clinical thresholds.

## Actual device replay

Replayed the existing FRONT 1080p120 UI-regression recording
`preview_1_1920x1080_120fps_1791139656411.mp4`. Its movements are not labeled
or independently verified; this is a pipeline/continuity regression, not a
seven-condition experiment. The unavailable older seven-condition files and
unfilled prior TODOs are not claimed as completed validation.

120 ML Kit ROI keyframes → PTS-based ROI propagation → dense P3 localization
→ permitted hinted rescue → per-eye temporal tracking. Camera ownership was
released before offline analysis. Recorded results:

| Result                         | Left         | Right        |
| ------------------------------ | ------------ | ------------ |
| Decoded frames / eye slots     | 1208         | 1208         |
| Raw valid                      | 997 (82.53%) | 711 (58.86%) |
| Tracked valid                  | 988 (81.79%) | 720 (59.60%) |
| Accepted rescued measurements  | 0            | 9            |
| Gate rejections                | 9            | 0            |
| Dropouts / reacquisitions      | 121 / 121    | 121 / 121    |
| Longest observed dropout       | 108.756 ms   | 401.678 ms   |
| Blink/occluded classifications | 1            | 0            |

Total: 2416 slots, 1708 raw and tracked valid (70.70%), 590 rescue requests,
9 rescued measurements. Report checks: `noFabricatedPositions=true`,
`gapsNeverFabricated=true`. No large PTS gaps in this clip. Dense offline
analysis takes several minutes; it is not a realtime pupil stream.

## Executable regressions

`npm test` checks P3 detection, preview/framing, tracking and stimulus logic.
Tracking covers blink/null honesty, head translation, ROI-following priors,
irregular PTS interpolation, confidence decay, independent eyes, strict
stream timestamps, loss/reacquisition, stale/mismatched rescue rejection,
and audit rejection of altered/partial/nonfinite coordinates.

Final refinements clear stale predictions, reject invalid geometry/eye mixing,
and strengthen report equality checks. These are execution-tested; the replay
numbers above were measured before those guard refinements.

## Limits

- The real clip demonstrates recovery from short losses; >500 ms reacquiring
  and >2 s lost states are tested synthetically, not a newly observed device
  experiment with controlled occlusion.
- No new visual overlay audit/ground-truth pupil annotation was performed.
  Do not assign `TRACKING_ROBUSTNESS_PASS` from the numeric replay alone.
- Raw localization remains vulnerable to eyelashes, blur, poor illumination
  and rapid pose changes. ROI compensation is not head-pose estimation.
- Missing measurements stay null. Predictions/ROI interpolation are internal
  search aids; neither is a reported pupil measurement. Explicit blink,
  no-face, no-eye-ROI and ambiguous results cannot be rescued.

Recordings/overlays remain in device-local cache. Temporary autorun/replay
routes were removed; final Home opens manually.
