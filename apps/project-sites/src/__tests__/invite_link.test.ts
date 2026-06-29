import {
  createInviteLink,
  isValid,
  useLink,
  DEFAULT_TTL,
  type InviteLink,
} from '../services/invite_link.js';

describe('createInviteLink', () => {
  const NOW = 1_000_000_000_000;

  it('creates a link with a 32-hex-char token', () => {
    const link = createInviteLink('org_x', 'admin');
    expect(link.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sets orgId and role from arguments', () => {
    const link = createInviteLink('org_x', 'member');
    expect(link.orgId).toBe('org_x');
    expect(link.role).toBe('member');
  });

  it('defaults maxUses to 0 (unlimited)', () => {
    const link = createInviteLink('org_x', 'admin');
    expect(link.maxUses).toBe(0);
  });

  it('honours a custom maxUses', () => {
    const link = createInviteLink('org_x', 'admin', 5);
    expect(link.maxUses).toBe(5);
  });

  it('uses DEFAULT_TTL when no ttlMs is given', () => {
    const link = createInviteLink('org_x', 'admin', 0, undefined, NOW);
    expect(link.expiresAt).toBe(NOW + DEFAULT_TTL);
  });

  it('honours a custom ttlMs', () => {
    const link = createInviteLink('org_x', 'admin', 0, 3_600_000, NOW);
    expect(link.expiresAt).toBe(NOW + 3_600_000);
  });

  it('starts with useCount === 0', () => {
    const link = createInviteLink('org_x', 'admin');
    expect(link.useCount).toBe(0);
  });

  it('generates a different token on each call', () => {
    const a = createInviteLink('org_x', 'admin');
    const b = createInviteLink('org_x', 'admin');
    expect(a.token).not.toBe(b.token);
  });
});

describe('isValid', () => {
  const NOW = 1_000_000_000_000;

  function link(over: Partial<InviteLink> = {}): InviteLink {
    return {
      token: 'a'.repeat(32),
      orgId: 'org_x',
      role: 'member',
      expiresAt: NOW + DEFAULT_TTL,
      maxUses: 0,
      useCount: 0,
      ...over,
    };
  }

  it('returns true for a fresh unlimited link', () => {
    expect(isValid(link(), NOW)).toBe(true);
  });

  it('returns false when expired', () => {
    expect(isValid(link({ expiresAt: NOW - 1 }), NOW)).toBe(false);
  });

  it('returns false when expired exactly at the boundary', () => {
    expect(isValid(link({ expiresAt: NOW }), NOW)).toBe(false);
  });

  it('returns true when just inside the expiry boundary', () => {
    expect(isValid(link({ expiresAt: NOW + 1 }), NOW)).toBe(true);
  });

  it('returns false when maxUses reached (useCount === maxUses)', () => {
    expect(isValid(link({ maxUses: 3, useCount: 3 }), NOW)).toBe(false);
  });

  it('returns false when maxUses exceeded (useCount > maxUses)', () => {
    expect(isValid(link({ maxUses: 3, useCount: 4 }), NOW)).toBe(false);
  });

  it('returns true when under maxUses', () => {
    expect(isValid(link({ maxUses: 3, useCount: 2 }), NOW)).toBe(true);
  });

  it('returns true for useCount === maxUses when maxUses is 0 (unlimited)', () => {
    expect(isValid(link({ maxUses: 0, useCount: 999 }), NOW)).toBe(true);
  });

  it('returns false when BOTH expired AND used up', () => {
    expect(isValid(link({ expiresAt: NOW - 1, maxUses: 3, useCount: 3 }), NOW)).toBe(false);
  });
});

describe('useLink', () => {
  it('increments useCount by 1', () => {
    const link: InviteLink = {
      token: 'a'.repeat(32),
      orgId: 'org_x',
      role: 'admin',
      expiresAt: 1_000_000_000_000,
      maxUses: 5,
      useCount: 2,
    };
    const used = useLink(link);
    expect(used.useCount).toBe(3);
  });

  it('does not mutate the original link', () => {
    const link: InviteLink = {
      token: 'a'.repeat(32),
      orgId: 'org_x',
      role: 'admin',
      expiresAt: 1_000_000_000_000,
      maxUses: 5,
      useCount: 2,
    };
    const original = { ...link };
    useLink(link);
    expect(link.useCount).toBe(original.useCount);
  });

  it('preserves all other fields unchanged', () => {
    const link: InviteLink = {
      token: 'abc123',
      orgId: 'org_x',
      role: 'admin',
      expiresAt: 1_000_000_000_000,
      maxUses: 5,
      useCount: 2,
    };
    const used = useLink(link);
    expect(used.token).toBe('abc123');
    expect(used.orgId).toBe('org_x');
    expect(used.role).toBe('admin');
    expect(used.expiresAt).toBe(1_000_000_000_000);
    expect(used.maxUses).toBe(5);
  });
});

describe('DEFAULT_TTL', () => {
  it('is 72 hours in milliseconds', () => {
    expect(DEFAULT_TTL).toBe(72 * 3600 * 1000);
  });
});
