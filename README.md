# Vestibular Screening Aid

Android prototype for engineering validation of eye-movement measurements.
Current scope: Calibration, Smooth Pursuit and Horizontal Saccade. Results are
not clinical diagnoses; current real calibration evidence remains RETRY.

React Native + strict TypeScript + Expo SDK 57, with local Kotlin Camera2,
frame-decoding and pupil modules. Target: Xiaomi Redmi Note 13 Pro 5G.

## Batch 3 verification

```bash
npm install
npm run check
npm test
npm run format
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:batch3
```

The standalone APK is `artifacts/batch3/vestibular-batch3.apk`, with a SHA-256
checksum beside it. It embeds JS, has no Internet permission and runs without
Metro or a computer. The build never connects to or installs on a phone.
The owner installs directly, runs **Kiểm thử Batch 3 độc lập** (09), then
exports a small technical JSON with raw/personal identifiers removed.

[Build, installation, physical test and report instructions](docs/BATCH3_VALIDATION.md).
No Wireless Debugging, ADB or remote phone access is used. Do not start Batch 4.
Node 25, Android SDK 36 and JDK 21 were used for the current local build.

## Scripts

| Command                 | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `npm run check`         | Strict typecheck + lint                 |
| `npm test`              | 14 pure execution suites                |
| `npm run format`        | Prettier check                          |
| `npm run build:batch3`  | Local standalone APK + native CV checks |
| `npm run verify:batch3` | Inspect APK signature, manifest, bundle |
| `npm run replay:batch3` | Audit previously saved local evidence   |

## Structure

`App.tsx` opens manual Home. `src/ui/` owns screens/components/hooks;
`src/camera/` contains native seams; `src/eyetracking/` owns ROI, pupil,
tracking and calibration; `src/signals/` processes actual PTS;
`src/tests/` owns the two stimuli, engineering metrics and Batch 3 validation.
`modules/` contains Android Kotlin modules. Patient management, expanded session
storage, clinical reporting and other tests remain outside the current scope.

## Docs

- [Current status](docs/STATUS.md)
- [Batch 3 findings and limitations](docs/device-probes/BATCH3_OFFLINE_REVIEW.md)
- [Calibration / signal contracts](docs/CALIBRATION_SIGNALS.md)
- [Eye-test contracts](docs/EYE_TESTS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md)
- [Project scope](docs/PROJECT_SPEC.md) · [Contributor agreement](AGENTS.md)
