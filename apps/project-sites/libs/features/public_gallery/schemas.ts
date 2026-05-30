/**
 * @module libs/features/public_gallery/schemas
 * @description Zod schemas for the Public Gallery feature module (idea #34).
 *
 * Single source of truth for the gallery entry shape + API envelopes per
 * [[zod-everywhere]]. Types are inferred via `z.infer`, never hand-maintained.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Flag key gating this feature. */
export const FLAG_KEY = 'public_gallery' as const;

/**
 * A single gallery card — one opted-in published site.
 *
 * @remarks
 * `ogImage` is optional: not every published site has a branded OG card, so the
 * SSR renderer falls back to a typographic tile when it is absent.
 */
export const GalleryEntrySchema = z
  .object({
    /** Site slug — also the subdomain (`{slug}.projectsites.dev`). */
    slug: z.string().min(1),
    /** Business / site display name. */
    name: z.string().min(1),
    /** Business category (free-form; defaults to `'Website'` when unknown). */
    category: z.string().min(1),
    /** Absolute live URL for the published site. */
    url: z.string().url(),
    /** Absolute OG-image URL, when the site ships one. */
    ogImage: z.string().url().optional(),
    /** ISO-8601 timestamp the site was first published / created. */
    builtAt: z.string().min(1),
  })
  .strict();

export type GalleryEntry = z.infer<typeof GalleryEntrySchema>;

/** Response envelope for `GET /api/gallery`. */
export const GalleryListResponseSchema = z
  .object({
    entries: z.array(GalleryEntrySchema),
    count: z.number().int().nonnegative(),
    category: z.string().nullable(),
  })
  .strict();

export type GalleryListResponse = z.infer<typeof GalleryListResponseSchema>;

/** Query params for the list endpoints. */
export const GalleryQuerySchema = z
  .object({
    category: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(48),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type GalleryQuery = z.infer<typeof GalleryQuerySchema>;

/** Body for `POST /api/sites/:id/gallery/opt-in`. */
export const OptInBodySchema = z
  .object({
    /** `true` to list the site in the gallery, `false` to remove it. */
    on: z.boolean(),
  })
  .strict();

export type OptInBody = z.infer<typeof OptInBodySchema>;

/** Response for the opt-in toggle. */
export const OptInResponseSchema = z
  .object({
    siteId: z.string().min(1),
    galleryOptIn: z.boolean(),
  })
  .strict();

export type OptInResponse = z.infer<typeof OptInResponseSchema>;
