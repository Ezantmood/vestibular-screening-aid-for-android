import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraButton, cameraColors } from './CameraUI';

export default function CameraImageGallery({
  paths,
  title = 'Ảnh kiểm tra trên thiết bị',
}: {
  paths: string[];
  title?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const images = [...new Set(paths)].slice(0, 16);
  if (images.length === 0) return null;
  const uri = (path: string) => (path.startsWith('file://') ? path : 'file://' + path);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>Chạm ảnh để phóng to. Các ảnh chỉ được đọc từ bộ nhớ của app.</Text>
      <ScrollView
        horizontal
        contentContainerStyle={styles.row}
        showsHorizontalScrollIndicator={false}
      >
        {images.map((path, index) => (
          <Pressable
            key={path}
            onPress={() => {
              setFailed(false);
              setSelected(path);
            }}
            accessibilityRole="button"
            accessibilityLabel={'Phóng to ảnh kiểm tra ' + (index + 1)}
          >
            <Image source={{ uri: uri(path) }} style={styles.thumbnail} resizeMode="contain" />
            <Text style={styles.caption}>{'Ảnh ' + (index + 1)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Modal
        visible={selected !== null}
        onRequestClose={() => setSelected(null)}
        transparent
        animationType="fade"
      >
        <View style={styles.backdrop}>
          <Text style={styles.previewTitle}>Ảnh kiểm tra</Text>
          {selected && !failed && (
            <Image
              source={{ uri: uri(selected) }}
              style={styles.full}
              resizeMode="contain"
              onError={() => setFailed(true)}
            />
          )}
          {failed && (
            <Text style={styles.previewTitle}>
              Ảnh không còn trong bộ nhớ tạm. Hãy quay lại một video mới.
            </Text>
          )}
          <CameraButton title="Đóng ảnh" onPress={() => setSelected(null)} />
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: cameraColors.border,
    marginTop: 12,
  },
  title: { color: cameraColors.ink, fontSize: 16, fontWeight: '700' },
  note: { color: cameraColors.muted, fontSize: 13, lineHeight: 20, marginVertical: 8 },
  row: { gap: 12 },
  thumbnail: { width: 150, height: 120, borderRadius: 12, backgroundColor: '#132D3B' },
  caption: { color: cameraColors.muted, fontSize: 12, marginTop: 6 },
  backdrop: {
    flex: 1,
    backgroundColor: '#102B36F5',
    padding: 24,
    paddingTop: 64,
    paddingBottom: 64,
  },
  previewTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginBottom: 16 },
  full: { flex: 1, width: '100%', marginBottom: 16 },
});
