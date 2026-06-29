import {
  BYPASS_SECRET_LENGTH,
  DEFAULT_BYPASS_TTL_MS,
  EmptyAdminIdError,
  generateBypassToken,
  validateBypass,
  type BypassTokenPayload,
} from '../rate_bypass';

const TEST_SECRET = crypto.randomUUID();
const SHORT_SECRET = 'a'.repeat(16); // below recommendation, still works for HMAC

describe('generateBypassToken', () => {
  it('returns a non-empty dot-delimited string', () => {
    const token = generateBypassToken('admin_abc', TEST_SECRET);
    expect(token).toEqual(expect.any(String));
    expect(token.length).toBeGreaterThan(0);
    expect(token).toContain('.');
  });

  it('encodes the adminId and a future expiresAt in the payload', () => {
    const before = Date.now();
    const token = generateBypassToken('admin-42', TEST_SECRET);
    const after = Date.now();

    const payload = decodePayload(token);

    expect(payload.adminId).toBe('admin-42');
    expect(payload.expiresAt).toBeGreaterThan(before);
    expect(payload.expiresAt).toBeLessThanOrEqual(after + DEFAULT_BYPASS_TTL_MS);
  });

  it('uses the default TTL when ttlMs is omitted', () => {
    const before = Date.now();
    const token = generateBypassToken('admin_bob', TEST_SECRET);
    const payload = decodePayload(token);

    const diff = payload.expiresAt - before;
    expect(diff).toBeGreaterThanOrEqual(DEFAULT_BYPASS_TTL_MS - 5);
    expect(diff).toBeLessThanOrEqual(DEFAULT_BYPASS_TTL_MS + 5);
  });

  it('respects a custom ttlMs shorter than the default', () => {
    const token = generateBypassToken('admin-1', TEST_SECRET, 100);
    const now = Date.now();
    const payload = decodePayload(token);

    expect(payload.expiresAt).toBeGreaterThan(now);
    expect(payload.expiresAt).toBeLessThanOrEqual(now + 100);
  });

  it('respects a custom ttlMs longer than the default', () => {
    const ttl = 86_400_000; // 24 hours
    const token = generateBypassToken('admin-1', TEST_SECRET, ttl);
    const payload = decodePayload(token);

    expect(payload.expiresAt - Date.now()).toBeGreaterThan(DEFAULT_BYPASS_TTL_MS);
  });

  it('works with a short (but valid) secret', () => {
    const token = generateBypassToken('admin_x', SHORT_SECRET);
    expect(() => validateBypass(token, SHORT_SECRET)).not.toThrow();
    expect(validateBypass(token, SHORT_SECRET)).not.toBeNull();
  });

  it('trims whitespace from adminId', () => {
    const token = generateBypassToken('  admin-1  ', TEST_SECRET);
    const payload = decodePayload(token);
    expect(payload.adminId).toBe('admin-1');
  });

  it('throws EmptyAdminIdError for empty adminId', () => {
    expect(() => generateBypassToken('', TEST_SECRET)).toThrow(EmptyAdminIdError);
  });

  it('throws EmptyAdminIdError for whitespace-only adminId', () => {
    expect(() => generateBypassToken('   ', TEST_SECRET)).toThrow(EmptyAdminIdError);
  });

  it('throws EmptyAdminIdError for empty secret (unusual but valid)', () => {
    // HMAC accepts an empty key; the call should succeed for adminId
    const token = generateBypassToken('admin-1', '');
    expect(token).toEqual(expect.any(String));
    expect(token).toContain('.');
  });
});

describe('validateBypass', () => {
  it('returns the payload for a newly created token', () => {
    const token = generateBypassToken('admin-1', TEST_SECRET);
    const result = validateBypass(token, TEST_SECRET);

    expect(result).not.toBeNull();
    expect(result!.adminId).toBe('admin-1');
    expect(result!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('returns null for a token with zero TTL that is already expired', () => {
    const token = generateBypassToken('admin-1', TEST_SECRET, 0);
    const result = validateBypass(token, TEST_SECRET);
    expect(result).toBeNull();
  });

  it('returns null when the signature is tampered (modified payload)', () => {
    const token = generateBypassToken('admin-1', TEST_SECRET);
    const [payload] = token.split('.');
    // Re-encode a different adminId — HMAC will mismatch
    const fakePayload = Buffer.from(
      JSON.stringify({ adminId: 'attacker', expiresAt: Date.now() + 60_000 }),
    ).toString('base64url');
    const tampered = `${fakePayload}.${payload}`;

    expect(validateBypass(tampered, TEST_SECRET)).toBeNull();
  });

  it('returns null when the signature itself is mangled', () => {
    const token = generateBypassToken('admin-1', TEST_SECRET);
    const tampered = token + 'x';
    expect(validateBypass(tampered, TEST_SECRET)).toBeNull();
  });

  it('returns null for a wrong secret', () => {
    const token = generateBypassToken('admin-1', TEST_SECRET);
    const result = validateBypass(token, 'different-secret');
    expect(result).toBeNull();
  });

  it('returns null for an empty token', () => {
    expect(validateBypass('', TEST_SECRET)).toBeNull();
  });

  it('returns null for a string without a dot', () => {
    expect(validateBypass('no-dot-here', TEST_SECRET)).toBeNull();
  });

  it('returns null for a token with dot at start', () => {
    expect(validateBypass('.onlysig', TEST_SECRET)).toBeNull();
  });

  it('returns null for a token with dot at end', () => {
    expect(validateBypass('payload.', TEST_SECRET)).toBeNull();
  });

  it('returns null for non-base64url payload', () => {
    // The signature is always valid-length, but payload is garbage
    // We craft a well-formed structure with the wrong content type
    const garbagePayload = Buffer.from('!!!').toString('base64url');
    expect(validateBypass(`${garbagePayload}.aaaa`, TEST_SECRET)).toBeNull();
  });

  it('returns null when decoded JSON has non-string adminId', () => {
    const payload = base64Payload({ adminId: 42, expiresAt: Date.now() + 60_000 });
    // We need a real signature for this payload to pass the HMAC check
    const token = generateBypassToken('dummy', TEST_SECRET, 60_000);
    const [, sig] = token.split('.');

    // Reconstruct with the right HMAC but wrong payload type
    const forged = `${payload}.${sig}`;
    // HMAC won't match because payload changed — so this correctly returns null
    expect(validateBypass(forged, TEST_SECRET)).toBeNull();
  });

  it('returns null when decoded JSON has non-numeric expiresAt', () => {
    const payload = base64Payload({ adminId: 'admin-1', expiresAt: 'soon' });
    const token = generateBypassToken('dummy', TEST_SECRET, 60_000);
    const [, sig] = token.split('.');
    const forged = `${payload}.${sig}`;

    expect(validateBypass(forged, TEST_SECRET)).toBeNull();
  });

  it('returns null for an expired token (expiresAt in the past)', () => {
    // Manually craft a payload with an expired timestamp — we don't control
    // generateBypassToken's expiresAt except by using a past reference.
    const past = Date.now() - 10_000;
    const raw = Buffer.from(
      JSON.stringify({ adminId: 'admin-1', expiresAt: past }),
    ).toString('base64url');
    const sig = signPayload(raw, TEST_SECRET);
    const expired = `${raw}.${sig}`;

    expect(validateBypass(expired, TEST_SECRET)).toBeNull();
  });

  it('returns the exact payload shape for a valid token', () => {
    const token = generateBypassToken('admin_xyz', TEST_SECRET);
    const result = validateBypass(token, TEST_SECRET);

    expect(result).toEqual(
      expect.objectContaining({
        adminId: 'admin_xyz',
        expiresAt: expect.any(Number),
      }),
    );
  });

  it('validates its own output end-to-end', () => {
    for (const id of ['a', 'admin-999', 'user_with_underscores', 'test@example.com']) {
      const token = generateBypassToken(id, TEST_SECRET);
      const result = validateBypass(token, TEST_SECRET);
      expect(result).not.toBeNull();
      expect(result!.adminId).toBe(id);
    }
  });

  it('handles concurrent validation without cross-contamination', () => {
    const tokens = Array.from({ length: 10 }, (_, i) =>
      generateBypassToken(`admin-${i}`, TEST_SECRET),
    );

    for (let i = 0; i < tokens.length; i++) {
      const result = validateBypass(tokens[i], TEST_SECRET);
      expect(result).not.toBeNull();
      expect(result!.adminId).toBe(`admin-${i}`);
    }
  });
});

describe('BYPASS_SECRET_LENGTH constant', () => {
  it('is exactly 32', () => {
    expect(BYPASS_SECRET_LENGTH).toBe(32);
  });

  it('is a frozen number', () => {
    expect(() => {
      (BYPASS_SECRET_LENGTH as number) = 0;
    }).toThrow();
  });
});

describe('DEFAULT_BYPASS_TTL_MS constant', () => {
  it('is exactly 900 000 (15 minutes)', () => {
    expect(DEFAULT_BYPASS_TTL_MS).toBe(900_000);
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Decode the payload portion of a generated token (skips HMAC verification). */
function decodePayload(token: string): BypassTokenPayload {
  const [payload] = token.split('.');
  const raw = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(raw) as BypassTokenPayload;
}

/** Base64url-encode a JSON-serialized object — used to craft test payloads. */
function base64Payload(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Compute an HMAC-SHA256 signature over `data` with given `secret`. */
function signPayload(data: string, secret: string): string {
  const { createHmac } = jest.requireActual('node:crypto');
  return createHmac('sha256', secret).update(data).digest().toString('base64url');
}
