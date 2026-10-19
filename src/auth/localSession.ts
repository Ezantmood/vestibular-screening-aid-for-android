import * as SecureStore from 'expo-secure-store';

const KEY = 'clinician-session-v1';

export type LocalSession = {
  uid: string;
  lastActivityMs: number;
  biometricEnabled: boolean;
  biometricPromptDismissed: boolean;
};

function parseSession(raw: string): LocalSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LocalSession>;
    const lastActivityMs = parsed.lastActivityMs;
    if (typeof parsed.uid !== 'string' || typeof lastActivityMs !== 'number') return null;
    return {
      uid: parsed.uid,
      lastActivityMs,
      biometricEnabled: parsed.biometricEnabled === true,
      biometricPromptDismissed: parsed.biometricPromptDismissed === true,
    };
  } catch {
    return null;
  }
}

export async function loadLocalSession(): Promise<LocalSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? parseSession(raw) : null;
}

export async function saveLocalSession(session: LocalSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearLocalSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
