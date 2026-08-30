/**
 * Stage 4.1 — buildFunctionsEnv: the scoped-env shim every user handler receives.
 *
 * Parses the deploy-time `__PS_SECRETS_JSON` binding into a frozen `env.SECRETS`,
 * STRIPS internal `__PS_*` bindings so they never reach user code (the seam the
 * later env.KV/R2/AI/DATA shims plug into), and passes the rest through. Fail-soft
 * on a malformed/absent/non-object blob (→ empty SECRETS, never a throw). Pure — no I/O.
 */
import { buildFunctionsEnv, makeScopedKV, makeScopedR2, makeScopedAI } from '../runtime.js';

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

/** A recording R2 backing — captures the (prefixed) object keys the facade forwards. */
function fakeR2() {
  const calls: [string, ...unknown[]][] = [];
  return {
    calls,
    get: async (k: string) => {
      calls.push(['get', k]);
      return { key: k, body: 'x' };
    },
    put: async (k: string, v: unknown) => {
      calls.push(['put', k, v]);
      return { key: k };
    },
    head: async (k: string) => {
      calls.push(['head', k]);
      return { key: k };
    },
    delete: async (keys: string | string[]) => {
      calls.push(['delete', keys]);
    },
    list: async (opts: { prefix?: string } = {}) => {
      calls.push(['list', opts]);
      const p = opts.prefix ?? '';
      return {
        objects: [
          { key: `${p}a.json`, size: 1 },
          { key: `${p}b.json`, size: 2 },
        ],
        truncated: false,
        delimitedPrefixes: [`${p}sub/`],
      };
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

  // ── Stage 4.1(c) — env.R2 wiring ──
  it('exposes a SITE-SCOPED env.R2 when __PS_R2 + __PS_SITE_ID are present', async () => {
    const r2 = fakeR2();
    const env = buildFunctionsEnv({ __PS_R2: r2, __PS_SITE_ID: 'abc' });
    expect(env.R2).toBeDefined();
    await (env.R2 as { put: (k: string, v: unknown) => Promise<unknown> }).put('f.json', 'b');
    expect(r2.calls.at(-1)).toEqual(['put', 'sites-data/abc/f.json', 'b']); // scoped to the site
    expect(env.__PS_R2).toBeUndefined(); // raw binding stripped from user env
  });

  it('no env.R2 when __PS_R2 is present but __PS_SITE_ID is missing', () => {
    expect(buildFunctionsEnv({ __PS_R2: fakeR2() }).R2).toBeUndefined();
  });

  it('no env.R2 when the R2 binding is absent', () => {
    expect(buildFunctionsEnv({ __PS_SITE_ID: 'abc' }).R2).toBeUndefined();
  });

  // ── Stage 4.1(d) — env.AI wiring ──
  it('exposes env.AI when __PS_FN_TOKEN + __PS_FN_URL are present', () => {
    const env = buildFunctionsEnv({ __PS_FN_TOKEN: 'abc.sig', __PS_FN_URL: 'https://p.test' });
    expect(env.AI).toBeDefined();
    expect(typeof (env.AI as { run: unknown }).run).toBe('function');
    expect(env.__PS_FN_TOKEN).toBeUndefined(); // internal bindings stripped
    expect(env.__PS_FN_URL).toBeUndefined();
  });

  it('no env.AI when the token or the url is missing', () => {
    expect(buildFunctionsEnv({ __PS_FN_TOKEN: 'abc.sig' }).AI).toBeUndefined();
    expect(buildFunctionsEnv({ __PS_FN_URL: 'https://p.test' }).AI).toBeUndefined();
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

describe('makeScopedR2 (Stage 4.1c — per-site object isolation)', () => {
  it('prefixes get/put/head with sites-data/<siteId>/', async () => {
    const r2 = fakeR2();
    const s = makeScopedR2(r2, 'abc');
    await s.get('report.json');
    await s.put('report.json', 'body');
    await s.head('report.json');
    expect(r2.calls).toEqual([
      ['get', 'sites-data/abc/report.json'],
      ['put', 'sites-data/abc/report.json', 'body'],
      ['head', 'sites-data/abc/report.json'],
    ]);
  });

  it('delete prefixes a single key AND maps an array of keys', async () => {
    const r2 = fakeR2();
    const s = makeScopedR2(r2, 'abc');
    await s.delete('one.txt');
    await s.delete(['a.txt', 'b.txt']);
    expect(r2.calls).toEqual([
      ['delete', 'sites-data/abc/one.txt'],
      ['delete', ['sites-data/abc/a.txt', 'sites-data/abc/b.txt']],
    ]);
  });

  it('list scopes to the site prefix AND strips it from object keys + delimitedPrefixes', async () => {
    const r2 = fakeR2();
    const res = await makeScopedR2(r2, 'abc').list({ prefix: 'cfg/' });
    expect(r2.calls.at(-1)).toEqual(['list', { prefix: 'sites-data/abc/cfg/' }]);
    expect(res.objects.map((o) => o.key)).toEqual(['cfg/a.json', 'cfg/b.json']);
    expect(res.delimitedPrefixes).toEqual(['cfg/sub/']);
  });

  it('two sites get DISJOINT object prefixes (no cross-tenant access)', async () => {
    const r2 = fakeR2();
    await makeScopedR2(r2, 'siteA').get('k');
    await makeScopedR2(r2, 'siteB').get('k');
    expect(r2.calls).toEqual([
      ['get', 'sites-data/siteA/k'],
      ['get', 'sites-data/siteB/k'],
    ]);
  });
});

describe('makeScopedAI (Stage 4.1d — metered debit-then-call)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('POSTs /api/_ps/ai/run with the Bearer token + returns the result', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ result: { text: 'ok' }, credits_remaining: 4 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = await makeScopedAI('site-abc.sig', 'https://p.test').run('@cf/x', { prompt: 'hi' });
    expect(out).toEqual({ text: 'ok' });
    expect(calls[0][0]).toBe('https://p.test/api/_ps/ai/run');
    const init = calls[0][1]!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer site-abc.sig');
    expect(JSON.parse(init.body as string)).toEqual({ model: '@cf/x', inputs: { prompt: 'hi' } });
  });

  it('throws the platform error message on a non-2xx (e.g. 402 out of credits)', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'AI credits exhausted' } }), {
        status: 402,
      })) as unknown as typeof fetch;
    await expect(makeScopedAI('t', 'https://p.test').run('@cf/x')).rejects.toThrow(
      'AI credits exhausted',
    );
  });
});
