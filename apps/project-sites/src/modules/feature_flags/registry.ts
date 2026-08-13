/**
 * Feature-flag registry — single source of truth for every flag key the worker
 * recognises. Each entry is the **default** state when no override exists in
 * `flag_overrides` D1. Per [[feature-flags]] every new feature ships at
 * `enabled=false, rollout_percent=0, stage='experimental'`.
 *
 * Promotion path: experimental → beta (5-25%) → stable (100%). Admin UI at
 * `/admin/feature-flags` flips state per the migration's `flag_overrides`
 * table; the registry below is the floor.
 */

export type FlagStage = 'experimental' | 'beta' | 'stable' | 'deprecated' | 'killswitch';

export interface FlagDefinition {
  key: string;
  description: string;
  default_enabled: boolean;
  default_rollout_percent: number;
  stage: FlagStage;
  owner_email: string;
}

/**
 * Every endpoint added in the 50-feature rollout has one flag here. Naming:
 * lowercase snake_case ≤32 chars. Sub-toggles handled via overrides, never
 * new keys.
 */
export const FLAG_REGISTRY: Record<string, FlagDefinition> = {
  // ── Sentinel keys for always-on core surfaces.  isFlagOn always returns true for these.
  //    One key per core surface so duplicate-flagKey check passes in the manifest validator.
  core_auth: {
    key: 'core_auth',
    description:
      'Always-on sentinel: auth surface (magic-link + Google OAuth + sessions). isFlagOn always true.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  core_admin_detail: {
    key: 'core_admin_detail',
    description: 'Always-on sentinel: admin site-detail split-view panel. isFlagOn always true.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  core_site_create: {
    key: 'core_site_create',
    description: 'Always-on sentinel: homepage site-creation funnel. isFlagOn always true.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  turnstile_build_gate: {
    key: 'turnstile_build_gate',
    description:
      'Dark-launch bot-gate on create-from-search: when ON, a valid Cloudflare Turnstile token is required before kicking a paid build. OFF (default) means no verification.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  core_feature_flags: {
    key: 'core_feature_flags',
    description: 'Always-on sentinel: feature-flags admin UI. isFlagOn always true.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  core_billing: {
    key: 'core_billing',
    description:
      'Always-on sentinel: Stripe billing surface (checkout + subscriptions + entitlements + portal + donation payouts). isFlagOn always true.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  // ── Alias sentinel keys — thin manifest dirs that alias an already-canonical manifest.
  //    Created so that e2e/_fortress/<slug>/ directories have a matching libs/features/<slug>/
  //    and the drift validator's TEST_NOT_LINKED check resolves.
  // Compete-or-die (items 1-8)
  token_burn_meter: {
    key: 'token_burn_meter',
    description: 'Live token-burn meter in editor with monthly projection',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  // Multi-tenant + agency (items 9-13)
  // CWV (items 14-19, 15 already shipped)
  // GEO (items 20-24, 20-22 already stable)
  // Accessibility (items 25-29, 29 stable)
  // Editor UX (items 30-34)
  // Monetization (items 35-38)
  // Observability (items 39-42)
  // Media gen (items 43-46)
  // Platform extension (items 47-50, 47 + 48-slice + 49-slice already stable)
  // Gap surface (re-folded back from the trim pass)
  pwa_manifest_full: {
    key: 'pwa_manifest_full',
    description: 'PWA manifest with screenshots + shortcuts + share_target',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/pwa.spec.ts (5/5 live),
    owner_email: 'brian@megabyte.space',
  },
  // ── 10 brilliant — site-as-MCP, cold-tier, AI-auto-router, ghost-routes, speed-compare, auto-gen-files, hallucination-guard, visitor-recognition, faq-from-tickets, competitor-monitor
  ai_auto_router: {
    key: 'ai_auto_router',
    description:
      'Workload-aware AI model auto-router — simple=Workers AI free, complex=Opus, creative=Sonnet',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  // ── Round-2 top-5 admin upgrades
  // ── 30 big-bet features
  // ── IDE + multi-agent + progressive build (3 new flags)
  // ── Content Freshness + pSEO (items #16 + #17) — flag registry restoration after content-pseo agent shipped the impl without registering the flag (caught by validate-feature-manifests 2026-05-28)
  // ── IDEAS-50 wave 3: GEO + reputation + growth (3 + 9 + 10/11/13 + 18 + 32 + 34)
  // ── #29 pSEO v2 (post-March-2026), #30 Integration Directory, #31 Comparison Pages, #32 Vertical Templates, #35 Public Changelog
  pseo_matrix_v2: {
    key: 'pseo_matrix_v2',
    description:
      'pSEO v2: user-tasks (not keywords) + >=40% unique data floor per page from live Google Places, real reviews, real pricing. Cap 200 per axis. Covers comparison/alternative + integration-directory page sets.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/pseo/pseo-matrix.spec.ts (green live),
    owner_email: 'brian@megabyte.space',
  },
  // ── Domain & Logs (items #10 + #14)
  // ── #24 Unified Visitor Inbox + #25 Multimodal Site Copilot
  // ── #5+#6+#7+#8 Swarm editor + live stream + Site DNA + section marketplace
  // ── Native editor enforcement (rec #3 from 2026-05-28 close-the-loop) — was localStorage-only; now real server-side flag so killswitch works without redeploy
  // ── AI wave (ideas #1/#23/#24, 2026-05-28)
  email_deliverability_wizard: {
    key: 'email_deliverability_wizard',
    description:
      'Email Deliverability Wizard (#12): checks a sending domain SPF, DKIM and DMARC via DNS-over-HTTPS and returns a 0-100 score plus concrete DNS fixes. Read-only, persists nothing.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/admin/deliverability.spec.ts (green live),
    owner_email: 'brian@megabyte.space',
  },
  outbound_webhooks: {
    key: 'outbound_webhooks',
    description:
      'Outbound Webhooks (#10): customers subscribe their own https endpoints to site events; deliveries are signed (HMAC, replay-safe) + retried with backoff. Endpoint secret AES-GCM encrypted at rest. CRUD at /api/sites/:siteId/webhooks.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/webhook/webhooks.spec.ts (7/7 live),
    owner_email: 'brian@megabyte.space',
  },
  // ── Marketplace + Creator Economy (ideas #39/#40/#41/#42 — 2026-05-28)
  // ── Viral + Billing + Audit-Chain (ideas #33, #34, #36, #46 — 2026-05-28)
  // ── Enterprise wave (Trust Center / Enterprise Plan / Stripe App status / Agent SDK+MCP, 2026-05-28)
  // ── Compliance / safety / revenue (added 2026-06-07 per UNFINISHED_FEATURES §9b)
  // ── Idea-merge wave 2026-06-08: genuinely-new platform flags (the rest of the
  //    30 ideas fold into existing flag scopes as extra checklist checkpoints).
  editor_vision_qa: {
    key: 'editor_vision_qa',
    description:
      'In-editor live AI vision critique: Browser-Rendering screenshot → vision model scores layout/contrast/brand 0-10 with inline fixes (distinct from the post-build snapshot QA).',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },

  // ── 40-list build wave (Brian-selected, 2026-06-17) — see apps/project-sites/TODO.md ──
  // Commerce & money rail (payments_rail is foundational — unblocks the rest)
  upgrade_moments: {
    key: 'upgrade_moments',
    description:
      'Contextual friction-point upgrade prompts: maps free-plan friction (custom domain, branding removal, page cap, AI credits, build priority, analytics depth) to honest, value-led, trigger-attributed upsells. Paid plans never nagged; dismissals persist in KV. The generous-free + paid-power-ups monetization seam.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },

  // Visitor-facing AI + platform AI UX

  ab_testing: {
    key: 'ab_testing',
    description:
      "Deterministic variant assignment via hashed visitor ID + statistical significance calculator with z-test. Its route checks isFlagOn('ab_testing'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  ai_content_strategist: {
    key: 'ai_content_strategist',
    description:
      "Content gap analysis against competitors + 90-day content calendar with SEO-briefed outlines. Covers 14 industries with tailored content pillars. Its route checks isFlagOn('ai_content_strategist'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  ai_site_critic: {
    key: 'ai_site_critic',
    description:
      "AI-powered site critique with per-dimension scoring, A-F grading, industry benchmarking, and prioritized auto-fix suggestions. Uses CF Browser Rendering + Workers AI vision. Its route checks isFlagOn('ai_site_critic'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  ai_video_hero: {
    key: 'ai_video_hero',
    description:
      "AI-generated 60-second cinematic brand video script with 8 clips, visual prompts for Sora/Veo, Piper TTS narration, transitions, and credit cost estimation. Its route checks isFlagOn('ai_video_hero'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  app_launcher: {
    key: 'app_launcher',
    description:
      'Per-tenant app provisioning planner: 11 apps cataloged (Plane, Twenty, Listmonk, Chatwoot, Lago, Unkey, Nango, Payload, LiteLLM, Better Auth, Native Social). CNAME→credential→container launch pipeline. Cost estimation per app.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  builtin_crm: {
    key: 'builtin_crm',
    description:
      "Lead scoring engine (0-100, hot/warm/cold) from 7 source types and 8 behavioral signals. Pipeline stage manager (7 stages), deal value tracker, next-action recommender. Pure, deterministic, zero I/O. Its route checks isFlagOn('builtin_crm'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  cms_collections: {
    key: 'cms_collections',
    description:
      'Dynamic content types with rich relationships. 7 built-in templates (team, services, testimonials, portfolio, events, faq, menu_items) with reference fields, dynamic routing, JSON-LD mapping, and relationship auto-detection.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  code_export: {
    key: 'code_export',
    description:
      "One-click export of any generated site as a self-contained, deployable Cloudflare Worker project. Includes wrangler.toml, Worker source (Hono), D1 migrations, R2 assets, and deploy instructions. Its route checks isFlagOn('code_export'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  conversational_analytics: {
    key: 'conversational_analytics',
    description:
      'Natural language → analytics query intent parser. Ask questions like "how many visitors last week?" and get structured query intents. Regex-based for 80% of queries, LLM fallback for ambiguous ones. Its route checks isFlagOn(\'conversational_analytics\'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  customer_portal: {
    key: 'customer_portal',
    description:
      "Client portal access engine: magic-link auth, per-client page access control, 30-day expiry, sub-page path matching. Use case: agencies sharing invoices/projects/files with clients. Its route checks isFlagOn('customer_portal'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  geo_toolkit: {
    key: 'geo_toolkit',
    description:
      "Dual-scoring content analyzer for traditional SEO + AI answer engine discoverability. Factual claim extraction, citation checking, AI formatting quality scoring, and prioritized GEO suggestions. Its route checks isFlagOn('geo_toolkit'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  lifecycle_agent: {
    key: 'lifecycle_agent',
    description:
      'Pure site health monitoring rule engine. Checks content freshness, SEO fundamentals, performance, security, trust signals, competitive gaps, and broken links. Generates health scores, severity-ranked issues, and auto-fixable recommendations.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  local_seo_suite: {
    key: 'local_seo_suite',
    description:
      'NAP consistency auditor + review response suggester + directory coverage tracker. Detects name/address/phone discrepancies across directories (Google, Yelp, Facebook, Bing), generates rating-aware review replies, and tracks directory claiming status.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  marketing_dashboard: {
    key: 'marketing_dashboard',
    description:
      'Widget-based analytics dashboard with 11 default widgets across 6 sources (website/email/social/ads/crm/booking). Metric change computation with trend detection, source filtering, and grid/list layouts.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  native_booking: {
    key: 'native_booking',
    description:
      'Pure availability calculator + slot generator + booking validator. Generates 15-min increment time slots with buffer time, detects conflicts, validates against business hours, and produces booking confirmations with cancellation policy.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  nl_site_management: {
    key: 'nl_site_management',
    description:
      'Natural language → site edit intent parser. Commands like "change my hero headline to Best Pizza" are parsed into structured edit intents (change_text, add_section, remove_element, update_info) with target section resolution.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  seo_agent: {
    key: 'seo_agent',
    description:
      'SEO health monitoring: indexing checks (sitemap/robots/index rate), on-page checks (meta/H1/alt/schema), keyword rank tracking (wins/losses/drops), competitor gap detection. Generates A-F grade with prioritized fix suggestions.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  social_agent: {
    key: 'social_agent',
    description:
      "Content proposal generator with platform-aware captions, hashtags, image prompts, and optimal posting times for 10 platforms. Engagement scoring with trend detection (growing/stable/declining). Its route checks isFlagOn('social_agent'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  social_publishing_native: {
    key: 'social_publishing_native',
    description:
      "Native social media posting (instant + scheduled) across 14 platforms. Replaces Postiz. CF Workflows v2 + Upstash + D1 + Tinybird. Its route checks isFlagOn('social_publishing_native'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  visual_automation: {
    key: 'visual_automation',
    description:
      "Journey validation engine: 7 action types, 6 trigger types, step delay estimation, linear journey validation with error reporting. Its route checks isFlagOn('visual_automation'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  voice_site_mgmt: {
    key: 'voice_site_mgmt',
    description:
      'Voice command parser for site editing: 9 intent types (change_text, update_info, add_section, remove_section, publish_site, check_health). Filler-word filtering, verbal confirmation generation, confidence scoring.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  white_label: {
    key: 'white_label',
    description:
      "Agency dashboard: MRR calculation, churn rate, client site management, branded reselling. Agencies resell ProjectSites under their own brand. Its route checks isFlagOn('white_label'); the flag was never in FLAG_REGISTRY so resolveFlag short-circuited it dead. Registered 2026-08-13 (default-off = promotable dark-launch).",
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },

  // Generation/editing + growth + Cloudflare quick wins
  ai_payment_command: {
    key: 'ai_payment_command',
    description:
      'Safety-gated AI payment-command endpoint (POST /api/ai-actions/payment-command): NL→intent policy engine that refuses raw card / last4-only, requires an intent-bound confirmation token for live charges, and runs only saved-PM-ref charges via the constrained Stripe tool layer (create+confirm / refund / get_status)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  lead_scanner: {
    key: 'lead_scanner',
    description:
      'Super-Admin lead scanner (POST /api/admin/leads/scan): a Google Places text-search query → score each result → keep the no-website businesses → persist as claim-able leads via createLead. Default-off → the route 404s; outreach send is a separate, explicitly-enabled step (never auto-sends).',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  vectorize_search: {
    key: 'vectorize_search',
    description:
      'Enables semantic search over published site content via Cloudflare Vectorize (GET /api/sites/:id/search?q=...). Site files are indexed asynchronously on every publish via waitUntil so the response is never blocked. Requires the RAG_INDEX Vectorize binding (768-dim cosine, bge-base-en-v1.5 embeddings). Server returns 404 (never 403) when disabled. Failure mode: missing binding → indexing silently skipped; search returns empty results rather than erroring. Acceptance: search endpoint returns ≥1 result with a score field after a site is published.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  better_auth: {
    key: 'better_auth',
    description:
      'CUTOVER FLAG for the embedded Better Auth rebuild (auth/better-auth.ts). When ON, Better Auth owns /api/auth/* (email+password, magic link, Google social, TOTP 2FA) and issues its own D1 sessions in the singular user/session/account/verification tables; when OFF (default), /api/auth/* falls through to the legacy magic-link/Google/D1-session auth. MUST stay OFF in production until the frontend sign-in UI + user-migration backfill land — flipping it early would route live sign-in at an unmigrated system. Safe disabled behavior: legacy auth unchanged. Acceptance: with the flag on in a test env, POST /api/auth/sign-up/email creates a user + session.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  social_publishing: {
    key: 'social_publishing',
    description:
      'KILL-SWITCH for Pulse Social post publishing. Gates the dispatch endpoints (POST /api/social/posts/:id/schedule + /publish-now) that trigger the SocialPublishWorkflow. Defaults ENABLED (rollout 100, stable) so existing behavior is unchanged — this flag exists so an operator can instantly DISABLE all social publishing (e.g. a publisher is mis-posting or a platform API is down) WITHOUT a redeploy by flipping the global override off. When off, the dispatch endpoints return 503 FEATURE_DISABLED (the feature is known, so a clear disabled signal beats a misleading 404). Composing/drafting still works. Acceptance: flag on → schedule/publish-now 200 + workflow runs; flag off → 503.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  social_autopilot: {
    key: 'social_autopilot',
    description:
      'KILL-SWITCH for Pulse Social Auto-Pilot (the AI cron that generates + schedules drafts per configured network). Gates POST /api/social/auto-pilot/run-now. Defaults ENABLED (rollout 100, stable) so existing behavior is unchanged; an operator flips the global override off to instantly halt all autonomous posting WITHOUT a redeploy (e.g. AI is generating off-brand content). When off, run-now returns 503 FEATURE_DISABLED; manual compose/schedule and the read-only preview are unaffected. Acceptance: flag on → run-now 200; flag off → 503.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  site_tags: {
    key: 'site_tags',
    description:
      'Site Tags & Labels (#11): per-site colored label pills with custom names, colors (22 hues), and emoji icons. Org-scoped, filterable in the site list. CRUD at /api/site-tags + /api/sites/:siteId/tags.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  system_status: {
    key: 'system_status',
    description:
      'System Status Strip (#12): aggregated health checks for all platform integrations (Listmonk, Lago, Nango, LiteLLM, Plane, Twenty, Payload, Unkey, Chatwoot). Returns per-integration green/yellow/red status for the admin top bar.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  activity_feed: {
    key: 'activity_feed',
    description:
      'Dashboard Activity Feed (#13): unified org-scoped timeline of recent platform events — builds, publishes, deploys, domain changes, billing events, member changes. Aggregated from audit_logs with cursor-based pagination. GET /api/activity.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  mru_cards: {
    key: 'mru_cards',
    description:
      'MRU Cards (#14): "Continue where you left off" — most-recently-active sites per org, ordered by last audit_log entry. Returns site name, slug, last action, and timestamp for dashboard quick-jump cards. GET /api/mru.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  usage_gauges: {
    key: 'usage_gauges',
    description:
      'Usage Gauge Rings (#15): per-org usage metrics — sites, builds, media GB, bandwidth GB — computed from D1 with pct-of-limit for SVG gauge-ring dashboard visualization. GET /api/usage.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  analytics_annotations: {
    key: 'analytics_annotations',
    description:
      'Analytics Annotations (#24): CRUD for chart annotations tied to analytics events. GET/POST/DELETE /api/sites/:siteId/annotations.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  cmd_k_actions: {
    key: 'cmd_k_actions',
    description:
      'Cmd+K Natural Language Actions (#23): NL query → ranked admin action suggestions (rebuild/snapshot/delete/view/edit/publish). POST /api/cmdk.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  site_health_sparklines: {
    key: 'site_health_sparklines',
    description:
      'Site Health Sparklines (#22): 7-day traffic trend per site from analytics_daily. GET /api/sites/:siteId/sparkline.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  notification_badge: {
    key: 'notification_badge',
    description:
      'Notification Badge Count (#21): unread alert + failed-build count per org for admin nav badge. GET /api/notifications/badge.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  batch_operations: {
    key: 'batch_operations',
    description:
      'Batch Site Operations (#20): bulk rebuild/snapshot/delete for up to 50 sites. Validates org ownership per site. POST /api/batch.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  site_comparison: {
    key: 'site_comparison',
    description:
      'Site Comparison View (#18): side-by-side diff of two sites — pages, builds, domains, status, last activity. POST /api/sites/compare.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  site_clone: {
    key: 'site_clone',
    description:
      'Site Clone One-Click (#19): copies pages/settings/metadata to a new slug. POST /api/sites/clone.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  nl_analytics: {
    key: 'nl_analytics',
    description:
      'Natural Language Analytics (#17): stateless NL→SQL intent parser. "How many sites?" → D1 query with results + explanation. 7 recognized patterns. POST /api/analytics/query.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  onboarding_progress: {
    key: 'onboarding_progress',
    description:
      'Onboarding Progress Ring (#16): tracks org onboarding completion — site created, first build, domain added, billing set, team invited — returns pct complete with per-step detail. GET /api/onboarding.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  // ── Flags referenced in frontend components but missing from registry ──
  // These were discovered by the convergence loop: the frontend checks these
  // flag keys via app-flag-gate-notice, but the keys never existed in D1.
  // ── Restored 2026-08-13: dark-launch flags for WIRED built-ahead modules that
  // commit 442e1d82 (flag prune) over-removed. All 33 have libs/features/* manifests
  // + are imported in src (index.ts). default_enabled:false → zero runtime change.
  abuse_takedown: {
    key: 'abuse_takedown',
    description:
      'Abuse report intake + content takedown workflow for published sites (DMCA / illegal-content handling). Hosting-platform necessity.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  aeo_pass: {
    key: 'aeo_pass',
    description:
      'Answer-Engine-Optimization audit + structured-data tuning on every publish targeting ChatGPT/Perplexity/AI-Overviews citation, extending the on-publish SEO pass',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  ai_gateway_guardrails: {
    key: 'ai_gateway_guardrails',
    description:
      'Llama Guard middleware on /ai/* routes blocking prompt-injection/hate/off-brand input+output before publish, with a no-redeploy killswitch per rules/ai-agent-security',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  audit_trail_export: {
    key: 'audit_trail_export',
    description:
      'Org-scoped audit-log export: admins filter by action/date and download the audit trail as JSON or CSV for compliance reviews',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  cmdk_ai_actions: {
    key: 'cmdk_ai_actions',
    description:
      'AI actions layer on the existing Cmd+K palette: natural language routes to navigation, bulk mutations, or agent tasks (the palette + focus gate already ship)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  cms_content: {
    key: 'cms_content',
    description:
      'CMS content bridge: edge-cached /api/cms/blog.json feed for generated sites + HMAC-verified /api/cms/revalidate receiver that purges the cache when Payload publishes content',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  credit_wallet_rollover: {
    key: 'credit_wallet_rollover',
    description:
      'AI-credit wallet rollover + promo credits + expiry: unused monthly credits carry forward, promo grants stack, expiring balances surface urgency in the billing wallet',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  deploy_buttons: {
    key: 'deploy_buttons',
    description:
      'Generates one-click "Deploy to projectsites.dev" buttons + a "Hosted on projectsites.dev" badge snippet for READMEs/footers (viral growth loop)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  edge_personalization: {
    key: 'edge_personalization',
    description:
      'No-PII edge swap of hero headline/sub/image/primary-CTA/sticky-bar from geo/device/referrer/time/return signals via sub-10ms Workers-AI call, A/B-eval looped',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  figma_import: {
    key: 'figma_import',
    description:
      'Import design tokens and component metadata from a Figma file via the Figma REST API (POST /api/figma/import), letting designers push brand tokens into a generated site. Caller-supplied Figma PAT; off by default. Registered to satisfy the feature-drift gate for the concurrently-built libs/features/figma_import module.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  generative_ui_stream: {
    key: 'generative_ui_stream',
    description:
      'Returns schema-bound UI descriptors generated by Workers AI LLM for dynamic copilot-driven interface composition (POST /api/copilot/ui). Zod-validated outputs; off by default. Registered to satisfy the feature-drift gate for the concurrently-built libs/features/generative_ui_stream module.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  mcp_oauth_provider: {
    key: 'mcp_oauth_provider',
    description:
      'OAuth 2.1 authorization server so MCP clients (Claude Code) authenticate via PKCE instead of pasting psk_ tokens',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  model_registry: {
    key: 'model_registry',
    description:
      'OpenAI-compatible GET /v1/models — the ProviderCapabilityRegistry + ModelAliasRegistry catalog (deepseek/anthropic/openai/gemini/grok/workers-ai aliases) with per-provider availability gating',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  native_booking_engine: {
    key: 'native_booking_engine',
    description:
      'First-class booking/availability engine with slots, holds, reminders and optional deposit via payments_rail — eliminates the third-party scheduler dependency',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  observability_gateway: {
    key: 'observability_gateway',
    description:
      'Customer-site observability gateway (POST /monitoring/:provider): worker proxy customer sites POST Sentry/PostHog events to so raw vendor keys never ship to the browser. Tenant-tagged + PII-redacted + sampled + quota-capped before server-side forward; rollups to Analytics Engine. Default-off → route 404s. Registered to satisfy the feature-drift gate for the concurrently-built libs/features/observability_gateway module.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'hey@megabyte.space',
  },
  onboarding_copilot: {
    key: 'onboarding_copilot',
    description:
      'PLG activation checklist: computes a new org’s next-best actions (create site → publish → add custom domain) with a dismiss control',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  payments_rail: {
    key: 'payments_rail',
    description:
      'Unified payments seam over Square (accept) + Stripe (SaaS/payouts): one idempotency key, one webhook verifier, one entitlement grant path per rules/payments-routing',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  platform_mcp: {
    key: 'platform_mcp',
    description:
      'Account-level MCP server so Claude Code/Cursor/MCP clients connect with a scoped psk_ API token and manage their sites (list/inspect/build-status; deploy next)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  preview_share_card: {
    key: 'preview_share_card',
    description:
      'Owner-driven viral loop. After a build the owner gets honest pre-written share messages (SMS/WhatsApp/email/copy), one-tap platform deep-links (SMS, WhatsApp, mailto, X, Facebook), and OG-card params for a branded 1200x630 card — sharing their new site to real customers in seconds. The shared link is the ad. Free-tier; 404 when off.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  prod_readiness_score: {
    key: 'prod_readiness_score',
    description:
      'Production Readiness Score (0-100 + grade) per site: published, custom domain, performance, sitemap checks — surfaces what to fix before launch',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  prompt_studio: {
    key: 'prompt_studio',
    description:
      'Admin surface over the existing prompt registry: versioned templates with A/B variants, KV hot-patch, and one-click rollback for non-engineers',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  referral_loop: {
    key: 'referral_loop',
    description:
      'In-product refer-a-friend: tracked referral codes/links, attributed signups, and credit rewards granted through the wallet on a referred conversion',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  site_analytics: {
    key: 'site_analytics',
    description:
      'Owner-facing per-site analytics summary aggregating contacts, form submissions, newsletter subs and donations',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/admin/analytics.spec.ts (green live),
    owner_email: 'brian@megabyte.space',
  },
  site_doctor: {
    key: 'site_doctor',
    description:
      'Owner-facing A-F site health report with prioritized, plain-English one-tap fixes. Translates production-readiness signals (published, custom domain, performance, sitemap) into owner language; free plan sees the top issue, the rest locked behind a paid power-up. Sharp professional voice; reuses prod_readiness_score scoring.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  site_semantic_search: {
    key: 'site_semantic_search',
    description:
      'Auto-installed semantic search over a published site own R2 content via Vectorize/AutoRAG, re-indexed on content change — answers, not just keyword match',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  site_thumbnail_grid: {
    key: 'site_thumbnail_grid',
    description:
      'Real-browser thumbnail of every site in the admin catalog via Browser-Rendering screenshot, cached in R2 and reused from the snapshot path',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  status_page_live: {
    key: 'status_page_live',
    description:
      'Public status page backed by real uptime/incident data with subscriber alerts; extends the existing /status route shell — frontend-primary with a status feed endpoint',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  url_clone_seed: {
    key: 'url_clone_seed',
    description:
      'Paste a URL and seed the builder from it: Browser-Rendering extracts layout + copy + structured-data JSON to prefill a new site as an acquisition fast-start',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  visitor_dsar: {
    key: 'visitor_dsar',
    description:
      'GDPR/CCPA data-subject-access endpoint: a site owner can export or soft-delete a visitor’s data by email or visitor_id, with an audit-log entry',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  visitor_events_core: {
    key: 'visitor_events_core',
    description:
      'Public pageview/click/conversion beacon ingest from published sites; feeds site_analytics traffic block',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  visual_point_edit: {
    key: 'visual_point_edit',
    description:
      'Click any live-preview element and have AI mutate only that node (copy/style/layout) without a full regeneration — frontend-primary, backed by a scoped edit endpoint',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  wireframe_planning: {
    key: 'wireframe_planning',
    description:
      'Pre-generation sitemap + page-level wireframe plan surfaced as an approval gate in /create before section generation, so IA problems are caught up front',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },

  // ── Restored 2026-08-13: dark-launch flags for WIRED built-ahead modules that
  // commit 442e1d82 (flag prune) over-removed. All 1 have libs/features/* manifests
  // + are imported in src (index.ts). default_enabled:false → zero runtime change.
  mcp_server: {
    key: 'mcp_server',
    description: '/.well-known/mcp + OAuth 2.1 RFC 8707 resource discovery',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
};

export type FlagKey = keyof typeof FLAG_REGISTRY;

export function listFlags(): FlagDefinition[] {
  return Object.values(FLAG_REGISTRY);
}

export function getDefaultFlag(key: string): FlagDefinition | undefined {
  return FLAG_REGISTRY[key];
}
