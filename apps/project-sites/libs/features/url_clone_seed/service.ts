/**
 * @module libs/features/url_clone_seed/service
 * @description Business logic for the URL Clone Seed feature module.
 *
 * Uses the Cloudflare Browser Rendering REST API to render a remote URL and
 * extract its HTML + text content.  All external calls are wrapped with
 * timeouts so a slow source site cannot block the Worker indefinitely.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { ExtractedContentSchema } from './schemas.js';
import type { ExtractedContent } from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'url_clone_seed';

/**
 * Cloudflare Browser Rendering REST API endpoint for page content.
 *
 * @see {@link https://developers.cloudflare.com/browser-rendering/rest-api/}
 */
const BROWSER_RENDERING_URL =
  'https://api.cloudflare.com/client/v4/accounts/{accountId}/browser-rendering/content';

/** Maximum milliseconds to wait for the Browser Rendering API. */
const TIMEOUT_MS = 20_000;

/**
 * Extract HTML and text content from a remote URL using Cloudflare Browser Rendering.
 *
 * @remarks
 * The Browser Rendering REST API renders the page with a real Chromium instance
 * so JavaScript-heavy sites produce meaningful content.  The result is validated
 * through {@link ExtractedContentSchema} before being returned.
 *
 * @param env - Worker env (uses `env.CF_ACCOUNT_ID` and `env.CF_API_TOKEN`).
 * @param url - HTTPS URL to render and extract content from.
 * @returns Extracted content or `null` when the API call fails.
 *
 * @example
 * ```ts
 * const content = await cloneFromUrl(env, 'https://example.com');
 * if (!content) return c.json({ error: { code: 'EXTRACTION_FAILED', message: 'Could not fetch URL' } }, 502);
 * ```
 *
 * @throws Never — all errors are caught and return `null`.
 */
export async function cloneFromUrl(env: Env, url: string): Promise<ExtractedContent | null> {
  const { CF_ACCOUNT_ID: accountId, CF_API_TOKEN: apiToken } = env as unknown as { CF_ACCOUNT_ID?: string; CF_API_TOKEN?: string };

  if (!accountId || !apiToken) {
    console.warn('[url_clone_seed] Missing CF_ACCOUNT_ID or CF_API_TOKEN — cannot call Browser Rendering');
    return null;
  }

  const endpoint = BROWSER_RENDERING_URL.replace('{accountId}', accountId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      console.warn('[url_clone_seed] Browser Rendering API error', response.status, await response.text().catch(() => ''));
      return null;
    }

    const raw: unknown = await response.json();

    // The CF Browser Rendering /content endpoint returns:
    // { result: { html: string, text: string }, success: boolean, errors: [] }
    const payload = raw as Record<string, unknown>;
    if (!payload['success']) {
      console.warn('[url_clone_seed] Browser Rendering returned success=false', JSON.stringify(payload['errors']));
      return null;
    }

    const result = payload['result'] as Record<string, unknown>;
    const html = typeof result['html'] === 'string' ? result['html'] : '';
    const textContent = typeof result['text'] === 'string' ? result['text'] : '';

    // Extract <title> from the rendered HTML.
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract og:description or meta description.
    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    const description = (ogDescMatch ?? metaDescMatch)?.[1]?.trim();

    const parsed = ExtractedContentSchema.safeParse({ html, textContent, title, description });
    if (!parsed.success) {
      console.warn('[url_clone_seed] Schema validation failed', parsed.error.issues);
      return null;
    }

    return parsed.data;
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      console.warn('[url_clone_seed] Browser Rendering request timed out after', TIMEOUT_MS, 'ms');
    } else {
      console.warn('[url_clone_seed] Unexpected error calling Browser Rendering', err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
