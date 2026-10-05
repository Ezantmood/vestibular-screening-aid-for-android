import { useEffect, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraButton, cameraColors } from '../components/CameraUI';
import Camera2ProbeScreen from './Camera2ProbeScreen';
import FramePipelineScreen from './FramePipelineScreen';
import HighSpeedTestScreen from './HighSpeedTestScreen';
import LivePreviewValidationScreen from './LivePreviewValidationScreen';
import PupilValidationScreen from './PupilValidationScreen';
import StimulusScreen from './StimulusScreen';
import TrackingValidationScreen from './TrackingValidationScreen';
import CalibrationScreen from './CalibrationScreen';
import SignalProcessingScreen from './SignalProcessingScreen';

const tools = [
  {
    id: 'calibration',
    code: '07',
    title: 'Hiệu chỉnh mắt',
    description: 'Hiệu chỉnh với target và kiểm tra chất lượng trước bài mắt.',
    component: CalibrationScreen,
  },
  {
    id: 'signals',
    code: '08',
    title: 'Xử lý tín hiệu đồng tử',
    description: 'Giữ raw, lọc nhiễu và kiểm tra đoạn tracking tin cậy.',
    component: SignalProcessingScreen,
  },
  {
    id: 'stimulus',
    code: '06',
    title: 'Mục tiêu Pursuit & Saccade',
    description: 'Nhìn theo mục tiêu và ghi timeline cùng video.',
    component: StimulusScreen,
  },
  {
    id: 'capture',
    code: '01',
    title: 'Kiểm tra ghi hình',
    description: 'Quay có preview và kiểm tra tốc độ video.',
    component: HighSpeedTestScreen,
  },
  {
    id: 'pipeline',
    code: '02',
    title: 'Phân tích video & vùng mắt',
    description: 'Kiểm tra khung hình và vị trí hai mắt.',
    component: FramePipelineScreen,
  },
  {
    id: 'pupil',
    code: '03',
    title: 'Kiểm tra đồng tử',
    description: 'Quay theo hướng nhìn và xem ảnh kiểm tra.',
    component: PupilValidationScreen,
  },
  {
    id: 'tracking',
    code: '04',
    title: 'Theo dõi chuyển động mắt',
    description: 'Ghi từng bài chuyển động, chớp mắt và căn lại mặt.',
    component: TrackingValidationScreen,
  },
  {
    id: 'probe',
    code: '05',
    title: 'Thông tin camera',
    description: 'Xem khả năng camera mà thiết bị hỗ trợ.',
    component: Camera2ProbeScreen,
  },
] as const;
type ToolId = (typeof tools)[number]['id'] | 'preview';

export default function HomeScreen() {
  const [active, setActive] = useState<ToolId | null>(null);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (active === null) return false;
      setActive(null);
      return true;
    });
    return () => subscription.remove();
  }, [active]);
  const selected = tools.find((tool) => tool.id === active);
  if (active !== null) {
    const Screen = active === 'preview' ? LivePreviewValidationScreen : selected?.component;
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setActive(null)}
            accessibilityRole="button"
            accessibilityLabel="Quay lại trang chính"
            style={styles.back}
            testID="camera-back"
          >
            <Text style={styles.backText}>‹ Quay lại</Text>
          </Pressable>
          <Text style={styles.headerLabel}>CAMERA & PHÂN TÍCH MẮT</Text>
        </View>
        {Screen && <Screen />}
      </View>
    );
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="home-screen">
      <Text style={styles.eyebrow}>VESTIBULAR SCREENING AID</Text>
      <Text style={styles.title}>Camera & chuyển động mắt</Text>
      <Text style={styles.subtitle}>
        Căn khuôn mặt trước, chọn bài kiểm tra rồi ghi hình với hướng dẫn trên màn hình.
      </Text>
      <View style={styles.featured}>
        <Text style={styles.featuredTag}>BẮT ĐẦU TẠI ĐÂY</Text>
        <Text style={styles.featuredTitle}>Xem camera và căn mặt</Text>
        <Text style={styles.featuredCopy}>
          Preview trực tiếp, khung căn giữa và phản hồi khi hai mắt đã sẵn sàng.
        </Text>
        <CameraButton
          title="Mở live preview & căn mặt"
          onPress={() => setActive('preview')}
          testID="home-preview"
        />
      </View>
      <Text style={styles.section}>Ghi hình & kiểm tra</Text>
      {tools.map((tool) => (
        <Pressable
          key={tool.id}
          onPress={() => setActive(tool.id)}
          accessibilityRole="button"
          accessibilityLabel={tool.title}
          testID={'home-' + tool.id}
          style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
        >
          <View style={styles.code}>
            <Text style={styles.codeText}>{tool.code}</Text>
          </View>
          <View style={styles.toolCopy}>
            <Text style={styles.toolTitle}>{tool.title}</Text>
            <Text style={styles.toolDescription}>{tool.description}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
      <Text style={styles.footnote}>Bản kiểm tra kỹ thuật. Kết quả chưa dùng để chẩn đoán.</Text>
    </ScrollView>
  );
}

const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 28) : 48;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cameraColors.background },
  content: { padding: 22, paddingTop: topInset + 20, paddingBottom: 100 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: cameraColors.primary,
    marginBottom: 14,
  },
  title: { fontSize: 34, fontWeight: '800', color: cameraColors.ink, lineHeight: 42 },
  subtitle: {
    fontSize: 15,
    lineHeight: 24,
    color: cameraColors.muted,
    marginTop: 14,
    marginBottom: 24,
  },
  featured: {
    backgroundColor: cameraColors.soft,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#CBEAE5',
  },
  featuredTag: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: cameraColors.primary,
    marginBottom: 12,
  },
  featuredTitle: { fontSize: 23, fontWeight: '700', color: cameraColors.ink },
  featuredCopy: { fontSize: 14, lineHeight: 22, color: cameraColors.muted, marginVertical: 12 },
  section: {
    color: cameraColors.ink,
    fontSize: 19,
    fontWeight: '700',
    marginTop: 28,
    marginBottom: 14,
  },
  tool: {
    backgroundColor: '#FFF',
    borderColor: cameraColors.border,
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    marginBottom: 10,
    minHeight: 96,
  },
  code: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: cameraColors.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeText: { color: cameraColors.primary, fontSize: 13, fontWeight: '800' },
  toolCopy: { flex: 1 },
  toolTitle: { color: cameraColors.ink, fontSize: 16, fontWeight: '700' },
  toolDescription: { color: cameraColors.muted, fontSize: 13, lineHeight: 20, marginTop: 5 },
  chevron: { fontSize: 25, color: cameraColors.primary },
  footnote: {
    color: cameraColors.muted,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 20,
    textAlign: 'center',
  },
  pressed: { opacity: 0.75 },
  header: {
    paddingTop: topInset + 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  back: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { color: cameraColors.primary, fontSize: 16, fontWeight: '700' },
  headerLabel: {
    flex: 1,
    textAlign: 'right',
    color: cameraColors.muted,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '700',
  },
});
