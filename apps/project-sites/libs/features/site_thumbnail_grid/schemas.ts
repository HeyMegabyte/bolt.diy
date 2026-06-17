/**
 * @module libs/features/site_thumbnail_grid/schemas
 * @description Zod schemas for the site_thumbnail_grid feature module.
 * @packageDocumentation
 */

import { z } from 'zod';

export const ThumbnailResponseSchema = z.object({
  ok: z.literal(true),
  thumbnailUrl: z.string().nullable(),
  generated: z.boolean(),
});
export type ThumbnailResponse = z.infer<typeof ThumbnailResponseSchema>;
