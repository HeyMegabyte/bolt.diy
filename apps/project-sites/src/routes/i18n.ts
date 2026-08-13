/**
 * i18n_localization — AI translation + hreflang generation (flag: i18n_localization).
 *
 *   POST /api/sites/:id/i18n/translate { text, target, source? }  → AI translation
 *   GET  /api/sites/:id/i18n/hreflang?locales=es,fr&path=/         → hreflang tags
 *
 * Translation runs on Workers AI (m2m100); hreflang generation is pure. Flag-gated
 * (404 when off); Zod-validated; RTL-aware (returns `dir` per locale). Graceful
 * when the AI binding is absent.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

const PROD = 'https://projectsites.dev';
const TRANSLATE_MODEL = '@cf/meta/m2m100-1.2b';
// Resilience fallback: m2m100 is frequently capacity-limited (AiError 3040). When it
// is unavailable, translate via the always-on instruct model so the feature keeps
// working instead of degrading to a "couldn't translate" note.
const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

/** Base-code → English language name for the instruct-model fallback prompt. */
const LANG_NAMES: Record<string, string> = {
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic',
  he: 'Hebrew', hi: 'Hindi', ru: 'Russian', pl: 'Polish', tr: 'Turkish',
  vi: 'Vietnamese', th: 'Thai', sv: 'Swedish', uk: 'Ukrainian', el: 'Greek',
};

/**
 * Translate `text` into `target` (base locale code), preferring the dedicated
 * m2m100 model and falling back to the instruct model when m2m100 is unavailable.
 * Returns the translated string, or null when both paths fail.
 * @remarks Impure — calls Workers AI.
 */
async function translateText(
  ai: Env['AI'],
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  try {
    const res = (await ai.run(TRANSLATE_MODEL, {
      text,
      source_lang: source,
      target_lang: target,
    })) as { translated_text?: string };
    if (res?.translated_text?.trim()) return res.translated_text.trim();
  } catch {
    /* fall through to the instruct-model fallback */
  }
  try {
    const lang = LANG_NAMES[target] ?? target;
    const res = (await ai.run(FALLBACK_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You are a professional translator. Translate the user text into the requested language. Respond with ONLY the translation — no preamble, no quotes, no notes.',
        },
        { role: 'user', content: `Translate into ${lang}:\n\n${text}` },
      ],
      max_tokens: 1024,
    })) as { response?: string };
    const out = res?.response?.trim();
    return out && out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

const TranslateBody = z.object({
  text: z.string().trim().min(1).max(5000),
  target: z.string().trim().min(2).max(10),
  source: z.string().trim().min(2).max(10).optional().default('en'),
});

export interface HreflangTag {
  hreflang: string;
  href: string;
}

/** Normalize a locale to a lowercase base code (`es-419` → `es`, `EN` → `en`). */
export function normalizeLocale(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/** Parse a CSV of locale codes into a deduped, validated base-code list. */
export function parseLocales(csv: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (csv ?? '').split(',')) {
    const code = normalizeLocale(raw);
    if (/^[a-z]{2,3}$/.test(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** Text direction for a locale base code. */
export function dirFor(locale: string): 'rtl' | 'ltr' {
  return RTL_LANGS.has(normalizeLocale(locale)) ? 'rtl' : 'ltr';
}

/**
 * Build hreflang alternates for a path across locales + x-default. Pure
 * (exported for tests). Locale mirrors live under `/{locale}{path}`.
 */
export function buildHreflang(baseUrl: string, path: string, locales: string[]): HreflangTag[] {
  const root = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const tags: HreflangTag[] = [{ hreflang: 'x-default', href: `${root}${p}` }];
  for (const loc of locales) {
    tags.push({ hreflang: loc, href: `${root}/${loc}${p === '/' ? '' : p}` });
  }
  return tags;
}

export const i18n = new Hono<{ Bindings: Env; Variables: Variables }>();

i18n.post('/api/sites/:id/i18n/translate', async (c) => {
  const siteId = c.req.param('id');
  if (
    !(await isFlagOn(c.env, 'i18n_localization', {
      siteId,
      orgId: c.get('orgId'),
      userId: c.get('userId'),
    }))
  )
    return c.notFound();
  const parsed = TranslateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success)
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Provide text + a target language code.' } },
      400,
    );
  if (!c.env.AI)
    return c.json(
      { translated: null, notes: 'Translation is provisioning for this account.' },
      200,
    );
  const target = normalizeLocale(parsed.data.target);
  const translated = await translateText(
    c.env.AI,
    parsed.data.text,
    normalizeLocale(parsed.data.source) || 'en',
    target,
  );
  if (translated) return c.json({ translated, target, dir: dirFor(parsed.data.target) });
  return c.json({ translated: null, notes: 'Couldn’t translate right now.' }, 200);
});

i18n.get('/api/sites/:id/i18n/hreflang', async (c) => {
  const siteId = c.req.param('id');
  if (
    !(await isFlagOn(c.env, 'i18n_localization', {
      siteId,
      orgId: c.get('orgId'),
      userId: c.get('userId'),
    }))
  )
    return c.notFound();
  const locales = parseLocales(c.req.query('locales') ?? '');
  const path = c.req.query('path') || '/';
  return c.json({
    tags: buildHreflang(PROD, path, locales),
    locales: locales.map((l) => ({ locale: l, dir: dirFor(l) })),
  });
});
