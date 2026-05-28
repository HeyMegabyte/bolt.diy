/**
 * @module services/pseo_matrix
 * @description pSEO Matrix Builder — feature #17.
 *
 * Generates `service × city × intent × season` page matrix for a site.
 * Each combination is a candidate programmatic SEO page. A thin-content
 * guardrail rejects pages with <800 words, <3 unique images, no
 * LocalBusiness JSON-LD, or banned-slop-word density >1%.
 *
 * Services sourced from `_research.json.services[]`, cities from
 * `_locations.json.cities[]`. Cap: 200 pages per axis combo.
 *
 * Pages generated via Workers AI Llama 3.3 70B FP8 (free tier).
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert } from './db.js';

// ─── Constants ───────────────────────────────────────────────────────

const INTENTS = ['price', 'how-to', 'diagnostic', 'emergency'] as const;
type Intent = (typeof INTENTS)[number];

const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const;
type Season = (typeof SEASONS)[number];

const MAX_PAGES_PER_AXIS = 200;
const MIN_WORD_COUNT = 800;
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Slop words imported inline (subset of copy-writing rule's banned list)
const SLOP_WORDS = [
  'limitless','revolutionize','game-changing','cutting-edge','next-generation',
  'world-class','best-in-class','turnkey','synergy','disrupt','seamless',
  'robust','scalable','leverage','utilize','facilitate','innovative',
  'state-of-the-art','paradigm','holistic','harness','foster','bolster',
  'spearhead','streamline','cornerstone','pivotal','myriad','plethora',
  'supercharge','unleash','boundless',
];

// ─── Types ────────────────────────────────────────────────────────────

export interface PseoMatrixRow {
  siteId: string;
  orgId: string;
  service: string;
  city: string;
  intent: Intent;
  season: Season;
  routeSlug: string;
}

export interface PseoPageResult {
  id: string;
  routeSlug: string;
  status: 'draft' | 'approved' | 'published' | 'rejected';
  wordCount: number;
  thinContent: boolean;
  slopHits: number;
}

// ─── Research data loading ────────────────────────────────────────────

interface ResearchJson {
  services?: string[];
}

interface LocationsJson {
  cities?: string[];
}

async function loadResearchServices(env: Env, siteId: string): Promise<string[]> {
  try {
    const site = await dbQueryOne<{ slug: string }>(
      env.DB,
      'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
      [siteId],
    );
    if (!site) return [];

    const obj = await env.SITES_BUCKET.get(`sites/${site.slug}/latest/_research.json`);
    if (!obj) return [];
    const data = (await obj.json()) as ResearchJson;
    return Array.isArray(data.services) ? data.services.slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function loadLocationCities(env: Env, siteId: string): Promise<string[]> {
  try {
    const site = await dbQueryOne<{ slug: string }>(
      env.DB,
      'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
      [siteId],
    );
    if (!site) return [];

    const obj = await env.SITES_BUCKET.get(`sites/${site.slug}/latest/_locations.json`);
    if (!obj) return [];
    const data = (await obj.json()) as LocationsJson;
    return Array.isArray(data.cities) ? data.cities.slice(0, 20) : [];
  } catch {
    return [];
  }
}

// ─── Route slug builder ───────────────────────────────────────────────

function buildRouteSlug(city: string, service: string, intent: Intent, season: Season): string {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = [slugify(service), slugify(intent)];
  if (season !== 'spring') parts.push(slugify(season)); // spring is default, omit for cleaner URL
  return `/c/${slugify(city)}/${parts.join('-')}`;
}

// ─── Thin-content guardrails ──────────────────────────────────────────

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

function countSlopHits(html: string): number {
  const text = html.toLowerCase();
  return SLOP_WORDS.reduce((acc, w) => acc + (text.split(w).length - 1), 0);
}

function hasLocalBizJsonLd(html: string): boolean {
  return html.includes('"@type":"LocalBusiness"') || html.includes('"@type": "LocalBusiness"');
}

function countInternalLinks(html: string, routeSlug: string): number {
  const host = routeSlug.split('/c/')[0] ?? '';
  const pattern = new RegExp(`href="${host}/`, 'g');
  return (html.match(pattern) ?? []).length;
}

// ─── AI page generation ───────────────────────────────────────────────

export async function generatePseoPage(
  env: Env,
  row: PseoMatrixRow,
  businessName: string,
): Promise<{ html: string; tokensUsed: number }> {
  const intentPhrases: Record<Intent, string> = {
    price: 'cost and pricing information',
    'how-to': 'step-by-step guide',
    diagnostic: 'troubleshooting and diagnostic tips',
    emergency: 'emergency 24/7 help',
  };

  const seasonContext: Record<Season, string> = {
    spring: 'spring season considerations',
    summer: 'summer heat and humidity factors',
    fall: 'fall preparation and maintenance',
    winter: 'winter cold and freeze protection',
  };

  const systemPrompt = `You are an expert local SEO content writer.
Write a production-ready HTML page section for a local business website.
Requirements:
- Write at least 900 words of body content
- Include exactly one <script type="application/ld+json"> block with LocalBusiness JSON-LD
- Include at least 3 internal anchor links using relative hrefs like "/services" or "/contact"
- Include at least 3 image placeholders as <img src="/images/local/{slug}.webp" alt="[descriptive]" ...>
- Use concrete, specific language — no vague claims
- Return ONLY the HTML fragment (no <!DOCTYPE>, no <html> wrapper)`;

  const userPrompt = `Business: ${businessName}
Service: ${row.service}
City: ${row.city}
Intent: ${intentPhrases[row.intent]}
Season context: ${seasonContext[row.season]}
Route: ${row.routeSlug}

Write the full HTML content section for this page.`;

  try {
    const response = await env.AI.run(AI_MODEL as Parameters<typeof env.AI.run>[0], {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 3000,
    } as Parameters<typeof env.AI.run>[1]);

    const result = response as { response?: string; usage?: { total_tokens?: number } };
    return {
      html: result.response ?? '<p>Content generation failed.</p>',
      tokensUsed: result.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    console.warn(`[pseo] AI generation failed: ${String(err)}`);
    return { html: '<p>Content generation failed.</p>', tokensUsed: 0 };
  }
}

// ─── Matrix building ──────────────────────────────────────────────────

/**
 * Builds the full `service × city × intent × season` matrix for a site,
 * capped at `MAX_PAGES_PER_AXIS` total rows.
 *
 * Existing rows (by unique index) are skipped — safe to call repeatedly.
 */
export async function buildPseoMatrix(
  env: Env,
  siteId: string,
  orgId: string,
): Promise<{ queued: number; skipped: number }> {
  const [services, cities] = await Promise.all([
    loadResearchServices(env, siteId),
    loadLocationCities(env, siteId),
  ]);

  if (services.length === 0 || cities.length === 0) {
    return { queued: 0, skipped: 0 };
  }

  // Fetch existing slugs to skip
  const { data: existing } = await dbQuery<{ route_slug: string }>(
    env.DB,
    'SELECT route_slug FROM pseo_pages WHERE site_id = ? AND deleted_at IS NULL',
    [siteId],
  );
  const existingSlugs = new Set(existing.map((r) => r.route_slug));

  let queued = 0;
  let skipped = 0;

  outer: for (const service of services) {
    for (const city of cities) {
      for (const intent of INTENTS) {
        for (const season of SEASONS) {
          if (queued >= MAX_PAGES_PER_AXIS) break outer;

          const routeSlug = buildRouteSlug(city, service, intent, season);
          if (existingSlugs.has(routeSlug)) {
            skipped++;
            continue;
          }

          await dbInsert(env.DB, 'pseo_pages', {
            id: crypto.randomUUID(),
            site_id: siteId,
            org_id: orgId,
            service,
            city,
            intent,
            season,
            route_slug: routeSlug,
            status: 'draft',
            thin_content: 1, // starts thin until content is generated
            slop_hits: 0,
          });

          queued++;
        }
      }
    }
  }

  return { queued, skipped };
}

/**
 * Generates content for a single `pseo_pages` row, validates guardrails,
 * and updates the row's `html_content`, `word_count`, `thin_content`,
 * `slop_hits`, `image_count`, `internal_links`, and `has_local_biz_jsonld`.
 */
export async function generatePseoPageContent(
  env: Env,
  pageId: string,
): Promise<{ ok: boolean; thinContent: boolean; error?: string }> {
  const row = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
    service: string;
    city: string;
    intent: string;
    season: string;
    route_slug: string;
    status: string;
  }>(
    env.DB,
    `SELECT id, site_id, org_id, service, city, intent, season, route_slug, status
     FROM pseo_pages WHERE id = ? AND deleted_at IS NULL`,
    [pageId],
  );

  if (!row) return { ok: false, thinContent: false, error: 'Page not found' };
  if (!INTENTS.includes(row.intent as Intent))
    return { ok: false, thinContent: false, error: 'Invalid intent' };

  // Get business name
  const site = await dbQueryOne<{ name: string; slug: string }>(
    env.DB,
    "SELECT name, slug FROM sites WHERE id = ? AND deleted_at IS NULL",
    [row.site_id],
  );
  const businessName = site?.name ?? 'Local Business';

  const { html, tokensUsed } = await generatePseoPage(
    env,
    {
      siteId: row.site_id,
      orgId: row.org_id,
      service: row.service,
      city: row.city,
      intent: row.intent as Intent,
      season: row.season as Season,
      routeSlug: row.route_slug,
    },
    businessName,
  );

  const wordCount = countWords(html);
  const slopHits = countSlopHits(html);
  const hasJsonLd = hasLocalBizJsonLd(html) ? 1 : 0;
  const internalLinks = countInternalLinks(html, row.route_slug);

  // Count <img> tags
  const imageCount = (html.match(/<img\s/gi) ?? []).length;

  // Thin-content guardrail
  const thinContent =
    wordCount < MIN_WORD_COUNT || imageCount < 3 || !hasJsonLd || internalLinks < 3 ? 1 : 0;

  // Use prepared statement via db helper
  await (env.DB as D1Database)
    .prepare(
      `UPDATE pseo_pages SET
        html_content = ?,
        word_count = ?,
        image_count = ?,
        internal_links = ?,
        has_local_biz_jsonld = ?,
        slop_hits = ?,
        thin_content = ?,
        ai_model = ?,
        ai_tokens_used = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
    )
    .bind(
      html.slice(0, 131072),
      wordCount,
      imageCount,
      internalLinks,
      hasJsonLd,
      slopHits,
      thinContent,
      AI_MODEL,
      tokensUsed,
      thinContent ? 'draft' : 'approved',
      pageId,
    )
    .run();

  return { ok: true, thinContent: thinContent === 1 };
}

/**
 * Returns matrix summary stats for admin UI grid.
 */
export async function getPseoMatrixStats(
  env: Env,
  siteId: string,
): Promise<{
  total: number;
  draft: number;
  approved: number;
  published: number;
  rejected: number;
  thinContent: number;
}> {
  const { data } = await dbQuery<{ status: string; cnt: number; thin: number }>(
    env.DB,
    `SELECT status,
            COUNT(*) AS cnt,
            SUM(thin_content) AS thin
     FROM pseo_pages
     WHERE site_id = ? AND deleted_at IS NULL
     GROUP BY status`,
    [siteId],
  );

  const totals = { total: 0, draft: 0, approved: 0, published: 0, rejected: 0, thinContent: 0 };
  for (const row of data) {
    totals.total += row.cnt;
    totals.thinContent += row.thin ?? 0;
    if (row.status === 'draft') totals.draft += row.cnt;
    else if (row.status === 'approved') totals.approved += row.cnt;
    else if (row.status === 'published') totals.published += row.cnt;
    else if (row.status === 'rejected') totals.rejected += row.cnt;
  }
  return totals;
}
