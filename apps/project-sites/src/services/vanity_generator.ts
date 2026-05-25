/**
 * @module services/vanity_generator
 * @description Suggest 4-5 letter vanity words for a business's phone number.
 *
 * Uses Workers AI Llama 3.3 70B fp8-fast to brainstorm vanity words that
 * derive from the business name, services, location, and USPs. Results are
 * cached in CACHE_KV for 7 days keyed on `vanity:{site_id}:{profileHash}`.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { sha256Hex } from '@project-sites/shared';

/**
 * Inputs the LLM uses to brainstorm vanity words.
 *
 * @remarks
 * Pass as much context as available — the model uses every field to bias
 * suggestions toward the business identity (Capurso's Salon → CURLS, CUTZ).
 */
export interface VanityBusinessProfile {
  businessName: string;
  services?: string[];
  location?: string;          // City or city+state
  usps?: string[];
  industry?: string;
}

/**
 * A single ranked vanity-word candidate emitted by {@link suggestVanityWords}.
 *
 * @remarks
 * `word` is ALL CAPS 4-7 letters, ready to overlay on a tel-link button.
 * `theme` lets the UI group suggestions (e.g. all `service` words together).
 */
export interface VanitySuggestion {
  word: string;               // ALL CAPS, 4-7 letters
  rationale: string;
  theme: 'name' | 'service' | 'location' | 'usp' | 'memorable';
}

/**
 * Envelope returned by {@link suggestVanityWords}.
 *
 * @remarks
 * `cached: true` signals the result came from KV (no LLM cost incurred this
 * call). UI can show a "regenerate" affordance when the user wants fresh
 * picks past the 7-day cache.
 */
export interface VanityResult {
  cached: boolean;
  words: VanitySuggestion[];
}

const KV_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Generate ranked vanity-word suggestions for a business.
 *
 * @param env     - Worker env (Workers AI + CACHE_KV).
 * @param opts    - `siteId` keys the cache; `businessProfile` drives the prompt.
 * @returns Top 12 ranked suggestions (cached on hit).
 */
export async function suggestVanityWords(
  env: Env,
  opts: { siteId: string; businessProfile: VanityBusinessProfile },
): Promise<VanityResult> {
  const profileHash = (await sha256Hex(JSON.stringify(opts.businessProfile))).slice(0, 16);
  const cacheKey = `vanity:${opts.siteId}:${profileHash}`;

  // ── Cache lookup ──
  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached && Array.isArray((cached as { words?: unknown[] }).words)) {
      return { cached: true, words: (cached as { words: VanitySuggestion[] }).words };
    }
  } catch {
    /* KV miss is fine */
  }

  const prompt = buildPrompt(opts.businessProfile);
  let words: VanitySuggestion[] = [];

  try {
    const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0];
    const response = await env.AI.run(model, {
      messages: [
        {
          role: 'system',
          content:
            'You suggest 4-7 letter ALL-CAPS vanity words for a phone number. Output STRICT JSON only, no prose.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 800,
      temperature: 0.6,
    });
    const raw =
      typeof response === 'string'
        ? response
        : String((response as { response?: string }).response ?? '');
    words = parseVanityJson(raw.trim());
  } catch (err) {
    // Workers AI down or model retired — fall back to deterministic suggestions.
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'vanity_generator',
        message: 'workers_ai_failed_fallback_to_heuristic',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    words = heuristicFallback(opts.businessProfile);
  }

  if (words.length === 0) words = heuristicFallback(opts.businessProfile);

  // Cap at 12, write-through to KV (best-effort)
  const top12 = words.slice(0, 12);
  try {
    await env.CACHE_KV.put(cacheKey, JSON.stringify({ words: top12 }), {
      expirationTtl: KV_TTL_SECONDS,
    });
  } catch {
    /* never block on cache write */
  }
  return { cached: false, words: top12 };
}

// ─── prompt construction ─────────────────────────────────────────

function buildPrompt(p: VanityBusinessProfile): string {
  const lines: string[] = [];
  lines.push(`Business: ${p.businessName}`);
  if (p.industry) lines.push(`Industry: ${p.industry}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.services?.length) lines.push(`Services: ${p.services.join(', ')}`);
  if (p.usps?.length) lines.push(`Unique selling points: ${p.usps.join('; ')}`);
  lines.push('');
  lines.push(
    'Suggest 12 vanity words (4-7 letters, ALL CAPS, A-Z only — no numbers, no punctuation) that would make a memorable vanity phone number for this business. Mix themes: derived from the business name, the primary service, the location, a USP, or just memorable/punchy. Prefer real English words people can spell on a keypad without thinking.',
  );
  lines.push('');
  lines.push('Output STRICT JSON: {"words":[{"word":"ABOR","rationale":"...","theme":"service"}]}');
  return lines.join('\n');
}

function parseVanityJson(raw: string): VanitySuggestion[] {
  // Strip code fences if the model added them
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { words?: Array<Record<string, unknown>> };
    const items = Array.isArray(parsed.words) ? parsed.words : [];
    const out: VanitySuggestion[] = [];
    for (const item of items) {
      const word = String(item.word ?? '').toUpperCase().replace(/[^A-Z]/g, '');
      if (word.length < 4 || word.length > 7) continue;
      const themeRaw = String(item.theme ?? 'memorable');
      const theme: VanitySuggestion['theme'] =
        themeRaw === 'name' || themeRaw === 'service' || themeRaw === 'location' || themeRaw === 'usp'
          ? themeRaw
          : 'memorable';
      out.push({
        word,
        rationale: String(item.rationale ?? '').slice(0, 240),
        theme,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── fallback when Workers AI is unavailable ─────────────────────

function heuristicFallback(p: VanityBusinessProfile): VanitySuggestion[] {
  const seeds = [
    p.businessName,
    ...(p.services ?? []),
    p.industry ?? '',
    p.location ?? '',
  ]
    .join(' ')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ');
  const tokens = Array.from(
    new Set(
      seeds
        .split(/\s+/)
        .filter((t) => t.length >= 4 && t.length <= 7),
    ),
  );
  const fallbacks = ['HELP', 'CALL', 'FAST', 'NEAR', 'BEST', 'PROS', 'SAVE', 'EASY'];
  const combined = [...tokens, ...fallbacks].slice(0, 12);
  return combined.map((word) => ({
    word,
    rationale: 'Heuristic fallback (Workers AI unavailable).',
    theme: 'memorable' as const,
  }));
}
