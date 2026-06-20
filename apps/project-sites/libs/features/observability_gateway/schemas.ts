/**
 * @module libs/features/observability_gateway/schemas
 * @description Zod schemas for the Customer-Site Observability Gateway.
 *
 * All runtime boundaries — route param, request body, internal state — are
 * validated here. Types are inferred; never duplicated in service or handler files.
 *
 * @see {@link ./service.ts} for pure helpers (redact/sample/quota)
 * @see {@link ./handlers.ts} for Hono route wiring
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Supported providers
// ---------------------------------------------------------------------------

export const MonitoringProviderSchema = z
  .enum(['sentry', 'posthog'])
  .describe('Observability vendor to proxy events to');

export type MonitoringProvider = z.infer<typeof MonitoringProviderSchema>;

// ---------------------------------------------------------------------------
// Route param
// ---------------------------------------------------------------------------

export const MonitoringParamSchema = z
  .object({ provider: MonitoringProviderSchema })
  .strict();

export type MonitoringParam = z.infer<typeof MonitoringParamSchema>;

// ---------------------------------------------------------------------------
// Request identification — one of hostname or site_id must be provided
// ---------------------------------------------------------------------------

export const MonitoringRequestHeadersSchema = z.object({
  /** The hostname of the customer site submitting events (e.g. mybiz.projectsites.dev). */
  'x-site-host': z.string().min(1).optional(),
  /** Explicit site UUID (alternative to x-site-host). */
  'x-site-id': z.string().uuid().optional(),
});

export type MonitoringRequestHeaders = z.infer<typeof MonitoringRequestHeadersSchema>;

// ---------------------------------------------------------------------------
// Event payload envelope — accept any JSON object/array (vendor-agnostic)
// ---------------------------------------------------------------------------

/** Any JSON value — we accept the full vendor payload and strip PII fields. */
export const AnyJsonSchema: z.ZodType<unknown> = z.union([
  z.record(z.unknown()),
  z.array(z.unknown()),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const MonitoringBodySchema = z
  .object({
    /**
     * Optional stable event id used for deterministic sampling.
     * For Sentry events this is `event_id`; for PostHog it is `$uuid` / `uuid`.
     * When absent the gateway generates one and sampling falls back to a random dice-roll.
     */
    event_id: z.string().optional(),
    /** Sentry: event_id alias */
    $uuid: z.string().optional(),
    /** PostHog: canonical uuid field */
    uuid: z.string().optional(),
  })
  .passthrough(); // accept all vendor fields — PII is stripped in service layer

export type MonitoringBody = z.infer<typeof MonitoringBodySchema>;

// ---------------------------------------------------------------------------
// Gateway result — internal, not returned verbatim to client
// ---------------------------------------------------------------------------

export const GatewayResultSchema = z
  .object({
    action: z.enum(['forwarded', 'sampled_out', 'quota_exceeded', 'flag_off', 'site_unknown']),
    siteId: z.string().optional(),
    orgId: z.string().optional(),
    provider: MonitoringProviderSchema.optional(),
    vendorStatus: z.number().optional(),
  })
  .strict();

export type GatewayResult = z.infer<typeof GatewayResultSchema>;

// ---------------------------------------------------------------------------
// Quota state (KV-stored as JSON)
// ---------------------------------------------------------------------------

export const QuotaStateSchema = z
  .object({ count: z.number().int().nonnegative() })
  .strict();

export type QuotaState = z.infer<typeof QuotaStateSchema>;
