/**
 * Static asset serving from R2 at `sites/{slug}/{version}/`.
 *
 * @remarks
 *  Path resolution:
 *   - `/` → `index.html`
 *   - `/about` → `about.html` (or `about/index.html` fallback)
 *   - `/assets/app.js` → `assets/app.js`
 *
 *  Caching strategy:
 *   - Hashed asset paths (containing `.<hex>.` or `/_immutable/`) → 1 year + immutable
 *   - Everything else → 60s stale-while-revalidate
 *
 *  Always sets explicit `Content-Type` based on extension (NOT request path,
 *  per the known bug in the v1 worker — use the resolved R2 key).
 */
import { Hono } from 'hono';
import type { AppContext, Env } from '../env';
import { renderErrorPage } from '../error-pages/render';

const app = new Hono<AppContext>();

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** Resolve a URL path to its R2 key under `sites/{slug}/{version}/`. */
export function resolveR2Key(env: Pick<Env, 'TENANT_SLUG' | 'SITE_VERSION'>, urlPath: string): string {
  const prefix = `sites/${env.TENANT_SLUG}/${env.SITE_VERSION}/`;
  let p = urlPath.replace(/^\/+/, '').replace(/\?.*$/, '');
  if (p === '' || p.endsWith('/')) p = `${p}index.html`;
  // If no extension, try `.html`.
  if (!/\.[a-z0-9]{2,5}$/i.test(p)) p = `${p}.html`;
  return prefix + p;
}

function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

function isImmutable(key: string): boolean {
  return /\.[a-f0-9]{8,}\./.test(key) || key.includes('/_immutable/') || /\/assets\//.test(key);
}

app.get('*', async (c) => {
  const key = resolveR2Key(c.env, new URL(c.req.url).pathname);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) {
    // SPA-style fallback: try `index.html` for unknown extensionless paths.
    if (!/\.[a-z0-9]{2,5}$/i.test(key)) {
      const fallback = await c.env.BUCKET.get(
        `sites/${c.env.TENANT_SLUG}/${c.env.SITE_VERSION}/index.html`,
      );
      if (fallback) {
        return new Response(fallback.body, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=60, stale-while-revalidate=600',
            etag: fallback.httpEtag,
          },
        });
      }
    }
    return renderErrorPage(c, { status: 404, code: 'ASSET_MISSING', title: 'Page not found' });
  }
  const ct = contentTypeFor(key);
  const cacheControl = isImmutable(key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=60, stale-while-revalidate=600';
  return new Response(obj.body, {
    headers: {
      'content-type': ct,
      'cache-control': cacheControl,
      etag: obj.httpEtag,
      'last-modified': obj.uploaded.toUTCString(),
    },
  });
});

export default app;
