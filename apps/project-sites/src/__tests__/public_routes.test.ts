/**
 * Route coverage for the public distribution-flywheel surfaces (convergence r46).
 *
 * Exercises every handler in {@link publicRoutes} end-to-end through the real
 * Hono app, mocking only the R2 boundary (`SITES_BUCKET`). These are PUBLIC,
 * unauthenticated GET endpoints, so there is no auth/Zod-body surface — instead
 * we cover: R2-backed changelog parsing, the curated inline fallback, the
 * R2-read-error fallback, RSS 2.0 well-formedness + content-type + XML escaping,
 * the static integrations catalog grouping, the roadmap quarter grouping, every
 * Cache-Control header, and a 404 on an unknown path.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { publicRoutes } from '../routes/public.js';

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/** R2 object stub whose `text()` resolves to `body`. */
function makeR2Object(body: string) {
  return { text: jest.fn(async () => body) };
}

/**
 * R2 bucket mock. `obj` is returned from `.get()` (null = miss). When
 * `opts.throws` is set, `.get()` rejects so we can drive the read-error path.
 */
function makeBucket(obj: ReturnType<typeof makeR2Object> | null, opts: { throws?: boolean } = {}) {
  return {
    get: jest.fn(async (_key: string) => {
      if (opts.throws) throw new Error('R2 unavailable');
      return obj;
    }),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    SITES_BUCKET: makeBucket(null),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/** Mount publicRoutes at `/` exactly as `src/index.ts` does. */
function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/', publicRoutes);
  return app;
}

function get(app: Hono<{ Bindings: Env; Variables: Variables }>, path: string, env: Env) {
  return app.request(path, { method: 'GET' }, env);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── /changelog.json ─────────────────────────────────────────────────────────

describe('GET /changelog.json', () => {
  it('serves the curated inline fallback when R2 has no CHANGELOG.md', async () => {
    const env = makeEnv(); // bucket .get() → null
    const res = await get(makeApp(), '/changelog.json', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');

    const json = (await res.json()) as {
      entries: { date: string; version: string; tags: string[] }[];
      count: number;
      source: string;
    };
    expect(json.source).toBe('inline');
    expect(json.count).toBeGreaterThan(0);
    expect(json.count).toBe(json.entries.length);
    // Newest entry first (descending date).
    expect(json.entries[0].date >= json.entries[1].date).toBe(true);
    // Every entry has a v-prefixed version + at least one tag.
    for (const e of json.entries) {
      expect(e.version.startsWith('v')).toBe(true);
      expect(e.tags.length).toBeGreaterThan(0);
    }
  });

  it('parses a bundled CHANGELOG.md from R2 (source=r2) with tag extraction', async () => {
    const md = [
      '# Changelog',
      '',
      '## v2.0.0 - 2026-06-01',
      'Massive release',
      '',
      '- (feature) shipped the thing',
      '- (fix) squashed a bug',
      '',
      '## v1.9.0 - 2026-05-30',
      'Earlier release',
      '',
      '- polished the edges',
    ].join('\n');
    const env = makeEnv({ SITES_BUCKET: makeBucket(makeR2Object(md)) });
    const res = await get(makeApp(), '/changelog.json', env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      entries: { date: string; version: string; title: string; body: string; tags: string[] }[];
      count: number;
      source: string;
    };
    expect(json.source).toBe('r2');
    expect(json.count).toBe(2);
    // Sorted newest-first.
    expect(json.entries[0].version).toBe('v2.0.0');
    expect(json.entries[0].title).toBe('Massive release');
    // Tags pulled from the `(tag)` prefix on bullet lines.
    expect(json.entries[0].tags).toEqual(expect.arrayContaining(['feature', 'fix']));
    // Bullets joined into the body.
    expect(json.entries[0].body).toContain('shipped the thing');
    // A bullet with no `(tag)` prefix falls back to the ['release'] tag.
    expect(json.entries[1].tags).toEqual(['release']);
  });

  it('falls back to inline entries when the R2 file parses to zero entries', async () => {
    const env = makeEnv({ SITES_BUCKET: makeBucket(makeR2Object('# Just a heading, no releases')) });
    const res = await get(makeApp(), '/changelog.json', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { source: string; count: number };
    expect(json.source).toBe('inline');
    expect(json.count).toBeGreaterThan(0);
  });

  it('falls back to inline entries when the R2 read throws (resilient)', async () => {
    const env = makeEnv({ SITES_BUCKET: makeBucket(null, { throws: true }) });
    const res = await get(makeApp(), '/changelog.json', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { source: string; count: number };
    expect(json.source).toBe('inline');
    expect(json.count).toBeGreaterThan(0);
  });

  it('falls back to inline entries when SITES_BUCKET is unbound', async () => {
    const env = makeEnv({ SITES_BUCKET: undefined });
    const res = await get(makeApp(), '/changelog.json', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { source: string };
    expect(json.source).toBe('inline');
  });
});

// ─── /feed.xml ───────────────────────────────────────────────────────────────

describe('GET /feed.xml', () => {
  it('serves a well-formed RSS 2.0 feed with the correct content-type', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), '/feed.xml', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');

    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<title>Project Sites — Changelog</title>');
    expect(xml).toContain('rel="self" type="application/rss+xml"');
    // One <item> per inline fallback entry, with RFC-822 pubDates.
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    expect(itemCount).toBeGreaterThan(0);
    expect(xml).toMatch(/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
    // Tags become <category> elements.
    expect(xml).toContain('<category>');
  });

  it('XML-escapes special characters drawn from R2 changelog content', async () => {
    const md = [
      '## v3.0.0 - 2026-06-02',
      'Title with <angle> & "quotes"',
      '',
      "- (a&b) body with <tags> & ampersands",
    ].join('\n');
    const env = makeEnv({ SITES_BUCKET: makeBucket(makeR2Object(md)) });
    const res = await get(makeApp(), '/feed.xml', env);
    expect(res.status).toBe(200);
    const xml = await res.text();
    // Raw unescaped angle/ampersand from content must not leak into the markup.
    expect(xml).toContain('&lt;angle&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;quotes&quot;');
    // The escaped content must not introduce a raw "<angle>" element.
    expect(xml).not.toContain('<angle>');
  });
});

// ─── /api/public/integrations ────────────────────────────────────────────────

describe('GET /api/public/integrations', () => {
  it('returns the full catalog grouped by category with counts', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), '/api/public/integrations', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600');

    const json = (await res.json()) as {
      integrations: { slug: string; category: string; mcp_supported: boolean }[];
      by_category: Record<string, unknown[]>;
      count: number;
      mcp_supported_count: number;
    };
    expect(json.count).toBe(json.integrations.length);
    expect(json.count).toBeGreaterThan(0);
    // Grouping covers every integration with no orphans.
    const grouped = Object.values(json.by_category).reduce((n, arr) => n + arr.length, 0);
    expect(grouped).toBe(json.count);
    // by_category keys match the set of category values present.
    const categories = new Set(json.integrations.map((i) => i.category));
    expect(Object.keys(json.by_category).sort()).toEqual([...categories].sort());
    // mcp_supported_count matches the filtered total.
    expect(json.mcp_supported_count).toBe(json.integrations.filter((i) => i.mcp_supported).length);
    // Stripe is a known live integration.
    expect(json.integrations.some((i) => i.slug === 'stripe')).toBe(true);
  });
});

// ─── /api/public/roadmap ─────────────────────────────────────────────────────

describe('GET /api/public/roadmap', () => {
  it('groups roadmap items by quarter (preserving source order) with status counts', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), '/api/public/roadmap', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600, s-maxage=600');

    const json = (await res.json()) as {
      quarters: { quarter: string; items: { status: string }[] }[];
      count: number;
      shipped_count: number;
      in_progress_count: number;
      planned_count: number;
    };
    expect(json.quarters.length).toBeGreaterThan(0);
    // Quarter keys are unique (no duplicate buckets).
    const quarterKeys = json.quarters.map((q) => q.quarter);
    expect(new Set(quarterKeys).size).toBe(quarterKeys.length);
    // Total items across quarters equals the reported count.
    const totalItems = json.quarters.reduce((n, q) => n + q.items.length, 0);
    expect(totalItems).toBe(json.count);
    // Status counts sum to the total and are individually non-negative.
    expect(json.shipped_count + json.in_progress_count + json.planned_count).toBe(json.count);
    expect(json.shipped_count).toBeGreaterThanOrEqual(0);
    // Every item carries one of the three valid statuses.
    for (const q of json.quarters) {
      for (const item of q.items) {
        expect(['shipped', 'in_progress', 'planned']).toContain(item.status);
      }
    }
  });
});

// ─── Unknown path ────────────────────────────────────────────────────────────

describe('public routes — unknown path', () => {
  it('returns 404 for a path the sub-app does not handle', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), '/api/public/does-not-exist', env);
    expect(res.status).toBe(404);
  });
});
