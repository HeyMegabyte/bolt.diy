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
  core_auth: { key: 'core_auth', description: 'Always-on sentinel: auth surface (magic-link + Google OAuth + sessions). isFlagOn always true.', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  core_admin_detail: { key: 'core_admin_detail', description: 'Always-on sentinel: admin site-detail split-view panel. isFlagOn always true.', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  core_site_create: { key: 'core_site_create', description: 'Always-on sentinel: homepage site-creation funnel. isFlagOn always true.', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  core_feature_flags: { key: 'core_feature_flags', description: 'Always-on sentinel: feature-flags admin UI. isFlagOn always true.', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // ── Alias sentinel keys — thin manifest dirs that alias an already-canonical manifest.
  //    Created so that e2e/_fortress/<slug>/ directories have a matching libs/features/<slug>/
  //    and the drift validator's TEST_NOT_LINKED check resolves.
  alias_swarm_editor: { key: 'alias_swarm_editor', description: 'Alias dir for _fortress/swarm-editor → libs/features/swarm_editor. Resolves TEST_NOT_LINKED drift warning.', default_enabled: false, default_rollout_percent: 0, stage: 'deprecated', owner_email: 'brian@megabyte.space' },
  alias_inbox: { key: 'alias_inbox', description: 'Alias dir for _fortress/inbox → libs/features/unified_inbox. Resolves TEST_NOT_LINKED drift warning.', default_enabled: false, default_rollout_percent: 0, stage: 'deprecated', owner_email: 'brian@megabyte.space' },
  alias_public_api: { key: 'alias_public_api', description: 'Alias dir for _fortress/public-api → libs/features/public_api_v1. Resolves TEST_NOT_LINKED drift warning.', default_enabled: false, default_rollout_percent: 0, stage: 'deprecated', owner_email: 'brian@megabyte.space' },
  // Compete-or-die (items 1-8)
  multi_model_router: { key: 'multi_model_router', description: 'Multi-model picker (Opus/Sonnet/Workers AI/GPT-5) per prompt', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  db_provisioning: { key: 'db_provisioning', description: 'One-click Neon/Supabase Postgres provisioning per site', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  audit_hash_chain: { key: 'audit_hash_chain', description: 'SOC 2 immutable audit trail with hash-chain verification', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  github_sync: { key: 'github_sync', description: 'Two-way GitHub sync (commit-on-save + PR-per-branch)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  token_burn_meter: { key: 'token_burn_meter', description: 'Live token-burn meter in editor with monthly projection', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  contacts_core: { key: 'contacts_core', description: 'Shared contacts/CRM core — one person/lead store every capture surface dedupes into via recordContact()', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  site_analytics: { key: 'site_analytics', description: 'Owner-facing per-site analytics summary aggregating contacts, form submissions, newsletter subs and donations', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  visitor_events_core: { key: 'visitor_events_core', description: 'Public pageview/click/conversion beacon ingest from published sites; feeds site_analytics traffic block', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  email_marketing: { key: 'email_marketing', description: 'Real newsletter-campaign send to consented contacts + confirmed subscribers via Resend (replaces the stub recipient count)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  data_export: { key: 'data_export', description: 'Owner data portability — export org contacts as RFC4180 CSV with OWASP CSV-injection neutralization', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  snapshot_rollback: { key: 'snapshot_rollback', description: 'Snapshot-per-prompt forward-only rollback', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  streaming_generation: { key: 'streaming_generation', description: 'Streaming-first site generation (<8s to hero render)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  template_marketplace: { key: 'template_marketplace', description: 'Curated industry templates with creator revenue-share', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Multi-tenant + agency (items 9-13)
  wfp_dispatch: { key: 'wfp_dispatch', description: 'Workers for Platforms dispatch namespace per customer site', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  egress_control: { key: 'egress_control', description: 'Outbound Worker per-tenant egress rules + audit log', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  agency_tier: { key: 'agency_tier', description: 'Reseller/agency tier with Stripe Connect + white-label invoices', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  tenant_hot_state: { key: 'tenant_hot_state', description: 'Per-tenant DO SQLite hot state (drafts, cursors, sessions)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  whitelabel_admin: { key: 'whitelabel_admin', description: 'White-label admin domain + tenant CSS theming', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // CWV (items 14-19, 15 already shipped)
  cwv_publish_gate: { key: 'cwv_publish_gate', description: 'Lighthouse CI publish gate (blocks deploy on CWV failure)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  speculation_rules: { key: 'speculation_rules', description: 'Speculation Rules auto-injection on marketing HTML', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  rum_telemetry: { key: 'rum_telemetry', description: 'Real-user LoAF + soft-nav web-vitals v4 ingest', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  critical_css_inline: { key: 'critical_css_inline', description: 'Critical CSS extraction + inline at build time', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  image_triplet_pipeline: { key: 'image_triplet_pipeline', description: 'AVIF/WebP/JPEG image triplet via Sharp pipeline', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  speed_score_widget: { key: 'speed_score_widget', description: 'Per-customer Speed Score widget + share-with-client PDF', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // GEO (items 20-24, 20-22 already stable)
  structured_data_autopilot: { key: 'structured_data_autopilot', description: 'Auto-emit Org+WebSite+WebPage+FAQPage JSON-LD', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  quotable_answer_block: { key: 'quotable_answer_block', description: 'AI-search-optimized 40-60 word quotable block per page', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  llms_txt: { key: 'llms_txt', description: '/llms.txt + /llms-full.txt + AI-crawler robots.txt', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  geo_visibility_tracker: { key: 'geo_visibility_tracker', description: 'Daily ChatGPT/Claude/Perplexity citation tracking', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  cornerstone_autorefresh: { key: 'cornerstone_autorefresh', description: 'Monthly Workflow regenerates top-10 cornerstone pages', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Accessibility (items 25-29, 29 stable)
  axe_publish_gate: { key: 'axe_publish_gate', description: 'axe-core publish gate at 6 viewports', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_alt_text: { key: 'ai_alt_text', description: 'AI alt-text generation on every uploaded image', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  wcag22_wizard: { key: 'wcag22_wizard', description: 'WCAG 2.2 manual-review wizard at publish (8 criteria)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  oklch_contrast_lift: { key: 'oklch_contrast_lift', description: 'OKLCH relative-color contrast auto-correct', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  accessibility_statement: { key: 'accessibility_statement', description: '/accessibility page with WCAG 2.2 + IRS §44 explainer', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // Editor UX (items 30-34)
  section_overlay: { key: 'section_overlay', description: 'Visual section overlay: hover preview → jump to source', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  voice_editing: { key: 'voice_editing', description: 'Whisper STT → bolt tool-call voice editing', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  diff_revert: { key: 'diff_revert', description: 'Side-by-side AI diff with per-file revert', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  crdt_coedit: { key: 'crdt_coedit', description: 'Real-time multi-cursor co-edit via DO + Yjs CRDT', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  approval_workflow: { key: 'approval_workflow', description: 'Agency draft → signed client-review link → publish', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Monetization (items 35-38)
  stripe_meters: { key: 'stripe_meters', description: 'AI-token-metered billing via Stripe Meters', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  upsell_campaign_month3: { key: 'upsell_campaign_month3', description: 'Annual-plan upsell automation at month 3', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  referral_credits: { key: 'referral_credits', description: 'Double-sided referral credits via Stripe coupons', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  cost_attribution: { key: 'cost_attribution', description: 'Per-client CF + AI cost-attribution for agencies', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Observability (items 39-42)
  workflows_v2_sitegen: { key: 'workflows_v2_sitegen', description: 'Workflows v2 deterministic site-generation pipeline', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  otlp_unified_events: { key: 'otlp_unified_events', description: 'Unified OTLP events stream to Axiom', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  tenant_sentry_releases: { key: 'tenant_sentry_releases', description: 'Per-tenant Sentry releases + read-only token', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  slo_tracker: { key: 'slo_tracker', description: 'SLO tracker with burn-rate alerts per route', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Media gen (items 43-46)
  veo_hero_loop: { key: 'veo_hero_loop', description: 'Veo 3.1 brand-locked 8s hero loop generation', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  page_podcast: { key: 'page_podcast', description: 'Per-page AI 3-min podcast via ElevenLabs / OpenAI TTS', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  runway_style_ref: { key: 'runway_style_ref', description: 'Runway Gen-4.5 brand-style-reference pipeline', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  logo_regenerator: { key: 'logo_regenerator', description: 'Sketch/prompt → DTCG brand kit (favicons + OG + maskable)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Platform extension (items 47-50, 47 + 48-slice + 49-slice already stable)
  mcp_server: { key: 'mcp_server', description: '/.well-known/mcp + OAuth 2.1 RFC 8707 resource discovery', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  public_api: { key: 'public_api', description: 'Public REST + GraphQL API + OpenAPI 3.1 + webhooks', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  public_api_v1: { key: 'public_api_v1', description: 'Public REST API v1 — /v1/* with Bearer token auth, 12 endpoints, OpenAPI 3.1 spec', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  cli_tool: { key: 'cli_tool', description: 'npx projectsites init/deploy/preview/logs CLI metadata', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  mobile_admin: { key: 'mobile_admin', description: 'Capacitor iOS/Android admin app + push notifications', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Gap surface (re-folded back from the trim pass)
  i18n_auto_locale: { key: 'i18n_auto_locale', description: 'ACS demographics → auto-fire locale mirrors per site', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  pwa_manifest_full: { key: 'pwa_manifest_full', description: 'PWA manifest with screenshots + shortcuts + share_target', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  web_push: { key: 'web_push', description: 'Web push subscription endpoint via VAPID', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  auto_changelog: { key: 'auto_changelog', description: 'Workers AI auto-changelog from git log', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  tier_rate_limit: { key: 'tier_rate_limit', description: 'Free/Pro/Business tier-aware rate limiting middleware', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── 10 brilliant — site-as-MCP, cold-tier, AI-auto-router, ghost-routes, speed-compare, auto-gen-files, hallucination-guard, visitor-recognition, faq-from-tickets, competitor-monitor
  site_mcp_server: { key: 'site_mcp_server', description: 'Per-customer-site MCP server — Siri/Claude/Cursor query the site directly', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  cold_tier_thaw: { key: 'cold_tier_thaw', description: '90d-idle sites archive to R2 Infrequent Access; auto-thaw on first hit (<30s)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_auto_router: { key: 'ai_auto_router', description: 'Workload-aware AI model auto-router — simple=Workers AI free, complex=Opus, creative=Sonnet', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ghost_routes: { key: 'ghost_routes', description: 'Auto-generate missing routes (e.g., /pricing) on first hit from site research data + cache', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  speed_compare_widget: { key: 'speed_compare_widget', description: 'Embeddable speed-test-vs-competitor widget; viral acquisition surface', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  auto_gen_static_files: { key: 'auto_gen_static_files', description: 'Auto-generate 50 static files (llms.txt, sitemaps, OG cards, favicons) per site on first hit', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  hallucination_guard: { key: 'hallucination_guard', description: 'Every AI claim cited to research_data or flagged for review; EU AI Act Article 50', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  visitor_recognition: { key: 'visitor_recognition', description: 'Anon-DO returning-visitor recognition + personalized hero variant', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  faq_from_tickets: { key: 'faq_from_tickets', description: 'AI clusters support tickets into FAQ drafts via Vectorize embeddings', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  competitor_monitor: { key: 'competitor_monitor', description: 'Daily competitor scrape; new feature/section auto-drafts counter-section', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Round-2 top-5 admin upgrades
  sparkline_overlays: { key: 'sparkline_overlays', description: 'Sparkline inline next to every numeric metric (7-day trend)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  split_view_drawer: { key: 'split_view_drawer', description: 'Two-pane split view: list left, detail right; never leave the list', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  row_hover_actions: { key: 'row_hover_actions', description: 'Hover any row → action toolbar (publish/archive/duplicate/share)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  saved_views: { key: 'saved_views', description: 'Cmd+Shift+S saves current filter+sort+route as a sidebar shortcut', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  predicted_actions: { key: 'predicted_actions', description: 'AI-suggested next actions based on time-of-day + recent patterns', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── 30 big-bet features
  visual_editor_drag_drop: { key: 'visual_editor_drag_drop', description: 'Webflow-class drag-drop site builder beyond bolt.diy chat', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ecommerce_engine: { key: 'ecommerce_engine', description: 'Medusa.js-backed cart/checkout/inventory for retail customers', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  native_booking_engine: { key: 'native_booking_engine', description: 'Cal.com-class native booking per site: availability, deposits, group bookings', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  lms_engine: { key: 'lms_engine', description: 'LMS: modules + lessons + video + quizzes + certificates + drip', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  community_engine: { key: 'community_engine', description: 'Discourse-class forum per customer site with moderation tools', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  newsletter_engine: { key: 'newsletter_engine', description: 'Listmonk-class email newsletter: campaigns + drip + segmentation + A/B', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  membership_paywall: { key: 'membership_paywall', description: 'Paywall + access tiers + Stripe billing + per-page gating', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  donations_engine: { key: 'donations_engine', description: 'Donorbox-class: one-time + recurring + DAFpay + memorial gifts', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  native_mobile_admin: { key: 'native_mobile_admin', description: 'Native iOS + Android admin apps via Capacitor 6', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  native_desktop_admin: { key: 'native_desktop_admin', description: 'Native macOS / Windows / Linux admin via Tauri 2', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  browser_extension: { key: 'browser_extension', description: 'Edit any element on a customer site from any page via browser ext', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  chat_ops_bot: { key: 'chat_ops_bot', description: 'Slack/Teams/Discord bot for admin actions + incident pings', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  soc2_program: { key: 'soc2_program', description: 'SOC 2 Type II controls catalog + evidence collection + auditor portal', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  hipaa_variant: { key: 'hipaa_variant', description: 'HIPAA BAA + encrypted-at-rest + audit log + segmented infra', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  pci_dss_l1: { key: 'pci_dss_l1', description: 'PCI DSS Level 1 tokenization + scope reduction for retail card-handling', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  enterprise_sso: { key: 'enterprise_sso', description: 'SAML 2.0 + OIDC native (Okta/Azure/Auth0) — not just Clerk', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  d1_multi_region: { key: 'd1_multi_region', description: 'Multi-region D1 active-active with Sessions API + auto-failover', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  byo_cloudflare: { key: 'byo_cloudflare', description: 'Enterprise tenants connect their own Cloudflare account via OAuth', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  worker_marketplace: { key: 'worker_marketplace', description: 'Customers publish Worker scripts that other customers install', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  domain_reseller: { key: 'domain_reseller', description: 'Sell domains directly via OpenSRS with one-click + auto DNS', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  brand_voice_clone: { key: 'brand_voice_clone', description: 'Per-brand AI voice clone via ElevenLabs (consent-gated)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_agent_marketplace: { key: 'ai_agent_marketplace', description: 'Customers build + sell AI agents via projectsites MCP tools', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  customer_site_copilot: { key: 'customer_site_copilot', description: 'Embedded chat copilot trained on customer site content (Vectorize RAG)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_video_courses: { key: 'ai_video_courses', description: 'Veo + ElevenLabs auto-build multi-lesson course from outline', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_ab_test_generator: { key: 'ai_ab_test_generator', description: 'AI generates A/B variants + Thompson sampling + auto-promote winner', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  sms_marketing: { key: 'sms_marketing', description: 'Twilio-backed SMS campaigns + drip + segmentation + STOP compliance', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  affiliate_program: { key: 'affiliate_program', description: 'Per-customer affiliate portal + Stripe Connect payouts + tracking', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  loyalty_engine: { key: 'loyalty_engine', description: 'Points + tiers + redemption catalog for repeat customers', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  crm_engine: { key: 'crm_engine', description: 'HubSpot-class CRM: pipeline + deals + tasks + calls + emails', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  cdp_engine: { key: 'cdp_engine', description: 'Customer Data Platform: unified identity + identity resolution + event stream', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── IDE + multi-agent + progressive build (3 new flags)
  ide_sandbox: { key: 'ide_sandbox', description: 'Cloudflare Sandbox-backed full IDE (alternative to bolt.diy chat editor) for power users', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  multi_agent_concurrent: { key: 'multi_agent_concurrent', description: 'Multiple specialist agents (design/copy/seo/a11y/media/motion/qa) work concurrently on one site', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  progressive_skeleton_build: { key: 'progressive_skeleton_build', description: 'Site goes live as skeleton on publish; AI streams real components live via SSE', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Content Freshness + pSEO (items #16 + #17) — flag registry restoration after content-pseo agent shipped the impl without registering the flag (caught by validate-feature-manifests 2026-05-28)
  content_freshness: { key: 'content_freshness', description: 'Daily Cron + Cloudflare Workflow scans sections for staleness (>90d) → Workers AI Llama rewrites → Task Inbox approval drafts', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  pseo_matrix_builder: { key: 'pseo_matrix_builder', description: 'pSEO matrix builder: service × city × intent × season with thin-content guardrail (≥800w / ≥3 images / LocalBusiness JSON-LD)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── IDEAS-50 wave 3: GEO + reputation + growth (3 + 9 + 10/11/13 + 18 + 32 + 34)
  search_engine_submit: { key: 'search_engine_submit', description: 'Auto-submit published sites to IndexNow (Bing+Yandex) + Bing/Google sitemap pings on publish', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  gbp_assist: { key: 'gbp_assist', description: 'One-click Google Business Profile setup + optimizer: detect, claim/create deep-link, AI SEO content pack + guided checklist', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  review_requests: { key: 'review_requests', description: 'AI-personalized review-request asks sent over email/SMS with a Google review deep-link', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  review_responder: { key: 'review_responder', description: 'AI on-brand reply drafts for customer reviews; human-reviewed, never auto-published', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  reputation_monitor: { key: 'reputation_monitor', description: 'Aggregate cross-platform rating/count + recent reviews; flags avg below 4.5 or count below 20', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  public_gallery: { key: 'public_gallery', description: 'Public, indexable gallery of opted-in published sites — social proof + pSEO + marketplace funnel', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  multimodal_intake: { key: 'multimodal_intake', description: 'PARKED pending product fit: booking-page photo + voice intake; AI extracts intent, prefills form, proposes a booking', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── #29 pSEO v2 (post-March-2026), #30 Integration Directory, #31 Comparison Pages, #32 Vertical Templates, #35 Public Changelog
  pseo_matrix_v2: { key: 'pseo_matrix_v2', description: 'pSEO v2: user-tasks (not keywords) + >=40% unique data floor per page from live Google Places, real reviews, real pricing. Cap 200 per axis.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  integration_directory: { key: 'integration_directory', description: 'Integration Directory: auto /integrations/{service-a}/{service-b} pages with real screenshots (Browser Rendering) + setup steps + JSON-LD', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  comparison_pages: { key: 'comparison_pages', description: 'Comparison + Alternative Pages Engine: /vs/{competitor} + /alternatives/{competitor} with weekly-refreshed real pricing + real screenshots', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  vertical_templates: { key: 'vertical_templates', description: 'Vertical specialization wave: hvac + personal-injury-law + nonprofit templates with vertical JSON-LD presets + service-page templates', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  public_changelog: { key: 'public_changelog', description: 'Build-in-public public changelog at /changelog with RSS feed + Listmonk webhook on publish (cron from conventional commits)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Domain & Logs (items #10 + #14)
  domain_stack_wizard: { key: 'domain_stack_wizard', description: 'One-click domain stack wizard: registrar → DNS → SSL → DMARC/SPF/DKIM/MX → security.txt → GSC (7-step state machine)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  log_explorer: { key: 'log_explorer', description: 'Worker tail log explorer: 30-day FTS + DSL search + cost attribution per route (worker_logs D1 table)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── #24 Unified Visitor Inbox + #25 Multimodal Site Copilot
  unified_inbox: { key: 'unified_inbox', description: 'Unified Visitor Inbox: forms+chat+voice+email+SMS under one identity, assignable, SLA-tracked, AI-drafted replies', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  multimodal_copilot: { key: 'multimodal_copilot', description: 'Multimodal AI Site Copilot: visitor photo+voice+text → intent extraction + autofill + booking', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── #5+#6+#7+#8 Swarm editor + live stream + Site DNA + section marketplace
  swarm_editor: { key: 'swarm_editor', description: '#5 Multi-Agent Swarm Editor: 7 specialists co-edit via file partition + SSE + conflict detection', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  live_stream_preview: { key: 'live_stream_preview', description: '#6 Live Component-Stream Preview: <app-progressive-preview> subscribes to swarm SSE and swaps skeleton → real components via View Transitions', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  site_dna_taste_graph: { key: 'site_dna_taste_graph', description: '#7 Site DNA Taste Graph: per-tenant accept/reject/edit feedback → BGE Vectorize embeddings → soft preference in build orchestrator', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  section_marketplace: { key: 'section_marketplace', description: '#8 Vertical Section Marketplace: curated bento sections per industry (nonprofit/restaurant/lawyer/salon/medical), 30 seed entries, admin UI at /admin/marketplace', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Native editor enforcement (rec #3 from 2026-05-28 close-the-loop) — was localStorage-only; now real server-side flag so killswitch works without redeploy
  native_editor: { key: 'native_editor', description: 'Phase-1 native Angular port of the bolt.diy editor at /admin/editor-native. Server-side flag-gated so admin can killswitch without redeploy.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── AI wave (ideas #1/#23/#24, 2026-05-28)
  review_synthesis: { key: 'review_synthesis', description: 'Synthesizes a site\'s verified Google reviews into a trust paragraph + AggregateRating JSON-LD (verified origin only, never fabricated).', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  email_deliverability_wizard: { key: 'email_deliverability_wizard', description: 'Email Deliverability Wizard (#12): checks a sending domain SPF, DKIM and DMARC via DNS-over-HTTPS and returns a 0-100 score plus concrete DNS fixes. Read-only, persists nothing.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  bulk_site_ops: { key: 'bulk_site_ops', description: 'Bulk Site Ops (#17): plan + apply a change (set_flag, republish, archive) across all owned sites at once. Ownership-filtered, per-op validity checked, batch-capped at 100. Preview-only for now (dryRun).', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  automation_builder: { key: 'automation_builder', description: 'Automation Builder (#11): no-code trigger->action recipes (Zapier-lite) per site. Allowlisted trigger/action types, validated + persisted; dispatch fires on platform events. CRUD at /api/sites/:siteId/recipes.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  outbound_webhooks: { key: 'outbound_webhooks', description: 'Outbound Webhooks (#10): customers subscribe their own https endpoints to site events; deliveries are signed (HMAC, replay-safe) + retried with backoff. Endpoint secret AES-GCM encrypted at rest. CRUD at /api/sites/:siteId/webhooks.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  seo_autopilot: { key: 'seo_autopilot', description: 'AI generates SEO/GEO meta (title 50-60, description 120-156, 40-60 word quotable answer block) + schema.org JSON-LD per route for existing sites. Owner approves drafts before they apply.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  conversational_editing: { key: 'conversational_editing', description: 'Natural-language site editing with reversible, parent-chained changesets. Undo is forward-only; history is preserved.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Marketplace + Creator Economy (ideas #39/#40/#41/#42 — 2026-05-28)
  plugin_marketplace: { key: 'plugin_marketplace', description: '#41 Plugin / integration marketplace: third-party integrations installable per site (Stripe, Calendly, MapBox, AI form-fill). 70/30 rev-share to creator.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_components: { key: 'ai_components', description: '#42 AI Code Components: describe a widget in natural language, get a production React component scaffolded with the site brand tokens auto-inherited from _brand.json.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Viral + Billing + Audit-Chain (ideas #33, #34, #36, #46 — 2026-05-28)
  referral_loop: { key: 'referral_loop', description: 'Built-in referral loop (Dropbox/Trello): unique invite codes, double-sided rewards (referrer +30d Pro, referee 30d free), k-coefficient dashboard.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  agency_white_label: { key: 'agency_white_label', description: 'White-label agency tier: agencies resell under their brand with custom domain, hostname-based chrome swap, Stripe Connect billing-of-record.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  stripe_marketplace: { key: 'stripe_marketplace', description: 'Stripe App Marketplace listing: stripe-app.json manifest + OAuth install callback so merchants can install projectsites from the Stripe dashboard.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Enterprise wave (Trust Center / Enterprise Plan / Stripe App status / Agent SDK+MCP, 2026-05-28)
  trust_center: { key: 'trust_center', description: 'Per-org and per-published-site Trust Center: AI models, content provenance, audit-log policy, data residency, AI-outage fallback. EU AI Act high-risk Aug 2 2026.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  enterprise_plan: { key: 'enterprise_plan', description: 'Enterprise plan tier with Cloudflare Access SSO (SAML/OIDC), 99.9% SLA monitoring, audit-log export, custom terms, dedicated Slack. Stripe + Access provisioning deferred to Brian.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  stripe_app_status: { key: 'stripe_app_status', description: 'Admin dashboard for Stripe App Marketplace installs (install analytics + lifecycle events). Manifest owned by the growth agent.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  agent_sdk_mcp: { key: 'agent_sdk_mcp', description: 'Public Agent SDK (@projectsites/sdk extension) + MCP server (@projectsites/mcp-server) so external agents (Claude Desktop/ChatGPT/Cursor) can drive the platform.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
};

export type FlagKey = keyof typeof FLAG_REGISTRY;

export function listFlags(): FlagDefinition[] {
  return Object.values(FLAG_REGISTRY);
}

export function getDefaultFlag(key: string): FlagDefinition | undefined {
  return FLAG_REGISTRY[key];
}
