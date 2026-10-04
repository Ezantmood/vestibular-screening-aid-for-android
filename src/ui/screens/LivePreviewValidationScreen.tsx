// P3.5 validation screen (Development Build on Android only).
// Flow on a physical phone:
// 1. open the camera -> 2. live front preview appears -> 3. position the head
//    with the guide -> 4. framing feedback (-> READY) -> 5. start a ~10 s
//    high-speed recording (preview keeps streaming) -> 6. stop/finish ->
//    automatic P2-decode regression check on the recorded file.
// The future eye-movement test requires READY before Start; this screen
// enforces the gate (with a logged override for validation robustness).

import { useCallback, useEffect, useRef, useState } from 'react';
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

import type { FixedMode } from '../../camera/fixedModes';
import { collectFixedModes } from '../../camera/fixedModes';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import type {
  NativeFramingSample,
  PreviewRecordingReport,
  PreviewStatusEvent,
  PreviewTransformInfo,
} from '../../camera/livePreview';
import {
  closePreviewCamera,
  getPreviewTransformInfo,
  isLivePreviewAvailable,
  openPreviewCamera,
  startFraming,
  startPreviewRecording,
  stopFraming,
  stopPreviewRecording,
} from '../../camera/livePreview';
import type { FramePipelineReport } from '../../camera/framePipeline';
import { analyzeVideoFile, isFramePipelineAvailable } from '../../camera/framePipeline';
import type { FramingObservation, FramingState } from '../../eyetracking/framing';
import { FramingStabilizer, classifyFramingState, framingHint } from '../../eyetracking/framing';
import LiveCameraPreviewView from '../components/LiveCameraPreviewView';
import CameraModePicker from '../components/CameraModePicker';
import {
  CameraButton as Button,
  CameraDetails,
  CameraProgress,
  CameraSummary,
} from '../components/CameraUI';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type Phase =
  | 'idle'
  | 'loading-modes'
  | 'ready'
  | 'opening'
  | 'closing'
  | 'previewing'
  | 'recording'
  | 'analyzing'
  | 'done'
  | 'error';

/** P3.5 validation window: approximately 10 seconds. */
const TEST_DURATION_SEC = 10;
/** Lightweight framing sample rate (never 120 fps detection). */
const FRAMING_INTERVAL_MS = 500;

function toObservation(sample: NativeFramingSample): FramingObservation {
  return {
    faceFound: sample.faceFound,
    faceLeft: sample.faceLeft,
    faceTop: sample.faceTop,
    faceRight: sample.faceRight,
    faceBottom: sample.faceBottom,
    leftEyeLandmark: sample.leftEyeLandmark,
    rightEyeLandmark: sample.rightEyeLandmark,
    leftEyeOpenProb: sample.leftEyeOpenProb,
    rightEyeOpenProb: sample.rightEyeOpenProb,
  };
}

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (!isLivePreviewAvailable()) {
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

function stateColor(state: FramingState): string {
  switch (state) {
    case 'READY':
      return '#1a8f3c';
    case 'NO_FACE':
      return '#b00020';
    default:
      return '#b77900';
  }
}

export default function LivePreviewValidationScreen() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [framing, setFraming] = useState<FramingState>('NO_FACE');
  const [faceBox, setFaceBox] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [surfaceStatus, setSurfaceStatus] = useState<string>('unknown');
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [recordReport, setRecordReport] = useState<PreviewRecordingReport | null>(null);
  const [decodeReport, setDecodeReport] = useState<FramePipelineReport | null>(null);
  const [transformInfo, setTransformInfo] = useState<PreviewTransformInfo | null>(null);
  const [gateBypassed, setGateBypassed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const stabilizer = useRef(new FramingStabilizer(3));
  const recordStartedAt = useRef(0);
  const busyRef = useRef(false);
  const screenMounted = useRef(true);
  const sessionVersion = useRef(0);
  const previewOwned = useRef(false);

  const releasePreview = useCallback(async () => {
    sessionVersion.current += 1;
    previewOwned.current = false;
    if (screenMounted.current) setPhase('closing');
    await stopPreviewRecording();
    await stopFraming();
    await closePreviewCamera();
    if (screenMounted.current) {
      setFaceBox(null);
      setTransformInfo(null);
      stabilizer.current.reset();
      setFraming('NO_FACE');
      setPhase('ready');
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && (previewOwned.current || busyRef.current)) {
        void releasePreview();
      }
    });
    return () => subscription.remove();
  }, [releasePreview]);

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
      if (previewOwned.current || busyRef.current) void releasePreview();
    };
  }, [loadModes, releasePreview]);

  // Recording elapsed ticker (display only; start time set in the handler).
  useEffect(() => {
    if (phase !== 'recording') {
      return;
    }
    const started = recordStartedAt.current;
    const timer = setInterval(() => setRecordElapsed((Date.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const onPreviewStatus = useCallback((event: { nativeEvent: PreviewStatusEvent }) => {
    setSurfaceStatus(event.nativeEvent.status);
  }, []);

  const onFramingSample = useCallback((event: { nativeEvent: NativeFramingSample }) => {
    const sample = event.nativeEvent;
    if (sample.faceFound) {
      setFaceBox({
        left: sample.faceLeft ?? 0,
        top: sample.faceTop ?? 0,
        right: sample.faceRight ?? 1,
        bottom: sample.faceBottom ?? 1,
      });
    } else {
      setFaceBox(null);
    }
    const raw = classifyFramingState(toObservation(sample));
    setFraming(stabilizer.current.push(raw));
  }, []);

  async function askPermission() {
    setPermission('checking');
    const state = await requestCameraPermission();
    setPermission(state);
    if (state === 'granted') {
      await loadModes();
    }
  }

  async function openPreview() {
    if (busyRef.current) return;
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    busyRef.current = true;
    const version = ++sessionVersion.current;
    setPhase('opening');
    setErrorMessage(null);
    setRecordReport(null);
    setDecodeReport(null);
    setGateBypassed(false);
    setFaceBox(null);
    setTransformInfo(null);
    stabilizer.current.reset();
    setFraming('NO_FACE');
    try {
      await openPreviewCamera(mode.cameraId, mode.width, mode.height, mode.fpsMin, mode.fpsMax);
      if (!screenMounted.current || version !== sessionVersion.current) {
        await closePreviewCamera();
        return;
      }
      previewOwned.current = true;
      if (mode.lensFacing === 'FRONT') await startFraming(FRAMING_INTERVAL_MS);
      try {
        setTransformInfo(await getPreviewTransformInfo());
      } catch {
        setTransformInfo(null);
      }
      if (screenMounted.current && version === sessionVersion.current) setPhase('previewing');
    } catch (e) {
      if (!screenMounted.current || version !== sessionVersion.current) return;
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      busyRef.current = false;
    }
  }

  async function closePreview() {
    await releasePreview();
  }

  async function runRecording(bypassGate: boolean) {
    if (busyRef.current) {
      return;
    }
    const mode = modes[selectedIndex];
    if (!mode || (phase !== 'previewing' && phase !== 'done')) {
      return;
    }
    busyRef.current = true;
    const version = sessionVersion.current;
    setPhase('recording');
    setErrorMessage(null);
    setRecordReport(null);
    setDecodeReport(null);
    setGateBypassed(bypassGate);
    setRecordElapsed(0);
    setStopping(false);
    recordStartedAt.current = Date.now();
    try {
      const report = await startPreviewRecording(TEST_DURATION_SEC);
      if (!screenMounted.current || version !== sessionVersion.current) return;
      setRecordReport(report);
      if (report.recordingStatus !== 'SUCCESS' || !report.filePath) {
        throw new Error(report.error ?? 'Không lưu được video. Hãy mở lại camera và quay lại.');
      }
      setPhase('analyzing');
      // P2-decode regression on the preview-session file (offline, same as P2).
      if (report.filePath && isFramePipelineAvailable()) {
        try {
          const decoded = await analyzeVideoFile({
            filePath: report.filePath,
            expectedFps: mode.fpsMax,
            faceSampleCount: 9,
            saveDebugFrames: false,
          });
          if (screenMounted.current && version === sessionVersion.current) setDecodeReport(decoded);
        } catch (e) {
          if (!screenMounted.current || version !== sessionVersion.current) return;
          setErrorMessage(
            `Recording finished but offline decode failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (!screenMounted.current || version !== sessionVersion.current) return;
      if (report.previewActive) setPhase('done');
      else await releasePreview();
    } catch (e) {
      if (!screenMounted.current || version !== sessionVersion.current) return;
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      busyRef.current = false;
    }
  }

  async function stopRecording() {
    setStopping(true);
    if (!(await stopPreviewRecording())) {
      setStopping(false);
      setErrorMessage('Chưa gửi được lệnh dừng. Hãy thử lại.');
    }
  }

  const selectedMode = modes[selectedIndex] ?? null;
  const overlayBox =
    faceBox !== null && viewSize.width > 0 && viewSize.height > 0
      ? {
          left: faceBox.left * viewSize.width,
          top: faceBox.top * viewSize.height,
          width: Math.max(0, (faceBox.right - faceBox.left) * viewSize.width),
          height: Math.max(0, (faceBox.bottom - faceBox.top) * viewSize.height),
        }
      : null;

  const regressionText =
    recordReport !== null && decodeReport !== null
      ? [
          `encoded frames: ${decodeReport.encodedSampleCount}`,
          `decoded frames: ${decodeReport.decodedFrameCount}`,
          `timeline duration: ${decodeReport.decodedDurationUs !== null ? (decodeReport.decodedDurationUs / 1_000_000).toFixed(3) : 'n/a'} s`,
          `effective decoded FPS: ${decodeReport.effectiveFps !== null ? decodeReport.effectiveFps.toFixed(2) : 'n/a'}`,
          `median interval: ${decodeReport.medianIntervalUs !== null ? (decodeReport.medianIntervalUs / 1000).toFixed(3) : 'n/a'} ms`,
          `p95 interval: ${decodeReport.p95IntervalUs !== null ? (decodeReport.p95IntervalUs / 1000).toFixed(3) : 'n/a'} ms`,
          `non-monotonic PTS: ${decodeReport.nonMonotonicPtsCount}`,
          `duplicate PTS: ${decodeReport.duplicatePtsCount}`,
          `large gaps: ${decodeReport.largeGapCount}`,
          `MAD median/max: ${decodeReport.madMedian !== null ? decodeReport.madMedian.toFixed(2) : 'n/a'} / ${decodeReport.madMax !== null ? decodeReport.madMax.toFixed(2) : 'n/a'}`,
          `READY gate: ${gateBypassed ? 'BYPASSED (logged)' : 'enforced'}`,
        ].join('\n')
      : null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="live-preview-screen"
    >
      <Text style={styles.title}>Xem camera & căn mặt</Text>
      <Text style={styles.note}>
        Mở camera, đưa khuôn mặt vào giữa khung. Khi đã sẵn sàng, quay {TEST_DURATION_SEC} giây để
        kiểm tra.
      </Text>

      {permission === 'checking' && <Text style={styles.note}>Đang kiểm tra quyền camera…</Text>}
      {permission === 'unavailable' && (
        <Text style={styles.error} testID="live-preview-unavailable">
          Cần bản Android có chức năng camera này. Hãy cài bản app mới nhất.
        </Text>
      )}
      {permission === 'denied' && (
        <View>
          <Text style={styles.error}>Cần cho phép camera để xem trước và ghi hình.</Text>
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
        <Text style={styles.note}>Đang đọc chế độ camera…</Text>
      )}
      {phase === 'closing' && <CameraProgress title="Đang đóng camera…" />}
      {permission === 'granted' &&
        modes.length === 0 &&
        (phase === 'ready' || phase === 'error') && (
          <Button title="Tải lại chế độ camera" tone="secondary" onPress={() => void loadModes()} />
        )}

      {permission === 'granted' && modes.length > 0 && (phase === 'ready' || phase === 'error') && (
        <View>
          <CameraModePicker
            modes={modes}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
          <Button title="Open live preview" onPress={openPreview} />
        </View>
      )}

      {(phase === 'opening' ||
        phase === 'previewing' ||
        phase === 'recording' ||
        phase === 'analyzing' ||
        phase === 'done') && (
        <View>
          <View
            style={styles.previewBox}
            onLayout={(e) =>
              setViewSize({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
            testID="live-preview-box"
          >
            <LiveCameraPreviewView
              bufferWidth={selectedMode?.width ?? 1920}
              bufferHeight={selectedMode?.height ?? 1080}
              mirrorPreview={selectedMode?.lensFacing === 'FRONT'}
              extraRotationDeg={0}
              onPreviewStatus={onPreviewStatus}
              onFramingSample={onFramingSample}
            />
            {/* Center guide (display space only — never analysis coords). */}
            <View style={styles.guideVertical} pointerEvents="none" />
            <View style={styles.guideHorizontal} pointerEvents="none" />
            {overlayBox !== null && (
              <View
                style={[
                  styles.faceBox,
                  {
                    left: overlayBox.left,
                    top: overlayBox.top,
                    width: overlayBox.width,
                    height: overlayBox.height,
                    borderColor: stateColor(framing),
                  },
                ]}
                pointerEvents="none"
                testID="framing-face-box"
              />
            )}
            <View
              style={[styles.statePill, { borderColor: stateColor(framing) }]}
              pointerEvents="none"
            >
              <Text
                style={[styles.stateText, { color: stateColor(framing) }]}
                testID="framing-state"
              >
                {framing}
              </Text>
            </View>
            {phase === 'recording' && (
              <View style={styles.recPill} pointerEvents="none" testID="recording-indicator">
                <Text style={styles.recText}>● REC {recordElapsed.toFixed(1)}s</Text>
              </View>
            )}
          </View>

          <Text style={styles.hint} testID="framing-hint">
            {selectedMode?.lensFacing === 'FRONT'
              ? framingHint(framing)
              : 'Hướng camera sau vào đối tượng cần quay.'}
          </Text>

          {phase === 'opening' && <Text style={styles.note}>Đang mở camera…</Text>}

          {(phase === 'previewing' || phase === 'done') && (
            <View style={styles.buttonRow}>
              <Button
                title={`Quay ${TEST_DURATION_SEC} giây`}
                onPress={() => void runRecording(false)}
                disabled={selectedMode?.lensFacing === 'FRONT' && framing !== 'READY'}
              />
              <Button title="Close preview" onPress={() => void closePreview()} />
            </View>
          )}
          {(phase === 'previewing' || phase === 'done') &&
            selectedMode?.lensFacing === 'FRONT' &&
            framing !== 'READY' && (
              <CameraDetails title="Tùy chọn kiểm tra">
                <Button
                  title="Quay kiểm tra không chờ căn mặt"
                  tone="secondary"
                  onPress={() => void runRecording(true)}
                />
              </CameraDetails>
            )}
          {phase === 'recording' && (
            <Button
              title={stopping ? 'Đang lưu video…' : 'Dừng và lưu video'}
              tone="danger"
              disabled={stopping}
              onPress={stopRecording}
            />
          )}
          {phase === 'analyzing' && (
            <Text style={styles.note}>Video đã lưu. Đang kiểm tra khung hình…</Text>
          )}
        </View>
      )}

      {errorMessage !== null && (
        <Text style={styles.error} testID="live-preview-error">
          {errorMessage}
        </Text>
      )}

      {recordReport && (
        <CameraSummary
          title={
            recordReport.recordingStatus === 'SUCCESS' ? 'Đã lưu video' : 'Chưa lưu được video'
          }
          detail={
            recordReport.recordingStatus !== 'SUCCESS'
              ? 'Không tạo được video. Mở lại camera và thử lại.'
              : recordReport.manualStop
                ? 'Đã dừng sớm và lưu video trên điện thoại.'
                : 'Video đã quay xong và được lưu trên điện thoại.'
          }
        />
      )}
      <CameraDetails>
        <Text style={styles.note} testID="preview-surface-status">
          surface: {surfaceStatus}
        </Text>
        {regressionText !== null && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Capture regression (preview session file)</Text>
            <Text style={styles.mono} selectable testID="live-preview-regression">
              {regressionText}
            </Text>
          </View>
        )}

        {recordReport !== null && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Preview session events (raw)</Text>
            {recordReport.sessionEvents.map((event, index) => (
              <Text key={`${index}-${event}`} style={styles.mono}>
                {event}
              </Text>
            ))}
          </View>
        )}

        {transformInfo !== null && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Preview transform audit (display-only)</Text>
            <Text style={styles.mono} selectable testID="preview-transform-info">
              {JSON.stringify(transformInfo, null, 2)}
            </Text>
          </View>
        )}
      </CameraDetails>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'column',
    gap: 8,
    justifyContent: 'space-between',
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
  faceBox: {
    borderRadius: 6,
    borderWidth: 3,
    position: 'absolute',
  },
  guideHorizontal: {
    backgroundColor: '#ffffff88',
    height: 1,
    left: '10%',
    position: 'absolute',
    right: '10%',
    top: '50%',
  },
  guideVertical: {
    backgroundColor: '#ffffff88',
    bottom: '10%',
    left: '50%',
    position: 'absolute',
    top: '10%',
    width: 1,
  },
  hint: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
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
    color: '#526A78',
    lineHeight: 21,
  },
  previewBox: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 440,
    marginTop: 8,
    overflow: 'hidden',
    width: '100%',
  },
  recPill: {
    backgroundColor: '#b00020',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'absolute',
    right: 8,
    top: 8,
  },
  recText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
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
  statePill: {
    backgroundColor: '#00000088',
    borderRadius: 12,
    borderWidth: 2,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'absolute',
    top: 8,
  },
  stateText: {
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: '#142D3D',
    fontSize: 25,
    fontWeight: '700',
    marginBottom: 4,
  },
});
