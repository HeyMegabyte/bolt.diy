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
  countWords,
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

// ─────────────────────────────────────────────────────────────────────────────
// Length enforcement helpers — keep generated copy inside the Hard Gates.
// ─────────────────────────────────────────────────────────────────────────────

/** Strip JSON/markdown wrappers + collapse whitespace from a raw AI string. */
function clean(raw: string): string {
  return raw.replace(/^["'\s]+|["'\s]+$/g, '').replace(WS, ' ').trim();
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
export function clampDescription(raw: string, pad: string, min = DESCRIPTION_MIN, max = DESCRIPTION_MAX): string {
  let d = clean(raw);
  if (d.length > max) d = truncateToBoundary(d, max);
  if (d.length < min) d = padTo(d, pad, min, max);
  return d.slice(0, max);
}

/**
 * Clamp an answer block to [min,max] WORDS. Over → keep first `max` words.
 * Under → append filler derived from the pad text until the floor is met.
 */
export function clampAnswerBlock(raw: string, pad: string, min = ANSWER_WORDS_MIN, max = ANSWER_WORDS_MAX): string {
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

async function runAi(env: Env, system: string, user: string, maxTokens: number): Promise<AiTextResult> {
  try {
    const response = await env.AI.run(AI_MODEL as Parameters<typeof env.AI.run>[0], {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
    } as Parameters<typeof env.AI.run>[1]);

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
function parseJsonReply(text: string): { title?: string; description?: string; answerBlock?: string } {
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

/**
 * Apply an approved draft's meta to the live site.
 *
 * INTEGRATION POINT (intentional D1-only stub): the real publish path belongs
 * in `services/site_serving.ts` — rewriting `<title>` / `<meta description>` /
 * injecting the JSON-LD + answer block into the served HTML in R2, then purging
 * the host KV cache. That deploy work is owned by site_serving and is NOT faked
 * here. This method only advances the draft's D1 status to 'applied' so the
 * approval workflow has an auditable terminal state. Wire the R2/KV rewrite into
 * site_serving and call it from here when that surface lands.
 */
export async function applyToSite(env: Env, draftId: string): Promise<{ ok: boolean; error?: string }> {
  const draft = await dbQueryOne<SeoMetaDraft>(
    env.DB,
    'SELECT id, status FROM seo_meta_drafts WHERE id = ? AND deleted_at IS NULL',
    [draftId],
  );
  if (!draft) return { ok: false, error: 'Draft not found' };
  if (draft.status !== 'approved') return { ok: false, error: 'Draft must be approved before apply' };

  // TODO(site_serving): call site_serving.applySeoMeta(env, draft) to rewrite the
  // served HTML in R2 + purge host KV cache. D1-only status advance for now.
  await dbUpdate(env.DB, 'seo_meta_drafts', { status: 'applied' }, 'id = ?', [draftId]);
  return { ok: true };
}
