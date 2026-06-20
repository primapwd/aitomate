/**
 * Pure WebCrypto helpers for the secrets vault (spec NFR Security, FR-9).
 * No extension APIs here — keep this layer testable and reusable for the
 * M2 config export bundle, which shares the same PBKDF2 + AES-GCM scheme.
 */

export interface CryptoPayload {
  /** Base64-encoded 12-byte AES-GCM IV. */
  iv: string;
  /** Base64-encoded ciphertext (includes GCM auth tag). */
  data: string;
}

/** OWASP-recommended baseline for PBKDF2-HMAC-SHA256. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
): Promise<CryptoPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) };
}

/** Throws (DOMException OperationError) on wrong key or tampered ciphertext. */
export async function decryptJson<T = unknown>(
  key: CryptoKey,
  payload: CryptoPayload,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) as BufferSource },
    key,
    fromBase64(payload.data) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
