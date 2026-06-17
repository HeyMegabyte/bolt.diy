/**
 * @module libs/features/url_clone_seed/schemas
 * @description Zod schemas for the URL Clone Seed feature module.
 *
 * Covers the POST /api/clone/seed request body and response envelope.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Body accepted by POST /api/clone/seed.
 *
 * @remarks
 * `url` must be an https URL pointing to a publicly-reachable page.
 * `siteId` is the target site that will be seeded with the extracted content.
 *
 * @example
 * ```ts
 * const parsed = CloneSeedBodySchema.parse({ url: 'https://example.com', siteId: 'site-abc-123' });
 * ```
 *
 * @throws ZodError when required fields are missing or malformed.
 */
export const CloneSeedBodySchema = z.object({
  /** Publicly-reachable HTTPS URL to clone content from. */
  url: z
    .string()
    .url('Must be a valid URL')
    .refine((v) => v.startsWith('https://'), { message: 'Only https URLs are accepted' }),
  /** Target site ID that will receive the extracted content. */
  siteId: z.string().min(1, 'siteId is required'),
});

export type CloneSeedBody = z.infer<typeof CloneSeedBodySchema>;

// ---------------------------------------------------------------------------
// Service / internal
// ---------------------------------------------------------------------------

/**
 * Content payload extracted from the source URL.
 */
export const ExtractedContentSchema = z.object({
  /** Raw HTML of the page after JavaScript rendering. */
  html: z.string(),
  /** Plain-text content stripped of HTML tags. */
  textContent: z.string(),
  /** Value of the page <title> element. */
  title: z.string(),
  /** Value of the og:description or meta description tag, if present. */
  description: z.string().optional(),
});

export type ExtractedContent = z.infer<typeof ExtractedContentSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Success response returned by POST /api/clone/seed.
 */
export const CloneSeedResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    /** Title extracted from the source page. */
    title: z.string(),
    /** Description extracted from the source page, if any. */
    description: z.string().optional(),
    /** Character count of the extracted text content. */
    textLength: z.number().int().nonnegative(),
    /** ISO timestamp of when the extraction occurred. */
    extractedAt: z.string(),
  }),
});

export type CloneSeedResponse = z.infer<typeof CloneSeedResponseSchema>;

/**
 * Error response shape shared across feature handlers.
 */
export const CloneSeedErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type CloneSeedError = z.infer<typeof CloneSeedErrorSchema>;
