/**
 * Unit tests for the Public Gallery feature module (idea #34).
 *
 * Covers:
 *  - service.listGalleryEntries: D1 query → entries, category filter
 *  - service.setOptIn: org-scoped toggle (success + not-owned)
 *  - handlers: SSR HTML contains cards + JSON-LD ItemList; JSON API; sitemap
 *  - flag-off → 404 on every public route
 *
 * D1 / KV / R2 are mocked in-memory. The flag is registered in FLAG_REGISTRY
 * at runtime and toggled via its default state so the real `isFlagOn` resolver
 * drives the flag-on / flag-off behavior end-to-end.
 */

import { publicGallery } from '../handlers.js';
import { listGalleryEntries, setOptIn } from '../service.js';
import { GalleryQuerySchema } from '../schemas.js';
import { FLAG_REGISTRY } from '../../../../src/modules/feature_flags/registry.js';
import { FLAG_KEY } from '../schemas.js';
import type { Env } from '../../../../src/types/env.js';

// The real `isFlagOn` resolves against FLAG_REGISTRY. Register the flag at
// runtime so the resolver recognizes the key whether or not registry.ts has
// shipped the entry yet (the snippet is wired separately by the orchestrator).
// Tests flip the flag by mutating its default state.
FLAG_REGISTRY[FLAG_KEY] ??= {
  key: FLAG_KEY,
  description: 'Public, indexable gallery of opted-in published sites.',
  default_enabled: false,
  default_rollout_percent: 0,
  stage: 'experimental',
  owner_email: 'brian@megabyte.space',
};

function setFlag(on: boolean): void {
  const def = FLAG_REGISTRY[FLAG_KEY];
  def.default_enabled = on;
  def.default_rollout_percent = on ? 100 : 0;
}

interface SiteRow {
  id: string;
  slug: string;
  business_name: string;
  status: string;
  current_build_version: string | null;
  org_id: string;
  gallery_opt_in: number;
  deleted_at: string | null;
  created_at: string;
  profile_json: string | null;
}

/** In-memory D1 double understanding the gallery SELECT + the opt-in UPDATE. */
function makeDb(sites: SiteRow[]) {
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...params: unknown[]) => {
        bound = params;
        return api;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (/FROM sites s/i.test(sql)) {
          const rows = sites
            .filter(
              (s) =>
                s.gallery_opt_in === 1 &&
                s.status === 'published' &&
                s.current_build_version !== null &&
                s.deleted_at === null,
            )
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((s) => ({
              slug: s.slug,
              business_name: s.business_name,
              profile_json: s.profile_json,
              created_at: s.created_at,
            }));
          return { results: rows as unknown as T[] };
        }
        return { results: [] };
      },
      first: async <T>(): Promise<T | null> => {
        const r = await api.all<T>();
        return r.results[0] ?? null;
      },
      run: async (): Promise<{ meta: { changes: number } }> => {
        // UPDATE sites SET gallery_opt_in = ?, updated_at = ? WHERE id = ? AND org_id = ? ...
        if (/UPDATE sites SET/i.test(sql)) {
          const val = bound[0] as number;
          const id = bound[bound.length - 2] as string;
          const orgId = bound[bound.length - 1] as string;
          const site = sites.find((s) => s.id === id && s.org_id === orgId && s.deleted_at === null);
          if (site) {
            site.gallery_opt_in = val;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

/** In-memory KV double. */
function makeKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

/** R2 double whose head() always misses (no OG image) unless overridden. */
function makeBucket(hasOg = false) {
  return {
    head: async () => (hasOg ? ({} as R2Object) : null),
  } as unknown as R2Bucket;
}

function makeEnv(sites: SiteRow[], hasOg = false): Env {
  return {
    DB: makeDb(sites),
    CACHE_KV: makeKv(),
    SITES_BUCKET: makeBucket(hasOg),
  } as unknown as Env;
}

function site(partial: Partial<SiteRow>): SiteRow {
  return {
    id: 'site-1',
    slug: 'vitos-salon',
    business_name: "Vito's Mens Salon",
    status: 'published',
    current_build_version: 'v1',
    org_id: 'org-1',
    gallery_opt_in: 1,
    deleted_at: null,
    created_at: '2026-05-20T00:00:00Z',
    profile_json: JSON.stringify({ business_type: 'salon' }),
    ...partial,
  };
}

beforeEach(() => {
  setFlag(true);
});

describe('service.listGalleryEntries', () => {
  it('returns only opted-in published sites, newest first', async () => {
    const env = makeEnv([
      site({ id: 'a', slug: 'alpha', business_name: 'Alpha', created_at: '2026-05-10T00:00:00Z' }),
      site({ id: 'b', slug: 'beta', business_name: 'Beta', created_at: '2026-05-22T00:00:00Z' }),
      site({ id: 'c', slug: 'draft-co', status: 'draft', created_at: '2026-05-25T00:00:00Z' }),
      site({ id: 'd', slug: 'opted-out', gallery_opt_in: 0 }),
    ]);
    const { entries, total } = await listGalleryEntries(env, GalleryQuerySchema.parse({}));
    expect(total).toBe(2);
    expect(entries.map((e) => e.slug)).toEqual(['beta', 'alpha']);
    expect(entries[0].url).toBe('https://beta.projectsites.dev');
    expect(entries[0].category).toBe('Salon'); // title-cased from profile
  });

  it('filters by category', async () => {
    const env = makeEnv([
      site({ id: 'a', slug: 'alpha', profile_json: JSON.stringify({ business_type: 'salon' }) }),
      site({ id: 'b', slug: 'beta', profile_json: JSON.stringify({ business_type: 'restaurant' }) }),
    ]);
    const { entries } = await listGalleryEntries(env, GalleryQuerySchema.parse({ category: 'restaurant' }));
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe('beta');
  });

  it('falls back to "Website" when profile JSON is missing/malformed', async () => {
    const env = makeEnv([site({ id: 'a', slug: 'alpha', profile_json: null })]);
    const { entries } = await listGalleryEntries(env, GalleryQuerySchema.parse({}));
    expect(entries[0].category).toBe('Website');
  });
});

describe('service.setOptIn', () => {
  it('toggles an owned site and reports success', async () => {
    const sites = [site({ id: 's1', org_id: 'org-1', gallery_opt_in: 0 })];
    const env = makeEnv(sites);
    const ok = await setOptIn(env, 'org-1', 's1', true);
    expect(ok).toBe(true);
    expect(sites[0].gallery_opt_in).toBe(1);
  });

  it('refuses a site owned by another org', async () => {
    const sites = [site({ id: 's1', org_id: 'org-1', gallery_opt_in: 0 })];
    const env = makeEnv(sites);
    const ok = await setOptIn(env, 'org-2', 's1', true);
    expect(ok).toBe(false);
    expect(sites[0].gallery_opt_in).toBe(0);
  });
});

describe('handlers — flag ON', () => {
  it('GET /gallery renders cards + JSON-LD ItemList', async () => {
    const env = makeEnv([site({ id: 'a', slug: 'alpha', business_name: 'Alpha Co' })]);
    const res = await publicGallery.request('/gallery', {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Alpha Co');
    expect(html).toContain('View live');
    expect(html).toContain('Build one like this');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('https://alpha.projectsites.dev');
  });

  it('GET /api/gallery returns a validated JSON envelope', async () => {
    const env = makeEnv([site({ id: 'a', slug: 'alpha' })]);
    const res = await publicGallery.request('/api/gallery', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; count: number; category: null };
    expect(body.count).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.category).toBeNull();
  });

  it('GET /gallery/sitemap.xml lists entry URLs', async () => {
    const env = makeEnv([site({ id: 'a', slug: 'alpha' })]);
    const res = await publicGallery.request('/gallery/sitemap.xml', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<loc>https://projectsites.dev/gallery</loc>');
    expect(xml).toContain('https://alpha.projectsites.dev');
  });

  it('POST /api/sites/:id/gallery/opt-in toggles when authed + owned', async () => {
    const sites = [site({ id: 's1', org_id: 'org-1', gallery_opt_in: 0 })];
    const env = makeEnv(sites);
    // Wrap with a middleware that seeds the auth context vars the handler reads.
    const { Hono } = await import('hono');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', 'user-1');
      c.set('orgId', 'org-1');
      await next();
    });
    app.route('/', publicGallery);

    const res = await app.request(
      '/api/sites/s1/gallery/opt-in',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { siteId: string; galleryOptIn: boolean };
    expect(body).toEqual({ siteId: 's1', galleryOptIn: true });
    expect(sites[0].gallery_opt_in).toBe(1);
  });

  it('POST opt-in is 401 without auth context', async () => {
    const env = makeEnv([site({ id: 's1', org_id: 'org-1' })]);
    const res = await publicGallery.request(
      '/api/sites/s1/gallery/opt-in',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('handlers — flag OFF → 404 everywhere', () => {
  beforeEach(() => setFlag(false));

  it.each(['/gallery', '/gallery/sitemap.xml', '/api/gallery'])('%s returns 404', async (path) => {
    const env = makeEnv([site({ id: 'a', slug: 'alpha' })]);
    const res = await publicGallery.request(path, {}, env);
    expect(res.status).toBe(404);
  });

  it('POST opt-in returns 404 when flag off', async () => {
    const env = makeEnv([site({ id: 's1', org_id: 'org-1' })]);
    const res = await publicGallery.request(
      '/api/sites/s1/gallery/opt-in',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) },
      env,
    );
    expect(res.status).toBe(404);
  });
});
