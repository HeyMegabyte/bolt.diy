/**
 * API request/response schemas
 */
import { z } from 'zod';
import {
  uuidSchema,
  emailSchema,
  paginationInputSchema,
  paginationMetaSchema,
  apiResponseSchema,
  errorResponseSchema,
} from './base.js';
import { orgSchema, createOrgInputSchema, updateOrgInputSchema } from './org.js';
import { siteSchema, createSiteInputSchema, updateSiteInputSchema, siteHostnameSchema } from './site.js';
import { subscriptionSchema, entitlementsSchema } from './billing.js';
import { authResponseSchema } from './auth.js';

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {
  paginationInputSchema,
  paginationMetaSchema,
  apiResponseSchema,
  errorResponseSchema,
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

export const healthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  timestamp: z.string().datetime(),
  checks: z.record(z.object({
    status: z.enum(['pass', 'fail']),
    message: z.string().optional(),
    latency_ms: z.number().optional(),
  })).optional(),
});

// ============================================================================
// AUTH API
// ============================================================================

export const authMagicLinkRequestSchema = z.object({
  email: emailSchema,
  redirect_url: z.string().url().optional(),
});

export const authMagicLinkResponseSchema = apiResponseSchema(z.object({
  message: z.string(),
}));

export const authOtpRequestSchema = z.object({
  phone: z.string(),
});

export const authOtpVerifyRequestSchema = z.object({
  phone: z.string(),
  code: z.string().length(6),
});

export const authGoogleInitResponseSchema = apiResponseSchema(z.object({
  auth_url: z.string().url(),
}));

export const authSessionResponseSchema = apiResponseSchema(authResponseSchema);

// ============================================================================
// ORG API
// ============================================================================

export const orgListResponseSchema = apiResponseSchema(z.object({
  orgs: z.array(orgSchema),
  pagination: paginationMetaSchema,
}));

export const orgDetailResponseSchema = apiResponseSchema(z.object({
  org: orgSchema,
  subscription: subscriptionSchema.nullable().optional(),
  entitlements: entitlementsSchema,
}));

export const orgCreateRequestSchema = createOrgInputSchema;
export const orgUpdateRequestSchema = updateOrgInputSchema;

// ============================================================================
// SITE API
// ============================================================================

export const siteListResponseSchema = apiResponseSchema(z.object({
  sites: z.array(siteSchema),
  pagination: paginationMetaSchema,
}));

export const siteDetailResponseSchema = apiResponseSchema(z.object({
  site: siteSchema,
  hostnames: z.array(siteHostnameSchema),
  subscription: subscriptionSchema.nullable().optional(),
  entitlements: entitlementsSchema,
}));

export const siteCreateRequestSchema = createSiteInputSchema;
export const siteUpdateRequestSchema = updateSiteInputSchema;

// ============================================================================
// HOSTNAME API
// ============================================================================

export const hostnameCreateRequestSchema = z.object({
  hostname: z.string().min(1),
});

export const hostnameListResponseSchema = apiResponseSchema(z.object({
  hostnames: z.array(siteHostnameSchema),
}));

// ============================================================================
// BILLING API
// ============================================================================

export const checkoutRequestSchema = z.object({
  site_id: uuidSchema,
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

export const checkoutResponseSchema = apiResponseSchema(z.object({
  checkout_url: z.string().url(),
  session_id: z.string(),
}));

export const billingPortalRequestSchema = z.object({
  return_url: z.string().url(),
});

export const billingPortalResponseSchema = apiResponseSchema(z.object({
  portal_url: z.string().url(),
}));

// ============================================================================
// INTAKE API (public)
// ============================================================================

export const intakeRequestSchema = z.object({
  business_name: z.string().min(2).max(200),
  business_email: emailSchema.optional(),
  business_phone: z.string().optional(),
  business_address: z.string().optional(),
  website_url: z.string().url().optional(),
  turnstile_token: z.string().min(1),
});

export const intakeResponseSchema = apiResponseSchema(z.object({
  site_id: uuidSchema,
  slug: z.string(),
  preview_url: z.string().url(),
  claim_url: z.string().url(),
  estimated_ready_at: z.string().datetime(),
}));

// ============================================================================
// ADMIN API
// ============================================================================

export const adminStatsResponseSchema = apiResponseSchema(z.object({
  total_sites: z.number().int(),
  total_orgs: z.number().int(),
  total_users: z.number().int(),
  active_subscriptions: z.number().int(),
  mrr_cents: z.number().int(),
  sites_today: z.number().int(),
  emails_today: z.number().int(),
  llm_spend_today_cents: z.number().int(),
  lighthouse_queue_size: z.number().int(),
  pending_hostnames: z.number().int(),
}));

export const adminSiteDetailResponseSchema = apiResponseSchema(z.object({
  site: siteSchema,
  org: orgSchema,
  subscription: subscriptionSchema.nullable().optional(),
  hostnames: z.array(siteHostnameSchema),
  confidence_scores: z.record(z.number()),
  recent_events: z.array(z.object({
    type: z.string(),
    timestamp: z.string().datetime(),
    details: z.record(z.unknown()).optional(),
  })),
  lighthouse_history: z.array(z.object({
    score: z.number(),
    timestamp: z.string().datetime(),
  })),
  sentry_issues: z.array(z.object({
    id: z.string(),
    title: z.string(),
    count: z.number().int(),
    last_seen: z.string().datetime(),
  })).optional(),
}));

// ============================================================================
// ERROR CODES
// ============================================================================

export const API_ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // Billing
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  ENTITLEMENT_DENIED: 'ENTITLEMENT_DENIED',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;
export type AuthMagicLinkRequest = z.infer<typeof authMagicLinkRequestSchema>;
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
export type AdminStatsResponse = z.infer<typeof adminStatsResponseSchema>;
