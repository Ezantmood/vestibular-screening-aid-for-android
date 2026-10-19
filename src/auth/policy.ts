/** Clinician account rules from FR-01, FR-02, FR-03 and FR-06. No network here. */

export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthAction = 'register' | 'login' | 'reset' | 'verify';

export type AccountSnapshot = {
  emailVerified: boolean;
} | null;

export type BiometricDecision = 'unavailable' | 'disabled' | 'locked' | 'unlocked';

export type AuthGate =
  | { status: 'unconfigured' }
  | { status: 'signed-out'; notice: string | null }
  | { status: 'verify-email' }
  | { status: 'biometric-lock' }
  | { status: 'ready' };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailError(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return 'Hãy nhập email.';
  if (!EMAIL_PATTERN.test(email)) return 'Email chưa đúng định dạng.';
  return null;
}

/** Teacher left password strength unspecified. Eight characters, one letter, one digit. */
export function passwordError(value: string): string | null {
  if (!value) return 'Hãy nhập mật khẩu.';
  if (value.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Mật khẩu cần có chữ và chữ số.';
  return null;
}

export function registerInputError(
  email: string,
  password: string,
  confirm: string,
): string | null {
  return (
    emailError(email) ??
    passwordError(password) ??
    (password !== confirm ? 'Mật khẩu nhập lại chưa khớp.' : null)
  );
}

export function sessionExpired(lastActivityMs: number, nowMs: number): boolean {
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - lastActivityMs >= SESSION_TIMEOUT_MS;
}

export function canOfferBiometric(hardware: boolean, enrolled: boolean): boolean {
  return hardware && enrolled;
}

/**
 * Email must be confirmed before the app opens. Logout and a 15-minute idle
 * timeout both land on signed-out. Biometrics reopen a still-valid session only.
 */
export function decideAuthGate(input: {
  configured: boolean;
  account: AccountSnapshot;
  idleExpired: boolean;
  biometric: BiometricDecision;
  notice?: string | null;
}): AuthGate {
  if (!input.configured) return { status: 'unconfigured' };
  if (!input.account || input.idleExpired) {
    return { status: 'signed-out', notice: input.notice ?? null };
  }
  if (!input.account.emailVerified) return { status: 'verify-email' };
  if (input.biometric === 'locked') return { status: 'biometric-lock' };
  return { status: 'ready' };
}

const ERROR_COPY: Record<string, string> = {
  'auth/email-already-in-use': 'Email này đã có tài khoản.',
  'auth/invalid-email': 'Email chưa đúng định dạng.',
  'auth/weak-password': 'Mật khẩu cần ít nhất 8 ký tự, có chữ và chữ số.',
  'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
  'auth/wrong-password': 'Email hoặc mật khẩu không đúng.',
  'auth/user-not-found': 'Email hoặc mật khẩu không đúng.',
  'auth/user-disabled': 'Tài khoản này đã bị khóa.',
  'auth/too-many-requests': 'Thử lại quá nhiều lần. Hãy đợi một lát.',
  'auth/network-request-failed': 'Không có mạng. Đăng ký, đăng nhập và đặt lại mật khẩu cần mạng.',
  'auth/operation-not-allowed': 'Đăng ký bằng email chưa được bật trên Firebase.',
  'auth/missing-password': 'Hãy nhập mật khẩu.',
};

export function mapAuthError(code: string): string {
  return ERROR_COPY[code] ?? 'Không thực hiện được. Hãy thử lại.';
}

export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
};

export function readFirebaseConfig(
  env: Record<string, string | undefined>,
): FirebasePublicConfig | null {
  const apiKey = env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  const messagingSenderId = env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const storageBucket = env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(messagingSenderId ? { messagingSenderId } : {}),
    ...(storageBucket ? { storageBucket } : {}),
  };
}

/** Offline Batch 3 measurement builds set this to "0". Every other build requires an account. */
export function authRequired(env: Record<string, string | undefined>): boolean {
  return env.EXPO_PUBLIC_AUTH_REQUIRED !== '0';
}
