/**
 * @module services/cdn_purge
 *
 * @description
 * Pure helpers for building Cloudflare cache-purge request bodies.
 * No I/O — constructs the JSON body for `POST /client/v4/zones/{zone}/purge_cache`
 * from typed parameters. Validates input via Zod before emission.
 *
 * Zod also validates the output shape so callers never send a malformed body
 * to the CF API — the output schema IS the runtime contract.
 *
 * @see https://developers.cloudflare.com/api/operations/zone-purge-purge-all-cached-assets
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Zod schema for a single URL to purge. */
export const UrlPurgeItemSchema = z.object({
  /** Optional list of asset headers to include (Cloudflare Enterprise only). */
  headers: z.record(z.string()).optional(),
  url: z.string().url({ message: 'Each purge URL must be a valid absolute URL' }),
});

/** Input schema for {@link buildPurgeRequest}. */
export const BuildPurgeRequestSchema = z
  .array(z.string().url({ message: 'Each purge URL must be a valid absolute URL' }))
  .min(1, { message: 'At least one URL is required for url-based purge' })
  .max(30, { message: `At most ${30} URLs per purge request` });

/** Zod schema for the Cloudflare purge_cache request body (url-based variant). */
export const PurgeFilesBodySchema = z.object({
  files: z.array(UrlPurgeItemSchema).min(1).max(30),
});

/** Input schema for {@link purgeByTag}. */
export const PurgeByTagSchema = z
  .array(z.string().min(1, { message: 'Tags must be non-empty strings' }))
  .min(1, { message: 'At least one tag is required for tag-based purge' })
  .max(30, { message: `At most ${30} tags per purge request` });

/** Zod schema for the Cloudflare purge_cache request body (tag-based variant). */
export const PurgeTagsBodySchema = z.object({
  tags: z.array(z.string()).min(1).max(30),
});

/** Input schema for {@link purgeByPrefix}. */
export const PurgeByPrefixSchema = z
  .string()
  .min(1, { message: 'Prefix must be a non-empty string' });

/** Zod schema for the Cloudflare purge_cache request body (prefix-based variant). */
export const PurgePrefixBodySchema = z.object({
  prefixes: z.array(z.string()).min(1),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Validated type for a single URL purge item. */
export type UrlPurgeItem = z.infer<typeof UrlPurgeItemSchema>;
/** Validated type for the url-based purge body. */
export type PurgeFilesBody = z.infer<typeof PurgeFilesBodySchema>;
/** Validated type for the tag-based purge body. */
export type PurgeTagsBody = z.infer<typeof PurgeTagsBodySchema>;
/** Validated type for the prefix-based purge body. */
export type PurgePrefixBody = z.infer<typeof PurgePrefixBodySchema>;

/** All accepted purge modes. */
export type PurgeMode = 'urls' | 'tags' | 'prefixes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard limit on the number of URLs, tags, or prefixes per single purge request.
 * Cloudflare imposes a maximum of 30 per batch on the `purge_cache` endpoint.
 */
export const MAX_URLS_PER_PURGE = 30 as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a validated Cloudflare `purge_cache` request body for URL-based purging.
 *
 * Accepts an array of absolute URLs (max 30 per the CF API limit), wraps each
 * into a `{ url }` item, validates the output against `PurgeFilesBodySchema`,
 * and returns the typed body ready to POST.
 *
 * @param urls - Absolute URLs to purge from the edge cache.
 * @returns A typed `PurgeFilesBody` shaped for the CF API.
 *
 * @example
 * buildPurgeRequest([
 *   'https://example.com/about',
 *   'https://example.com/index.html',
 * ]);
 * // → { files: [{ url: 'https://example.com/about' }, { url: 'https://example.com/index.html' }] }
 */
export function buildPurgeRequest(urls: string[]): PurgeFilesBody {
  const parsed = BuildPurgeRequestSchema.parse(urls);
  const body: PurgeFilesBody = { files: parsed.map((url) => ({ url })) };
  return PurgeFilesBodySchema.parse(body);
}

/**
 * Build a validated Cloudflare `purge_cache` request body for tag-based purging.
 *
 * Accepts an array of cache tags (max 30). Tags are set on objects via
 * `Cache-Tag` response headers; this purge operation invalidates every edge
 * cache entry tagged with any of the given tags.
 *
 * @param tags - Cache tags to purge (max 30).
 * @returns A typed `PurgeTagsBody` shaped for the CF API.
 *
 * @example
 * purgeByTag(['site-abc123', 'homepage', 'v2-release']);
 * // → { tags: ['site-abc123', 'homepage', 'v2-release'] }
 */
export function purgeByTag(tags: string[]): PurgeTagsBody {
  const parsed = PurgeByTagSchema.parse(tags);
  const body: PurgeTagsBody = { tags: parsed };
  return PurgeTagsBodySchema.parse(body);
}

/**
 * Build a validated Cloudflare `purge_cache` request body for prefix-based purging.
 *
 * Invalidates every cached object whose URL starts with the given prefix
 * (e.g. `https://example.com/blog/`). Prefix must be at least one character
 * and is wrapped in an array for the CF API contract.
 *
 * @param prefix - URL prefix (e.g. `https://example.com/blog/`).
 * @returns A typed `PurgePrefixBody` shaped for the CF API.
 *
 * @example
 * purgeByPrefix('https://example.com/blog/');
 * // → { prefixes: ['https://example.com/blog/'] }
 */
export function purgeByPrefix(prefix: string): PurgePrefixBody {
  const parsed = PurgeByPrefixSchema.parse(prefix);
  const body: PurgePrefixBody = { prefixes: [parsed] };
  return PurgePrefixBodySchema.parse(body);
}
