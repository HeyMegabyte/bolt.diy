/**
 * Wave 1B AI feature specs (BACKLOG_50 #8, #10, #13, #14, #18).
 *
 * Each spec hits its endpoint with a mocked Workers AI / Browser Rendering /
 * OpenAI TTS response and asserts:
 *   1. zValidator rejects bad payloads
 *   2. Hono route returns the documented JSON shape
 *   3. Audit + DB writes fire when expected
 *
 * The control-plane app is intentionally NOT booted via wrangler — we test
 * the route handlers with stubbed Cloudflare bindings via a synthetic `Env`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import aiRoutes from '../routes/ai.js';
import jobsRoutes from '../routes/jobs.js';
import sitesRoutes from '../routes/sites.js';
import {
  isSafeWhereClause,
} from '../routes/sites.js';
import {
  parseGapResult,
  sanitizeAlt,
  stripMarkdown,
} from '../routes/ai.js';
import { extractText } from '../services/ai-gateway.js';
import type { HonoEnv } from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures — minimal Env stub.
// ---------------------------------------------------------------------------

interface MockDbRow extends Record<string, unknown> {}

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, mode?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return mode === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function makeDb(rows: MockDbRow[] = []) {
  const inserts: Array<{ sql: string; binds: unknown[] }> = [];
  const queries: Array<{ sql: string; binds: unknown[] }> = [];

  const prepare = (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      first: vi.fn(async () => {
        queries.push({ sql, binds });
        // Synthetic: "SELECT id FROM sites/jobs WHERE ..." returns first row.
        if (/^\s*SELECT/i.test(sql)) return rows.shift() ?? null;
        return null;
      }),
      all: vi.fn(async () => {
        queries.push({ sql, binds });
        return { results: rows };
      }),
      run: vi.fn(async () => {
        if (/^\s*INSERT/i.test(sql)) inserts.push({ sql, binds });
        return { success: true };
      }),
    }),
  });

  return {
    inserts,
    queries,
    prepare: vi.fn(prepare),
    batch: vi.fn(async () => []),
  };
}

function makeR2() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: vi.fn(async (key: string, value: Uint8Array) => {
      objects.set(key, value);
      return { key };
    }),
  };
}

function makeAi(textResponse = 'A black dog runs through a green park.') {
  return {
    run: vi.fn(async (_model: string, _body: Record<string, unknown>) => ({
      response: textResponse,
    })),
  };
}

interface MockEnv {
  DB: ReturnType<typeof makeDb>;
  CACHE: ReturnType<typeof makeKv>;
  BUCKET: ReturnType<typeof makeR2>;
  AI: ReturnType<typeof makeAi>;
  ENVIRONMENT: string;
  AI_GATEWAY_ENABLED: string;
  AI_GATEWAY_PROJECT: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  OPENAI_API_KEY: string;
  SUPER_ADMIN_EMAIL: string;
}

function makeEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    DB: makeDb([{ id: 'site-1' }, { id: 'site-1' }]),
    CACHE: makeKv(),
    BUCKET: makeR2(),
    AI: makeAi(),
    ENVIRONMENT: 'test',
    AI_GATEWAY_ENABLED: 'false',
    AI_GATEWAY_PROJECT: 'projectsites',
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    CLOUDFLARE_API_TOKEN: 'tok',
    OPENAI_API_KEY: 'sk-test',
    SUPER_ADMIN_EMAIL: 'admin@x.test',
    ...overrides,
  };
}

/** Minimal ExecutionContext stub for `app.request()` calls. */
const TEST_CTX = {
  waitUntil: (_p: Promise<unknown>): void => undefined,
  passThroughOnException: (): void => undefined,
};

/**
 * Mount a single sub-app with stubbed auth + tenant context. Acts like the
 * real control-plane stack minus the global middleware chain.
 */
function harness(sub: Hono<HonoEnv>): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-test');
    c.set('userId', 'user-1');
    c.set('userEmail', 'tester@x.test');
    c.set('orgId', 'org-1');
    c.set('tenantId', 'tenant-1');
    c.set('viewAs', null);
    c.set('isSuperAdmin', false);
    return next();
  });
  app.route('/', sub);
  // Convert AppError → JSON so assertions can read .status + JSON body.
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    return c.json(
      {
        error: {
          code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
          message: err.message,
        },
      },
      status as 400 | 401 | 403 | 404 | 500 | 502,
    );
  });
  return app;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('pure helpers', () => {
  it('sanitizeAlt strips quotes + preamble + caps length', () => {
    expect(sanitizeAlt('"Alt text: A dog."')).toBe('A dog.');
    expect(sanitizeAlt('   description: cat sleeps   ')).toBe('cat sleeps');
    expect(sanitizeAlt('x'.repeat(500)).length).toBe(200);
  });

  it('stripMarkdown removes code fences + links + headers', () => {
    const out = stripMarkdown('# Title\n```\ncode\n```\n[L](u) **bold**');
    expect(out).not.toMatch(/```/);
    expect(out).not.toMatch(/^#/);
    expect(out).toContain('Title');
    expect(out).toContain('L');
    expect(out).toContain('bold');
  });

  it('parseGapResult extracts JSON shape from prose-padded output', () => {
    const raw =
      'Here you go:\n{"missing_sections":[{"name":"Pricing","suggested_copy":"..."}]}\nThanks!';
    const r = parseGapResult(raw);
    expect(r.missing_sections.length).toBe(1);
    expect(r.missing_sections[0]?.name).toBe('Pricing');
  });

  it('parseGapResult returns empty list on garbage', () => {
    expect(parseGapResult('no json here').missing_sections).toEqual([]);
    expect(parseGapResult('{"missing_sections":"oops"}').missing_sections).toEqual([]);
  });

  it('isSafeWhereClause rejects DML / semicolons / unbalanced parens', () => {
    expect(isSafeWhereClause(`level = 'error'`)).toBe(true);
    expect(isSafeWhereClause(`level = 'error' AND source = 'web'`)).toBe(true);
    expect(isSafeWhereClause(`level='error'; DROP TABLE logs`)).toBe(false);
    expect(isSafeWhereClause(`level='error' -- nope`)).toBe(false);
    expect(isSafeWhereClause(`DELETE FROM logs`)).toBe(false);
    expect(isSafeWhereClause(`(level = 'error'`)).toBe(false);
    expect(isSafeWhereClause(`level UNION SELECT 1`)).toBe(false);
  });

  it('extractText handles Workers AI + chat-completions shapes', () => {
    expect(extractText('plain')).toBe('plain');
    expect(extractText({ response: 'r' })).toBe('r');
    expect(extractText({ description: 'd' })).toBe('d');
    expect(
      extractText({ choices: [{ message: { content: 'c' } }] }),
    ).toBe('c');
    expect(extractText({ unknown: true })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// #8 alt-text
// ---------------------------------------------------------------------------

describe('POST /alt-text', () => {
  beforeEach(() => {
    // Stub global fetch for the vision-endpoint image download.
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3])));
  });

  it('rejects missing image_url with 400', async () => {
    const env = makeEnv();
    const app = harness(aiRoutes);
    const res = await app.request(
      '/alt-text',
      { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(400);
  });

  it('returns alt_text + persists to image_assets', async () => {
    const env = makeEnv();
    // First select returns null → insert path.
    env.DB = makeDb([]);
    const app = harness(aiRoutes);
    const res = await app.request(
      '/alt-text',
      {
        method: 'POST',
        body: JSON.stringify({ image_url: 'https://cdn.x/a.jpg' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alt_text: string; model: string };
    expect(body.alt_text.length).toBeGreaterThan(0);
    expect(body.model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct');
    // image_assets INSERT + audit INSERT
    const ins = env.DB.inserts.filter((i) => /image_assets|audit/.test(i.sql));
    expect(ins.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// #10 podcast
// ---------------------------------------------------------------------------

describe('POST /podcast', () => {
  beforeEach(() => {
    // OpenAI TTS returns mp3 bytes.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('audio/speech')) {
          return new Response(new Uint8Array(2_400), {
            headers: { 'content-type': 'audio/mpeg' },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('rejects body_markdown shorter than 50 chars', async () => {
    const env = makeEnv();
    const app = harness(aiRoutes);
    const res = await app.request(
      '/podcast',
      {
        method: 'POST',
        body: JSON.stringify({ slug: 'hello', body_markdown: 'too short' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(400);
  });

  it('generates a podcast + writes the row + returns url + duration', async () => {
    const env = makeEnv();
    env.DB = makeDb([]); // no existing podcast
    const app = harness(aiRoutes);
    const md = '# Hello\nThis is a long-form page with enough text to drive a podcast script generation.';
    const res = await app.request(
      '/podcast',
      {
        method: 'POST',
        body: JSON.stringify({ slug: 'pricing', body_markdown: md }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audio_url: string; duration_ms: number; cached: boolean };
    expect(body.audio_url).toContain('podcasts/pricing.mp3');
    expect(body.duration_ms).toBeGreaterThan(0);
    expect(body.cached).toBe(false);
    expect(env.BUCKET.put).toHaveBeenCalledOnce();
  });

  it('returns cached row when content_hash matches', async () => {
    const env = makeEnv();
    env.DB = makeDb([
      { audio_url: 'https://cdn/old.mp3', duration_ms: 33_000, audio_r2_key: 'podcasts/x.mp3' },
    ]);
    const app = harness(aiRoutes);
    const md = '# Hello\nThis is a long-form page with enough text to drive a podcast script generation.';
    const res = await app.request(
      '/podcast',
      {
        method: 'POST',
        body: JSON.stringify({ slug: 'pricing', body_markdown: md }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audio_url: string; cached: boolean };
    expect(body.cached).toBe(true);
    expect(body.audio_url).toBe('https://cdn/old.mp3');
    expect(env.BUCKET.put).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #13 competitor-gap
// ---------------------------------------------------------------------------

describe('POST /competitor-gap', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('browser-rendering/content')) {
          return new Response(
            JSON.stringify({ success: true, result: '<html><body>Pricing table</body></html>' }),
            { headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('caps competitor_urls at 5', async () => {
    const env = makeEnv();
    const app = harness(aiRoutes);
    const urls = Array.from({ length: 6 }, (_, i) => `https://c${i}.test`);
    const res = await app.request(
      '/competitor-gap',
      {
        method: 'POST',
        body: JSON.stringify({ org_id: 'org-1', competitor_urls: urls }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(400);
  });

  it('crawls + parses + persists', async () => {
    const env = makeEnv();
    env.AI = makeAi(
      '{"missing_sections":[{"name":"FAQ","suggested_copy":"Add a frequently-asked-questions section."}]}',
    );
    env.DB = makeDb([]);
    const app = harness(aiRoutes);
    const res = await app.request(
      '/competitor-gap',
      {
        method: 'POST',
        body: JSON.stringify({
          org_id: 'org-1',
          competitor_urls: ['https://a.test', 'https://b.test'],
        }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      missing_sections: Array<{ name: string }>;
    };
    expect(body.missing_sections[0]?.name).toBe('FAQ');
    expect(env.DB.inserts.some((i) => /competitor_gaps/.test(i.sql))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #14 NL log search (lives on /sites)
// ---------------------------------------------------------------------------

describe('POST /sites/:siteId/logs/search', () => {
  it('rejects malicious WHERE clause from the LLM', async () => {
    const env = makeEnv();
    // 2 selects: 1 for site auth, 1 for the log query
    env.DB = makeDb([{ id: 'site-1' }]);
    env.AI = makeAi(`level='error'; DROP TABLE logs`);
    const app = harness(sitesRoutes);
    const res = await app.request(
      '/site-1/logs/search',
      {
        method: 'POST',
        body: JSON.stringify({ query: 'errors in the last hour' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/safety/i);
  });

  it('executes a safe WHERE clause + returns rows', async () => {
    const env = makeEnv();
    // First .first() = site auth row; .all() returns no rows but succeeds.
    env.DB = makeDb([{ id: 'site-1' }]);
    env.AI = makeAi(`level = 'error'`);
    const app = harness(sitesRoutes);
    const res = await app.request(
      '/site-1/logs/search',
      {
        method: 'POST',
        body: JSON.stringify({ query: 'show only errors' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { where: string; rows: unknown[] };
    expect(body.where).toBe(`level = 'error'`);
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('404s when the site does not belong to the tenant', async () => {
    const env = makeEnv();
    env.DB = makeDb([]); // site lookup returns null
    const app = harness(sitesRoutes);
    const res = await app.request(
      '/site-other/logs/search',
      {
        method: 'POST',
        body: JSON.stringify({ query: 'errors' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// #18 chat translate (lives on /jobs)
// ---------------------------------------------------------------------------

describe('POST /jobs/:jobId/translate', () => {
  it('rejects invalid target_lang', async () => {
    const env = makeEnv();
    const app = harness(jobsRoutes);
    const res = await app.request(
      '/job-1/translate',
      {
        method: 'POST',
        body: JSON.stringify({ text: 'hi', target_lang: 'spanish' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(400);
  });

  it('translates + persists when no cache row exists', async () => {
    const env = makeEnv();
    // 2 selects: job auth row, then translation lookup → null
    env.DB = makeDb([{ id: 'job-1' }]);
    env.AI = makeAi('Hola, ¿cómo estás?');
    const app = harness(jobsRoutes);
    const res = await app.request(
      '/job-1/translate',
      {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello, how are you?', target_lang: 'es' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      translated_text: string;
      cached: boolean;
      target_lang: string;
    };
    expect(body.translated_text).toContain('Hola');
    expect(body.cached).toBe(false);
    expect(body.target_lang).toBe('es');
    expect(env.DB.inserts.some((i) => /chat_translations/.test(i.sql))).toBe(true);
  });

  it('returns cached translation on hash hit', async () => {
    const env = makeEnv();
    env.DB = makeDb([
      { id: 'job-1' },
      { translated_text: 'Hola', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    ]);
    const app = harness(jobsRoutes);
    const res = await app.request(
      '/job-1/translate',
      {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello', target_lang: 'es' }),
        headers: { 'content-type': 'application/json' },
      },
      env,
      TEST_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { translated_text: string; cached: boolean };
    expect(body.cached).toBe(true);
    expect(body.translated_text).toBe('Hola');
  });
});
