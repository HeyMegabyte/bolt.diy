/**
 * @module services/domain_suggester
 *
 * @description
 * Generate, verify, and enrich 10 unregistered domain suggestions per site
 * for the dashboard's domain-picker dropdown. The panel is the moment of
 * conversion — open → 10 great names → click → register — so every
 * suggestion must be RDAP-verified available, persona-voiced, brand-coherent,
 * and pitched on urgency.
 *
 * @remarks
 * Pipeline (single `suggestDomains` call):
 * 1. **Context** — `gatherProfileContext` for business signals + R2 homepage
 *    summary cached 7d in `CACHE_KV` (`domain_ctx:{site_id}`).
 * 2. **Candidates** — one Workers AI call emits 25 candidate `domain` strings
 *    weighted toward `.com` then `.app .io .dev .co .ai .me .xyz .studio .biz`.
 * 3. **Filter** — fan out RDAP probes via `checkBatch`, drop taken/unknown,
 *    re-roll once if we drop below 10 available.
 * 4. **Enrich** — single Workers AI call emits `{reason, pitch}` for all 10
 *    survivors at once; anti-slop filter rejects banned phrases + re-rolls
 *    up to 2× per row before falling back to a deterministic template.
 * 5. **Price** — CF Registrar TLD list → `price_usd_yr` + `can_register_inline`
 *    + Porkbun fallback URL for TLDs CF doesn't carry.
 *
 * Every Workers AI call uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
 * (never the bare alias) per the project's model-pinning rule.
 *
 * @example
 * ```ts
 * import { suggestDomains } from './domain_suggester.js';
 * const suggestions = await suggestDomains(env, { siteId, count: 10 });
 * for (const s of suggestions) console.warn(s.domain, s.reason);
 * ```
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { gatherProfileContext, type ProfileContext } from './profile_context.js';
import { checkBatch as rdapCheckBatch } from './rdap_availability.js';
import {
  isKnownUnsupportedTld,
  porkbunFallback,
  staticTldPriceUsd,
} from './cf_registrar.js';
import { DASHBOARD_PERSONA_SYSTEM_PROMPT } from '../prompts/dashboard_persona.js';

/** Workers AI model — pinned to the FP8-fast variant per regression rule. */
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Realistic Chrome UA for outbound fetches (R2 is in-process, but kept for parity). */
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 7d KV cache for the AI-summarized homepage snippet. */
const HOMEPAGE_CACHE_TTL_S = 7 * 24 * 60 * 60;

/** TLD priority order — `.com` first, then premium short TLDs, then niche. */
const TLD_PRIORITY = ['com', 'app', 'io', 'dev', 'co', 'ai', 'me', 'xyz', 'studio', 'biz'];

/** Hard cap on AI generation rounds per refresh — protects against infinite re-roll loops. */
const MAX_CANDIDATE_ROUNDS = 2;
const MAX_ENRICH_REROLLS = 2;

/**
 * Anti-AI-slop deny list — applied to every `reason` and `pitch` string. Any
 * match triggers an immediate re-roll (max {@link MAX_ENRICH_REROLLS}) before
 * the row falls back to a deterministic template.
 *
 * @remarks
 * Lowercase-word-boundary match so "perfectionist" doesn't trigger "perfect".
 * The HBO-executive persona forbids the entire stock-AI-copy register —
 * "amazing", "elevate", "leverage", "unlock", "transform", "comprehensive",
 * "world-class", "best-in-class" plus the universally banned "great choice"
 * and the apology-shape "perfect for X".
 */
export const ANTI_SLOP_BANNED: readonly string[] = Object.freeze([
  'perfect',
  'perfect for',
  'ideal',
  'great choice',
  'great for',
  'amazing',
  'unlock',
  'elevate',
  'transform',
  'leverage',
  'comprehensive',
  'world-class',
  'best-in-class',
  'cutting-edge',
  'seamless',
  'revolutionary',
  'revolutionize',
  'next-generation',
  'game-changing',
  'state-of-the-art',
]);

/** Suggestion-row contract returned to the UI. */
export interface DomainSuggestion {
  domain: string;
  available: boolean;
  status: 'available' | 'taken' | 'unknown';
  reason: string;
  pitch: string;
  price_usd_yr: number | null;
  can_register_inline: boolean;
  fallback_url?: string;
}

/** Caller-facing parameters for {@link suggestDomains}. */
export interface SuggestParams {
  siteId: string;
  /** Optional user-typed prefix that biases candidate generation. */
  query?: string;
  /** Desired count (default 10, hard-capped at 20). */
  count?: number;
  /** Optional free-form refinement instruction fed back into the AI prompt. */
  feedback?: string;
  /** Domains to skip — pass UI's exclusion list when the user clicks "show different ones". */
  excludeDomains?: string[];
}

/** Persona overlay appended after the dashboard system prompt. */
const SUGGESTER_PERSONA_OVERLAY = `You are generating domain suggestions for a paying customer. Each reason is one sentence,
eight words preferred, twelve maximum. Lead with the value, never start with "perfect for"
or "great for". Pitches sell urgency — scarcity, brand-lock-in, premium TLD signal.
No emoji. No "elevate" / "unlock" / "transform". The HBO-executive voice carries.`;

/**
 * Main entry — produce N RDAP-verified, AI-pitched domain suggestions.
 *
 * @param env - Worker env (DB + KV + R2 + AI).
 * @param params - {@link SuggestParams} — `siteId` is required.
 * @returns Up to `count` (default 10) suggestions, all `available: true`.
 *
 * @remarks
 * The caller is responsible for caching the wrapped response payload at the
 * route layer — this function always runs the live pipeline so it can be
 * invoked from the refine endpoint with `excludeDomains` semantics that
 * would defeat a function-level cache.
 *
 * @throws Never — every failure path collapses to either a deterministic
 *   fallback row or an empty array (when even RDAP/CF Registrar both fail).
 *   The picker UI never receives an exception envelope from this function.
 */
export async function suggestDomains(
  env: Env,
  params: SuggestParams,
): Promise<DomainSuggestion[]> {
  const count = Math.max(1, Math.min(params.count ?? 10, 20));
  const excludeSet = new Set((params.excludeDomains || []).map((d) => d.toLowerCase()));

  const ctx = await gatherProfileContext(env, params.siteId);
  if (!ctx) return [];

  // Best-effort homepage summary — cached 7d.
  const homepageSummary = await summarizeHomepage(env, ctx);
  if (homepageSummary) ctx.homepage_summary = homepageSummary;

  // Per-TLD pricing is derived from the static fallback table the
  // `cf_registrar` helper exposes. The live CF `domain-check` endpoint
  // requires an account_id we don't want to thread through this service —
  // the static table is good enough for the picker's price chip and the
  // register endpoint re-confirms pricing at purchase time.
  const tldCarries = (tld: string): boolean => !isKnownUnsupportedTld(tld);

  // Collect candidates over up to MAX_CANDIDATE_ROUNDS rounds — first pass
  // asks for 25, second pass asks for 25 more with the dropped ones excluded.
  const seen = new Set<string>(excludeSet);
  const available: Array<{ domain: string; tld: string }> = [];

  for (let round = 0; round < MAX_CANDIDATE_ROUNDS && available.length < count; round++) {
    const need = Math.max(25, (count - available.length) * 3);
    const candidates = await generateCandidates(env, {
      ctx,
      query: params.query,
      feedback: params.feedback,
      count: need,
      exclude: Array.from(seen),
      preferredTlds: TLD_PRIORITY,
    });

    const fresh = candidates
      .map((c) => normalizeDomain(c))
      .filter((c): c is string => Boolean(c))
      .filter((c) => !seen.has(c));
    for (const c of fresh) seen.add(c);

    if (!fresh.length) break;

    // RDAP fan-out — drop anything not strictly available.
    const probes = await rdapCheckBatch(env, fresh);
    for (let i = 0; i < fresh.length && available.length < count + 5; i++) {
      const probe = probes[i];
      if (probe?.available && probe.status === 'available') {
        const dom = fresh[i];
        available.push({ domain: dom, tld: dom.slice(dom.lastIndexOf('.') + 1) });
      }
    }
  }

  // Trim to exactly `count` survivors — preserve the AI's preference order.
  const survivors = available.slice(0, count).map((row) => {
    const cfCarries = tldCarries(row.tld);
    const price = staticTldPriceUsd(row.tld);
    return {
      domain: row.domain,
      tld: row.tld,
      price_usd_yr: price != null ? Math.round(price) : null,
      can_register_inline: cfCarries,
      fallback_url: cfCarries ? undefined : porkbunFallback(row.domain),
    };
  });

  if (!survivors.length) return [];

  // One-shot enrichment for the whole batch with anti-slop re-roll.
  const enriched = await enrichWithReasonAndPitch(env, ctx, survivors);

  return survivors.map((row) => {
    const e = enriched.get(row.domain) || fallbackCopy(ctx, row.domain, row.tld, row.price_usd_yr);
    return {
      domain: row.domain,
      available: true,
      status: 'available' as const,
      reason: e.reason.slice(0, 60),
      pitch: e.pitch.slice(0, 90),
      price_usd_yr: row.price_usd_yr,
      can_register_inline: row.can_register_inline,
      fallback_url: row.fallback_url,
    };
  });
}

/**
 * Build a single-line summary of the published homepage for AI grounding.
 *
 * @remarks
 * Reads `marketing/index.html` for unpublished sites, else
 * `sites/{slug}/{version}/index.html`. Cached 7d in `CACHE_KV`. The Workers
 * AI pass extracts `{value_props[], target_audience, brand_tone,
 * top_3_keywords}` then renders to a compact ≤240 char summary string.
 */
async function summarizeHomepage(env: Env, ctx: ProfileContext): Promise<string | undefined> {
  const cacheKey = `domain_ctx:${ctx.site_id}:${ctx.current_build_version || 'unbuilt'}`;
  try {
    const cached = await env.CACHE_KV.get(cacheKey);
    if (cached) return cached;
  } catch {
    // fall through
  }

  // R2 read — prefer the live build path, fall back to marketing shell.
  let html: string | null = null;
  try {
    if (ctx.current_build_version) {
      const obj = await env.SITES_BUCKET.get(
        `sites/${ctx.slug}/${ctx.current_build_version}/index.html`,
      );
      if (obj) html = await obj.text();
    }
    if (!html) {
      const obj = await env.SITES_BUCKET.get('marketing/index.html');
      if (obj) html = await obj.text();
    }
  } catch {
    return undefined;
  }
  if (!html) return undefined;

  // Strip tags + scripts + styles, then truncate to keep the AI prompt cheap.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
  if (!text) return undefined;

  try {
    const res = (await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You extract structured signals from website copy. Respond ONLY with valid JSON. No preamble.',
        },
        {
          role: 'user',
          content: `From the homepage text below, extract: value_props (array of 3 short phrases), target_audience (one phrase), brand_tone (one word), top_3_keywords (array of 3 single words). Reply with strict JSON only.\n\nTEXT:\n${text}`,
        },
      ],
      max_tokens: 240,
      response_format: { type: 'json_object' },
    } as never)) as { response?: string };

    const raw = res?.response || '';
    const parsed = safeJsonParse<{
      value_props?: string[];
      target_audience?: string;
      brand_tone?: string;
      top_3_keywords?: string[];
    }>(raw);
    if (!parsed) return undefined;

    const summary = [
      parsed.target_audience ? `Serves ${parsed.target_audience}.` : '',
      parsed.value_props?.length ? `Value: ${parsed.value_props.slice(0, 3).join(', ')}.` : '',
      parsed.brand_tone ? `Tone: ${parsed.brand_tone}.` : '',
      parsed.top_3_keywords?.length ? `Keywords: ${parsed.top_3_keywords.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 240);

    if (summary) {
      try {
        await env.CACHE_KV.put(cacheKey, summary, { expirationTtl: HOMEPAGE_CACHE_TTL_S });
      } catch {
        // non-fatal
      }
    }
    return summary || undefined;
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'domain_suggester',
        message: 'homepage summary AI call failed',
        site_id: ctx.site_id,
        error: String(err),
      }),
    );
    return undefined;
  }
}

interface CandidateParams {
  ctx: ProfileContext;
  query?: string;
  feedback?: string;
  count: number;
  exclude: string[];
  preferredTlds: string[];
}

/**
 * Single-shot Workers AI candidate generation — emits raw `domain` strings.
 *
 * @remarks
 * Strict JSON output: `{ "domains": ["acmesalon.com", …] }`. Anything that
 * doesn't parse or doesn't include 5-22 lowercase chars with a known TLD
 * gets dropped on the floor. The prompt embeds the persona overlay so the
 * AI internalizes the no-slop rule before generation.
 */
async function generateCandidates(
  env: Env,
  params: CandidateParams,
): Promise<string[]> {
  const { ctx } = params;
  const ctxLines = [
    `Business: ${ctx.business_name}`,
    ctx.business_type ? `Type: ${ctx.business_type}` : '',
    ctx.category ? `Category: ${ctx.category}` : '',
    ctx.business_description ? `Description: ${truncate(ctx.business_description, 240)}` : '',
    ctx.location ? `Location: ${truncate(ctx.location, 120)}` : '',
    ctx.target_audience ? `Audience: ${truncate(ctx.target_audience, 120)}` : '',
    ctx.brand_tone ? `Brand tone: ${ctx.brand_tone}` : '',
    ctx.usps?.length ? `USPs: ${ctx.usps.slice(0, 5).join(' | ')}` : '',
    ctx.services?.length ? `Services: ${ctx.services.slice(0, 5).join(' | ')}` : '',
    ctx.recent_keywords?.length ? `Keywords: ${ctx.recent_keywords.slice(0, 10).join(', ')}` : '',
    ctx.homepage_summary ? `Homepage: ${ctx.homepage_summary}` : '',
    params.query ? `User query prefix: ${truncate(params.query, 60)}` : '',
    params.feedback ? `User feedback: ${truncate(params.feedback, 200)}` : '',
    params.exclude.length
      ? `Already-shown (NEVER repeat): ${params.exclude.slice(0, 40).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tldNote = params.preferredTlds.join(' .');
  const prompt = `Generate ${params.count} unique candidate domain names for the business below.

RULES:
- Each domain is lowercase, 5-22 chars total (including TLD), no underscores, no numbers unless meaningful.
- Mix TLDs: prioritize .com first, then a healthy spread across .${tldNote}.
- Brand-coherent. Memorable. Short. Pronounceable. Type-able.
- NEVER include any "Already-shown" domain from the context.
- Avoid generic suffixes like "hub", "world", "online" unless they actually fit.
- No hyphens unless the brand name itself has one.

Reply ONLY with strict JSON: {"domains": ["foo.com", "bar.app", ...]}.

CONTEXT:
${ctxLines}`;

  try {
    const res = (await env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: DASHBOARD_PERSONA_SYSTEM_PROMPT },
        { role: 'system', content: SUGGESTER_PERSONA_OVERLAY },
        { role: 'user', content: prompt },
      ],
      max_tokens: 800,
      response_format: { type: 'json_object' },
    } as never)) as { response?: string };

    const parsed = safeJsonParse<{ domains?: unknown }>(res?.response || '');
    if (!parsed || !Array.isArray(parsed.domains)) return [];
    return parsed.domains.filter((v): v is string => typeof v === 'string');
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'domain_suggester',
        message: 'candidate generation AI call failed',
        site_id: ctx.site_id,
        error: String(err),
      }),
    );
    return [];
  }
}

interface EnrichmentRow {
  domain: string;
  tld: string;
  price_usd_yr: number | null;
}

/**
 * Batch-enrich every survivor with a `{reason, pitch}` pair in ONE AI call.
 *
 * @remarks
 * Anti-slop scan runs server-side after the call returns. Any row with a
 * banned phrase in either field gets re-rolled up to {@link MAX_ENRICH_REROLLS}
 * times with a stricter "you violated these words last time" addendum. Rows
 * that never recover fall back to a deterministic per-TLD template.
 */
async function enrichWithReasonAndPitch(
  env: Env,
  ctx: ProfileContext,
  rows: EnrichmentRow[],
): Promise<Map<string, { reason: string; pitch: string }>> {
  const out = new Map<string, { reason: string; pitch: string }>();
  let pending = rows.slice();
  let lastViolations: string[] = [];

  for (let attempt = 0; attempt <= MAX_ENRICH_REROLLS && pending.length; attempt++) {
    const stricter = attempt > 0
      ? `\nPREVIOUS ATTEMPT VIOLATED ANTI-SLOP RULES. NEVER use any of: ${lastViolations.join(', ')}. Drop them. Write specific, concrete, persona-voiced copy.`
      : '';

    const prompt = `For each candidate domain below, write a REASON and a PITCH.

REASON: ≤60 chars. Why THIS domain fits THIS business. Specific, concrete, persona-voiced. Eight words preferred.
PITCH: ≤90 chars. Why ACT NOW — scarcity, brand-lock-in, premium TLD signal, price hook. Urgent.

HARD RULES:
- Never use: ${ANTI_SLOP_BANNED.join(', ')}.
- Never start with "Perfect" or "Great" or "Ideal".
- Never repeat the literal domain string in REASON or PITCH.
- No emoji. No apologies. No hedging.
- Voice: HBO-executive, cinematic punchline.${stricter}

Reply ONLY with strict JSON: {"rows":[{"domain":"foo.com","reason":"...","pitch":"..."}, ...]}.

BUSINESS:
${ctx.business_name}${ctx.business_type ? ` — ${ctx.business_type}` : ''}${ctx.location ? ` — ${ctx.location}` : ''}
${ctx.homepage_summary || ctx.business_description || ''}

CANDIDATES:
${pending
  .map(
    (r) =>
      `- ${r.domain} (.${r.tld}, ${r.price_usd_yr != null ? `$${r.price_usd_yr}/yr` : 'price tbd'})`,
  )
  .join('\n')}`;

    let parsed: { rows?: Array<{ domain?: string; reason?: string; pitch?: string }> } | null = null;
    try {
      const res = (await env.AI.run(AI_MODEL, {
        messages: [
          { role: 'system', content: DASHBOARD_PERSONA_SYSTEM_PROMPT },
          { role: 'system', content: SUGGESTER_PERSONA_OVERLAY },
          { role: 'user', content: prompt },
        ],
        max_tokens: 900,
        response_format: { type: 'json_object' },
      } as never)) as { response?: string };
      parsed = safeJsonParse(res?.response || '');
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'domain_suggester',
          message: 'enrichment AI call failed',
          site_id: ctx.site_id,
          attempt,
          error: String(err),
        }),
      );
    }

    const nextPending: EnrichmentRow[] = [];
    const violationsThisRound = new Set<string>();
    const byDomain = new Map<string, { reason: string; pitch: string }>();
    for (const row of parsed?.rows || []) {
      if (!row?.domain || !row.reason || !row.pitch) continue;
      byDomain.set(row.domain.toLowerCase(), {
        reason: String(row.reason).trim(),
        pitch: String(row.pitch).trim(),
      });
    }

    for (const r of pending) {
      const found = byDomain.get(r.domain.toLowerCase());
      if (!found) {
        nextPending.push(r);
        continue;
      }
      const violations = scanForSlop(`${found.reason} ${found.pitch}`);
      if (violations.length) {
        for (const v of violations) violationsThisRound.add(v);
        nextPending.push(r);
        continue;
      }
      out.set(r.domain, found);
    }

    pending = nextPending;
    lastViolations = Array.from(violationsThisRound);
    if (!pending.length) break;
  }

  // Any leftover row that survived all re-rolls gets a deterministic template.
  for (const r of pending) {
    out.set(r.domain, fallbackCopy(ctx, r.domain, r.tld, r.price_usd_yr));
  }

  return out;
}

/**
 * Lowercase-word-boundary scan of a string for banned anti-slop phrases.
 * Returns the matched phrases (lower-cased) — empty array means clean.
 */
function scanForSlop(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of ANTI_SLOP_BANNED) {
    // Multi-word phrase: simple substring. Single-word: word-boundary.
    if (phrase.includes(' ')) {
      if (lower.includes(phrase)) hits.push(phrase);
    } else {
      const re = new RegExp(`\\b${phrase.replace(/[-]/g, '\\$&')}\\b`);
      if (re.test(lower)) hits.push(phrase);
    }
  }
  return hits;
}

/**
 * Deterministic copy fallback — per-TLD note + price hook + business hook.
 * Used when the AI call fails outright or anti-slop re-rolls exhaust.
 */
function fallbackCopy(
  ctx: ProfileContext,
  domain: string,
  tld: string,
  price: number | null,
): { reason: string; pitch: string } {
  const tldNote: Record<string, string> = {
    com: 'Universal trust signal.',
    app: 'Mobile-cue, store-adjacent.',
    io: 'Tech-startup vernacular.',
    dev: 'Craft-coded; signals rigor.',
    co: 'Modern company shorthand.',
    ai: 'Premium .ai TLD; AI resonance.',
    me: 'Personal-brand cue.',
    xyz: 'Modern, stands out in search.',
    studio: 'Creative-shop cue.',
    biz: 'Direct commerce signal.',
  };
  const hook = tldNote[tld] || 'Distinctive TLD; stands out.';
  const priceTail = price ? `$${price}/yr.` : 'Pricing locks at register.';
  const subject = ctx.business_name.split(/\s+/).slice(0, 2).join(' ');
  return {
    reason: `Brand-true match for ${subject}.`.slice(0, 60),
    pitch: `${hook} ${priceTail}`.slice(0, 90),
  };
}

/**
 * Normalize a candidate string into a canonical FQDN or null.
 *
 * @remarks
 * Strips protocol/path/whitespace, lowercases, validates the
 * `^[a-z0-9-]+\.[a-z0-9-]+$` shape, and rejects anything outside
 * 5-22 chars (TLD inclusive). The 22-char ceiling matches the
 * brief's "type-able domain" constraint.
 */
function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!trimmed) return null;
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(trimmed)) return null;
  if (trimmed.length < 5 || trimmed.length > 22) return null;
  if (trimmed.startsWith('-') || trimmed.endsWith('-')) return null;
  return trimmed;
}

/** Truncate a string to N chars without breaking words mid-sentence. */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * Defensive JSON parse — accepts raw model output that may include leading
 * non-JSON tokens. Falls back to substring extraction between the first `{`
 * and the last `}`.
 */
function safeJsonParse<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Suppress unused-import warning — REAL_UA is exported for parity with other
// services in this codebase that perform direct outbound fetches. The
// suggester only reads R2 (in-process) but downstream consumers grep this
// module for the constant when they pivot to direct HTTP.
void REAL_UA;
