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
import type { FixedMode } from '../../camera/fixedModes';
import { collectFixedModes } from '../../camera/fixedModes';
import type { HighSpeedTestReport } from '../../camera/highSpeedCapture';
import { cancelHighSpeedTest, isHighSpeedCaptureAvailable } from '../../camera/highSpeedCapture';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import CameraImageGallery from '../components/CameraImageGallery';
import CameraCapturePanel from '../components/CameraCapturePanel';
import {
  CameraButton as Button,
  CameraConditions,
  CameraDetails,
  CameraProgress,
  CameraSummary,
  cameraConditionHint,
} from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import type { PupilBatchReport } from '../../camera/pupilDetector';
import { isPupilDetectorAvailable, runPupilBatch } from '../../camera/pupilDetector';
import type { PupilDetectionResult, PupilDetectorId } from '../../eyetracking/pupil/pupilTypes';
import {
  aggregatePupilStats,
  formatPupilReport,
  pupilDetectionVerdict,
} from '../../eyetracking/pupil/pupilReport';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type Phase =
  'idle' | 'loading-modes' | 'ready' | 'recording' | 'analyzing' | 'detecting' | 'done' | 'error';

/** P3 validation window: approximately 10 seconds per condition. */
const TEST_DURATION_SEC = 10;

/**
 * P3 pupil ROI sample: 40 evenly distributed offline frames (≤80 eye slots).
 * The P2 decoder is reused untouched; pupil detection runs per usable ROI.
 */
const PUPIL_SAMPLE_COUNT = 40;

const DETECTORS: PupilDetectorId[] = ['percentile-dark', 'contrast-normalized'];

/** Gaze/posture conditions the operator performs during the ~10 s capture. */
const CONDITIONS = ['center', 'left', 'right', 'up', 'down', 'blink', 'head-move'] as const;
type Condition = (typeof CONDITIONS)[number];

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (
    !isHighSpeedCaptureAvailable() ||
    !isFramePipelineAvailable() ||
    !isPupilDetectorAvailable()
  ) {
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

interface DetectorRun {
  detectorId: PupilDetectorId;
  results: PupilDetectionResult[];
  batch: PupilBatchReport | null;
}

// P3 debug screen (Development Build on Android only). Flow: record ~10 s
// with FRONT 1080p120 under one gaze condition → P2 decode + eye ROI
// (decoder untouched, ML Kit = ROI only) → pupil batch for BOTH candidate
// detectors → per-detector coverage/confidence/failure statistics. No gaze
// estimation, no clinical metrics: centroid movement is never interpreted.
export default function PupilValidationScreen() {
  const camera = usePreviewCapture();
  const runInProgress = useRef(false);
  const screenMounted = useRef(true);
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [capturedCondition, setCapturedCondition] = useState<Condition>('center');
  const [condition, setCondition] = useState<Condition>('center');
  const [capture, setCapture] = useState<HighSpeedTestReport | null>(null);
  const [pipeline, setPipeline] = useState<FramePipelineReport | null>(null);
  const [runs, setRuns] = useState<DetectorRun[]>([]);
  const [auditPassed, setAuditPassed] = useState(false);
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

  async function runRecordAnalyzeDetect() {
    if (runInProgress.current) return;
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    runInProgress.current = true;
    setCapturedCondition(condition);
    setPhase('recording');
    setCapture(null);
    setPipeline(null);
    setRuns([]);
    setAuditPassed(false);
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
        faceSampleCount: PUPIL_SAMPLE_COUNT,
        saveDebugFrames: false,
      });
      if (!screenMounted.current) return;
      setPipeline(analysis);
      if (!screenMounted.current) return;
      setPhase('detecting');
      const completed: DetectorRun[] = [];
      for (const detectorId of DETECTORS) {
        const { results, report } = await runPupilBatch({
          filePath: result.filePath,
          faceSamples: analysis.faceSamples,
          detectorId,
          saveOverlays: true,
          condition,
        });
        if (!screenMounted.current) return;
        completed.push({ detectorId, results, batch: report });
      }
      setRuns(completed);
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

  const busy = phase === 'recording' || phase === 'analyzing' || phase === 'detecting';

  function reportFor(run: DetectorRun): string {
    const byKey = new Map<string, string>();
    for (const r of run.results) {
      byKey.set(`${r.frameIndex}:${r.eyeSide}`, capturedCondition);
    }
    const stats = aggregatePupilStats(run.results, byKey);
    const verdict = pupilDetectionVerdict({ stats, visualAuditPassed: auditPassed });
    return formatPupilReport({
      stats,
      verdict,
      captureLabel: `${capture?.width}x${capture?.height} [${capture?.fpsMin},${capture?.fpsMax}] condition=${capturedCondition}`,
    });
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="pupil-validation-screen"
    >
      <Text style={styles.title}>Kiểm tra đồng tử</Text>
      <Text style={styles.note}>
        Chọn hướng nhìn, căn mặt rồi quay 10 giây. App sẽ kiểm tra đồng tử trong video.
      </Text>

      {permission === 'checking' && <CameraProgress title="Đang kiểm tra quyền camera…" />}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="pupil-validation-unavailable">
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
          <Text style={styles.sectionTitle}>Bài thực hiện trong lúc quay</Text>
          <CameraConditions
            values={CONDITIONS}
            selected={condition}
            onSelect={setCondition}
            disabled={busy || camera.stage === 'countdown' || camera.stage === 'recording'}
          />
          <CameraCapturePanel
            camera={camera}
            modes={modes}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onCapture={runRecordAnalyzeDetect}
            busy={busy}
            phase={phase}
            requireFace={true}
            instruction={cameraConditionHint(condition)}
          />
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="pupil-validation-error">
          {errorMessage}
        </Text>
      )}

      {runs.length > 0 && (
        <CameraSummary
          title="Đã phân tích đồng tử"
          detail="Xem kết quả từng phương pháp và ảnh kiểm tra bên dưới. Kết quả này chưa phải đánh giá lâm sàng."
        />
      )}
      {runs.map((run) => (
        <CameraImageGallery
          key={run.detectorId}
          paths={run.batch?.overlayPaths ?? []}
          title={'Ảnh kiểm tra · ' + run.detectorId}
        />
      ))}
      {(capture !== null || runs.length > 0) && (
        <CameraDetails>
          {capture !== null && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Capture (P1 module)</Text>
              <Text style={styles.mono}>File: {capture.filePath ?? '(none)'}</Text>
            </View>
          )}

          {pipeline !== null && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Eye ROI input (P2 pass)</Text>
              <Text style={styles.mono}>
                Face samples: {pipeline.faceSamples.length} rate={pipeline.faceDetectionRate ?? '?'}{' '}
                both-eyes={pipeline.bothEyesUsableRate ?? '?'}
              </Text>
            </View>
          )}

          {runs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Visual audit (required for PASS)</Text>
              <Text style={styles.note}>
                Inspect the overlay JPEGs in the device-local cache (`pupildebug/`): the red
                crosshair must visibly fall on the pupil in representative successful samples.
                Toggle only after auditing — never before.
              </Text>
              <Button
                title={
                  auditPassed ? '✓ Đã kiểm tra vị trí đồng tử trên ảnh' : 'Xác nhận đã kiểm tra ảnh'
                }
                onPress={() => setAuditPassed((v) => !v)}
              />
            </View>
          )}

          {runs.map((run) => (
            <View key={run.detectorId} style={styles.card}>
              <Text style={styles.sectionTitle}>
                P3 report — {run.detectorId} (long-press to copy)
              </Text>
              <Text style={styles.mono} selectable testID={`pupil-report-${run.detectorId}`}>
                {reportFor(run)}
              </Text>
              <Text style={styles.mono}>
                Overlays: {run.batch?.overlayPaths.length ?? 0} warnings:{' '}
                {(run.batch?.warnings.length ?? 0) > 0
                  ? (run.batch?.warnings.slice(0, 3).join(' | ') ?? '')
                  : '(none)'}
              </Text>
              {run.results.slice(0, 10).map((r) => (
                <Text key={`${run.detectorId}-${r.frameIndex}-${r.eyeSide}`} style={styles.mono}>
                  f{r.frameIndex} {r.eyeSide} n=({r.normalizedX?.toFixed(3) ?? '?'},
                  {r.normalizedY?.toFixed(3) ?? '?'}) conf={r.confidence.toFixed(2)}{' '}
                  {r.failureReason ?? 'OK'}
                </Text>
              ))}
            </View>
          ))}
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
  conditionButton: {
    margin: 2,
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
