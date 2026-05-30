/**
 * @module libs/features/search_submit/service
 * @description Search/AI-Engine Auto-Submit (idea #3).
 *
 * On publish, notify search + AI engines so a freshly-published site gets
 * crawled fast:
 *  - **IndexNow** (`https://api.indexnow.org/indexnow`) — Bing + Yandex consume
 *    this; Bing is what ChatGPT search reads. Requires a per-site key served at
 *    `/{key}.txt` so the engine can verify host ownership.
 *  - **Bing sitemap ping** (`https://www.bing.com/ping?sitemap=`).
 *  - **Google ping** (`https://www.google.com/ping?sitemap=`) as a fallback.
 *
 * Safe-by-default: {@link submitSite} never throws into the publish path — every
 * failure is caught + logged to `audit_logs`. No new table is introduced.
 *
 * @packageDocumentation
 */

import { DOMAINS } from '@project-sites/shared';
import type { Env } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { writeAuditLog } from '../../../src/services/audit.js';
import { SubmitResultSchema, type SubmitResult, type IndexNowKey } from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'search_engine_submit';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Derive the deterministic per-site IndexNow key from the site id. SHA-256 of
 * `indexnow:{siteId}` truncated to 32 lowercase hex chars — stable across
 * re-submits so the served `/{key}.txt` never has to change, and no new table
 * is needed to persist it.
 *
 * @param siteId - The site's id.
 * @returns The key value + the well-known `/{key}.txt` path to expose.
 *
 * @example
 * ```ts
 * const { key, keyPath } = await deriveIndexNowKey('abc-123');
 * // key === 'a1b2…' ; keyPath === '/a1b2….txt'
 * ```
 */
export async function deriveIndexNowKey(siteId: string): Promise<IndexNowKey> {
  const data = new TextEncoder().encode(`indexnow:${siteId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const key = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  return { key, keyPath: `/${key}.txt` };
}

/**
 * Build the canonical public host for a site (`{slug}.projectsites.dev`).
 *
 * @param slug - The site slug.
 * @returns Host without scheme.
 */
export function siteHost(slug: string): string {
  return `${slug}${DOMAINS.SITES_SUFFIX}`;
}

/**
 * Build the set of sitemap-derived URLs to submit for a site. We submit the
 * sitemap URL plus the homepage so engines have an entry point even if the
 * sitemap fetch lags.
 *
 * @param slug - The site slug.
 * @returns Absolute https URLs.
 */
export function buildSitemapUrls(slug: string): string[] {
  const base = `https://${siteHost(slug)}`;
  return [`${base}/`, `${base}/sitemap.xml`];
}

/**
 * Submit a URL list to IndexNow (Bing + Yandex). The request carries the
 * per-site key + the `keyLocation` so the engine can verify ownership via the
 * publicly-served `/{key}.txt`.
 *
 * @param host    - The verified host (no scheme).
 * @param key     - The IndexNow key for `host`.
 * @param urlList - Absolute URLs to submit.
 * @returns Typed {@link SubmitResult}; never throws.
 */
export async function submitIndexNow(
  host: string,
  key: string,
  urlList: string[],
): Promise<SubmitResult> {
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList,
      }),
    });
    return SubmitResultSchema.parse({
      engine: 'indexnow',
      ok: res.ok,
      status: res.status,
      submittedUrls: urlList,
    });
  } catch (err) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'search_submit', engine: 'indexnow', error: errMsg(err) }),
    );
    return { engine: 'indexnow', ok: false, status: 0, submittedUrls: urlList };
  }
}

/**
 * Ping an engine's sitemap endpoint (Bing or Google). Both accept
 * `?sitemap={encoded-url}`.
 *
 * @param engine     - `'bing'` or `'google'`.
 * @param sitemapUrl - Absolute https sitemap URL.
 * @returns Typed {@link SubmitResult}; never throws.
 */
export async function pingSitemap(
  engine: 'bing' | 'google',
  sitemapUrl: string,
): Promise<SubmitResult> {
  const base = engine === 'bing' ? 'https://www.bing.com/ping' : 'https://www.google.com/ping';
  const url = `${base}?sitemap=${encodeURIComponent(sitemapUrl)}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT } });
    return SubmitResultSchema.parse({
      engine,
      ok: res.ok,
      status: res.status,
      submittedUrls: [sitemapUrl],
    });
  } catch (err) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'search_submit', engine, error: errMsg(err) }),
    );
    return { engine, ok: false, status: 0, submittedUrls: [sitemapUrl] };
  }
}

/** Site row needed to build submission URLs. */
interface SiteRow {
  id: string;
  slug: string;
  org_id: string;
}

/**
 * Submit a published site to every engine: IndexNow (Bing + Yandex) + a Bing
 * sitemap ping + a Google ping fallback. Each result is logged to `audit_logs`.
 *
 * Safe-by-default: catches everything, never throws — designed to be awaited
 * from the publish path without ever failing a publish.
 *
 * @param env    - Worker env (uses `env.DB`).
 * @param siteId - The published site's id.
 * @returns The per-engine {@link SubmitResult} list (empty when the site is unresolvable).
 *
 * @example
 * ```ts
 * // In the publish hook, flag-gated + error-swallowed:
 * await submitSite(env, params.siteId).catch(() => []);
 * ```
 */
export async function submitSite(env: Env, siteId: string): Promise<SubmitResult[]> {
  try {
    const site = await dbQueryOne<SiteRow>(
      env.DB,
      'SELECT id, slug, org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [siteId],
    ).catch(() => null);

    if (!site?.slug) {
      console.warn(
        JSON.stringify({ level: 'warn', service: 'search_submit', message: 'site_unresolvable', siteId }),
      );
      return [];
    }

    const host = siteHost(site.slug);
    const urls = buildSitemapUrls(site.slug);
    const sitemapUrl = `https://${host}/sitemap.xml`;
    const { key } = await deriveIndexNowKey(site.id);

    const results = await Promise.all([
      submitIndexNow(host, key, urls),
      pingSitemap('bing', sitemapUrl),
      pingSitemap('google', sitemapUrl),
    ]);

    // Log each engine result to the existing audit_logs table (never throws).
    for (const r of results) {
      await writeAuditLog(env.DB, {
        org_id: site.org_id,
        actor_id: null,
        action: 'site.search_submit',
        message: `Search submit to ${r.engine}: ${r.ok ? 'ok' : 'failed'} (HTTP ${r.status})`,
        target_type: 'site',
        target_id: site.id,
        metadata_json: { site_id: site.id, engine: r.engine, ok: r.ok, status: r.status, urls: r.submittedUrls },
      });
    }

    return results;
  } catch (err) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'search_submit', message: 'submit_site_threw', siteId, error: errMsg(err) }),
    );
    return [];
  }
}

/** Narrow an unknown error to a string message. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
