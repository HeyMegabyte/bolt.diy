/**
 * Stage 4.1 — buildFunctionsEnv: the scoped-env shim every user handler receives.
 *
 * Parses the deploy-time `__PS_SECRETS_JSON` binding into a frozen `env.SECRETS`,
 * STRIPS internal `__PS_*` bindings so they never reach user code (the seam the
 * later env.KV/R2/AI/DATA shims plug into), and passes the rest through. Fail-soft
 * on a malformed/absent/non-object blob (→ empty SECRETS, never a throw). Pure — no I/O.
 */
import {
  buildFunctionsEnv,
  makeScopedKV,
  makeScopedR2,
  makeScopedAI,
  makeScopedData,
  makeCtxAuthHelpers,
  extractSessionToken,
} from '../runtime.js';

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

  // ── Stage 4.1(d/e) — env.AI + env.DATA wiring (same token + service binding) ──
  it('exposes env.AI AND env.DATA when __PS_FN_TOKEN + __PS_SVC are present', () => {
    const svc = { fetch: async () => new Response('{}') };
    const env = buildFunctionsEnv({ __PS_FN_TOKEN: 'abc.sig', __PS_SVC: svc });
    expect(env.AI).toBeDefined();
    expect(typeof (env.AI as { run: unknown }).run).toBe('function');
    expect(env.DATA).toBeDefined();
    expect(typeof (env.DATA as { site: unknown }).site).toBe('function');
    expect(typeof (env.DATA as { forms: { list: unknown } }).forms.list).toBe('function');
    expect(env.__PS_FN_TOKEN).toBeUndefined(); // internal bindings stripped
    expect(env.__PS_SVC).toBeUndefined();
  });

  it('no env.AI/env.DATA when the token or the service binding is missing', () => {
    expect(buildFunctionsEnv({ __PS_FN_TOKEN: 'abc.sig' }).AI).toBeUndefined();
    expect(buildFunctionsEnv({ __PS_FN_TOKEN: 'abc.sig' }).DATA).toBeUndefined();
    const svcOnly = buildFunctionsEnv({ __PS_SVC: { fetch: async () => new Response('{}') } });
    expect(svcOnly.AI).toBeUndefined();
    expect(svcOnly.DATA).toBeUndefined();
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

describe('makeScopedAI (Stage 4.1d — metered debit-then-call over a service binding)', () => {
  it('calls the service binding /api/_ps/ai/run with the Bearer token + returns result', async () => {
    const reqs: Request[] = [];
    const svc = {
      fetch: async (req: Request) => {
        reqs.push(req);
        return new Response(JSON.stringify({ result: { text: 'ok' }, credits_remaining: 4 }), {
          status: 200,
        });
      },
    };
    const out = await makeScopedAI('site-abc.sig', svc).run('@cf/x', { prompt: 'hi' });
    expect(out).toEqual({ text: 'ok' });
    const req = reqs[0];
    expect(new URL(req.url).pathname).toBe('/api/_ps/ai/run');
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toBe('Bearer site-abc.sig');
    expect(await req.json()).toEqual({ model: '@cf/x', inputs: { prompt: 'hi' } });
  });

  it('throws the platform error message on a non-2xx (e.g. 402 out of credits)', async () => {
    const svc = {
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'AI credits exhausted' } }), {
          status: 402,
        }),
    };
    await expect(makeScopedAI('t', svc).run('@cf/x')).rejects.toThrow('AI credits exhausted');
  });
});

describe('makeScopedData (Stage 4.1e — read-only tenant-scoped data over a service binding)', () => {
  function recordingSvc(body: unknown, status = 200) {
    const reqs: Request[] = [];
    const svc = {
      fetch: async (req: Request) => {
        reqs.push(req);
        return new Response(JSON.stringify(body), { status });
      },
    };
    return { svc, reqs };
  }

  it('forms.list GETs /api/_ps/data/forms with the Bearer token + clamped limit, returns items', async () => {
    const { svc, reqs } = recordingSvc({ items: [{ id: 'f1' }, { id: 'f2' }] });
    const out = await makeScopedData('site-abc.sig', svc).forms.list({ limit: 9999 });
    expect(out).toEqual([{ id: 'f1' }, { id: 'f2' }]);
    const url = new URL(reqs[0].url);
    expect(url.pathname).toBe('/api/_ps/data/forms');
    expect(url.searchParams.get('limit')).toBe('100'); // clamped
    expect(reqs[0].method).toBe('GET');
    expect(reqs[0].headers.get('authorization')).toBe('Bearer site-abc.sig');
  });

  it('forms.list defaults limit to 20 and tolerates a missing items array', async () => {
    const { svc, reqs } = recordingSvc({});
    const out = await makeScopedData('t', svc).forms.list();
    expect(out).toEqual([]);
    expect(new URL(reqs[0].url).searchParams.get('limit')).toBe('20');
  });

  it('site() GETs /api/_ps/data/site and returns the site object', async () => {
    const site = { id: 'site-abc', slug: 'ada-co' };
    const { svc, reqs } = recordingSvc({ site });
    const out = await makeScopedData('t', svc).site();
    expect(out).toEqual(site);
    expect(new URL(reqs[0].url).pathname).toBe('/api/_ps/data/site');
  });

  it('throws the platform error message on a non-2xx', async () => {
    const { svc } = recordingSvc({ error: { message: 'invalid function token' } }, 401);
    await expect(makeScopedData('t', svc).site()).rejects.toThrow('invalid function token');
  });
});

describe('extractSessionToken (Stage 4.2b)', () => {
  it('reads a Bearer token', () => {
    const r = new Request('https://x/a', { headers: { authorization: 'Bearer abc' } });
    expect(extractSessionToken(r)).toBe('abc');
  });
  it('reads a `session` cookie among others (url-decoded)', () => {
    const r = new Request('https://x/a', { headers: { cookie: 'foo=1; session=tok%20en; bar=2' } });
    expect(extractSessionToken(r)).toBe('tok en');
  });
  it('prefers Bearer over the cookie', () => {
    const r = new Request('https://x/a', {
      headers: { authorization: 'Bearer B', cookie: 'session=C' },
    });
    expect(extractSessionToken(r)).toBe('B');
  });
  it('is empty when neither is present', () => {
    expect(extractSessionToken(new Request('https://x/a'))).toBe('');
  });
});

describe('makeCtxAuthHelpers (Stage 4.2b — opt-in auth over the service binding)', () => {
  function recordingSvc(body: unknown) {
    const reqs: Request[] = [];
    const svc = {
      fetch: async (req: Request) => {
        reqs.push(req);
        return new Response(JSON.stringify(body), { status: 200 });
      },
    };
    return { svc, reqs };
  }

  it('verifyOwnerSession posts the request session token (Bearer) + maps the platform answer', async () => {
    const { svc, reqs } = recordingSvc({ authenticated: true, userId: 'u1', orgId: 'o1' });
    const request = new Request('https://x/api/p', {
      headers: { authorization: 'Bearer sess-123' },
    });
    const out = await makeCtxAuthHelpers('site.sig', svc, request).verifyOwnerSession();
    expect(out).toEqual({ authenticated: true, userId: 'u1', orgId: 'o1' });
    const req = reqs[0];
    expect(new URL(req.url).pathname).toBe('/api/_ps/auth/verify-session');
    expect(req.headers.get('authorization')).toBe('Bearer site.sig');
    expect(await req.json()).toEqual({ session_token: 'sess-123' });
  });

  it('verifyOwnerSession extracts the `session` cookie + maps a not-authenticated answer', async () => {
    const { svc, reqs } = recordingSvc({ authenticated: false });
    const request = new Request('https://x/api/p', {
      headers: { cookie: 'a=1; session=cook-9; b=2' },
    });
    const out = await makeCtxAuthHelpers('t', svc, request).verifyOwnerSession();
    expect(out).toEqual({ authenticated: false, userId: undefined, orgId: undefined });
    expect(await reqs[0].json()).toEqual({ session_token: 'cook-9' });
  });

  it('verifyTurnstile posts the token + client IP and maps success', async () => {
    const { svc, reqs } = recordingSvc({ success: true });
    const request = new Request('https://x/api/p', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    const out = await makeCtxAuthHelpers('t', svc, request).verifyTurnstile('ts-token');
    expect(out).toEqual({ success: true });
    expect(new URL(reqs[0].url).pathname).toBe('/api/_ps/turnstile/verify');
    expect(await reqs[0].json()).toEqual({ token: 'ts-token', remoteip: '203.0.113.7' });
  });

  it('fails CLOSED (authenticated:false / success:false) when the service binding throws', async () => {
    const svc = {
      fetch: async () => {
        throw new Error('boom');
      },
    };
    const request = new Request('https://x/api/p');
    expect(await makeCtxAuthHelpers('t', svc, request).verifyOwnerSession()).toEqual({
      authenticated: false,
      userId: undefined,
      orgId: undefined,
    });
    expect(await makeCtxAuthHelpers('t', svc, request).verifyTurnstile('x')).toEqual({
      success: false,
    });
  });
});
