import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import { collectFixedModes, type FixedMode } from '../../camera/fixedModes';
import { invalidateCalibration } from '../../camera/eyeAnalysisStorage';
import {
  CALIBRATION_TARGETS,
  CALIBRATION_TAKE_SECONDS,
} from '../../eyetracking/calibration/protocol';
import type { CalibrationContext, CalibrationTarget } from '../../eyetracking/calibration/types';
import { analyzeCalibrationTakes, type CapturedCalibrationTake } from '../../tests/eyeAnalysis';
import { sampleStimulusClock } from '../../tests/stimulus/sessionAnalysis';
import CameraCapturePanel from '../components/CameraCapturePanel';
import { CameraButton, CameraDetails } from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import { measureTargetViewport } from '../hooks/measureTargetViewport';
import { useEyeAnalysisAwake } from '../hooks/useEyeAnalysisAwake';

const nowUs = () => performance.now() * 1000;
export default function CalibrationScreen() {
  const camera = usePreviewCapture();
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  useEyeAnalysisAwake(busy);
  const [target, setTarget] = useState<CalibrationTarget | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [message, setMessage] = useState('');
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  const committed = useRef<{ id: string; jsUs: number } | null>(null);
  const viewport = useRef(size);
  const scroll = useRef<ScrollView>(null);
  const board = useRef<View>(null);
  useLayoutEffect(() => {
    committed.current = target ? { id: target.id, jsUs: nowUs() } : null;
  }, [target]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        cancelled.current = true;
        setTarget(null);
      }
    });
    return () => {
      mounted.current = false;
      cancelled.current = true;
      subscription.remove();
    };
  }, []);
  async function prepare() {
    setError(null);
    try {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Cần quyền camera.');
      const probe = await getCamera2Capabilities();
      if (mounted.current)
        setModes(collectFixedModes(probe).filter((m) => m.lensFacing === 'FRONT'));
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  }
  async function calibrate() {
    const mode = modes[index];
    if (!mode || lock.current || size.width <= 0) return;
    lock.current = true;
    cancelled.current = false;
    setBusy(true);
    setError(null);
    setReport('');
    viewport.current = { ...size };
    const context: CalibrationContext = {
      cameraId: mode.cameraId,
      width: mode.width,
      height: mode.height,
      fps: mode.fpsMax,
      viewportWidth: size.width,
      viewportHeight: size.height,
      viewportLeft: 0,
      viewportTop: 0,
      detectorId: 'percentile-dark',
      coordinateVersion: 'decoded-roi-v1',
    };
    const takes: CapturedCalibrationTake[] = [];
    const createdAtMs = Date.now();
    try {
      // A failed/cancelled retry must never leave an older mapping active.
      await invalidateCalibration();
      scroll.current?.scrollTo({ y: 0, animated: false });
      const display = await measureTargetViewport(board);
      context.viewportLeft = display.left;
      context.viewportTop = display.top;
      for (let i = 0; i < CALIBRATION_TARGETS.length; i++) {
        if (cancelled.current || !mounted.current) break;
        const next = CALIBRATION_TARGETS[i];
        setTarget(next);
        setMessage(`Nhìn vào chấm: ${i + 1}/${CALIBRATION_TARGETS.length}. Giữ đầu yên.`);
        // Wait for the actual React commit, then allow fixation to settle.
        while (committed.current?.id !== next.id) {
          if (cancelled.current || !mounted.current) throw new CaptureCancelled();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const presentedJsUs = committed.current.jsUs;
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (cancelled.current || !mounted.current) break;
        const bridge = await sampleStimulusClock();
        const capture = await camera.capture(mode, CALIBRATION_TAKE_SECONDS, undefined, {
          countdownSeconds: i === 0 ? 3 : 0,
        });
        const releasedJsUs = nowUs();
        takes.push({
          target: { ...next },
          presentedJsUs,
          releasedJsUs,
          recordStartNativeUs: capture.testStartNs / 1000,
          recordEndNativeUs: capture.testEndNs / 1000,
          bridge,
          completed: !capture.manualStop && !cancelled.current,
          filePath: capture.filePath!,
        });
        if (capture.manualStop) {
          cancelled.current = true;
          break;
        }
        console.log(
          'CALIBRATION_TAKE ' +
            JSON.stringify({
              target: next.id,
              frames: capture.extractorSampleCount,
              filePath: capture.filePath,
            }),
        );
      }
      if (mounted.current) setTarget(null);
      await camera.close();
      if (!mounted.current || cancelled.current) {
        if (mounted.current) setMessage('Đã hủy. Calibration cũ đã bị vô hiệu hóa; hãy thử lại.');
        return;
      }
      const out = await analyzeCalibrationTakes({
        id: `cal-${Date.now()}`,
        createdAtMs,
        context,
        takes,
        cancelled: () => cancelled.current || !mounted.current,
        progress: (i) => {
          if (mounted.current)
            setMessage(`Đang phân tích ${i}/${takes.length}. Có thể mất vài phút.`);
        },
      });
      if (mounted.current) {
        setMessage(
          out.result.verdict === 'VALID'
            ? 'Calibration đạt kiểm tra chất lượng. Có thể chuyển sang bài mắt.'
            : 'Calibration chưa đạt. Căn lại mặt, giữ ánh sáng ổn định và nhìn đúng chấm rồi thử lại.',
        );
        setReport(JSON.stringify(out.summary, null, 2));
      }
    } catch (e) {
      await camera.close();
      if (mounted.current) {
        setTarget(null);
        setMessage('Calibration chưa hoàn thành. Hãy thử lại.');
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
      scrollEnabled={!target}
      contentContainerStyle={styles.content}
      testID="calibration-screen"
    >
      <View
        ref={board}
        style={styles.board}
        testID="calibration-board"
        onLayout={(e) => {
          const layout = e.nativeEvent.layout;
          if (
            busy &&
            (viewport.current.width !== layout.width || viewport.current.height !== layout.height)
          ) {
            cancelled.current = true;
            setTarget(null);
            void camera.stop();
          }
          setSize({ width: layout.width, height: layout.height });
        }}
      >
        {target ? (
          <View
            testID="calibration-target"
            style={[
              styles.target,
              { left: target.x * size.width - 10, top: target.y * size.height - 10 },
            ]}
          />
        ) : (
          <Text style={styles.wait}>Chấm xuất hiện khi bắt đầu calibration.</Text>
        )}
      </View>
      <Text style={styles.title}>Hiệu chỉnh mắt</Text>
      <Text>
        Nhìn lần lượt vào 14 chấm. Giữ nguyên điện thoại, đầu và ánh sáng. Mỗi chấm được quay riêng
        khi đã đứng yên.
      </Text>
      {message !== '' && <Text accessibilityLiveRegion="polite">{message}</Text>}
      {busy && (
        <CameraButton
          title="Hủy calibration"
          tone="danger"
          onPress={() => {
            cancelled.current = true;
            setTarget(null);
            void camera.stop();
          }}
        />
      )}
      {modes.length === 0 ? (
        <CameraButton title="Chuẩn bị camera trước" onPress={() => void prepare()} />
      ) : (
        <CameraCapturePanel
          camera={camera}
          modes={modes}
          selectedIndex={index}
          onSelect={setIndex}
          busy={busy}
          phase="analyzing"
          duration={CALIBRATION_TAKE_SECONDS}
          instruction="Bắt đầu quay sẽ chạy toàn bộ calibration."
          onCapture={() => void calibrate()}
        />
      )}
      {error && <Text selectable>{error}</Text>}
      {report !== '' && (
        <CameraDetails title="Calibration quality & signal">
          <Text selectable>{report}</Text>
        </CameraDetails>
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
    alignItems: 'center',
    justifyContent: 'center',
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
