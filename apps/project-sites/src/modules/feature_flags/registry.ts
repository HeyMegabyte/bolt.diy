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
  // Compete-or-die (items 1-8)
  multi_model_router: { key: 'multi_model_router', description: 'Multi-model picker (Opus/Sonnet/Workers AI/GPT-5) per prompt', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  db_provisioning: { key: 'db_provisioning', description: 'One-click Neon/Supabase Postgres provisioning per site', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  audit_hash_chain: { key: 'audit_hash_chain', description: 'SOC 2 immutable audit trail with hash-chain verification', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  github_sync: { key: 'github_sync', description: 'Two-way GitHub sync (commit-on-save + PR-per-branch)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  token_burn_meter: { key: 'token_burn_meter', description: 'Live token-burn meter in editor with monthly projection', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
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
};

export type FlagKey = keyof typeof FLAG_REGISTRY;

export function listFlags(): FlagDefinition[] {
  return Object.values(FLAG_REGISTRY);
}

export function getDefaultFlag(key: string): FlagDefinition | undefined {
  return FLAG_REGISTRY[key];
}
