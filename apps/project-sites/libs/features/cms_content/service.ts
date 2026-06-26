/**
 * @module libs/features/cms_content/service
 * @description Worker-side business logic for the CMS content bridge: fetch the
 * Payload blog feed (through the existing CF Access service token), edge-cache it
 * in KV, verify the inbound revalidation HMAC, and purge the cache on publish.
 *
 * @remarks No D1 tables are owned. The only network call is to the Payload CMS,
 * authenticated with the `CF_ACCESS_CLIENT_ID/SECRET` service token already used
 * for container builds — so the worker reaches `cms.projectsites.dev` even though
 * it sits behind Cloudflare Access.
 */
import type { Env } from '../../../src/types/env.js';
import { BlogFeed } from './schemas.js';

/** Default CMS origin; overridable via `CMS_BASE_URL`. */
const DEFAULT_CMS_BASE = 'https://cms.projectsites.dev';

/** KV TTL for the cached feed (seconds). Mirrors the upstream s-maxage. */
const FEED_TTL = 300;

/** Resolve the Payload CMS base URL (no trailing slash). */
export function cmsBaseUrl(env: Env): string {
  return (env.CMS_BASE_URL || DEFAULT_CMS_BASE).replace(/\/+$/, '');
}

/** KV cache key for a given feed limit. */
function feedCacheKey(limit: number): string {
  return `cms:blog:${limit}`;
}

/**
 * Build the CF Access service-token headers so the worker can read the
 * Access-gated CMS. Returns an empty object when the token is unset (local /
 * un-gated deploys) — the fetch then relies on the endpoint being public.
 */
function accessHeaders(env: Env): Record<string, string> {
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    return {
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    };
  }
  return {};
}

/**
 * Fetch the blog feed, KV-cached. Validates the upstream shape with Zod and
 * degrades to an empty feed on any failure (network, Access challenge, malformed
 * body) rather than throwing — a stale CMS must never 500 a consuming site.
 *
 * @param limit Number of posts to request (1-100).
 * @returns A validated, never-null feed envelope.
 */
export async function fetchBlogFeed(env: Env, limit = 50): Promise<BlogFeed> {
  const capped = Math.min(Math.max(1, Math.trunc(limit)), 100);
  const key = feedCacheKey(capped);

  // Cache hit.
  if (env.CACHE_KV) {
    const cached = await env.CACHE_KV.get(key, 'json').catch(() => null);
    const parsed = BlogFeed.safeParse(cached);
    if (parsed.success) return parsed.data;
  }

  // Cache miss → fetch upstream.
  try {
    const res = await fetch(`${cmsBaseUrl(env)}/api/blog.json?limit=${capped}`, {
      headers: { Accept: 'application/json', ...accessHeaders(env) },
    });
    if (!res.ok) return { count: 0, posts: [] };
    const body = await res.json().catch(() => null);
    const parsed = BlogFeed.safeParse(body);
    if (!parsed.success) return { count: 0, posts: [] };

    if (env.CACHE_KV) {
      await env.CACHE_KV.put(key, JSON.stringify(parsed.data), { expirationTtl: FEED_TTL }).catch(
        () => undefined,
      );
    }
    return parsed.data;
  } catch {
    return { count: 0, posts: [] };
  }
}

/** Purge every cached feed page so the next read re-fetches from the CMS. */
export async function purgeBlogCache(env: Env): Promise<void> {
  if (!env.CACHE_KV) return;
  // Limits we cache are bounded (1-100); the common ones are cheap to clear.
  // We delete the full set the proxy can mint so no stale page survives.
  const known = [10, 20, 25, 50, 100];
  await Promise.all(known.map((n) => env.CACHE_KV.delete(feedCacheKey(n)).catch(() => undefined)));
}

/** Constant-time compare of two equal-length byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Hex string → bytes (returns null on malformed input). */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify the `X-PS-Signature` header — `HMAC-SHA256(rawBody, secret)` as hex —
 * against the shared `SITES_REVALIDATE_SECRET`. Constant-time; returns false on
 * any malformed input rather than throwing.
 */
export async function verifySignature(
  secret: string,
  rawBody: string,
  signatureHex: string,
): Promise<boolean> {
  if (!secret || !signatureHex) return false;
  const provided = hexToBytes(signatureHex.trim());
  if (!provided) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  );
  return timingSafeEqual(mac, provided);
}
