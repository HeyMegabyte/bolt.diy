import {
  planBulkOperation,
  executeBulkArchive,
  executeBulkSetFlag,
  MAX_BULK_SITES,
  type BulkSiteRef,
} from '../services/bulk_site_ops.js';
import type { Env } from '../types/env.js';

/** Minimal D1 mock: maps each site id to the `changes` its UPDATE returns; throwIds error. */
function mockEnv(changesById: Record<string, number>, throwIds: string[] = []): Env {
  return {
    DB: {
      prepare: (_sql: string) => ({
        bind: (id: string, _orgId: string) => ({
          run: async () => {
            if (throwIds.includes(id)) throw new Error('db down');
            return { meta: { changes: changesById[id] ?? 0 } };
          },
        }),
      }),
    },
  } as unknown as Env;
}

describe('bulk_site_ops planner', () => {
  const owned: BulkSiteRef[] = [
    { id: 'pub1', status: 'published' },
    { id: 'pub2', status: 'published' },
    { id: 'draft1', status: 'draft' },
    { id: 'err1', status: 'error' },
    { id: 'arch1', status: 'archived' },
  ];

  it('set_flag: eligible for all owned non-archived sites; archived skipped', () => {
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: ['pub1', 'draft1', 'err1', 'arch1'],
      ownedSites: owned,
    });
    expect(plan.eligible.sort()).toEqual(['draft1', 'err1', 'pub1']);
    expect(plan.skipped).toEqual([{ id: 'arch1', reason: 'archived' }]);
    expect(plan.cappedAt).toBeNull();
  });

  it('never acts on a site the caller does not own (cross-tenant guard)', () => {
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: ['pub1', 'someone-elses-site'],
      ownedSites: owned,
    });
    expect(plan.eligible).toEqual(['pub1']);
    expect(plan.skipped).toEqual([{ id: 'someone-elses-site', reason: 'not_owned' }]);
  });

  it('republish: only published sites are eligible; others → not_publishable', () => {
    const plan = planBulkOperation({
      operation: 'republish',
      requestedSiteIds: ['pub1', 'pub2', 'draft1', 'err1'],
      ownedSites: owned,
    });
    expect(plan.eligible.sort()).toEqual(['pub1', 'pub2']);
    expect(plan.skipped.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'draft1', reason: 'not_publishable' },
      { id: 'err1', reason: 'not_publishable' },
    ]);
  });

  it('archive: non-archived eligible; an already-archived site → already_archived', () => {
    const plan = planBulkOperation({
      operation: 'archive',
      requestedSiteIds: ['pub1', 'draft1', 'arch1'],
      ownedSites: owned,
    });
    expect(plan.eligible.sort()).toEqual(['draft1', 'pub1']);
    expect(plan.skipped).toEqual([{ id: 'arch1', reason: 'already_archived' }]);
  });

  it('dedupes repeated site ids', () => {
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: ['pub1', 'pub1', 'pub1'],
      ownedSites: owned,
    });
    expect(plan.eligible).toEqual(['pub1']);
    expect(plan.skipped).toEqual([]);
  });

  it('caps the batch at MAX_BULK_SITES and skips the overflow with a reason', () => {
    const many: BulkSiteRef[] = Array.from({ length: MAX_BULK_SITES + 5 }, (_, i) => ({
      id: `s${i}`,
      status: 'published',
    }));
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: many.map((s) => s.id),
      ownedSites: many,
    });
    expect(plan.eligible.length).toBe(MAX_BULK_SITES);
    expect(plan.cappedAt).toBe(MAX_BULK_SITES);
    expect(plan.skipped.length).toBe(5);
    expect(plan.skipped.every((s) => s.reason === 'batch_cap_exceeded')).toBe(true);
  });

  it('returns empty plan for empty request (route should 400 upstream)', () => {
    const plan = planBulkOperation({ operation: 'set_flag', requestedSiteIds: [], ownedSites: owned });
    expect(plan.eligible).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});

describe('executeBulkArchive', () => {
  it('archives sites whose UPDATE changed a row', async () => {
    const env = mockEnv({ a: 1, b: 1 });
    const res = await executeBulkArchive(env, 'org1', ['a', 'b']);
    expect(res.archived.sort()).toEqual(['a', 'b']);
    expect(res.failed).toEqual([]);
  });

  it('reports no_match when the scoped UPDATE matched no row (raced delete / wrong org)', async () => {
    const env = mockEnv({ a: 1, b: 0 });
    const res = await executeBulkArchive(env, 'org1', ['a', 'b']);
    expect(res.archived).toEqual(['a']);
    expect(res.failed).toEqual([{ id: 'b', error: 'no_match' }]);
  });

  it('captures a DB error per id without aborting the batch', async () => {
    const env = mockEnv({ a: 1, c: 1 }, ['b']);
    const res = await executeBulkArchive(env, 'org1', ['a', 'b', 'c']);
    expect(res.archived.sort()).toEqual(['a', 'c']);
    expect(res.failed.length).toBe(1);
    expect(res.failed[0]?.id).toBe('b');
  });

  it('is a no-op for an empty eligible set', async () => {
    const res = await executeBulkArchive(mockEnv({}), 'org1', []);
    expect(res).toEqual({ archived: [], failed: [] });
  });
});

describe('executeBulkSetFlag', () => {
  /** Capturing D1 mock: records each upsert's bind args; throws for ids in throwScopeIds (3rd bind arg). */
  function mockFlagEnv(captured: unknown[][], throwScopeIds: string[] = []): Env {
    return {
      DB: {
        prepare: (_sql: string) => ({
          bind: (...args: unknown[]) => ({
            run: async () => {
              captured.push(args);
              if (throwScopeIds.includes(args[2] as string)) throw new Error('db down');
              return { meta: { changes: 1 } };
            },
          }),
        }),
      },
    } as unknown as Env;
  }

  it('writes a tenant-scoped {enabled} override per eligible site to flag_overrides', async () => {
    const captured: unknown[][] = [];
    const res = await executeBulkSetFlag(mockFlagEnv(captured), ['a', 'b'], 'review_synthesis', true, 'user1');
    expect(res.set.sort()).toEqual(['a', 'b']);
    expect(res.failed).toEqual([]);
    // bind order: id, scope, scope_id, flag_key, value_json, set_by, ...
    expect(captured[0]?.[1]).toBe('tenant');
    expect(captured[0]?.[2]).toBe('a');
    expect(captured[0]?.[3]).toBe('review_synthesis');
    expect(JSON.parse(captured[0]?.[4] as string)).toEqual({ enabled: true });
    expect(captured[0]?.[5]).toBe('user1');
  });

  it('serializes enabled:false correctly', async () => {
    const captured: unknown[][] = [];
    await executeBulkSetFlag(mockFlagEnv(captured), ['a'], 'seo_autopilot', false, null);
    expect(JSON.parse(captured[0]?.[4] as string)).toEqual({ enabled: false });
    expect(captured[0]?.[5]).toBeNull();
  });

  it('captures a DB error per id without aborting the rest', async () => {
    const captured: unknown[][] = [];
    const res = await executeBulkSetFlag(mockFlagEnv(captured, ['b']), ['a', 'b', 'c'], 'review_synthesis', true, 'u');
    expect(res.set.sort()).toEqual(['a', 'c']);
    expect(res.failed.map((f) => f.id)).toEqual(['b']);
  });

  it('is a no-op for an empty eligible set', async () => {
    const captured: unknown[][] = [];
    const res = await executeBulkSetFlag(mockFlagEnv(captured), [], 'review_synthesis', true, 'u');
    expect(res).toEqual({ set: [], failed: [] });
    expect(captured.length).toBe(0);
  });
});
