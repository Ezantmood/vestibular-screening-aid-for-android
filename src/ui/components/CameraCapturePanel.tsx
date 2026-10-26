import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FixedMode } from '../../camera/fixedModes';
import type { NativeFramingSample } from '../../camera/livePreview';
import { FRAMING_GATES, FramingStabilizer, classifyFramingState } from '../../eyetracking/framing';
import type { FramingGateSet, FramingState } from '../../eyetracking/framing';
import type { PreviewCaptureController } from '../hooks/usePreviewCapture';
import LiveCameraPreviewView from './LiveCameraPreviewView';
import CameraModePicker from './CameraModePicker';
import { CameraButton, CameraDetails, CameraProgress, cameraColors } from './CameraUI';

const hints: Record<FramingState, string> = {
  NO_FACE: 'Đưa khuôn mặt vào khung và nhìn vào màn hình.',
  FACE_PARTIAL: 'Lùi nhẹ để toàn bộ khuôn mặt nằm trong khung.',
  TOO_CLOSE: 'Đưa điện thoại ra xa một chút.',
  TOO_FAR: 'Đưa điện thoại lại gần một chút.',
  OFF_CENTER: 'Đưa khuôn mặt về giữa hai đường căn.',
  EYES_NOT_VISIBLE: 'Căn mặt trước; mở cả hai mắt và nhìn thẳng.',
  READY: 'Khuôn mặt đã sẵn sàng. Có thể bắt đầu quay.',
};

export default function CameraCapturePanel({
  camera,
  modes,
  selectedIndex,
  onSelect,
  onCapture,
  busy,
  phase,
  instruction,
  requireFace = true,
  duration = 10,
  startTitle,
  stopTitle,
  framingGates = FRAMING_GATES,
  framingHints,
  previewAspect,
}: {
  camera: PreviewCaptureController;
  modes: FixedMode[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onCapture: () => void;
  busy: boolean;
  phase: string;
  instruction?: string;
  requireFace?: boolean;
  duration?: number;
  startTitle?: string;
  stopTitle?: string;
  framingGates?: FramingGateSet;
  framingHints?: Partial<Record<FramingState, string>>;
  /** Width/height of the preview. Calibration uses the recorded frame so the lamp is not a cover crop. */
  previewAspect?: number;
}) {
  const mode = modes[selectedIndex];
  const stabilizer = useRef(new FramingStabilizer(3));
  const [framing, setFraming] = useState<FramingState>('NO_FACE');
  const [sample, setSample] = useState<NativeFramingSample | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const visible = !['closed', 'closing'].includes(camera.stage);
  const recording = ['countdown', 'recording', 'finishing'].includes(camera.stage);
  const processing = busy && camera.stage === 'closed';
  const front = mode?.lensFacing === 'FRONT';
  const ready = !requireFace || !front || framing === 'READY';
  const hint = front
    ? (framingHints?.[framing] ?? hints[framing])
    : 'Hướng camera sau vào đối tượng cần quay.';
  return (
    <View testID="camera-capture-panel">
      <CameraModePicker
        modes={modes}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        disabled={busy || camera.stage !== 'closed'}
      />
      <View
        style={[styles.preview, previewAspect != null ? { aspectRatio: previewAspect } : null]}
        testID="capture-preview-box"
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        {visible && mode ? (
          <LiveCameraPreviewView
            bufferWidth={mode.width}
            bufferHeight={mode.height}
            mirrorPreview={front}
            onPreviewStatus={(event) => {
              if (event.nativeEvent.status === 'surfaceReady') {
                stabilizer.current.reset();
                setFraming('NO_FACE');
                setSample(null);
              }
            }}
            onFramingSample={(event) => {
              setSample(event.nativeEvent);
              setFraming(
                stabilizer.current.push(classifyFramingState(event.nativeEvent, framingGates)),
              );
            }}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>◎</Text>
            <Text style={styles.placeholderTitle}>
              {processing ? 'Video đã quay xong' : 'Sẵn sàng căn khung'}
            </Text>
            <Text style={styles.placeholderNote}>
              {processing
                ? 'Đang xử lý video đã lưu trên điện thoại.'
                : 'Mở camera để xem trước và chỉnh vị trí khuôn mặt.'}
            </Text>
          </View>
        )}
        {visible && (
          <>
            <View pointerEvents="none" style={styles.vertical} />
            <View pointerEvents="none" style={styles.horizontal} />
            {sample?.faceFound &&
              sample.faceLeft !== null &&
              sample.faceTop !== null &&
              sample.faceRight !== null &&
              sample.faceBottom !== null && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.face,
                    {
                      left: sample.faceLeft * size.width,
                      top: sample.faceTop * size.height,
                      width: Math.max(0, sample.faceRight - sample.faceLeft) * size.width,
                      height: Math.max(0, sample.faceBottom - sample.faceTop) * size.height,
                      borderColor: framing === 'READY' ? '#82E5BE' : '#FFD78A',
                    },
                  ]}
                />
              )}
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {camera.stage === 'recording'
                  ? '● ĐANG QUAY  ' +
                    Math.min(camera.elapsed, duration).toFixed(1) +
                    ' / ' +
                    duration +
                    's'
                  : camera.stage === 'opening'
                    ? 'ĐANG MỞ CAMERA'
                    : camera.stage === 'finishing'
                      ? 'ĐANG LƯU VIDEO'
                      : camera.stage === 'countdown'
                        ? 'CHUẨN BỊ'
                        : ready
                          ? 'SẴN SÀNG'
                          : 'CĂN KHUÔN MẶT'}
              </Text>
            </View>
            {camera.stage === 'countdown' && (
              <View style={styles.countdown} pointerEvents="none">
                <Text style={styles.countdownText}>{camera.countdown}</Text>
              </View>
            )}
          </>
        )}
      </View>
      {instruction && <Text style={styles.instruction}>{instruction}</Text>}
      {camera.stage === 'preview' && (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {hint}
        </Text>
      )}
      {camera.error && (
        <View>
          <Text style={styles.error} accessibilityLiveRegion="assertive">
            Không mở được camera. Hãy đóng camera và thử lại.
          </Text>
          <CameraDetails title="Chi tiết lỗi camera">
            <Text selectable style={styles.error}>
              {camera.error}
            </Text>
          </CameraDetails>
        </View>
      )}
      {processing ? (
        <CameraProgress
          title={
            phase === 'analyzing'
              ? 'Đang phân tích video'
              : phase === 'detecting'
                ? 'Đang phân tích vùng mắt'
                : 'Đang xử lý kết quả'
          }
          description="Video đã lưu. Bước này có thể mất vài phút; hãy giữ app mở."
        />
      ) : camera.stage === 'closed' ? (
        <CameraButton
          title="Mở camera và căn khung"
          testID="capture-open"
          onPress={() => mode && void camera.open(mode)}
          disabled={!mode || busy}
        />
      ) : camera.stage === 'opening' || camera.stage === 'closing' ? (
        <CameraProgress
          title={camera.stage === 'opening' ? 'Đang mở camera…' : 'Đang đóng camera…'}
        />
      ) : recording ? (
        <>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressBar,
                { width: size.width * Math.min(1, camera.elapsed / duration) },
              ]}
            />
          </View>
          <CameraButton
            title={
              stopTitle ??
              (camera.stage === 'countdown'
                ? 'Hủy đếm ngược'
                : camera.stage === 'finishing'
                  ? 'Đang lưu video…'
                  : 'Dừng và lưu video')
            }
            tone="danger"
            onPress={() => void camera.stop()}
            disabled={camera.stage === 'finishing'}
            testID="capture-stop"
          />
        </>
      ) : (
        <>
          <CameraButton
            title={startTitle ?? 'Bắt đầu quay ' + duration + ' giây'}
            onPress={onCapture}
            disabled={busy || !ready}
            testID="capture-start"
          />
          <CameraButton
            title="Đóng camera / đổi chế độ"
            tone="secondary"
            onPress={() => void camera.close()}
            disabled={busy}
          />
          {requireFace && front && !ready && (
            <CameraDetails title="Tùy chọn kiểm tra">
              <Text style={styles.hint}>
                Có thể ghi hình để kiểm tra kỹ thuật khi chưa căn được mặt.
              </Text>
              <CameraButton
                title="Quay kiểm tra không chờ căn mặt"
                tone="secondary"
                onPress={() => {
                  console.info('CAMERA_FRAMING_OVERRIDE', mode?.label);
                  onCapture();
                }}
                disabled={busy}
              />
            </CameraDetails>
          )}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  preview: {
    backgroundColor: '#102B36',
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
    aspectRatio: 0.95,
    marginTop: 8,
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  placeholderIcon: { color: '#73D0CC', fontSize: 56, marginBottom: 12 },
  placeholderTitle: { color: '#FFF', fontSize: 19, fontWeight: '700', textAlign: 'center' },
  placeholderNote: {
    color: '#B3CDD5',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  vertical: {
    position: 'absolute',
    left: '50%',
    top: '12%',
    bottom: '12%',
    width: 1,
    backgroundColor: '#FFFFFF66',
  },
  horizontal: {
    position: 'absolute',
    top: '50%',
    left: '12%',
    right: '12%',
    height: 1,
    backgroundColor: '#FFFFFF66',
  },
  face: { position: 'absolute', borderWidth: 2, borderRadius: 12 },
  badge: { position: 'absolute', top: 12, left: 12, right: 12, alignSelf: 'flex-start' },
  badgeText: {
    color: '#FFF',
    backgroundColor: '#102B36CC',
    borderRadius: 8,
    padding: 8,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  countdown: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#102B3633',
  },
  countdownText: { color: '#FFF', fontSize: 84, fontWeight: '800' },
  hint: {
    color: cameraColors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginVertical: 8,
    textAlign: 'center',
  },
  instruction: {
    color: cameraColors.ink,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    marginTop: 12,
  },
  error: { color: cameraColors.danger, fontSize: 14, lineHeight: 21, marginTop: 10 },
  progressTrack: {
    height: 5,
    borderRadius: 4,
    backgroundColor: cameraColors.border,
    marginVertical: 12,
    overflow: 'hidden',
  },
  progressBar: { height: 5, backgroundColor: cameraColors.primary },
});
