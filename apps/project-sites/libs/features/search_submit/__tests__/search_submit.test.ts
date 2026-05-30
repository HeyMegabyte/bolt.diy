/**
 * Unit tests for the Search/AI-Engine Auto-Submit service (idea #3).
 *
 * Covers: IndexNow payload construction, Bing/Google ping URLs, the public
 * key-file value, submitSite audit logging, and error-swallowing (a thrown
 * fetch never propagates out of submitSite/pingSitemap/submitIndexNow).
 *
 * D1 is mocked in-memory; global fetch is mocked per-test.
 */

import {
  deriveIndexNowKey,
  siteHost,
  buildSitemapUrls,
  submitIndexNow,
  pingSitemap,
  submitSite,
} from '../service.js';

const SITE_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const SLUG = 'vitos-mens-salon';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

/** Replace global fetch with a recorder; returns the captured calls. */
function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return impl(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

/** Minimal D1 double: serves one site row + swallows the audit INSERT. */
function makeDb(site: { id: string; slug: string; org_id: string } | null) {
  const inserts: unknown[][] = [];
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        bound = p;
        return api;
      },
      first: async <T>(): Promise<T | null> => {
        if (sql.includes('FROM sites')) return site as unknown as T;
        return null;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        const r = await api.first<T>();
        return { results: r ? [r] : [] };
      },
      run: async (): Promise<{ meta: { changes: number } }> => {
        inserts.push(bound);
        return { meta: { changes: 1 } };
      },
    };
    return api;
  }
  return { db: { prepare } as unknown as D1Database, inserts };
}

const ok = () => new Response('', { status: 200 });

describe('search_submit/deriveIndexNowKey', () => {
  test('derives a deterministic 32-hex key + /{key}.txt path', async () => {
    const a = await deriveIndexNowKey(SITE_ID);
    const b = await deriveIndexNowKey(SITE_ID);
    expect(a.key).toMatch(/^[a-f0-9]{32}$/);
    expect(a.key).toBe(b.key); // deterministic
    expect(a.keyPath).toBe(`/${a.key}.txt`);
  });

  test('different site ids → different keys', async () => {
    const a = await deriveIndexNowKey(SITE_ID);
    const b = await deriveIndexNowKey(ORG_ID);
    expect(a.key).not.toBe(b.key);
  });
});

describe('search_submit/url builders', () => {
  test('siteHost + buildSitemapUrls use the projectsites suffix', () => {
    expect(siteHost(SLUG)).toBe(`${SLUG}.projectsites.dev`);
    expect(buildSitemapUrls(SLUG)).toEqual([
      `https://${SLUG}.projectsites.dev/`,
      `https://${SLUG}.projectsites.dev/sitemap.xml`,
    ]);
  });
});

describe('search_submit/submitIndexNow', () => {
  test('POSTs host + key + keyLocation + urlList to api.indexnow.org', async () => {
    const { calls, restore } = mockFetch(() => ok());
    const host = `${SLUG}.projectsites.dev`;
    const urls = [`https://${host}/`, `https://${host}/sitemap.xml`];
    const result = await submitIndexNow(host, 'abc123', urls);
    restore();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.indexnow.org/indexnow');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toEqual({
      host,
      key: 'abc123',
      keyLocation: `https://${host}/abc123.txt`,
      urlList: urls,
    });
    expect(result).toEqual({ engine: 'indexnow', ok: true, status: 200, submittedUrls: urls });
  });

  test('non-200 → ok:false with the real status, still typed', async () => {
    const { restore } = mockFetch(() => new Response('no', { status: 429 }));
    const result = await submitIndexNow('h.projectsites.dev', 'k', ['https://h.projectsites.dev/']);
    restore();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  test('a thrown fetch is swallowed → ok:false, status:0', async () => {
    const { restore } = mockFetch(() => {
      throw new Error('network down');
    });
    const result = await submitIndexNow('h.projectsites.dev', 'k', ['https://h.projectsites.dev/']);
    restore();
    expect(result).toEqual({
      engine: 'indexnow',
      ok: false,
      status: 0,
      submittedUrls: ['https://h.projectsites.dev/'],
    });
  });
});

describe('search_submit/pingSitemap', () => {
  test('Bing ping URL', async () => {
    const { calls, restore } = mockFetch(() => ok());
    const sm = 'https://x.projectsites.dev/sitemap.xml';
    const result = await pingSitemap('bing', sm);
    restore();
    expect(calls[0]!.url).toBe(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sm)}`);
    expect(result.engine).toBe('bing');
    expect(result.ok).toBe(true);
  });

  test('Google ping URL (fallback)', async () => {
    const { calls, restore } = mockFetch(() => ok());
    const sm = 'https://x.projectsites.dev/sitemap.xml';
    await pingSitemap('google', sm);
    restore();
    expect(calls[0]!.url).toBe(`https://www.google.com/ping?sitemap=${encodeURIComponent(sm)}`);
  });

  test('a thrown fetch is swallowed → ok:false, status:0', async () => {
    const { restore } = mockFetch(() => {
      throw new Error('boom');
    });
    const result = await pingSitemap('bing', 'https://x.projectsites.dev/sitemap.xml');
    restore();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });
});

describe('search_submit/submitSite', () => {
  test('fires all three engines + logs one audit row per result', async () => {
    const { calls, restore } = mockFetch(() => ok());
    const { db, inserts } = makeDb({ id: SITE_ID, slug: SLUG, org_id: ORG_ID });
    const results = await submitSite({ DB: db } as never, SITE_ID);
    restore();

    expect(results.map((r) => r.engine).sort()).toEqual(['bing', 'google', 'indexnow']);
    expect(results.every((r) => r.ok)).toBe(true);
    // One IndexNow POST + Bing ping + Google ping.
    expect(calls).toHaveLength(3);
    // One audit INSERT per engine result.
    expect(inserts).toHaveLength(3);
  });

  test('unresolvable site → empty results, no fetch', async () => {
    const { calls, restore } = mockFetch(() => ok());
    const { db, inserts } = makeDb(null);
    const results = await submitSite({ DB: db } as never, 'missing');
    restore();
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  test('a thrown fetch never propagates out of submitSite', async () => {
    const { restore } = mockFetch(() => {
      throw new Error('all down');
    });
    const { db } = makeDb({ id: SITE_ID, slug: SLUG, org_id: ORG_ID });
    await expect(submitSite({ DB: db } as never, SITE_ID)).resolves.toBeDefined();
    restore();
  });
});
