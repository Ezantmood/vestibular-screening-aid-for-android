# Status

## Current implementation

- Android-first clinician app: accounts, encrypted local patient charts, eye-test
  recording, saved traces, reports and PDF. One delivery APK: `vestibular-clinic.apk`.
  Scope remains Batch 3 calibration, Smooth Pursuit and Horizontal Saccade;
  Batch 4 has not started.
- Calibration uses `eye-contour-pupil-v11` and `target-cv-ridge-v1`. Canthus
  references, native/JS geometry/PTS contracts and all sample, fit-CV, held-out
  median/frame error gates remain enforced independently for both eyes.
- V11 fixes v10's full-pupil area cap and counts masked outline visibility
  separately from measured edge support. Partial-arc fits must pass center/axis
  sensitivity and photometric checks. No dark-core/crop-center fallback or circle
  assumption supplies a center. A prior cannot resolve competing hypotheses.
- Replay accepts saved v8–v11 capture metadata, re-decodes pixels and discards old
  coordinates. It preserves original age, clocks and targets. Native asynchronous
  file retention handles raw Android paths/file URIs without Expo `File` calls.
- Complete capture videos/manifests persist in app-private files before analysis.
  Failed/cancelled analysis and restart retain replay access. Revoking an active
  calibration preserves diagnostic evidence; legacy archives remain recoverable.
  Home and test instructions expose saved-calibration review directly.
- Numeric export retains measurement/export build and capture/replay provenance.
  Unmarked Y-plane PNGs and marked ellipse overlays stay local. Overlays and
  confidence scores are hypotheses, not anatomical labels or clinical accuracy.
  See [calibration contracts](CALIBRATION_SIGNALS.md).

## Evidence and next acceptance

Owner v9 JSON remains RETRY: several target coverage gates and all mapping gates
fail; the vertical signal relation is weak. Refit reproduces rejection. Owner
v10/0.2.13 screenshots then show a regression: both eyes retain **0/2524** frames,
so no mapping errors can be measured. This is detector rejection before fitting,
not proof of worsening optical error or user/device misuse.

Source investigation identifies v10's inappropriate 28%-of-aperture full-region
cap and near-complete-outline assumptions. A resized screenshot probe reproduces
rejection and exercises the correction; it is not original decoded pixel evidence.
Previous full/small-pupil simulations did not adequately cover large/clipped eyes.
V11 adds known-geometry blur, large/partial pupils, rotation, outside-mask isolation
and noise controls while retaining the earlier shading/ambiguity/occlusion checks.

Replay's reported `Exception in HostFunction` matches passing a raw absolute path
into Expo's URI-based synchronous File constructor. JVM reproduction and browser
UI regression checks cover that failure, retry/cancel/double-click/restart paths;
native file tests cover cache eviction and failed atomic retention. These computer
checks do not establish real Redmi calibration or optical accuracy.

Next owner check: install the update over the existing app, open saved-calibration
review and replay the same failed capture first. Inspect the new numeric export,
source PNGs, center stability, per-target coverage and held-out/frame errors. Old
cached files already evicted need a fresh capture; new complete captures survive
cache eviction. Then perform fresh physical acceptance using the
[verification workflow](BATCH3_VALIDATION.md). Physical VALID remains pending.
No phone was accessed or controlled by the agent.

## Versions

The [0.2.14 test release](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/v0.2.14-beta.1)
records source, APK/checksums, verification and pending Redmi work. History lives
in [GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
Private screenshots, videos, exports and patient records stay out of Git/assets.
