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
import { injectJsonLd, type OrgType, type SiteInput } from '../services/json-ld';

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

/**
 * Per-snapshot preview hostname pattern:
 *   `{slug}-{snapshot_id}.preview.projectsites.dev`
 *
 * Splits at the LAST `-` so snapshot ids may contain hyphens themselves.
 * Returns `null` when the hostname is not a preview hostname.
 *
 * @example
 *   parsePreviewHostname('acme-snap_42.preview.projectsites.dev')
 *   // → { slug: 'acme', snapshotId: 'snap_42' }
 */
export function parsePreviewHostname(
  hostname: string,
): { slug: string; snapshotId: string } | null {
  const match = /^([a-z0-9][a-z0-9-]*?)-([a-z0-9_]+)\.preview\.projectsites\.dev$/i.exec(
    hostname,
  );
  if (!match || !match[1] || !match[2]) return null;
  return { slug: match[1], snapshotId: match[2] };
}

/**
 * Resolve a URL path to its R2 key.
 *
 * @remarks
 *  - Default tenant hostnames serve from `sites/{slug}/{version}/`.
 *  - `{slug}-{snapshotId}.preview.projectsites.dev` hostnames serve
 *    from `sites/{slug}/snapshots/{snapshotId}/` so reviewers can
 *    eyeball any historical build without rolling production back.
 */
export function resolveR2Key(
  env: Pick<Env, 'TENANT_SLUG' | 'SITE_VERSION'>,
  urlPath: string,
  hostname?: string,
): string {
  const preview = hostname ? parsePreviewHostname(hostname) : null;
  const prefix = preview
    ? `sites/${preview.slug}/snapshots/${preview.snapshotId}/`
    : `sites/${env.TENANT_SLUG}/${env.SITE_VERSION}/`;
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

function orgTypeFromEnv(env: Pick<Env, 'SITE_TYPE'>): OrgType {
  return (env.SITE_TYPE ?? 'software') as OrgType;
}

function siteInputFromEnv(env: Env, reqUrl: URL): SiteInput {
  return {
    name: env.TENANT_NAME,
    url: `${reqUrl.protocol}//${reqUrl.hostname}/`,
    description: undefined,
    email: env.CONTACT_FROM_EMAIL,
  };
}

/**
 * For HTML responses, inject org-type-aware JSON-LD into `<head>` and the
 * privacy-analytics beacon (`<script async src="/_pa/script.js">`) before
 * `</body>`. R2 objects are streams; we materialize as text only when the
 * content type is HTML so non-HTML payloads stay zero-copy.
 */
async function withJsonLd(
  body: ReadableStream<Uint8Array> | null,
  env: Env,
  reqUrl: URL,
): Promise<string | ReadableStream<Uint8Array> | null> {
  if (!body) return null;
  const html = await new Response(body).text();
  const withLd = injectJsonLd(html, orgTypeFromEnv(env), siteInputFromEnv(env, reqUrl));
  return injectAnalyticsBeacon(withLd);
}

/**
 * Inject the privacy-analytics beacon script just before `</body>` (case
 * insensitive). Idempotent — if the page already references `/_pa/script.js`
 * we leave it alone so authored pages can override placement.
 */
export function injectAnalyticsBeacon(html: string): string {
  if (html.includes('/_pa/script.js')) return html;
  const tag = '<script async src="/_pa/script.js"></script>';
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf('</body>');
  if (idx < 0) return `${html}${tag}`;
  return `${html.slice(0, idx)}${tag}${html.slice(idx)}`;
}

app.get('*', async (c) => {
  const reqUrl = new URL(c.req.url);
  const key = resolveR2Key(c.env, reqUrl.pathname, reqUrl.hostname);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) {
    // SPA-style fallback: try `index.html` for unknown extensionless paths.
    if (!/\.[a-z0-9]{2,5}$/i.test(key)) {
      const preview = parsePreviewHostname(reqUrl.hostname);
      const fallbackKey = preview
        ? `sites/${preview.slug}/snapshots/${preview.snapshotId}/index.html`
        : `sites/${c.env.TENANT_SLUG}/${c.env.SITE_VERSION}/index.html`;
      const fallback = await c.env.BUCKET.get(fallbackKey);
      if (fallback) {
        const enriched = await withJsonLd(fallback.body, c.env, reqUrl);
        return new Response(enriched, {
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
  const isHtml = ct.startsWith('text/html');
  const responseBody = isHtml ? await withJsonLd(obj.body, c.env, reqUrl) : obj.body;
  return new Response(responseBody, {
    headers: {
      'content-type': ct,
      'cache-control': cacheControl,
      etag: obj.httpEtag,
      'last-modified': obj.uploaded.toUTCString(),
    },
  });
});

export default app;
