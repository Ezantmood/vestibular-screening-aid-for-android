# Batch 3 physical-report review — 2026-10-10

Owner supplied schema-2 `batch3-20261009-r2` technical JSON after recording and
exporting on Redmi. No phone connection, inspection or remote control was used.
The source JSON remains on the computer; only aggregate findings are recorded here.

## Decision: not ready for the next batch

All 15 JS simulations and seven production native CV checks report PASS, with
no self-test failure codes and saved calibration readable. This confirms the
reported native self-test/export path; simulations do not validate human gaze.

The physical workflow started, reports no interruption/capture-analysis errors,
and contains all 14 targets, 2,530 decoded frames and 5,060 eye slots. Calibration
is **RETRY**, current measurement version, `modelChecksPass=false` and
`calibrationConfirmed=false`. Both eye models are rejected candidates.

| Eye label in report | Accepted / total | Overall coverage | Targets passing sample-quality gates | Fit RMSE | Validation RMSE | Maximum validation error |
| ------------------- | ---------------- | ---------------- | ------------------------------------ | -------- | --------------- | ------------------------ |
| left                | 348 / 2,530      | 13.75%           | 0 / 14                               | 0.2262   | 0.3463          | 0.4379                   |
| right               | 2,348 / 2,530    | 92.81%           | 14 / 14                              | 0.2546   | 0.4330          | 0.5626                   |

Unchanged gates: coverage at least 60% **per target**, fit RMSE at most 0.08,
validation RMSE at most 0.08 and maximum validation error at most 0.15. Errors
are fractions of the target viewport, not degrees or clinical thresholds.
Right-eye sample-quality passage does not imply an acceptable calibration model.

## Where usable observations are lost

| Eye label | Detector SUCCESS | Detector confidence ≥0.5 | Observed tracking | Tracking-gate rejected | Tracked confidence ≥0.5 | Rejected after confidence | Accepted |
| --------- | ---------------- | ------------------------ | ----------------- | ---------------------- | ----------------------- | ------------------------- | -------- |
| left      | 2,397            | 356                      | 2,310             | 87                     | 352                     | 4                         | 348      |
| right     | 2,452            | 2,440                    | 2,405             | 47                     | 2,395                   | 47                        | 2,348    |

Left-eye loss is dominated by insufficient detector confidence, not the final
robust-trimming filter. All left targets are below 60% coverage (1.67–40.56%).
Right targets have 64.84–100% coverage and pass local fixation/sample gates, but
fit and independent validation errors still fail. Improving left coverage alone
cannot resolve this second problem. High detector confidence is not proof that
the detected component or ROI-normalized features encode target gaze correctly.

The report lacks images, raw features/ROIs and target-feature relationships, so
it cannot distinguish pupil false locks, landmark/ROI effects, fixation, lighting
or limits of the current feature/model. These are hypotheses, not established
causes. No algorithm or threshold was changed on that evidence alone.

## Two eye tests and computer audit

Smooth Pursuit and Horizontal Saccade both remain **NOT_RUN**, correctly blocked
by RETRY calibration. No physical gain, tracking RMSE, catch-up saccade count,
latency, velocity, accuracy, overshoot or undershoot is available. NOT_RUN is not
a failed eye-test response. No disease or diagnosis is inferred.

Computer audit confirms check IDs/build/policies match current code, target/eye
counts and coverage arithmetic agree, and each eye fails all three model-error
gates. All 15 regression suites, including 33 eye-test groups and 15 explicit
APK JS simulations, PASS. Typecheck/lint/format also PASS. This review changes
documentation only; no APK rebuild or new physical recording is claimed.

Remain in Batch 3: investigate low-confidence left detections and failed gaze
mapping in both eyes, establish a VALID physical calibration, then validate the
two eye tests. Even after VALID calibration, test synchronization and tracking
quality must pass independently before publishing reliable metrics. Batch 4 is
not started.
