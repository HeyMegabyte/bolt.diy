import {
  generateKey,
  encryptSecret,
  decryptSecret,
  VaultKeyLengthError,
  VaultDecryptError,
} from '../vault_client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A deterministic 32-byte base64 key for reproducible tests.
 * Decodes to 32 zero-bytes — not secure but deterministic for testing.
 */
const FIXED_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));

/**
 * A key that decodes to only 16 bytes — too short for AES-256.
 */
const SHORT_KEY_BASE64 = btoa(String.fromCharCode(...new Uint8Array(16)));

// ---------------------------------------------------------------------------
// generateKey
// ---------------------------------------------------------------------------

describe('generateKey', () => {
  it('returns a base64 string', () => {
    const key = generateKey();
    expect(typeof key).toBe('string');
    // Base64 is always valid
    expect(() => atob(key)).not.toThrow();
  });

  it('decodes to exactly 32 bytes', () => {
    const key = generateKey();
    const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    expect(raw.length).toBe(32);
  });

  it('produces different keys on each call', () => {
    const a = generateKey();
    const b = generateKey();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// encryptSecret
// ---------------------------------------------------------------------------

describe('encryptSecret', () => {
  it('produces a ciphertext and iv as hex strings', async () => {
    const { ciphertext, iv } = await encryptSecret('hello', FIXED_KEY);
    expect(typeof ciphertext).toBe('string');
    expect(typeof iv).toBe('string');
    // Hex strings have even length and are composed of 0-9a-f
    expect(ciphertext).toMatch(/^[0-9a-f]+$/i);
    expect(iv).toMatch(/^[0-9a-f]+$/i);
  });

  it('generates a 12-byte IV (24 hex chars)', async () => {
    const { iv } = await encryptSecret('hello', FIXED_KEY);
    expect(iv.length).toBe(24); // 12 bytes = 24 hex characters
  });

  it('produces unique ciphertexts across calls (random IV)', async () => {
    const a = await encryptSecret('same text', FIXED_KEY);
    const b = await encryptSecret('same text', FIXED_KEY);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('throws VaultKeyLengthError for a 16-byte key', async () => {
    await expect(encryptSecret('test', SHORT_KEY_BASE64)).rejects.toThrow(VaultKeyLengthError);
  });

  it('accepts an empty string', async () => {
    const { ciphertext, iv } = await encryptSecret('', FIXED_KEY);
    expect(ciphertext).toBeTruthy();
    expect(iv.length).toBe(24);
  });

  it('handles longer plaintext (500 chars)', async () => {
    const long = 'a'.repeat(500);
    const enc = await encryptSecret(long, FIXED_KEY);
    // Ciphertext will be longer than plaintext due to GCM tag (16 bytes)
    // plaintext 500 bytes → ciphertext ~516 bytes = ~1032 hex chars
    expect(enc.ciphertext.length).toBeGreaterThan(1000);
    expect(enc.ciphertext.length).toBeLessThan(1100);
  });
});

// ---------------------------------------------------------------------------
// decryptSecret
// ---------------------------------------------------------------------------

describe('decryptSecret', () => {
  it('round-trips a simple string', async () => {
    const key = generateKey();
    const pt = 'my secret value';
    const enc = await encryptSecret(pt, key);
    const dec = await decryptSecret(enc, key);
    expect(dec).toBe(pt);
  });

  it('round-trips an empty string', async () => {
    const key = generateKey();
    const enc = await encryptSecret('', key);
    const dec = await decryptSecret(enc, key);
    expect(dec).toBe('');
  });

  it('round-trips special characters', async () => {
    const key = generateKey();
    const pt = 'héllo 🔐 world <>&"\'';
    const enc = await encryptSecret(pt, key);
    const dec = await decryptSecret(enc, key);
    expect(dec).toBe(pt);
  });

  it('round-trips long content (5 KB)', async () => {
    const key = generateKey();
    const pt = 'x'.repeat(5_000);
    const enc = await encryptSecret(pt, key);
    const dec = await decryptSecret(enc, key);
    expect(dec).toBe(pt);
  });

  it('throws VaultKeyLengthError for a short key', async () => {
    const enc = await encryptSecret('hello', FIXED_KEY);
    await expect(decryptSecret(enc, SHORT_KEY_BASE64)).rejects.toThrow(VaultKeyLengthError);
  });

  it('throws VaultDecryptError when decrypting with a wrong key', async () => {
    const keyA = generateKey();
    const keyB = generateKey();
    const enc = await encryptSecret('hello', keyA);
    await expect(decryptSecret(enc, keyB)).rejects.toThrow(VaultDecryptError);
  });

  it('throws VaultDecryptError on corrupted ciphertext', async () => {
    const key = generateKey();
    const enc = await encryptSecret('hello', key);
    const corrupted = { ...enc, ciphertext: '0000' + enc.ciphertext.slice(4) };
    await expect(decryptSecret(corrupted, key)).rejects.toThrow(VaultDecryptError);
  });

  it('throws VaultDecryptError on wrong IV length', async () => {
    const key = generateKey();
    const enc = await encryptSecret('hello', key);
    const badIv = { ...enc, iv: enc.iv + '00' };
    await expect(decryptSecret(badIv, key)).rejects.toThrow(VaultDecryptError);
  });

  it('round-trips with a fixed key and multiple values', async () => {
    const key = generateKey();
    const values = ['alpha', 'beta', 'gamma'];
    const encrypted = await Promise.all(values.map((v) => encryptSecret(v, key)));
    const decrypted = await Promise.all(encrypted.map((e) => decryptSecret(e, key)));
    expect(decrypted).toEqual(values);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: generateKey → encryptSecret → decryptSecret
// ---------------------------------------------------------------------------

describe('end-to-end', () => {
  it('generateKey + encryptSecret + decryptSecret = identity', async () => {
    const key = generateKey();
    const original = 'e2e test value';
    const enc = await encryptSecret(original, key);
    const dec = await decryptSecret(enc, key);
    expect(dec).toBe(original);
  });

  it('round-trip is idempotent across instances', async () => {
    const key = generateKey();
    const enc = await encryptSecret('hello', key);
    const dec1 = await decryptSecret(enc, key);
    const dec2 = await decryptSecret(enc, key);
    expect(dec1).toBe(dec2);
  });
});
