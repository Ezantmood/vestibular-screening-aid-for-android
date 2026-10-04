# Stimulus device validation — 2026-10-05

Xiaomi 2312DRA50G, Android 13/API 33, FRONT 1920×1080 fixed [120,120].
JDK 21 arm64 debug build. A temporary effect invoked the real StimulusScreen
capture handlers and displayed its real target. No camera/frame/pupil results
were substituted; face readiness was bypassed for this engineering smoke.

| Check                           | Smooth Pursuit     | Horizontal Saccade                     |
| ------------------------------- | ------------------ | -------------------------------------- |
| Outcome                         | completed, 10 s    | cancelled by early stop at about 2.2 s |
| React target commits            | 464                | 142                                    |
| Encoded video decoded frames    | 1202               | 278                                    |
| Observed PTS FPS                | 119.504            | 119.508                                |
| Estimated frame/target joins    | 1189               | 277                                    |
| Missing PTS                     | 0                  | 0                                      |
| Strictly increasing PTS         | yes                | yes                                    |
| Target bounds / horizontal path | pass               | pass                                   |
| Saccade segments                | —                  | center, left, right                    |
| Median/max commit gap           | 20.977 / 38.443 ms | 18.792 / 44.802 ms                     |
| Max request-to-commit delay     | 46.105 ms          | 37.450 ms                              |
| Clock bridge round trip         | 29.354 ms          | 26.254 ms                              |

The pursuit recording has 3 frames before the first commit and 10 after the
stimulus window; they remain `not-presented` / `outside-run`. Saccade has 1
frame before its first commit. Unknown camera/encoder exposure offset stays
null in both saved JSONs. Targets run at display/JS cadence, not camera 120 Hz.

Evidence: native `cache/stimulus/timeline_646296091727235.json` and
`timeline_646306916685564.json`, with their video paths. Numeric metadata was
read back and checked; images/videos stay on-device. These measurements are
from the first validation pass; final refinements are recorded below.

This validates rendering/capture/PTS logging, not physical display onset,
visual-angle accuracy, subject compliance or clinical performance.

## Final pass after refinements

Lowest-RTT of five clock samples and immediate target cancellation on the
capture's finishing stage were re-run through the production handlers:

| Result                               | Smooth Pursuit       | Horizontal Saccade  |
| ------------------------------------ | -------------------- | ------------------- |
| Outcome / end                        | completed / 10.003 s | cancelled / 2.295 s |
| React commits                        | 497                  | 122                 |
| Decoded frames / estimated joins     | 1202 / 1192          | 280 / 270           |
| Median/max commit gap                | 19.650 / 34.239 ms   | 18.250 / 29.160 ms  |
| Max request-to-commit delay          | 33.248 ms            | 32.504 ms           |
| Bridge round trip                    | 0.315 ms             | 0.324 ms            |
| Missing / nonmonotonic PTS           | 0 / 0                | 0 / 0               |
| Before first commit / outside window | 3 / 7                | 3 / 7               |

Native JSONs `timeline_646806800050686.json` and
`timeline_646817693170630.json` were read back: viewport/capture metadata,
explicit outcomes and PTS joins are present; saccade commits show center,
left and right segments. Smaller bridge RTT does **not** resolve the unknown
camera/encoder exposure offset or React-commit-to-photon delay.

Final production sources restored: Home accessibility hierarchy includes the
stimulus entry, has no automatic camera start, and Android camera service has
no active clients after cleanup. `npm run check`, `npm run format`, `npm test`,
Android JS export and native debug build all passed.
