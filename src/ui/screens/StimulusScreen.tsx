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
import { collectFixedModes, portraitFaceRotation, type FixedMode } from '../../camera/fixedModes';
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
import {
  CALIBRATION_FRAMING_GATES,
  CALIBRATION_PREVIEW_ASPECT,
  calibrationFramingHint,
} from '../../eyetracking/calibration/geometry';
import TargetStage from '../components/TargetStage';
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
  const [scrollLocked, setScrollLocked] = useState(false);
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
  const cancelled = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const board = useRef<View>(null);
  const bounds = useRef<View>(null);
  const layoutLocked = useRef(false);

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
      if (state !== 'active') {
        cancelled.current = true;
        stop();
      }
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
    cancelled.current = false;
    setBusy(true);
    setScrollLocked(true);
    layoutLocked.current = false;
    setError(null);
    setReport('');
    setResult(null);
    setMessage('Kiểm tra calibration và chuẩn bị ghi hình…');
    let recordedPath: string | null = null;
    try {
      const mode = modes[index];
      const display = await measureTargetViewport(
        board,
        {
          cancelled: () => cancelled.current || !mounted.current,
        },
        bounds,
      );
      viewport.current = { width: display.width, height: display.height };
      layoutLocked.current = true;
      const context: CalibrationContext = {
        cameraId: mode.cameraId,
        width: mode.width,
        height: mode.height,
        fps: mode.fpsMax,
        faceRotationDegrees: portraitFaceRotation(mode),
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
        const currentDisplay = await measureTargetViewport(
          board,
          {
            cancelled: () => isCancelled() || cancelled.current || !mounted.current,
          },
          bounds,
        );
        if (isCancelled() || cancelled.current) throw new CaptureCancelled('Đã hủy test.');
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
        if (isCancelled() || cancelled.current) throw new CaptureCancelled('Đã hủy test.');
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
      layoutLocked.current = false;
      await camera.close();
      if (mounted.current) {
        setScrollLocked(false);
        requestAnimationFrame(() => {
          scroll.current?.scrollTo({ y: 0, animated: false });
        });
      }
      if (
        cancelled.current ||
        !mounted.current ||
        session === null ||
        !captureReport.filePath ||
        bridge === null
      ) {
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
      layoutLocked.current = false;
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setScrollLocked(false);
      }
    }
  }
  async function previewTargets() {
    cancelled.current = false;
    if (running) {
      stop();
      return;
    }
    setScrollLocked(true);
    try {
      const display = await measureTargetViewport(
        board,
        { cancelled: () => cancelled.current || !mounted.current },
        bounds,
      );
      start(display);
    } catch (e) {
      setError(String(e));
    } finally {
      setScrollLocked(false);
    }
  }
  function cancel() {
    cancelled.current = true;
    stop(true);
    setScrollLocked(false);
    void camera.stop();
  }
  return (
    <>
      <TargetStage
        visible={scrollLocked || running}
        boardRef={board}
        boundsRef={bounds}
        target={target}
        size={size}
        message={
          camera.stage === 'countdown'
            ? `Bắt đầu sau ${camera.countdown}… Giữ đầu yên.`
            : 'Giữ đầu yên, nhìn theo chấm vàng.'
        }
        onCancel={cancel}
        onLayout={(layout) => {
          if (
            layoutLocked.current &&
            (viewport.current.width !== layout.width || viewport.current.height !== layout.height)
          )
            cancel();
          setSize({ width: layout.width, height: layout.height });
        }}
      />
      <ScrollView
        ref={scroll}
        style={styles.screen}
        scrollEnabled={!running && !scrollLocked}
        contentContainerStyle={styles.content}
        testID="stimulus-screen"
      >
        {busy && ['countdown', 'recording'].includes(camera.stage) && (
          <CameraButton
            title={
              camera.stage === 'countdown' ? 'Hủy đếm ngược' : 'Dừng và lưu test (không hợp lệ)'
            }
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
            onPress={() => void previewTargets()}
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
            framingGates={CALIBRATION_FRAMING_GATES}
            framingHints={{
              TOO_FAR: calibrationFramingHint('TOO_FAR'),
              TOO_CLOSE: calibrationFramingHint('TOO_CLOSE'),
              FACE_PARTIAL: calibrationFramingHint('FACE_PARTIAL'),
              READY: calibrationFramingHint('READY'),
            }}
            previewAspect={CALIBRATION_PREVIEW_ASPECT}
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
    </>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 160 },
  title: { fontSize: 24, fontWeight: '700' },
});
