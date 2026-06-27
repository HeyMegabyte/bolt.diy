import { signHs256, verifyHs256 } from '../lib/jwt.js';

/** Decode a base64url segment to a UTF-8 string. */
function decodeSegment(seg: string): string {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('signHs256', () => {
  const secret = 'x'.repeat(40);

  it('produces a 3-part compact JWS', async () => {
    const token = await signHs256({ sub: 'u_1' }, secret, 1800);
    expect(token.split('.')).toHaveLength(3);
  });

  it('embeds the claims + injects iat/exp from the TTL', async () => {
    const token = await signHs256(
      { sub: 'u_1', impersonator_id: 'u_op', mode: 'read' },
      secret,
      1800,
    );
    const claims = JSON.parse(decodeSegment(token.split('.')[1])) as {
      sub: string;
      impersonator_id: string;
      mode: string;
      iat: number;
      exp: number;
    };
    expect(claims.sub).toBe('u_1');
    expect(claims.impersonator_id).toBe('u_op');
    expect(claims.mode).toBe('read');
    expect(claims.exp - claims.iat).toBe(1800);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('sets the HS256 header', async () => {
    const token = await signHs256({ sub: 'u_1' }, secret, 60);
    const header = JSON.parse(decodeSegment(token.split('.')[0])) as { alg: string; typ: string };
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('verifies against the same secret (tamper-evident)', async () => {
    const token = await signHs256({ sub: 'u_1' }, secret, 60);
    const [h, p, s] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) =>
      ch.charCodeAt(0),
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);

    const bad = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${h}.${p}TAMPERED`),
    );
    expect(bad).toBe(false);
  });
});

describe('verifyHs256', () => {
  const secret = 'x'.repeat(40);

  it('round-trips: a freshly signed token verifies + returns its claims', async () => {
    const token = await signHs256({ sub: 'u_1', mode: 'read' }, secret, 1800);
    const claims = await verifyHs256(token, secret);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('u_1');
    expect(claims?.mode).toBe('read');
  });

  it('returns null for a wrong secret', async () => {
    const token = await signHs256({ sub: 'u_1' }, secret, 1800);
    expect(await verifyHs256(token, 'y'.repeat(40))).toBeNull();
  });

  it('returns null for a tampered payload', async () => {
    const token = await signHs256({ sub: 'u_1' }, secret, 1800);
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', exp: 9_999_999_999 })).toString('base64url')}.${s}`;
    expect(await verifyHs256(forged, secret)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = await signHs256({ sub: 'u_1' }, secret, 1800);
    // now far in the future → exp <= now → expired
    expect(await verifyHs256(token, secret, 99_999_999_999)).toBeNull();
  });

  it('returns null for a malformed (non-3-part) token', async () => {
    expect(await verifyHs256('not.a.jwt.x', secret)).toBeNull();
    expect(await verifyHs256('garbage', secret)).toBeNull();
  });
});
