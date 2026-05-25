-- 0037_pro_white_label_agents_templates_mcp_bandits.sql
--
-- Frontier feature foundation: Pro tier + White-Label + AI Agents + Templates
-- + MCP-per-site + A/B-test bandits + Predictive prerender + 100-feature
-- super-admin surface (announcements, impersonation, feature flags, audit,
-- discounts, refunds, broadcast, content moderation, AI governance).
--
-- Single migration so the whole frontier feature-set ships atomically. Every
-- table has the soft-delete/timestamp invariants. brian@megabyte.space gets
-- the `pro` flag here so the gated surfaces (Endpoints/Apps/Social/Voice)
-- light up immediately without a follow-up sync.
--
-- Cross-refs:
--   * Super-admin routes:        apps/project-sites/src/routes/super_admin.ts
--   * White-label routes:        apps/project-sites/src/routes/agency.ts (new)
--   * Agents routes:             apps/project-sites/src/routes/agents.ts (new)
--   * Templates routes:          apps/project-sites/src/routes/templates.ts (new)
--   * MCP-per-site routes:       apps/project-sites/src/routes/mcp.ts (new)
--   * Experiments routes:        apps/project-sites/src/routes/experiments.ts (new)
--   * Pro entitlement helper:    apps/project-sites/src/services/pro.ts (new)

-- ────────────────────────────────────────────────────────────────────────────
-- 1. PRO TIER — gates Endpoints / Apps / Social / Voice; flagged on user row
--    so wallet billing is independent of the Pro entitlement (a user can be
--    Pro without an active wallet subscription if comped by super-admin).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN is_pro INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pro_granted_at TEXT;
ALTER TABLE users ADD COLUMN pro_granted_by TEXT;     -- super_admin user_id or 'subscription'
ALTER TABLE users ADD COLUMN pro_grant_reason TEXT;   -- 'subscription' | 'comp' | 'lifetime' | 'beta'
ALTER TABLE users ADD COLUMN pro_expires_at TEXT;     -- NULL = no expiry (lifetime/sub)

CREATE INDEX IF NOT EXISTS idx_users_pro ON users(is_pro) WHERE is_pro = 1;

-- Brian is Pro on day 1 — single-user owner flag.
UPDATE users
   SET is_pro = 1,
       pro_granted_at = CURRENT_TIMESTAMP,
       pro_granted_by = 'system_seed',
       pro_grant_reason = 'lifetime'
 WHERE email = 'brian@megabyte.space';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. WHITE-LABEL / AGENCY — orgs can parent other orgs, override brand,
--    own a custom admin hostname, and route their own Stripe Connect payouts.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE orgs ADD COLUMN parent_org_id TEXT;              -- NULL = root org
ALTER TABLE orgs ADD COLUMN is_agency INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN agency_tier TEXT;                -- 'starter' | 'pro' | 'scale' | NULL
ALTER TABLE orgs ADD COLUMN brand_overrides_json TEXT;       -- {logoUrl,faviconUrl,primaryColor,accentColor,supportUrl,fromEmail,fromName,appName,hideBranding}
ALTER TABLE orgs ADD COLUMN custom_admin_hostname TEXT;      -- e.g. app.acme-studio.com
-- stripe_connect_account_id already added by an earlier migration; reuse the existing column.
ALTER TABLE orgs ADD COLUMN markup_pct REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orgs_parent ON orgs(parent_org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_admin_hostname ON orgs(custom_admin_hostname) WHERE custom_admin_hostname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_is_agency ON orgs(is_agency) WHERE is_agency = 1;

-- Per-org brand assets — uploaded once, served from R2, KV-cached at edge.
CREATE TABLE IF NOT EXISTS org_brand_assets (
  org_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,             -- 'logo' | 'favicon' | 'apple_icon' | 'og' | 'wordmark'
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER,
  uploaded_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, asset_type)
);

-- Agency invites a client by email; redemption creates a child org under the agency.
CREATE TABLE IF NOT EXISTS agency_invitations (
  id TEXT PRIMARY KEY,
  agency_org_id TEXT NOT NULL,
  client_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client_owner',
  preselected_template_id TEXT,
  token_hash TEXT NOT NULL,             -- sha256(token)
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agency_inv_agency ON agency_invitations(agency_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_inv_token ON agency_invitations(token_hash);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. AI AGENTS — per-site autonomous maintenance agents (link refresh,
--    content rotation, blog draft, image refresh, broken-link fix). Each
--    agent has a system prompt + tool whitelist + cron-style schedule.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  slug TEXT NOT NULL,                   -- 'link-doctor' | 'content-refresher' | 'blog-author' | etc.
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  tools_json TEXT NOT NULL DEFAULT '[]', -- ['fetch','d1_read','r2_write','sentry_read', ...]
  schedule_cron TEXT,                    -- '0 6 * * *' | NULL = on-demand only
  schedule_tz TEXT DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | error
  max_cost_cents_per_run INTEGER NOT NULL DEFAULT 50,
  monthly_budget_cents INTEGER NOT NULL DEFAULT 1000,
  spend_this_month_cents INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_run_status TEXT,                  -- ok | error | budget_exceeded
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agents_site ON agents(site_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_schedule ON agents(schedule_cron) WHERE schedule_cron IS NOT NULL AND status = 'active' AND deleted_at IS NULL;

-- Every agent invocation creates a row — durable replay record for audit.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  trigger TEXT NOT NULL,                 -- 'cron' | 'manual' | 'webhook' | 'sentry'
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | failed | timed_out
  input_json TEXT,
  output_json TEXT,
  error_message TEXT,
  tool_calls_json TEXT,                  -- array of {tool, args, result_status}
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, started_at DESC) WHERE status IN ('running', 'failed');

-- Agent memory — k/v scratchpad an agent can read/write across runs.
CREATE TABLE IF NOT EXISTS agent_memories (
  agent_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, key)
);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. TEMPLATES MARKETPLACE — a catalog of pre-built starts. Each template
--    has versions, a price (or free), and per-site usage tracking.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,                -- 'restaurant' | 'salon' | 'nonprofit' | 'saas' | 'portfolio' | ...
  tags_json TEXT DEFAULT '[]',
  author_org_id TEXT,                    -- NULL = platform-authored; non-NULL = community/agency
  thumbnail_r2_key TEXT,
  preview_url TEXT,
  base_files_r2_prefix TEXT NOT NULL,    -- e.g. templates/restaurant-modern/v3/
  price_cents INTEGER NOT NULL DEFAULT 0, -- 0 = free
  visibility TEXT NOT NULL DEFAULT 'public', -- public | unlisted | private
  status TEXT NOT NULL DEFAULT 'live',    -- draft | live | archived
  install_count INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category, visibility, status);
CREATE INDEX IF NOT EXISTS idx_templates_author ON templates(author_org_id);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version TEXT NOT NULL,                 -- semver
  changelog TEXT,
  files_r2_prefix TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_versions_unique ON template_versions(template_id, version);

CREATE TABLE IF NOT EXISTS template_installs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_version_id TEXT,
  site_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  price_paid_cents INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_template_installs_template ON template_installs(template_id, installed_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_installs_site ON template_installs(site_id);

-- Seed five starter templates so the gallery isn't empty on first load.
INSERT INTO templates (id, slug, name, description, category, base_files_r2_prefix, price_cents) VALUES
  ('tpl_restaurant_modern',  'restaurant-modern',  'Restaurant — Modern',  'Cinematic restaurant template with menu, reservations, gallery.', 'restaurant', 'templates/restaurant-modern/v1/',  0),
  ('tpl_salon_premium',      'salon-premium',      'Salon — Premium',      'Premium salon template with booking, services, team showcase.',   'salon',      'templates/salon-premium/v1/',      0),
  ('tpl_nonprofit_warm',     'nonprofit-warm',     'Non-profit — Warm',    'Donation-first nonprofit template with impact counters + stories.','nonprofit',  'templates/nonprofit-warm/v1/',     0),
  ('tpl_saas_aurora',        'saas-aurora',        'SaaS — Aurora',        'Bold dark-first SaaS template with pricing, features, social proof.','saas',     'templates/saas-aurora/v1/',        0),
  ('tpl_portfolio_minimal',  'portfolio-minimal',  'Portfolio — Minimal',  'Editorial portfolio template — typographic, project-grid focused.','portfolio',  'templates/portfolio-minimal/v1/',  0);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. MCP PER-SITE — every customer site exposes an MCP server so AI agents
--    (ChatGPT, Claude, Perplexity) can transact directly. Tools are per-site,
--    site-type-defaulted, super-admin-overridable.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,               -- 'search_content' | 'get_business_hours' | 'book_appointment' | etc.
  handler_kind TEXT NOT NULL,            -- maps to services/mcp_handlers/*.ts
  schema_json TEXT NOT NULL,             -- JSON Schema for inputs
  requires_auth INTEGER NOT NULL DEFAULT 0,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_site_name ON mcp_tools(site_id, tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_enabled ON mcp_tools(site_id, enabled);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  called_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  agent_user_agent TEXT,
  agent_client_id TEXT,
  result_status TEXT NOT NULL,           -- ok | error | rate_limited | unauthorized
  latency_ms INTEGER,
  request_id TEXT,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_site_time ON mcp_calls(site_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_status ON mcp_calls(site_id, result_status, called_at DESC);

-- Per-site MCP OAuth audience tokens (audience-bound per RFC 8707).
CREATE TABLE IF NOT EXISTS mcp_resource_tokens (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  client_id TEXT,                        -- CIMD URL or DCR client_id
  scope TEXT NOT NULL,                   -- 'site:read' | 'bookings:write'
  token_hash TEXT NOT NULL,              -- sha256
  audience TEXT NOT NULL,                -- e.g. https://{slug}.projectsites.dev/mcp
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_resource_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_site ON mcp_resource_tokens(site_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. A/B TEST BANDITS (Thompson Sampling) + session events for predictive
--    prerender. Both flow through the same /_ps/ beacon endpoint so we get
--    one analytics ingestion path.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hypothesis TEXT,
  surface TEXT NOT NULL,                 -- 'hero_headline' | 'hero_cta' | 'accent_color' | 'pricing_order' | ...
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | running | promoted | archived
  lookback_days INTEGER NOT NULL DEFAULT 7,
  promote_threshold REAL NOT NULL DEFAULT 0.95,
  promoted_variant_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_experiments_site ON experiments(site_id, status);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,            -- {copy:"...", color:"#...", imageUrl:"..."}
  weight REAL NOT NULL DEFAULT 1,
  beta_alpha REAL NOT NULL DEFAULT 1,    -- Beta prior — successes + 1
  beta_beta REAL NOT NULL DEFAULT 1,     -- Beta prior — failures + 1
  is_control INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_variants_experiment ON variants(experiment_id);

CREATE TABLE IF NOT EXISTS impressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_impressions_exp ON impressions(experiment_id, variant_id, ts);
CREATE INDEX IF NOT EXISTS idx_impressions_visitor ON impressions(visitor_id, ts);

CREATE TABLE IF NOT EXISTS conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  value_cents INTEGER DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'click',    -- click | form | booking | purchase
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversions_exp ON conversions(experiment_id, variant_id, ts);

CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- nav | scroll | hover | click | dwell
  dwell_ms INTEGER,
  scroll_pct INTEGER,
  viewport_w INTEGER,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_session_events_site_path ON session_events(site_id, path, ts);

-- Predictive prerender training cache — visitor session signature → predicted next routes.
CREATE TABLE IF NOT EXISTS prerender_predictions (
  visitor_signature TEXT PRIMARY KEY,    -- sha256(visitor_id + last10paths)
  site_id TEXT NOT NULL,
  predictions_json TEXT NOT NULL,        -- [{path, prob}]
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prerender_site ON prerender_predictions(site_id, expires_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. SUPER-ADMIN EXTENSIONS — 100-feature surface:
--    coupons, refunds, comps, broadcasts, announcements, feature flags,
--    impersonation, audit, content moderation queue, AI guardrails.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                    -- pct | flat | comp_months
  amount INTEGER NOT NULL,               -- 10 (=10%), 500 (=$5), 1 (=1 month)
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  stripe_coupon_id TEXT,
  expires_at TEXT,
  applies_to TEXT NOT NULL DEFAULT 'all',-- all | pro | wallet_topup | template
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(expires_at);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,                  -- requested_by_customer | duplicate | fraudulent | other
  notes TEXT,
  initiated_by TEXT NOT NULL,            -- super_admin user_id
  status TEXT NOT NULL DEFAULT 'pending',-- pending | succeeded | failed
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refunds_org ON refunds(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,                 -- email | banner | in_app
  segment_json TEXT NOT NULL,            -- {role?, is_pro?, has_site?, country?, ...}
  subject TEXT,
  body_md TEXT NOT NULL,
  cta_label TEXT,
  cta_url TEXT,
  scheduled_at TEXT,
  sent_at TEXT,
  recipient_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled ON broadcasts(scheduled_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',     -- info | warning | maintenance | release
  active INTEGER NOT NULL DEFAULT 1,
  shows_in TEXT NOT NULL DEFAULT 'admin',-- admin | marketing | both
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT,
  enabled_globally INTEGER NOT NULL DEFAULT 0,
  rollout_pct REAL NOT NULL DEFAULT 0,   -- 0..100
  kill_switch INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-org override of a feature flag.
CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  flag_key TEXT NOT NULL,
  org_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  set_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (flag_key, org_id)
);

-- Super-admin can impersonate any user; every session is logged + capped.
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id TEXT PRIMARY KEY,
  super_admin_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_org_id TEXT,
  mode TEXT NOT NULL DEFAULT 'read',     -- read | write
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_impersonation_open ON impersonation_sessions(super_admin_user_id, started_at DESC);

-- Append-only ledger of every super-admin write action.
CREATE TABLE IF NOT EXISTS super_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,                  -- 'cost_factor_update' | 'wallet_adjust' | 'impersonate_start' | 'coupon_create' | 'broadcast_send' | ...
  target_kind TEXT,                      -- 'org' | 'user' | 'site' | 'cost_category' | ...
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_super_admin_audit_actor ON super_admin_audit(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_audit_target ON super_admin_audit(target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_super_admin_audit_action ON super_admin_audit(action, created_at DESC);

-- Content moderation: AI-generated sites + flagged uploads queue for review.
CREATE TABLE IF NOT EXISTS moderation_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                    -- 'site' | 'image' | 'prompt' | 'form_submission'
  reference_id TEXT NOT NULL,
  org_id TEXT,
  reason TEXT NOT NULL,                  -- 'ai_flag' | 'user_report' | 'dmca' | 'safety_classifier'
  severity TEXT NOT NULL DEFAULT 'low',  -- low | medium | high | critical
  status TEXT NOT NULL DEFAULT 'open',   -- open | resolved | escalated | dismissed
  reporter_id TEXT,
  resolver_id TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_moderation_open ON moderation_queue(status, severity, created_at DESC) WHERE status = 'open';

-- AI prompt blocklist editable by super-admin (regex patterns + semantic embeddings).
CREATE TABLE IF NOT EXISTS ai_blocklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  pattern_kind TEXT NOT NULL DEFAULT 'regex', -- regex | substring | embedding_id
  reason TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  added_by TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Free-form tags applied to orgs (cohort/segment).
CREATE TABLE IF NOT EXISTS org_tags (
  org_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  tagged_by TEXT,
  tagged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_org_tags_tag ON org_tags(tag);

-- Per-route rate-limit override — surface in super-admin to handle abuse / large customers.
CREATE TABLE IF NOT EXISTS rate_limit_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT,
  route_pattern TEXT NOT NULL,
  limit_per_min INTEGER NOT NULL,
  reason TEXT,
  set_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rl_overrides_org ON rate_limit_overrides(org_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. STRIPE PAY-PER-USAGE METER MAP — links cost_category slugs to Stripe
--    Billing Meters so the nightly aggregator pushes usage records.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stripe_meter_map (
  cost_category_slug TEXT PRIMARY KEY,
  stripe_meter_id TEXT NOT NULL,
  stripe_meter_event_name TEXT NOT NULL,
  stripe_price_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotency dedupe for Stripe usage records pushed by the nightly cron.
CREATE TABLE IF NOT EXISTS stripe_usage_pushes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  cost_category_slug TEXT NOT NULL,
  period_day TEXT NOT NULL,              -- YYYY-MM-DD bucket
  quantity REAL NOT NULL,
  stripe_event_id TEXT,
  pushed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (org_id, cost_category_slug, period_day)
);
CREATE INDEX IF NOT EXISTS idx_stripe_usage_pushed ON stripe_usage_pushes(pushed_at DESC);
