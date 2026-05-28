/**
 * @module env
 * @description Cloudflare Worker environment bindings and Hono context variables.
 *
 * This module defines every secret, binding, and request-scoped variable used
 * by the Project Sites worker. Bindings are configured in `wrangler.toml`;
 * secrets are set via `wrangler secret put`.
 *
 * ## Binding Categories
 *
 * | Category    | Bindings                                  |
 * | ----------- | ----------------------------------------- |
 * | Storage     | `DB` (D1), `SITES_BUCKET` (R2)            |
 * | Cache       | `CACHE_KV`, `PROMPT_STORE` (KV)           |
 * | Compute     | `AI` (Workers AI), `QUEUE` (optional)     |
 * | Auth        | Google OAuth, Stripe, SendGrid            |
 * | Observ.     | PostHog, Sentry                           |
 * | Infra       | Cloudflare API (CF_API_TOKEN, CF_ZONE_ID) |
 *
 * @packageDocumentation
 */

/**
 * Cloudflare Worker environment bindings.
 *
 * All secrets and platform bindings injected by the Workers runtime.
 * Required bindings will cause a deploy-time error if missing;
 * optional ones (marked with `?`) degrade gracefully.
 *
 * @example
 * ```ts
 * // In a Hono route handler:
 * app.get('/api/example', async (c) => {
 *   const db = c.env.DB;        // D1Database
 *   const kv = c.env.CACHE_KV;  // KVNamespace
 *   const ai = c.env.AI;        // Ai
 * });
 * ```
 */
export interface Env {
  // ── KV Namespaces ──────────────────────────────────────────
  /** General-purpose cache (host→site resolution, etc.). TTL: 60 s. */
  CACHE_KV: KVNamespace;
  /** Prompt definition hot-fix store (overrides file-based prompts). */
  PROMPT_STORE: KVNamespace;

  // ── D1 Database ────────────────────────────────────────────
  /** Primary relational store (SQLite via Cloudflare D1). */
  DB: D1Database;

  // ── R2 Object Storage ─────────────────────────────────────
  /** Static site output bucket (`sites/{slug}/{version}/`, `marketing/`). */
  SITES_BUCKET: R2Bucket;

  // ── Queue (optional) ──────────────────────────────────────
  /** Background job queue. Optional until Queues is enabled on the account. */
  QUEUE?: Queue;

  // ── Workflow ─────────────────────────────────────────────
  /** Cloudflare Workflow binding for AI site generation. */
  SITE_WORKFLOW: Workflow;
  /**
   * Workflows v2 binding for resumable Google Drive ingest. See
   * {@link workflows/drive-sync.DriveSyncWorkflow}. Optional — when missing,
   * callers fall back to the legacy `syncDriveFolder` inline path.
   */
  DRIVE_SYNC_WORKFLOW?: Workflow;
  /**
   * Workflows v2 binding for resumable AI image generation with provider
   * fallback (DALL-E 3 → Stability AI). See
   * {@link workflows/image-generation.ImageGenerationWorkflow}. Optional.
   */
  IMAGE_GENERATION_WORKFLOW?: Workflow;
  /**
   * Workflows v2 binding for snapshot quality capture (screenshot +
   * Lighthouse + composition + a11y). See
   * {@link workflows/snapshot-quality.SnapshotQualityWorkflow}. Optional —
   * when missing, capture endpoints return 503.
   */
  SNAPSHOT_QUALITY_WORKFLOW?: Workflow;
  /**
   * Pulse Social publish workflow binding. Fans out per-account publishes
   * for one pulse_posts row. See {@link workflows/social-publish.SocialPublishWorkflow}.
   * Fired by the every-minute due-post sweep cron.
   */
  SOCIAL_PUBLISH_WORKFLOW?: Workflow;

  // ── Pulse Social — per-platform OAuth app credentials (optional) ────
  /** Twitter / X — OAuth 2.0 app creds. https://developer.x.com/en/portal/dashboard */
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  /** LinkedIn — OAuth 2.0 app creds. https://www.linkedin.com/developers/apps */
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  /** Facebook / Instagram / Threads — shared Meta app creds. https://developers.facebook.com/apps/ */
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  THREADS_APP_ID?: string;
  /** Reddit — OAuth installed-app creds. https://www.reddit.com/prefs/apps */
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  /** Discord — bot token (shared across orgs). https://discord.com/developers/applications */
  DISCORD_BOT_TOKEN?: string;
  /** Slack — OAuth v2 app creds. https://api.slack.com/apps */
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  /** Telegram — bot token from BotFather. */
  TELEGRAM_BOT_TOKEN?: string;

  /**
   * Cloudflare Browser Rendering binding (workers-bindings flavour). The
   * snapshot-quality workflow falls back to the REST API when the binding
   * is absent, so this is purely optional.
   */
  BROWSER?: unknown;

  /** Claude Code build container (Durable Object). */
  SITE_BUILDER?: DurableObjectNamespace;
  /** SQLite-backed Durable Object — global trace ring buffer. */
  TRACE_HUB?: DurableObjectNamespace;
  /** SQLite-backed Durable Object — global activity feed. */
  ACTIVITY_HUB?: DurableObjectNamespace;

  // ── Workers AI ────────────────────────────────────────────
  /** Cloudflare Workers AI binding for LLM inference. */
  AI: Ai;

  // ── Environment ───────────────────────────────────────────
  /** Current deployment environment (`"staging"` | `"production"`). */
  ENVIRONMENT: string;

  // ── Google Analytics & Tag Manager ────────────────────────
  /** GA4 Measurement ID (e.g., G-XXXXXXXX) injected into every served site. */
  GA4_MEASUREMENT_ID?: string;
  /** GTM Container ID (e.g., GTM-XXXXXXX) injected into every served site. */
  GTM_CONTAINER_ID?: string;
  /** Google Analytics Data API credentials (service account JSON, base64-encoded). */
  GA4_SERVICE_ACCOUNT_JSON?: string;
  /** GA4 Property ID for Data API queries (numeric, e.g., 123456789). */
  GA4_PROPERTY_ID?: string;

  // ── PostHog (Analytics) ───────────────────────────────────
  /** PostHog API key for server-side event capture (personal phx_* or project phc_*). */
  POSTHOG_API_KEY: string;
  /** PostHog public project key (phc_*) injected into served-site HTML. Required for client-side init. */
  POSTHOG_PUBLIC_KEY?: string;
  /** PostHog API host (defaults to `https://app.posthog.com`). */
  POSTHOG_HOST?: string;

  // ── Stripe (Payments) ─────────────────────────────────────
  /** Stripe secret key for server-side API calls. */
  STRIPE_SECRET_KEY: string;
  /** Stripe publishable key (passed to frontend checkout). */
  STRIPE_PUBLISHABLE_KEY: string;
  /** Stripe webhook endpoint signing secret for signature verification. */
  STRIPE_WEBHOOK_SECRET: string;

  // ── Domain & Conversion ────────────────────────────────────
  /** WhoisXML API key for domain availability checking. */
  WHOISXML_API_KEY?: string;
  /** GoDaddy API key for domain registration. */
  GODADDY_API_KEY?: string;
  /** GoDaddy API secret for domain registration. */
  GODADDY_API_SECRET?: string;

  // ── LLM Fallbacks (optional) ──────────────────────────────
  /** OpenAI API key for research pipeline and fallback LLM calls. */
  OPENAI_API_KEY?: string;
  /** Anthropic API key for Claude models in headless generation pipeline. */
  ANTHROPIC_API_KEY?: string;
  /** Model ID for the research/prompt-formulation pipeline (default: o3-mini). */
  RESEARCH_MODEL?: string;
  /** OpenRouter API key for model routing. */
  OPEN_ROUTER_API_KEY?: string;
  /** Groq API key for fast inference fallback. */
  GROQ_API_KEY?: string;

  // ── Headless Pipeline Config ────────────────────────────────
  /** A/B model split ratio (0-1). 0.5 = 50% OpenAI, 50% Anthropic. Default: 0.5. */
  AB_MODEL_SPLIT?: string;
  /** Template cache TTL in seconds. Default: 604800 (7 days). */
  TEMPLATE_CACHE_TTL?: string;

  // ── Image Generation & Discovery ──────────────────────────
  /** Google Custom Search API key for image discovery. */
  GOOGLE_CSE_KEY?: string;
  /** Google Custom Search Engine ID for image discovery. */
  GOOGLE_CSE_CX?: string;
  /** Maximum number of AI-generated images per site (default: 5). */
  MAX_GENERATED_IMAGES?: string;

  // ── Media Discovery & Generation APIs ───────────────────────
  /** YouTube Data API v3 key for video search/discovery. */
  YOUTUBE_API_KEY?: string;
  /** Pexels API key for royalty-free stock photos + video. */
  PEXELS_API_KEY?: string;
  /** Pixabay API key for royalty-free images + video + illustrations. */
  PIXABAY_API_KEY?: string;
  /** Unsplash API access key for high-quality royalty-free photos. */
  UNSPLASH_ACCESS_KEY?: string;
  /** Ideogram API key for AI image/logo generation. */
  IDEOGRAM_API_KEY?: string;
  /** Replicate API token for Stable Diffusion, image upscaling, bg removal. */
  REPLICATE_API_TOKEN?: string;
  /** Runway API key for AI video generation (Gen-2/Gen-3). */
  RUNWAY_API_KEY?: string;

  // ── Business Data APIs ────────────────────────────────────
  /** Foursquare API key for venue photos, tips, and categories. */
  FOURSQUARE_API_KEY?: string;
  /** Yelp Fusion API key for reviews, ratings, and photos. */
  YELP_API_KEY?: string;
  /** Google Maps embed API key. */
  GOOGLE_MAPS_API_KEY?: string;

  // ── Image Optimization & Maps ─────────────────────────────
  /** Cloudinary cloud name for image transformation CDN. */
  CLOUDINARY_CLOUD_NAME?: string;
  /** Cloudinary API key for upload/transform. */
  CLOUDINARY_API_KEY?: string;
  /** Cloudinary API secret for signed requests. */
  CLOUDINARY_API_SECRET?: string;
  /** Mapbox access token for custom styled interactive maps. */
  MAPBOX_ACCESS_TOKEN?: string;

  // ── Brand Discovery APIs ──────────────────────────────────
  /** Logo.dev API token for high-res company logos by domain. */
  LOGODEV_TOKEN?: string;
  /** Brandfetch API key for full brand kits (logo, colors, fonts) by domain. */
  BRANDFETCH_API_KEY?: string;

  // ── Reviews & Trust APIs ──────────────────────────────────
  /** TripAdvisor Content API key for hospitality reviews/ratings. */
  TRIPADVISOR_API_KEY?: string;
  /** Trustpilot API key for business trust scores and reviews. */
  TRUSTPILOT_API_KEY?: string;

  // ── Generative AI APIs ────────────────────────────────────
  /** ElevenLabs API key for AI voiceover generation. */
  ELEVENLABS_API_KEY?: string;
  /** Stability AI API key for Stable Diffusion image generation. */
  STABILITY_API_KEY?: string;
  /** Remove.bg API key for background removal from product/logo images. */
  REMOVEBG_API_KEY?: string;

  // ── Animation & UX ────────────────────────────────────────
  /** LottieFiles API key for animated illustrations per business category. */
  LOTTIEFILES_API_KEY?: string;

  // ── SEO & Quality Gates ───────────────────────────────────
  /** Google PageSpeed Insights API key (can reuse GOOGLE_MAPS_API_KEY). */
  PAGESPEED_API_KEY?: string;
  /** GTmetrix API key for real performance scoring. */
  GTMETRIX_API_KEY?: string;

  // ── Contact & Location ────────────────────────────────────
  /** Hunter.io API key for discovering business email patterns. */
  HUNTER_API_KEY?: string;
  /** What3Words API key for precise location addressing. */
  WHAT3WORDS_API_KEY?: string;
  /** Abstract API key for geolocation (timezone, currency). */
  ABSTRACT_GEO_API_KEY?: string;

  // ── Analytics Embeds ──────────────────────────────────────
  /** Microsoft Clarity project ID for free heatmaps/session recordings. */
  CLARITY_PROJECT_ID?: string;
  /** Plausible Analytics domain for privacy-friendly analytics. */
  PLAUSIBLE_DOMAIN?: string;

  // ── Cloudflare API ────────────────────────────────────────
  /** Cloudflare API token for Custom Hostnames (Cloudflare for SaaS). */
  CF_API_TOKEN: string;
  /** Cloudflare zone ID for `projectsites.dev`. */
  CF_ZONE_ID: string;
  /**
   * Cloudflare global API key (legacy `X-Auth-Key`). Required when
   * `CF_API_TOKEN` lacks Account → Analytics: Read AND Zone → Analytics:
   * Read on every zone this account touches. Pair with `CLOUDFLARE_EMAIL`.
   * Used by `services/multi_url_analytics.ts` + `services/cf_credentials.ts`.
   */
  CLOUDFLARE_API_KEY?: string;
  /** Cloudflare account owner email — paired with `CLOUDFLARE_API_KEY`. */
  CLOUDFLARE_EMAIL?: string;
  /** Cloudflare Access Service Token client ID (bypasses bot protection for container builds). */
  CF_ACCESS_CLIENT_ID?: string;
  /** Cloudflare Access Service Token client secret. */
  CF_ACCESS_CLIENT_SECRET?: string;
  /** HMAC secret for container→worker build status callbacks. */
  INTERNAL_BUILD_SECRET?: string;
  /** Override callback URL (workers.dev) to bypass zone CF managed challenge. */
  INTERNAL_CALLBACK_URL?: string;

  // ── Email (Resend / SendGrid) ────────────────────────────
  /** Resend API key for transactional email. Preferred provider. */
  RESEND_API_KEY?: string;
  /** SendGrid v3 API key for transactional email. Fallback provider. */
  SENDGRID_API_KEY?: string;

  // ── Chatwoot (Support Chat) ───────────────────────────────
  /** Chatwoot instance API URL. */
  CHATWOOT_API_URL?: string;
  /** Chatwoot API key. */
  CHATWOOT_API_KEY?: string;

  // ── Novu (Notifications) ──────────────────────────────────
  /** Novu API key for multi-channel notifications. */
  NOVU_API_KEY?: string;

  // ── GitHub (OAuth) ─────────────────────────────────────────
  /** GitHub OAuth App client ID. */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth App client secret. */
  GITHUB_CLIENT_SECRET?: string;

  // ── Google (OAuth + Places + Sheets) ──────────────────────
  /** Google OAuth 2.0 client ID. */
  GOOGLE_CLIENT_ID: string;
  /** Google OAuth 2.0 client secret. */
  GOOGLE_CLIENT_SECRET: string;
  /** Google Places (new) API key for business search. */
  GOOGLE_PLACES_API_KEY: string;
  /** Google Sheets API key for spreadsheet data sources. Falls back to GOOGLE_PLACES_API_KEY. */
  GOOGLE_SHEETS_API_KEY?: string;

  // ── Sentry (Error Tracking) ───────────────────────────────
  /** Sentry DSN for error reporting. */
  SENTRY_DSN?: string;
  /**
   * Per-deploy release identifier (typically the short git SHA). Set in
   * `wrangler.toml [env.production.vars]` at deploy time. Used by Toucan to
   * group events + correlate uploaded sourcemaps (item #48).
   */
  SENTRY_RELEASE?: string;

  // ── Domain Registration (CF Registrar via global-key auth + RDAP) ──
  // Availability: RDAP (free, IETF-standard, no key — see services/rdap_availability.ts).
  // Pricing:      CF Registrar public TLD endpoint (no auth — see services/cf_registrar.ts).
  // Register:     POST /accounts/:account_id/registrar/domains/:domain authed by the
  //               existing CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL above. No
  //               separate registrar-scoped token needed.
  /** OpenSRS reseller username for domain registration. */
  OPENSRS_USERNAME?: string;
  /** OpenSRS private API key for domain registration. */
  OPENSRS_API_KEY?: string;
  /** OpenSRS API environment: 'live' or 'test'. Defaults to 'test'. */
  OPENSRS_ENV?: string;

  // ── Sale Webhook ──────────────────────────────────────────
  /** External webhook URL called on successful subscription purchase. */
  SALE_WEBHOOK_URL?: string;
  /** HMAC secret for signing sale webhook payloads. */
  SALE_WEBHOOK_SECRET?: string;

  // ── Metering ──────────────────────────────────────────────
  /** Metering provider identifier (e.g. `"lago"`, `"stripe"`). */
  METERING_PROVIDER?: string;
  /**
   * Stripe Price IDs for usage-based metering (one per metric).
   * JSON object: `{"ai_calls":"price_xxx","bytes_egress":"price_yyy","image_generations":"price_zzz"}`.
   * When unset the usage middleware records to D1 only and skips Stripe usage records.
   */
  STRIPE_USAGE_PRICE_IDS?: string;
  /** HMAC secret used to sign one-click weekly-digest unsubscribe tokens. */
  WEEKLY_DIGEST_SECRET?: string;

  // ── Feature Flags ──────────────────────────────────────────
  /** When "true", research.json is publicly accessible at /api/sites/by-slug/:slug/research.json */
  RESEARCH_JSON_PUBLIC?: string;

  // ── AI Platform (added by migration 0013) ─────────────────
  /** AES-GCM key (base64, 32 bytes) used to encrypt MCP OAuth tokens at rest. */
  MCP_ENCRYPTION_KEY?: string;
  /** MailChimp OAuth app client ID + secret (single tenant; per-site tokens). */
  MAILCHIMP_CLIENT_ID?: string;
  MAILCHIMP_CLIENT_SECRET?: string;
  /** Canonical OAuth-prefix aliases for Mailchimp (new naming convention). Legacy bare keys above kept as fallbacks. */
  MAILCHIMP_OAUTH_CLIENT_ID?: string;
  MAILCHIMP_OAUTH_CLIENT_SECRET?: string;
  /** HubSpot OAuth app credentials. Legacy keys; new code reads `HUBSPOT_OAUTH_CLIENT_ID` first. */
  HUBSPOT_CLIENT_ID?: string;
  HUBSPOT_CLIENT_SECRET?: string;
  HUBSPOT_OAUTH_CLIENT_ID?: string;
  HUBSPOT_OAUTH_CLIENT_SECRET?: string;
  HUBSPOT_APP_ID?: string;
  HUBSPOT_PORTAL_ID?: string;
  /** Stripe Connect client ID (separate from STRIPE_SECRET_KEY which is our own account). */
  STRIPE_CONNECT_CLIENT_ID?: string;
  STRIPE_CONNECT_CLIENT_ID_TEST?: string;
  STRIPE_OAUTH_CLIENT_ID?: string;
  STRIPE_ACCOUNT_ID?: string;
  /** Calendly OAuth app credentials (auth.calendly.com). */
  CALENDLY_OAUTH_CLIENT_ID?: string;
  CALENDLY_OAUTH_CLIENT_SECRET?: string;
  CALENDLY_WEBHOOK_SIGNING_KEY?: string;
  /** Airtable OAuth integration credentials (airtable.com/oauth2/v1). */
  AIRTABLE_OAUTH_CLIENT_ID?: string;
  AIRTABLE_OAUTH_CLIENT_SECRET?: string;
  AIRTABLE_INTEGRATION_ID?: string;
  /** PagerDuty OAuth 2.0 app credentials (identity.pagerduty.com). */
  PAGERDUTY_OAUTH_CLIENT_ID?: string;
  PAGERDUTY_OAUTH_CLIENT_SECRET?: string;
  PAGERDUTY_ACCOUNT_SUBDOMAIN?: string;
  /** Stripe Price IDs for AI credit topups (one-time purchases). */
  STRIPE_PRICE_CREDITS_100?: string;
  STRIPE_PRICE_CREDITS_500?: string;
  STRIPE_PRICE_CREDITS_2000?: string;
  /**
   * Stripe Price ID for the $50/mo wallet subscription used by
   * `services/wallet.ts`. Create at https://dashboard.stripe.com/products
   * (Product: "Project Sites Wallet", recurring monthly $50.00 USD).
   */
  STRIPE_PRICE_ID_MONTHLY_WALLET?: string;

  // ── Workers for Platforms (user-defined endpoints) ────────
  /** Dispatch namespace binding (set in wrangler.toml [[dispatch_namespaces]]). */
  USER_DISPATCH?: DispatchNamespace;
  /** WFP namespace name used for management API calls (uploads, deletes). */
  WFP_NAMESPACE_NAME?: string;
  /** Cloudflare account ID for WFP REST API. */
  CF_ACCOUNT_ID?: string;
  /** Note: CF_API_TOKEN is already declared above for the existing Cloudflare API surface; we reuse it for WFP REST calls. */

  /**
   * When set to the string `"true"`, routes external LLM calls (OpenAI, Anthropic)
   * through Cloudflare AI Gateway (`https://gateway.ai.cloudflare.com/v1/{CF_ACCOUNT_ID}/projectsites/{provider}`)
   * for logging, caching, rate-limit, and fallback. Requires `CF_ACCOUNT_ID` also set.
   * On gateway 5xx, the client falls back to the direct vendor URL once per request.
   */
  AI_GATEWAY_ENABLED?: string;

  /** Workers Analytics Engine binding — admin dashboard visit tracker. */
  ANALYTICS?: AnalyticsEngineDataset;

  // ── Apps tab (CFC app store) ──────────────────────────────
  /** Neon REST API key for per-app Postgres project provisioning. */
  NEON_API_KEY?: string;
  /** Upstash account email — paired with `UPSTASH_API_KEY` for Redis provisioning. */
  UPSTASH_EMAIL?: string;
  /** Upstash REST API key for per-app Redis database provisioning. */
  UPSTASH_API_KEY?: string;
  /**
   * AppRuntime container Durable Object. Stubbed in the dispatcher until
   * the sibling agent ships the DO class — the route layer degrades to
   * a `503` until the binding is wired in `wrangler.toml`.
   */
  APP_RUNTIME?: DurableObjectNamespace;

  // ── Per-image AppRuntime subclasses (top-10 catalog apps) ──────────
  // Each binds a dedicated `[[containers]]` block in wrangler.toml to the
  // upstream image of that catalog entry. All optional initially so local
  // dev + preview deploys don't break before the migration tag is applied.
  // See `src/durable_objects/app_runtime_subclasses.ts` for the slug map.
  /** Umami — `ghcr.io/umami-software/umami:postgresql-latest` */
  APP_RUNTIME_UMAMI?: DurableObjectNamespace;
  /** Outline — `outlinewiki/outline:latest` */
  APP_RUNTIME_OUTLINE?: DurableObjectNamespace;
  /** n8n — `n8nio/n8n:latest` */
  APP_RUNTIME_N8N?: DurableObjectNamespace;
  /** Vaultwarden — `vaultwarden/server:latest` */
  APP_RUNTIME_VAULTWARDEN?: DurableObjectNamespace;
  /** Uptime Kuma — `louislam/uptime-kuma:1` */
  APP_RUNTIME_UPTIME_KUMA?: DurableObjectNamespace;
  /** NocoDB — `nocodb/nocodb:latest` */
  APP_RUNTIME_NOCODB?: DurableObjectNamespace;
  /** Listmonk — `listmonk/listmonk:latest` */
  APP_RUNTIME_LISTMONK?: DurableObjectNamespace;
  /** Memos — `neosmemo/memos:stable` */
  APP_RUNTIME_MEMOS?: DurableObjectNamespace;
  /** PocketBase — `spectado/pocketbase:latest` */
  APP_RUNTIME_POCKETBASE?: DurableObjectNamespace;
  /** Open WebUI — `ghcr.io/open-webui/open-webui:main` */
  APP_RUNTIME_OPEN_WEBUI?: DurableObjectNamespace;

  // ── Twilio (Voice + SMS Agent) ─────────────────────────────
  /** Twilio Account SID (AC…). Required for every Voice/SMS call. */
  TWILIO_ACCOUNT_SID?: string;
  /** Twilio Auth Token — signs every outbound REST call AND verifies inbound webhooks. */
  TWILIO_AUTH_TOKEN?: string;
  /** Twilio API Key SID (SK…) — for short-lived Access Tokens (Client/Voice). */
  TWILIO_API_KEY?: string;
  /** Twilio API Key Secret — paired with `TWILIO_API_KEY` for JWT signing. */
  TWILIO_API_SECRET?: string;
  /** TwiML App SID (AP…) — required by Voice Access Tokens for outgoing calls. */
  TWILIO_TWIML_APP_SID?: string;
  /** Deepgram API key for low-latency real-time STT (falls back to Workers AI Whisper). */
  DEEPGRAM_API_KEY?: string;
  // NOTE: ELEVENLABS_API_KEY is already declared above for image/voiceover generation —
  // the Voice Agent reuses the same secret for ElevenLabs TTS.

  /**
   * Per-call Browse Agent Container Durable Object. Built by a sibling agent.
   * Optional until the DO class + container image are wired in `wrangler.toml`.
   * When absent, `triggerBrowseAgent()` returns `{ ok:false, reason:'binding_missing' }`
   * and the voice agent degrades to plain LLM-only replies.
   */
  VOICE_BROWSE_AGENT?: DurableObjectNamespace;
}

/** Cloudflare Workers for Platforms dispatch namespace runtime shape. */
interface DispatchNamespace {
  get(
    name: string,
    args?: Record<string, unknown>,
  ): { fetch(request: Request | string, init?: RequestInit): Promise<Response> };
}

/** Cloudflare Workers Analytics Engine binding runtime shape. */
interface AnalyticsEngineDataset {
  writeDataPoint(data: { blobs?: (string | null)[]; doubles?: number[]; indexes?: string[] }): void;
}

/**
 * Hono context variables set by middleware and consumed by route handlers.
 *
 * These are request-scoped values attached via `c.set()` / `c.get()`.
 *
 * @example
 * ```ts
 * // In middleware:
 * c.set('requestId', crypto.randomUUID());
 *
 * // In route handler:
 * const rid = c.get('requestId');
 * ```
 */
export interface Variables {
  /** Unique request ID for distributed tracing (`X-Request-ID` header). */
  requestId: string;
  /** Authenticated user ID (set after session validation). */
  userId?: string;
  /** Organization ID the user belongs to. */
  orgId?: string;
  /** User's role within the org (`owner` | `admin` | `member` | `viewer`). */
  userRole?: string;
  /** Whether the user is a billing admin for their org. */
  billingAdmin?: boolean;
}
