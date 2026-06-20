/**
 * Convergence §29/ADR-0005 — OpenFgaAuthorizationProvider (REST adapter).
 *
 * Locks: check/write/delete/list-objects hit the right OpenFGA store endpoints
 * with the tuple shape + Bearer auth, check fails CLOSED on non-2xx/network, and
 * getAuthorizationProvider selects this adapter when OpenFGA is configured.
 */
import { OpenFgaAuthorizationProvider, type OpenFgaConfig } from '../services/openfga_provider.js';
import { getAuthorizationProvider } from '../middleware/authz.js';
import { DenyAllAuthorizationProvider } from '../platform/authorization.js';
import type { Env } from '../types/env.js';

const cfg: OpenFgaConfig = { apiUrl: 'https://authz.projectsites.dev', storeId: 'store1', authToken: 'tok' };

function fakeFetch(handler: (url: string, body: unknown) => { status: number; json?: unknown }) {
  const calls: { url: string; method: string; auth?: string; body: unknown }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url: String(url), method: init?.method ?? 'GET', auth: h.Authorization, body });
    const { status, json } = handler(String(url), body);
    return new Response(JSON.stringify(json ?? {}), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

describe('OpenFgaAuthorizationProvider', () => {
  it('check posts the tuple to /check with Bearer auth and returns allowed', async () => {
    const f = fakeFetch(() => ({ status: 200, json: { allowed: true } }));
    const p = new OpenFgaAuthorizationProvider(cfg, f);
    expect(await p.check({ user: 'user:1', relation: 'can_publish', object: 'site:a' })).toBe(true);
    expect(f.calls[0].url).toBe('https://authz.projectsites.dev/stores/store1/check');
    expect(f.calls[0].auth).toBe('Bearer tok');
    expect((f.calls[0].body as { tuple_key: { object: string } }).tuple_key.object).toBe('site:a');
  });

  it('check fails CLOSED on non-2xx and on network error', async () => {
    expect(await new OpenFgaAuthorizationProvider(cfg, fakeFetch(() => ({ status: 500 }))).check({ user: 'u', relation: 'r', object: 'o' })).toBe(false);
    const throwing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await new OpenFgaAuthorizationProvider(cfg, throwing).check({ user: 'u', relation: 'r', object: 'o' })).toBe(false);
  });

  it('write + delete post tuple_keys to /write', async () => {
    const f = fakeFetch(() => ({ status: 200 }));
    const p = new OpenFgaAuthorizationProvider(cfg, f);
    await p.writeRelationship({ user: 'user:1', relation: 'owner', object: 'site:a' });
    await p.deleteRelationship({ user: 'user:1', relation: 'owner', object: 'site:a' });
    expect(f.calls[0].url).toBe('https://authz.projectsites.dev/stores/store1/write');
    expect((f.calls[0].body as { writes: { tuple_keys: unknown[] } }).writes.tuple_keys).toHaveLength(1);
    expect((f.calls[1].body as { deletes: { tuple_keys: unknown[] } }).deletes.tuple_keys).toHaveLength(1);
  });

  it('write throws on non-2xx', async () => {
    await expect(new OpenFgaAuthorizationProvider(cfg, fakeFetch(() => ({ status: 400 }))).writeRelationship({ user: 'u', relation: 'r', object: 'o' })).rejects.toThrow(/write failed: 400/);
  });

  it('listObjects returns the objects array (default type site)', async () => {
    const f = fakeFetch(() => ({ status: 200, json: { objects: ['site:a', 'site:b'] } }));
    expect(await new OpenFgaAuthorizationProvider(cfg, f).listObjects({ user: 'user:1', relation: 'can_view' })).toEqual(['site:a', 'site:b']);
    expect(f.calls[0].url).toContain('/list-objects');
    expect((f.calls[0].body as { type: string }).type).toBe('site');
  });

  it('batchCheck maps per-tuple results', async () => {
    const f = fakeFetch((_u, body) => ({ status: 200, json: { allowed: (body as { tuple_key: { object: string } }).tuple_key.object === 'site:a' } }));
    const p = new OpenFgaAuthorizationProvider(cfg, f);
    expect(await p.batchCheck([{ user: 'u', relation: 'r', object: 'site:a' }, { user: 'u', relation: 'r', object: 'site:z' }])).toEqual([true, false]);
  });
});

describe('getAuthorizationProvider OpenFGA selection', () => {
  it('returns OpenFGA when configured, else DenyAll', () => {
    expect(getAuthorizationProvider({ OPENFGA_API_URL: 'https://a', OPENFGA_STORE_ID: 's' } as Env)).toBeInstanceOf(OpenFgaAuthorizationProvider);
    expect(getAuthorizationProvider({} as Env)).toBeInstanceOf(DenyAllAuthorizationProvider);
  });
});
