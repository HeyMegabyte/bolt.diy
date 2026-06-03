/**
 * @module __tests__/pseo_matrix
 * @description Unit tests for the pSEO Matrix Builder service (feature #17,
 * `src/services/pseo_matrix.ts`). Covers matrix generation across the
 * `service × city × intent × season` axes, the 200-page cap, slug building,
 * existing-slug dedup, org/site scoping on insert, empty-research short-circuit,
 * AI page generation + failure fallback, thin-content guardrails, and the
 * status summary aggregator.
 *
 * NOTE: distinct from `pseo_matrix_v2.test.ts`, which covers the v2 service
 * (`services/pseo_matrix_v2.ts` + `libs/features/pseo_matrix/feature.schemas.ts`).
 * This file covers the original v1 service module, which was previously untested.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
}));

import { dbQuery, dbQueryOne, dbInsert } from '../services/db.js';
import {
  buildPseoMatrix,
  generatePseoPage,
  generatePseoPageContent,
  getPseoMatrixStats,
} from '../services/pseo_matrix.js';
import type { PseoMatrixRow } from '../services/pseo_matrix.js';

const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;

// ─── Env factory ──────────────────────────────────────────────────────

interface MakeEnvOpts {
  research?: unknown; // _research.json body, or `undefined` => R2 miss (null obj)
  locations?: unknown; // _locations.json body, or `undefined` => R2 miss
  aiReply?: string | null; // env.AI.run().response; null => omit response field
  aiThrows?: boolean; // env.AI.run rejects
  captureModel?: (model: string) => void;
}

function makeEnv(opts: MakeEnvOpts = {}): any {
  const r2Get = jest.fn(async (key: string) => {
    if (key.endsWith('_research.json')) {
      if (opts.research === undefined) return null;
      return { json: async () => opts.research };
    }
    if (key.endsWith('_locations.json')) {
      if (opts.locations === undefined) return null;
      return { json: async () => opts.locations };
    }
    return null;
  });

  const aiRun = jest.fn(async (model: string) => {
    if (opts.captureModel) opts.captureModel(model);
    if (opts.aiThrows) throw new Error('AI unavailable');
    const out: Record<string, unknown> = { usage: { total_tokens: 1234 } };
    if (opts.aiReply !== null) out.response = opts.aiReply ?? '<p>default</p>';
    return out;
  });

  // D1 stub for the raw prepare().bind().run() path in generatePseoPageContent
  const run = jest.fn(async () => ({ meta: { changes: 1 } }));
  const bind = jest.fn(() => ({ run }));
  const prepare = jest.fn((_sql: string) => ({ bind }));

  return {
    DB: { prepare } as any,
    SITES_BUCKET: { get: r2Get } as any,
    AI: { run: aiRun } as any,
    __prepare: prepare,
    __bind: bind,
    __run: run,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
});

// ─── buildPseoMatrix ──────────────────────────────────────────────────

describe('buildPseoMatrix', () => {
  it('short-circuits to zero when no services are found', async () => {
    // site lookups succeed but _research.json missing => services []
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    const env = makeEnv({ research: undefined, locations: { cities: ['Newark'] } });

    const result = await buildPseoMatrix(env, 'site-1', 'org-1');

    expect(result).toEqual({ queued: 0, skipped: 0 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('short-circuits to zero when no cities are found', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    const env = makeEnv({ research: { services: ['Plumbing'] }, locations: undefined });

    const result = await buildPseoMatrix(env, 'site-1', 'org-1');

    expect(result).toEqual({ queued: 0, skipped: 0 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('generates the full intent×season grid for 1 service × 1 city (16 rows)', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    const env = makeEnv({
      research: { services: ['Plumbing'] },
      locations: { cities: ['Newark'] },
    });

    const result = await buildPseoMatrix(env, 'site-1', 'org-1');

    // 1 service × 1 city × 4 intents × 4 seasons = 16
    expect(result.queued).toBe(16);
    expect(result.skipped).toBe(0);
    expect(mockInsert).toHaveBeenCalledTimes(16);
  });

  it('persists each row scoped to the site and org with status draft + thin flag', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    const env = makeEnv({
      research: { services: ['Plumbing'] },
      locations: { cities: ['Newark'] },
    });

    await buildPseoMatrix(env, 'site-XYZ', 'org-ABC');

    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('pseo_pages');
    expect(record).toMatchObject({
      site_id: 'site-XYZ',
      org_id: 'org-ABC',
      service: 'Plumbing',
      city: 'Newark',
      status: 'draft',
      thin_content: 1,
      slop_hits: 0,
    });
    expect(typeof record.id).toBe('string');
    expect(record.route_slug.startsWith('/c/newark/')).toBe(true);
  });

  it('builds clean route slugs and omits the season segment for spring', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    const env = makeEnv({
      research: { services: ['Emergency Plumbing!'] },
      locations: { cities: ['Jersey City'] },
    });

    await buildPseoMatrix(env, 'site-1', 'org-1');

    const slugs = mockInsert.mock.calls.map((c) => c[2].route_slug as string);

    // spring rows: service + intent only, no season suffix
    expect(slugs).toContain('/c/jersey-city/emergency-plumbing-price');
    // non-spring rows append the season
    expect(slugs).toContain('/c/jersey-city/emergency-plumbing-price-winter');
    // every slug is fully slugified (lowercase, no punctuation)
    for (const s of slugs) {
      expect(s).toMatch(/^\/c\/[a-z0-9/-]+$/);
    }
  });

  it('skips combinations whose route_slug already exists (dedup)', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    // Pre-seed one existing slug that the matrix will produce
    mockQuery.mockResolvedValue({
      data: [{ route_slug: '/c/newark/plumbing-price' }],
      error: null,
    });
    const env = makeEnv({
      research: { services: ['Plumbing'] },
      locations: { cities: ['Newark'] },
    });

    const result = await buildPseoMatrix(env, 'site-1', 'org-1');

    expect(result.skipped).toBe(1);
    expect(result.queued).toBe(15); // 16 combos - 1 already-existing
    expect(mockInsert).toHaveBeenCalledTimes(15);
  });

  it('caps total queued rows at MAX_PAGES_PER_AXIS (200)', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    // 20 services × 20 cities × 4 × 4 = 6400 combos, far above the 200 cap
    const services = Array.from({ length: 20 }, (_, i) => `Service ${i}`);
    const cities = Array.from({ length: 20 }, (_, i) => `City ${i}`);
    const env = makeEnv({
      research: { services },
      locations: { cities },
    });

    const result = await buildPseoMatrix(env, 'site-1', 'org-1');

    expect(result.queued).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(200);
  });

  it('slices research services to the first 20 (rows 20-24 never used)', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    // 25 services provided; index >= 20 must be sliced off before iteration.
    // Single city keeps total combos (20 × 1 × 16 = 320) above the 200 cap,
    // but the cap acts on the OUTER service loop so only services 0..12 emit.
    // Either way, services 20-24 can NEVER appear because they were sliced.
    const services = Array.from({ length: 25 }, (_, i) => `S${i}`);
    const env = makeEnv({
      research: { services },
      locations: { cities: ['OneCity'] },
    });

    await buildPseoMatrix(env, 'site-1', 'org-1');

    const usedServices = new Set(mockInsert.mock.calls.map((c) => c[2].service as string));
    expect(usedServices.has('S0')).toBe(true); // first service is used
    for (let i = 20; i < 25; i++) {
      expect(usedServices.has(`S${i}`)).toBe(false); // sliced off at 20
    }
  });

  it('returns zero when the site row is missing (slug lookup misses)', async () => {
    mockQueryOne.mockResolvedValue(null); // site lookup misses
    const env = makeEnv({
      research: { services: ['Plumbing'] },
      locations: { cities: ['Newark'] },
    });

    const result = await buildPseoMatrix(env, 'missing-site', 'org-1');

    expect(result).toEqual({ queued: 0, skipped: 0 });
  });

  it('returns zero when research JSON arrays are absent / malformed', async () => {
    mockQueryOne.mockResolvedValue({ slug: 'acme' });
    const env = makeEnv({
      research: { notServices: 'oops' }, // services missing => []
      locations: { cities: ['Newark'] },
    });

    const result = await buildPseoMatrix(env, 'site-1', 'org-1');

    expect(result).toEqual({ queued: 0, skipped: 0 });
  });
});

// ─── generatePseoPage ─────────────────────────────────────────────────

describe('generatePseoPage', () => {
  const row: PseoMatrixRow = {
    siteId: 'site-1',
    orgId: 'org-1',
    service: 'Plumbing',
    city: 'Newark',
    intent: 'emergency',
    season: 'winter',
    routeSlug: '/c/newark/plumbing-emergency-winter',
  };

  it('returns AI html + token count on success', async () => {
    const env = makeEnv({ aiReply: '<section>Generated content</section>' });

    const out = await generatePseoPage(env, row, "Joe's Plumbing");

    expect(out.html).toBe('<section>Generated content</section>');
    expect(out.tokensUsed).toBe(1234);
  });

  it('uses the free Workers AI Llama 3.3 70B FP8 model', async () => {
    let captured = '';
    const env = makeEnv({ aiReply: '<p>x</p>', captureModel: (m) => (captured = m) });

    await generatePseoPage(env, row, 'Biz');

    expect(captured).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('falls back to a placeholder + 0 tokens when AI.run throws', async () => {
    const env = makeEnv({ aiThrows: true });

    const out = await generatePseoPage(env, row, 'Biz');

    expect(out.html).toBe('<p>Content generation failed.</p>');
    expect(out.tokensUsed).toBe(0);
  });

  it('falls back when AI returns no response field', async () => {
    const env = makeEnv({ aiReply: null });

    const out = await generatePseoPage(env, row, 'Biz');

    expect(out.html).toBe('<p>Content generation failed.</p>');
    expect(out.tokensUsed).toBe(1234);
  });
});

// ─── generatePseoPageContent ──────────────────────────────────────────

describe('generatePseoPageContent', () => {
  const pageRow = {
    id: 'page-1',
    site_id: 'site-1',
    org_id: 'org-1',
    service: 'Plumbing',
    city: 'Newark',
    intent: 'emergency',
    season: 'winter',
    route_slug: '/c/newark/plumbing-emergency-winter',
    status: 'draft',
  };

  // HTML that satisfies all guardrails: >=800 words, >=3 imgs, JSON-LD, >=3 internal links
  function richHtml(): string {
    const words = Array.from({ length: 900 }, () => 'word').join(' ');
    const imgs = '<img src="/a.webp"><img src="/b.webp"><img src="/c.webp">';
    const links = '<a href="/services">s</a><a href="/contact">c</a><a href="/about">a</a>';
    const jsonLd = '<script>{"@type":"LocalBusiness"}</script>';
    return `${jsonLd}${imgs}${links}<p>${words}</p>`;
  }

  it('returns error when the page row is not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    const env = makeEnv();

    const out = await generatePseoPageContent(env, 'nope');

    expect(out).toEqual({ ok: false, thinContent: false, error: 'Page not found' });
  });

  it('rejects rows with an invalid intent', async () => {
    mockQueryOne.mockResolvedValue({ ...pageRow, intent: 'bogus-intent' });
    const env = makeEnv();

    const out = await generatePseoPageContent(env, 'page-1');

    expect(out).toEqual({ ok: false, thinContent: false, error: 'Invalid intent' });
  });

  it('flags thin content when html is too short / missing assets', async () => {
    // first queryOne => page row; second => site name
    mockQueryOne
      .mockResolvedValueOnce(pageRow)
      .mockResolvedValueOnce({ name: 'Joe Plumbing', slug: 'joe' });
    const env = makeEnv({ aiReply: '<p>tiny</p>' });

    let updateBinds: unknown[] = [];
    env.__bind.mockImplementation((...binds: unknown[]) => {
      updateBinds = binds;
      return { run: env.__run };
    });

    const out = await generatePseoPageContent(env, 'page-1');

    expect(out).toEqual({ ok: true, thinContent: true });
    // status bind (2nd to last) is 'draft' when thin
    expect(updateBinds[updateBinds.length - 2]).toBe('draft');
    // thin_content flag (index 6 of the bind list) is 1
    expect(updateBinds[6]).toBe(1);
  });

  it('approves rich content that clears every guardrail', async () => {
    mockQueryOne
      .mockResolvedValueOnce(pageRow)
      .mockResolvedValueOnce({ name: 'Joe Plumbing', slug: 'joe' });
    const env = makeEnv({ aiReply: richHtml() });

    let updateBinds: unknown[] = [];
    env.__bind.mockImplementation((...binds: unknown[]) => {
      updateBinds = binds;
      return { run: env.__run };
    });

    const out = await generatePseoPageContent(env, 'page-1');

    expect(out).toEqual({ ok: true, thinContent: false });
    // status bind => 'approved' when not thin
    expect(updateBinds[updateBinds.length - 2]).toBe('approved');
    // thin_content flag => 0
    expect(updateBinds[6]).toBe(0);
    // the UPDATE actually ran
    expect(env.__run).toHaveBeenCalled();
  });

  it('defaults business name to "Local Business" when the site row is missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(pageRow)
      .mockResolvedValueOnce(null); // site lookup misses
    let captured = '';
    const env = makeEnv();
    // capture the user prompt content sent to AI
    env.AI.run = jest.fn(async (_m: string, body: any) => {
      captured = JSON.stringify(body);
      return { response: richHtml(), usage: { total_tokens: 10 } };
    });

    const out = await generatePseoPageContent(env, 'page-1');

    expect(out.ok).toBe(true);
    expect(captured).toContain('Local Business');
  });

  it('truncates html to 131072 chars before persisting', async () => {
    mockQueryOne
      .mockResolvedValueOnce(pageRow)
      .mockResolvedValueOnce({ name: 'Joe', slug: 'joe' });
    const huge = '<p>' + 'a'.repeat(200000) + '</p>';
    const env = makeEnv({ aiReply: huge });

    let updateBinds: unknown[] = [];
    env.__bind.mockImplementation((...binds: unknown[]) => {
      updateBinds = binds;
      return { run: env.__run };
    });

    await generatePseoPageContent(env, 'page-1');

    expect((updateBinds[0] as string).length).toBe(131072);
  });
});

// ─── getPseoMatrixStats ───────────────────────────────────────────────

describe('getPseoMatrixStats', () => {
  it('returns all-zero totals when there are no pages', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });
    const env = makeEnv();

    const stats = await getPseoMatrixStats(env, 'site-1');

    expect(stats).toEqual({
      total: 0,
      draft: 0,
      approved: 0,
      published: 0,
      rejected: 0,
      thinContent: 0,
    });
  });

  it('aggregates counts per status and sums thin_content', async () => {
    mockQuery.mockResolvedValue({
      data: [
        { status: 'draft', cnt: 5, thin: 5 },
        { status: 'approved', cnt: 3, thin: 0 },
        { status: 'published', cnt: 2, thin: 0 },
        { status: 'rejected', cnt: 1, thin: 1 },
      ],
      error: null,
    });
    const env = makeEnv();

    const stats = await getPseoMatrixStats(env, 'site-1');

    expect(stats).toEqual({
      total: 11,
      draft: 5,
      approved: 3,
      published: 2,
      rejected: 1,
      thinContent: 6,
    });
  });

  it('tolerates null thin sums and unknown statuses', async () => {
    mockQuery.mockResolvedValue({
      data: [
        { status: 'draft', cnt: 4, thin: null },
        { status: 'weird', cnt: 2, thin: 1 },
      ],
      error: null,
    });
    const env = makeEnv();

    const stats = await getPseoMatrixStats(env, 'site-1');

    expect(stats.total).toBe(6); // both statuses count toward total
    expect(stats.draft).toBe(4);
    expect(stats.thinContent).toBe(1); // null treated as 0, weird's 1 counted
    expect(stats.approved).toBe(0);
  });
});
