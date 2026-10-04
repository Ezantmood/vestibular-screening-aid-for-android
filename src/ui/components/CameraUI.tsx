import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';

export const cameraColors = {
  ink: '#142D3D',
  muted: '#526A78',
  primary: '#087E8B',
  soft: '#E8F5F4',
  border: '#D8E5E9',
  background: '#F4F8FA',
  danger: '#B42335',
};

const actionLabels: Record<string, string> = {
  'Request camera permission': 'Cho phép dùng camera',
  'Open Settings': 'Mở cài đặt',
  'Retry permission check': 'Kiểm tra lại quyền camera',
  'Probe cameras': 'Kiểm tra camera',
  'Probing…': 'Đang kiểm tra…',
  'Re-analyze last recording': 'Phân tích lại video vừa quay',
  'Close preview': 'Đóng camera',
  'Open live preview': 'Mở camera',
  'Stop recording': 'Dừng và lưu video',
  Back: '‹ Quay lại',
};

export function CameraButton({
  title,
  onPress,
  disabled = false,
  tone = 'primary',
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        tone === 'secondary' && styles.secondary,
        tone === 'danger' && styles.danger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, tone === 'secondary' && styles.secondaryText]}>
        {actionLabels[title] ?? title}
      </Text>
    </Pressable>
  );
}

export function CameraDetails({
  title = 'Chi tiết kỹ thuật',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.details}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={styles.detailHeader}
      >
        <Text style={styles.detailTitle}>{title}</Text>
        <Text style={styles.detailTitle}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      {expanded && <View style={styles.detailBody}>{children}</View>}
    </View>
  );
}

export function CameraProgress({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
      <ActivityIndicator color={cameraColors.primary} />
      <View style={styles.progressCopy}>
        <Text style={styles.detailTitle}>{title}</Text>
        {description && <Text style={styles.body}>{description}</Text>}
      </View>
    </View>
  );
}

export function CameraSummary({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.summary} accessibilityLiveRegion="polite">
      <Text style={styles.detailTitle}>{title}</Text>
      <Text style={styles.body}>{detail}</Text>
    </View>
  );
}

const conditionNames: Record<string, string> = {
  center: 'Nhìn giữa',
  left: 'Nhìn trái',
  right: 'Nhìn phải',
  up: 'Nhìn lên',
  down: 'Nhìn xuống',
  blink: 'Chớp mắt',
  'head-move': 'Di chuyển đầu',
  'lr-move': 'Mắt trái ↔ phải',
  'ud-move': 'Mắt lên ↕ xuống',
  'eyes-closed': 'Nhắm mắt',
  'loss-reacquire': 'Rời khung rồi trở lại',
};
export function cameraConditionName(condition: string): string {
  return conditionNames[condition] ?? condition;
}

export function CameraConditions<T extends string>({
  values,
  selected,
  onSelect,
  disabled,
}: {
  values: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={'Đổi bài thực hiện: ' + cameraConditionName(selected)}
        accessibilityState={{ expanded: expanded && !disabled, disabled }}
        style={[styles.conditionSelected, disabled && styles.disabled]}
        testID="camera-condition-picker"
      >
        <Text style={styles.detailTitle}>{cameraConditionName(selected)}</Text>
        <Text style={styles.conditionChange}>
          {disabled ? 'Đã khóa' : expanded ? 'Thu gọn −' : 'Đổi bài ›'}
        </Text>
      </Pressable>
      {expanded && !disabled && (
        <View style={styles.conditionWrap}>
          {values.map((value) => (
            <Pressable
              key={value}
              onPress={() => {
                onSelect(value);
                setExpanded(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === selected }}
              style={[styles.chip, value === selected && styles.chipActive]}
            >
              <Text style={[styles.chipText, value === selected && styles.chipTextActive]}>
                {cameraConditionName(value)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function cameraConditionHint(condition: string): string {
  const hints: Record<string, string> = {
    center: 'Giữ đầu yên, nhìn thẳng vào màn hình.',
    left: 'Giữ đầu yên, đưa mắt nhìn sang trái.',
    right: 'Giữ đầu yên, đưa mắt nhìn sang phải.',
    up: 'Giữ đầu yên, đưa mắt nhìn lên.',
    down: 'Giữ đầu yên, đưa mắt nhìn xuống.',
    blink: 'Nhìn thẳng và chớp mắt tự nhiên.',
    'head-move': 'Di chuyển đầu nhẹ nhàng; giữ khuôn mặt trong khung.',
    'lr-move': 'Giữ đầu yên, đưa mắt qua lại trái và phải.',
    'ud-move': 'Giữ đầu yên, đưa mắt lên và xuống.',
    'eyes-closed': 'Căn mặt trước, rồi nhắm mắt trong lúc quay.',
    'loss-reacquire': 'Căn mặt trước, rời khung một lúc rồi trở lại trong lúc quay.',
  };
  return hints[condition] ?? 'Căn khuôn mặt vào giữa khung trước khi quay.';
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: cameraColors.primary,
    borderRadius: 14,
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondary: { backgroundColor: '#FFF', borderWidth: 1, borderColor: cameraColors.border },
  secondaryText: { color: cameraColors.ink },
  danger: { backgroundColor: cameraColors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  details: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: cameraColors.border,
    marginTop: 12,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    minHeight: 52,
  },
  detailTitle: { color: cameraColors.ink, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  detailBody: { paddingHorizontal: 12, paddingBottom: 16 },
  body: { color: cameraColors.muted, fontSize: 14, lineHeight: 21, marginTop: 4 },
  progress: {
    backgroundColor: cameraColors.soft,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  progressCopy: { flex: 1 },
  summary: { backgroundColor: cameraColors.soft, borderRadius: 16, padding: 16, marginTop: 12 },
  conditionSelected: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: cameraColors.border,
    borderRadius: 14,
    padding: 16,
    minHeight: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  conditionChange: { color: cameraColors.primary, fontSize: 13, fontWeight: '700' },
  conditionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  chip: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFF',
    minHeight: 48,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: cameraColors.primary, borderColor: cameraColors.primary },
  chipText: { color: cameraColors.ink, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#FFF' },
});
