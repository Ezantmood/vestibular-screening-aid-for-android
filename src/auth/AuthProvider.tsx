import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { ReactNode } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  decideAuthGate,
  mapAuthError,
  normalizeEmail,
  registerInputError,
  emailError,
  sessionExpired,
  type AuthGate,
} from './policy';
import {
  authErrorCode,
  createFirebaseAuthClient,
  type ClinicianAccount,
  type FirebaseAuthClient,
} from './firebaseClient';
import {
  clearLocalSession,
  loadLocalSession,
  saveLocalSession,
  type LocalSession,
} from './localSession';
import { firebaseConfigFromBundle } from './runtimeConfig';

const IDLE_CHECK_MS = 15_000;

type AuthContextValue = {
  gate: AuthGate;
  booting: boolean;
  email: string | null;
  uid: string | null;
  busy: boolean;
  error: string | null;
  info: string | null;
  biometricOfferVisible: boolean;
  clearMessages: () => void;
  register: (email: string, password: string, confirm: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: (notice?: string) => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshVerification: () => Promise<void>;
  unlockWithBiometric: () => Promise<void>;
  enableBiometric: () => Promise<void>;
  dismissBiometricPrompt: () => Promise<void>;
  markActivity: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function formError(message: string): Error {
  return Object.assign(new Error(message), { code: 'form' });
}

function freshSession(uid: string, previous: LocalSession | null): LocalSession {
  const sameUser = previous?.uid === uid;
  return {
    uid,
    lastActivityMs: Date.now(),
    biometricEnabled: sameUser ? previous.biometricEnabled : false,
    biometricPromptDismissed: sameUser ? previous.biometricPromptDismissed : false,
  };
}

function bootFirebase(): {
  client: FirebaseAuthClient | null;
  configured: boolean;
  bootError: string | null;
} {
  const config = firebaseConfigFromBundle();
  if (!config) return { client: null, configured: false, bootError: null };
  try {
    return { client: createFirebaseAuthClient(config), configured: true, bootError: null };
  } catch {
    return { client: null, configured: false, bootError: 'Không mở được Firebase Auth.' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(bootFirebase);
  const clientRef = useRef(boot.client);
  const signingOut = useRef(false);
  const lastSavedActivity = useRef(0);
  const [authReady, setAuthReady] = useState(!boot.configured);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricHardware, setBiometricHardware] = useState(false);
  const [account, setAccount] = useState<ClinicianAccount | null>(null);
  const [local, setLocal] = useState<LocalSession | null>(null);
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(boot.bootError);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const client = clientRef.current;
    if (!boot.configured || !client) return;
    return client.watch((next) => {
      setAccount(next);
      setAuthReady(true);
    });
  }, [boot.configured]);

  useEffect(() => {
    let cancelled = false;
    loadLocalSession()
      .then((stored) => {
        if (cancelled) return;
        setLocal(stored);
        setNowMs(Date.now());
      })
      .catch(() => {
        if (!cancelled) setLocal(null);
      })
      .finally(() => {
        if (!cancelled) setSessionLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
      .then(([hardware, enrolled]) => {
        if (!cancelled) setBiometricHardware(hardware && enrolled);
      })
      .catch(() => {
        if (!cancelled) setBiometricHardware(false);
      })
      .finally(() => {
        if (!cancelled) setBiometricReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (session: LocalSession) => {
    setLocal(session);
    await saveLocalSession(session);
  }, []);

  const logout = useCallback(async (nextNotice?: string) => {
    setNotice(nextNotice ?? null);
    setError(null);
    setInfo(null);
    setBiometricUnlocked(false);
    setAccount(null);
    setLocal(null);
    await clearLocalSession().catch(() => undefined);
    await clientRef.current?.logout().catch(() => undefined);
  }, []);

  const rememberLogin = useCallback(
    async (next: ClinicianAccount) => {
      const session = freshSession(next.uid, local);
      setBiometricUnlocked(true);
      setNotice(null);
      await persist(session);
    },
    [local, persist],
  );

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await work();
    } catch (caught) {
      if (authErrorCode(caught) === 'form' && caught instanceof Error) setError(caught.message);
      else setError(mapAuthError(authErrorCode(caught)));
    } finally {
      setBusy(false);
    }
  }, []);

  const register = useCallback(
    (email: string, password: string, confirm: string) =>
      run(async () => {
        const validation = registerInputError(email, password, confirm);
        if (validation) throw formError(validation);
        const client = clientRef.current;
        if (!client) throw formError('Chưa có cấu hình Firebase.');
        const next = await client.register(normalizeEmail(email), password);
        await rememberLogin(next.account);
        if (!next.verificationSent) {
          throw formError('Tài khoản đã tạo, nhưng email xác nhận chưa gửi được. Hãy bấm gửi lại.');
        }
      }),
    [rememberLogin, run],
  );

  const login = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const validation = emailError(email) ?? (password ? null : 'Hãy nhập mật khẩu.');
        if (validation) throw formError(validation);
        const client = clientRef.current;
        if (!client) throw formError('Chưa có cấu hình Firebase.');
        const next = await client.login(normalizeEmail(email), password);
        await rememberLogin(next);
      }),
    [rememberLogin, run],
  );

  const sendReset = useCallback(
    (email: string) =>
      run(async () => {
        const validation = emailError(email);
        if (validation) throw formError(validation);
        const client = clientRef.current;
        if (!client) throw formError('Chưa có cấu hình Firebase.');
        try {
          await client.sendPasswordReset(normalizeEmail(email));
        } catch (caught) {
          if (authErrorCode(caught) !== 'auth/user-not-found') throw caught;
        }
        setInfo('Nếu email đã đăng ký, hãy mở hộp thư để đặt lại mật khẩu.');
      }),
    [run],
  );

  const resendVerification = useCallback(
    () =>
      run(async () => {
        const client = clientRef.current;
        if (!client) return;
        await client.sendVerification();
        setInfo('Đã gửi lại email xác nhận.');
      }),
    [run],
  );

  const refreshVerification = useCallback(
    () =>
      run(async () => {
        const client = clientRef.current;
        if (!client) return;
        const next = await client.reloadAccount();
        if (!next?.emailVerified) {
          setError('Email chưa được xác nhận. Hãy mở liên kết trong hộp thư.');
          return;
        }
        setAccount(next);
        setInfo(null);
      }),
    [run],
  );

  const unlockWithBiometric = useCallback(
    () =>
      run(async () => {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Đăng nhập nhanh',
          cancelLabel: 'Dùng mật khẩu',
          disableDeviceFallback: true,
        });
        if (!result.success) {
          setError('Chưa mở khóa được bằng sinh trắc học.');
          return;
        }
        const at = Date.now();
        setBiometricUnlocked(true);
        setNowMs(at);
        if (account && local?.uid === account.uid) {
          await persist({ ...local, lastActivityMs: at });
        }
      }),
    [account, local, persist, run],
  );

  const enableBiometric = useCallback(
    () =>
      run(async () => {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Bật đăng nhập nhanh',
          cancelLabel: 'Huỷ',
          disableDeviceFallback: true,
        });
        if (!result.success || !account) return;
        const session = freshSession(account.uid, local);
        session.biometricEnabled = true;
        session.biometricPromptDismissed = true;
        session.lastActivityMs = Date.now();
        await persist(session);
      }),
    [account, local, persist, run],
  );

  const dismissBiometricPrompt = useCallback(async () => {
    if (!account) return;
    const session = freshSession(account.uid, local);
    session.biometricPromptDismissed = true;
    session.lastActivityMs =
      local?.uid === account.uid ? local.lastActivityMs : session.lastActivityMs;
    await persist(session);
  }, [account, local, persist]);

  const markActivity = useCallback(() => {
    if (!account) return;
    const at = Date.now();
    if (!local || local.uid !== account.uid || at - lastSavedActivity.current < 5_000) return;
    lastSavedActivity.current = at;
    const session = { ...local, lastActivityMs: at };
    setLocal(session);
    void saveLocalSession(session);
  }, [account, local]);

  useEffect(() => {
    if (!account) return;
    const timer = setInterval(() => setNowMs(Date.now()), IDLE_CHECK_MS);
    const kick = setTimeout(() => setNowMs(Date.now()), 0);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => {
      clearInterval(timer);
      clearTimeout(kick);
      subscription.remove();
    };
  }, [account]);

  const sameSession = account !== null && local?.uid === account.uid;
  const idleExpired =
    sameSession && local !== null && nowMs > 0 && sessionExpired(local.lastActivityMs, nowMs);

  useEffect(() => {
    if (!idleExpired || signingOut.current) return;
    signingOut.current = true;
    void logout('Phiên đã hết hạn sau 15 phút không sử dụng. Hãy đăng nhập lại.').finally(() => {
      signingOut.current = false;
    });
  }, [idleExpired, logout]);

  const biometric =
    !biometricHardware || !local?.biometricEnabled || local.uid !== account?.uid
      ? 'disabled'
      : biometricUnlocked
        ? 'unlocked'
        : 'locked';

  const gate = decideAuthGate({
    configured: boot.configured,
    account: account ? { emailVerified: account.emailVerified } : null,
    idleExpired,
    biometric,
    notice,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      gate,
      booting: !authReady || !sessionLoaded || !biometricReady,
      email: account?.email ?? null,
      uid: account?.uid ?? null,
      busy,
      error,
      info,
      biometricOfferVisible:
        gate.status === 'ready' &&
        biometricHardware &&
        local?.biometricEnabled !== true &&
        local?.biometricPromptDismissed !== true,
      clearMessages: () => {
        setError(null);
        setInfo(null);
      },
      register,
      login,
      logout,
      sendReset,
      resendVerification,
      refreshVerification,
      unlockWithBiometric,
      enableBiometric,
      dismissBiometricPrompt,
      markActivity,
    }),
    [
      account?.email,
      account?.uid,
      authReady,
      biometricHardware,
      biometricReady,
      busy,
      dismissBiometricPrompt,
      enableBiometric,
      error,
      gate,
      info,
      local?.biometricEnabled,
      local?.biometricPromptDismissed,
      login,
      logout,
      markActivity,
      refreshVerification,
      register,
      resendVerification,
      sendReset,
      sessionLoaded,
      unlockWithBiometric,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
