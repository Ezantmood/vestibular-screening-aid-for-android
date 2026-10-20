import { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import { collectFixedModes, type FixedMode } from '../../camera/fixedModes';
import { isLivePreviewAvailable } from '../../camera/livePreview';
import { assertCurrentPupilDetector } from '../../camera/pupilDetector';
import { t } from '../../clinic/copy';
import {
  extendedQuality,
  extendedRows,
  parseNpcCm,
  positionAt,
  RECORD_MS,
} from '../../clinic/protocols';
import { tracesFromProcessed } from '../../clinic/trace';
import type { ClinicTestId, EyeTrace, Lang, MetricRow, NormGroup } from '../../clinic/types';
import { deleteRecordingFile } from '../../clinic/vault';
import { analyzeEyeRecording } from '../../tests/eyeAnalysis';
import CameraCapturePanel from '../components/CameraCapturePanel';
import { CameraButton, cameraColors } from '../components/CameraUI';
import { CaptureCancelled, usePreviewCapture } from '../hooks/usePreviewCapture';
import { useEyeAnalysisAwake } from '../hooks/useEyeAnalysisAwake';

export type ExtendedDraft = {
  testId: ClinicTestId;
  quality: 'RECORDED' | 'INVALID';
  rows: MetricRow[];
  trace: EyeTrace[];
  fps: number | null;
  durationMs: number;
  npcCm: number | null;
  npcMarked: boolean;
};

export default function ExtendedRun({
  testId,
  lang,
  group,
  onDone,
  onBack,
}: {
  testId: ClinicTestId;
  lang: Lang;
  group: NormGroup;
  onDone: (draft: ExtendedDraft) => void;
  onBack: () => void;
}) {
  const camera = usePreviewCapture();
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mark, setMark] = useState(positionAt(testId, 0));
  const [cm, setCm] = useState('');
  const [breakMs, setBreakMs] = useState<number | null>(null);
  const [recoveryMs, setRecoveryMs] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const recordStart = useRef<number | null>(null);
  const lock = useRef(false);
  useEyeAnalysisAwake(busy);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        assertCurrentPupilDetector();
        if (Platform.OS !== 'android' || !isLivePreviewAvailable()) {
          throw new Error('Cần Android Development Build.');
        }
        const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (permission !== PermissionsAndroid.RESULTS.GRANTED)
          throw new Error('Chưa được cấp quyền camera.');
        const probe = await getCamera2Capabilities();
        if (!live) return;
        const front = collectFixedModes(probe).filter((mode) => mode.lensFacing === 'FRONT');
        setModes(front);
        const preferred = front.findIndex(
          (mode) => mode.width === 1920 && mode.height === 1080 && mode.fpsMax === 120,
        );
        if (preferred >= 0) setIndex(preferred);
      } catch (cause) {
        if (live) setError(String(cause));
      }
    })();
    return () => {
      live = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  function startStimulus() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const started = performance.now();
    recordStart.current = started;
    const tick = () => {
      const elapsed = performance.now() - started;
      setMark(positionAt(testId, elapsed));
      if (elapsed < RECORD_MS) frame.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function markTime(kind: 'break' | 'recovery') {
    const started = recordStart.current;
    if (started === null) return;
    const elapsed = performance.now() - started;
    if (kind === 'break') setBreakMs(elapsed);
    else setRecoveryMs(elapsed);
  }

  async function capture() {
    const mode = modes[index];
    if (!mode || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let filePath: string | null = null;
    try {
      const report = await camera.capture(mode, RECORD_MS / 1000, () => {
        startStimulus();
      });
      filePath = report.filePath ?? null;
      await camera.close();
      if (report.manualStop || !filePath) {
        await deleteRecordingFile(filePath);
        if (report.manualStop) setError(t(lang, 'cancelTest'));
        return;
      }
      const eye = await analyzeEyeRecording(filePath, mode.fpsMax);
      const trace = tracesFromProcessed(
        eye.signals.map((signal) => ({ eyeSide: signal.eyeSide, samples: signal.pupil.samples })),
      );
      await deleteRecordingFile(filePath);
      await deleteRecordingFile(eye.path);
      filePath = null;
      const npcCm = parseNpcCm(cm);
      onDone({
        testId,
        quality: extendedQuality(trace),
        rows: extendedRows(testId, trace, group, { cm: npcCm, breakMs, recoveryMs }, false),
        trace,
        fps: mode.fpsMax,
        durationMs: RECORD_MS,
        npcCm,
        npcMarked: breakMs !== null || recoveryMs !== null,
      });
    } catch (cause) {
      await deleteRecordingFile(filePath);
      if (!(cause instanceof CaptureCancelled)) setError(String(cause));
    } finally {
      lock.current = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <CameraButton title={t(lang, 'back')} tone="secondary" onPress={onBack} />
      <View style={styles.board}>
        {mark.stripe ? (
          <View
            style={[
              styles.stripes,
              { transform: [{ translateX: (mark.stripe === 'left' ? -1 : 1) * mark.phase * 48 }] },
            ]}
          >
            {Array.from({ length: 14 }, (_, stripe) => (
              <View key={stripe} style={[styles.bar, stripe % 2 === 0 && styles.barOn]} />
            ))}
          </View>
        ) : testId === 'npc' ? (
          <View
            style={[styles.near, { width: 36 + mark.scale * 150, height: 36 + mark.scale * 150 }]}
          />
        ) : (
          <View style={[styles.dot, { left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }]} />
        )}
      </View>
      <Text style={styles.note}>{t(lang, 'durationNote')}</Text>
      <Text style={styles.note}>{t(lang, 'pupilLater')}</Text>
      {testId === 'npc' && (
        <View style={styles.npc}>
          <Text style={styles.note}>{t(lang, 'npcHint')}</Text>
          <TextInput
            value={cm}
            onChangeText={setCm}
            keyboardType="decimal-pad"
            placeholder={t(lang, 'npcCm')}
            placeholderTextColor={cameraColors.muted}
            accessibilityLabel={t(lang, 'npcCm')}
            style={styles.input}
          />
          <CameraButton
            title={t(lang, 'breakPoint')}
            tone="secondary"
            onPress={() => markTime('break')}
          />
          <CameraButton
            title={t(lang, 'recoveryPoint')}
            tone="secondary"
            onPress={() => markTime('recovery')}
          />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {modes.length > 0 && (
        <CameraCapturePanel
          camera={camera}
          modes={modes}
          selectedIndex={index}
          onSelect={setIndex}
          onCapture={() => void capture()}
          busy={busy}
          phase={busy ? 'analyzing' : 'ready'}
          duration={RECORD_MS / 1000}
          startTitle={t(lang, 'startRecording')}
          stopTitle={t(lang, 'cancelTest')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  board: {
    height: 220,
    margin: 12,
    borderRadius: 18,
    backgroundColor: '#102833',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    backgroundColor: '#F2C14E',
  },
  near: { borderRadius: 999, backgroundColor: '#F2C14E' },
  stripes: { flexDirection: 'row', alignItems: 'center' },
  bar: { width: 16, height: 180, marginRight: 16, backgroundColor: '#314854' },
  barOn: { backgroundColor: '#E8F5F4' },
  note: { color: cameraColors.muted, fontSize: 13, lineHeight: 18, marginHorizontal: 16 },
  npc: { gap: 8, margin: 12 },
  input: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    borderRadius: 12,
    backgroundColor: '#FFF',
    color: cameraColors.ink,
    padding: 12,
    fontSize: 16,
  },
  error: { color: cameraColors.danger, margin: 12 },
});
