/**
 * @module services/social_ai
 *
 * @description
 * AI surface for Pulse Social. Generates per-platform post copy, hashtag
 * sets, repurposed posts from a source URL, translations, tone rewrites,
 * and a best-time-to-post heuristic derived from
 * {@link social_analytics_snapshots}.
 *
 * Every Workers AI call uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
 * (the contract for the entire dashboard) and wraps the system prompt with
 * {@link SOCIAL_PERSONA_SYSTEM_PROMPT}.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { SOCIAL_PERSONA_SYSTEM_PROMPT, type SocialPlatform } from '../prompts/social_persona.js';
import { REAL_BROWSER_HEADERS } from './import_crawler.js';
import { dbQuery } from './db.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Outbound envelope returned by `generatePost`. */
export interface GeneratedPost {
  /** Default content used when no platform-specific override is present. */
  content: string;
  /** Optional per-platform overrides — fully formed post bodies per network. */
  per_platform_overrides: Partial<Record<SocialPlatform | string, { content: string }>>;
  /** Hashtags only — never embedded into `content` (caller decides placement). */
  hashtags: string[];
  /** Mentions parsed from the source brief, normalized to `@handle`. */
  mentions: { platform: string; handle: string }[];
}

interface AiRunResponse {
  response?: string;
}

/**
 * Single Workers AI helper that always pins the model + tone for Pulse.
 * Errors propagate so callers can surface them in the route layer.
 */
async function callAi(
  env: Env,
  platform: string,
  user: string,
  options: { json?: boolean; maxTokens?: number } = {},
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SOCIAL_PERSONA_SYSTEM_PROMPT(platform) },
    { role: 'user' as const, content: user },
  ];
  const params: Record<string, unknown> = {
    messages,
    stream: false,
    max_tokens: options.maxTokens ?? 600,
  };
  if (options.json) {
    params['response_format'] = { type: 'json_object' };
  }
  const result = (await env.AI.run(
    MODEL as Parameters<typeof env.AI.run>[0],
    params as never,
  )) as AiRunResponse;
  return (result.response ?? '').trim();
}

/**
 * Best-effort JSON extraction — strips fenced ```json blocks, leading
 * prose, and trailing commas before parsing.
 */
function parseJson<T>(raw: string, fallback: T): T {
  const stripped = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
  // Pull the first {...} or [...] span.
  const objMatch = stripped.match(/[{[][\s\S]*[}\]]/);
  const body = objMatch ? objMatch[0] : stripped;
  try {
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface GeneratePostInput {
  topic: string;
  platforms: (SocialPlatform | string)[];
  tone?: string;
  brand_voice?: string;
  link?: string;
  hashtag_count?: number;
}

/**
 * Generate a multi-platform post envelope from a single topic prompt.
 * Returns one default `content` body + per-platform overrides so callers
 * can publish the same logical post across every connected account
 * without re-prompting.
 */
export async function generatePost(env: Env, input: GeneratePostInput): Promise<GeneratedPost> {
  const platforms = input.platforms.length ? input.platforms : ['twitter'];
  const primary = platforms[0] ?? 'twitter';
  const hashtagCount = Math.max(0, Math.min(15, input.hashtag_count ?? 4));

  const platformList = platforms.map((p) => `"${p}"`).join(', ');
  const prompt = [
    `Generate social posts about: ${input.topic}`,
    input.tone ? `Tone overlay: ${input.tone}` : '',
    input.brand_voice ? `Brand voice context: ${input.brand_voice}` : '',
    input.link ? `Include this link naturally where the platform allows: ${input.link}` : '',
    '',
    `Target platforms: [${platformList}]`,
    `Return STRICT JSON with this exact shape:`,
    `{`,
    `  "content": "default post body (Twitter-length punchline)",`,
    `  "per_platform_overrides": { "<platform>": { "content": "platform-tailored body" } },`,
    `  "hashtags": ["tag", "tag"] (${hashtagCount} max, no leading #),`,
    `  "mentions": [{ "platform": "<platform>", "handle": "@person" }]`,
    `},`,
    `where per_platform_overrides has one entry per requested platform, each respecting that`,
    `platform's persona contract (length, tone, hashtag rules). Never echo the topic verbatim.`,
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callAi(env, String(primary), prompt, { json: true, maxTokens: 1100 });
  const parsed = parseJson<GeneratedPost>(raw, {
    content: '',
    per_platform_overrides: {},
    hashtags: [],
    mentions: [],
  });

  // Normalize — never leak `#` into hashtag strings (caller decides placement).
  const hashtags = (parsed.hashtags ?? [])
    .map((h) => (h || '').replace(/^#/, '').trim())
    .filter((h) => h.length > 0)
    .slice(0, hashtagCount);

  return {
    content: parsed.content ?? '',
    per_platform_overrides: parsed.per_platform_overrides ?? {},
    hashtags,
    mentions: parsed.mentions ?? [],
  };
}

export interface GenerateHashtagsInput {
  content: string;
  platform: SocialPlatform | string;
  max?: number;
}

/**
 * Suggest a small, niche-first hashtag set for a piece of content. Always
 * returns lowercase tags WITHOUT the leading `#`.
 */
export async function generateHashtags(env: Env, input: GenerateHashtagsInput): Promise<string[]> {
  const max = Math.max(1, Math.min(15, input.max ?? 10));
  const prompt = [
    `Suggest ${max} hashtags for this ${input.platform} post:`,
    '',
    input.content,
    '',
    `Return STRICT JSON: { "tags": ["tag1", "tag2"] }`,
    `Rules: lowercase only, no spaces, no leading #, niche-first, skip megatags`,
    `(no #love #instagood #marketing). 1-2 broad anchors at the end are OK.`,
  ].join('\n');
  const raw = await callAi(env, String(input.platform), prompt, { json: true, maxTokens: 400 });
  const parsed = parseJson<{ tags?: string[] }>(raw, { tags: [] });
  return (parsed.tags ?? [])
    .map((t) => (t || '').replace(/^#/, '').replace(/\s+/g, '').toLowerCase())
    .filter((t) => t.length > 0)
    .slice(0, max);
}

export interface RepurposeInput {
  source_url: string;
  target_platforms: (SocialPlatform | string)[];
}

export interface RepurposedPost {
  platform: string;
  content: string;
  hashtags: string[];
}

/**
 * Fetch a source URL (using the project's Real-Browser UA so CF-protected
 * sites don't 403 us) and transform it into N platform-tailored posts.
 */
export async function repurpose(
  env: Env,
  input: RepurposeInput,
): Promise<{ posts: RepurposedPost[] }> {
  let sourceText = '';
  try {
    const res = await fetch(input.source_url, { headers: REAL_BROWSER_HEADERS });
    if (res.ok) {
      const html = await res.text();
      // Strip tags + collapse whitespace; cap at 6000 chars so we don't blow context.
      sourceText = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000);
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'social_ai.repurpose',
        message: 'source fetch failed',
        url: input.source_url,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const platforms = input.target_platforms.length ? input.target_platforms : ['twitter'];
  const posts: RepurposedPost[] = [];

  for (const platform of platforms) {
    const prompt = [
      `Repurpose this source into a single ${platform} post. Honor the platform persona.`,
      `Quote nothing verbatim — extract the core insight + restate it in OUR voice.`,
      '',
      `SOURCE URL: ${input.source_url}`,
      sourceText ? `\nSOURCE EXTRACT:\n${sourceText}` : '',
      '',
      `Return STRICT JSON: { "content": "...", "hashtags": ["..."] }`,
    ].join('\n');
    const raw = await callAi(env, String(platform), prompt, { json: true, maxTokens: 700 });
    const parsed = parseJson<RepurposedPost>(raw, { platform: String(platform), content: '', hashtags: [] });
    posts.push({
      platform: String(platform),
      content: parsed.content ?? '',
      hashtags: (parsed.hashtags ?? [])
        .map((h) => (h || '').replace(/^#/, '').trim())
        .filter(Boolean)
        .slice(0, 8),
    });
  }

  return { posts };
}

export interface TranslateInput {
  content: string;
  target_lang: string;
}

/**
 * Translate post content into `target_lang` (ISO 639-1 or full name) while
 * preserving brand voice and platform contract. Falls back to the original
 * content on parse failure.
 */
export async function translateContent(env: Env, input: TranslateInput): Promise<string> {
  const prompt = [
    `Translate to ${input.target_lang}. Preserve voice, idiom-match, never word-for-word.`,
    `Return STRICT JSON: { "translated": "..." }`,
    '',
    input.content,
  ].join('\n');
  const raw = await callAi(env, 'linkedin', prompt, { json: true, maxTokens: 700 });
  const parsed = parseJson<{ translated?: string }>(raw, { translated: input.content });
  return parsed.translated ?? input.content;
}

export interface RewriteToneInput {
  content: string;
  tone: string;
  platform: SocialPlatform | string;
}

/** Rewrite a post body in a different tone (punchier / warmer / more formal). */
export async function rewriteForTone(env: Env, input: RewriteToneInput): Promise<string> {
  const prompt = [
    `Rewrite the following ${input.platform} post in this tone: ${input.tone}.`,
    `Honor the platform contract. Output ONLY the rewritten body.`,
    '',
    input.content,
  ].join('\n');
  return callAi(env, String(input.platform), prompt, { maxTokens: 600 });
}

export interface BestTimeRow {
  day: number; // 0 = Sunday … 6 = Saturday
  hour: number; // 0-23, UTC
  confidence: number; // 0-1 — sample size / variance signal
}

/**
 * Best-time-to-post heuristic. Aggregates the last 90 days of analytics
 * snapshots for the given platform (optionally narrowed to an account),
 * groups by (day-of-week, hour) and picks the three slots with the highest
 * median impressions. Confidence reflects the sample size.
 */
export async function bestTimeToPost(
  env: Env,
  input: { platform: string; account_id?: string; org_id: string },
): Promise<BestTimeRow[]> {
  // Pull snapshots joined to their publish + post for the account (last 90d).
  const rows = await dbQuery<{
    published_at: string | null;
    impressions: number | null;
    account_id: string;
  }>(
    env.DB,
    `
      SELECT pp.published_at AS published_at,
             sas.impressions AS impressions,
             sp.account_id   AS account_id
      FROM social_analytics_snapshots sas
      JOIN social_publishes sp ON sp.id = sas.publish_id
      JOIN pulse_posts pp ON pp.id = sp.post_id
      WHERE sp.platform = ?
        AND pp.org_id = ?
        AND pp.published_at IS NOT NULL
        AND pp.published_at > datetime('now', '-90 days')
        ${input.account_id ? 'AND sp.account_id = ?' : ''}
    `,
    input.account_id ? [input.platform, input.org_id, input.account_id] : [input.platform, input.org_id],
  );

  const buckets = new Map<string, number[]>();
  for (const row of rows.data) {
    if (!row.published_at || row.impressions == null) continue;
    const d = new Date(row.published_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCDay()}-${d.getUTCHours()}`;
    const arr = buckets.get(key) ?? [];
    arr.push(row.impressions);
    buckets.set(key, arr);
  }

  const scored: { day: number; hour: number; median: number; n: number }[] = [];
  for (const [key, arr] of buckets) {
    const [d, h] = key.split('-').map((n) => Number.parseInt(n, 10));
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? 0);
    scored.push({ day: d ?? 0, hour: h ?? 0, median, n: arr.length });
  }
  scored.sort((a, b) => b.median - a.median);

  const top = scored.slice(0, 3);
  const maxN = Math.max(1, ...top.map((s) => s.n));
  return top.map((s) => ({
    day: s.day,
    hour: s.hour,
    confidence: Math.min(1, s.n / maxN),
  }));
}
