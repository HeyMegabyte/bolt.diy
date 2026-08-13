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
  email_marketing: {
    key: 'email_marketing',
    description:
      'Real newsletter-campaign send to consented contacts + confirmed subscribers via Resend (replaces the stub recipient count)',
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
  public_api: {
    key: 'public_api',
    description: 'Public REST + GraphQL API + OpenAPI 3.1 + webhooks',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
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
  site_mcp_server: {
    key: 'site_mcp_server',
    description: 'Per-customer-site MCP server — Siri/Claude/Cursor query the site directly',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/site-mcp/site-mcp.spec.ts (green live),
    owner_email: 'brian@megabyte.space',
  },
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
  search_engine_submit: {
    key: 'search_engine_submit',
    description:
      'Auto-submit published sites to IndexNow (Bing+Yandex) + Bing/Google sitemap pings on publish',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  gbp_assist: {
    key: 'gbp_assist',
    description:
      'One-click Google Business Profile setup + optimizer: detect, claim/create deep-link, AI SEO content pack + guided checklist',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
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
  unified_inbox: {
    key: 'unified_inbox',
    description:
      'Unified Visitor Inbox: forms+chat+voice+email+SMS under one identity, assignable, SLA-tracked, AI-drafted replies',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'beta', // beta 2026-07-31: e2e verified — e2e/_fortress/unified_inbox/* (happy+adversarial live; flag already ON at 100% via operator override),
    owner_email: 'brian@megabyte.space',
  },
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
  storefront_ecommerce: {
    key: 'storefront_ecommerce',
    description:
      'Lightweight native storefront for generated sites: products/variants in D1, assets in R2, checkout via Square Web Payments behind payments_rail (not MedusaJS)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
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
  ai_concierge_widget: {
    key: 'ai_concierge_widget',
    description:
      'Visitor-facing per-site AI concierge grounded in the site own content with real tool-calls (book/quote/route) — stateful agent, not a chatbot placeholder',
    default_enabled: false,
    default_rollout_percent: 0,
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
  collab_editing: {
    key: 'collab_editing',
    description:
      'Enables real-time collaborative editing of a site via a Yjs CRDT synced over a PartyServer Durable Object WebSocket (GET /api/sites/:id/collab). One CollabRoomDO instance per site (keyed site:<id>) fans Yjs document updates to every connected client; the Angular CollabService connects with a vanilla PartySocket. Server returns 404 (never 403) when the flag is off, and 503 when the COLLAB_ROOM Durable Object binding is absent (it ships INERT — the wrangler.toml binding+migration are commented because a new DO class is a watched one-way-door deploy). Failure mode disabled: the editor stays single-player; nothing else breaks. Acceptance: the WS handshake upgrades to 101 and two clients converge on shared document state.',
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
  log_explorer: {
    key: 'log_explorer',
    description:
      'Log Explorer — Worker tail log search with cost-by-route breakdown. Feature flag gate on the Explorer tab inside /admin/logs.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  domain_stack_wizard: {
    key: 'domain_stack_wizard',
    description:
      'Domain Stack Wizard — 7-tile progress board for DNS→SSL→email-auth→GSC. Feature flag gate on /admin/domains/:id/stack.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  multimodal_copilot: {
    key: 'multimodal_copilot',
    description:
      'Multimodal AI Site Copilot — per-site copilot admin with intent distribution + sessions. Feature flag gate on /admin/sites/:id/copilot.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  section_marketplace: {
    key: 'section_marketplace',
    description:
      'Section Marketplace — browsable catalog of installable site sections (hero, FAQ, pricing, etc.). Feature flag gate on the section picker.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  site_dna_taste_graph: {
    key: 'site_dna_taste_graph',
    description:
      'Site DNA Taste Graph — per-site taste-signal admin with feedback history + preference bars. Feature flag gate on /admin/sites/:id/dna.',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  swarm_editor: {
    key: 'swarm_editor',
    description:
      'Multi-Agent Swarm Editor — the 7-column parallel-specialist editing board + live component stream at /admin/swarm/:siteId. DARK: the /api/swarm/* backend is roadmap; the panel is a simulated preview and the run-history fetch is gated on this flag until live multi-agent execution ships.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
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
