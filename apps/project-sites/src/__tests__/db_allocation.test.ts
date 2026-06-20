/**
 * Per-site DB allocation — the order LAW + record build + KV cache/resolve
 * (Cloudflare-first doctrine §4/§5).
 */
import {
  chooseDbAllocation,
  hyperdriveBindingForShard,
  buildAllocation,
  cacheAllocation,
  resolveAllocation,
  type DbAllocationDecision,
} from '../services/db_allocation.js';
import type { Env } from '../types/env.js';

describe('chooseDbAllocation — the allocation LAW', () => {
  it('free plan gets no database', () => {
    expect(chooseDbAllocation({ plan: 'free' })).toEqual({ dbPlan: 'none', reason: 'free-plan' });
    // free overrides even a postgres/isolation request — a free site has no DB.
    expect(
      chooseDbAllocation({ plan: 'free', needsPostgres: true, needsIsolation: true }).dbPlan,
    ).toBe('none');
  });

  it('paid default is a per-tenant D1 database (Neon is the escape hatch)', () => {
    expect(chooseDbAllocation({ plan: 'paid' })).toEqual({
      dbPlan: 'd1_tenant_db',
      reason: 'd1-default',
    });
    expect(chooseDbAllocation({ plan: 'pro' }).dbPlan).toBe('d1_tenant_db');
  });

  it('Postgres-required (not isolated) → a shared Neon shard', () => {
    expect(chooseDbAllocation({ plan: 'pro', needsPostgres: true })).toEqual({
      dbPlan: 'neon_shared_shard',
      reason: 'postgres-required',
    });
  });

  it('isolation / enterprise / noisy-neighbour → a dedicated Neon project', () => {
    expect(chooseDbAllocation({ plan: 'paid', needsIsolation: true }).reason).toBe('isolation');
    expect(chooseDbAllocation({ plan: 'enterprise' })).toEqual({
      dbPlan: 'neon_dedicated_project',
      reason: 'enterprise',
    });
    expect(chooseDbAllocation({ plan: 'pro', noisyNeighbor: true }).dbPlan).toBe(
      'neon_dedicated_project',
    );
    // isolation beats a plain postgres request.
    expect(
      chooseDbAllocation({ plan: 'pro', needsPostgres: true, needsIsolation: true }).dbPlan,
    ).toBe('neon_dedicated_project');
  });
});

describe('hyperdriveBindingForShard', () => {
  it('derives a shard-level binding, never per-site', () => {
    expect(hyperdriveBindingForShard(0)).toBe('HYPERDRIVE_SHARD_0');
    expect(hyperdriveBindingForShard(12)).toBe('HYPERDRIVE_SHARD_12');
  });
});

describe('buildAllocation', () => {
  const dec = (
    d: DbAllocationDecision['dbPlan'],
    r: DbAllocationDecision['reason'],
  ): DbAllocationDecision => ({ dbPlan: d, reason: r });

  it('d1 + none rows carry no shard/binding/neon fields', () => {
    const rec = buildAllocation({
      tenantId: 't',
      siteId: 's',
      decision: dec('d1_tenant_db', 'd1-default'),
    });
    expect(rec).toMatchObject({
      dbPlan: 'd1_tenant_db',
      shardId: null,
      hyperdriveBindingName: null,
      neonProjectId: null,
    });
  });

  it('neon_shared_shard wires the shard id + the derived shard-level Hyperdrive binding', () => {
    const rec = buildAllocation({
      tenantId: 't',
      siteId: 's',
      decision: dec('neon_shared_shard', 'postgres-required'),
      shardIndex: 7,
      neonDatabase: 'app',
      neonSchema: 'public',
    });
    expect(rec).toMatchObject({
      shardId: '7',
      hyperdriveBindingName: 'HYPERDRIVE_SHARD_7',
      neonDatabase: 'app',
      neonSchema: 'public',
      neonProjectId: null,
    });
  });

  it('neon_dedicated_project carries the Neon project + db/schema', () => {
    const rec = buildAllocation({
      tenantId: 't',
      siteId: 's',
      decision: dec('neon_dedicated_project', 'enterprise'),
      neonProjectId: 'np-1',
      neonDatabase: 'app',
    });
    expect(rec).toMatchObject({
      neonProjectId: 'np-1',
      neonDatabase: 'app',
      shardId: null,
      hyperdriveBindingName: null,
    });
  });
});

describe('cacheAllocation + resolveAllocation', () => {
  function kvStub() {
    const store = new Map<string, string>();
    return {
      store,
      kv: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => {
          store.set(k, v);
        },
      } as unknown as Env['CACHE_KV'],
    };
  }

  it('caches by site id (+ hostname) and resolves by either', async () => {
    const { store, kv } = kvStub();
    const rec = buildAllocation({
      tenantId: 't',
      siteId: 's1',
      decision: { dbPlan: 'd1_tenant_db', reason: 'd1-default' },
    });
    await cacheAllocation({ CACHE_KV: kv }, rec, 'acme.projectsites.dev');
    expect(store.has('site-db:s1')).toBe(true);
    expect(store.has('hostname-db:acme.projectsites.dev')).toBe(true);

    expect(await resolveAllocation({ CACHE_KV: kv }, { siteId: 's1' })).toMatchObject({
      dbPlan: 'd1_tenant_db',
    });
    expect(
      await resolveAllocation({ CACHE_KV: kv }, { hostname: 'ACME.projectsites.dev' }),
    ).toMatchObject({ siteId: 's1' });
    expect(await resolveAllocation({ CACHE_KV: kv }, { siteId: 'missing' })).toBeNull();
  });
});
