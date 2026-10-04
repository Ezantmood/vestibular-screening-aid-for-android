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

import { isFramePipelineAvailable } from '../../camera/framePipeline';
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
  cameraConditionName,
} from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import {
  isHintedPupilDetectorAvailable,
  isPupilDetectorAvailable,
} from '../../camera/pupilDetector';
import type { EyeSide, PupilDetectionResult } from '../../eyetracking/pupil/pupilTypes';
import type { PupilTrackingResult } from '../../eyetracking/tracking/trackingTypes';
import {
  analyzeFileForTracking,
  buildAuditIndex,
} from '../../eyetracking/tracking/denseTrackAnalysis';
import {
  aggregateTrackingStatsForRuns,
  formatTrackingReport,
  trackingRobustnessVerdict,
} from '../../eyetracking/tracking/trackingReport';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type Phase =
  | 'idle'
  | 'loading-modes'
  | 'ready'
  | 'recording'
  | 'analyzing'
  | 'detecting'
  | 'rescuing'
  | 'done'
  | 'error';

/** P4 validation window: approximately 10 seconds per condition. */
const TEST_DURATION_SEC = 10;

/**
 * P4 keyframes: 120 ML Kit eye-ROI keyframes per condition, propagated to
 * every decoded frame for a full-rate track (offline only, never realtime).
 */
const TRACK_KEYFRAME_COUNT = 120;

/** Baseline detector for the P4 track (P3 feasibility winner). */
const DETECTOR_ID = 'percentile-dark' as const;

/** Movement/robustness conditions the operator performs during each capture. */
const CONDITIONS = [
  'center',
  'lr-move',
  'ud-move',
  'blink',
  'eyes-closed',
  'head-move',
  'loss-reacquire',
] as const;
type Condition = (typeof CONDITIONS)[number];

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (
    !isHighSpeedCaptureAvailable() ||
    !isFramePipelineAvailable() ||
    !isPupilDetectorAvailable() ||
    !isHintedPupilDetectorAvailable()
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

interface ConditionRun {
  condition: Condition;
  capture: HighSpeedTestReport | null;
  rawResults: PupilDetectionResult[];
  tracked: PupilTrackingResult[];
  hintCount: number;
  rescuedCount: number;
  overlayIndex: string;
  overlayPaths: string[];
}

// P4 debug screen (Development Build on Android only). Flow per condition:
// record ~10 s FRONT 1080p120 → P2 decode + 120 ML Kit keyframes → ROI
// propagation to every decoded frame → dense P3 batch → hinted rescue →
// final temporal track → P3-vs-P4 stats. No gaze, no calibration, no
// clinical metrics: coordinates are analysis image-space only.
export default function TrackingValidationScreen() {
  const camera = usePreviewCapture();
  const runInProgress = useRef(false);
  const screenMounted = useRef(true);
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [condition, setCondition] = useState<Condition>('center');
  const [runs, setRuns] = useState<ConditionRun[]>([]);
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

  function logChunked(tag: string, text: string): void {
    const lines = text.split('\n');
    const CHUNK = 25;
    for (let i = 0; i < lines.length; i += CHUNK) {
      console.log(`${tag} [${i / CHUNK + 1}] ${lines.slice(i, i + CHUNK).join('\n')}`);
    }
  }
  async function askPermission() {
    setPermission('checking');
    const state = await requestCameraPermission();
    setPermission(state);
    if (state === 'granted') {
      await loadModes();
    }
  }

  async function runRecordTrack(explicitCondition?: Condition) {
    if (runInProgress.current) return;
    const mode = modes[selectedIndex];
    const activeCondition = explicitCondition ?? condition;
    if (!mode) {
      return;
    }
    runInProgress.current = true;
    setPhase('recording');
    setErrorMessage(null);
    try {
      const capture = await camera.capture(mode, TEST_DURATION_SEC);
      await camera.close();
      if (!capture.filePath) {
        setErrorMessage('Không lưu được video. Hãy mở lại camera và quay lại.');
        setPhase('error');
        return;
      }
      if (!screenMounted.current) return;
      setPhase('analyzing');
      const run = await analyzeFileForTracking({
        filePath: capture.filePath,
        condition: activeCondition,
        faceSampleCount: TRACK_KEYFRAME_COUNT,
        detectorId: DETECTOR_ID,
        expectedFps: mode.fpsMax,
      });
      if (!screenMounted.current) return;
      setPhase('detecting');
      const overlayIndex = buildAuditIndex(run.tracked, run.auditOverlays);
      setAuditPassed(false);
      setRuns((prev) => [
        ...prev.filter((r) => r.condition !== activeCondition),
        {
          condition: activeCondition,
          capture,
          rawResults: run.rawResults,
          tracked: run.tracked,
          hintCount: run.hintCount,
          rescuedCount: run.rescuedCount,
          overlayIndex,
          overlayPaths: run.auditOverlays,
        },
      ]);
      console.log(
        `P4-RUN run complete: condition=${activeCondition} decoded=${run.decodedFrames} keys=${run.keyframes} slots=${run.propagatedSlots} hints=${run.hintCount} rescued=${run.rescuedCount} rescueFailures=${JSON.stringify(run.rescueFailures)} file=${capture.filePath ?? '(none)'}`,
      );
      console.log(
        `P4-RUN rescued frames: condition=${activeCondition} ` +
          `${run.tracked
            .filter((t) => t.rescued)
            .map((t) => `${t.eyeSide[0]}${t.frameIndex}`)
            .join(',')}`,
      );
      logChunked(`P4-AUDIT-${activeCondition}`, overlayIndex);
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

  const busy =
    phase === 'recording' || phase === 'analyzing' || phase === 'detecting' || phase === 'rescuing';

  function combinedReport(): string {
    const stats = aggregateTrackingStatsForRuns(
      runs.map((run) => ({ condition: run.condition, raw: run.rawResults, tracked: run.tracked })),
    );
    const verdict = trackingRobustnessVerdict({ stats, visualAuditPassed: auditPassed });
    return formatTrackingReport({
      stats,
      verdict,
      captureLabel: runs
        .map(
          (r) =>
            r.condition +
            ':' +
            r.capture?.cameraId +
            ':' +
            r.capture?.width +
            'x' +
            r.capture?.height +
            '@' +
            r.capture?.fpsMax,
        )
        .join(','),
    });
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="tracking-validation-screen"
    >
      <Text style={styles.title}>Theo dõi chuyển động mắt</Text>
      <Text style={styles.note}>
        Chọn một bài chuyển động, căn mặt rồi quay 10 giây để kiểm tra khả năng theo dõi mắt.
      </Text>

      {permission === 'checking' && <CameraProgress title="Đang kiểm tra quyền camera…" />}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="tracking-validation-unavailable">
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
            onCapture={() => void runRecordTrack()}
            busy={busy}
            phase={phase}
            requireFace={true}
            instruction={cameraConditionHint(condition)}
          />
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="tracking-validation-error">
          {errorMessage}
        </Text>
      )}

      {runs.length > 0 && (
        <CameraSummary
          title={'Đã hoàn tất ' + runs.length + ' bài ghi hình'}
          detail="Mỗi bài có kết quả theo dõi riêng. Có thể chọn bài khác và quay tiếp."
        />
      )}
      {runs.map((run) => (
        <CameraImageGallery
          key={run.condition}
          paths={run.overlayPaths}
          title={'Ảnh kiểm tra · ' + cameraConditionName(run.condition)}
        />
      ))}
      {runs.length > 0 && (
        <CameraDetails>
          {runs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Visual audit (required for PASS)</Text>
              <Text style={styles.note}>
                Inspect the overlay JPEGs in the device-local cache (`pupildebug/`): accepted
                centroids must sit on pupils; blink/lost frames must show no fabricated marker;
                reacquired frames must return to the real pupil. Toggle only after auditing — never
                before.
              </Text>
              <Button
                title={auditPassed ? '✓ Đã kiểm tra ảnh của các bài' : 'Xác nhận đã kiểm tra ảnh'}
                onPress={() => setAuditPassed((v) => !v)}
              />
            </View>
          )}

          {runs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Combined P4 report (long-press to copy)</Text>
              <Text style={styles.mono} selectable testID="tracking-combined-report">
                {combinedReport()}
              </Text>
            </View>
          )}

          {runs.map((run) => (
            <View key={run.condition} style={styles.card}>
              <Text style={styles.sectionTitle}>
                Run {run.condition}: slots={run.tracked.length} hints={run.hintCount} rescued=
                {run.rescuedCount} file={run.capture?.filePath ?? '(none)'}
              </Text>
              <Text style={styles.mono}>left sample:</Text>
              {run.tracked
                .filter((t: PupilTrackingResult) => t.eyeSide === ('left' as EyeSide))
                .slice(0, 8)
                .map((t: PupilTrackingResult) => (
                  <Text key={`l-${t.frameIndex}`} style={styles.mono}>
                    f{t.frameIndex} {t.trackingState} conf={t.trackingConfidence.toFixed(2)}
                    {t.rescued ? ' rescued' : ''} dropout={(t.dropoutDurationUs / 1000).toFixed(1)}
                    ms {t.failureReason ?? 'OK'}
                  </Text>
                ))}
              <Text style={styles.mono}>audit index (overlay file names):</Text>
              <Text style={styles.mono} selectable>
                {run.overlayIndex}
              </Text>
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
