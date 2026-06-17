/**
 * @module libs/features/site_thumbnail_grid/service
 * @description Business logic for the site_thumbnail_grid feature module.
 *
 * @remarks
 * Captures browser screenshots of published sites via the Cloudflare Browser
 * Rendering REST API, caches the PNG result in R2, and returns a CDN URL.
 * On any error (missing credentials, API failure) the function returns
 * `{ thumbnailUrl: null, generated: false }` — it never throws.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';

export const FLAG_KEY = 'site_thumbnail_grid';

const CDN_BASE = 'https://cdn.projectsites.dev';

/**
 * Get or generate a thumbnail for a published site.
 *
 * @remarks
 * Checks R2 for an existing thumbnail first. If found, returns the CDN URL
 * without generating a new screenshot. If not found, calls the Cloudflare
 * Browser Rendering screenshot API and stores the result in R2.
 *
 * @param env - Worker environment bindings
 * @param siteId - Site slug/identifier (used as the R2 object key basename)
 * @returns Thumbnail URL + whether it was freshly generated
 */
export async function captureThumbnail(
  env: Env,
  siteId: string,
): Promise<{ thumbnailUrl: string | null; generated: boolean }> {
  const r2Key = `thumbnails/${siteId}.png`;
  const cdnUrl = `${CDN_BASE}/${r2Key}`;

  // Check R2 cache first
  const existing = await env.SITES_BUCKET.head(r2Key);
  if (existing) {
    return { thumbnailUrl: cdnUrl, generated: false };
  }

  // Need CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN to call Browser Rendering API
  const { CF_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = env as unknown as { CF_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string };

  if (!accountId || !apiToken) {
    return { thumbnailUrl: null, generated: false };
  }

  try {
    const screenshotUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`;
    const siteUrl = `https://${siteId}.projectsites.dev`;

    const response = await fetch(screenshotUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: siteUrl,
        options: {
          viewport: { width: 1280, height: 720 },
        },
      }),
    });

    if (!response.ok) {
      return { thumbnailUrl: null, generated: false };
    }

    const imageBytes = await response.arrayBuffer();

    await env.SITES_BUCKET.put(r2Key, imageBytes, {
      httpMetadata: { contentType: 'image/png' },
    });

    return { thumbnailUrl: cdnUrl, generated: true };
  } catch {
    return { thumbnailUrl: null, generated: false };
  }
}
