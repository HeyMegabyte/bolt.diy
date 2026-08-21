/**
 * @module libs/features/domains/schemas
 *
 * @description
 * Zod request contracts for the domains feature (search / purchase / register /
 * suggest). Every handler validates its input through one of these AT THE
 * BOUNDARY — no raw `as {…}` casts (zod-everywhere). Types are inferred, never
 * hand-maintained.
 *
 * Extracted from the `api.ts` monolith (route-decomposition installment 1).
 */
import { z } from 'zod';

/**
 * Site PKs are MIXED-format in prod: real UUID rows coexist with legacy
 * slug-style ids (`e2e-site-1`, `site-megabytespace-001`). Validate SHAPE only —
 * the org-ownership guard is the real gate (404 on missing/foreign, never leak
 * existence). A `.uuid()` here 400'd every slug-id site's domain picker
 * (reference incident 2026-08-20).
 */
export const siteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._-]+$/, 'site_id must be a valid site id');

/**
 * Body contract for `POST /api/domains/purchase`. `success_url`/`cancel_url`
 * are optional https URLs, further clamped to the site's own domains via
 * `pickSafeRedirect` before reaching Stripe (open-redirect guard).
 */
export const DomainPurchaseSchema = z.object({
  domain: z.string().min(1).max(253),
  site_id: z.string().min(1),
  success_url: z.string().url().startsWith('https://').optional(),
  cancel_url: z.string().url().startsWith('https://').optional(),
});
export type DomainPurchaseInput = z.infer<typeof DomainPurchaseSchema>;

/**
 * Body contract for `POST /api/domains/register`. Previously an unvalidated
 * `as { domain?: string; site_id?: string }` cast — now a real boundary schema
 * that trims + lowercases the domain and shape-validates the site id.
 */
export const DomainRegisterSchema = z.object({
  domain: z.string().trim().toLowerCase().min(1).max(253),
  site_id: siteIdSchema,
});
export type DomainRegisterInput = z.infer<typeof DomainRegisterSchema>;

/** Query input for `GET /api/domains/suggest`. */
export const suggestQuerySchema = z.object({
  site_id: siteIdSchema,
  count: z.coerce.number().int().min(1).max(20).optional(),
  query: z.string().trim().max(63).optional(),
  refresh: z.union([z.literal('true'), z.literal('false')]).optional(),
});
export type SuggestQuery = z.infer<typeof suggestQuerySchema>;

/** Body input for `POST /api/domains/suggest/refine`. */
export const suggestRefineSchema = z.object({
  site_id: siteIdSchema,
  feedback: z.string().trim().max(400).optional(),
  exclude_domains: z.array(z.string().trim().toLowerCase()).max(40).optional(),
  count: z.number().int().min(1).max(20).optional(),
});
export type SuggestRefineInput = z.infer<typeof suggestRefineSchema>;
