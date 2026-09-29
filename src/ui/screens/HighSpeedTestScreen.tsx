import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { computeFrameTimingStats, formatValidationReport } from '../../camera/frameTiming';
import type { FrameTimingStats } from '../../camera/frameTiming';
import type { HighSpeedTestReport } from '../../camera/highSpeedCapture';
import {
  cancelHighSpeedTest,
  isHighSpeedCaptureAvailable,
  startHighSpeedTest,
} from '../../camera/highSpeedCapture';
import { getCamera2Capabilities } from '../../camera/camera2Probe';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type TestPhase = 'idle' | 'loading-modes' | 'ready' | 'running' | 'done' | 'error';

interface HighSpeedMode {
  cameraId: string;
  lensFacing: string;
  width: number;
  height: number;
  fpsMin: number;
  fpsMax: number;
  label: string;
}

/** P1 validation window: approximately 10 seconds per mode. */
const TEST_DURATION_SEC = 10;

/**
 * P2 architecture correction: FRONT 1920×1080 @ fixed 120fps is the primary
 * MVP eye-tracking candidate (user looks at the display); rear modes are
 * technical benchmarks. This only ORDERS actually-advertised fixed modes —
 * capability detection itself comes from Camera2, never from this list.
 */
function modePriority(mode: HighSpeedMode): number {
  if (mode.lensFacing === 'FRONT' && mode.width === 1920 && mode.fpsMax === 120) {
    return 0;
  }
  if (mode.lensFacing === 'BACK' && mode.width === 1920 && mode.fpsMax === 120) {
    return 1;
  }
  if (mode.width === 1280 && mode.height === 720 && mode.fpsMax === 120) {
    return 2;
  }
  if (mode.width === 1280 && mode.height === 720 && mode.fpsMax === 240) {
    return 3;
  }
  return 4;
}

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (!isHighSpeedCaptureAvailable()) {
    return 'unavailable';
  }
  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return 'granted';
  }
  const result = await PermissionsAndroid.request(permission, {
    title: 'Camera access for high-speed test',
    message:
      'P1 opens the physical camera to validate one advertised high-speed mode (~10 s recording). No other permission is requested.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'blocked';
  }
  return 'denied';
}

// P1 debug screen (Development Build on Android only). Technical validation:
// pick a Camera2-advertised fixed high-speed mode, record ~10 s, report
// session state + frame-timing statistics + recording status.
export default function HighSpeedTestScreen() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [modes, setModes] = useState<HighSpeedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [report, setReport] = useState<HighSpeedTestReport | null>(null);
  const [stats, setStats] = useState<FrameTimingStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadModes = useCallback(async () => {
    setPhase('loading-modes');
    setErrorMessage(null);
    try {
      const cameras = await getCamera2Capabilities();
      const found: HighSpeedMode[] = [];
      for (const camera of cameras) {
        if (!camera.constrainedHighSpeedVideoSupported) {
          continue;
        }
        for (const entry of camera.highSpeedVideoSizes) {
          for (const range of entry.fpsRanges) {
            // Fixed ranges only: high-speed capture needs an exact
            // advertised [fps, fps] range — never derive one from [min, max].
            if (range.min !== range.max) {
              continue;
            }
            found.push({
              cameraId: camera.cameraId,
              lensFacing: camera.lensFacing,
              width: entry.width,
              height: entry.height,
              fpsMin: range.min,
              fpsMax: range.max,
              label:
                `Cam ${camera.cameraId} ${camera.lensFacing} ` +
                `${entry.width}x${entry.height} [${range.min},${range.max}]`,
            });
          }
        }
      }
      found.sort((a, b) => {
        const priority = modePriority(a) - modePriority(b);
        if (priority !== 0) {
          return priority;
        }
        if (a.lensFacing !== b.lensFacing) {
          return a.lensFacing === 'BACK' ? -1 : 1;
        }
        return b.width * b.height - a.width * a.height;
      });
      setModes(found);
      setSelectedIndex(0);
      setPhase('ready');
      if (found.length === 0) {
        setErrorMessage('No fixed high-speed modes advertised by Camera2 on this device.');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await requestCameraPermission();
      if (cancelled) {
        return;
      }
      setPermission(state);
      if (state === 'granted') {
        await loadModes();
      }
    })();
    return () => {
      cancelled = true;
      void cancelHighSpeedTest();
    };
  }, [loadModes]);

  async function askPermission() {
    setPermission('checking');
    const state = await requestCameraPermission();
    setPermission(state);
    if (state === 'granted') {
      await loadModes();
    }
  }

  async function runTest() {
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    setPhase('running');
    setReport(null);
    setStats(null);
    setErrorMessage(null);
    try {
      const result = await startHighSpeedTest({
        cameraId: mode.cameraId,
        width: mode.width,
        height: mode.height,
        fpsMin: mode.fpsMin,
        fpsMax: mode.fpsMax,
        durationSec: TEST_DURATION_SEC,
      });
      setReport(result);
      try {
        setStats(computeFrameTimingStats(result.sensorTimestampsNs, mode.fpsMax));
      } catch (e) {
        setStats(null);
        setErrorMessage(
          `Test finished but timing stats need ≥2 timestamps ` +
            `(got ${result.sensorTimestampsNs.length})` +
            (e instanceof Error ? `: ${e.message}` : '.'),
        );
      }
      setPhase('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  async function stopTest() {
    await cancelHighSpeedTest();
  }

  const selectedMode = modes[selectedIndex] ?? null;
  const reportText =
    report !== null && stats !== null
      ? formatValidationReport({
          deviceModel: report.deviceModel,
          androidRelease: report.androidRelease,
          apiLevel: report.apiLevel,
          cameraId: report.cameraId,
          lensFacing: report.lensFacing,
          width: report.width,
          height: report.height,
          fpsMin: report.fpsMin,
          fpsMax: report.fpsMax,
          sessionState: report.sessionState,
          stats,
          recordingStatus: report.recordingStatus,
          filePath: report.filePath,
          extractorSampleCount: report.extractorSampleCount,
          extractorDurationUs: report.extractorDurationUs,
          error: report.error,
        })
      : null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="high-speed-test-screen"
    >
      <Text style={styles.title}>High-Speed Capture Validation (P1)</Text>
      <Text style={styles.note}>
        Development Build on Android only. Modes come from live Camera2 data; only exact advertised
        fixed ranges are offered. Records ~{TEST_DURATION_SEC} s per test.
      </Text>

      {permission === 'checking' && <Text style={styles.note}>Checking camera permission…</Text>}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="high-speed-unavailable">
          High-speed capture is unavailable here (needs an Expo Development Build on Android with
          the P1 native module). No camera was opened.
        </Text>
      )}

      {permission === 'denied' && (
        <View>
          <Text style={styles.error}>Camera permission denied — the test cannot run.</Text>
          <Button title="Request camera permission" onPress={askPermission} />
        </View>
      )}

      {permission === 'blocked' && (
        <View>
          <Text style={styles.error}>
            Camera permission permanently denied. Enable it in system Settings, then retry.
          </Text>
          <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
          <Button title="Retry permission check" onPress={askPermission} />
        </View>
      )}

      {permission === 'granted' && (phase === 'loading-modes' || phase === 'idle') && (
        <Text style={styles.note}>Enumerating Camera2 high-speed modes…</Text>
      )}

      {permission === 'granted' && modes.length > 0 && (
        <View>
          <Text style={styles.sectionTitle}>Mode (Camera2-advertised fixed ranges only)</Text>
          {modes.map((mode, index) => (
            <View key={mode.label} style={styles.modeRow}>
              <Button
                title={`${index === selectedIndex ? '● ' : ''}${mode.label}`}
                onPress={() => setSelectedIndex(index)}
                disabled={phase === 'running'}
              />
            </View>
          ))}
          {selectedMode !== null && (
            <Text style={styles.line}>
              Selected: camera {selectedMode.cameraId} ({selectedMode.lensFacing}),{' '}
              {selectedMode.width}x{selectedMode.height}, exact range [{selectedMode.fpsMin},
              {selectedMode.fpsMax}]
            </Text>
          )}
          {phase !== 'running' ? (
            <Button
              title={`Start ${TEST_DURATION_SEC}s test`}
              onPress={runTest}
              disabled={phase === 'loading-modes'}
            />
          ) : (
            <Button title="Stop test" onPress={stopTest} />
          )}
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="high-speed-error">
          {errorMessage}
        </Text>
      )}

      {reportText !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Validation report (long-press to copy)</Text>
          <Text style={styles.mono} selectable testID="high-speed-report">
            {reportText}
          </Text>
        </View>
      )}

      {report !== null && stats === null && phase === 'done' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Raw native report (no timing stats)</Text>
          <Text style={styles.mono} selectable>
            {JSON.stringify(report, null, 2)}
          </Text>
        </View>
      )}

      {report !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Session events (raw)</Text>
          {report.sessionEvents.map((event, index) => (
            <Text key={`${index}-${event}`} style={styles.mono}>
              {event}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: '#ccc',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
    width: '100%',
  },
  content: {
    alignItems: 'stretch',
    padding: 16,
  },
  error: {
    color: '#b00020',
    fontSize: 13,
    marginTop: 8,
  },
  line: {
    fontSize: 13,
    marginTop: 8,
  },
  modeRow: {
    marginVertical: 2,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  note: {
    fontSize: 12,
    marginBottom: 8,
    opacity: 0.7,
  },
  root: {
    flex: 1,
    width: '100%',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
});
