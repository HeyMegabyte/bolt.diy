/**
 * Unit tests for the SEO/GEO Autopilot service (feature #23).
 *
 * Covers:
 *   - generateSeoMeta clamps title ≤60, description ≤156, answerBlock 40-60 words
 *   - buildJsonLd returns WebPage by default + omits FAQPage when no Q&A
 *   - buildJsonLd emits FAQPage only with real Q&A
 *   - the fp8-fast model alias is used (never the retired bare alias)
 *   - freshenSite persists a draft with status 'pending'
 *   - approveDraft advances status + applyToSite is the D1-only hook
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import {
  AI_MODEL,
  approveDraft,
  buildJsonLd,
  clampAnswerBlock,
  clampDescription,
  clampTitle,
  freshenSite,
  generateSeoMeta,
  siteOrgId,
} from '../services/seo_autopilot.js';
import { seoAutopilot } from '../routes/seo_autopilot.js';
import { authApp, harnessEnv } from './helpers/route_harness.js';
import {
  ANSWER_WORDS_MAX,
  ANSWER_WORDS_MIN,
  countWords,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  SeoMetaSchema,
  TITLE_MAX,
  TITLE_MIN,
} from '../../libs/features/seo_autopilot/feature.schemas.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

/** Build a mock Env whose AI.run returns the supplied JSON reply. */
function makeEnv(reply: unknown, capture?: (model: string) => void) {
  const aiRun = jest.fn(async (model: string) => {
    if (capture) capture(model);
    return {
      response: typeof reply === 'string' ? reply : JSON.stringify(reply),
      usage: { total_tokens: 42 },
    };
  });
  return {
    DB: {} as D1Database,
    AI: { run: aiRun } as unknown as Ai,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

// ---------------------------------------------------------------------------
// Length-clamp helpers (pure)
// ---------------------------------------------------------------------------
describe('clamp helpers', () => {
  it('clampTitle truncates over-long titles to ≤60 chars', () => {
    const long = 'A'.repeat(120) + ' word boundary here that should be cut off cleanly';
    const out = clampTitle(long, 'Pad text for the title');
    expect(out.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(out.length).toBeGreaterThanOrEqual(TITLE_MIN);
  });

  it('clampTitle pads short titles up to ≥50 chars', () => {
    const out = clampTitle('Tiny', 'Newark soup kitchen serving warm dignified meals daily');
    expect(out.length).toBeGreaterThanOrEqual(TITLE_MIN);
    expect(out.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it('clampDescription keeps result ≤156 chars', () => {
    const long = 'word '.repeat(200);
    const out = clampDescription(long, 'padding source text');
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  });

  it('clampAnswerBlock keeps word count within 40-60', () => {
    const tooLong = 'word '.repeat(120);
    const out = clampAnswerBlock(tooLong, 'fallback padding words for the block');
    expect(countWords(out)).toBeLessThanOrEqual(ANSWER_WORDS_MAX);
    expect(countWords(out)).toBeGreaterThanOrEqual(ANSWER_WORDS_MIN);
  });

  it('clampAnswerBlock pads short text up to ≥40 words', () => {
    const out = clampAnswerBlock(
      'Short answer.',
      'extra context words to pad the answer block out to forty',
    );
    expect(countWords(out)).toBeGreaterThanOrEqual(ANSWER_WORDS_MIN);
  });

  it('clampAnswerBlock reaches floor even with empty pad', () => {
    const out = clampAnswerBlock('two words', '');
    expect(countWords(out)).toBeGreaterThanOrEqual(ANSWER_WORDS_MIN);
  });
});

// ---------------------------------------------------------------------------
// generateSeoMeta
// ---------------------------------------------------------------------------
describe('generateSeoMeta', () => {
  it('clamps title ≤60 and description ≤156 and answerBlock 40-60 words', async () => {
    const env = makeEnv({
      title: 'X'.repeat(200),
      description: 'Y '.repeat(200),
      answerBlock: 'z '.repeat(200),
    });

    const meta = await generateSeoMeta(env, {
      siteId: 'site_1',
      route: '/services',
      pageText:
        'Our services include plumbing, heating, and emergency repair across Newark and the surrounding towns.',
    });

    expect(meta.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(meta.title.length).toBeGreaterThanOrEqual(TITLE_MIN);
    expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(meta.description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    expect(countWords(meta.answerBlock)).toBeGreaterThanOrEqual(ANSWER_WORDS_MIN);
    expect(countWords(meta.answerBlock)).toBeLessThanOrEqual(ANSWER_WORDS_MAX);
    // Result must satisfy the schema (clamp correctness).
    expect(() => SeoMetaSchema.parse(meta)).not.toThrow();
  });

  it('uses the fp8-fast model alias, never the retired bare alias', async () => {
    let usedModel = '';
    const env = makeEnv(
      { title: 'A clean SEO title for the home route', description: 'desc', answerBlock: 'short' },
      (m) => {
        usedModel = m;
      },
    );

    await generateSeoMeta(env, {
      siteId: 'site_1',
      route: '/',
      pageText: 'Homepage copy goes here for context.',
    });

    expect(usedModel).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(AI_MODEL).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(usedModel).not.toBe('@cf/meta/llama-3.3-70b-instruct');
  });

  it('survives AI failure by falling back to clamped defaults', async () => {
    const env = {
      DB: {} as D1Database,
      AI: { run: jest.fn().mockRejectedValue(new Error('AI down')) } as unknown as Ai,
    } as any;

    const meta = await generateSeoMeta(env, {
      siteId: 'site_1',
      route: '/about',
      pageText:
        'About our long-running family business serving the local community since nineteen ninety two with pride.',
    });

    expect(() => SeoMetaSchema.parse(meta)).not.toThrow();
    expect(meta.title.length).toBeGreaterThanOrEqual(TITLE_MIN);
  });
});

// ---------------------------------------------------------------------------
// buildJsonLd
// ---------------------------------------------------------------------------
describe('buildJsonLd', () => {
  it('returns WebPage by default and omits FAQPage when no Q&A', async () => {
    const env = makeEnv({});
    const ld = await buildJsonLd(env, {
      siteId: 'site_1',
      route: '/about',
      kind: 'WebPage',
      faqs: [],
    });

    expect(ld['@type']).toBe('WebPage');
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld.mainEntity).toBeUndefined();
  });

  it('falls back to WebPage when FAQPage requested but no real Q&A', async () => {
    const env = makeEnv({});
    const ld = await buildJsonLd(env, {
      siteId: 'site_1',
      route: '/faq',
      kind: 'FAQPage',
      faqs: [],
    });

    expect(ld['@type']).toBe('WebPage');
    expect(ld.mainEntity).toBeUndefined();
  });

  it('emits FAQPage only when real Q&A is supplied', async () => {
    const env = makeEnv({});
    const ld = await buildJsonLd(env, {
      siteId: 'site_1',
      route: '/faq',
      kind: 'FAQPage',
      faqs: [{ question: 'What are your hours?', answer: 'Mon-Fri 9am to 5pm.' }],
    });

    expect(ld['@type']).toBe('FAQPage');
    expect(Array.isArray(ld.mainEntity)).toBe(true);
    expect((ld.mainEntity as unknown[]).length).toBe(1);
  });

  it('does not fabricate FAQPage from blank Q&A entries', async () => {
    const env = makeEnv({});
    const ld = await buildJsonLd(env, {
      siteId: 'site_1',
      route: '/faq',
      kind: 'FAQPage',
      faqs: [{ question: '   ', answer: '' }],
    });

    expect(ld['@type']).toBe('WebPage');
  });
});

// ---------------------------------------------------------------------------
// freshenSite
// ---------------------------------------------------------------------------
describe('freshenSite', () => {
  it('persists a draft with status pending for each route', async () => {
    const env = makeEnv({
      title: 'A solid SEO title describing the homepage clearly',
      description: 'A meta description for the homepage that lands inside the bounds.',
      answerBlock: 'short',
    });

    const summary = await freshenSite(env, 'site_1', {
      orgId: 'org_1',
      routes: [
        {
          route: '/',
          pageText: 'Welcome to our homepage with plenty of descriptive context copy here.',
        },
      ],
    });

    expect(summary.draftsCreated).toBe(1);
    expect(summary.routesProcessed).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);

    const [, table, row] = mockInsert.mock.calls[0];
    expect(table).toBe('seo_meta_drafts');
    expect(row).toEqual(
      expect.objectContaining({
        site_id: 'site_1',
        org_id: 'org_1',
        route: '/',
        status: 'pending',
        ai_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      }),
    );
    expect(typeof (row as Record<string, unknown>).jsonld_json).toBe('string');
  });

  it('falls back to homepage route when none provided and no prior drafts', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });
    const env = makeEnv({
      title: 'Homepage SEO title that fits inside the fifty to sixty bound',
      description:
        'Homepage description copy that sits inside the one twenty to one fifty six char window nicely.',
      answerBlock: 'short',
    });

    const summary = await freshenSite(env, 'site_2', { orgId: null });

    expect(summary.routesProcessed).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, , row] = mockInsert.mock.calls[0];
    expect((row as Record<string, unknown>).route).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// approveDraft / applyToSite
// ---------------------------------------------------------------------------
describe('approveDraft', () => {
  it('advances a pending draft to approved and applies it', async () => {
    // 1st queryOne: approveDraft fetches the draft. 2nd: applyToSite re-fetches.
    mockQueryOne
      .mockResolvedValueOnce({ id: 'd1', site_id: 'site_1', status: 'pending' } as any)
      .mockResolvedValueOnce({ id: 'd1', status: 'approved' } as any);

    const env = makeEnv({});
    const result = await approveDraft(env, 'd1', 'user_1');

    expect(result.ok).toBe(true);
    expect(result.draft?.status).toBe('approved');
    expect(result.draft?.approved_by).toBe('user_1');
    // update fired twice: once to 'approved', once to 'applied' in applyToSite.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[0][2]).toEqual(
      expect.objectContaining({ status: 'approved', approved_by: 'user_1' }),
    );
    expect(mockUpdate.mock.calls[1][2]).toEqual(expect.objectContaining({ status: 'applied' }));
  });

  it('rejects approval for a missing draft', async () => {
    mockQueryOne.mockResolvedValue(null);
    const env = makeEnv({});
    const result = await approveDraft(env, 'nope', 'user_1');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Draft not found');
  });

  it('rejects approval for a non-pending draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'd1', site_id: 'site_1', status: 'approved' } as any);
    const env = makeEnv({});
    const result = await approveDraft(env, 'd1', 'user_1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already');
  });
});

// ---------------------------------------------------------------------------
// siteOrgId (tenant-ownership resolver)
// ---------------------------------------------------------------------------
describe('siteOrgId', () => {
  it('returns the owning org for an existing site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org_7' } as any);
    expect(await siteOrgId({ DB: {} } as any, 'site_1')).toBe('org_7');
  });
  it('returns undefined for a missing site', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await siteOrgId({ DB: {} } as any, 'ghost')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Route layer: tenant isolation on :siteId routes
// ---------------------------------------------------------------------------
describe('seo_autopilot handler (route layer — tenant isolation)', () => {
  // db.js is globally mocked, so the route's siteOrgId/dbQuery calls resolve via
  // mockQueryOne/mockQuery. isFlagOn reads CACHE_KV (flagKv); on the flag-OFF
  // path it falls through to env.DB.prepare — this stub makes that resolve to
  // the registry default (off) instead of throwing.
  const routeDb = () =>
    ({
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: {} }),
        }),
      }),
    }) as unknown as D1Database;

  it('401 when unauthenticated', async () => {
    const app = authApp(seoAutopilot);
    const res = await app.request('/site1/drafts', {}, harnessEnv(routeDb(), true));
    expect(res.status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(seoAutopilot, { userId: 'u', orgId: 'org-a' });
    const res = await app.request('/site1/drafts', {}, harnessEnv(routeDb(), false));
    expect(res.status).toBe(404);
  });

  it('404 listing drafts for a site owned by another org', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as any); // siteOrgId
    const app = authApp(seoAutopilot, { userId: 'u', orgId: 'org-a' });
    const res = await app.request('/site1/drafts', {}, harnessEnv(routeDb(), true));
    expect(res.status).toBe(404);
  });

  it('200 listing drafts for an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as any); // siteOrgId
    mockQuery.mockResolvedValueOnce({ data: [], error: null });
    const app = authApp(seoAutopilot, { userId: 'u', orgId: 'org-a' });
    const res = await app.request('/site1/drafts', {}, harnessEnv(routeDb(), true));
    expect(res.status).toBe(200);
  });

  it('404 approving a draft owned by another org', async () => {
    mockQueryOne.mockResolvedValueOnce({ site_id: 'site1', org_id: 'OTHER_ORG' } as any);
    const app = authApp(seoAutopilot, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/drafts/d1/approve',
      { method: 'POST' },
      harnessEnv(routeDb(), true),
    );
    expect(res.status).toBe(404);
  });
});
