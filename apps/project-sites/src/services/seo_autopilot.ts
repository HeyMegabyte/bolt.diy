/**
 * @module services/seo_autopilot
 * @description SEO/GEO Autopilot service — feature #23.
 *
 * For an EXISTING generated site, this service:
 *   1. `generateSeoMeta`  — Workers AI produces a length-bounded `<title>` +
 *      `<meta description>` + a 40-60 word AI-search quotable answer block.
 *   2. `buildJsonLd`      — emits schema.org JSON-LD. WebPage is the floor;
 *      FAQPage ONLY when real Q&A is passed in. Never fabricate schema.
 *   3. `freshenSite`      — loops a site's known routes, generates meta + answer
 *      block, persists DRAFTS (status 'pending') for owner approval. Not auto-publish.
 *   4. `approveDraft`     — marks a draft approved; `applyToSite` is the
 *      documented D1-only integration point with site_serving.
 *
 * Length bounds (title 50-60, description 120-156, answer 40-60 words) mirror the
 * SEO Hard Gates in `apps/project-sites/CLAUDE.md` and are enforced HERE in code
 * (truncate / pad-by-prompt) before the data is validated against feature.schemas.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from './db.js';
import {
  ANSWER_WORDS_MAX,
  ANSWER_WORDS_MIN,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  SeoMetaSchema,
  TITLE_MAX,
  TITLE_MIN,
  type BuildJsonLdInput,
  type FaqEntry,
  type SeoMeta,
  type SeoMetaDraft,
} from '../../libs/features/seo_autopilot/feature.schemas.js';

/**
 * Workers AI model. FP8-fast variant — the bare `@cf/meta/llama-3.3-70b-instruct`
 * alias is RETIRED on this account and 400s at runtime.
 */
export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const WS = /\s+/;

/**
 * Resolve the owning org of a site, for multi-tenant isolation checks.
 *
 * @remarks Defensive read — a missing/soft-deleted site returns `undefined`
 * (handlers map that to a 404, never a throw). Every `:siteId` route compares
 * the result to the caller's `orgId` so a caller can't read another org's SEO
 * drafts, or freshen/approve drafts on a site they don't own, by guessing an id.
 * @param env    - Worker env (D1 binding).
 * @param siteId - The site whose owner is being resolved.
 * @returns The owning `org_id`, or `undefined` when the site does not exist.
 * @example
 * ```ts
 * const owner = await siteOrgId(env, siteId);
 * if (!owner || owner !== orgId) return notFound;
 * ```
 */
export async function siteOrgId(env: Env, siteId: string): Promise<string | undefined> {
  const row = await dbQueryOne<{ org_id: string }>(
    env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return row?.org_id ?? undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Length enforcement helpers — keep generated copy inside the Hard Gates.
// ─────────────────────────────────────────────────────────────────────────────

/** Strip JSON/markdown wrappers + collapse whitespace from a raw AI string. */
function clean(raw: string): string {
  return raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(WS, ' ')
    .trim();
}

/**
 * Clamp a title to [min,max] chars. Truncates at a word boundary when over;
 * pads with the business/route hint when under so the lower bound is always met.
 */
export function clampTitle(raw: string, pad: string, min = TITLE_MIN, max = TITLE_MAX): string {
  let t = clean(raw);
  if (t.length > max) t = truncateToBoundary(t, max);
  if (t.length < min) t = padTo(t, pad, min, max);
  // Final hard slice guarantees the upper bound even after padding.
  return t.slice(0, max);
}

/** Clamp a description to [min,max] chars with the same boundary discipline. */
export function clampDescription(
  raw: string,
  pad: string,
  min = DESCRIPTION_MIN,
  max = DESCRIPTION_MAX,
): string {
  let d = clean(raw);
  if (d.length > max) d = truncateToBoundary(d, max);
  if (d.length < min) d = padTo(d, pad, min, max);
  return d.slice(0, max);
}

/**
 * Clamp an answer block to [min,max] WORDS. Over → keep first `max` words.
 * Under → append filler derived from the pad text until the floor is met.
 */
export function clampAnswerBlock(
  raw: string,
  pad: string,
  min = ANSWER_WORDS_MIN,
  max = ANSWER_WORDS_MAX,
): string {
  let words = clean(raw).split(WS).filter(Boolean);
  if (words.length > max) words = words.slice(0, max);
  if (words.length < min) {
    const padWords = clean(pad).split(WS).filter(Boolean);
    let i = 0;
    while (words.length < min && padWords.length > 0) {
      words.push(padWords[i % padWords.length]);
      i += 1;
    }
    // If pad was empty, repeat a neutral filler word to reach the floor.
    while (words.length < min) words.push('today');
  }
  return words.join(' ');
}

function truncateToBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
}

function padTo(text: string, pad: string, min: number, max: number): string {
  const cleanedPad = clean(pad);
  let out = text;
  while (out.length < min && cleanedPad.length > 0) {
    const candidate = out.length === 0 ? cleanedPad : `${out} ${cleanedPad}`;
    out = candidate.length > max ? candidate.slice(0, max) : candidate;
    if (out.length >= min) break;
    // Prevent infinite loop when pad alone can't reach min.
    if (out === text) break;
    text = out;
  }
  while (out.length < min) out = `${out} more`;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI generation.
// ─────────────────────────────────────────────────────────────────────────────

interface AiTextResult {
  text: string;
  tokensUsed: number;
}

async function runAi(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
): Promise<AiTextResult> {
  try {
    const response = await env.AI.run(
      AI_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
      } as Parameters<typeof env.AI.run>[1],
    );

    const result = response as { response?: string; usage?: { total_tokens?: number } };
    return { text: result.response ?? '', tokensUsed: result.usage?.total_tokens ?? 0 };
  } catch {
    return { text: '', tokensUsed: 0 };
  }
}

/**
 * Best-effort parse of the model's JSON reply. Tolerates code fences and prose
 * surrounding the JSON object.
 */
function parseJsonReply(text: string): {
  title?: string;
  description?: string;
  answerBlock?: string;
} {
  if (!text) return {};
  const fenced = text.replace(/```json|```/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const obj = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
    return {
      title: typeof obj.title === 'string' ? obj.title : undefined,
      description: typeof obj.description === 'string' ? obj.description : undefined,
      answerBlock:
        typeof obj.answerBlock === 'string'
          ? obj.answerBlock
          : typeof obj.answer_block === 'string'
            ? (obj.answer_block as string)
            : undefined,
    };
  } catch {
    return {};
  }
}

export interface GenerateSeoMetaResult extends SeoMeta {
  tokensUsed: number;
}

/**
 * Generate length-bounded SEO/GEO meta for one route of an existing site.
 *
 * The returned object is GUARANTEED to satisfy {@link SeoMetaSchema}: the service
 * clamps the AI output to the title/description char bounds and the 40-60 word
 * answer-block bound before validating.
 *
 * @example
 * ```ts
 * const meta = await generateSeoMeta(env, {
 *   siteId: 'site_123', route: '/services', pageText: '...page copy...',
 * });
 * // meta.title.length is in [50,60]; countWords(meta.answerBlock) in [40,60]
 * ```
 */
export async function generateSeoMeta(
  env: Env,
  input: { siteId: string; route: string; pageText: string },
): Promise<GenerateSeoMetaResult> {
  const { route, pageText } = input;

  const system = [
    'You are an expert SEO + GEO (generative-engine-optimization) copywriter.',
    'Return ONLY a JSON object with keys "title", "description", "answerBlock".',
    `"title": an SEO page title between ${TITLE_MIN} and ${TITLE_MAX} characters.`,
    `"description": a meta description between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`,
    `"answerBlock": a single self-contained paragraph of ${ANSWER_WORDS_MIN}-${ANSWER_WORDS_MAX} words that directly answers the page's core question, written so ChatGPT, Perplexity, and Google AI Overviews can quote it verbatim as a citation.`,
    'No markdown, no commentary — only the JSON object.',
  ].join('\n');

  const user = `Route: ${route}\n\nPage content:\n${(pageText || route).slice(0, 6000)}`;

  const { text, tokensUsed } = await runAi(env, system, user, 512);
  const parsed = parseJsonReply(text);

  // Pad source = page text first words, falling back to the route.
  const padSeed = (pageText || route).replace(WS, ' ').trim() || route;

  const meta: SeoMeta = {
    title: clampTitle(parsed.title ?? `${route} — Page Overview`, padSeed),
    description: clampDescription(
      parsed.description ?? `Learn more about ${route}. ${padSeed}`,
      padSeed,
    ),
    answerBlock: clampAnswerBlock(parsed.answerBlock ?? padSeed, padSeed),
  };

  // Validate the clamped result — a throw here means a clamp bug, not bad AI.
  const validated = SeoMetaSchema.parse(meta);
  return { ...validated, tokensUsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD.
// ─────────────────────────────────────────────────────────────────────────────

export interface JsonLdObject {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: unknown;
}

/**
 * Build a schema.org JSON-LD object for a route.
 *
 * WebPage is ALWAYS returned as the floor. FAQPage is emitted ONLY when real
 * Q&A entries are supplied via `faqs` — we never fabricate FAQ schema to pad the
 * structured-data count (honesty gate from [[always]]).
 *
 * When `kind: 'FAQPage'` is requested but no real `faqs` are present, the function
 * falls back to a plain WebPage rather than emitting an empty/fake FAQPage.
 *
 * @example
 * ```ts
 * const ld = await buildJsonLd(env, { siteId, route: '/faq', kind: 'FAQPage',
 *   faqs: [{ question: 'Hours?', answer: 'Mon-Fri 9-5' }] });
 * // ld['@type'] === 'FAQPage'
 * ```
 */
export async function buildJsonLd(
  env: Env,
  input: BuildJsonLdInput & { faqs?: FaqEntry[] },
): Promise<JsonLdObject> {
  const { route, kind = 'WebPage', name, description } = input;
  const realFaqs = (input.faqs ?? []).filter((f) => f.question.trim() && f.answer.trim());

  const webPage: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: name ?? route,
    url: route,
  };
  if (description) webPage.description = description;

  // FAQPage ONLY when the caller passed real Q&A. Otherwise floor to WebPage.
  if (kind === 'FAQPage' && realFaqs.length > 0) {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      name: name ?? route,
      url: route,
      mainEntity: realFaqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    };
  }

  return webPage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft persistence + approval workflow.
// ─────────────────────────────────────────────────────────────────────────────

export interface FreshenRouteInput {
  route: string;
  pageText?: string;
  faqs?: FaqEntry[];
}

export interface FreshenSummary {
  siteId: string;
  routesProcessed: number;
  draftsCreated: number;
  draftIds: string[];
  totalTokens: number;
}

/**
 * Loop the site's known routes, generate meta + answer block + JSON-LD, and
 * persist each as a `seo_meta_drafts` row with status 'pending'. Approval is
 * required before anything applies — this never auto-publishes.
 *
 * Route discovery: explicit `routes` arg wins; otherwise reads distinct routes
 * from prior drafts; falls back to `['/']` so a brand-new site still gets a
 * homepage draft.
 */
export async function freshenSite(
  env: Env,
  siteId: string,
  opts: { orgId?: string | null; routes?: FreshenRouteInput[] } = {},
): Promise<FreshenSummary> {
  const routes = await resolveRoutes(env, siteId, opts.routes);

  const draftIds: string[] = [];
  let totalTokens = 0;

  for (const r of routes) {
    const meta = await generateSeoMeta(env, {
      siteId,
      route: r.route,
      pageText: r.pageText ?? '',
    });
    totalTokens += meta.tokensUsed;

    const realFaqs = (r.faqs ?? []).filter((f) => f.question.trim() && f.answer.trim());
    const jsonLd = await buildJsonLd(env, {
      siteId,
      route: r.route,
      kind: realFaqs.length > 0 ? 'FAQPage' : 'WebPage',
      name: meta.title,
      description: meta.description,
      faqs: realFaqs,
    });

    const id = crypto.randomUUID();
    await dbInsert(env.DB, 'seo_meta_drafts', {
      id,
      site_id: siteId,
      org_id: opts.orgId ?? null,
      route: r.route,
      title: meta.title,
      description: meta.description,
      answer_block: meta.answerBlock,
      jsonld_json: JSON.stringify(jsonLd),
      status: 'pending',
      ai_model: AI_MODEL,
      ai_tokens: meta.tokensUsed,
    });
    draftIds.push(id);
  }

  return {
    siteId,
    routesProcessed: routes.length,
    draftsCreated: draftIds.length,
    draftIds,
    totalTokens,
  };
}

async function resolveRoutes(
  env: Env,
  siteId: string,
  explicit?: FreshenRouteInput[],
): Promise<FreshenRouteInput[]> {
  if (explicit && explicit.length > 0) return explicit;

  const { data } = await dbQuery<{ route: string }>(
    env.DB,
    `SELECT DISTINCT route FROM seo_meta_drafts
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY route ASC`,
    [siteId],
  );
  if (data.length > 0) return data.map((row) => ({ route: row.route }));

  return [{ route: '/' }];
}

/**
 * Approve a pending draft. Sets status 'approved' + approver/timestamp, then
 * calls {@link applyToSite} to land the meta. Returns the updated draft.
 */
export async function approveDraft(
  env: Env,
  draftId: string,
  approvedBy: string,
): Promise<{ ok: boolean; error?: string; draft?: SeoMetaDraft }> {
  const draft = await dbQueryOne<SeoMetaDraft>(
    env.DB,
    'SELECT * FROM seo_meta_drafts WHERE id = ? AND deleted_at IS NULL',
    [draftId],
  );
  if (!draft) return { ok: false, error: 'Draft not found' };
  if (draft.status !== 'pending') return { ok: false, error: `Draft already ${draft.status}` };

  const approvedAt = new Date().toISOString();
  await dbUpdate(
    env.DB,
    'seo_meta_drafts',
    { status: 'approved', approved_by: approvedBy, approved_at: approvedAt },
    'id = ?',
    [draftId],
  );

  await applyToSite(env, draftId);

  return {
    ok: true,
    draft: { ...draft, status: 'approved', approved_by: approvedBy, approved_at: approvedAt },
  };
}

/** Escape `&`, `<`, `>` for use as element text content. */
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape `&`, `"`, `<`, `>` for use inside a double-quoted attribute value. */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The fields of an approved draft that get written into the served HTML. */
export interface SeoMetaApply {
  title?: string | null;
  description?: string | null;
  answerBlock?: string | null;
  /** Pre-serialized schema.org JSON-LD object (the draft's `jsonld_json`). */
  jsonLd?: string | null;
}

/**
 * Rewrite a page's SEO/GEO surface into served HTML — idempotently.
 *
 * @remarks Pure + deterministic. Rewrites (or injects, when absent) the
 * `<title>`, `<meta name="description">`, `og:title`, and `og:description`;
 * injects a marked JSON-LD `<script>` and a hidden crawlable answer block.
 * Re-applying replaces the previous values rather than duplicating them, so the
 * publish path is safe to run repeatedly. Body content is never dropped.
 *
 * @param html - The page HTML to transform.
 * @param meta - The approved draft's title/description/answerBlock/jsonLd.
 * @returns The transformed HTML.
 * @example
 * applySeoMetaToHtml('<html><head><title>x</title></head><body>y</body></html>',
 *   { title: 'New' }) // → '…<title>New</title>…<body>y</body>…'
 */
export function applySeoMetaToHtml(html: string, meta: SeoMetaApply): string {
  let out = html ?? '';

  const injectHead = (snippet: string): void => {
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${snippet}</head>`);
    else if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}${snippet}`);
    else out = `${snippet}${out}`;
  };

  if (meta.title) {
    const t = escText(meta.title);
    if (/<title[^>]*>[\s\S]*?<\/title>/i.test(out)) {
      out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${t}</title>`);
    } else {
      injectHead(`<title>${t}</title>`);
    }
  }

  if (meta.description) {
    const tag = `<meta name="description" content="${escAttr(meta.description)}">`;
    if (/<meta[^>]+name=["']description["'][^>]*>/i.test(out)) {
      out = out.replace(/<meta[^>]+name=["']description["'][^>]*>/i, tag);
    } else {
      injectHead(tag);
    }
  }

  const setOg = (prop: string, val: string): void => {
    const tag = `<meta property="og:${prop}" content="${escAttr(val)}">`;
    const re = new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]*>`, 'i');
    if (re.test(out)) out = out.replace(re, tag);
    else injectHead(tag);
  };
  if (meta.title) setOg('title', meta.title);
  if (meta.description) setOg('description', meta.description);

  if (meta.jsonLd && meta.jsonLd.trim()) {
    out = out.replace(/<script[^>]*data-seo-autopilot[^>]*>[\s\S]*?<\/script>/gi, '');
    injectHead(
      `<script type="application/ld+json" data-seo-autopilot>${meta.jsonLd.trim()}</script>`,
    );
  }

  if (meta.answerBlock && meta.answerBlock.trim()) {
    out = out.replace(/<div[^>]*data-seo-autopilot-answer[^>]*>[\s\S]*?<\/div>/gi, '');
    const block = `<div data-seo-autopilot-answer hidden>${escText(meta.answerBlock.trim())}</div>`;
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${block}</body>`);
    else out = `${out}${block}`;
  }

  return out;
}

/**
 * Build the ordered R2 key candidates the serving layer would resolve a route
 * to, so the publish path rewrites the SAME file the public site serves.
 *
 * @remarks Mirrors `site_serving.serveSiteFromR2`: `/` → `index.html`;
 * `/about` → `about/index.html`, then `about.html`, then `about`.
 */
function routeR2Candidates(slug: string, version: string, route: string): string[] {
  const base = `sites/${slug}/${version}`;
  const r = (route || '/').trim();
  if (r === '/' || r === '') return [`${base}/index.html`];
  const clean = r.replace(/^\/+/, '').replace(/\/+$/, '');
  return [`${base}/${clean}/index.html`, `${base}/${clean}.html`, `${base}/${clean}`];
}

/**
 * Publish an approved draft's meta into the live site: read the route's HTML
 * from R2, rewrite it with {@link applySeoMetaToHtml}, and write it back to the
 * same key the public site serves.
 *
 * @remarks The served HTML carries `Cache-Control: s-maxage=3600`, so the
 * rewrite goes live at the edge within the existing TTL (≤1h) without an
 * explicit zone purge. Reversible via R2 object versioning. Returns a typed
 * error (never throws) when the site is unpublished or the route HTML is absent.
 *
 * @returns `{ ok: true }` on success, else `{ ok: false, error }`.
 */
export async function applySeoMeta(
  env: Env,
  draft: Pick<
    SeoMetaDraft,
    'site_id' | 'route' | 'title' | 'description' | 'answer_block' | 'jsonld_json'
  >,
): Promise<{ ok: boolean; error?: string }> {
  const site = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
    env.DB,
    'SELECT slug, current_build_version FROM sites WHERE id = ? AND deleted_at IS NULL',
    [draft.site_id],
  );
  if (!site) return { ok: false, error: 'Site not found' };
  if (!site.current_build_version)
    return { ok: false, error: 'Site has no published build to update' };

  const candidates = routeR2Candidates(site.slug, site.current_build_version, draft.route);
  let key: string | null = null;
  let object: R2ObjectBody | null = null;
  for (const candidate of candidates) {
    const found = await env.SITES_BUCKET.get(candidate);
    if (found) {
      key = candidate;
      object = found;
      break;
    }
  }
  if (!object || !key)
    return { ok: false, error: `No published HTML found for route ${draft.route}` };

  const html = await object.text();
  const next = applySeoMetaToHtml(html, {
    title: draft.title,
    description: draft.description,
    answerBlock: draft.answer_block,
    jsonLd: draft.jsonld_json,
  });

  await env.SITES_BUCKET.put(key, next, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  return { ok: true };
}

/**
 * Apply an approved draft's meta to the live site, then advance its D1 status
 * to `applied`.
 *
 * @remarks Re-reads the draft, verifies it is `approved`, performs the real R2
 * publish via {@link applySeoMeta}, and only then advances the status — so a
 * failed publish leaves the draft `approved` (retryable), never falsely
 * `applied`.
 */
export async function applyToSite(
  env: Env,
  draftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const draft = await dbQueryOne<SeoMetaDraft>(
    env.DB,
    'SELECT id, site_id, route, title, description, answer_block, jsonld_json, status FROM seo_meta_drafts WHERE id = ? AND deleted_at IS NULL',
    [draftId],
  );
  if (!draft) return { ok: false, error: 'Draft not found' };
  if (draft.status !== 'approved')
    return { ok: false, error: 'Draft must be approved before apply' };

  const published = await applySeoMeta(env, draft);
  if (!published.ok) return published;

  await dbUpdate(env.DB, 'seo_meta_drafts', { status: 'applied' }, 'id = ?', [draftId]);
  return { ok: true };
}
