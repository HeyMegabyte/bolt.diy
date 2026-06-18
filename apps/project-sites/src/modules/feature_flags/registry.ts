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
  site_analytics: {
    key: 'site_analytics',
    description:
      'Owner-facing per-site analytics summary aggregating contacts, form submissions, newsletter subs and donations',
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
  speculation_rules: {
    key: 'speculation_rules',
    description: 'Speculation Rules auto-injection on marketing HTML',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  // GEO (items 20-24, 20-22 already stable)
  structured_data_autopilot: {
    key: 'structured_data_autopilot',
    description: 'Auto-emit Org+WebSite+WebPage+FAQPage JSON-LD',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  quotable_answer_block: {
    key: 'quotable_answer_block',
    description: 'AI-search-optimized 40-60 word quotable block per page',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  llms_txt: {
    key: 'llms_txt',
    description: '/llms.txt + /llms-full.txt + AI-crawler robots.txt',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  // Accessibility (items 25-29, 29 stable)
  accessibility_statement: {
    key: 'accessibility_statement',
    description: '/accessibility page with WCAG 2.2 + IRS §44 explainer',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
  // Editor UX (items 30-34)
  // Monetization (items 35-38)
  // Observability (items 39-42)
  // Media gen (items 43-46)
  // Platform extension (items 47-50, 47 + 48-slice + 49-slice already stable)
  mcp_server: {
    key: 'mcp_server',
    description: '/.well-known/mcp + OAuth 2.1 RFC 8707 resource discovery',
    default_enabled: true,
    default_rollout_percent: 100,
    stage: 'stable',
    owner_email: 'brian@megabyte.space',
  },
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
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  // ── 10 brilliant — site-as-MCP, cold-tier, AI-auto-router, ghost-routes, speed-compare, auto-gen-files, hallucination-guard, visitor-recognition, faq-from-tickets, competitor-monitor
  site_mcp_server: {
    key: 'site_mcp_server',
    description: 'Per-customer-site MCP server — Siri/Claude/Cursor query the site directly',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
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
    stage: 'experimental',
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
    stage: 'experimental',
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
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  outbound_webhooks: {
    key: 'outbound_webhooks',
    description:
      'Outbound Webhooks (#10): customers subscribe their own https endpoints to site events; deliveries are signed (HMAC, replay-safe) + retried with backoff. Endpoint secret AES-GCM encrypted at rest. CRUD at /api/sites/:siteId/webhooks.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  // ── Marketplace + Creator Economy (ideas #39/#40/#41/#42 — 2026-05-28)
  // ── Viral + Billing + Audit-Chain (ideas #33, #34, #36, #46 — 2026-05-28)
  // ── Enterprise wave (Trust Center / Enterprise Plan / Stripe App status / Agent SDK+MCP, 2026-05-28)
  // ── Compliance / safety / revenue (added 2026-06-07 per UNFINISHED_FEATURES §9b)
  abuse_takedown: {
    key: 'abuse_takedown',
    description:
      'Abuse report intake + content takedown workflow for published sites (DMCA / illegal-content handling). Hosting-platform necessity.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  // ── Idea-merge wave 2026-06-08: genuinely-new platform flags (the rest of the
  //    30 ideas fold into existing flag scopes as extra checklist checkpoints).
  site_video_gen: {
    key: 'site_video_gen',
    description:
      'Per-site narrative video: storyboard → Veo clips → ~56s brand film assembled in the build Workflow, delivered device-adaptive via Media Transformations.',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
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
  payments_rail: {
    key: 'payments_rail',
    description:
      'Unified payments seam over Square (accept) + Stripe (SaaS/payouts): one idempotency key, one webhook verifier, one entitlement grant path per rules/payments-routing',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  storefront_ecommerce: {
    key: 'storefront_ecommerce',
    description:
      'Lightweight native storefront for generated sites: products/variants in D1, assets in R2, checkout via Square Web Payments behind payments_rail (not MedusaJS)',
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
  credit_wallet_rollover: {
    key: 'credit_wallet_rollover',
    description:
      'AI-credit wallet rollover + promo credits + expiry: unused monthly credits carry forward, promo grants stack, expiring balances surface urgency in the billing wallet',
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
  site_semantic_search: {
    key: 'site_semantic_search',
    description:
      'Auto-installed semantic search over a published site own R2 content via Vectorize/AutoRAG, re-indexed on content change — answers, not just keyword match',
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
  prompt_studio: {
    key: 'prompt_studio',
    description:
      'Admin surface over the existing prompt registry: versioned templates with A/B variants, KV hot-patch, and one-click rollback for non-engineers',
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

  // Generation/editing + growth + Cloudflare quick wins
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
  url_clone_seed: {
    key: 'url_clone_seed',
    description:
      'Paste a URL and seed the builder from it: Browser-Rendering extracts layout + copy + structured-data JSON to prefill a new site as an acquisition fast-start',
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
  aeo_pass: {
    key: 'aeo_pass',
    description:
      'Answer-Engine-Optimization audit + structured-data tuning on every publish targeting ChatGPT/Perplexity/AI-Overviews citation, extending seo_autopilot',
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
  site_thumbnail_grid: {
    key: 'site_thumbnail_grid',
    description:
      'Real-browser thumbnail of every site in the admin catalog via Browser-Rendering screenshot, cached in R2 and reused from the snapshot path',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  platform_mcp: {
    key: 'platform_mcp',
    description: 'Account-level MCP server so Claude Code/Cursor/MCP clients connect with a scoped psk_ API token and manage their sites (list/inspect/build-status; deploy next)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  mcp_oauth_provider: {
    key: 'mcp_oauth_provider',
    description: 'OAuth 2.1 authorization server so MCP clients (Claude Code) authenticate via PKCE instead of pasting psk_ tokens',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  prod_readiness_score: {
    key: 'prod_readiness_score',
    description: 'Production Readiness Score (0-100 + grade) per site: published, custom domain, performance, sitemap checks — surfaces what to fix before launch',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  deploy_buttons: {
    key: 'deploy_buttons',
    description: 'Generates one-click "Deploy to projectsites.dev" buttons + a "Hosted on projectsites.dev" badge snippet for READMEs/footers (viral growth loop)',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  visitor_dsar: {
    key: 'visitor_dsar',
    description: 'GDPR/CCPA data-subject-access endpoint: a site owner can export or soft-delete a visitor’s data by email or visitor_id, with an audit-log entry',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  onboarding_copilot: {
    key: 'onboarding_copilot',
    description: 'PLG activation checklist: computes a new org’s next-best actions (create site → publish → add custom domain) with a dismiss control',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  audit_trail_export: {
    key: 'audit_trail_export',
    description: 'Org-scoped audit-log export: admins filter by action/date and download the audit trail as JSON or CSV for compliance reviews',
    default_enabled: false,
    default_rollout_percent: 0,
    stage: 'experimental',
    owner_email: 'brian@megabyte.space',
  },
  model_registry: {
    key: 'model_registry',
    description: 'OpenAI-compatible GET /v1/models — the ProviderCapabilityRegistry + ModelAliasRegistry catalog (deepseek/anthropic/openai/gemini/grok/workers-ai aliases) with per-provider availability gating',
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
