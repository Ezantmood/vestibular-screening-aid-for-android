import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { cameraColors, CameraButton } from '../components/CameraUI';
import HomeScreen from '../screens/HomeScreen';

type Mode = 'login' | 'register' | 'reset';

export function AuthFlow() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  if (auth.booting) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={cameraColors.primary} />
      </View>
    );
  }

  if (auth.gate.status === 'ready') {
    return (
      <View
        style={styles.ready}
        onStartShouldSetResponder={() => {
          auth.markActivity();
          return false;
        }}
      >
        <View style={styles.accountBar}>
          <Text style={styles.accountEmail} numberOfLines={1}>
            {auth.email}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đăng xuất"
            onPress={() => void auth.logout()}
            style={styles.signOut}
          >
            <Text style={styles.signOutText}>Đăng xuất</Text>
          </Pressable>
        </View>
        {auth.biometricOfferVisible && (
          <View style={styles.offer}>
            <Text style={styles.offerTitle}>Bật đăng nhập nhanh bằng vân tay hoặc khuôn mặt?</Text>
            <CameraButton title="Bật đăng nhập nhanh" onPress={() => void auth.enableBiometric()} />
            <CameraButton
              title="Để sau"
              tone="secondary"
              onPress={() => void auth.dismissBiometricPrompt()}
            />
          </View>
        )}
        <HomeScreen embedded />
      </View>
    );
  }

  const notice = auth.gate.status === 'signed-out' ? auth.gate.notice : null;
  const title =
    auth.gate.status === 'unconfigured'
      ? 'Chưa gửi được email'
      : auth.gate.status === 'verify-email'
        ? 'Xác nhận email'
        : auth.gate.status === 'biometric-lock'
          ? 'Đăng nhập nhanh'
          : mode === 'register'
            ? 'Tạo tài khoản'
            : mode === 'reset'
              ? 'Đặt lại mật khẩu'
              : 'Đăng nhập';

  const submit = () => {
    if (mode === 'register') return auth.register(email, password, confirm);
    if (mode === 'reset') return auth.sendReset(email);
    return auth.login(email, password);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>VESTIBULAR SCREENING AID</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.lead}>
          Tài khoản clinician dùng email và mật khẩu. Dữ liệu bệnh nhân không đưa lên cloud.
        </Text>
        {notice && <Text style={styles.notice}>{notice}</Text>}
        {auth.error && <Text style={styles.error}>{auth.error}</Text>}
        {auth.info && <Text style={styles.notice}>{auth.info}</Text>}

        {auth.gate.status === 'unconfigured' && (
          <Text style={styles.body}>
            Máy này chưa có project Firebase, nên app chưa gửi được email xác nhận hoặc liên kết đặt
            lại mật khẩu. Thêm các biến EXPO_PUBLIC_FIREBASE_* vào file .env rồi mở lại app.
          </Text>
        )}

        {auth.gate.status === 'verify-email' && (
          <View style={styles.stack}>
            <Text style={styles.body}>
              Mở liên kết vừa gửi tới {auth.email}, rồi quay lại đây. App chỉ mở sau khi email đã
              được xác nhận.
            </Text>
            <CameraButton
              title={auth.busy ? 'Đang kiểm tra…' : 'Tôi đã xác nhận'}
              onPress={() => void auth.refreshVerification()}
              disabled={auth.busy}
            />
            <CameraButton
              title="Gửi lại email"
              tone="secondary"
              onPress={() => void auth.resendVerification()}
              disabled={auth.busy}
            />
            <CameraButton
              title="Đăng xuất"
              tone="secondary"
              onPress={() => void auth.logout()}
              disabled={auth.busy}
            />
          </View>
        )}

        {auth.gate.status === 'biometric-lock' && (
          <View style={styles.stack}>
            <Text style={styles.body}>
              Phiên trước vẫn còn. Dùng vân tay hoặc khuôn mặt của máy để vào, hoặc đăng nhập lại
              bằng mật khẩu.
            </Text>
            <CameraButton
              title={auth.busy ? 'Đang chờ…' : 'Dùng vân tay hoặc khuôn mặt'}
              onPress={() => void auth.unlockWithBiometric()}
              disabled={auth.busy}
            />
            <CameraButton
              title="Dùng mật khẩu"
              tone="secondary"
              onPress={() => void auth.logout()}
              disabled={auth.busy}
            />
          </View>
        )}

        {auth.gate.status === 'signed-out' && (
          <View style={styles.stack}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              testID="auth-email"
            />
            {mode !== 'reset' && (
              <Field
                label="Mật khẩu"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'register' ? 'new-password' : 'password'}
                testID="auth-password"
              />
            )}
            {mode === 'register' && (
              <Field
                label="Nhập lại mật khẩu"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                testID="auth-confirm"
              />
            )}
            <CameraButton
              title={
                auth.busy
                  ? 'Đang gửi…'
                  : mode === 'register'
                    ? 'Tạo tài khoản'
                    : mode === 'reset'
                      ? 'Gửi liên kết đặt lại'
                      : 'Đăng nhập'
              }
              onPress={() => void submit()}
              disabled={auth.busy}
              testID="auth-submit"
            />
            {mode === 'login' && (
              <TextLink
                label="Quên mật khẩu"
                onPress={() => {
                  auth.clearMessages();
                  setMode('reset');
                }}
              />
            )}
            <TextLink
              label={
                mode === 'register' ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'
              }
              onPress={() => {
                auth.clearMessages();
                setMode(mode === 'register' ? 'login' : 'register');
              }}
            />
            {mode === 'reset' && (
              <TextLink
                label="Quay lại đăng nhập"
                onPress={() => {
                  auth.clearMessages();
                  setMode('login');
                }}
              />
            )}
          </View>
        )}
        <Text style={styles.footnote}>Công cụ sàng lọc, không phải thiết bị chẩn đoán.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = 'default',
  autoComplete,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoComplete?: 'email' | 'password' | 'new-password';
  testID: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        accessibilityLabel={label}
        testID={testID}
        style={styles.input}
        placeholderTextColor={cameraColors.muted}
      />
    </View>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 28) : 48;

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cameraColors.background,
  },
  ready: { flex: 1, backgroundColor: cameraColors.background },
  accountBar: {
    paddingTop: topInset,
    paddingHorizontal: 22,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: cameraColors.background,
  },
  accountEmail: { flex: 1, color: cameraColors.muted, fontSize: 14 },
  signOut: { paddingVertical: 8, paddingHorizontal: 4 },
  signOutText: { color: cameraColors.primary, fontSize: 15, fontWeight: '700' },
  offer: {
    marginHorizontal: 22,
    marginBottom: 8,
    padding: 16,
    borderRadius: 18,
    backgroundColor: cameraColors.soft,
    gap: 10,
  },
  offerTitle: { color: cameraColors.ink, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  screen: { flex: 1, backgroundColor: cameraColors.background },
  content: { padding: 22, paddingTop: topInset + 12, paddingBottom: 48 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: cameraColors.primary,
    marginBottom: 14,
  },
  title: { fontSize: 34, fontWeight: '800', color: cameraColors.ink, lineHeight: 42 },
  lead: { marginTop: 12, color: cameraColors.muted, fontSize: 16, lineHeight: 24 },
  body: { color: cameraColors.ink, fontSize: 16, lineHeight: 24 },
  stack: { marginTop: 22, gap: 14 },
  label: { color: cameraColors.ink, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    color: cameraColors.ink,
  },
  link: { color: cameraColors.primary, fontSize: 16, fontWeight: '700' },
  error: { marginTop: 16, color: cameraColors.danger, fontSize: 15, lineHeight: 22 },
  notice: { marginTop: 16, color: cameraColors.ink, fontSize: 15, lineHeight: 22 },
  footnote: { marginTop: 28, color: cameraColors.muted, fontSize: 13, lineHeight: 20 },
});
