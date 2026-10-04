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

import type { FramePipelineReport } from '../../camera/framePipeline';
import { analyzeVideoFile, isFramePipelineAvailable } from '../../camera/framePipeline';
import { formatFramePipelineReport } from '../../camera/framePipelineReport';
import type { FixedMode } from '../../camera/fixedModes';
import { collectFixedModes } from '../../camera/fixedModes';
import type { HighSpeedTestReport } from '../../camera/highSpeedCapture';
import { cancelHighSpeedTest, isHighSpeedCaptureAvailable } from '../../camera/highSpeedCapture';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import CameraImageGallery from '../components/CameraImageGallery';
import CameraCapturePanel from '../components/CameraCapturePanel';
import {
  CameraButton as Button,
  CameraDetails,
  CameraProgress,
  CameraSummary,
} from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type Phase = 'idle' | 'loading-modes' | 'ready' | 'recording' | 'analyzing' | 'done' | 'error';

/** P2 validation window: approximately 10 seconds per mode. */
const TEST_DURATION_SEC = 10;

/** P2 validation ROI sample: 64 evenly distributed offline frames (50–100 target, never realtime). */
const FACE_SAMPLE_COUNT = 64;

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (!isHighSpeedCaptureAvailable() || !isFramePipelineAvailable()) {
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

// P2 debug screen (Development Build on Android only). Flow: record ~10 s with
// a Camera2-advertised fixed mode (FRONT 1080p120 default), then decode the
// MP4 offline via MediaExtractor + MediaCodec, validate the media timeline,
// check for frozen frames via luminance MAD, and sample face/eye ROI via
// ML Kit (feasibility boxes only — NOT pupil tracking).
export default function FramePipelineScreen() {
  const camera = usePreviewCapture();
  const runInProgress = useRef(false);
  const screenMounted = useRef(true);
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [capture, setCapture] = useState<HighSpeedTestReport | null>(null);
  const [pipeline, setPipeline] = useState<FramePipelineReport | null>(null);
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

  async function runRecordAndAnalyze() {
    if (runInProgress.current) return;
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    runInProgress.current = true;
    setPhase('recording');
    setCapture(null);
    setPipeline(null);
    setErrorMessage(null);
    try {
      const result = await camera.capture(mode, TEST_DURATION_SEC);
      await camera.close();
      if (!screenMounted.current) return;
      setCapture(result);
      if (!result.filePath) {
        setErrorMessage('Không lưu được video. Hãy mở lại camera và quay lại.');
        setPhase('error');
        return;
      }
      if (!screenMounted.current) return;
      setPhase('analyzing');
      const analysis = await analyzeVideoFile({
        filePath: result.filePath,
        expectedFps: mode.fpsMax,
        faceSampleCount: FACE_SAMPLE_COUNT,
        saveDebugFrames: true,
      });
      if (!screenMounted.current) return;
      setPipeline(analysis);
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

  async function analyzeLastRecording() {
    if (runInProgress.current) return;
    const mode = modes[selectedIndex];
    if (!mode || !capture?.filePath) {
      return;
    }
    runInProgress.current = true;
    setPhase('analyzing');
    setPipeline(null);
    setErrorMessage(null);
    try {
      const analysis = await analyzeVideoFile({
        filePath: capture.filePath,
        expectedFps: capture.fpsMax,
        faceSampleCount: FACE_SAMPLE_COUNT,
        saveDebugFrames: true,
      });
      if (!screenMounted.current) return;
      setPipeline(analysis);
      setPhase('done');
    } catch (e) {
      if (!screenMounted.current) return;
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      runInProgress.current = false;
    }
  }

  const selectedMode = modes[selectedIndex] ?? null;
  const reportText =
    capture !== null && pipeline !== null && selectedMode !== null
      ? formatFramePipelineReport({
          deviceModel: capture.deviceModel,
          androidRelease: capture.androidRelease,
          apiLevel: capture.apiLevel,
          cameraLabel: `${capture.cameraId} ${capture.lensFacing}`,
          captureLabel: `${capture.width}x${capture.height} [${capture.fpsMin},${capture.fpsMax}]`,
          expectedFps: capture.fpsMax,
          report: pipeline,
        })
      : null;
  const busy = phase === 'recording' || phase === 'analyzing';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="frame-pipeline-screen"
    >
      <Text style={styles.title}>Phân tích video & vùng mắt</Text>
      <Text style={styles.note}>
        Căn mặt trong camera, quay 10 giây, rồi kiểm tra khung hình và vùng mắt trong video.
      </Text>

      {permission === 'checking' && <CameraProgress title="Đang kiểm tra quyền camera…" />}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="frame-pipeline-unavailable">
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
            onCapture={runRecordAndAnalyze}
            busy={busy}
            phase={phase}
            requireFace={true}
            instruction={'Căn mặt trước khi quay. Video được lưu trên điện thoại.'}
          />
          <Button
            title="Re-analyze last recording"
            tone="secondary"
            onPress={analyzeLastRecording}
            disabled={busy || !capture?.filePath || camera.stage !== 'closed'}
          />
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="frame-pipeline-error">
          {errorMessage}
        </Text>
      )}

      {pipeline && (
        <CameraSummary
          title="Đã phân tích video"
          detail={
            'Đã giải mã ' +
            pipeline.decodedFrameCount +
            ' khung hình. Tốc độ: ' +
            (pipeline.effectiveFps?.toFixed(2) ?? 'chưa có') +
            ' fps.'
          }
        />
      )}
      {pipeline && (
        <CameraImageGallery paths={pipeline.savedFramePaths} title="Ảnh từ video vừa quay" />
      )}
      {(capture !== null || pipeline !== null) && (
        <CameraDetails>
          {capture !== null && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Capture (P1 module)</Text>
              <Text style={styles.mono}>File: {capture.filePath ?? '(none)'}</Text>
              <Text style={styles.mono}>
                Encoder cross-check: samples={capture.extractorSampleCount ?? '?'} durationUs=
                {capture.extractorDurationUs ?? '?'}
              </Text>
            </View>
          )}

          {reportText !== null && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>P2 report (long-press to copy)</Text>
              <Text style={styles.mono} selectable testID="frame-pipeline-report">
                {reportText}
              </Text>
            </View>
          )}

          {pipeline !== null && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Face samples (numeric metadata only)</Text>
              {pipeline.faceSamples.map((s) => (
                <Text key={`face-${s.frameIndex}`} style={styles.mono}>
                  f{s.frameIndex} ptsUs={s.ptsUs ?? '?'} face={s.faceDetected ? 'yes' : 'no'}
                  {' L='}
                  {s.leftEye !== null ? `${s.leftEye.width}x${s.leftEye.height}` : '-'}
                  {' R='}
                  {s.rightEye !== null ? `${s.rightEye.width}x${s.rightEye.height}` : '-'}
                </Text>
              ))}
              <Text style={styles.mono}>Debug frames: {pipeline.savedFramePaths.length}</Text>
              <Text style={styles.mono}>Eye crops: {pipeline.savedCropPaths.length}</Text>
            </View>
          )}
        </CameraDetails>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  buttonGap: {
    marginTop: 8,
  },
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
  gap: {
    height: 8,
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
