import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FixedMode } from '../../camera/fixedModes';
import { CameraButton, cameraColors } from './CameraUI';

export function modeName(mode: FixedMode): string {
  return (
    (mode.lensFacing === 'FRONT'
      ? 'Camera trước'
      : mode.lensFacing === 'BACK'
        ? 'Camera sau'
        : 'Camera ' + mode.cameraId) +
    ' · ' +
    (mode.height === 1080
      ? '1080p'
      : mode.height === 720
        ? '720p'
        : mode.width + '×' + mode.height) +
    ' · ' +
    mode.fpsMax +
    ' fps'
  );
}

export default function CameraModePicker({
  modes,
  selectedIndex,
  onSelect,
  disabled = false,
}: {
  modes: FixedMode[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const mode = modes[selectedIndex];
  return (
    <View>
      <Pressable
        style={styles.selected}
        disabled={disabled}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Đổi chế độ camera"
        accessibilityState={{ disabled }}
        testID="camera-mode-picker"
      >
        <View style={styles.copy}>
          <Text style={styles.label}>CHẾ ĐỘ CAMERA</Text>
          <Text style={styles.title}>{mode ? modeName(mode) : 'Chưa có chế độ khả dụng'}</Text>
        </View>
        <Text style={styles.change}>{disabled ? 'Đã khóa' : 'Đổi ›'}</Text>
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.heading}>Chọn chế độ camera</Text>
            <Text style={styles.note}>Camera trước 1080p · 120 fps được ưu tiên để quay mắt.</Text>
            <ScrollView contentContainerStyle={styles.options}>
              {modes.map((entry, index) => (
                <Pressable
                  key={entry.label}
                  onPress={() => {
                    onSelect(index);
                    setVisible(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedIndex === index }}
                  style={[styles.option, selectedIndex === index && styles.active]}
                >
                  <Text style={styles.title}>{modeName(entry)}</Text>
                  <Text style={styles.note}>
                    {selectedIndex === index ? '✓ Đang chọn · ' : ''}
                    {entry.width}×{entry.height} · Camera {entry.cameraId}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <CameraButton
              title="Đóng danh sách"
              tone="secondary"
              onPress={() => setVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  selected: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: cameraColors.border,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginVertical: 8,
    minHeight: 72,
  },
  copy: { flex: 1 },
  label: {
    color: cameraColors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  title: { color: cameraColors.ink, fontSize: 15, fontWeight: '700' },
  change: { color: cameraColors.primary, fontSize: 13, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#142D3D88', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: cameraColors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 56,
  },
  heading: { color: cameraColors.ink, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  note: { color: cameraColors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  options: { paddingVertical: 12, gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    minHeight: 64,
  },
  active: { backgroundColor: cameraColors.soft, borderColor: cameraColors.primary },
});
