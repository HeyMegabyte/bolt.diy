/**
 * @module vault_client
 * @description Pure AES-256-GCM encryption for secrets at rest. Key is provided
 *   as a parameter (not read from env), making every exported function testable
 *   without mocking. Pair with {@link ai_crypto} when the key lives in worker
 *   environment variables.
 *
 * ## Key format
 *
 * `generateKey()` returns a base64-encoded 32-byte key suitable for AES-256-GCM.
 * The same base64 string is passed into `encryptSecret` and `decryptSecret`.
 *
 * ## Encrypted format
 *
 * `encryptSecret` returns `{ ciphertext, iv }` where both fields are hex-encoded.
 * This is intentionally NOT the combined `base64(iv + ciphertext)` blob used by
 * {@link ai_crypto} — the separated form is easier to store in structured columns
 * and inspect during debugging.
 *
 * @example
 * ```ts
 * const key = generateKey();
 * const enc = await encryptSecret('my secret value', key);
 * // → { ciphertext: 'a1b2...', iv: '01ef...' }
 * const pt = await decryptSecret(enc, key);
 * // → 'my secret value'
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the provided key does not decode to exactly 32 bytes (AES-256).
 */
export class VaultKeyLengthError extends Error {
  constructor(actual: number) {
    super(`Vault key must decode to 32 bytes, got ${actual}`);
    this.name = 'VaultKeyLengthError';
  }
}

/**
 * Thrown when decryption fails (wrong key, corrupted ciphertext, or tampered IV).
 */
export class VaultDecryptError extends Error {
  constructor(cause?: unknown) {
    const msg = cause instanceof Error ? cause.message : 'Decryption failed';
    super(msg);
    this.name = 'VaultDecryptError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string into a {@link CryptoKey} for AES-256-GCM.
 *
 * @remarks Pure — uses Web Crypto API (`crypto.subtle.importKey`).
 * @param raw - Base64-encoded 32-byte key material.
 * @returns The imported CryptoKey.
 * @throws {@link VaultKeyLengthError} when the decoded key is not 32 bytes.
 */
async function importVaultKey(raw: string): Promise<CryptoKey> {
  const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (buf.length !== 32) throw new VaultKeyLengthError(buf.length);
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a new base64-encoded AES-256 key.
 *
 * @remarks
 * Uses `crypto.getRandomValues` (30 bytes → base64 ≈ 40 chars, cropped to
 * 32-byte key material). Pure — no I/O.
 *
 * @example
 * ```ts
 * const key = generateKey();
 * // → 'xK0...3Zw=='  (44-char base64 string, decodes to 32 bytes)
 * ```
 *
 * @returns A base64-encoded 32-byte key suitable for AES-256-GCM.
 */
export function generateKey(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw));
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @remarks
 * Generates a fresh 12-byte IV per call. Returns the ciphertext and IV as
 * hex strings. Pair with {@link decryptSecret} for round-trip.
 *
 * Every call produces a different ciphertext because GCM uses a random IV
 * — key rotation detection relies on re-encryption, not ciphertext comparison.
 *
 * @param plaintext - The UTF-8 string to encrypt.
 * @param base64Key - A base64-encoded 32-byte AES-256 key, typically from
 *   {@link generateKey}.
 * @returns An object with `ciphertext` and `iv` as hex-encoded strings.
 * @throws {@link VaultKeyLengthError} when the key does not decode to 32 bytes.
 *
 * @example
 * ```ts
 * const key = generateKey();
 * const { ciphertext, iv } = await encryptSecret('hello', key);
 * // ciphertext and iv are hex strings
 * ```
 */
export async function encryptSecret(
  plaintext: string,
  base64Key: string,
): Promise<{ ciphertext: string; iv: string }> {
  const aesKey = await importVaultKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encoded = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, aesKey, encoded));

  return {
    ciphertext: Buffer.from(ct).toString('hex'),
    iv: Buffer.from(iv).toString('hex'),
  };
}

/**
 * Decrypt a ciphertext that was encrypted with {@link encryptSecret}.
 *
 * @remarks
 * Symmetric counterpart of {@link encryptSecret}. Expects `iv` and `ciphertext`
 * as hex strings exactly as returned by the encryption function. Using a wrong
 * key or corrupted ciphertext will throw {@link VaultDecryptError}.
 *
 * @param encrypted - An object with `ciphertext` and `iv` hex strings.
 * @param base64Key - The same base64-encoded 32-byte AES-256 key used during
 *   encryption.
 * @returns The decrypted UTF-8 plaintext string.
 * @throws {@link VaultKeyLengthError} when the key does not decode to 32 bytes.
 * @throws {@link VaultDecryptError} when the GCM auth tag verification fails
 *   (wrong key or corrupted data).
 *
 * @example
 * ```ts
 * const key = generateKey();
 * const enc = await encryptSecret('hello', key);
 * const pt = await decryptSecret(enc, key);
 * // pt === 'hello'
 * ```
 */
export async function decryptSecret(
  encrypted: { ciphertext: string; iv: string },
  base64Key: string,
): Promise<string> {
  const aesKey = await importVaultKey(base64Key);

  const ct = new Uint8Array(
    encrypted.ciphertext.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [],
  );
  const iv = new Uint8Array(encrypted.iv.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);

  try {
    const pt = await crypto.subtle.decrypt({ iv, name: 'AES-GCM' }, aesKey, ct);
    return new TextDecoder().decode(pt);
  } catch (err) {
    throw new VaultDecryptError(err);
  }
}
