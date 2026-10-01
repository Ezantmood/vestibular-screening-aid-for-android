import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { FramePipelineReport } from '../../camera/framePipeline';
import { analyzeVideoFile, isFramePipelineAvailable } from '../../camera/framePipeline';
import { formatFramePipelineReport } from '../../camera/framePipelineReport';
import type { FixedMode } from '../../camera/fixedModes';
import { collectFixedModes } from '../../camera/fixedModes';
import type { HighSpeedTestReport } from '../../camera/highSpeedCapture';
import {
  cancelHighSpeedTest,
  isHighSpeedCaptureAvailable,
  startHighSpeedTest,
} from '../../camera/highSpeedCapture';
import { getCamera2Capabilities } from '../../camera/camera2Probe';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type Phase = 'idle' | 'loading-modes' | 'ready' | 'recording' | 'analyzing' | 'done' | 'error';

/** P2 validation window: approximately 10 seconds per mode. */
const TEST_DURATION_SEC = 10;

/** P2 validation ROI sample: 64 evenly distributed offline frames (50–100 target, never realtime). */
const FACE_SAMPLE_COUNT = 64;

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (!isHighSpeedCaptureAvailable() || !isFramePipelineAvailable()) {
    return 'unavailable';
  }
  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return 'granted';
  }
  const result = await PermissionsAndroid.request(permission, {
    title: 'Camera access for frame-pipeline test',
    message:
      'P2 records ~10 s with the front camera (user looks at the display), then decodes the MP4 offline. No other permission is requested.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'blocked';
  }
  return 'denied';
}

// P2 debug screen (Development Build on Android only). Flow: record ~10 s with
// a Camera2-advertised fixed mode (FRONT 1080p120 default), then decode the
// MP4 offline via MediaExtractor + MediaCodec, validate the media timeline,
// check for frozen frames via luminance MAD, and sample face/eye ROI via
// ML Kit (feasibility boxes only — NOT pupil tracking).
export default function FramePipelineScreen() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [capture, setCapture] = useState<HighSpeedTestReport | null>(null);
  const [pipeline, setPipeline] = useState<FramePipelineReport | null>(null);
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
        setErrorMessage('No fixed high-speed modes advertised by Camera2 on this device.');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
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
      void cancelHighSpeedTest();
    };
  }, [loadModes]);

  async function askPermission() {
    setPermission('checking');
    const state = await requestCameraPermission();
    setPermission(state);
    if (state === 'granted') {
      await loadModes();
    }
  }

  async function runRecordAndAnalyze() {
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    setPhase('recording');
    setCapture(null);
    setPipeline(null);
    setErrorMessage(null);
    try {
      const result = await startHighSpeedTest({
        cameraId: mode.cameraId,
        width: mode.width,
        height: mode.height,
        fpsMin: mode.fpsMin,
        fpsMax: mode.fpsMax,
        durationSec: TEST_DURATION_SEC,
      });
      setCapture(result);
      if (!result.filePath) {
        setErrorMessage('Recording produced no file; cannot decode.');
        setPhase('error');
        return;
      }
      setPhase('analyzing');
      const analysis = await analyzeVideoFile({
        filePath: result.filePath,
        expectedFps: mode.fpsMax,
        faceSampleCount: FACE_SAMPLE_COUNT,
        saveDebugFrames: true,
      });
      setPipeline(analysis);
      setPhase('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  async function analyzeLastRecording() {
    const mode = modes[selectedIndex];
    if (!mode || !capture?.filePath) {
      return;
    }
    setPhase('analyzing');
    setPipeline(null);
    setErrorMessage(null);
    try {
      const analysis = await analyzeVideoFile({
        filePath: capture.filePath,
        expectedFps: mode.fpsMax,
        faceSampleCount: FACE_SAMPLE_COUNT,
        saveDebugFrames: true,
      });
      setPipeline(analysis);
      setPhase('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  const selectedMode = modes[selectedIndex] ?? null;
  const reportText =
    capture !== null && pipeline !== null && selectedMode !== null
      ? formatFramePipelineReport({
          deviceModel: capture.deviceModel,
          androidRelease: capture.androidRelease,
          apiLevel: capture.apiLevel,
          cameraLabel: `${selectedMode.cameraId} ${selectedMode.lensFacing}`,
          captureLabel: `${selectedMode.width}x${selectedMode.height} [${selectedMode.fpsMin},${selectedMode.fpsMax}]`,
          expectedFps: selectedMode.fpsMax,
          report: pipeline,
        })
      : null;
  const busy = phase === 'recording' || phase === 'analyzing';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="frame-pipeline-screen"
    >
      <Text style={styles.title}>Frame Decode + Eye ROI Feasibility (P2)</Text>
      <Text style={styles.note}>
        Development Build on Android only. Default is FRONT 1920×1080 @ fixed 120fps (MVP candidate:
        user looks at the display). Timestamps are encoded/media PTS — not sensor exposure. Face/eye
        boxes are feasibility ROIs, not pupil tracking. Debug JPEGs stay in device-local cache and
        are never committed.
      </Text>

      {permission === 'checking' && <Text style={styles.note}>Checking camera permission…</Text>}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="frame-pipeline-unavailable">
          Frame-pipeline analysis is unavailable here (needs an Expo Development Build on Android
          with the P1 + P2 native modules). No camera was opened.
        </Text>
      )}

      {permission === 'denied' && (
        <View>
          <Text style={styles.error}>Camera permission denied — the test cannot run.</Text>
          <Button title="Request camera permission" onPress={askPermission} />
        </View>
      )}

      {permission === 'blocked' && (
        <View>
          <Text style={styles.error}>
            Camera permission permanently denied. Enable it in system Settings, then retry.
          </Text>
          <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
          <Button title="Retry permission check" onPress={askPermission} />
        </View>
      )}

      {permission === 'granted' && (phase === 'loading-modes' || phase === 'idle') && (
        <Text style={styles.note}>Enumerating Camera2 high-speed modes…</Text>
      )}

      {permission === 'granted' && modes.length > 0 && (
        <View>
          <Text style={styles.sectionTitle}>Mode (FRONT 1080p120 default; rear = benchmark)</Text>
          {modes.map((mode, index) => (
            <View key={mode.label} style={styles.modeRow}>
              <Button
                title={`${index === selectedIndex ? '● ' : ''}${mode.label}`}
                onPress={() => setSelectedIndex(index)}
                disabled={busy}
              />
            </View>
          ))}
          {selectedMode !== null && (
            <Text style={styles.line}>
              Selected: camera {selectedMode.cameraId} ({selectedMode.lensFacing}),{' '}
              {selectedMode.width}x{selectedMode.height}, exact range [{selectedMode.fpsMin},
              {selectedMode.fpsMax}]
            </Text>
          )}
          {!busy ? (
            <View style={styles.buttonGap}>
              <Button
                title={`Record ${TEST_DURATION_SEC}s + analyze`}
                onPress={runRecordAndAnalyze}
              />
              <View style={styles.gap} />
              <Button
                title="Re-analyze last recording"
                onPress={analyzeLastRecording}
                disabled={!capture?.filePath}
              />
            </View>
          ) : (
            <View>
              <Text style={styles.note}>
                {phase === 'recording'
                  ? `Recording ~${TEST_DURATION_SEC} s — look at the phone display…`
                  : 'Decoding + analyzing 64 offline ROI frames (may take ~1–3 min)…'}
              </Text>
              <Button title="Stop capture" onPress={() => void cancelHighSpeedTest()} />
            </View>
          )}
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="frame-pipeline-error">
          {errorMessage}
        </Text>
      )}

      {capture !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Capture (P1 module)</Text>
          <Text style={styles.mono}>File: {capture.filePath ?? '(none)'}</Text>
          <Text style={styles.mono}>
            Encoder cross-check: samples={capture.extractorSampleCount ?? '?'} durationUs=
            {capture.extractorDurationUs ?? '?'}
          </Text>
        </View>
      )}

      {reportText !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>P2 report (long-press to copy)</Text>
          <Text style={styles.mono} selectable testID="frame-pipeline-report">
            {reportText}
          </Text>
        </View>
      )}

      {pipeline !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Face samples (numeric metadata only)</Text>
          {pipeline.faceSamples.map((s) => (
            <Text key={`face-${s.frameIndex}`} style={styles.mono}>
              f{s.frameIndex} ptsUs={s.ptsUs ?? '?'} face={s.faceDetected ? 'yes' : 'no'}
              {' L='}
              {s.leftEye !== null ? `${s.leftEye.width}x${s.leftEye.height}` : '-'}
              {' R='}
              {s.rightEye !== null ? `${s.rightEye.width}x${s.rightEye.height}` : '-'}
            </Text>
          ))}
          <Text style={styles.mono}>Debug frames: {pipeline.savedFramePaths.length}</Text>
          <Text style={styles.mono}>Eye crops: {pipeline.savedCropPaths.length}</Text>
        </View>
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
  gap: {
    height: 8,
  },
  line: {
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
    fontSize: 12,
    marginBottom: 8,
    opacity: 0.7,
  },
  root: {
    flex: 1,
    width: '100%',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
});
