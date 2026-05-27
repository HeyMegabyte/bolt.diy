/**
 * Tenant runtime environment bindings.
 *
 * @remarks
 *  Each tenant deploy has its own Worker with its own bindings. The `SITE_DB`
 *  binding is the hardware-level tenant boundary per ADR-0008 — there is no
 *  `tenant_id` column anywhere in this Worker; the binding IS the boundary.
 *
 *  Zod validates the runtime env at request time (cached on first hit so we
 *  don't re-validate per request). Missing optional providers (Resend without
 *  Stripe, for instance) degrade gracefully — only the relevant routes 503.
 *
 * @example
 *   const env = parseEnv(c.env);
 *   const stripe = makeStripeClient(env.STRIPE_SECRET_KEY);
 */
import { z } from 'zod';
import type {
  D1Database,
  R2Bucket,
  KVNamespace,
  Fetcher,
  ExecutionContext,
} from '@cloudflare/workers-types';

/** Tenant identity vars baked at deploy time by the control-plane provisioner. */
export const tenantVarsSchema = z.object({
  TENANT_SLUG: z.string().min(1),
  TENANT_ID: z.string().uuid(),
  TENANT_NAME: z.string().min(1),
  SITE_VERSION: z.string().min(1).default('v1'),
  PRIMARY_HOSTNAME: z.string().min(1),
  DEFAULT_LOCALE: z.string().min(2).default('en'),
  SUPPORTED_LOCALES: z.string().min(2).default('en'),
  /** Cloudflare-Connect connected account id for THIS tenant. */
  STRIPE_CONNECTED_ACCOUNT_ID: z.string().min(1).optional(),
  /** Platform fee in basis points. 150 = 1.5%. Defaults documented in BILLING.md. */
  PLATFORM_FEE_BPS: z
    .string()
    .regex(/^\d+$/)
    .default('150'),
  ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('production'),
  CONTACT_FROM_EMAIL: z.string().email().default('hello@projectsites.dev'),
  /** Site type drives JSON-LD shape. */
  SITE_TYPE: z
    .enum(['software', 'local-business', 'nonprofit', 'portfolio', 'restaurant', 'medical', 'legal', 'retail'])
    .default('software'),
});
export type TenantVars = z.infer<typeof tenantVarsSchema>;

/** Secrets injected via `wrangler secret put`. None throw if missing — graceful 503. */
export const tenantSecretsSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
});
export type TenantSecrets = z.infer<typeof tenantSecretsSchema>;

/**
 * Hono Bindings — what shows up on `c.env`. Branded with `Env` so middleware
 * and routes can type-check without re-importing everywhere.
 */
export interface Env extends TenantVars, TenantSecrets {
  /** Per-tenant D1. Binding-per-deploy = hardware tenant boundary. */
  SITE_DB: D1Database;
  /** R2 bucket read at prefix `sites/{slug}/{version}/`. */
  BUCKET: R2Bucket;
  /** Per-site KV for sitemap + i18n + asset metadata cache. */
  KV: KVNamespace;
  /** Service binding back to control-plane (webhook fan-out, billing reports). */
  CONTROL_PLANE?: Fetcher;
}

/** Hono Variables — what gets set via `c.set('key', value)` in middleware. */
export interface Variables {
  requestId: string;
  locale: string;
  startedAt: number;
}

export type AppContext = { Bindings: Env; Variables: Variables };

/**
 * Validate and cache env on first invocation. Throws a 500 envelope at the
 * boundary if required vars are missing — never inside a hot path.
 */
let cachedEnv: Env | null = null;
export function parseEnv(raw: unknown): Env {
  if (cachedEnv) return cachedEnv;
  const vars = tenantVarsSchema.parse(raw);
  const secrets = tenantSecretsSchema.parse(raw);
  cachedEnv = { ...(raw as Env), ...vars, ...secrets };
  return cachedEnv;
}

/** Reset cache — test-only. */
export function __resetEnvCache(): void {
  cachedEnv = null;
}

export type { ExecutionContext };
