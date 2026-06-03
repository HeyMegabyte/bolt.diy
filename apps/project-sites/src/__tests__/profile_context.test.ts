/**
 * Additive unit tests for {@link services/profile_context} (convergence r24).
 *
 * `gatherProfileContext` is the single-source-of-truth gatherer that fans out
 * across the `sites` row, `confidence_attributes`, `research_data`, the R2
 * `_build-context.json` snapshot, and the `hostnames` table — then merges them
 * (cheapest → richest precedence), normalizes heterogeneous research payloads,
 * derives keywords, and caches the result in `CACHE_KV`.
 *
 * No sibling test exists, so this file covers EVERY real branch:
 *  - missing site → null (early bail, no fan-out)
 *  - KV cache hit → returns cached, skips the live gather
 *  - KV cache miss / KV throw → falls through to live gather
 *  - full merge precedence: confidence > research > build-snapshot > sites row
 *  - research task name aliases (`research-profile` AND `research_profile`)
 *  - research JSON parse failure → raw string retained
 *  - confidence first-write-wins (highest-confidence row sticks)
 *  - build-snapshot fetch failure → undefined fields, no throw
 *  - hostname lookup: active row, default fallback, query throw fallback
 *  - extractStringArray: array, JSON-string, comma-string, object entries, cap 8, empty
 *  - extractFonts: heading/body slot aliases, neither populated → undefined
 *  - deriveKeywords: stopword + length + numeric filtering, dedupe, cap 12
 *  - cache write best-effort (KV put throw is swallowed)
 *  - versioned cache key (current_build_version vs 'unbuilt')
 *
 * Everything external (D1 via db.js, KV, R2) is mocked — never a real API.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
}));

import { dbQuery, dbQueryOne } from '../services/db.js';
import { gatherProfileContext } from '../services/profile_context.js';
import type { Env } from '../types/env.js';

const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;

interface MockEnv {
  env: Env;
  kvGet: jest.Mock;
  kvPut: jest.Mock;
  r2Get: jest.Mock;
}

function makeEnv(opts: {
  kvCached?: unknown;
  kvGetThrows?: boolean;
  kvPutThrows?: boolean;
  r2Body?: unknown | null;
  r2Throws?: boolean;
} = {}): MockEnv {
  const kvGet = jest.fn(async () => {
    if (opts.kvGetThrows) throw new Error('kv down');
    return opts.kvCached ?? null;
  });
  const kvPut = jest.fn(async () => {
    if (opts.kvPutThrows) throw new Error('kv put down');
    return undefined;
  });
  const r2Get = jest.fn(async () => {
    if (opts.r2Throws) throw new Error('r2 down');
    if (opts.r2Body === null || opts.r2Body === undefined) return null;
    return { text: async () => JSON.stringify(opts.r2Body) };
  });

  const env = {
    DB: {} as unknown,
    CACHE_KV: { get: kvGet, put: kvPut } as unknown,
    SITES_BUCKET: { get: r2Get } as unknown,
  } as unknown as Env;

  return { env, kvGet, kvPut, r2Get };
}

const SITE_ID = 'site-123';

function siteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    slug: 'acme',
    business_name: 'Acme Co',
    business_email: null,
    business_phone: null,
    business_address: null,
    business_website: null,
    google_place_id: null,
    logo_url: null,
    current_build_version: null,
    ...overrides,
  };
}

/**
 * The service issues these dbQueryOne calls in order:
 *   1. sites row
 *   2. hostnames row (live gather only)
 * and these dbQuery calls (in the Promise.all):
 *   confidence_attributes, research_data
 * We route by SQL substring so ordering inside Promise.all never matters.
 */
function wireDb(opts: {
  site?: Record<string, unknown> | null;
  hostname?: { hostname: string } | null;
  hostnameThrows?: boolean;
  confidence?: Array<{ attribute_name: string; attribute_value: string; confidence: number }>;
  research?: Array<{ task_name: string; parsed_output: string | null; raw_output: string }>;
}) {
  mockQueryOne.mockImplementation(async (_db: unknown, sql: string) => {
    if (sql.includes('FROM sites')) return opts.site === undefined ? siteRow() : opts.site;
    if (sql.includes('FROM hostnames')) {
      if (opts.hostnameThrows) throw new Error('hostname query down');
      return opts.hostname ?? null;
    }
    return null;
  });
  mockQuery.mockImplementation(async (_db: unknown, sql: string) => {
    if (sql.includes('FROM confidence_attributes')) {
      return { data: opts.confidence ?? [], error: null };
    }
    if (sql.includes('FROM research_data')) {
      return { data: opts.research ?? [], error: null };
    }
    return { data: [], error: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Early bail — site missing
// ---------------------------------------------------------------------------
describe('gatherProfileContext — missing site', () => {
  it('returns null and never touches KV / R2 when the site does not exist', async () => {
    const { env, kvGet, r2Get } = makeEnv();
    wireDb({ site: null });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx).toBeNull();
    expect(kvGet).not.toHaveBeenCalled();
    expect(r2Get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KV cache hit / miss / error
// ---------------------------------------------------------------------------
describe('gatherProfileContext — cache layer', () => {
  it('returns the cached snapshot and skips the live gather on a KV hit', async () => {
    const cached = { site_id: SITE_ID, business_name: 'Cached Co', recent_keywords: [] };
    const { env, kvPut, r2Get } = makeEnv({ kvCached: cached });
    wireDb({ site: siteRow() });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx).toBe(cached);
    // No live gather → no confidence/research query, no R2 read, no cache write.
    expect(r2Get).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled();
    // Only the sites lookup ran (the cheap base lookup precedes the cache read).
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignores a cached value missing business_name and falls through to live gather', async () => {
    const { env, kvPut } = makeEnv({ kvCached: { not_a_profile: true } });
    wireDb({ site: siteRow() });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx?.business_name).toBe('Acme Co');
    expect(kvPut).toHaveBeenCalled(); // live gather wrote a fresh snapshot
  });

  it('treats a KV get throw as a miss and completes the live gather', async () => {
    const { env } = makeEnv({ kvGetThrows: true });
    wireDb({ site: siteRow() });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx).not.toBeNull();
    expect(ctx?.business_name).toBe('Acme Co');
  });

  it('uses the build-version-suffixed cache key and writes the snapshot back', async () => {
    const { env, kvGet, kvPut } = makeEnv();
    wireDb({ site: siteRow({ current_build_version: 'v9' }) });

    await gatherProfileContext(env, SITE_ID);

    expect(kvGet).toHaveBeenCalledWith(`profile_ctx:${SITE_ID}:v9`, 'json');
    expect(kvPut.mock.calls[0][0]).toBe(`profile_ctx:${SITE_ID}:v9`);
    expect(kvPut.mock.calls[0][2]).toEqual(
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it('falls back to the "unbuilt" cache suffix when no build version exists', async () => {
    const { env, kvGet } = makeEnv();
    wireDb({ site: siteRow({ current_build_version: null }) });

    await gatherProfileContext(env, SITE_ID);

    expect(kvGet).toHaveBeenCalledWith(`profile_ctx:${SITE_ID}:unbuilt`, 'json');
  });

  it('swallows a KV put failure (best-effort cache write) and still returns the context', async () => {
    const { env } = makeEnv({ kvPutThrows: true });
    wireDb({ site: siteRow() });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx?.business_name).toBe('Acme Co');
  });
});

// ---------------------------------------------------------------------------
// Sparse site — only the base row, nothing else populated
// ---------------------------------------------------------------------------
describe('gatherProfileContext — sparse free-tier site', () => {
  it('returns a minimal context with undefined optional fields and a default hostname', async () => {
    const { env } = makeEnv({ r2Body: null });
    wireDb({ site: siteRow(), hostname: null });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx).toMatchObject({
      site_id: SITE_ID,
      slug: 'acme',
      business_name: 'Acme Co',
      primary_hostname: 'acme.projectsites.dev',
    });
    expect(ctx?.category).toBeUndefined();
    expect(ctx?.usps).toBeUndefined();
    expect(ctx?.services).toBeUndefined();
    expect(ctx?.brand_colors).toBeUndefined();
    expect(ctx?.brand_fonts).toBeUndefined();
    // keyword derivation still runs off the business name.
    expect(ctx?.recent_keywords).toContain('acme');
    expect(typeof ctx?.generated_at).toBe('string');
  });

  it('maps site-row scalar fields (email / phone / address) into the context', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow({
        business_email: 'hi@acme.com',
        business_phone: '+15551230000',
        business_address: '1 Main St, Newark NJ',
        business_website: 'https://acme.com',
        logo_url: 'https://cdn/logo.png',
      }),
    });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx?.business_email).toBe('hi@acme.com');
    expect(ctx?.business_phone).toBe('+15551230000');
    expect(ctx?.business_address).toBe('1 Main St, Newark NJ');
    expect(ctx?.location).toBe('1 Main St, Newark NJ');
    expect(ctx?.business_website).toBe('https://acme.com');
    expect(ctx?.logo_url).toBe('https://cdn/logo.png');
  });
});

// ---------------------------------------------------------------------------
// Merge precedence + normalization
// ---------------------------------------------------------------------------
describe('gatherProfileContext — merge precedence', () => {
  it('prefers confidence_attributes over research and build snapshot', async () => {
    const { env } = makeEnv({
      r2Body: { research: { profile: { category: 'snap-cat' } } },
    });
    wireDb({
      site: siteRow(),
      confidence: [
        { attribute_name: 'category', attribute_value: 'conf-cat', confidence: 0.9 },
        { attribute_name: 'brand_tone', attribute_value: 'playful', confidence: 0.8 },
        { attribute_name: 'target_audience', attribute_value: 'locals', confidence: 0.7 },
      ],
      research: [
        {
          task_name: 'research-profile',
          parsed_output: JSON.stringify({ category: 'research-cat' }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx?.category).toBe('conf-cat'); // confidence wins
    expect(ctx?.brand_tone).toBe('playful');
    expect(ctx?.target_audience).toBe('locals');
  });

  it('first-write-wins on confidence — the highest-confidence (ORDER BY) row sticks', async () => {
    const { env } = makeEnv();
    // Service orders DESC by confidence; our mock returns them already ordered.
    wireDb({
      site: siteRow(),
      confidence: [
        { attribute_name: 'category', attribute_value: 'winner', confidence: 0.95 },
        { attribute_name: 'category', attribute_value: 'loser', confidence: 0.1 },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.category).toBe('winner');
  });

  it('falls through to research-profile, then build snapshot, then business category', async () => {
    // No confidence rows; research-profile lacks category; build snapshot has it.
    const { env } = makeEnv({
      r2Body: { business: { category: 'biz-cat', website: 'https://snap.example' } },
    });
    wireDb({
      site: siteRow(),
      research: [
        { task_name: 'research-profile', parsed_output: JSON.stringify({}), raw_output: '{}' },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx?.category).toBe('biz-cat');
    // business_website empty on the site row → falls back to snapshot business.website
    expect(ctx?.business_website).toBe('https://snap.example');
  });

  it('reads research under the underscore alias (research_profile / research_brand)', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research_profile',
          parsed_output: JSON.stringify({ description: 'aliased desc', business_type: 'cafe' }),
          raw_output: '{}',
        },
        {
          task_name: 'research_brand',
          parsed_output: JSON.stringify({ tone: 'warm', colors: ['#111', '#222'] }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(ctx?.business_description).toBe('aliased desc');
    expect(ctx?.business_type).toBe('cafe');
    expect(ctx?.brand_tone).toBe('warm');
    expect(ctx?.brand_colors).toEqual(['#111', '#222']);
  });

  it('retains the raw string when a research payload is not valid JSON', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        { task_name: 'research-profile', parsed_output: 'not json at all', raw_output: 'x' },
      ],
    });

    // Raw string can't supply object fields → no throw, fields undefined.
    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx).not.toBeNull();
    expect(ctx?.category).toBeUndefined();
  });

  it('uses raw_output when parsed_output is null', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-selling-points',
          parsed_output: null,
          raw_output: JSON.stringify({ usps: ['Fast', 'Cheap', 'Good'] }),
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.usps).toEqual(['Fast', 'Cheap', 'Good']);
  });

  it('keeps the first research row per task_name (dedupe by task, newest-first)', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-profile',
          parsed_output: JSON.stringify({ category: 'newest' }),
          raw_output: '{}',
        },
        {
          task_name: 'research-profile',
          parsed_output: JSON.stringify({ category: 'older' }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.category).toBe('newest');
  });
});

// ---------------------------------------------------------------------------
// Build snapshot fetch
// ---------------------------------------------------------------------------
describe('gatherProfileContext — build snapshot (R2)', () => {
  it('merges brand colors / fonts / selling points from the build snapshot', async () => {
    const { env, r2Get } = makeEnv({
      r2Body: {
        research: {
          brand: { colors: ['#abc'], fonts: { heading: 'Sora', body: 'Inter' }, tone: 'bold' },
          sellingPoints: { usps: ['A', 'B'] },
          profile: { services: ['Cut', 'Color'] },
        },
      },
    });
    wireDb({ site: siteRow({ slug: 'acme' }) });

    const ctx = await gatherProfileContext(env, SITE_ID);

    expect(r2Get).toHaveBeenCalledWith('sites/acme/assets/_build-context.json');
    expect(ctx?.brand_colors).toEqual(['#abc']);
    expect(ctx?.brand_fonts).toEqual({ heading: 'Sora', body: 'Inter' });
    expect(ctx?.brand_tone).toBe('bold');
    expect(ctx?.usps).toEqual(['A', 'B']);
    expect(ctx?.services).toEqual(['Cut', 'Color']);
  });

  it('treats a missing R2 object as no snapshot (fields undefined, no throw)', async () => {
    const { env } = makeEnv({ r2Body: null });
    wireDb({ site: siteRow() });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx).not.toBeNull();
    expect(ctx?.brand_colors).toBeUndefined();
  });

  it('swallows an R2 read throw (.catch on the fetch) and still returns a context', async () => {
    const { env } = makeEnv({ r2Throws: true });
    wireDb({ site: siteRow() });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.business_name).toBe('Acme Co');
  });
});

// ---------------------------------------------------------------------------
// Hostname resolution
// ---------------------------------------------------------------------------
describe('gatherProfileContext — primary hostname', () => {
  it('uses the active custom hostname when one exists', async () => {
    const { env } = makeEnv();
    wireDb({ site: siteRow(), hostname: { hostname: 'acme.com' } });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.primary_hostname).toBe('acme.com');
  });

  it('falls back to {slug}.projectsites.dev when no active hostname row exists', async () => {
    const { env } = makeEnv();
    wireDb({ site: siteRow({ slug: 'vito' }), hostname: null });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.primary_hostname).toBe('vito.projectsites.dev');
  });

  it('falls back to the default hostname when the hostname query throws', async () => {
    const { env } = makeEnv();
    wireDb({ site: siteRow({ slug: 'fallback' }), hostnameThrows: true });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.primary_hostname).toBe('fallback.projectsites.dev');
  });
});

// ---------------------------------------------------------------------------
// extractStringArray (exercised via brand_colors / usps / services)
// ---------------------------------------------------------------------------
describe('gatherProfileContext — string-array normalization', () => {
  it('coerces a comma/semicolon/newline-delimited confidence string into an array', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      confidence: [{ attribute_name: 'services', attribute_value: 'Cut; Color, Wash\nBeard', confidence: 0.5 }],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.services).toEqual(['Cut', 'Color', 'Wash', 'Beard']);
  });

  it('parses a JSON-array string from confidence into an array', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      confidence: [{ attribute_name: 'brand_colors', attribute_value: '["#0a0","#b0b"]', confidence: 0.5 }],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.brand_colors).toEqual(['#0a0', '#b0b']);
  });

  it('serializes object entries inside a research array and caps the list at 8', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-selling-points',
          parsed_output: JSON.stringify({
            usps: [
              'one',
              { label: 'objectified' },
              'three',
              'four',
              'five',
              'six',
              'seven',
              'eight',
              'nine-dropped',
              'ten-dropped',
            ],
          }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.usps).toHaveLength(8);
    expect(ctx?.usps?.[0]).toBe('one');
    // Object entry is JSON.stringify'd, not dropped.
    expect(ctx?.usps?.[1]).toBe('{"label":"objectified"}');
    expect(ctx?.usps).not.toContain('nine-dropped');
  });

  it('treats a falsy / unsupported value as an empty array (field omitted)', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-selling-points',
          parsed_output: JSON.stringify({ usps: 42 }), // number → []
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.usps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractFonts (via brand_fonts)
// ---------------------------------------------------------------------------
describe('gatherProfileContext — font extraction', () => {
  it('resolves heading/body via the display/primary/secondary aliases', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-brand',
          parsed_output: JSON.stringify({ fonts: { display: 'Cabinet', secondary: 'Hind' } }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.brand_fonts).toEqual({ heading: 'Cabinet', body: 'Hind' });
  });

  it('returns brand_fonts undefined when neither heading nor body slot is populated', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-brand',
          parsed_output: JSON.stringify({ fonts: { weight: 700 } }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.brand_fonts).toBeUndefined();
  });

  it('returns brand_fonts undefined when the fonts payload is not an object', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow(),
      research: [
        {
          task_name: 'research-brand',
          parsed_output: JSON.stringify({ fonts: 'Inter' }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    expect(ctx?.brand_fonts).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deriveKeywords
// ---------------------------------------------------------------------------
describe('gatherProfileContext — keyword derivation', () => {
  it('lowercases, filters stopwords + short + numeric tokens, dedupes, caps at 12', async () => {
    const { env } = makeEnv();
    wireDb({
      site: siteRow({ business_name: 'The Best Barber Shop' }),
      confidence: [
        { attribute_name: 'category', attribute_value: 'Barber', confidence: 0.9 },
      ],
      research: [
        {
          task_name: 'research-profile',
          parsed_output: JSON.stringify({
            services: ['fade', 'fade', 'beard trim', '2024'],
            description: 'we cut hair and we style beards for the whole family in town',
          }),
          raw_output: '{}',
        },
      ],
    });

    const ctx = await gatherProfileContext(env, SITE_ID);
    const kw = ctx?.recent_keywords ?? [];

    expect(kw).toContain('best');
    expect(kw).toContain('barber');
    expect(kw).toContain('shop');
    expect(kw).toContain('fade');
    expect(kw).toContain('beard');
    // Stopword "the" dropped; "we"/"and"/"for" dropped.
    expect(kw).not.toContain('the');
    expect(kw).not.toContain('we');
    // Pure-numeric token dropped.
    expect(kw).not.toContain('2024');
    // Deduped (fade appears once) and capped.
    expect(new Set(kw).size).toBe(kw.length);
    expect(kw.length).toBeLessThanOrEqual(12);
  });
});
