/**
 * @module session_store.test
 * @description Unit tests for the pure in-memory session utility.
 *
 * Every exported symbol is covered: {@link SESSION_TTL},
 * {@link createSession}, {@link isExpired}, {@link hasRole},
 * {@link sessionSummary}.
 */

import { describe, it, expect } from '@jest/globals';
import {
  SESSION_TTL,
  createSession,
  isExpired,
  hasRole,
  sessionSummary,
} from '../services/session_store.js';

// ── SESSION_TTL ────────────────────────────────────────────────────────────

describe('SESSION_TTL', () => {
  it('is 24 hours in milliseconds', () => {
    expect(SESSION_TTL).toBe(24 * 3600 * 1000);
  });
});

// ── createSession ──────────────────────────────────────────────────────────

describe('createSession', () => {
  it('returns a SessionData with the given userId and orgId', () => {
    const s = createSession('u1', 'org1');
    expect(s.userId).toBe('u1');
    expect(s.orgId).toBe('org1');
  });

  it('defaults roles to an empty array when omitted', () => {
    const s = createSession('u1', 'org1');
    expect(s.roles).toEqual([]);
  });

  it('defaults roles to an empty array when undefined is passed explicitly', () => {
    const s = createSession('u1', 'org1', undefined);
    expect(s.roles).toEqual([]);
  });

  it('accepts a supplied roles array', () => {
    const s = createSession('u1', 'org1', ['admin', 'billing_admin']);
    expect(s.roles).toEqual(['admin', 'billing_admin']);
  });

  it('uses the default TTL when ttlMs is omitted', () => {
    // Pin nowMs so the test is deterministic.
    const s = createSession('u1', 'org1', [], undefined, 0);
    expect(s.expiresAt).toBe(SESSION_TTL);
  });

  it('uses a supplied ttlMs', () => {
    const s = createSession('u1', 'org1', [], 60_000, 0);
    expect(s.expiresAt).toBe(60_000);
  });

  it('uses Date.now() when nowMs is omitted (within a plausible range)', () => {
    const before = Date.now();
    const s = createSession('u1', 'org1');
    const after = Date.now();
    expect(s.expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL);
    expect(s.expiresAt).toBeLessThanOrEqual(after + SESSION_TTL);
  });

  it('initialises metadata as an empty object', () => {
    const s = createSession('u1', 'org1');
    expect(s.metadata).toEqual({});
  });
});

// ── isExpired ──────────────────────────────────────────────────────────────

describe('isExpired', () => {
  it('returns false for a fresh session', () => {
    // Session created at T=0 with TTL=1000; check at T=500 → not expired.
    const s = createSession('u1', 'org1', [], 1000, 0);
    expect(isExpired(s, 500)).toBe(false);
  });

  it('returns true exactly at the expiry boundary', () => {
    const s = createSession('u1', 'org1', [], 1000, 0);
    expect(isExpired(s, 1000)).toBe(true);
  });

  it('returns true past the expiry boundary', () => {
    const s = createSession('u1', 'org1', [], 1000, 0);
    expect(isExpired(s, 1500)).toBe(true);
  });

  it('returns false for a session with a very large TTL', () => {
    const s = createSession('u1', 'org1', [], Number.MAX_SAFE_INTEGER, 0);
    expect(isExpired(s, Date.now())).toBe(false);
  });

  it('uses Date.now() when nowMs is omitted (within a plausible range)', () => {
    const s = createSession('u1', 'org1', [], 3600_000); // 1 h
    expect(isExpired(s)).toBe(false);
  });
});

// ── hasRole ────────────────────────────────────────────────────────────────

describe('hasRole', () => {
  it('returns true when the role exists', () => {
    const s = createSession('u1', 'org1', ['owner', 'billing_admin']);
    expect(hasRole(s, 'owner')).toBe(true);
    expect(hasRole(s, 'billing_admin')).toBe(true);
  });

  it('returns false when the role does not exist', () => {
    const s = createSession('u1', 'org1', ['owner']);
    expect(hasRole(s, 'admin')).toBe(false);
  });

  it('returns false when roles is empty', () => {
    const s = createSession('u1', 'org1');
    expect(hasRole(s, 'owner')).toBe(false);
  });

  it('is case-sensitive', () => {
    const s = createSession('u1', 'org1', ['Owner']);
    expect(hasRole(s, 'owner')).toBe(false);
  });
});

// ── sessionSummary ─────────────────────────────────────────────────────────

describe('sessionSummary', () => {
  it('returns userId and orgId from the session', () => {
    const s = createSession('u1', 'org1', ['admin']);
    const sum = sessionSummary(s);
    expect(sum.userId).toBe('u1');
    expect(sum.orgId).toBe('org1');
  });

  it('reports the correct roleCount', () => {
    const s = createSession('u1', 'org1', ['a', 'b', 'c']);
    expect(sessionSummary(s).roleCount).toBe(3);
  });

  it('reports 0 roleCount when roles is empty', () => {
    const s = createSession('u1', 'org1');
    expect(sessionSummary(s).roleCount).toBe(0);
  });

  it('reports timeRemaining as a positive number for a live session', () => {
    const s = createSession('u1', 'org1', [], 3600_000);
    const sum = sessionSummary(s);
    expect(sum.timeRemaining).toBeGreaterThan(0);
    expect(sum.timeRemaining).toBeLessThanOrEqual(3600_000);
  });

  it('reports timeRemaining of 0 for an expired session', () => {
    const s = createSession('u1', 'org1', [], 1000, 0);
    // The summary reads Date.now() internally so we cannot freeze it here,
    // but a session created at epoch with 1s TTL is certainly expired.
    // We make a relative assertion: timeRemaining < 0 ⇒ clamped to zero.
    const sum = sessionSummary(s);
    // Wait — with nowMs=0 and TTL=1000, expiresAt=1000, and Date.now() is
    // > 1000, so timeRemaining < 0, which Math.max(0, …) should clamp to 0.
    expect(sum.timeRemaining).toBe(0);
  });
});
