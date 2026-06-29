import {
  BYPASS_TTL_MS,
  createBypassToken,
  EmptyAdminIdError,
  isValid,
  type BypassTokenPayload,
} from '../rate_limit_bypass';

describe('createBypassToken', () => {
  it('returns a non-empty base64 string', () => {
    const token = createBypassToken('user_abc');
    expect(token).toEqual(expect.any(String));
    expect(token.length).toBeGreaterThan(0);
  });

  it('encodes the adminId and a future expiresAt in the payload', () => {
    const before = Date.now();
    const token = createBypassToken('admin-42');
    const after = Date.now();

    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;

    expect(payload.adminId).toBe('admin-42');
    expect(payload.expiresAt).toBeGreaterThan(before);
    expect(payload.expiresAt).toBeLessThanOrEqual(after + BYPASS_TTL_MS);
  });

  it('uses the default BYPASS_TTL_MS when ttlMs is omitted', () => {
    const before = Date.now();
    const token = createBypassToken('user_xyz');
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;

    expect(payload.expiresAt - before).toBeGreaterThanOrEqual(BYPASS_TTL_MS - 5);
    expect(payload.expiresAt - before).toBeLessThanOrEqual(BYPASS_TTL_MS + 5);
  });

  it('respects a custom ttlMs shorter than the default', () => {
    const token = createBypassToken('admin-1', 100);
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;

    expect(payload.expiresAt).toBeGreaterThan(Date.now());
    expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + 100);
  });

  it('respects a custom ttlMs longer than the default', () => {
    const token = createBypassToken('admin-1', 86_400_000); // 24 h
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;

    expect(payload.expiresAt - Date.now()).toBeGreaterThan(BYPASS_TTL_MS);
  });

  it('throws EmptyAdminIdError for empty adminId', () => {
    expect(() => createBypassToken('')).toThrow(EmptyAdminIdError);
  });

  it('throws EmptyAdminIdError for whitespace-only adminId', () => {
    expect(() => createBypassToken('   ')).toThrow(EmptyAdminIdError);
  });
});

describe('isValid', () => {
  it('returns true for a newly created token', () => {
    const token = createBypassToken('admin-1');
    expect(isValid(token)).toBe(true);
  });

  it('returns false for a token created at the same time with zero TTL', () => {
    const token = createBypassToken('admin-1', 0);
    expect(isValid(token)).toBe(false);
  });

  it('returns false when nowMs is past expiresAt', () => {
    const token = createBypassToken('admin-1');
    expect(isValid(token, Date.now() + BYPASS_TTL_MS + 1)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValid('')).toBe(false);
  });

  it('returns false for non-base64 garbage', () => {
    expect(isValid('!!!not-base64!!!')).toBe(false);
  });

  it('returns false for base64 that decodes to non-JSON', () => {
    // base64 of "not-json-at-all"
    expect(isValid('bm90LWpzb24tYXQtYWxs')).toBe(false);
  });

  it('returns false for base64 JSON missing adminId', () => {
    // base64 of JSON `{ "expiresAt": 9999999999999 }`
    expect(isValid('eyAiZXhwaXJlc0F0IjogOTk5OTk5OTk5OTk5OSB9')).toBe(false);
  });

  it('returns false for base64 JSON missing expiresAt', () => {
    // base64 of JSON `{ "adminId": "x" }`
    expect(isValid('eyAiYWRtaW5JZCI6ICJ4IiB9')).toBe(false);
  });

  it('returns false for base64 JSON with empty adminId', () => {
    const payload = JSON.stringify({ adminId: '', expiresAt: Date.now() + 60_000 });
    const token = Buffer.from(payload).toString('base64');
    expect(isValid(token)).toBe(false);
  });

  it('returns false for base64 JSON with null adminId', () => {
    const payload = JSON.stringify({ adminId: null, expiresAt: Date.now() + 60_000 });
    const token = Buffer.from(payload).toString('base64');
    expect(isValid(token)).toBe(false);
  });

  it('returns false for base64 JSON with non-numeric expiresAt', () => {
    const payload = JSON.stringify({ adminId: 'admin-1', expiresAt: 'soon' });
    const token = Buffer.from(payload).toString('base64');
    expect(isValid(token)).toBe(false);
  });

  it('returns true when nowMs exactly matches expiresAt - 1 (barely valid)', () => {
    const token = createBypassToken('admin-1', 10_000);
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;
    expect(isValid(token, payload.expiresAt - 1)).toBe(true);
  });

  it('returns false when nowMs exactly matches expiresAt (boundary)', () => {
    const token = createBypassToken('admin-1', 10_000);
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;
    expect(isValid(token, payload.expiresAt)).toBe(false);
  });

  it('returns false for base64 JSON with non-string adminId (number)', () => {
    const payload = JSON.stringify({ adminId: 42, expiresAt: Date.now() + 60_000 });
    const token = Buffer.from(payload).toString('base64');
    expect(isValid(token)).toBe(false);
  });

  it('returns false for base64 JSON with non-string adminId (array)', () => {
    const payload = JSON.stringify({ adminId: ['a'], expiresAt: Date.now() + 60_000 });
    const token = Buffer.from(payload).toString('base64');
    expect(isValid(token)).toBe(false);
  });
});

describe('BYPASS_TTL_MS constant', () => {
  it('is exactly 3 600 000 (1 hour)', () => {
    expect(BYPASS_TTL_MS).toBe(3_600_000);
  });

  it('is frozen (immutable)', () => {
    // In a module const it's de facto frozen at the binding level;
    // confirm the value hasn't been patched at runtime
    expect(() => {
      (BYPASS_TTL_MS as number) = 0;
    }).toThrow();
  });
});
