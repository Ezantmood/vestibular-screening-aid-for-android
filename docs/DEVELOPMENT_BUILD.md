# Development Build — Metro, QR and Fast Refresh

Reuse the existing Expo SDK 57 Android project, package, signing key, EAS
`development` profile and four local Kotlin modules. No Batch 4 is implemented.
Never use ADB, Wireless Debugging, CLI device launch, phone inspection or remote
control. The owner installs the APK and chooses to open the Metro QR themselves.
Serving JS from the computer over LAN is the authorized development workflow.

**For recording/testing Batch 3, use the standalone `vestibular.apk` by default.**
Open **Vestibular Screening Aid** directly; no Metro, QR or 8081 service is needed.
Use this Development Build workflow only when live JS/TS updates are wanted.
The two builds are alternative modes of the same installed app, not two required
phone setups. See [physical testing](BATCH3_VALIDATION.md).

## Existing app versus Expo Go / port 8081

The previous working Vestibular app already contained the Kotlin Camera2 module.
Wireless Debugging was its install/transport mechanism; it did not add that module
to the separate Expo Go app. A Camera2-module-missing error means the running
binary does not expose `ExpoCamera2Probe` (Expo Go or an incomplete/stale APK),
not a denied CAMERA permission. Home now shows this before a camera action.

The historical debug workflow used `adb reverse` to bridge the phone's
`localhost:8081` to the Mac. That bridge can disappear when debugging reconnects;
this is separate from camera support. The exact cause of a new phone-side
connection error cannot be confirmed without its error text. Current LAN/QR
development bypasses that bridge, but still requires running Metro and LAN access.
Standalone physical testing removes that dependency altogether.

Do not invoke the stock Expo `--tunnel` on this SDK as an automatic fallback:
local CLI code in `AsyncNgrok.startAsync` attempts `adb reverse` when Android SDK
is present. No tunnel was started and no ADB was used; LAN and standalone APK
remain the supported workflows under the current phone-access restriction.

## Configuration repair

The EAS profile already had `developmentClient: true`, but `expo-dev-client`
was absent from dependencies. Prior debug builds could use Metro, but did not
include the Expo launcher needed for the requested QR workflow. Expo was also
updated from 57.0.24 to the SDK 57-compatible patch 57.0.27. SDK-compatible
`expo-dev-client` is now installed; its existing plugin registers
`exp+vestibular-screening-aid` and opens the launcher. Expo's default Metro and
Babel configuration already provides Fast Refresh; no replacement is needed.
`eas.json` is preserved. No EAS account/cloud build is needed for local testing.

The standalone Batch 3 APK has no network permission and an embedded bundle.
For Metro use the **Development APK**, which has a debug launcher, INTERNET
permission and debug-only cleartext HTTP. Both APKs use the same package and
local signing key, so installing one updates/replaces the other; they do not
appear as two separate apps. Private evidence should survive a compatible update.
Do not uninstall if Android reports a signature conflict; preserve the evidence.

## Build once on the computer

```bash
npm install
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:dev
```

The shared build script prebuilds the existing project, calls Gradle
`:app:assembleDebug` and the native CV JVM checks, copies the APK/checksum to
`artifacts/development/`, and inspects signature, debug flag, launcher, QR scheme,
LAN HTTP and arm64 libraries. It never installs, starts Metro or accesses a device.
`npm run android` is now a build-only alias, replacing the install/launch command.
The unchanged Batch 3 variant is built with `npm run build:batch3`.

Outputs: `vestibular-development.apk` and `SHA256SUMS`.

Optional direct LAN download, serving only the APK artifact directory:

```bash
python3 -m http.server 8082 --bind 0.0.0.0 --directory artifacts/phone
```

The owner opens `http://<computer-LAN-IP>:8082/vestibular-development.apk`
in the phone browser on the same network. Use the computer IP printed by Metro.
This serves a file from the computer; it does not inspect/control the phone.
Stop the download server with Ctrl+C when finished; Metro is a separate process.

## Install on Xiaomi Redmi Note 13 Pro

1. Download the Development APK through the computer's LAN download address above,
   or use your chosen file-transfer method. Open it from **Files / File Manager → Downloads**. The Metro QR loads
   the project after installation; it does not install the APK.
2. If Android blocks the source, choose **Settings** in the installer prompt →
   **Allow from this source** for the app opening the APK (Files/Chrome/etc.).
   Alternatively search Settings for **Install unknown apps** / **Cài đặt ứng dụng
   không rõ nguồn gốc** and authorize that source. Menu locations vary by MIUI/HyperOS.
3. Return to the APK → **Install / Update** → **Open**. Follow any installer
   confirmation/countdown. No USB debugging or developer options are required.
4. Open **Vestibular Screening Aid**. The Expo development launcher should appear.
   The owner must verify actual installation/launch on the physical device.

## Start Metro and open the project

```bash
npm start
# If the transform cache is stale:
npm run start:clear
```

The command explicitly selects `--dev-client --lan`; it prints the development
QR and LAN URL. Keep the Mac and phone on the same Wi-Fi/LAN, leave Metro running
and allow Node's incoming local-network traffic if macOS asks. IP/port can change;
use the URL printed by the current run, not historical phone/pairing addresses.

On the phone scan the terminal QR with Camera/Scanner, confirm opening it in
**Vestibular Screening Aid**, or enter the printed HTTP address manually in the
development launcher. Do not scan into Expo Go: custom Kotlin modules require
this project's native app. If the scanner does not recognize the custom scheme,
manual URL entry works without another native rebuild. Do not press CLI `a` or
invoke `expo run:android`; these can try device access/ADB.

If loading fails, first open the computer's printed `http://<LAN-IP>:<port>/status`
in the phone browser: it should show `packager-status:running`. Check the same
Wi-Fi, guest-network isolation, VPN, firewall, and current IP. These are owner
checks; no phone inspection from the computer is authorized. Tunnel mode is not
required or started by this workflow.

Save a JS/TS edit while the app is idle: Fast Refresh normally applies it.
If needed, open the dev menu by shaking the phone and enable Fast Refresh or
choose Reload. Verify the visible update on the phone yourself. Keep source
unchanged during recording/analysis; reload and restart a physical test after
code changes, since preserved React state is not a valid measurement session.

## Which changes require a new APK?

| Change                                                                                                                | Action                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| React screens, styles, TS-only stimulus/calibration/signal/metric logic                                               | Fast Refresh; full Reload if state/module initialization changed |
| Pure JS dependencies, images imported by JS                                                                           | Metro refresh/restart as needed; no native build                 |
| Kotlin/Java, JNI, native-module API implementation, native dependency                                                 | Rebuild Development APK and install the update                   |
| Expo SDK / React Native version, Android manifest/permissions/package/scheme, config plugins, Gradle, app icon/splash | Prebuild + rebuild APK                                           |
| Metro/Babel config or `.env` values loaded by the bundler                                                             | Restart Metro; rebuild only if native config also changes        |

If the installed app predates the dev client/plugin or Batch 3 Kotlin fixes,
install the updated APK once. The current Home/message clarification is JS-only:
Fast Refresh in Development Build suffices; standalone testing needs the updated
embedded bundle supplied in `vestibular.apk`.
Changes to measurement math still require fresh physical calibration and tests;
Fast Refresh does not establish a VALID model or trustworthy metrics. Coordinate
contract changes must bump the calibration measurement version.

## Computer verification / remaining physical checks

Local verification covers strict type/lint/format, 14 regression suites, native
CV JVM checks, Expo dependency compatibility, APK binary checks, Metro manifest,
Android development bundle and HMR update delivery to a loopback test client.
No phone was accessed. APK installation, QR handling, Wi-Fi reachability and
visible Fast Refresh on Xiaomi remain owner checks. Calibration quality and
eye-test validity are unchanged by this workflow repair.

Official references: [Expo local development](https://docs.expo.dev/guides/local-app-development/),
[using development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/),
[Xiaomi unknown-app installation](https://www.mi.com/uk/support/faq/details/KA-06974/).

Independent offline physical testing/export remains available:
[Batch 3 verification](BATCH3_VALIDATION.md).
