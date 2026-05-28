/**
 * TypeScript domain types for {{slug}}.
 *
 * @remarks
 * Keep this file free of runtime deps — types only. Zod schemas live in
 * `feature.schemas.ts` and are the source of truth; derive types from them:
 *
 * ```ts
 * import type { z } from 'zod';
 * import { {{Name}}RequestSchema } from './feature.schemas.js';
 * export type {{Name}}Request = z.infer<typeof {{Name}}RequestSchema>;
 * ```
 */

/** Primary domain entity for {{slug}}. */
export interface {{Name}}Entity {
  /** UUID primary key. */
  id: string;
  /** Organisation that owns this entity. */
  orgId: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
  // TODO: add domain fields
}

/** Context passed to service functions. */
export interface {{Name}}Context {
  orgId: string;
  siteId?: string;
  userId?: string;
}

/** Possible error codes surfaced by {{slug}} handlers. */
export type {{Name}}ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';
