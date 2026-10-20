import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cameraColors } from '../components/CameraUI';
import type { EyeTrace, Flag } from '../../clinic/types';

export const flagColor: Record<Flag, string> = {
  green: '#0E7C4A',
  yellow: '#A15C07',
  red: '#B42335',
  unscored: '#526A78',
};

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  testID?: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={cameraColors.muted}
        multiline={multiline}
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn]}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function TraceChart({ traces }: { traces: EyeTrace[] }) {
  const colors = ['#087E8B', '#B45309'];
  return (
    <View>
      {traces.map((trace, eye) => {
        const points = trace.points.filter((point) => point.x !== null);
        if (points.length < 2) return null;
        const xs = points.map((point) => point.x as number);
        const min = Math.min(...xs);
        const max = Math.max(...xs);
        const span = Math.max(0.001, max - min);
        const last = Math.max(points[points.length - 1]?.tMs ?? 1, 1);
        return (
          <View key={trace.eyeSide} style={styles.chart}>
            <Text style={styles.eye}>{trace.eyeSide}</Text>
            {points.map((point, index) => (
              <View
                key={`${trace.eyeSide}-${point.tMs}-${index}`}
                style={[
                  styles.dot,
                  {
                    backgroundColor: colors[eye] ?? colors[0],
                    left: `${(point.tMs / last) * 92}%`,
                    bottom: `${(((point.x as number) - min) / span) * 80 + 8}%`,
                  },
                ]}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

export function HoldSketch() {
  return (
    <View style={styles.sketch}>
      <View style={styles.phone} />
      <View style={styles.arrow} />
      <View style={styles.face}>
        <View style={styles.eyes}>
          <View style={styles.eyeDot} />
          <View style={styles.eyeDot} />
        </View>
      </View>
    </View>
  );
}

export function TargetSketch({ kind }: { kind: 'dot' | 'jump' | 'stripes' | 'near' }) {
  return (
    <View style={styles.sketch}>
      {kind === 'stripes' ? (
        <View style={styles.stripeRow}>
          <View style={styles.stripe} />
          <View style={[styles.stripe, styles.stripeGap]} />
          <View style={styles.stripe} />
        </View>
      ) : (
        <View style={[styles.target, kind === 'near' && styles.targetNear]} />
      )}
      {kind === 'jump' && <Text style={styles.jump}>↑ ↓</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: cameraColors.ink, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: cameraColors.ink,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chip: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFF',
  },
  chipOn: { backgroundColor: cameraColors.primary, borderColor: cameraColors.primary },
  chipText: { color: cameraColors.ink, fontWeight: '700' },
  chipTextOn: { color: '#FFF' },
  chart: {
    height: 120,
    marginTop: 8,
    backgroundColor: cameraColors.soft,
    borderRadius: 12,
    overflow: 'hidden',
  },
  eye: { position: 'absolute', left: 8, top: 6, color: cameraColors.muted, fontSize: 11 },
  dot: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },
  sketch: {
    height: 96,
    marginVertical: 8,
    borderRadius: 16,
    backgroundColor: cameraColors.soft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  phone: {
    width: 36,
    height: 64,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: cameraColors.primary,
  },
  arrow: { width: 36, height: 2, backgroundColor: cameraColors.primary },
  face: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyes: { flexDirection: 'row', gap: 10 },
  eyeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: cameraColors.ink },
  target: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#F2C14E' },
  targetNear: { width: 42, height: 42, borderRadius: 21 },
  stripeRow: { flexDirection: 'row', alignItems: 'center' },
  stripe: { width: 10, height: 64, backgroundColor: cameraColors.ink },
  stripeGap: { marginHorizontal: 14, backgroundColor: '#FFF' },
  jump: { color: cameraColors.primary, fontSize: 22, fontWeight: '800' },
});
