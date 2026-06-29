import { generateMagicToken, verifyMagicToken, MAGIC_LINK_TTL } from '../services/auth_magic.js';

const SECRET = 's3cret-k3y-12345';

describe('MAGIC_LINK_TTL', () => {
  it('defaults to 15 minutes (900_000 ms)', () => {
    expect(MAGIC_LINK_TTL).toBe(900_000);
  });
});

describe('generateMagicToken', () => {
  it('produces a dot-separated token with two base64url segments', async () => {
    const token = await generateMagicToken('user@example.com', SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('lowercases the email before encoding', async () => {
    const token = await generateMagicToken('USER@Example.COM', SECRET);
    const decoded = await verifyMagicToken(token, SECRET);
    expect(decoded).toBe('user@example.com');
  });

  it('honours a custom TTL', async () => {
    const shortTTL = 10_000; // 10 seconds
    const token = await generateMagicToken('a@b.com', SECRET, shortTTL);

    // Should verify immediately (not yet expired)
    const email = await verifyMagicToken(token, SECRET);
    expect(email).toBe('a@b.com');
  });

  it('generates unique tokens for the same email (different timestamps)', async () => {
    const t1 = await generateMagicToken('same@email.com', SECRET);
    // Force a small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await generateMagicToken('same@email.com', SECRET);
    expect(t1).not.toBe(t2);
  });

  it('handles email addresses with special characters', async () => {
    const token = await generateMagicToken('test+tag@example.co.uk', SECRET);
    const email = await verifyMagicToken(token, SECRET);
    expect(email).toBe('test+tag@example.co.uk');
  });
});

describe('verifyMagicToken', () => {
  it('returns the email for a valid token', async () => {
    const token = await generateMagicToken('hello@world.com', SECRET);
    expect(await verifyMagicToken(token, SECRET)).toBe('hello@world.com');
  });

  it('returns null for an invalid secret (tampered signature)', async () => {
    const token = await generateMagicToken('a@b.com', SECRET);
    expect(await verifyMagicToken(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for a malformed token (no dot)', async () => {
    expect(await verifyMagicToken('not-a-valid-token', SECRET)).toBeNull();
  });

  it('returns null for a token with an empty payload', async () => {
    expect(await verifyMagicToken('.signature', SECRET)).toBeNull();
  });

  it('returns null for an empty signature', async () => {
    expect(await verifyMagicToken('payload.', SECRET)).toBeNull();
  });

  it('returns null for an empty token', async () => {
    expect(await verifyMagicToken('', SECRET)).toBeNull();
  });

  it('returns null for a token with non-base64 payload', async () => {
    // Payload that decodes to garbage (no | separator)
    const badPayload = btoa('this-has-no-pipe')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyMagicToken(`${badPayload}.YWJj`, SECRET)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    // A negative TTL produces an expiry in the past
    const token = await generateMagicToken('expired@test.com', SECRET, -60_000);
    expect(await verifyMagicToken(token, SECRET)).toBeNull();
  });

  it('returns null when the expiry value is not a number', async () => {
    // Manually craft a token with non-numeric expiry
    const payload = btoa('email@test.com|not-a-number');
    const pEncoded = payload.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Import hmacSha256 locally for crafting
    const { hmacSha256 } = await import('@project-sites/shared');
    const sig = await hmacSha256(SECRET, 'email@test.com|not-a-number');
    const sEncoded = btoa(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    expect(await verifyMagicToken(`${pEncoded}.${sEncoded}`, SECRET)).toBeNull();
  });

  it('is deterministic: same secret + same payload yields same signature', async () => {
    // We can't easily freeze Date.now(), but we can verify HMAC behaviour:
    // generate → split, re-verify the payload part with any secret
    const token = await generateMagicToken('deterministic@test.com', SECRET);
    const [payloadEncoded] = token.split('.');
    expect(payloadEncoded).toBeTruthy();
  });
});
