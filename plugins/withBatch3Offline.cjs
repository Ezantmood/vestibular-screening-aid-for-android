const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withBatch3Offline(config) {
  config = withAppBuildGradle(config, (mod) => {
    const marker = '// Batch 3 standalone verification APK';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n${marker}
android {
    buildTypes {
        batch3 {
            initWith release
            matchingFallbacks = ['release']
            debuggable false
            signingConfig signingConfigs.debug
        }
    }
}
`;
    }
    const clinician = 'clinician {';
    if (!mod.modResults.contents.includes(clinician)) {
      mod.modResults.contents += `
android {
    buildTypes {
        clinician {
            initWith release
            matchingFallbacks = ['release']
            debuggable false
            signingConfig signingConfigs.debug
        }
    }
}
`;
    }
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'batch3');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'AndroidManifest.xml'),
        `
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET" tools:node="remove" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove" />
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove" />
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <application android:allowBackup="false" tools:replace="android:allowBackup" />
</manifest>
`,
      );
      return mod;
    },
  ]);
};
