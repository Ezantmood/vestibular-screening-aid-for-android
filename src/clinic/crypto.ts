import { gcm } from '@noble/ciphers/aes.js';
import {
  bytesToHex,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
  bytesToUtf8,
} from '@noble/ciphers/utils.js';

function encode(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function decode(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

export function newVaultKey(): string {
  return bytesToHex(randomBytes(32));
}

/** AES-256-GCM. Output is nonce and ciphertext, both base64, separated by a dot. */
export function encryptJson(keyHex: string, json: string): string {
  const nonce = randomBytes(12);
  const sealed = gcm(hexToBytes(keyHex), nonce).encrypt(utf8ToBytes(json));
  return `${encode(nonce)}.${encode(sealed)}`;
}

export function decryptJson(keyHex: string, payload: string): string {
  const [nonce, sealed] = payload.split('.');
  if (!nonce || !sealed) throw new Error('Bad vault payload.');
  const opened = gcm(hexToBytes(keyHex), decode(nonce)).decrypt(decode(sealed));
  return bytesToUtf8(opened);
}
