/**
 * @module libs/features/cmdk_ai_actions/schemas
 * @description Zod schemas for the Cmd+K AI Actions feature module.
 *
 * Covers the POST /api/cmdk/resolve request body, the Workers AI output
 * contract, and the API response envelope.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Body accepted by POST /api/cmdk/resolve.
 *
 * @remarks
 * `query` is the raw natural-language command the user typed into the palette.
 * `context` is an optional object with caller-supplied hints (current route,
 * active site slug, etc.) that help the LLM produce a more precise intent.
 *
 * @example
 * ```ts
 * const parsed = CmdkResolveBodySchema.parse({ query: 'Go to settings', context: { route: '/admin/sites' } });
 * ```
 *
 * @throws ZodError when required fields are missing or malformed.
 */
export const CmdkResolveBodySchema = z.object({
  /** Natural-language command entered by the user. */
  query: z
    .string()
    .min(1, 'query must not be empty')
    .max(512, 'query must be at most 512 characters'),
  /** Optional caller context to refine intent resolution. */
  context: z
    .object({
      /** Current admin route (e.g. "/admin/sites"). */
      route: z.string().optional(),
      /** Slug of the currently active site, if any. */
      siteSlug: z.string().optional(),
      /** Additional freeform hint string. */
      hint: z.string().max(256).optional(),
    })
    .optional(),
});

export type CmdkResolveBody = z.infer<typeof CmdkResolveBodySchema>;

// ---------------------------------------------------------------------------
// Workers AI output contract
// ---------------------------------------------------------------------------

/**
 * Structured intent returned by the LLM after resolving a natural-language query.
 *
 * @remarks
 * `action` is a stable string token the frontend can switch on.
 * `target` is the destination route or resource identifier.
 * `confidence` is a 0–1 float indicating how certain the model is.
 *
 * @see {@link https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/}
 */
export const ResolvedActionSchema = z.object({
  /** Stable action token. */
  action: z.enum([
    'navigate',
    'create_site',
    'open_settings',
    'search',
    'publish_site',
    'view_analytics',
    'manage_domains',
    'open_docs',
    'unknown',
  ]),
  /** Target route or resource, when the action has a destination. */
  target: z.string().optional(),
  /** Human-readable label for the action, suitable for displaying in the palette. */
  label: z.string(),
  /** Model confidence in the resolved intent, between 0 and 1. */
  confidence: z.number().min(0).max(1),
});

export type ResolvedAction = z.infer<typeof ResolvedActionSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Success response returned by POST /api/cmdk/resolve.
 */
export const CmdkResolveResponseSchema = z.object({
  ok: z.literal(true),
  data: ResolvedActionSchema,
});

export type CmdkResolveResponse = z.infer<typeof CmdkResolveResponseSchema>;

/**
 * Error response shape shared across feature handlers.
 */
export const CmdkResolveErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type CmdkResolveError = z.infer<typeof CmdkResolveErrorSchema>;
