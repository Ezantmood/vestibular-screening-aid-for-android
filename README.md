# Vestibular Screening Aid

Android prototype for engineering validation of eye-movement measurements.
Current scope: Calibration, Smooth Pursuit and Horizontal Saccade. Results are
not clinical diagnoses; current real calibration evidence remains RETRY.

React Native + strict TypeScript + Expo SDK 57, with local Kotlin Camera2,
frame-decoding and pupil modules. Target: Xiaomi Redmi Note 13 Pro 5G.

For physical Batch 3 tests, install `artifacts/phone/vestibular.apk` and open
**Vestibular Screening Aid** from the phone's Home screen. This is the default
test APK: camera included, no Metro/QR/8081 dependency. Expo Go cannot load the
project's custom Camera2 modules. Development Build below is for live code updates.
The verified APK is also available in the private
[Batch 3 release](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/batch3-6c6b088):
open in Chrome, sign in with a GitHub account that can access this repository,
then [download vestibular.apk directly](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/download/batch3-6c6b088/vestibular.apk).
An unsupported-file message in Zalo/GitHub's opening flow is not an Android
installation result. HTTPS download does not require the Mac's LAN/server.

## Development Build

Use the existing native project with Expo's development launcher:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:dev
npm start
```

Install `artifacts/development/vestibular-development.apk` directly on the Redmi,
then scan the Metro QR on the same LAN. JS/TS edits use Fast Refresh; native code,
dependencies and config plugins require a new APK. Build scripts never install
or launch on a phone. `npm run android` is a build-only alias.
[Installation, QR, troubleshooting and rebuild rules](docs/DEVELOPMENT_BUILD.md).

## Batch 3 standalone verification

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

| Command                 | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `npm run check`         | Strict typecheck + lint                  |
| `npm start`             | Metro LAN + Development Build QR         |
| `npm run build:dev`     | Local Development APK + native CV checks |
| `npm run verify:dev`    | Inspect launcher, QR scheme, signature   |
| `npm test`              | 15 pure execution suites                 |
| `npm run format`        | Prettier check                           |
| `npm run build:batch3`  | Local standalone APK + native CV checks  |
| `npm run verify:batch3` | Inspect APK signature, manifest, bundle  |
| `npm run replay:batch3` | Audit previously saved local evidence    |

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
