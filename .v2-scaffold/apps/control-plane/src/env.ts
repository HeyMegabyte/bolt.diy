/**
 * Worker env binding shape + Zod validator.
 *
 * Bindings come from Cloudflare. Secrets come from `wrangler secret put`. Vars come from
 * `wrangler.jsonc`. We re-validate via Zod at boot — any miss aborts with a deeplinked
 * creation URL for the missing piece.
 */

import { z } from 'zod';

/** Cloudflare bindings — concrete types intentionally narrow to the surface we use. */
export interface Bindings {
  // D1
  DB: D1Database;

  // KV
  CACHE: KVNamespace;
  SESSION_STORE: KVNamespace;
  KV_HOST_CACHE: KVNamespace;
  KV_FLAGS: KVNamespace;
  KV_PROMPT_OVERRIDES: KVNamespace;

  // R2
  BUCKET: R2Bucket;

  // Workers AI
  AI: Ai;

  // Durable Objects
  LOG_HUB: DurableObjectNamespace;
  JOB_CHAT_HUB: DurableObjectNamespace;
  JOB_TRACKING_HUB: DurableObjectNamespace;
  NOTIFICATION_HUB: DurableObjectNamespace;
  VOICE_ORCHESTRATOR: DurableObjectNamespace;

  // Service bindings
  TENANT_RUNTIME?: Fetcher;
}

/**
 * String-typed env (vars + secrets). Zod-validated at boot.
 */
export const envSchema = z.object({
  ENVIRONMENT: z.enum(['production', 'staging', 'development']),

  // Stripe (live mode mandatory in production)
  STRIPE_SECRET_KEY: z
    .string()
    .min(1, 'Set at https://dashboard.stripe.com/apikeys'),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1, 'Set at https://dashboard.stripe.com/webhooks'),
  STRIPE_CONNECT_CLIENT_ID: z.string().min(1).optional(),

  // OAuth providers (5)
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
  APPLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  APPLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  FACEBOOK_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  FACEBOOK_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),

  // Twilio (voice OTP + SMS)
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),

  // Resend / SendGrid (email)
  RESEND_API_KEY: z
    .string()
    .min(1, 'Set at https://resend.com/api-keys')
    .optional(),
  SENDGRID_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().default('noreply@projectsites.dev'),

  // Cloudflare (Connect API + Turnstile + for-SaaS)
  CLOUDFLARE_API_TOKEN: z
    .string()
    .min(1, 'Set at https://dash.cloudflare.com/profile/api-tokens'),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_ZONE_ID: z.string().min(1),
  TURNSTILE_SECRET_KEY: z
    .string()
    .min(1, 'Set at https://dash.cloudflare.com/?to=/:account/turnstile'),
  TURNSTILE_SITE_KEY: z.string().min(1),

  // Anthropic + OpenAI (routed through AI Gateway)
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // WebAuthn / passkey
  WEBAUTHN_RP_ID: z.string().min(1).default('projectsites.dev'),
  WEBAUTHN_RP_NAME: z.string().min(1).default('ProjectSites'),
  WEBAUTHN_ORIGIN: z.string().url().default('https://app.projectsites.dev'),

  // TOTP
  TOTP_ISSUER: z.string().min(1).default('ProjectSites'),

  // Session-signing secret (HMAC). Generate via `openssl rand -base64 32`.
  SESSION_SECRET: z.string().min(32, 'Generate via `openssl rand -base64 32`'),

  // Google Places + Maps (site-from-search)
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

  // Sentry + PostHog
  SENTRY_DSN: z.string().url().optional(),
  POSTHOG_API_KEY: z.string().min(1).optional(),
  POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),

  // AES-GCM master key for secrets at rest (base64). TIER 1.5 — never rotate.
  MCP_ENCRYPTION_KEY: z.string().min(1, 'Generate via `openssl rand -base64 32`'),

  // Super admin (server-verified; never trust client)
  SUPER_ADMIN_EMAIL: z.string().email(),

  // AI Gateway routing
  AI_GATEWAY_ENABLED: z.enum(['true', 'false']).default('true'),
  AI_GATEWAY_PROJECT: z.string().min(1).default('projectsites'),

  // Cookie domain — usually `.projectsites.dev` so subdomains share session
  COOKIE_DOMAIN: z.string().default('.projectsites.dev'),

  // Take-rate config (basis points, 1 bps = 0.01%)
  PLATFORM_TAKE_RATE_BPS: z
    .string()
    .regex(/^\d+$/)
    .default('1200'), // 12%
  DIRECT_TAKE_RATE_BPS: z
    .string()
    .regex(/^\d+$/)
    .default('150'), // 1.5%
  PROMO_TAKE_RATE_BPS: z
    .string()
    .regex(/^\d+$/)
    .default('800'), // 8%
  PROMO_DAYS: z.string().regex(/^\d+$/).default('30'),

  // App URLs
  APP_BASE_URL: z.string().url().default('https://app.projectsites.dev'),
  API_BASE_URL: z.string().url().default('https://api.projectsites.dev'),
});

export type Env = Bindings & z.infer<typeof envSchema>;

/**
 * Validate string-typed env at boot. Throws a readable error listing every missing var
 * with its creation URL.
 */
export function parseEnv(raw: unknown): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Control-plane refusing to boot. Env validation failed:\n${issues}\n` +
        `Fix via wrangler secret put / wrangler.jsonc vars.`,
    );
  }
  return result.data;
}
