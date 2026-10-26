import type { RefObject } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

/** One native window for calibration and moving tests. The camera preview stays
 * mounted underneath; headers, banners and scroll offsets cannot cover targets. */
export default function TargetStage({
  visible,
  boardRef,
  boundsRef,
  target,
  size,
  message,
  onLayout,
  onCancel,
}: {
  visible: boolean;
  boardRef: RefObject<View | null>;
  boundsRef: RefObject<View | null>;
  target: { x: number; y: number } | null;
  size: { width: number; height: number };
  message: string;
  onLayout: (size: { width: number; height: number }) => void;
  onCancel: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
      supportedOrientations={['portrait']}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <View ref={boundsRef} collapsable={false} style={styles.stage} testID="target-stage">
            <View
              ref={boardRef}
              collapsable={false}
              style={styles.board}
              testID="target-board"
              onLayout={(event) => onLayout(event.nativeEvent.layout)}
            >
              {target ? (
                <View
                  testID="gaze-target"
                  style={[
                    styles.target,
                    { left: target.x * size.width - 10, top: target.y * size.height - 10 },
                  ]}
                />
              ) : (
                <Text style={styles.text}>Đang chuẩn bị vùng chấm…</Text>
              )}
            </View>
            <View style={styles.controls}>
              <Text
                style={[styles.text, { flex: 1, height: Math.max(48, 44 * fontScale) }]}
                numberOfLines={2}
                accessibilityLiveRegion="polite"
              >
                {message || 'Giữ đầu yên, chỉ nhìn theo chấm vàng.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hủy bài đo"
                onPress={onCancel}
                style={styles.cancel}
                testID="target-stage-cancel"
              >
                <Text style={styles.text}>Hủy</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#142D3D' },
  stage: { flex: 1, padding: 16, gap: 12, backgroundColor: '#142D3D' },
  board: { flex: 1, minHeight: 0, overflow: 'hidden', justifyContent: 'center' },
  target: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFE066',
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  text: { flexShrink: 1, color: '#FFF', fontSize: 16, lineHeight: 22 },
  cancel: { padding: 12, borderWidth: 1, borderColor: '#FFF', borderRadius: 8 },
});
