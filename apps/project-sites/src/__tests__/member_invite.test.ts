import type { Invite } from '../services/member_invite.js';

import { createInvite, INVITE_TTL_MS, isAccepted, isExpired } from '../services/member_invite.js';

const NOW = 1_750_000_000_000;

describe('createInvite', () => {
  it('returns an invite with given email, role, and orgId', () => {
    const invite = createInvite('a@b.com', 'editor', 'org_abc', INVITE_TTL_MS, NOW);
    expect(invite.email).toBe('a@b.com');
    expect(invite.role).toBe('editor');
    expect(invite.orgId).toBe('org_abc');
  });

  it('sets acceptedAt to null', () => {
    const invite = createInvite('a@b.com', 'editor', 'org_abc', INVITE_TTL_MS, NOW);
    expect(invite.acceptedAt).toBeNull();
  });

  it('computes expiresAt as nowMs + ttlMs', () => {
    const invite = createInvite('a@b.com', 'viewer', 'org_abc', INVITE_TTL_MS, NOW);
    expect(invite.expiresAt).toBe(NOW + INVITE_TTL_MS);
  });

  it('uses default INVITE_TTL_MS when ttlMs is omitted', () => {
    const invite = createInvite('a@b.com', 'admin', 'org_x', undefined, NOW);
    expect(invite.expiresAt).toBe(NOW + INVITE_TTL_MS);
  });

  it('uses Date.now() when nowMs is omitted (liveness check)', () => {
    const before = Date.now();
    const invite = createInvite('a@b.com', 'editor', 'org_abc');
    const after = Date.now();
    expect(invite.expiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(invite.expiresAt).toBeLessThanOrEqual(after + INVITE_TTL_MS);
  });

  it('generates a unique token per call', () => {
    const a = createInvite('a@b.com', 'editor', 'org_abc', INVITE_TTL_MS, NOW);
    const b = createInvite('a@b.com', 'editor', 'org_abc', INVITE_TTL_MS, NOW);
    expect(a.token).not.toBe(b.token);
  });

  it('generates a v4-UUID-shaped token', () => {
    const invite = createInvite('a@b.com', 'admin', 'org_abc', INVITE_TTL_MS, NOW);
    expect(invite.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('isExpired', () => {
  function freshInvite(nowMs = NOW): Invite {
    return createInvite('a@b.com', 'editor', 'org_abc', INVITE_TTL_MS, nowMs);
  }

  it('returns true when nowMs equals expiresAt', () => {
    const invite = freshInvite();
    expect(isExpired(invite, invite.expiresAt)).toBe(true);
  });

  it('returns true when nowMs is past expiresAt', () => {
    const invite = freshInvite();
    expect(isExpired(invite, invite.expiresAt + 1)).toBe(true);
  });

  it('returns false when nowMs is before expiresAt', () => {
    const invite = freshInvite();
    expect(isExpired(invite, invite.expiresAt - 1)).toBe(false);
  });

  it('uses Date.now() when nowMs is omitted', () => {
    const invite = createInvite(
      'a@b.com',
      'editor',
      'org_abc',
      -1, // expires immediately
      NOW,
    );
    expect(isExpired(invite)).toBe(true);
  });
});

describe('isAccepted', () => {
  it('returns true when acceptedAt is non-null', () => {
    const invite = createInvite('a@b.com', 'admin', 'org_abc', INVITE_TTL_MS, NOW);
    expect(isAccepted({ ...invite, acceptedAt: 1_750_000_001_000 })).toBe(true);
  });

  it('returns false when acceptedAt is null', () => {
    const invite = createInvite('a@b.com', 'admin', 'org_abc', INVITE_TTL_MS, NOW);
    expect(isAccepted(invite)).toBe(false);
  });
});

describe('INVITE_TTL_MS', () => {
  it('equals 7 days in ms', () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is frozen (immutable)', () => {
    // const, so assignment in strict mode is a silent no-op
    expect(() => {
      // @ts-expect-error - testing runtime immutability
      INVITE_TTL_MS = 1;
    }).toThrow();
  });
});
