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
import {
  analyzeStimulusRecording,
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
import CameraCapturePanel from '../components/CameraCapturePanel';
import { CameraButton, CameraDetails } from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';

const nowUs = () => performance.now() * 1000;
export default function StimulusScreen() {
  const camera = usePreviewCapture();
  const [testId, setTestId] = useState<MvpTestId>('smooth-pursuit');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState<(TargetPosition & { requestedElapsedUs: number }) | null>(
    null,
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRef<StimulusRun | null>(null);
  const raf = useRef<number | null>(null);
  const viewport = useRef({ width: 0, height: 0 });
  const mounted = useRef(true);
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);

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

  function start() {
    stop();
    viewport.current = { ...size };
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
      if (Platform.OS !== 'android' || !isLivePreviewAvailable())
        throw new Error('Cần Android Development Build.');
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED)
        throw new Error('Chưa được cấp quyền camera.');
      const probe = await getCamera2Capabilities();
      if (!mounted.current) return;
      setModes(collectFixedModes(probe).filter((m) => m.lensFacing === 'FRONT'));
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  }
  async function capture() {
    if (lock.current || !modes[index]) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setReport('');
    try {
      const bridge = await sampleStimulusClock();
      const captureReport = await camera.capture(modes[index], 10, start);
      const session = run.current;
      stop(captureReport.manualStop);
      await camera.close();
      if (!mounted.current || session === null || !captureReport.filePath) return;
      const summary = await analyzeStimulusRecording(
        session,
        captureReport,
        bridge,
        viewport.current,
      );
      if (mounted.current) setReport(summary);
    } catch (e) {
      stop();
      if (mounted.current && !(e instanceof CaptureCancelled)) setError(String(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ScrollView ref={scroll} contentContainerStyle={styles.content} testID="stimulus-screen">
      <Text style={styles.title}>Bài nhìn theo mục tiêu</Text>
      <Text>Giữ đầu ổn định và nhìn theo chấm vàng trong 10 giây.</Text>
      <View
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
      <Text>Bài đã chọn: {testId}</Text>
      <CameraButton
        title={running ? 'Dừng mục tiêu' : 'Thử mục tiêu (không ghi video)'}
        disabled={busy}
        onPress={() => (running ? stop() : start())}
      />
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
      {error && (
        <>
          <Text selectable>{error}</Text>
          <CameraButton
            title="Mở cài đặt quyền camera"
            onPress={() => void Linking.openSettings()}
          />
        </>
      )}
      {report !== '' && (
        <>
          <Text>Đã lưu timeline mục tiêu và ghép với PTS video. Đồng bộ hiện là ước lượng.</Text>
          <CameraDetails title="Timeline & đồng bộ">
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
