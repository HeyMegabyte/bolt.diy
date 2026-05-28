/**
 * Zod schemas for {{slug}} request/response validation.
 *
 * @remarks
 * Schemas are the single source of truth — derive TypeScript types from them,
 * not the other way around.
 *
 * @example
 * ```ts
 * import { {{Name}}RequestSchema } from './feature.schemas.js';
 * const parsed = {{Name}}RequestSchema.parse(body);
 * ```
 */

import { z } from 'zod';

// ─── Request ────────────────────────────────────────────────────────────────

export const {{Name}}RequestSchema = z.object({
  // TODO: add request fields
  name: z.string().min(1).max(255).describe('Human-readable name for the resource'),
}).strict();

// ─── Response ───────────────────────────────────────────────────────────────

export const {{Name}}ResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime().optional(),
});

// ─── Query params ────────────────────────────────────────────────────────────

export const {{Name}}ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().optional().describe('Full-text search query'),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type {{Name}}Request = z.infer<typeof {{Name}}RequestSchema>;
export type {{Name}}Response = z.infer<typeof {{Name}}ResponseSchema>;
export type {{Name}}ListQuery = z.infer<typeof {{Name}}ListQuerySchema>;
