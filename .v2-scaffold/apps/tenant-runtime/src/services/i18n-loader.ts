/**
 * i18n locale-JSON loader compatible with ngx-translate.
 *
 * @remarks
 *  Reads `i18n/{locale}.json` from R2 at the site's version prefix, caches in
 *  KV for 5 min, falls back to `en` if requested locale is missing.
 *
 * @example
 *   const data = await loadLocaleJson(env, 'es');
 */
import type { Env } from '../env';

const I18N_KV_TTL = 60 * 5;

export async function loadLocaleJson(env: Env, locale: string): Promise<Record<string, unknown>> {
  const safeLocale = locale.replace(/[^a-z-]/gi, '').toLowerCase() || env.DEFAULT_LOCALE;
  const cacheKey = `i18n:${env.SITE_VERSION}:${safeLocale}`;
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached && typeof cached === 'object') return cached as Record<string, unknown>;

  const r2Key = `sites/${env.TENANT_SLUG}/${env.SITE_VERSION}/i18n/${safeLocale}.json`;
  const obj = await env.BUCKET.get(r2Key);
  if (!obj) {
    if (safeLocale !== env.DEFAULT_LOCALE) return loadLocaleJson(env, env.DEFAULT_LOCALE);
    return {};
  }
  const text = await obj.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  await env.KV.put(cacheKey, JSON.stringify(parsed), { expirationTtl: I18N_KV_TTL });
  return parsed;
}
