/**
 * @module libs/features/search_submit/schemas
 * @description Zod schemas for the Search/AI-Engine Auto-Submit feature module
 * (idea #3). Source of truth per [[zod-everywhere]] — types are inferred, never
 * hand-maintained.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** The engines we submit to. `indexnow` covers Bing + Yandex in one call. */
export const SearchEngineSchema = z.enum(['indexnow', 'bing', 'google']);
export type SearchEngine = z.infer<typeof SearchEngineSchema>;

/**
 * Outcome of a single engine submission. `ok` reflects an HTTP 2xx; `status`
 * carries the raw HTTP status (0 when the request never completed).
 */
export const SubmitResultSchema = z
  .object({
    engine: SearchEngineSchema,
    ok: z.boolean(),
    status: z.number().int().nonnegative(),
    submittedUrls: z.array(z.string().url()),
  })
  .strict();
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

/** Response for `POST /api/sites/:id/search-submit`. */
export const SubmitSiteResponseSchema = z
  .object({
    siteId: z.string().min(1),
    host: z.string().min(1),
    keyPath: z.string().min(1),
    sitemapUrls: z.array(z.string().url()),
    results: z.array(SubmitResultSchema),
  })
  .strict();
export type SubmitSiteResponse = z.infer<typeof SubmitSiteResponseSchema>;

/** IndexNow key descriptor: the key value + the well-known path the worker exposes. */
export const IndexNowKeySchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{32}$/),
    keyPath: z.string().regex(/^\/[a-f0-9]{32}\.txt$/),
  })
  .strict();
export type IndexNowKey = z.infer<typeof IndexNowKeySchema>;
