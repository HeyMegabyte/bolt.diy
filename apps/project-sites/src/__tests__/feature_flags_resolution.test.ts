/**
 * Direct unit coverage for the feature-flag RESOLUTION ENGINE
 * (`src/modules/feature_flags/services.ts`) — the core of the whole flag system,
 * previously only exercised indirectly (other specs mock `isFlagOn`). Tests the
 * REAL functions against KV + D1 stubs:
 *
 *   resolveFlag         — unknown→fail-closed (no I/O), KV cache hit (no D1),
 *                         cache-miss→registry fallback (writes cache), and
 *                         override precedence tenant > org > global.
 *   isFlagOn            — disabled→false, rollout 100→true, 0→false,
 *                         partial→deterministic per scope hash.
 *   invalidateFlagCache — lists `flag:<key>:` + deletes every match
 *                         (the cache-bust contract the admin override-write path
 *                         must call; see UNFINISHED_FEATURES §11m).
 */

import {
  resolveFlag,
  isFlagOn,
  invalidateFlagCache,
  FLAG_REGISTRY,
} from '../modules/feature_flags/services.js';

type Opts = { cacheGet?: unknown; overrideRow?: unknown; listKeys?: string[] };

function makeEnv(opts: Opts = {}) {
  const puts: Array<{ key: string }> = [];
  const deletes: string[] = [];
  const prepares: string[] = [];
  let listPrefix = '';

  const stmt = {
    bind: () => stmt,
    first: async () => opts.overrideRow ?? null,
    run: async () => ({}),
    all: async () => ({ results: [] }),
  };
  const env = {
    CACHE_KV: {
      get: async () => opts.cacheGet ?? null,
      put: async (key: string) => {
        puts.push({ key });
      },
      list: async ({ prefix }: { prefix: string }) => {
        listPrefix = prefix;
        return { keys: (opts.listKeys ?? []).map((name) => ({ name })) };
      },
      delete: async (name: string) => {
        deletes.push(name);
      },
    },
    DB: { prepare: (sql: string) => (prepares.push(sql), stmt) },
  } as never;

  return { env, puts, deletes, prepares, getListPrefix: () => listPrefix };
}

const overrideRow = (v: Record<string, unknown>) => ({ value_json: JSON.stringify(v) });
// A guaranteed-registered flag to drive cache/override branches (resolveFlag
// short-circuits unknown keys BEFORE any cache/DB access).
const KNOWN = 'core_auth';

describe('resolveFlag', () => {
  it('fail-closes an unknown flag without touching KV or D1', async () => {
    const { env, prepares, puts } = makeEnv();
    const state = await resolveFlag(env, 'totally_unknown_flag_xyz', { siteId: 's1' });
    expect(state).toEqual({ enabled: false, rollout_percent: 0, stage: 'experimental', source: 'registry' });
    expect(prepares).toHaveLength(0); // no override lookups
    expect(puts).toHaveLength(0); // nothing cached
  });

  it('returns the cached state on a KV hit without hitting D1', async () => {
    const cached = { enabled: true, rollout_percent: 42, stage: 'beta', source: 'org' };
    const { env, prepares } = makeEnv({ cacheGet: cached });
    const state = await resolveFlag(env, KNOWN, { orgId: 'o1' });
    expect(state).toEqual(cached);
    expect(prepares).toHaveLength(0); // cache short-circuits the D1 override lookup
  });

  it('falls back to the registry default on a cache miss + writes the cache', async () => {
    const { env, puts } = makeEnv({ cacheGet: null, overrideRow: null });
    const state = await resolveFlag(env, KNOWN, {});
    const def = FLAG_REGISTRY[KNOWN];
    expect(state).toEqual({
      enabled: def.default_enabled,
      rollout_percent: def.default_rollout_percent,
      stage: def.stage,
      source: 'registry',
    });
    expect(puts.length).toBeGreaterThan(0); // result is cached for the hot path
  });

  it('lets a TENANT override win (source=tenant) over the registry default', async () => {
    const { env } = makeEnv({ overrideRow: overrideRow({ enabled: false, rollout_percent: 0, stage: 'killswitch' }) });
    const state = await resolveFlag(env, KNOWN, { siteId: 's1', orgId: 'o1' });
    expect(state.source).toBe('tenant');
    expect(state.enabled).toBe(false);
    expect(state.stage).toBe('killswitch');
  });

  it('applies an ORG override when no tenant scope is given', async () => {
    const { env } = makeEnv({ overrideRow: overrideRow({ enabled: true, rollout_percent: 25 }) });
    const state = await resolveFlag(env, KNOWN, { orgId: 'o1' });
    expect(state.source).toBe('org');
    expect(state.rollout_percent).toBe(25);
  });

  it('applies a GLOBAL override when no tenant/org scope is given', async () => {
    const { env } = makeEnv({ overrideRow: overrideRow({ enabled: true, rollout_percent: 10 }) });
    const state = await resolveFlag(env, KNOWN, {});
    expect(state.source).toBe('global');
  });
});

describe('isFlagOn (rollout gating)', () => {
  it('false when the resolved state is disabled', async () => {
    const { env } = makeEnv({ cacheGet: { enabled: false, rollout_percent: 100, stage: 'beta', source: 'global' } });
    expect(await isFlagOn(env, KNOWN, { userId: 'u1' })).toBe(false);
  });

  it('true at 100% rollout', async () => {
    const { env } = makeEnv({ cacheGet: { enabled: true, rollout_percent: 100, stage: 'stable', source: 'global' } });
    expect(await isFlagOn(env, KNOWN, { userId: 'u1' })).toBe(true);
  });

  it('false at 0% rollout even when enabled', async () => {
    const { env } = makeEnv({ cacheGet: { enabled: true, rollout_percent: 0, stage: 'beta', source: 'global' } });
    expect(await isFlagOn(env, KNOWN, { userId: 'u1' })).toBe(false);
  });

  it('is deterministic per scope at a partial rollout', async () => {
    const cacheGet = { enabled: true, rollout_percent: 50, stage: 'beta', source: 'global' };
    const a = await isFlagOn(makeEnv({ cacheGet }).env, KNOWN, { userId: 'stable-user' });
    const b = await isFlagOn(makeEnv({ cacheGet }).env, KNOWN, { userId: 'stable-user' });
    expect(typeof a).toBe('boolean');
    expect(a).toBe(b); // same user → same bucket → same answer
  });
});

describe('invalidateFlagCache', () => {
  it('lists the flag:<key>: prefix and deletes every matching cache entry', async () => {
    const { env, deletes, getListPrefix } = makeEnv({
      listKeys: ['flag:my_flag:s1:o1', 'flag:my_flag::', 'flag:my_flag::o2'],
    });
    await invalidateFlagCache(env, 'my_flag');
    expect(getListPrefix()).toBe('flag:my_flag:');
    expect(deletes).toEqual(['flag:my_flag:s1:o1', 'flag:my_flag::', 'flag:my_flag::o2']);
  });

  it('no-ops cleanly when nothing is cached', async () => {
    const { env, deletes } = makeEnv({ listKeys: [] });
    await expect(invalidateFlagCache(env, 'my_flag')).resolves.toBeUndefined();
    expect(deletes).toEqual([]);
  });
});
