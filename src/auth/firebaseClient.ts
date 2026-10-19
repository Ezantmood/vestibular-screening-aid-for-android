import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type Persistence,
  type User,
} from 'firebase/auth';
import type { FirebasePublicConfig } from './policy';

export type ClinicianAccount = {
  uid: string;
  email: string;
  emailVerified: boolean;
};

export type FirebaseAuthClient = {
  watch: (listener: (account: ClinicianAccount | null) => void) => () => void;
  register: (
    email: string,
    password: string,
  ) => Promise<{ account: ClinicianAccount; verificationSent: boolean }>;
  login: (email: string, password: string) => Promise<ClinicianAccount>;
  logout: () => Promise<void>;
  sendVerification: () => Promise<void>;
  reloadAccount: () => Promise<ClinicianAccount | null>;
  sendPasswordReset: (email: string) => Promise<void>;
};

function accountFrom(user: User): ClinicianAccount {
  return {
    uid: user.uid,
    email: user.email ?? '',
    emailVerified: user.emailVerified,
  };
}

function reactNativePersistence(): Persistence {
  const authModule = FirebaseAuth as typeof FirebaseAuth & {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
  };
  if (!authModule.getReactNativePersistence) {
    throw new Error('Firebase Auth is missing React Native persistence.');
  }
  return authModule.getReactNativePersistence(AsyncStorage);
}

function isAlreadyInitialized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'auth/already-initialized'
  );
}

function openAuth(config: FirebasePublicConfig): Auth {
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  try {
    const auth = initializeAuth(app, { persistence: reactNativePersistence() });
    auth.languageCode = 'vi';
    return auth;
  } catch (error) {
    if (!isAlreadyInitialized(error)) throw error;
    const auth = getAuth(app);
    auth.languageCode = 'vi';
    return auth;
  }
}

export function authErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'auth/unknown';
}

export function createFirebaseAuthClient(config: FirebasePublicConfig): FirebaseAuthClient {
  const auth = openAuth(config);
  return {
    watch(listener) {
      return onAuthStateChanged(auth, (user) => listener(user ? accountFrom(user) : null));
    },
    async register(email, password) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      let verificationSent = true;
      try {
        await sendEmailVerification(credential.user);
      } catch {
        verificationSent = false;
      }
      return { account: accountFrom(credential.user), verificationSent };
    },
    async login(email, password) {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      return accountFrom(credential.user);
    },
    logout() {
      return signOut(auth);
    },
    async sendVerification() {
      if (!auth.currentUser)
        throw Object.assign(new Error('missing user'), { code: 'auth/unknown' });
      await sendEmailVerification(auth.currentUser);
    },
    async reloadAccount() {
      if (!auth.currentUser) return null;
      await reload(auth.currentUser);
      return accountFrom(auth.currentUser);
    },
    sendPasswordReset(email) {
      return sendPasswordResetEmail(auth, email);
    },
  };
}
