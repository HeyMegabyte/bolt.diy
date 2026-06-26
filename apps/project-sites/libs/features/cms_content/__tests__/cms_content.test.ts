/**
 * Tests for the cms_content feature (CMS content bridge).
 *
 * Mocks: isFlagOn, global fetch, CACHE_KV.
 * Coverage:
 *   - flag-off → 404 on both routes
 *   - blog.json: upstream 200 → validated feed; cache hit short-circuits fetch
 *   - blog.json: upstream failure → empty feed (never 500)
 *   - revalidate: secret unset → 503
 *   - revalidate: bad signature → 401
 *   - revalidate: malformed body → 400
 *   - revalidate: valid signature → 200 + cache purged
 *   - verifySignature constant-time correctness
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { cmsContent } from '../handlers.js';
import { verifySignature } from '../service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FEED = {
  count: 1,
  posts: [
    {
      title: 'Hello',
      slug: 'hello',
      url: 'https://cms.projectsites.dev/posts/hello',
      excerpt: 'hi',
      publishedAt: '2026-06-26T00:00:00.000Z',
      author: 'Brian',
      categories: ['news'],
      image: null,
    },
  ],
};

function makeKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: jest.fn((k: string, _t?: string) => {
      const v = store.get(k);
      return Promise.resolve(v === undefined ? null : JSON.parse(v));
    }),
    put: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
    _store: store,
  };
}

const CTX = { waitUntil() {}, passThroughOnException() {} } as never;

function call(path: string, env: unknown, init?: RequestInit) {
  const a = new Hono();
  a.route('/', cmsContent);
  return a.request(path, init ?? { method: 'GET' }, env as never, CTX);
}

/** HMAC-SHA256 hex of body with secret (independent of the impl under test). */
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockIsFlagOn.mockResolvedValue(true);
  (global.fetch as unknown) = jest.fn();
});

// ── GET /api/cms/blog.json ──────────────────────────────────────────────────

describe('GET /api/cms/blog.json', () => {
  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await call('/api/cms/blog.json', { CACHE_KV: makeKV() });
    expect(res.status).toBe(404);
  });

  it('returns the validated upstream feed and caches it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(FEED), { status: 200 }),
    );
    const kv = makeKV();
    const res = await call('/api/cms/blog.json?limit=50', { CACHE_KV: kv });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FEED);
    expect(kv.put).toHaveBeenCalledWith('cms:blog:50', JSON.stringify(FEED), expect.anything());
  });

  it('serves the cache without hitting the network', async () => {
    const kv = makeKV({ 'cms:blog:50': JSON.stringify(FEED) });
    const res = await call('/api/cms/blog.json', { CACHE_KV: kv });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FEED);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('degrades to an empty feed when upstream fails (never 500)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response('nope', { status: 503 }));
    const res = await call('/api/cms/blog.json', { CACHE_KV: makeKV() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0, posts: [] });
  });
});

// ── POST /api/cms/revalidate ────────────────────────────────────────────────

describe('POST /api/cms/revalidate', () => {
  const body = JSON.stringify({ collection: 'posts', slug: 'hello', event: 'published', at: 'now' });

  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await call('/api/cms/revalidate', { CACHE_KV: makeKV() }, { method: 'POST', body });
    expect(res.status).toBe(404);
  });

  it('503s when the secret is unset', async () => {
    const res = await call('/api/cms/revalidate', { CACHE_KV: makeKV() }, { method: 'POST', body });
    expect(res.status).toBe(503);
  });

  it('401s on a bad signature', async () => {
    const res = await call(
      '/api/cms/revalidate',
      { CACHE_KV: makeKV(), SITES_REVALIDATE_SECRET: 'sek' },
      { method: 'POST', body, headers: { 'x-ps-signature': 'deadbeef' } },
    );
    expect(res.status).toBe(401);
  });

  it('400s on a malformed body with a valid signature', async () => {
    const secret = 'sek';
    const bad = '{not json';
    const res = await call(
      '/api/cms/revalidate',
      { CACHE_KV: makeKV(), SITES_REVALIDATE_SECRET: secret },
      { method: 'POST', body: bad, headers: { 'x-ps-signature': await sign(secret, bad) } },
    );
    expect(res.status).toBe(400);
  });

  it('200s and purges the cache on a valid signature', async () => {
    const secret = 'sek';
    const kv = makeKV({ 'cms:blog:50': JSON.stringify(FEED) });
    const res = await call(
      '/api/cms/revalidate',
      { CACHE_KV: kv, SITES_REVALIDATE_SECRET: secret },
      { method: 'POST', body, headers: { 'x-ps-signature': await sign(secret, body) } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, purged: true, slug: 'hello' });
    expect(kv.delete).toHaveBeenCalledWith('cms:blog:50');
  });
});

// ── verifySignature ─────────────────────────────────────────────────────────

describe('verifySignature', () => {
  it('accepts a correct signature and rejects a tampered one', async () => {
    const secret = 'topsecret';
    const payload = 'the-body';
    const good = await sign(secret, payload);
    expect(await verifySignature(secret, payload, good)).toBe(true);
    expect(await verifySignature(secret, payload, good.replace(/.$/, '0'))).toBe(false);
    expect(await verifySignature(secret, 'other', good)).toBe(false);
    expect(await verifySignature('', payload, good)).toBe(false);
    expect(await verifySignature(secret, payload, 'zz')).toBe(false);
  });
});
