import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { cancelHighSpeedTest, isHighSpeedCaptureAvailable } from '../../camera/highSpeedCapture';
import type { FixedMode } from '../../camera/fixedModes';
import { collectFixedModes } from '../../camera/fixedModes';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import CameraCapturePanel from '../components/CameraCapturePanel';
import {
  CameraButton as Button,
  CameraDetails,
  CameraProgress,
  CameraSummary,
} from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type TestPhase = 'idle' | 'loading-modes' | 'ready' | 'running' | 'done' | 'error';

type HighSpeedMode = FixedMode;
const TEST_DURATION_SEC = 10;

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
    title: 'Cho phép dùng camera',
    message:
      'App cần camera để xem trước và ghi video kiểm tra mắt. Video được lưu trên điện thoại, không ghi âm.',
    buttonPositive: 'Cho phép',
    buttonNegative: 'Để sau',
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
  const camera = usePreviewCapture();
  const runInProgress = useRef(false);
  const screenMounted = useRef(true);
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
      const found = collectFixedModes(cameras);
      setModes(found);
      setSelectedIndex(0);
      setPhase('ready');
      if (found.length === 0) {
        setErrorMessage('Thiết bị chưa cung cấp chế độ camera tốc độ cao cố định.');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    screenMounted.current = true;
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
      screenMounted.current = false;
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
    if (runInProgress.current) return;
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    runInProgress.current = true;
    setPhase('running');
    setReport(null);
    setStats(null);
    setErrorMessage(null);
    try {
      const result = await camera.capture(mode, TEST_DURATION_SEC);
      await camera.close();
      if (!screenMounted.current) return;
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
      if (!screenMounted.current) return;
      setErrorMessage(
        e instanceof CaptureCancelled ? null : e instanceof Error ? e.message : String(e),
      );
      setPhase(e instanceof CaptureCancelled ? 'ready' : 'error');
    } finally {
      runInProgress.current = false;
    }
  }

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
      <Text style={styles.title}>Kiểm tra ghi hình</Text>
      <Text style={styles.note}>
        Xem camera trực tiếp, đếm ngược 3 giây, rồi quay video 10 giây để kiểm tra chất lượng ghi
        hình.
      </Text>

      {permission === 'checking' && <CameraProgress title="Đang kiểm tra quyền camera…" />}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="high-speed-unavailable">
          Cần bản Android có chức năng camera và phân tích này. Hãy cài bản app mới nhất.
        </Text>
      )}

      {permission === 'denied' && (
        <View>
          <Text style={styles.error}>Cần quyền camera để xem trước và ghi hình.</Text>
          <Button title="Request camera permission" onPress={askPermission} />
        </View>
      )}

      {permission === 'blocked' && (
        <View>
          <Text style={styles.error}>
            Quyền camera đang tắt. Mở cài đặt, cho phép camera rồi kiểm tra lại.
          </Text>
          <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
          <Button title="Retry permission check" onPress={askPermission} />
        </View>
      )}

      {permission === 'granted' && (phase === 'loading-modes' || phase === 'idle') && (
        <Text style={styles.note}>Đang đọc chế độ camera của thiết bị…</Text>
      )}

      {permission === 'granted' && phase === 'ready' && modes.length === 0 && (
        <CameraSummary
          title="Chưa tìm thấy chế độ ghi hình"
          detail={errorMessage ?? 'Thiết bị chưa cung cấp chế độ phù hợp.'}
        />
      )}
      {permission === 'granted' &&
        (phase === 'error' || (phase === 'ready' && modes.length === 0)) && (
          <Button
            title="Tải lại chế độ camera"
            tone="secondary"
            onPress={() => void loadModes()}
            disabled={camera.stage !== 'closed'}
          />
        )}

      {permission === 'granted' && modes.length > 0 && (
        <View>
          <CameraCapturePanel
            camera={camera}
            modes={modes}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onCapture={runTest}
            busy={phase === 'running'}
            phase={phase}
            requireFace={false}
            instruction={'Căn mặt trước khi quay. Video được lưu trên điện thoại.'}
          />
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="high-speed-error">
          {errorMessage}
        </Text>
      )}

      {report && (
        <CameraSummary
          title={
            report.recordingStatus === 'SUCCESS'
              ? 'Đã lưu video kiểm tra'
              : 'Ghi hình chưa hoàn tất'
          }
          detail={
            'Số khung hình video: ' +
            (report.extractorSampleCount ?? 'chưa có') +
            '. Đếm theo video đã mã hóa; nhịp callback camera được báo riêng trong chi tiết.'
          }
        />
      )}
      {report !== null && (
        <CameraDetails>
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
        </CameraDetails>
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
    // Clearance above the phone system navigation bar so no button ends up
    // underneath it and untappable.
    paddingBottom: 160,
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
    fontSize: 14,
    marginBottom: 12,
    color: '#526A78',
    lineHeight: 21,
  },
  root: {
    flex: 1,
    backgroundColor: '#F4F8FA',
    width: '100%',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  title: {
    color: '#142D3D',
    fontSize: 25,
    fontWeight: '700',
    marginBottom: 8,
  },
});
