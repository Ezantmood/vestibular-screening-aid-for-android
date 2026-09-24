import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getCamera2Capabilities, getHighSpeedTargetVerdict } from '../../camera/camera2Probe';
import type { HighSpeedTargetVerdict } from '../../camera/camera2Probe';
import type { Camera2ProbeResult, FpsRange } from '../../camera/camera2ProbeTypes';
import { HIGH_SPEED_TARGETS } from '../../camera/camera2ProbeTypes';

type ProbeStatus = 'idle' | 'loading' | 'done' | 'error';

function formatRanges(ranges: FpsRange[]): string {
  if (ranges.length === 0) {
    return 'none reported';
  }
  return ranges.map((r) => `[${r.min}, ${r.max}]`).join(' ');
}

function TargetBadge({ verdict }: { verdict: HighSpeedTargetVerdict }) {
  const { target, kind, matchingRanges } = verdict;
  const style =
    kind === 'FIXED'
      ? styles.badgeYes
      : kind === 'UPPER_BOUND'
        ? styles.badgeMaybe
        : styles.badgeNo;
  const headline =
    kind === 'FIXED'
      ? `YES — fixed [${target.fps}, ${target.fps}] advertised`
      : kind === 'UPPER_BOUND'
        ? 'UPPER — fps is a range maximum, no fixed range'
        : 'NO — not advertised';
  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.badgeText}>
        {headline} — {target.label}
      </Text>
      {kind === 'UPPER_BOUND' && (
        <Text style={styles.badgeDetail}>max of: {formatRanges(matchingRanges)}</Text>
      )}
    </View>
  );
}

function CameraCard({ camera }: { camera: Camera2ProbeResult }) {
  return (
    <View style={styles.card} testID={`camera-card-${camera.cameraId}`}>
      <Text style={styles.cardTitle}>
        Camera {camera.cameraId} ({camera.lensFacing})
      </Text>
      <Text style={styles.line}>Hardware level: {camera.hardwareLevel}</Text>
      <Text style={styles.line}>Sensor orientation: {camera.sensorOrientation ?? 'unknown'}°</Text>
      <Text style={styles.line}>
        Constrained high-speed video:{' '}
        {camera.constrainedHighSpeedVideoSupported ? 'supported' : 'NOT supported'}
      </Text>
      {camera.error !== null && camera.error !== '' && (
        <Text style={styles.error}>Per-camera error: {camera.error}</Text>
      )}

      <Text style={styles.sectionTitle}>High-speed targets (strict Camera2 reading)</Text>
      <Text style={styles.note}>
        YES = fixed [fps, fps] advertised. UPPER = fps only tops a range (no fixed range). Raw
        ranges below are authoritative.
      </Text>
      {HIGH_SPEED_TARGETS.map((target) => (
        <TargetBadge key={target.label} verdict={getHighSpeedTargetVerdict(camera, target)} />
      ))}

      <Text style={styles.sectionTitle}>Normal AE FPS ranges</Text>
      <Text style={styles.mono}>{formatRanges(camera.aeFpsRanges)}</Text>

      <Text style={styles.sectionTitle}>Raw high-speed video sizes + FPS ranges</Text>
      {camera.highSpeedVideoSizes.length === 0 ? (
        <Text style={styles.mono}>none reported</Text>
      ) : (
        camera.highSpeedVideoSizes.map((entry) => (
          <Text key={`${entry.width}x${entry.height}`} style={styles.mono}>
            {entry.width}×{entry.height}: {formatRanges(entry.fpsRanges)}
          </Text>
        ))
      )}
    </View>
  );
}

// P0.1 debug screen (Development Build on Android only). Read-only probe:
// no capture sessions, no recording. Shows every CameraManager camera as
// reported by Camera2 — nothing hard-coded.
export default function Camera2ProbeScreen() {
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [cameras, setCameras] = useState<Camera2ProbeResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function runProbe() {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const results = await getCamera2Capabilities();
      setCameras(results);
      setStatus('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="camera2-probe-screen"
    >
      <Text style={styles.title}>Camera2 Capability Probe (P0.1)</Text>
      <Text style={styles.note}>
        Requires an Expo Development Build on Android. Values come from the real Camera2 API —
        nothing hard-coded.
      </Text>
      <Button
        title={status === 'loading' ? 'Probing…' : 'Probe cameras'}
        onPress={runProbe}
        disabled={status === 'loading'}
      />
      {status === 'error' && errorMessage !== null && (
        <Text style={styles.error} testID="probe-error">
          {errorMessage}
        </Text>
      )}
      {status === 'done' && cameras.length === 0 && (
        <Text style={styles.note}>No cameras reported by CameraManager.</Text>
      )}
      {cameras.map((camera) => (
        <CameraCard key={camera.cameraId} camera={camera} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeNo: {
    backgroundColor: '#fde2e2',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  badgeDetail: {
    fontSize: 12,
    marginTop: 2,
  },
  badgeYes: {
    backgroundColor: '#d9f2dd',
  },
  badgeMaybe: {
    backgroundColor: '#fdf0d5',
  },
  card: {
    borderColor: '#ccc',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
    width: '100%',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  content: {
    alignItems: 'stretch',
    padding: 16,
  },
  error: {
    color: '#b00020',
    fontSize: 13,
    marginTop: 8,
  },
  line: {
    fontSize: 13,
    marginTop: 2,
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
