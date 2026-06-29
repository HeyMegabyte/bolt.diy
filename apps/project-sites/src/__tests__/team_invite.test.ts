/**
 * @module __tests__/team_invite
 * @description Unit tests for HMAC-signed invite token service.
 *
 * Covers:
 *   1. Round-trip: generate → validate → same payload
 *   2. Malformed token rejection
 *   3. Tampered token rejection (HMAC auth tag)
 *   4. Wrong-key rejection
 *   5. Expired token rejection
 *   6. Unique nonces (different tokens for same inputs)
 *   7. Empty key rejection
 *   8. acceptInvite delegates to validateInvite
 */
import {
  generateInvite,
  validateInvite,
  acceptInvite,
  InviteTokenError,
} from '../services/team_invite.js';

// 32 raw bytes → base64 (HMAC-SHA256 key should be ≥32 bytes).
const KEY_A = btoa('0123456789abcdef0123456789abcdef');
const KEY_B = btoa('FEDCBA9876543210FEDCBA9876543210');

describe('team_invite HMAC-signed tokens', () => {
  it('round-trips generate → validate with exact payload', async () => {
    const { token } = await generateInvite('org_1', 'alice@example.com', 'member', KEY_A);
    const payload = await validateInvite(token, KEY_A);
    expect(payload).toMatchObject({
      orgId: 'org_1',
      email: 'alice@example.com',
      role: 'member',
    });
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(Date.now());
  });

  it('returns an ISO expiresAt timestamp', async () => {
    const { expiresAt } = await generateInvite('org_1', 'b@b.com', 'admin', KEY_A);
    const ts = Date.parse(expiresAt);
    expect(ts).not.toBeNaN();
    expect(ts).toBeGreaterThan(Date.now());
  });

  it('ejects a malformed token (no dot separator)', async () => {
    await expect(validateInvite('not-a-valid-token', KEY_A)).rejects.toThrow(InviteTokenError);
    await expect(validateInvite('no-dot-here', KEY_A)).rejects.toThrow(/malformed/i);
  });

  it('ejects a token with empty parts (empty payload)', async () => {
    await expect(validateInvite('.abc', KEY_A)).rejects.toThrow(InviteTokenError);
    await expect(validateInvite('abc.', KEY_A)).rejects.toThrow(InviteTokenError);
  });

  it('REJECTS a tampered signature (HMAC auth tag mismatch)', async () => {
    const { token } = await generateInvite('org_1', 'bob@example.com', 'member', KEY_A);
    const [payloadB64, _sig] = token.split('.') as [string, string];
    // Flip bits in the signature portion
    const sigBytes = Uint8Array.from(
      atob(_sig.replace(/-/g, '+').replace(/_/g, '').padEnd(_sig.length, '=')),
      (c) => c.charCodeAt(0),
    );
    const mid = Math.floor(sigBytes.length / 2);
    sigBytes[mid] = (sigBytes[mid] ?? 0) ^ 0xff;
    const tamperedSig = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tamperedToken = `${payloadB64}.${tamperedSig}`;
    await expect(validateInvite(tamperedToken, KEY_A)).rejects.toThrow(InviteTokenError);
    await expect(validateInvite(tamperedToken, KEY_A)).rejects.toThrow(/signature/i);
  });

  it('REJECTS a tampered payload (HMAC no longer matches)', async () => {
    const { token } = await generateInvite('org_1', 'carol@example.com', 'member', KEY_A);
    // Modify a byte in the base64url payload — decode, flip, re-encode
    const [payloadB64, sig] = token.split('.') as [string, string];
    const raw = atob(payloadB64.replace(/-/g, '+').replace(/_/g, ''));
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 0x01; // flip one bit
    const tamperedB64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tamperedToken = `${tamperedB64}.${sig}`;
    await expect(validateInvite(tamperedToken, KEY_A)).rejects.toThrow(InviteTokenError);
  });

  it('REJECTS a token signed with a different key', async () => {
    const { token } = await generateInvite('org_2', 'dave@example.com', 'admin', KEY_A);
    await expect(validateInvite(token, KEY_B)).rejects.toThrow(InviteTokenError);
  });

  it('REJECTS an expired token', async () => {
    // Generate a token that expires immediately (override inner logic by
    // creating a payload already in the past, then wrapping it manually).
    // We use a zero-TTL via a direct past-expiry payload.
    const pastPayload = {
      orgId: 'org_3',
      email: 'eve@example.com',
      role: 'member',
      exp: Date.now() - 60_000, // 1 minute ago
    };
    // Sign it manually to set a past expiry
    const payloadB64 = btoa(JSON.stringify(pastPayload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const sig = await hmacSign(payloadB64, KEY_A);
    const expiredToken = `${payloadB64}.${sig}`;
    await expect(validateInvite(expiredToken, KEY_A)).rejects.toThrow(InviteTokenError);
    await expect(validateInvite(expiredToken, KEY_A)).rejects.toThrow(/expired/i);
  });

  it('generates distinct tokens for the same inputs (unique nonce via timestamp)', async () => {
    const a = await generateInvite('org_1', 'frank@example.com', 'member', KEY_A);
    // Ensure at least 1ms gap — Date.now() has ms precision and both calls
    // may fire within the same millisecond.
    await new Promise((r) => setTimeout(r, 2));
    const b = await generateInvite('org_1', 'frank@example.com', 'member', KEY_A);
    expect(a.token).not.toBe(b.token);
    // Both are separately valid
    expect(await validateInvite(a.token, KEY_A)).toMatchObject({ email: 'frank@example.com' });
    expect(await validateInvite(b.token, KEY_A)).toMatchObject({ email: 'frank@example.com' });
  });

  it('throws InviteTokenError on empty HMAC key', async () => {
    await expect(generateInvite('org_1', 'x@x.com', 'member', '')).rejects.toThrow(
      InviteTokenError,
    );
  });

  it('rejects a token with invalid base64 payload', async () => {
    const sig = await hmacSign('!!!not-base64!!!', KEY_A);
    const token = `!!!not-base64!!!.${sig}`;
    await expect(validateInvite(token, KEY_A)).rejects.toThrow(InviteTokenError);
  });

  it('rejects a token with missing payload fields', async () => {
    const invalidPayload = JSON.stringify({ orgId: 'org_1' }); // missing email, role, exp
    const payloadB64 = btoa(invalidPayload)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const sig = await hmacSign(payloadB64, KEY_A);
    const token = `${payloadB64}.${sig}`;
    await expect(validateInvite(token, KEY_A)).rejects.toThrow(InviteTokenError);
  });

  // ── acceptInvite ─────────────────────────────────────────────

  it('acceptInvite delegates to validateInvite and returns the payload', async () => {
    const { token } = await generateInvite('org_10', 'grace@example.com', 'admin', KEY_A);
    const payload = await acceptInvite(token, 'user_grace', KEY_A);
    expect(payload).toMatchObject({
      orgId: 'org_10',
      email: 'grace@example.com',
      role: 'admin',
    });
  });

  it('acceptInvite rejects tampered tokens', async () => {
    const { token } = await generateInvite('org_10', 'hank@example.com', 'member', KEY_A);
    const tampered = token + 'x';
    await expect(acceptInvite(tampered, 'user_hank', KEY_A)).rejects.toThrow(InviteTokenError);
  });

  it('acceptInvite rejects expired tokens', async () => {
    const pastPayload = {
      orgId: 'org_11',
      email: 'iris@example.com',
      role: 'viewer',
      exp: Date.now() - 1,
    };
    const payloadB64 = btoa(JSON.stringify(pastPayload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const sig = await hmacSign(payloadB64, KEY_A);
    const expiredToken = `${payloadB64}.${sig}`;
    await expect(acceptInvite(expiredToken, 'user_iris', KEY_A)).rejects.toThrow(InviteTokenError);
  });
});

// ── Test helper (mirrors the internal hmacSign for manual token construction) ──

async function hmacSign(message: string, hmacKey: string): Promise<string> {
  const rawKey = Uint8Array.from(atob(hmacKey), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
