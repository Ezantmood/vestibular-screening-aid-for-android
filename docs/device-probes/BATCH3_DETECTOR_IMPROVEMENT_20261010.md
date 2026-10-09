# Batch 3 detector repair — 2026-10-10

Scope remains calibration, Smooth Pursuit and Horizontal Saccade. The owner's
r2 report is still RETRY; this repair does not establish a VALID human result.
No phone connection or control was used.

## Reproduced defect and repair

The production JVM detector rejected a clear synthetic pupil (120×120 ROI,
radius 28, pupil luminance 25, background 190) as NO_PUPIL_CANDIDATE. Its dark
plateau occupies the 12th percentile: strict `< threshold` removes that entire
plateau. Include the cutoff with `<=` in TS, standard Kotlin and hinted Kotlin.
Confidence, ambiguity, geometry, tracking and calibration gates are unchanged.
Uniform images and competing pupils still return null measurements. Invalid
hint geometry/priors now also fail explicitly before image processing.

The quantile now uses exact three-way selection on a primitive copied buffer,
with bounded partition iterations, primitive-sort fallback and an ordered-buffer
shortcut. It avoids the previous boxed full sort; it does not approximate the
percentile or mutate image pixels. JVM parity checks cover 200 size/distribution/
quantile combinations plus empty input, including ties and reverse order.

Mac JDK 21 benchmark: 14,400 pixels, 250 warm-ups, nine alternating rounds of
100 calls, median time per call; original Kotlin `DoubleArray.sorted()` versus
the production selector. These are quantile timings, not app or Redmi FPS.

| Synthetic buffer | Previous µs | Selector µs | Speedup |
| ---------------- | ----------- | ----------- | ------- |
| Random luminance | 1676.71     | 142.47      | 11.77×  |
| Two plateaus     | 256.92      | 20.78       | 12.36×  |
| Ordered ramp     | 36.69       | 10.06       | 3.65×   |

## Debugging and compatibility

The aggregate technical JSON now includes feature spans/correlation, correlations
against both target axes, fit/validation RMSE by axis and repeated-center feature
distance. Feature counts expose incomplete support; missing values stay null.
These are diagnostics, not new quality gates or reliable eye-test metrics. They
contain no raw feature positions, coefficients, ROIs, trajectories or personal
identifiers. Calibration feedback distinguishes missing samples from poor mapping
without assuming that the owner, lighting or fixation caused the error.

Measurement version is `decoded-roi-v3`. v1/v2 models remain readable for debugging
but cannot activate. A native version constant prevents Fast Refresh from tagging
old Kotlin measurements as v3. This change requires a new APK and fresh calibration.
The r3 APK self-test contains 18 JS checks and 10 native checks; all must PASS.

## Verification and limits

All 15 regression suites, 33 eye-test groups, 18 APK JS simulations, five JVM
JUnit tests (including all 10 native self-checks), typecheck/lint/format PASS.
Saved-data replay covers rejected calibration and both old eye recordings; raw
values/dropouts stay unchanged and calibrated metrics remain unavailable. It
cannot rerun CV without video pixels and is not a fresh physical measurement.

The defect is proven on synthetic pixels, not established as the sole cause of
the owner's RETRY. The new recording's images/raw features are unavailable on the
computer. High-confidence false components, ROI movement and limited gaze
sensitivity remain possible. Physical calibration and both tests still require
owner verification; synchronization/tracking quality gates remain independent.
Build/distribution instructions: [standalone APK verification](../BATCH3_VALIDATION.md).
