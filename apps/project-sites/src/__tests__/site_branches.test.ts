/**
 * @module __tests__/site_branches
 * @description Unit tests for the branch-style site preview service (#27),
 * focused on the multi-tenant isolation fix: every branch-mutation function
 * scopes its lookup/update by `site_id` in addition to the branch `id`, so a
 * caller who owns site A can never act on a branch belonging to site B by
 * guessing a `branchId`. The route's `assertOwner` proves site ownership; these
 * tests prove the SQL itself enforces the branch↔site relationship.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null }),
}));

import { dbQueryOne, dbUpdate, dbInsert } from '../services/db.js';
import {
  requestReview,
  approveBranch,
  mergeBranch,
  closeBranch,
  listBranches,
  parseBranchHost,
} from '../services/site_branches.js';
import type { D1Database } from '@cloudflare/workers-types';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;

// approveBranch increments the counter via raw `db.prepare().bind().run()`,
// so the DB double needs a prepare chain (the db.js helpers are jest-mocked).
const DB = {
  prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }),
} as unknown as D1Database;
const SITE = 'site-a';
const BRANCH = 'branch-1';

function draftBranch(overrides: Record<string, unknown> = {}) {
  return {
    id: BRANCH,
    site_id: SITE,
    branch_name: 'feat-x',
    created_by: 'u1',
    status: 'draft',
    r2_path: 'sites/slug/branches/feat-x/',
    preview_url: 'https://feat-x--slug.projectsites.dev',
    approvals_required: 1,
    approvals_received: 0,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryOne.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
  mockInsert.mockResolvedValue({ error: null });
});

// ─── requestReview ────────────────────────────────────────────────────────────
describe('requestReview (tenant-scoped)', () => {
  it('scopes the branch lookup by BOTH id AND site_id', async () => {
    mockQueryOne.mockResolvedValueOnce(draftBranch() as never); // lookup
    mockQueryOne.mockResolvedValueOnce(draftBranch({ status: 'review' }) as never); // re-read
    await requestReview(DB, SITE, BRANCH);
    const [, sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain('site_id = ?');
    expect(params).toEqual([BRANCH, SITE]);
  });

  it('returns null for a branch owned by another site (cross-org blocked)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // foreign branch → no row
    expect(await requestReview(DB, 'other-site', BRANCH)).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled(); // never transitions a foreign branch
  });

  it('returns null when the branch is not in draft', async () => {
    mockQueryOne.mockResolvedValueOnce(draftBranch({ status: 'merged' }) as never);
    expect(await requestReview(DB, SITE, BRANCH)).toBeNull();
  });
});

// ─── approveBranch ──────────────────────────────────────────────────────────────
describe('approveBranch (tenant-scoped)', () => {
  it('scopes the branch lookup by id AND site_id', async () => {
    mockQueryOne
      .mockResolvedValueOnce(draftBranch({ status: 'review' }) as never) // lookup
      .mockResolvedValueOnce(null) // existing-approval check
      .mockResolvedValueOnce(draftBranch({ status: 'review', approvals_received: 1 }) as never); // re-read
    await approveBranch(DB, SITE, BRANCH, 'approver-1');
    const [, sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain('site_id = ?');
    expect(params).toEqual([BRANCH, SITE]);
  });

  it('returns null for a branch not owned by the site', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await approveBranch(DB, 'other-site', BRANCH, 'approver-1')).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('readyToMerge true once approvals_received >= approvals_required', async () => {
    mockQueryOne
      .mockResolvedValueOnce(draftBranch({ status: 'review' }) as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        draftBranch({ status: 'review', approvals_received: 1, approvals_required: 1 }) as never,
      );
    const result = await approveBranch(DB, SITE, BRANCH, 'approver-1');
    expect(result?.readyToMerge).toBe(true);
  });
});

// ─── mergeBranch ────────────────────────────────────────────────────────────────
describe('mergeBranch (tenant-scoped)', () => {
  it('scopes the branch lookup by id AND site_id', async () => {
    mockQueryOne
      .mockResolvedValueOnce(draftBranch({ status: 'review' }) as never) // lookup
      .mockResolvedValueOnce(draftBranch({ status: 'merged' }) as never); // re-read
    await mergeBranch(DB, SITE, BRANCH, 'v2');
    const [, sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain('site_id = ?');
    expect(params).toEqual([BRANCH, SITE]);
  });

  it('returns null for a foreign branch and never bumps a build version', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await mergeBranch(DB, 'other-site', BRANCH, 'v2')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ─── closeBranch ────────────────────────────────────────────────────────────────
describe('closeBranch (tenant-scoped)', () => {
  it('scopes BOTH the UPDATE and the re-read by site_id', async () => {
    mockQueryOne.mockResolvedValueOnce(draftBranch({ status: 'closed' }) as never);
    await closeBranch(DB, SITE, BRANCH);
    // dbUpdate(db, table, updates, whereClause, whereParams) → indices 3 + 4
    const [, , , updWhere, updParams] = mockUpdate.mock.calls[0]!;
    expect(updWhere).toBe('id = ? AND site_id = ?');
    expect(updParams).toEqual([BRANCH, SITE]);
    const [, readSql, readParams] = mockQueryOne.mock.calls[0]!;
    expect(readSql).toContain('site_id = ?');
    expect(readParams).toEqual([BRANCH, SITE]);
  });
});

// ─── listBranches ───────────────────────────────────────────────────────────────
describe('listBranches', () => {
  it('filters by site_id', async () => {
    const { dbQuery } = jest.requireMock('../services/db.js') as {
      dbQuery: jest.Mock;
    };
    dbQuery.mockResolvedValueOnce({ data: [draftBranch()], error: null });
    await listBranches(DB, SITE);
    const [, sql, params] = dbQuery.mock.calls[0]!;
    expect(sql).toContain('sb.site_id = ?');
    expect(params).toEqual([SITE]);
  });
});

// ─── parseBranchHost (pure) ──────────────────────────────────────────────────────
describe('parseBranchHost', () => {
  it('parses {branch}--{slug}.projectsites.dev', () => {
    expect(parseBranchHost('feat-x--vitos-salon.projectsites.dev')).toEqual({
      branchName: 'feat-x',
      slug: 'vitos-salon',
    });
  });

  it('returns null for a non-branch host', () => {
    expect(parseBranchHost('vitos-salon.projectsites.dev')).toBeNull();
    expect(parseBranchHost('example.com')).toBeNull();
  });
});
