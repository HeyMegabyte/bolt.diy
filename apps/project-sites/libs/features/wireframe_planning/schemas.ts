/**
 * @module libs/features/wireframe_planning/schemas
 * @description Zod schemas for the wireframe_planning feature.
 *
 * All request bodies and response shapes flow through these schemas.
 * Use `z.infer<typeof Schema>` to derive TypeScript types — never hand-write
 * duplicates.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Request body for POST /api/wireframe/plan */
export const WireframePlanCreateSchema = z
  .object({
    siteId: z.string().min(1, 'siteId is required'),
    prompt: z.string().min(10, 'prompt must be at least 10 characters'),
  })
  .strict();

export type WireframePlanCreateInput = z.infer<typeof WireframePlanCreateSchema>;

/** Shape of a stored wireframe plan returned to callers */
export const WireframePlanSchema = z
  .object({
    id: z.string(),
    siteId: z.string(),
    prompt: z.string(),
    sections: z.array(z.string()),
    createdAt: z.string(),
  })
  .strict();

export type WireframePlan = z.infer<typeof WireframePlanSchema>;

/** Response envelope for POST /api/wireframe/plan (201) */
export const WireframePlanCreateResponseSchema = z
  .object({
    ok: z.literal(true),
    plan: WireframePlanSchema,
  })
  .strict();

/** Response envelope for GET /api/wireframe/:siteId (200) */
export const WireframePlanGetResponseSchema = z
  .object({
    ok: z.literal(true),
    plan: WireframePlanSchema.nullable(),
  })
  .strict();
