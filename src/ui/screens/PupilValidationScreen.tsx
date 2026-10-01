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
import type { FixedMode } from '../../camera/fixedModes';
import { collectFixedModes } from '../../camera/fixedModes';
import type { HighSpeedTestReport } from '../../camera/highSpeedCapture';
import {
  cancelHighSpeedTest,
  isHighSpeedCaptureAvailable,
  startHighSpeedTest,
} from '../../camera/highSpeedCapture';
import { getCamera2Capabilities } from '../../camera/camera2Probe';
import type { PupilBatchReport } from '../../camera/pupilDetector';
import { isPupilDetectorAvailable, runPupilBatch } from '../../camera/pupilDetector';
import type { PupilDetectionResult, PupilDetectorId } from '../../eyetracking/pupil/pupilTypes';
import {
  aggregatePupilStats,
  formatPupilReport,
  pupilDetectionVerdict,
} from '../../eyetracking/pupil/pupilReport';

type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked' | 'unavailable';
type Phase =
  'idle' | 'loading-modes' | 'ready' | 'recording' | 'analyzing' | 'detecting' | 'done' | 'error';

/** P3 validation window: approximately 10 seconds per condition. */
const TEST_DURATION_SEC = 10;

/**
 * P3 pupil ROI sample: 40 evenly distributed offline frames (≤80 eye slots).
 * The P2 decoder is reused untouched; pupil detection runs per usable ROI.
 */
const PUPIL_SAMPLE_COUNT = 40;

const DETECTORS: PupilDetectorId[] = ['percentile-dark', 'contrast-normalized'];

/** Gaze/posture conditions the operator performs during the ~10 s capture. */
const CONDITIONS = ['center', 'left', 'right', 'up', 'down', 'blink', 'head-move'] as const;
type Condition = (typeof CONDITIONS)[number];

async function requestCameraPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  if (
    !isHighSpeedCaptureAvailable() ||
    !isFramePipelineAvailable() ||
    !isPupilDetectorAvailable()
  ) {
    return 'unavailable';
  }
  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return 'granted';
  }
  const result = await PermissionsAndroid.request(permission, {
    title: 'Camera access for pupil-detection test',
    message:
      'P3 records ~10 s with the front camera under one gaze condition, then decodes offline and localizes pupils. No other permission is requested.',
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

interface DetectorRun {
  detectorId: PupilDetectorId;
  results: PupilDetectionResult[];
  batch: PupilBatchReport | null;
}

// P3 debug screen (Development Build on Android only). Flow: record ~10 s
// with FRONT 1080p120 under one gaze condition → P2 decode + eye ROI
// (decoder untouched, ML Kit = ROI only) → pupil batch for BOTH candidate
// detectors → per-detector coverage/confidence/failure statistics. No gaze
// estimation, no clinical metrics: centroid movement is never interpreted.
export default function PupilValidationScreen() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modes, setModes] = useState<FixedMode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [condition, setCondition] = useState<Condition>('center');
  const [capture, setCapture] = useState<HighSpeedTestReport | null>(null);
  const [pipeline, setPipeline] = useState<FramePipelineReport | null>(null);
  const [runs, setRuns] = useState<DetectorRun[]>([]);
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

  async function runRecordAnalyzeDetect() {
    const mode = modes[selectedIndex];
    if (!mode) {
      return;
    }
    setPhase('recording');
    setCapture(null);
    setPipeline(null);
    setRuns([]);
    setAuditPassed(false);
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
        faceSampleCount: PUPIL_SAMPLE_COUNT,
        saveDebugFrames: false,
      });
      setPipeline(analysis);
      setPhase('detecting');
      const completed: DetectorRun[] = [];
      for (const detectorId of DETECTORS) {
        const { results, report } = await runPupilBatch({
          filePath: result.filePath,
          faceSamples: analysis.faceSamples,
          detectorId,
          saveOverlays: true,
          condition,
        });
        completed.push({ detectorId, results, batch: report });
      }
      setRuns(completed);
      setPhase('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  const selectedMode = modes[selectedIndex] ?? null;
  const busy = phase === 'recording' || phase === 'analyzing' || phase === 'detecting';

  function reportFor(run: DetectorRun): string {
    const byKey = new Map<string, string>();
    for (const r of run.results) {
      byKey.set(`${r.frameIndex}:${r.eyeSide}`, condition);
    }
    const stats = aggregatePupilStats(run.results, byKey);
    const verdict = pupilDetectionVerdict({ stats, visualAuditPassed: auditPassed });
    return formatPupilReport({
      stats,
      verdict,
      captureLabel: `${selectedMode?.width}x${selectedMode?.height} [${selectedMode?.fpsMin},${selectedMode?.fpsMax}] condition=${condition}`,
    });
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="pupil-validation-screen"
    >
      <Text style={styles.title}>Pupil Detection Prototype (P3)</Text>
      <Text style={styles.note}>
        Development Build on Android only. FRONT 1080p120 default. The P2 decoder + ML Kit eye ROI
        are reused untouched; pupil centroids are single-frame feasibility only — never gaze angle,
        never clinical metrics. Debug overlays stay in device-local cache and are never committed.
      </Text>

      {permission === 'checking' && <Text style={styles.note}>Checking camera permission…</Text>}

      {permission === 'unavailable' && (
        <Text style={styles.error} testID="pupil-validation-unavailable">
          Pupil validation is unavailable here (needs an Expo Development Build on Android with the
          P1 + P2 + pupil native modules). No camera was opened.
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
          <Text style={styles.sectionTitle}>Mode (FRONT 1080p120 default)</Text>
          {modes.map((mode, index) => (
            <View key={mode.label} style={styles.modeRow}>
              <Button
                title={`${index === selectedIndex ? '● ' : ''}${mode.label}`}
                onPress={() => setSelectedIndex(index)}
                disabled={busy}
              />
            </View>
          ))}
          <Text style={styles.sectionTitle}>Gaze condition (perform during capture)</Text>
          <View style={styles.conditionRow}>
            {CONDITIONS.map((c) => (
              <View key={c} style={styles.conditionButton}>
                <Button
                  title={`${c === condition ? '● ' : ''}${c}`}
                  onPress={() => setCondition(c)}
                  disabled={busy}
                />
              </View>
            ))}
          </View>
          {!busy ? (
            <View style={styles.buttonGap}>
              <Button
                title={`Record ${TEST_DURATION_SEC}s (${condition}) + detect pupils`}
                onPress={runRecordAnalyzeDetect}
              />
            </View>
          ) : (
            <View>
              <Text style={styles.note}>
                {phase === 'recording'
                  ? `Recording ~${TEST_DURATION_SEC} s — ${condition} gaze, look at the phone display…`
                  : phase === 'analyzing'
                    ? 'Decoding + ML Kit eye ROI (P2 pass)…'
                    : 'Localizing pupils with both candidate detectors…'}
              </Text>
              <Button title="Stop capture" onPress={() => void cancelHighSpeedTest()} />
            </View>
          )}
        </View>
      )}

      {(phase === 'error' || phase === 'done') && errorMessage !== null && (
        <Text style={styles.error} testID="pupil-validation-error">
          {errorMessage}
        </Text>
      )}

      {capture !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Capture (P1 module)</Text>
          <Text style={styles.mono}>File: {capture.filePath ?? '(none)'}</Text>
        </View>
      )}

      {pipeline !== null && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Eye ROI input (P2 pass)</Text>
          <Text style={styles.mono}>
            Face samples: {pipeline.faceSamples.length} rate={pipeline.faceDetectionRate ?? '?'}{' '}
            both-eyes={pipeline.bothEyesUsableRate ?? '?'}
          </Text>
        </View>
      )}

      {runs.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Visual audit (required for PASS)</Text>
          <Text style={styles.note}>
            Inspect the overlay JPEGs in the device-local cache (`pupildebug/`): the red crosshair
            must visibly fall on the pupil in representative successful samples. Toggle only after
            auditing — never before.
          </Text>
          <Button
            title={
              auditPassed ? '● Overlays audited: centroids on pupils' : 'Mark overlays audited'
            }
            onPress={() => setAuditPassed((v) => !v)}
          />
        </View>
      )}

      {runs.map((run) => (
        <View key={run.detectorId} style={styles.card}>
          <Text style={styles.sectionTitle}>P3 report — {run.detectorId} (long-press to copy)</Text>
          <Text style={styles.mono} selectable testID={`pupil-report-${run.detectorId}`}>
            {reportFor(run)}
          </Text>
          <Text style={styles.mono}>
            Overlays: {run.batch?.overlayPaths.length ?? 0} warnings:{' '}
            {(run.batch?.warnings.length ?? 0) > 0
              ? (run.batch?.warnings.slice(0, 3).join(' | ') ?? '')
              : '(none)'}
          </Text>
          {run.results.slice(0, 10).map((r) => (
            <Text key={`${run.detectorId}-${r.frameIndex}-${r.eyeSide}`} style={styles.mono}>
              f{r.frameIndex} {r.eyeSide} n=({r.normalizedX?.toFixed(3) ?? '?'},
              {r.normalizedY?.toFixed(3) ?? '?'}) conf={r.confidence.toFixed(2)}{' '}
              {r.failureReason ?? 'OK'}
            </Text>
          ))}
        </View>
      ))}
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
    // Clearance above the phone system navigation bar so no button ends up
    // underneath it and untappable.
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
