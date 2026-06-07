import { SYS_ADMIN_EMAILS, isSysAdminEmail } from './sys-admin';

/**
 * Coverage for the System Administrator identity gate — the SSOT that decides
 * who sees LAYER 1 (platform-ops feature flags) vs only LAYER 2 (site Features).
 */
describe('isSysAdminEmail (System Administrator gate)', () => {
  it('admits the canonical operator brian@megabyte.space', () => {
    expect(isSysAdminEmail('brian@megabyte.space')).toBe(true);
  });

  it('admits the alternate operator identity hey@megabyte.space', () => {
    expect(isSysAdminEmail('hey@megabyte.space')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isSysAdminEmail('  Brian@Megabyte.Space ')).toBe(true);
    expect(isSysAdminEmail('HEY@MEGABYTE.SPACE')).toBe(true);
  });

  it('denies a normal site owner', () => {
    expect(isSysAdminEmail('owner@acme.com')).toBe(false);
    expect(isSysAdminEmail('someone-else@megabyte.space')).toBe(false);
  });

  it('denies empty / null / undefined identities', () => {
    expect(isSysAdminEmail('')).toBe(false);
    expect(isSysAdminEmail(null)).toBe(false);
    expect(isSysAdminEmail(undefined)).toBe(false);
  });

  it('exposes the allowlist as a frozen-shaped readonly array', () => {
    expect(SYS_ADMIN_EMAILS).toContain('brian@megabyte.space');
    expect(SYS_ADMIN_EMAILS.length).toBeGreaterThanOrEqual(1);
  });
});
