/**
 * Stage 4.1 — buildFunctionsEnv: the scoped-env shim every user handler receives.
 *
 * Parses the deploy-time `__PS_SECRETS_JSON` binding into a frozen `env.SECRETS`,
 * STRIPS internal `__PS_*` bindings so they never reach user code (the seam the
 * later env.KV/R2/AI/DATA shims plug into), and passes the rest through. Fail-soft
 * on a malformed/absent/non-object blob (→ empty SECRETS, never a throw). Pure — no I/O.
 */
import { buildFunctionsEnv, makeScopedKV } from '../runtime.js';

/** A recording KV backing — captures the (prefixed) keys the facade forwards. */
function fakeKv() {
  const calls: [string, ...unknown[]][] = [];
  return {
    calls,
    get: async (k: string) => {
      calls.push(['get', k]);
      return `got:${k}`;
    },
    getWithMetadata: async (k: string) => {
      calls.push(['gwm', k]);
      return { value: null, metadata: null };
    },
    put: async (k: string, v: unknown) => {
      calls.push(['put', k, v]);
    },
    delete: async (k: string) => {
      calls.push(['delete', k]);
    },
    list: async (opts: { prefix?: string } = {}) => {
      calls.push(['list', opts]);
      const p = opts.prefix ?? '';
      return { keys: [{ name: `${p}alpha` }, { name: `${p}beta` }], list_complete: true };
    },
  };
}

describe('buildFunctionsEnv', () => {
  it('parses __PS_SECRETS_JSON into env.SECRETS', () => {
    const env = buildFunctionsEnv({
      __PS_SECRETS_JSON: JSON.stringify({ API_KEY: 'x', TOKEN: 'y' }),
    });
    expect(env.SECRETS).toEqual({ API_KEY: 'x', TOKEN: 'y' });
  });

  it('strips internal __PS_* bindings (they never reach user code)', () => {
    const env = buildFunctionsEnv({ __PS_SECRETS_JSON: '{"K":"v"}', PUBLIC_VAR: 'ok' });
    expect(env.__PS_SECRETS_JSON).toBeUndefined();
    expect(env.PUBLIC_VAR).toBe('ok');
  });

  it('freezes env.SECRETS (user code cannot mutate it)', () => {
    const env = buildFunctionsEnv({ __PS_SECRETS_JSON: '{"K":"v"}' });
    expect(Object.isFrozen(env.SECRETS)).toBe(true);
  });

  it('yields an empty SECRETS when the binding is absent', () => {
    expect(buildFunctionsEnv({ SOME: 'thing' }).SECRETS).toEqual({});
  });

  it('fail-soft: a malformed blob yields empty SECRETS, never throws', () => {
    expect(buildFunctionsEnv({ __PS_SECRETS_JSON: 'not json {' }).SECRETS).toEqual({});
  });

  it('ignores a non-object JSON blob (array / primitive → empty SECRETS)', () => {
    expect(buildFunctionsEnv({ __PS_SECRETS_JSON: '[1,2,3]' }).SECRETS).toEqual({});
    expect(buildFunctionsEnv({ __PS_SECRETS_JSON: '"str"' }).SECRETS).toEqual({});
  });

  it('tolerates a non-object env (null / undefined → { SECRETS: {} })', () => {
    expect(buildFunctionsEnv(null).SECRETS).toEqual({});
    expect(buildFunctionsEnv(undefined).SECRETS).toEqual({});
  });

  it('passes non-internal bindings through unchanged (env.KV shim lands below)', () => {
    const kv = { get: () => undefined };
    const env = buildFunctionsEnv({ MY_KV: kv, __PS_SECRETS_JSON: '{}' });
    expect(env.MY_KV).toBe(kv);
  });

  // ── Stage 4.1(b) — env.KV wiring ──
  it('exposes a SITE-SCOPED env.KV when __PS_KV + __PS_SITE_ID are present', async () => {
    const kv = fakeKv();
    const env = buildFunctionsEnv({ __PS_KV: kv, __PS_SITE_ID: 'abc' });
    expect(env.KV).toBeDefined();
    await (env.KV as { get: (k: string) => Promise<unknown> }).get('theme');
    expect(kv.calls.at(-1)).toEqual(['get', 'site:abc:theme']); // scoped to the site
    // the raw internal bindings never reach user code
    expect(env.__PS_KV).toBeUndefined();
    expect(env.__PS_SITE_ID).toBeUndefined();
  });

  it('no env.KV when __PS_KV is present but __PS_SITE_ID is missing (no isolation boundary)', () => {
    expect(buildFunctionsEnv({ __PS_KV: fakeKv() }).KV).toBeUndefined();
  });

  it('no env.KV when the KV binding is absent', () => {
    expect(buildFunctionsEnv({ __PS_SITE_ID: 'abc' }).KV).toBeUndefined();
  });
});

describe('makeScopedKV (Stage 4.1b — per-site key isolation)', () => {
  it('prefixes get/put/delete/getWithMetadata with site:<siteId>:', async () => {
    const kv = fakeKv();
    const scoped = makeScopedKV(kv, 'abc');
    await scoped.get('theme');
    await scoped.put('theme', 'dark');
    await scoped.delete('theme');
    await scoped.getWithMetadata('theme');
    expect(kv.calls).toEqual([
      ['get', 'site:abc:theme'],
      ['put', 'site:abc:theme', 'dark'],
      ['delete', 'site:abc:theme'],
      ['gwm', 'site:abc:theme'],
    ]);
  });

  it('list scopes to the site prefix AND strips it from returned key names', async () => {
    const kv = fakeKv();
    const res = await makeScopedKV(kv, 'abc').list({ prefix: 'cfg/' });
    expect(kv.calls.at(-1)).toEqual(['list', { prefix: 'site:abc:cfg/' }]);
    expect(res.keys.map((k) => k.name)).toEqual(['cfg/alpha', 'cfg/beta']);
  });

  it('two sites get DISJOINT prefixes (no cross-tenant key access)', async () => {
    const kv = fakeKv();
    await makeScopedKV(kv, 'siteA').get('k');
    await makeScopedKV(kv, 'siteB').get('k');
    expect(kv.calls).toEqual([
      ['get', 'site:siteA:k'],
      ['get', 'site:siteB:k'],
    ]);
  });
});
