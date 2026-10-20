import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { decryptJson, encryptJson, newVaultKey } from './crypto';
import { emptyVault, type AuditEvent, type VaultData } from './types';
import { purgePatients } from './rules';

const KEY = 'clinic-vault-key-v1';
let chain: Promise<unknown> = Promise.resolve();
let keyTask: Promise<string> | null = null;

function keyHex(): Promise<string> {
  if (!keyTask) {
    keyTask = SecureStore.getItemAsync(KEY)
      .then(async (existing) => {
        if (existing) return existing;
        const created = newVaultKey();
        await SecureStore.setItemAsync(KEY, created);
        return created;
      })
      .catch((error: unknown) => {
        keyTask = null;
        throw error;
      });
  }
  return keyTask;
}

function vaultFile(): File {
  return new File(Paths.document, 'clinic-vault-v1.bin');
}

async function loadVault(): Promise<{ data: VaultData; writable: boolean }> {
  const file = vaultFile();
  if (!file.exists) return { data: emptyVault(), writable: true };
  try {
    const stored = await file.bytes();
    if (stored.byteLength === 0) {
      file.delete();
      return { data: emptyVault(), writable: true };
    }
    const json = decryptJson(await keyHex(), bytesToUtf8(stored).trim());
    const parsed = JSON.parse(json) as VaultData;
    if (parsed.version !== 1 || !parsed || typeof parsed !== 'object') {
      return { data: emptyVault(), writable: false };
    }
    const data: VaultData = {
      version: 1,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      patients: Array.isArray(parsed.patients) ? parsed.patients : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      settingsByUid:
        parsed.settingsByUid && typeof parsed.settingsByUid === 'object'
          ? parsed.settingsByUid
          : {},
    };
    data.patients = purgePatients(data.patients, Date.now());
    return { data, writable: true };
  } catch {
    return { data: emptyVault(), writable: false };
  }
}

export async function readVault(): Promise<VaultData> {
  return (await loadVault()).data;
}

async function writeVault(data: VaultData): Promise<void> {
  const payload = utf8ToBytes(encryptJson(await keyHex(), JSON.stringify(data)));
  vaultFile().write(payload);
}

export async function discardUnreadableVault(): Promise<void> {
  keyTask = null;
  const file = vaultFile();
  if (file.exists) file.delete();
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

export function updateVault(change: (data: VaultData) => void): Promise<VaultData> {
  const run = chain.then(async () => {
    const loaded = await loadVault();
    if (!loaded.writable) throw new Error('Vault cannot be opened.');
    const data = loaded.data;
    change(data);
    data.patients = purgePatients(data.patients, Date.now());
    await writeVault(data);
    return data;
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function audit(data: VaultData, event: AuditEvent): void {
  data.audit.push(event);
  if (data.audit.length > 400) data.audit.splice(0, data.audit.length - 400);
}

export async function wipeClinicalData(uid: string): Promise<void> {
  await updateVault((data) => {
    data.patients = [];
    data.sessions = [];
    audit(data, { at: new Date().toISOString(), uid, action: 'wipe', detail: 'local' });
    data.audit = data.audit.slice(-1);
  });
}

export async function deleteRecordingFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    const file = new File(path);
    if (file.exists) file.delete();
  } catch {
    // The processed trace is already kept. A missing raw file still meets FR-36.
  }
}
