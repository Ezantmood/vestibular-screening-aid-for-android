import { gcm } from '@noble/ciphers/aes.js';
import {
  bytesToHex,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
  bytesToUtf8,
} from '@noble/ciphers/utils.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encode(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const left = bytes.length - index;
    const a = bytes[index] ?? 0;
    const b = left > 1 ? (bytes[index + 1] ?? 0) : 0;
    const c = left > 2 ? (bytes[index + 2] ?? 0) : 0;
    const chunk = (a << 16) | (b << 8) | c;
    out += ALPHABET[(chunk >> 18) & 63];
    out += ALPHABET[(chunk >> 12) & 63];
    out += left > 1 ? ALPHABET[(chunk >> 6) & 63] : '=';
    out += left > 2 ? ALPHABET[chunk & 63] : '=';
  }
  return out;
}

function decode(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0) throw new Error('Bad vault payload.');
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const quad = value.slice(index, index + 4);
    const pads = quad.endsWith('==') ? 2 : quad.endsWith('=') ? 1 : 0;
    const chars = [0, 1, 2, 3].map((offset) => {
      const char = quad[offset] ?? '';
      if (char === '=') return 0;
      const found = ALPHABET.indexOf(char);
      if (found < 0) throw new Error('Bad vault payload.');
      return found;
    });
    const chunk = (chars[0] << 18) | (chars[1] << 12) | (chars[2] << 6) | chars[3];
    out.push((chunk >> 16) & 255);
    if (pads < 2) out.push((chunk >> 8) & 255);
    if (pads < 1) out.push(chunk & 255);
  }
  return Uint8Array.from(out);
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
