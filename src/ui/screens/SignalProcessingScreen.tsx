import { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, ScrollView, Text } from 'react-native';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import { collectFixedModes, type FixedMode } from '../../camera/fixedModes';
import { analyzeSignalRecording } from '../../tests/eyeAnalysis';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import CameraCapturePanel from '../components/CameraCapturePanel';
import { CameraButton, CameraDetails } from '../components/CameraUI';
import { useEyeAnalysisAwake } from '../hooks/useEyeAnalysisAwake';

export default function SignalProcessingScreen() {
  const camera = usePreviewCapture();
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  useEyeAnalysisAwake(busy);
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function prepare() {
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
  async function capture() {
    if (lock.current || !modes[index]) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const mode = modes[index];
      const recording = await camera.capture(mode, 10);
      await camera.close();
      if (!mounted.current) return;
      const summary = await analyzeSignalRecording(recording.filePath!, mode.fpsMax);
      if (mounted.current) setReport(JSON.stringify(summary, null, 2));
    } catch (e) {
      if (mounted.current && !(e instanceof CaptureCancelled)) setError(String(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 160 }}
      testID="signal-screen"
    >
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Xử lý tín hiệu đồng tử</Text>
      <Text>
        Nhìn giữa, di chuyển mắt, chớp mắt rồi che mắt trong vài giây. Raw được giữ nguyên; đoạn mất
        tracking sẽ không được nối.
      </Text>
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
          onCapture={() => void capture()}
        />
      )}
      {error && <Text selectable>{error}</Text>}
      {report !== '' && (
        <>
          <Text>
            Đã lưu raw, signal đã lọc, velocity và quality theo từng mắt. Tọa độ ở đơn vị ROI; không
            diễn giải lâm sàng.
          </Text>
          <CameraDetails title="Signal trước / sau">
            <Text selectable>{report}</Text>
          </CameraDetails>
        </>
      )}
    </ScrollView>
  );
}
