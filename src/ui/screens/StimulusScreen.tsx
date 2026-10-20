import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import { collectFixedModes, type FixedMode } from '../../camera/fixedModes';
import { isLivePreviewAvailable } from '../../camera/livePreview';
import { assertCurrentPupilDetector } from '../../camera/pupilDetector';
import {
  completeEyeTestRecording,
  sampleStimulusClock,
} from '../../tests/stimulus/sessionAnalysis';
import {
  beginStimulus,
  defaultStimulus,
  finishStimulus,
  recordPresentation,
  targetAt,
  type StimulusRun,
  type TargetPosition,
} from '../../tests/stimulus/engine';
import type { MvpTestId } from '../../tests/types';
import { loadCalibration } from '../../storage/calibrationStore';
import {
  calibrationUsable,
  sameCalibrationContext,
} from '../../eyetracking/calibration/calibration';
import type { ClockBridge } from '../../tests/stimulus/synchronization';
import {
  CALIBRATION_COORDINATE_VERSION,
  type CalibrationContext,
} from '../../eyetracking/calibration/types';
import type { EyeTrace } from '../../clinic/types';
import { deleteRecordingFile } from '../../clinic/vault';
import type { EyeTestResult } from '../../tests/metrics/types';
import { validationFailureCode, type ValidationFailureCode } from '../../tests/validation/failures';
import EyeTestResults from '../components/EyeTestResults';
import CameraCapturePanel from '../components/CameraCapturePanel';
import { CameraButton, CameraDetails } from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import { measureTargetViewport } from '../hooks/measureTargetViewport';
import { useEyeAnalysisAwake } from '../hooks/useEyeAnalysisAwake';

const nowUs = () => performance.now() * 1000;
export default function StimulusScreen({
  fixedTestId,
  onComplete,
  onFailure,
  clinicMode = false,
  discardRecording = false,
}: {
  fixedTestId?: MvpTestId;
  onComplete?: (
    result: EyeTestResult,
    trace: EyeTrace[],
    capture: { fps: number | null; durationMs: number | null },
  ) => void;
  onFailure?: (code: ValidationFailureCode) => void;
  clinicMode?: boolean;
  discardRecording?: boolean;
} = {}) {
  const camera = usePreviewCapture();
  const [testId, setTestId] = useState<MvpTestId>(fixedTestId ?? 'smooth-pursuit');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  useEyeAnalysisAwake(busy);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState<(TargetPosition & { requestedElapsedUs: number }) | null>(
    null,
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [report, setReport] = useState('');
  const [result, setResult] = useState<EyeTestResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRef<StimulusRun | null>(null);
  const raf = useRef<number | null>(null);
  const viewport = useRef({ width: 0, height: 0 });
  const mounted = useRef(true);
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const board = useRef<View>(null);

  function stop(cancelled = true) {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (run.current) finishStimulus(run.current, nowUs(), cancelled);
    if (mounted.current) {
      setTarget(null);
      setRunning(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      stop();
    };
  }, []);
  useEffect(() => {
    // Early-stop feedback is immediate, without waiting for MP4 finalization.
    if (camera.stage === 'finishing') stop(true);
  }, [camera.stage]);
  useLayoutEffect(() => {
    if (target && run.current)
      recordPresentation(run.current, target, target.requestedElapsedUs, nowUs());
  }, [target]);

  function start(display = size) {
    stop();
    viewport.current = { width: display.width, height: display.height };
    run.current = beginStimulus(defaultStimulus(testId), nowUs());
    setRunning(true);
    scroll.current?.scrollTo({ y: 0, animated: false });
    const tick = () => {
      const current = run.current;
      if (!mounted.current || !current || current.outcome !== 'running') return;
      const elapsed = nowUs() - current.startJsUs;
      const next = targetAt(current.config, elapsed);
      if (next === null) {
        stop(false);
        return;
      }
      setTarget({ ...next, requestedElapsedUs: elapsed });
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }
  async function loadCamera() {
    setError(null);
    try {
      assertCurrentPupilDetector();
      if (Platform.OS !== 'android' || !isLivePreviewAvailable())
        throw new Error('Cần Android Development Build.');
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED)
        throw new Error('Chưa được cấp quyền camera.');
      const probe = await getCamera2Capabilities();
      if (!mounted.current) return;
      setModes(collectFixedModes(probe).filter((m) => m.lensFacing === 'FRONT'));
    } catch (e) {
      if (mounted.current) {
        setError(String(e));
        onFailure?.('CAMERA_PREPARATION_FAILED');
      }
    }
  }
  async function capture(diagnostic = false) {
    if (lock.current || !modes[index]) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setReport('');
    setResult(null);
    setMessage('Kiểm tra calibration và chuẩn bị ghi hình…');
    let recordedPath: string | null = null;
    try {
      const mode = modes[index];
      scroll.current?.scrollTo({ y: 0, animated: false });
      const display = await measureTargetViewport(board, {
        ready: () => Math.abs(scrollOffset.current) < 0.5,
        cancelled: () => !mounted.current,
      });
      const context: CalibrationContext = {
        cameraId: mode.cameraId,
        width: mode.width,
        height: mode.height,
        fps: mode.fpsMax,
        viewportWidth: display.width,
        viewportHeight: display.height,
        viewportLeft: display.left,
        viewportTop: display.top,
        detectorId: 'percentile-dark',
        coordinateVersion: CALIBRATION_COORDINATE_VERSION,
      };
      const calibration = await loadCalibration();
      if (
        !diagnostic &&
        !clinicMode &&
        (!calibration || !calibrationUsable(calibration, context, Date.now()))
      )
        throw new Error(
          'INVALID — Cần calibration đạt chất lượng cho camera và vùng target này. Quay lại Home → Hiệu chỉnh mắt, rồi thử lại. Có thể ghi debug để kiểm tra tracking; metric sẽ N/A.',
        );
      let bridge: ClockBridge | null = null;
      let recordedAtMs = Date.now();
      const captureReport = await camera.capture(mode, 10, async (isCancelled) => {
        const currentDisplay = await measureTargetViewport(board, {
          ready: () => Math.abs(scrollOffset.current) < 0.5,
          cancelled: isCancelled,
        });
        if (isCancelled()) throw new CaptureCancelled('Đã hủy test.');
        const currentContext: CalibrationContext = {
          ...context,
          viewportWidth: currentDisplay.width,
          viewportHeight: currentDisplay.height,
          viewportLeft: currentDisplay.left,
          viewportTop: currentDisplay.top,
        };
        if (!sameCalibrationContext(context, currentContext))
          throw new Error('Vùng target đã thay đổi khi đếm ngược. Căn lại màn hình và thử lại.');
        bridge = await sampleStimulusClock();
        if (isCancelled()) throw new CaptureCancelled('Đã hủy test.');
        recordedAtMs = Date.now();
        if (
          !diagnostic &&
          !clinicMode &&
          (!calibration || !calibrationUsable(calibration, context, recordedAtMs))
        )
          throw new Error('Calibration đã hết hạn. Hãy hiệu chỉnh lại.');
        start(currentDisplay);
      });
      const session = run.current;
      recordedPath = captureReport.filePath ?? null;
      stop(captureReport.manualStop);
      await camera.close();
      if (!mounted.current || session === null || !captureReport.filePath || bridge === null) {
        if (discardRecording) await deleteRecordingFile(captureReport.filePath);
        return;
      }
      setMessage('Đang tracking → calibration → xử lý tín hiệu → metric. Có thể mất vài phút.');
      const analysis = await completeEyeTestRecording({
        session,
        capture: captureReport,
        bridge,
        viewport: viewport.current,
        calibration,
        context,
        recordedAtMs,
      });
      if (discardRecording) {
        await deleteRecordingFile(captureReport.filePath);
        await deleteRecordingFile(analysis.signal.path);
      }
      if (mounted.current) {
        setResult(analysis.result);
        setReport(JSON.stringify(analysis, null, 2));
        setMessage(
          clinicMode ? 'Đã xử lý. Video gốc đã xóa.' : 'Đã phân tích và lưu dữ liệu debug.',
        );
        onComplete?.(analysis.result, analysis.trace, {
          fps: mode.fpsMax,
          durationMs: captureReport.manualStop ? null : 10_000,
        });
      }
    } catch (e) {
      if (discardRecording) await deleteRecordingFile(recordedPath);
      if (mounted.current) onFailure?.(validationFailureCode(e));
      stop();
      if (mounted.current) {
        setMessage(
          e instanceof CaptureCancelled ? 'Đã hủy test.' : 'Test chưa hoàn thành / không hợp lệ.',
        );
        if (!(e instanceof CaptureCancelled)) setError(String(e));
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ScrollView
      ref={scroll}
      scrollEnabled={!running && !busy}
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrollOffset.current = event.nativeEvent.contentOffset.y;
      }}
      contentContainerStyle={styles.content}
      testID="stimulus-screen"
    >
      <View
        ref={board}
        style={styles.board}
        onLayout={(e) => {
          if (
            running &&
            size.width > 0 &&
            (size.width !== e.nativeEvent.layout.width ||
              size.height !== e.nativeEvent.layout.height)
          ) {
            stop();
            void camera.stop();
          }
          setSize(e.nativeEvent.layout);
        }}
        testID="stimulus-board"
      >
        {target && (
          <View
            testID="stimulus-target"
            style={[
              styles.target,
              { left: target.x * size.width - 10, top: target.y * size.height - 10 },
            ]}
          />
        )}
        {!target && <Text style={styles.wait}>Mục tiêu sẽ xuất hiện khi bắt đầu.</Text>}
      </View>
      {busy && ['countdown', 'recording'].includes(camera.stage) && (
        <CameraButton
          title={camera.stage === 'countdown' ? 'Hủy đếm ngược' : 'Dừng và lưu test (không hợp lệ)'}
          tone="danger"
          onPress={() => {
            stop(true);
            void camera.stop();
          }}
        />
      )}
      <Text style={styles.title}>Smooth Pursuit & Horizontal Saccade</Text>
      <Text>Giữ đầu ổn định và nhìn theo chấm vàng trong 10 giây.</Text>
      <Text>
        Ghi bài mắt yêu cầu calibration đạt chất lượng, còn hạn và cùng camera/vùng target. Hiệu
        chỉnh trước tại Home.
      </Text>
      {!fixedTestId && (
        <>
          <CameraButton
            title="Smooth Pursuit"
            disabled={busy || running}
            onPress={() => setTestId('smooth-pursuit')}
          />
          <CameraButton
            title="Horizontal Saccade"
            disabled={busy || running}
            onPress={() => setTestId('horizontal-saccades')}
          />
        </>
      )}
      <Text>Bài đã chọn: {testId}</Text>
      {message !== '' && <Text accessibilityLiveRegion="polite">{message}</Text>}
      {!clinicMode && (
        <CameraButton
          title={running ? 'Dừng mục tiêu' : 'Thử mục tiêu (không ghi video)'}
          disabled={busy}
          onPress={() => (running ? stop() : start())}
        />
      )}
      {modes.length === 0 && (
        <CameraButton title="Chuẩn bị camera trước" onPress={() => void loadCamera()} />
      )}
      {modes.length > 0 && (
        <CameraCapturePanel
          camera={camera}
          modes={modes}
          selectedIndex={index}
          onSelect={setIndex}
          onCapture={() => void capture()}
          busy={busy || running}
          phase={busy ? 'analyzing' : 'ready'}
        />
      )}
      {!fixedTestId && modes.length > 0 && (
        <CameraButton
          title="Ghi debug (cho phép thiếu calibration)"
          disabled={busy || running || camera.stage !== 'preview'}
          onPress={() => void capture(true)}
        />
      )}
      {error && (
        <>
          <Text selectable>{error}</Text>
          <CameraButton
            title="Mở cài đặt quyền camera"
            onPress={() => void Linking.openSettings()}
          />
        </>
      )}
      {!clinicMode && report !== '' && (
        <>
          {result && <EyeTestResults result={result} />}
          <CameraDetails title="Metric, signal & timeline JSON">
            <Text selectable>{report}</Text>
          </CameraDetails>
        </>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 160 },
  title: { fontSize: 24, fontWeight: '700' },
  board: {
    height: 180,
    backgroundColor: '#142D3D',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  target: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFE066',
  },
  wait: { color: '#FFF' },
});
