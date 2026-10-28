# Development Build — explicitly requested Metro work

Routine delivery builds and publishes exactly one APK: **vestibular-clinic.apk**.
Use that embedded-bundle app for owner testing; Metro, QR and port 8081 are not
required. [Clinician verification](BATCH3_VALIDATION.md).

The Development Build workflow below is retained only for a new explicit owner
request for live JS/TS iteration. Do not automatically build or publish another APK
alongside the clinician app. Existing Expo SDK 57, Kotlin modules, package, signing
key and EAS development profile are reused. Batch 4 is not implemented.

## Access boundaries

Never use ADB, Wireless Debugging, CLI device install/launch, phone inspection or
remote control. The owner installs the app and opens the Metro QR. Serving JS from
the computer over LAN is authorized. Do not press CLI `a`, run `expo run:android`
or start Expo's tunnel fallback: the local tunnel path can attempt `adb reverse`.

Expo Go cannot load this project's Camera2 modules. Fast Refresh cannot add or
update native code. A missing native-module error requires a compatible APK, not
merely another permission prompt or Metro reload.

## Only when a Development Build is explicitly requested

```bash
npm install
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:dev
```

This build-only command creates `artifacts/development/vestibular-development.apk`
with a dev launcher, INTERNET and debug LAN HTTP, and verifies its signature,
launcher, QR scheme and arm64 libraries. The owner installs it themselves. It uses
the same package/signing key as the clinician app; preserve local evidence and do
not uninstall to resolve a signature conflict. `npm run android` builds the normal
clinician APK and never installs or launches it.

```bash
npm start
# If the transform cache is stale:
npm run start:clear
```

Metro uses `--dev-client --lan` and prints the current QR/URL. Keep computer and
phone on the same LAN. The owner scans into Vestibular Screening Aid, or enters
the printed address in the development launcher, and verifies the visible update.
Do not use historical IP/pairing addresses or scan into Expo Go. If loading fails,
the owner can check the printed `/status` URL, Wi-Fi, VPN and firewall themselves.

Save JS/TS while the app is idle for Fast Refresh. Reload/restart the physical test
after code changes: preserved React state is not a valid measurement session.
Kotlin/JNI/native APIs, native dependencies, Expo/React Native, manifest, plugins
or Gradle changes require a new compatible native APK. Metro/Babel/env changes
require restarting Metro, plus rebuilding if native configuration changed.

Native/JS measurement contracts must agree. The current contract is
`eye-contour-pupil-v11`; incompatible models cannot activate. Measurement-math
changes require fresh calibration and physical verification. Fast Refresh is not
proof of a VALID model or reliable metrics. See [contracts](CALIBRATION_SIGNALS.md).

## Evidence

Computer checks can verify code, native JVM behavior, APK structure and loopback
Metro/HMR delivery. Phone installation, QR handling, LAN reachability, visible
refresh, calibration quality and eye-test validity remain owner-operated checks.
Return to the single clinician APK for normal GitHub Release delivery.
