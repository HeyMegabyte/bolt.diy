/**
 * Unit coverage for services/snapshot_restore — restoreSnapshot re-points a
 * site's `current_build_version` to a named snapshot's frozen build, the clean
 * fix for the broken git-`commit_id` revert contract (the D1 `site_snapshots`
 * timeline and the R2-git subsystem are disjoint; see
 * memory/unfinished-features-plan.md). Reversible (the old version's R2 files
 * remain), org-scoped (no cross-tenant restore), and never throws.
 *
 * db + audit mocked; R2/KV are plain jest fns. No real APIs.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbUpdate: jest.fn(),
}));
jest.mock('../services/audit.js', () => ({ writeAuditLog: jest.fn() }));

import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import * as audit from '../services/audit.js';
import { restoreSnapshot } from '../services/snapshot_restore.js';
import type { Env } from '../types/env.js';

const mQuery = dbQuery as unknown as jest.Mock;
const mQueryOne = dbQueryOne as unknown as jest.Mock;
const mUpdate = dbUpdate as unknown as jest.Mock;
const mAudit = audit.writeAuditLog as unknown as jest.Mock;
const mHead = jest.fn();
const mKvDelete = jest.fn();

const env = {
  DB: {},
  SITES_BUCKET: { head: mHead },
  CACHE_KV: { delete: mKvDelete },
} as unknown as Env;

const params = {
  siteId: 'site-1',
  orgId: 'org-1',
  snapshotId: 'snap-1',
  userId: 'user-1',
  requestId: 'req-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mQueryOne.mockResolvedValue({ build_version: 'v9', slug: 'acme' });
  mQuery.mockResolvedValue({ data: [] }); // no custom hostnames by default
  mUpdate.mockResolvedValue({});
  mHead.mockResolvedValue({}); // R2 build exists
  mKvDelete.mockResolvedValue(undefined);
  mAudit.mockResolvedValue(undefined);
});

describe('restoreSnapshot', () => {
  it('re-points current_build_version, purges KV, audit-logs, and succeeds', async () => {
    const res = await restoreSnapshot(env, params);

    expect(res.ok).toBe(true);
    expect(res.version).toBe('v9');
    expect(res.slug).toBe('acme');

    // Re-points the live build version on the sites row.
    const [, table, updates, where, whereParams] = mUpdate.mock.calls[0];
    expect(table).toBe('sites');
    expect(updates).toMatchObject({ current_build_version: 'v9' });
    expect(where).toBe('id = ?');
    expect(whereParams).toEqual(['site-1']);

    // Purges the base host KV cache so serving picks up the new version.
    expect(mKvDelete.mock.calls.some((c) => String(c[0]).startsWith('host:acme'))).toBe(true);

    // Writes the restore audit row.
    const auditRow = mAudit.mock.calls[0][1];
    expect(auditRow.action).toBe('site.snapshot.restored');
    expect(auditRow.target_id).toBe('site-1');
    expect(auditRow.metadata_json).toMatchObject({ snapshot_id: 'snap-1', build_version: 'v9' });
  });

  it('verifies the snapshot build still exists in R2 before re-pointing', async () => {
    await restoreSnapshot(env, params);
    expect(mHead).toHaveBeenCalledWith('sites/acme/v9/index.html');
  });

  it('returns not-found (and does NOT mutate) when the snapshot is missing or cross-org', async () => {
    // The org-scoped JOIN returns null for a snapshot owned by another org.
    mQueryOne.mockResolvedValue(null);
    const res = await restoreSnapshot(env, params);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(mUpdate).not.toHaveBeenCalled();
    expect(mKvDelete).not.toHaveBeenCalled();
  });

  it('errors when the snapshot has no build_version', async () => {
    mQueryOne.mockResolvedValue({ build_version: null, slug: 'acme' });
    const res = await restoreSnapshot(env, params);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/build/i);
    expect(mUpdate).not.toHaveBeenCalled();
  });

  it('errors when the snapshot build is gone from storage', async () => {
    mHead.mockResolvedValue(null);
    const res = await restoreSnapshot(env, params);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/storage/i);
    expect(mUpdate).not.toHaveBeenCalled();
  });

  it('also purges active custom hostnames', async () => {
    mQuery.mockResolvedValue({ data: [{ hostname: 'www.acme.com' }] });
    await restoreSnapshot(env, params);
    expect(mKvDelete.mock.calls.some((c) => c[0] === 'host:www.acme.com')).toBe(true);
  });
});
