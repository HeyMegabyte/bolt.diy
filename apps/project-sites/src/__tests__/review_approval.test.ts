import {
  effectiveApprovalStatus,
  applyApprovalAction,
  recordReviewDecision,
  getReviewLink,
  createReviewLink,
  listReviewLinks,
  DEFAULT_REVIEW_TTL_MS,
  type ApprovalLinkState,
} from '../services/review_approval.js';
import type { Env } from '../types/env.js';

/** Mock D1: SELECT decision/expires_at via .all()→{results}; UPDATE via .run()→{meta.changes}. */
function mockEnv(
  row: { decision: string | null; expires_at: string } | null,
  updateChanges = 1,
  updates: unknown[][] = [],
): Env {
  return {
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: row ? [row] : [] }),
          run: async () => {
            updates.push(args);
            return { meta: { changes: updateChanges } };
          },
        }),
      }),
    },
  } as unknown as Env;
}

const PAST = '2026-01-01T00:00:00.000Z';
const NOW = '2026-06-01T00:00:00.000Z';
const FUTURE = '2026-12-31T00:00:00.000Z';

describe('effectiveApprovalStatus', () => {
  it('keeps a pending link pending when expiry is in the future', () => {
    expect(effectiveApprovalStatus({ status: 'pending', expiresAt: FUTURE }, NOW)).toBe('pending');
  });

  it('keeps a pending link pending when there is no expiry', () => {
    expect(effectiveApprovalStatus({ status: 'pending', expiresAt: null }, NOW)).toBe('pending');
  });

  it('derives expired for a pending link past its expiry', () => {
    expect(effectiveApprovalStatus({ status: 'pending', expiresAt: PAST }, NOW)).toBe('expired');
  });

  it('leaves terminal statuses unchanged even past expiry', () => {
    expect(effectiveApprovalStatus({ status: 'approved', expiresAt: PAST }, NOW)).toBe('approved');
    expect(effectiveApprovalStatus({ status: 'rejected', expiresAt: PAST }, NOW)).toBe('rejected');
    expect(effectiveApprovalStatus({ status: 'revoked', expiresAt: PAST }, NOW)).toBe('revoked');
  });
});

describe('applyApprovalAction', () => {
  const pending: ApprovalLinkState = { status: 'pending', expiresAt: FUTURE };

  it('approves a pending link', () => {
    expect(applyApprovalAction(pending, 'approve', NOW)).toEqual({ ok: true, next: 'approved' });
  });

  it('rejects a pending link', () => {
    expect(applyApprovalAction(pending, 'reject', NOW)).toEqual({ ok: true, next: 'rejected' });
  });

  it('revokes a pending link', () => {
    expect(applyApprovalAction(pending, 'revoke', NOW)).toEqual({ ok: true, next: 'revoked' });
  });

  it('refuses to act on an expired link', () => {
    const res = applyApprovalAction({ status: 'pending', expiresAt: PAST }, 'approve', NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('expired');
  });

  it('refuses to re-decide an already-approved link', () => {
    const res = applyApprovalAction({ status: 'approved', expiresAt: null }, 'approve', NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('approved');
  });

  it('refuses to act on a rejected or revoked link', () => {
    expect(applyApprovalAction({ status: 'rejected', expiresAt: null }, 'reject', NOW).ok).toBe(false);
    expect(applyApprovalAction({ status: 'revoked', expiresAt: null }, 'revoke', NOW).ok).toBe(false);
  });
});

describe('recordReviewDecision', () => {
  it('approves a pending, unexpired review and writes decision', async () => {
    const updates: unknown[][] = [];
    const env = mockEnv({ decision: null, expires_at: FUTURE }, 1, updates);
    const res = await recordReviewDecision(env, 'rev1', 'approve', NOW);
    expect(res).toEqual({ ok: true, status: 'approved' });
    expect(updates[0]?.[0]).toBe('approved'); // UPDATE binds [next, id]
    expect(updates[0]?.[1]).toBe('rev1');
  });

  it('returns not_found for a missing review', async () => {
    const res = await recordReviewDecision(mockEnv(null), 'rev1', 'approve', NOW);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('refuses an already-decided review (state machine)', async () => {
    const res = await recordReviewDecision(mockEnv({ decision: 'approved', expires_at: FUTURE }), 'rev1', 'reject', NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('approved');
  });

  it('refuses an expired pending review', async () => {
    const res = await recordReviewDecision(mockEnv({ decision: null, expires_at: PAST }), 'rev1', 'approve', NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('expired');
  });

  it('treats a 0-row UPDATE as a race (already_decided)', async () => {
    const env = mockEnv({ decision: null, expires_at: FUTURE }, 0);
    const res = await recordReviewDecision(env, 'rev1', 'approve', NOW);
    expect(res).toEqual({ ok: false, error: 'already_decided' });
  });
});

describe('getReviewLink', () => {
  function rowEnv(row: Record<string, unknown> | null): Env {
    return {
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: row ? [row] : [] }) }) }) },
    } as unknown as Env;
  }

  it('returns the review row when found', async () => {
    const row = { id: 'r1', site_id: 's1', agency_org_id: 'o1', decision: null, expires_at: FUTURE };
    expect(await getReviewLink(rowEnv(row), 'r1')).toEqual(row);
  });

  it('returns null when not found', async () => {
    expect(await getReviewLink(rowEnv(null), 'missing')).toBeNull();
  });
});

describe('createReviewLink', () => {
  const nowMs = Date.parse(NOW);

  it('inserts an org+site-scoped token and returns the link (default 7d ttl, injected clock)', async () => {
    const inserts: unknown[][] = [];
    const env = mockEnv(null, 1, inserts);
    const res = await createReviewLink(env, 'org-1', 'site-1', { nowMs });

    const expectedExpiry = new Date(nowMs + DEFAULT_REVIEW_TTL_MS).toISOString();
    expect(res.ok).toBe(true);
    expect(res.expiresAt).toBe(expectedExpiry);
    expect(res.url).toBe(`/review/${res.id}`);
    // INSERT binds [id, site_id, agency_org_id, token_hash, expires_at] — org/site scoped.
    expect(inserts[0]?.[1]).toBe('site-1');
    expect(inserts[0]?.[2]).toBe('org-1');
    expect(inserts[0]?.[4]).toBe(expectedExpiry);
    expect(typeof inserts[0]?.[0]).toBe('string'); // id (bearer)
    expect((inserts[0]?.[3] as string).length).toBe(64); // sha-256 hex token_hash
  });

  it('respects a custom ttlMs', async () => {
    const res = await createReviewLink(mockEnv(null, 1), 'o', 's', { nowMs, ttlMs: 3_600_000 });
    expect(res.expiresAt).toBe(new Date(nowMs + 3_600_000).toISOString());
  });

  it('returns ok:false with the error when the insert fails', async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('UNIQUE constraint'); } }) }) },
    } as unknown as Env;
    const res = await createReviewLink(env, 'o', 's', { nowMs });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('UNIQUE');
  });
});

describe('listReviewLinks', () => {
  function listEnv(rows: unknown[]): { env: Env; captured: { args: unknown[] } } {
    const captured = { args: [] as unknown[] };
    const env = {
      DB: {
        prepare: () => ({
          bind: (...args: unknown[]) => {
            captured.args = args;
            return { all: async () => ({ results: rows }) };
          },
        }),
      },
    } as unknown as Env;
    return { env, captured };
  }

  it('maps rows and derives effective status (org+site scoped, injected clock)', async () => {
    const { env, captured } = listEnv([
      { id: 'a', decision: null, expires_at: FUTURE, used_at: null }, // pending, not expired
      { id: 'b', decision: null, expires_at: PAST, used_at: null }, // pending, past expiry → expired
      { id: 'c', decision: 'approved', expires_at: PAST, used_at: NOW }, // terminal → unchanged
    ]);
    const rows = await listReviewLinks(env, 'org-1', 'site-1', NOW);

    expect(rows).toEqual([
      { id: 'a', status: 'pending', url: '/review/a', expiresAt: FUTURE, usedAt: null },
      { id: 'b', status: 'expired', url: '/review/b', expiresAt: PAST, usedAt: null },
      { id: 'c', status: 'approved', url: '/review/c', expiresAt: PAST, usedAt: NOW },
    ]);
    expect(captured.args).toEqual(['org-1', 'site-1']);
  });

  it('returns [] when the site has no links', async () => {
    const { env } = listEnv([]);
    expect(await listReviewLinks(env, 'o', 's', NOW)).toEqual([]);
  });
});
