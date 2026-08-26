/**
 * @module libs/features/site_preview/handlers
 *
 * @description
 * `GET /api/sites/:slug/preview` — serves a site's built `index.html` straight
 * from R2 so the admin panel can render a preview without hitting the
 * subdomain-serving path (which triggers CF challenges). Public read; no D1.
 *
 * Extracted VERBATIM from the `search.ts` monolith (route-decomposition
 * installment 28) — only the route-registration receiver changed
 * (`search.` → `sitePreview.`). A site-serving concern that never belonged in the
 * search-routes file.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { DOMAINS } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const sitePreview = new Hono<AppContext>();

/**
 * Site preview — serves the site's index.html from R2 directly. Used by the admin
 * panel to show previews without triggering CF challenges.
 */
sitePreview.get('/api/sites/:slug/preview', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) return c.text('Missing slug', 400);

  try {
    const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);
    if (!manifest) {
      return c.text('Site not found', 404);
    }
    const manifestData = (await manifest.json()) as { current_version?: string };
    const version = manifestData.current_version;
    if (!version) return c.text('No published version', 404);

    const html = await c.env.SITES_BUCKET.get(`sites/${slug}/${version}/index.html`);
    if (!html) return c.text('HTML not found', 404);

    let content = await html.text();
    // Inject base tag so relative URLs resolve correctly.
    content = content.replace(
      '<head>',
      `<head><base href="https://${slug}${DOMAINS.SITES_SUFFIX}/">`,
    );

    return new Response(content, {
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        'X-Frame-Options': 'ALLOWALL',
      },
    });
  } catch {
    return c.text('Preview error', 500);
  }
});
