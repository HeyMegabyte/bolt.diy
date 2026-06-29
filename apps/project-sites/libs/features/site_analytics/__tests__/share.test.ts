import { mintShareToken, verifyShareToken, ShareTokenError } from '../share.js';

const SECRET = 'test-share-secret-0123456789';

describe('AN48 share token (HMAC + expiry)', () => {
  it('mints a "siteId.exp.sig" token and verifies it back to the grant', async () => {
    const exp = 2_000_000_000_000; // far future
    const token = await mintShareToken(SECRET, 'site_1', exp);
    expect(token.startsWith('site_1.2000000000000.')).toBe(true);
    const grant = await verifyShareToken(SECRET, token, 1_000);
    expect(grant).toEqual({ siteId: 'site_1', expEpochMs: exp });
  });

  it('rejects an expired token (exp <= now)', async () => {
    const token = await mintShareToken(SECRET, 'site_1', 1_500);
    expect(await verifyShareToken(SECRET, token, 1_500)).toBeNull(); // exactly-at-exp = expired
    expect(await verifyShareToken(SECRET, token, 2_000)).toBeNull();
    expect(await verifyShareToken(SECRET, token, 1_000)).not.toBeNull(); // still valid before exp
  });

  it('rejects a tampered signature', async () => {
    const exp = 2_000_000_000_000;
    const token = await mintShareToken(SECRET, 'site_1', exp);
    const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    expect(await verifyShareToken(SECRET, tampered, 1_000)).toBeNull();
  });

  it('rejects a token signed with a different secret (forgery)', async () => {
    const token = await mintShareToken(SECRET, 'site_1', 2_000_000_000_000);
    expect(await verifyShareToken('other-secret', token, 1_000)).toBeNull();
  });

  it('rejects a token whose siteId was swapped (sig no longer matches)', async () => {
    const token = await mintShareToken(SECRET, 'site_1', 2_000_000_000_000);
    const swapped = token.replace('site_1', 'site_evil');
    expect(await verifyShareToken(SECRET, swapped, 1_000)).toBeNull();
  });

  it('rejects malformed tokens + empty inputs', async () => {
    expect(await verifyShareToken(SECRET, 'not-a-token', 1_000)).toBeNull();
    expect(await verifyShareToken(SECRET, 'a.b', 1_000)).toBeNull();
    expect(await verifyShareToken(SECRET, '', 1_000)).toBeNull();
    expect(await verifyShareToken('', 'x.1.y', 1_000)).toBeNull();
  });

  it('throws a typed error when minting without a secret or siteId', async () => {
    await expect(mintShareToken('', 'site_1', 1)).rejects.toThrow(ShareTokenError);
    await expect(mintShareToken(SECRET, '', 1)).rejects.toThrow(ShareTokenError);
  });
});
