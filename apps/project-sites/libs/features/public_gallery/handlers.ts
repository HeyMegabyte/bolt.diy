/**
 * @module libs/features/public_gallery/handlers
 * @description Hono routes for the Public Gallery feature module (idea #34).
 *
 * | Method | Path                              | Auth | Purpose                                   |
 * | ------ | --------------------------------- | ---- | ----------------------------------------- |
 * | GET    | /gallery                          | no   | Branded SSR gallery page (indexable)      |
 * | GET    | /gallery/sitemap.xml              | no   | Sitemap of gallery entries (pSEO)         |
 * | GET    | /api/gallery                      | no   | JSON list of gallery entries              |
 * | POST   | /api/sites/:id/gallery/opt-in     | yes  | Toggle a site into / out of the gallery   |
 *
 * Every public route 404s when the `public_gallery` flag is off (never 403 —
 * don't leak feature existence) per [[feature-flags]]. The opt-in route is
 * org-scoped: a caller can only toggle a site their org owns.
 *
 * Mounted from `src/index.ts` BEFORE the `*` site-serving catch-all (next to
 * `publicRoutes` / `changelogPublicRoutes`) so the marketing worker never tries
 * to resolve a site for these paths.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { listGalleryEntries, setOptIn } from './service.js';
import {
  FLAG_KEY,
  GalleryQuerySchema,
  GalleryListResponseSchema,
  OptInBodySchema,
  OptInResponseSchema,
  type GalleryEntry,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const publicGallery = new Hono<AppContext>();

const SITE_BASE_URL = 'https://projectsites.dev';

/** Escape a string for safe inclusion in HTML text / attribute context. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a string for safe inclusion in XML element / attribute context. */
function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Render a single gallery card. OG image when present, typographic tile otherwise. */
function renderCard(entry: GalleryEntry): string {
  const name = escapeHtml(entry.name);
  const category = escapeHtml(entry.category);
  const url = escapeHtml(entry.url);
  const media = entry.ogImage
    ? `<img class="card-img" src="${escapeHtml(entry.ogImage)}" alt="${name} — live website preview" loading="lazy" width="1200" height="630" />`
    : `<div class="card-img card-fallback" aria-hidden="true">${escapeHtml(entry.name.slice(0, 1).toUpperCase())}</div>`;
  return `      <article class="card">
        ${media}
        <div class="card-body">
          <span class="card-cat">${category}</span>
          <h2 class="card-name">${name}</h2>
          <div class="card-actions">
            <a class="btn btn-ghost" href="${url}" target="_blank" rel="noopener noreferrer">View live →</a>
            <a class="btn btn-primary" href="${SITE_BASE_URL}/?ref=gallery" rel="noopener">Build one like this</a>
          </div>
        </div>
      </article>`;
}

/** Build JSON-LD `ItemList` for the rendered entries (AI-search + rich snippets). */
function buildItemListJsonLd(entries: GalleryEntry[]): string {
  const itemListElement = entries.map((e, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: e.url,
    name: e.name,
  }));
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Project Sites — Gallery',
    description: 'A showcase of live websites built with Project Sites.',
    numberOfItems: entries.length,
    itemListElement,
  });
}

/** Render the full branded gallery HTML page. */
function renderGalleryHtml(entries: GalleryEntry[], category: string | null): string {
  const cards = entries.length
    ? entries.map(renderCard).join('\n')
    : `      <p class="empty">No sites in the gallery yet. <a href="${SITE_BASE_URL}/?ref=gallery">Build the first one →</a></p>`;
  const heading = category
    ? `${escapeHtml(category)} websites built with Project Sites`
    : 'Websites built with Project Sites';
  const canonical = category
    ? `${SITE_BASE_URL}/gallery?category=${encodeURIComponent(category)}`
    : `${SITE_BASE_URL}/gallery`;
  const jsonLd = buildItemListJsonLd(entries);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gallery · Sites built with Project Sites</title>
<meta name="description" content="A live gallery of ${entries.length} gorgeous websites built with Project Sites — AI-generated, hosted on Cloudflare. See real sites and build your own in minutes." />
<link rel="canonical" href="${canonical}" />
<meta name="color-scheme" content="dark" />
<link rel="icon" href="/favicon.ico" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Gallery · Sites built with Project Sites" />
<meta property="og:description" content="A live gallery of gorgeous websites built with Project Sites — AI-generated, hosted on Cloudflare." />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE_BASE_URL}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root{--bg:#060610;--accent:#00e5ff;--text:#e2e8f0;--text-muted:#94a3b8;--card:rgba(255,255,255,0.03);--border:rgba(0,229,255,0.18);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);min-height:100vh;}
  .wrap{max-width:1200px;margin:0 auto;padding:56px 24px 96px;}
  .eyebrow{font-size:12px;letter-spacing:2px;color:var(--accent);text-transform:uppercase;font-weight:600;}
  h1{font-size:clamp(28px,4vw,42px);margin:8px 0 8px;font-weight:700;text-wrap:balance;}
  .lede{font-size:16px;color:var(--text-muted);margin:0 0 36px;max-width:60ch;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;}
  .card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:transform .2s ease,border-color .2s ease;}
  .card:hover{transform:translateY(-3px);border-color:rgba(0,229,255,0.4);}
  .card-img{width:100%;aspect-ratio:1200/630;object-fit:cover;display:block;background:#0b0b1a;}
  .card-fallback{display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:800;color:var(--accent);background:linear-gradient(135deg,#0b0b1a,#101028);}
  .card-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:10px;}
  .card-cat{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);font-weight:600;}
  .card-name{font-size:18px;margin:0;font-weight:700;}
  .card-actions{display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;}
  .btn{font-size:13px;font-weight:600;padding:8px 14px;border-radius:10px;text-decoration:none;transition:all .2s ease;display:inline-block;}
  .btn-ghost{color:var(--accent);border:1px solid var(--border);}
  .btn-ghost:hover{background:rgba(0,229,255,0.08);}
  .btn-primary{color:#060610;background:var(--accent);}
  .btn-primary:hover{filter:brightness(1.1);}
  .empty{color:var(--text-muted);font-size:16px;}
  .empty a,footer a{color:var(--accent);}
  footer{margin-top:48px;font-size:12px;color:var(--text-muted);text-align:center;}
</style>
</head>
<body>
<main class="wrap">
  <div class="eyebrow">Gallery</div>
  <h1>${heading}</h1>
  <p class="lede">Real, live websites built and hosted with Project Sites. Each one started as a single prompt. Yours can too.</p>
  <div class="grid">
${cards}
  </div>
  <footer>
    ${entries.length} live ${entries.length === 1 ? 'site' : 'sites'} · <a href="${SITE_BASE_URL}/?ref=gallery">Build your own →</a>
  </footer>
</main>
</body>
</html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────

/** Branded SSR gallery page — indexable, JSON-LD ItemList, OG tags. */
publicGallery.get('/gallery', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY))) return c.notFound();
  const query = GalleryQuerySchema.parse({
    category: c.req.query('category'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  const { entries } = await listGalleryEntries(c.env, query);
  return c.html(renderGalleryHtml(entries, query.category ?? null), 200, {
    'Cache-Control': 'public, max-age=300, s-maxage=300',
  });
});

/** Sitemap of gallery entries (pSEO). */
publicGallery.get('/gallery/sitemap.xml', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY))) return c.notFound();
  const { entries } = await listGalleryEntries(c.env, GalleryQuerySchema.parse({ limit: 100 }));
  const urls = [`${SITE_BASE_URL}/gallery`, ...entries.map((e) => e.url)]
    .map(
      (loc, i) =>
        `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(
          (entries[i - 1]?.builtAt ?? new Date().toISOString()).slice(0, 10),
        )}</lastmod></url>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=600',
    },
  });
});

/** JSON list of gallery entries. */
publicGallery.get('/api/gallery', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY))) return c.notFound();
  const query = GalleryQuerySchema.parse({
    category: c.req.query('category'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  const { entries, total } = await listGalleryEntries(c.env, query);
  const body = GalleryListResponseSchema.parse({
    entries,
    count: total,
    category: query.category ?? null,
  });
  return c.json(body, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
});

/** Toggle a site into / out of the gallery (auth + org-scoped). */
publicGallery.post('/api/sites/:id/gallery/opt-in', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY))) return c.notFound();

  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }

  const siteId = c.req.param('id');
  const body = OptInBodySchema.parse(await c.req.json());

  const ok = await setOptIn(c.env, orgId, siteId, body.on);
  if (!ok) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }
  return c.json(OptInResponseSchema.parse({ siteId, galleryOptIn: body.on }));
});
