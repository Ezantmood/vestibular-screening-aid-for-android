# Status

## Current implementation

- Android-first clinician app: accounts, encrypted local patient charts, eye-test
  recording, saved traces, reports and PDF. Routine delivery contains exactly
  one APK: `vestibular-clinic.apk`.
- Engineering scope remains Batch 3: calibration, Smooth Pursuit and Horizontal
  Saccade. Batch 4 is not started; vertical/anti-saccade metric alignment remains
  incomplete. The existing scrolling/recording-access repair is retained.
- Calibration uses `eye-contour-pupil-v10` measurements and `target-cv-ridge-v1`
  mapping. Both eyes must independently pass sample, fit-CV, held-out target and
  per-frame error gates. Those gates are unchanged; old models cannot activate.
- Production detection fits centers from stable masked regions and measured
  ellipse edges, replacing the v9 darkest-core centroid. It checks edge-gradient
  peaks, contrast, fit residual and angular support. Poor/ambiguous/occluded
  evidence stays null. A prior cannot bypass those checks or select a competitor.
- Gaze remains relative to measured canthi; face rectangles only guard head
  movement. Masks, original pixel resolution and full numeric precision remain.
  Missing contours, inconsistent decoding/PTS and native/JS contracts fail closed.
- Saved v8/v9/v10 videos can be re-decoded with v10. Old pupil numbers are
  discarded; original target geometry, hold clocks and capture age are retained.
  Replay is distinct from a fresh physical calibration and never renews expiry.
- Local numeric export identifies exporter and saved analysis builds separately,
  and labels fresh/replay provenance when known. Unknown legacy provenance is
  not inferred. No account/patient data or pixels enter the numeric export.
- Audit images retain lossless unmarked Y-plane PNGs and marked JPEGs. V10 adds
  a fitted ellipse, frame labels, top-left target access and numerical boundary
  diagnostics. Overlays are hypotheses, not manual labels.

## Evidence and next acceptance

Owner-provided v9 numeric evidence and ROI screenshots remain RETRY. Sample
coverage fails at several targets and every mapping gate fails. Numeric refit
reproduces rejection. Frame/PTS checks pass, but the vertical relation is weak;
those checks cannot establish correct optical localization.

Unchanged v9 native code reproduces false high-confidence centers when internal
shading changes inside a fixed synthetic pupil. A single pupil with two dark
lobes can also cause ambiguity. V10 addresses these mechanisms using measured
boundary support; it does not repair saved coordinates or make old results VALID.

Computer verification includes existing domain/native checks plus new fixed-boundary
shading, two-lobe, two-axis/subpixel motion, reflection, rotated ellipse, ambiguity,
occlusion and input-preservation controls. Extreme scenes without adequate edges
may now be missing instead of falsely localized. This is a safety improvement,
not evidence of physical calibration acceptance or a guarantee of coverage.

Next owner check: install the current clinic update, preserve existing evidence,
then use **Phân tích lại video đã lưu** on the same failed capture. Inspect
source PNGs/ellipse overlays, boundary diagnostics, coverage and all error gates.
Only then perform fresh calibrations according to the
[verification workflow](BATCH3_VALIDATION.md). No v10 physical VALID or clinical
accuracy is established. No phone was accessed or controlled by the agent.

## Versions and verification history

The [0.2.13 test release](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/v0.2.13-beta.1)
records source, APK/checksums, computer results and pending Redmi work. Per-version
history lives in [GitHub Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases).
Private screenshots, videos, calibration exports and patient records stay out of
Git and release assets.
