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
  core_billing: { key: 'core_billing', description: 'Always-on sentinel: Stripe billing surface (checkout + subscriptions + entitlements + portal + donation payouts). isFlagOn always true.', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // ── Alias sentinel keys — thin manifest dirs that alias an already-canonical manifest.
  //    Created so that e2e/_fortress/<slug>/ directories have a matching libs/features/<slug>/
  //    and the drift validator's TEST_NOT_LINKED check resolves.
  alias_inbox: { key: 'alias_inbox', description: 'Alias dir for _fortress/inbox → libs/features/unified_inbox. Resolves TEST_NOT_LINKED drift warning.', default_enabled: false, default_rollout_percent: 0, stage: 'deprecated', owner_email: 'brian@megabyte.space' },
  // Compete-or-die (items 1-8)
  token_burn_meter: { key: 'token_burn_meter', description: 'Live token-burn meter in editor with monthly projection', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  contacts_core: { key: 'contacts_core', description: 'Shared contacts/CRM core — one person/lead store every capture surface dedupes into via recordContact()', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  site_analytics: { key: 'site_analytics', description: 'Owner-facing per-site analytics summary aggregating contacts, form submissions, newsletter subs and donations', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  visitor_events_core: { key: 'visitor_events_core', description: 'Public pageview/click/conversion beacon ingest from published sites; feeds site_analytics traffic block', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  email_marketing: { key: 'email_marketing', description: 'Real newsletter-campaign send to consented contacts + confirmed subscribers via Resend (replaces the stub recipient count)', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  data_export: { key: 'data_export', description: 'Owner data portability — export org contacts as RFC4180 CSV with OWASP CSV-injection neutralization', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // Multi-tenant + agency (items 9-13)
  // CWV (items 14-19, 15 already shipped)
  speculation_rules: { key: 'speculation_rules', description: 'Speculation Rules auto-injection on marketing HTML', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // GEO (items 20-24, 20-22 already stable)
  structured_data_autopilot: { key: 'structured_data_autopilot', description: 'Auto-emit Org+WebSite+WebPage+FAQPage JSON-LD', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  quotable_answer_block: { key: 'quotable_answer_block', description: 'AI-search-optimized 40-60 word quotable block per page', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  llms_txt: { key: 'llms_txt', description: '/llms.txt + /llms-full.txt + AI-crawler robots.txt', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // Accessibility (items 25-29, 29 stable)
  accessibility_statement: { key: 'accessibility_statement', description: '/accessibility page with WCAG 2.2 + IRS §44 explainer', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // Editor UX (items 30-34)
  // Monetization (items 35-38)
  // Observability (items 39-42)
  // Media gen (items 43-46)
  // Platform extension (items 47-50, 47 + 48-slice + 49-slice already stable)
  mcp_server: { key: 'mcp_server', description: '/.well-known/mcp + OAuth 2.1 RFC 8707 resource discovery', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  public_api: { key: 'public_api', description: 'Public REST + GraphQL API + OpenAPI 3.1 + webhooks', default_enabled: true, default_rollout_percent: 100, stage: 'stable', owner_email: 'brian@megabyte.space' },
  // Gap surface (re-folded back from the trim pass)
  pwa_manifest_full: { key: 'pwa_manifest_full', description: 'PWA manifest with screenshots + shortcuts + share_target', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── 10 brilliant — site-as-MCP, cold-tier, AI-auto-router, ghost-routes, speed-compare, auto-gen-files, hallucination-guard, visitor-recognition, faq-from-tickets, competitor-monitor
  site_mcp_server: { key: 'site_mcp_server', description: 'Per-customer-site MCP server — Siri/Claude/Cursor query the site directly', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  ai_auto_router: { key: 'ai_auto_router', description: 'Workload-aware AI model auto-router — simple=Workers AI free, complex=Opus, creative=Sonnet', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Round-2 top-5 admin upgrades
  // ── 30 big-bet features
  // ── IDE + multi-agent + progressive build (3 new flags)
  // ── Content Freshness + pSEO (items #16 + #17) — flag registry restoration after content-pseo agent shipped the impl without registering the flag (caught by validate-feature-manifests 2026-05-28)
  // ── IDEAS-50 wave 3: GEO + reputation + growth (3 + 9 + 10/11/13 + 18 + 32 + 34)
  search_engine_submit: { key: 'search_engine_submit', description: 'Auto-submit published sites to IndexNow (Bing+Yandex) + Bing/Google sitemap pings on publish', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  gbp_assist: { key: 'gbp_assist', description: 'One-click Google Business Profile setup + optimizer: detect, claim/create deep-link, AI SEO content pack + guided checklist', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── #29 pSEO v2 (post-March-2026), #30 Integration Directory, #31 Comparison Pages, #32 Vertical Templates, #35 Public Changelog
  pseo_matrix_v2: { key: 'pseo_matrix_v2', description: 'pSEO v2: user-tasks (not keywords) + >=40% unique data floor per page from live Google Places, real reviews, real pricing. Cap 200 per axis. Covers comparison/alternative + integration-directory page sets.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Domain & Logs (items #10 + #14)
  // ── #24 Unified Visitor Inbox + #25 Multimodal Site Copilot
  unified_inbox: { key: 'unified_inbox', description: 'Unified Visitor Inbox: forms+chat+voice+email+SMS under one identity, assignable, SLA-tracked, AI-drafted replies', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── #5+#6+#7+#8 Swarm editor + live stream + Site DNA + section marketplace
  section_marketplace: { key: 'section_marketplace', description: '#8 Vertical Section Marketplace: curated bento sections per industry (nonprofit/restaurant/lawyer/salon/medical), 30 seed entries, admin UI at /admin/marketplace', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Native editor enforcement (rec #3 from 2026-05-28 close-the-loop) — was localStorage-only; now real server-side flag so killswitch works without redeploy
  // ── AI wave (ideas #1/#23/#24, 2026-05-28)
  email_deliverability_wizard: { key: 'email_deliverability_wizard', description: 'Email Deliverability Wizard (#12): checks a sending domain SPF, DKIM and DMARC via DNS-over-HTTPS and returns a 0-100 score plus concrete DNS fixes. Read-only, persists nothing.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  outbound_webhooks: { key: 'outbound_webhooks', description: 'Outbound Webhooks (#10): customers subscribe their own https endpoints to site events; deliveries are signed (HMAC, replay-safe) + retried with backoff. Endpoint secret AES-GCM encrypted at rest. CRUD at /api/sites/:siteId/webhooks.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  seo_autopilot: { key: 'seo_autopilot', description: 'AI generates SEO/GEO meta (title 50-60, description 120-156, 40-60 word quotable answer block) + schema.org JSON-LD per route for existing sites. Owner approves drafts before they apply. Includes scheduled content-freshness rewrites of stale sections.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Marketplace + Creator Economy (ideas #39/#40/#41/#42 — 2026-05-28)
  // ── Viral + Billing + Audit-Chain (ideas #33, #34, #36, #46 — 2026-05-28)
  // ── Enterprise wave (Trust Center / Enterprise Plan / Stripe App status / Agent SDK+MCP, 2026-05-28)
  trust_center: { key: 'trust_center', description: 'Per-org and per-published-site Trust Center: AI models, content provenance, audit-log policy, data residency, AI-outage fallback. EU AI Act high-risk Aug 2 2026.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
  // ── Compliance / safety / revenue (added 2026-06-07 per UNFINISHED_FEATURES §9b)
  abuse_takedown: { key: 'abuse_takedown', description: 'Abuse report intake + content takedown workflow for published sites (DMCA / illegal-content handling). Hosting-platform necessity.', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: 'brian@megabyte.space' },
};

export type FlagKey = keyof typeof FLAG_REGISTRY;

export function listFlags(): FlagDefinition[] {
  return Object.values(FLAG_REGISTRY);
}

export function getDefaultFlag(key: string): FlagDefinition | undefined {
  return FLAG_REGISTRY[key];
}
