/**
 * Attach a request id + locale + timing to every request.
 *
 * @remarks
 *  Locale negotiation is `Accept-Language` parsed against
 *  `env.SUPPORTED_LOCALES` (comma separated). Fallback = `env.DEFAULT_LOCALE`.
 *  We set `c.var.locale` so the i18n loader + sitemap generator can stay pure.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';

export function requestId(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const incoming = c.req.header('cf-ray') || c.req.header('x-request-id');
    const id = incoming || crypto.randomUUID();
    c.set('requestId', id);
    c.set('startedAt', Date.now());
    c.set('locale', negotiateLocale(c.req.header('accept-language') ?? '', c.env.SUPPORTED_LOCALES, c.env.DEFAULT_LOCALE));
    await next();
    c.res.headers.set('x-request-id', id);
    c.res.headers.set('server-timing', `total;dur=${Date.now() - c.var.startedAt}`);
  };
}

export function negotiateLocale(acceptLanguage: string, supportedCsv: string, fallback: string): string {
  const supported = supportedCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (supported.length === 0) return fallback;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.split(';q=');
      const q = qPart ? Number(qPart) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((r) => r.tag)
    .sort((a, b) => b.q - a.q);
  for (const r of ranked) {
    if (supported.includes(r.tag)) return r.tag;
    const base = r.tag.split('-')[0];
    if (supported.includes(base)) return base;
  }
  return fallback;
}
