import { shareCalibrationEvidence } from '../../storage/calibrationEvidence';
import { File } from 'expo-file-system';
import { savedCalibrationReplay } from '../../eyetracking/calibration/replay';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PipelineDecodeError } from '../../eyetracking/tracking/decodeIntegrity';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import { collectFixedModes, portraitFaceRotation, type FixedMode } from '../../camera/fixedModes';
import { readCalibrationJson, invalidateCalibration } from '../../camera/eyeAnalysisStorage';
import { assertCurrentPupilDetector } from '../../camera/pupilDetector';
import {
  calibrationPageScrolls,
  describeSavedCalibration,
  type CalibrationScreenPhase,
  type SavedCalibrationView,
} from '../../eyetracking/calibration/display';
import {
  calibrationCaptureFailureHint,
  calibrationFeedback,
} from '../../eyetracking/calibration/insights';
import {
  CALIBRATION_TARGETS,
  CALIBRATION_TAKE_SECONDS,
} from '../../eyetracking/calibration/protocol';
import {
  CALIBRATION_COORDINATE_VERSION,
  type CalibrationContext,
  type CalibrationTarget,
  type CalibrationResult,
} from '../../eyetracking/calibration/types';
import { sameCalibrationContext } from '../../eyetracking/calibration/calibration';
import {
  validationFailureCode,
  type ValidationFailureCode,
  type ValidationFailure,
} from '../../tests/validation/failures';
import { analyzeCalibrationTakes, type CapturedCalibrationTake } from '../../tests/eyeAnalysis';
import { sampleStimulusClock } from '../../tests/stimulus/sessionAnalysis';
import CameraCapturePanel from '../components/CameraCapturePanel';
import CameraImageGallery from '../components/CameraImageGallery';
import { CameraButton, CameraDetails } from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import { measureTargetViewport } from '../hooks/measureTargetViewport';
import {
  CALIBRATION_FRAMING_GATES,
  CALIBRATION_PREVIEW_ASPECT,
  calibrationFramingHint,
} from '../../eyetracking/calibration/geometry';
import TargetStage from '../components/TargetStage';
import { useEyeAnalysisAwake } from '../hooks/useEyeAnalysisAwake';

const nowUs = () => performance.now() * 1000;
const primaryImages: Record<string, string> = {
  'fit-0-0': 'Ảnh mắt tại điểm trên trái',
  'fit-1-1': 'Ảnh mắt khi nhìn giữa',
  'fit-2-1': 'Ảnh mắt khi nhìn xuống',
  'check-center': 'Ảnh mắt khi kiểm tra lại điểm giữa',
};

async function loadSavedCalibration(): Promise<SavedCalibrationView | null> {
  const json = await readCalibrationJson();
  return json ? describeSavedCalibration(json) : null;
}
export default function CalibrationScreen({
  onComplete,
  onFailure,
}: {
  onComplete?: (result: CalibrationResult, evidence: unknown) => void;
  onFailure?: (code: ValidationFailureCode, decode?: ValidationFailure['decode']) => void;
} = {}) {
  const camera = usePreviewCapture();
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<CalibrationScreenPhase>('ready');
  useEyeAnalysisAwake(busy);
  const [target, setTarget] = useState<CalibrationTarget | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [message, setMessage] = useState('');
  const [report, setReport] = useState('');
  const [feedback, setFeedback] = useState<string[]>([]);
  const [auditImages, setAuditImages] = useState<{ target: string; paths: string[] }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  const committed = useRef<{ id: string; jsUs: number } | null>(null);
  const viewport = useRef(size);
  const scroll = useRef<ScrollView>(null);
  const board = useRef<View>(null);
  const bounds = useRef<View>(null);
  const lockLayout = useRef(false);
  const runToken = useRef(0);
  const previousSaved = useRef<SavedCalibrationView | null>(null);
  useLayoutEffect(() => {
    committed.current = target ? { id: target.id, jsUs: nowUs() } : null;
  }, [target]);
  function revealResult() {
    requestAnimationFrame(() => {
      scroll.current?.scrollTo({ y: 0, animated: false });
    });
  }
  useEffect(() => {
    mounted.current = true;
    const token = runToken.current;
    void (async () => {
      try {
        const savedJson = await readCalibrationJson();
        const saved = savedJson ? describeSavedCalibration(savedJson) : null;
        if (!mounted.current || token !== runToken.current) return;
        if (!saved) return;
        previousSaved.current = saved;
        if (savedJson) {
          setAuditImages(saved.auditImages);
          setReport(JSON.stringify({ saved: true, verdict: saved.verdict }));
        }
        setPhase('result');
        setFeedback(saved.lines);
        setMessage(
          saved.verdict === 'VALID'
            ? 'Lần hiệu chỉnh đã lưu từng đạt kiểm tra chất lượng; xem điều kiện sử dụng bên dưới.'
            : 'Lần hiệu chỉnh đã lưu chưa đạt. Ánh xạ không được dùng để chấm vị trí trên màn hình.',
        );
        requestAnimationFrame(() => {
          scroll.current?.scrollTo({ y: 0, animated: false });
        });
      } catch {
        // A missing native reader leaves the screen ready for a new take.
      }
    })();
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
      assertCurrentPupilDetector();
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Cần quyền camera.');
      const probe = await getCamera2Capabilities();
      if (mounted.current)
        setModes(collectFixedModes(probe).filter((m) => m.lensFacing === 'FRONT'));
    } catch (e) {
      if (mounted.current) {
        setError(String(e));
        onFailure?.('CAMERA_PREPARATION_FAILED');
      }
    }
  }
  async function showInterrupted(kind: 'stopped' | 'failed') {
    let saved: SavedCalibrationView | null = null;
    try {
      saved = mounted.current ? ((await loadSavedCalibration()) ?? previousSaved.current) : null;
    } catch {
      saved = null;
    }
    if (!mounted.current) return;
    setPhase(saved ? 'result' : 'ready');
    setFeedback(saved?.lines ?? []);
    setTarget(null);
    setMessage(
      kind === 'stopped'
        ? saved
          ? 'Đã dừng. Lần này chưa lưu. Lần hiệu chỉnh đã lưu trước vẫn hiện bên dưới.'
          : 'Đã dừng. Lần hiệu chỉnh này chưa được lưu.'
        : 'Calibration chưa hoàn thành. Hãy thử lại.',
    );
    if (saved) revealResult();
  }
  async function calibrate() {
    const mode = modes[index];
    if (!mode || lock.current) return;
    lock.current = true;
    cancelled.current = false;
    runToken.current += 1;
    setBusy(true);
    setPhase('capture');
    setError(null);
    setReport('');
    setFeedback([]);
    setAuditImages([]);
    setMessage('');
    const takes: CapturedCalibrationTake[] = [];
    const createdAtMs = Date.now();
    try {
      // Preserve the previous evidence for display, but revoke its active pointer
      // before a retry. Cancellation/failure cannot silently reactivate it.
      previousSaved.current = await loadSavedCalibration();
      await invalidateCalibration();
      lockLayout.current = false;
      const viewportOptions = {
        cancelled: () => cancelled.current || !mounted.current,
      };
      const display = await measureTargetViewport(board, viewportOptions, bounds);
      viewport.current = { width: display.width, height: display.height };
      lockLayout.current = true;
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
        const capture = await camera.capture(
          mode,
          CALIBRATION_TAKE_SECONDS,
          async (isCancelled) => {
            const current = await measureTargetViewport(
              board,
              {
                ...viewportOptions,
                cancelled: () => viewportOptions.cancelled() || isCancelled(),
              },
              bounds,
            );
            if (
              !sameCalibrationContext(context, {
                ...context,
                viewportWidth: current.width,
                viewportHeight: current.height,
                viewportLeft: current.left,
                viewportTop: current.top,
              })
            )
              throw new Error('Vùng target đã thay đổi. Căn lại màn hình và thử calibration lại.');
          },
          {
            countdownSeconds: i === 0 ? 3 : 0,
          },
        );
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
              completed: !capture.manualStop,
            }),
        );
      }
      if (mounted.current) setTarget(null);
      await camera.close();
      lockLayout.current = false;
      if (!mounted.current || cancelled.current) {
        await showInterrupted('stopped');
        return;
      }
      if (mounted.current) {
        setPhase('analysis');
        revealResult();
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
            : 'Calibration chưa đạt. Xem lý do và xuất báo cáo để kiểm tra detector / ánh xạ.',
        );
        setPhase('result');
        setReport(JSON.stringify(out.summary, null, 2));
        setFeedback(calibrationFeedback(out.result));
        setAuditImages(out.summary.auditImages);
        revealResult();
        onComplete?.(out.result, out.evidence);
      }
    } catch (e) {
      if (mounted.current)
        onFailure?.(
          validationFailureCode(e),
          e instanceof PipelineDecodeError ? { stage: e.stage, ...e.counts } : undefined,
        );
      await camera.close();
      const stopped = e instanceof CaptureCancelled || cancelled.current;
      await showInterrupted(stopped ? 'stopped' : 'failed');
      if (mounted.current && !stopped)
        setError(
          `${e instanceof PipelineDecodeError ? e.describe() : String(e)} — ${calibrationCaptureFailureHint(validationFailureCode(e))}`,
        );
    } finally {
      lockLayout.current = false;
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function replaySavedVideos() {
    if (lock.current) return;
    lock.current = true;
    cancelled.current = false;
    runToken.current += 1;
    setBusy(true);
    setPhase('analysis');
    setError(null);
    try {
      assertCurrentPupilDetector();
      const json = await readCalibrationJson();
      if (!json) throw new Error('Chưa có video hiệu chỉnh đã lưu.');
      const saved = savedCalibrationReplay(JSON.parse(json));
      for (const take of saved.takes)
        if (!new File(take.filePath).exists)
          throw new Error('Video lượt đo cũ không còn trên máy. Cần thực hiện hiệu chỉnh mới.');
      await camera.close();
      const out = await analyzeCalibrationTakes({
        id: `cal-replay-${Date.now()}`,
        // Reprocessing must not extend the validity of an old physical capture.
        createdAtMs: saved.createdAtMs,
        context: saved.context,
        takes: saved.takes,
        reanalysisOf: { id: saved.id, measurementVersion: saved.sourceMeasurementVersion },
        cancelled: () => cancelled.current || !mounted.current,
        progress: (i) => {
          if (mounted.current)
            setMessage(
              `Đang phân tích lại video cũ ${i}/${saved.takes.length}. Không cần nhìn chấm.`,
            );
        },
      });
      if (!mounted.current) return;
      setReport(JSON.stringify(out.summary, null, 2));
      setFeedback(calibrationFeedback(out.result));
      setAuditImages(out.summary.auditImages);
      setPhase('result');
      setMessage(
        `Đã phân tích lại video ghi lúc ${new Date(saved.createdAtMs).toLocaleString()}. ${out.result.verdict === 'VALID' ? 'Số đo đạt các kiểm tra của lượt ghi cũ.' : 'Số đo vẫn chưa đạt; xem ảnh mắt gốc bên dưới.'} Thời hạn hiệu chỉnh vẫn tính từ lúc ghi, không tính từ lúc phân tích lại.`,
      );
      revealResult();
    } catch (e) {
      if (mounted.current) {
        setPhase('result');
        setError(e instanceof Error ? e.message : String(e));
        setMessage(
          cancelled.current
            ? 'Đã dừng phân tích lại video.'
            : 'Chưa hoàn thành phân tích lại video.',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function cancel() {
    cancelled.current = true;
    setTarget(null);
    void camera.stop();
  }
  return (
    <>
      <TargetStage
        visible={phase === 'capture'}
        boardRef={board}
        boundsRef={bounds}
        target={target}
        size={size}
        message={
          camera.stage === 'countdown' ? `Bắt đầu sau ${camera.countdown}… Giữ đầu yên.` : message
        }
        onCancel={cancel}
        onLayout={(layout) => {
          if (
            lockLayout.current &&
            (viewport.current.width !== layout.width || viewport.current.height !== layout.height)
          ) {
            cancel();
          }
          setSize({ width: layout.width, height: layout.height });
        }}
      />
      <ScrollView
        ref={scroll}
        style={styles.screen}
        scrollEnabled={calibrationPageScrolls(phase)}
        contentContainerStyle={styles.content}
        testID="calibration-screen"
      >
        <Text style={styles.title}>Hiệu chỉnh mắt</Text>
        <Text>
          Nhìn vào từng chấm vàng, chỉ xoay mắt. Khi bắt đầu, bảng chấm mở riêng và mọi điểm đều nằm
          trong màn hình; không cần cuộn. Giữ nguyên điện thoại, đầu và ánh sáng.
        </Text>
        {message !== '' && <Text accessibilityLiveRegion="polite">{message}</Text>}
        {error && <Text selectable>{error}</Text>}
        {phase === 'result' && !busy && (
          <CameraButton
            title="Phân tích lại video đã lưu"
            tone="secondary"
            onPress={() => void replaySavedVideos()}
          />
        )}
        {phase === 'result' && !busy && (
          <CameraButton
            title="Xuất số đo hiệu chỉnh (JSON)"
            tone="secondary"
            onPress={() => {
              void shareCalibrationEvidence().catch((e) =>
                setError(e instanceof Error ? e.message : String(e)),
              );
            }}
          />
        )}
        {auditImages.length > 0 && (
          <View>
            <Text style={styles.imageTitle}>Ảnh kiểm tra đồng tử</Text>
            <Text>
              Ảnh mắt gốc là ảnh xám chưa vẽ dấu. Ảnh đánh dấu có viền mí màu xanh và vị trí
              detector màu đỏ. Elip vàng là biên được khớp từ ảnh. Các ảnh chỉ lưu trên máy; dấu của
              detector không phải vị trí chuẩn hay bằng chứng đạt.
            </Text>
            {auditImages
              .filter((row) => primaryImages[row.target])
              .map((row) => (
                <CameraImageGallery
                  key={row.target}
                  title={primaryImages[row.target]}
                  paths={row.paths}
                  allowShare
                />
              ))}
          </View>
        )}
        {feedback.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
        {report !== '' && (
          <CameraDetails title="Báo cáo kỹ thuật và các ảnh còn lại">
            {auditImages
              .filter((row) => !primaryImages[row.target])
              .map((row) => (
                <CameraImageGallery
                  key={row.target}
                  title={`ROI ${row.target}`}
                  paths={row.paths}
                  allowShare
                />
              ))}
            <Text selectable>{report}</Text>
          </CameraDetails>
        )}
        {busy && <CameraButton title="Hủy calibration" tone="danger" onPress={cancel} />}
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
            instruction="Căn đủ mặt và hai mắt trong khung, chừa khoảng trống ở mép. Khi thấy “Giữ nguyên vị trí”, dừng di chuyển để đèn xác nhận rồi bắt đầu."
            framingGates={CALIBRATION_FRAMING_GATES}
            framingHints={{
              TOO_FAR: calibrationFramingHint('TOO_FAR'),
              TOO_CLOSE: calibrationFramingHint('TOO_CLOSE'),
              FACE_PARTIAL: calibrationFramingHint('FACE_PARTIAL'),
              READY: calibrationFramingHint('READY'),
            }}
            previewAspect={CALIBRATION_PREVIEW_ASPECT}
            onCapture={() => void calibrate()}
          />
        )}
      </ScrollView>
    </>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 160 },
  title: { fontSize: 24, fontWeight: '700' },
  imageTitle: { fontSize: 20, fontWeight: '700' },
});
