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
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

const TranslateBody = z.object({
  text: z.string().trim().min(1).max(5000),
  target: z.string().trim().min(2).max(10),
  source: z.string().trim().min(2).max(10).optional().default('en'),
});

export interface HreflangTag { hreflang: string; href: string }

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
  if (!(await isFlagOn(c.env, 'i18n_localization', { siteId, orgId: c.get('orgId'), userId: c.get('userId') }))) return c.notFound();
  const parsed = TranslateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Provide text + a target language code.' } }, 400);
  if (!c.env.AI) return c.json({ translated: null, notes: 'Translation is provisioning for this account.' }, 200);
  try {
    const res = (await c.env.AI.run(TRANSLATE_MODEL, {
      text: parsed.data.text,
      source_lang: normalizeLocale(parsed.data.source),
      target_lang: normalizeLocale(parsed.data.target),
    })) as { translated_text?: string };
    return c.json({
      translated: res?.translated_text ?? null,
      target: normalizeLocale(parsed.data.target),
      dir: dirFor(parsed.data.target),
    });
  } catch {
    return c.json({ translated: null, notes: 'Couldn’t translate right now.' }, 200);
  }
});

i18n.get('/api/sites/:id/i18n/hreflang', async (c) => {
  const siteId = c.req.param('id');
  if (!(await isFlagOn(c.env, 'i18n_localization', { siteId, orgId: c.get('orgId'), userId: c.get('userId') }))) return c.notFound();
  const locales = parseLocales(c.req.query('locales') ?? '');
  const path = c.req.query('path') || '/';
  return c.json({ tags: buildHreflang(PROD, path, locales), locales: locales.map((l) => ({ locale: l, dir: dirFor(l) })) });
});
