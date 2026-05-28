-- ALL-STAR consolidated schema — categories A-J + gap surface.
-- Each table is idempotent via IF NOT EXISTS; safe to re-apply.

-- A1: SOC 2 audit chain
CREATE TABLE IF NOT EXISTS audit_chain (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_chain_org_created ON audit_chain (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_chain_prev_hash ON audit_chain (prev_hash);

-- A2: token meter + snapshot rollback
CREATE TABLE IF NOT EXISTS token_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  usd_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_events_org_created ON token_events (org_id, created_at);

CREATE TABLE IF NOT EXISTS site_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  label TEXT NOT NULL,
  diff_summary TEXT NOT NULL,
  parent_snapshot_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_snapshots_site_created ON site_snapshots (site_id, created_at);

-- B: agency tier + egress rules + white-label branding
CREATE TABLE IF NOT EXISTS agency_clients (
  id TEXT PRIMARY KEY,
  agency_org_id TEXT NOT NULL,
  client_org_id TEXT NOT NULL,
  markup_multiplier REAL DEFAULT 1.0,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS egress_rules (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_egress_rules_org ON egress_rules (org_id);

CREATE TABLE IF NOT EXISTS wlabel_branding (
  org_id TEXT PRIMARY KEY,
  primary_color TEXT,
  logo_url TEXT,
  name TEXT,
  custom_admin_domain TEXT,
  manifest_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wlabel_branding_domain ON wlabel_branding (custom_admin_domain);

-- C: CWV gate + RUM telemetry
CREATE TABLE IF NOT EXISTS cwv_gate_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  lcp_ms INTEGER NOT NULL,
  cls REAL NOT NULL,
  inp_ms INTEGER NOT NULL,
  passing INTEGER NOT NULL,
  failures_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cwv_gate_runs_site_created ON cwv_gate_runs (site_id, created_at);

CREATE TABLE IF NOT EXISTS rum_events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  route TEXT NOT NULL,
  lcp REAL,
  cls REAL,
  inp REAL,
  loaf_json TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rum_events_site_route_created ON rum_events (site_id, route, created_at);

-- D: GEO visibility + cornerstone refresh
CREATE TABLE IF NOT EXISTS geo_tracked_queries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  frequency TEXT DEFAULT 'daily',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_queries_org ON geo_tracked_queries (org_id);

CREATE TABLE IF NOT EXISTS geo_visibility_results (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  cited INTEGER NOT NULL,
  position INTEGER,
  citation_url TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_results_query_captured ON geo_visibility_results (query_id, captured_at);

CREATE TABLE IF NOT EXISTS cornerstone_pages (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  route TEXT NOT NULL,
  last_refresh_at TEXT,
  next_refresh_at TEXT,
  runs_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (site_id, route)
);
CREATE INDEX IF NOT EXISTS idx_cornerstone_site ON cornerstone_pages (site_id);

-- E: axe gate + alt-text overrides + WCAG 2.2 attestations
CREATE TABLE IF NOT EXISTS axe_gate_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  passing INTEGER NOT NULL,
  violations_json TEXT NOT NULL,
  viewports_tested TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_axe_gate_runs_site_created ON axe_gate_runs (site_id, created_at);

CREATE TABLE IF NOT EXISTS alt_text_overrides (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  original_ai_alt TEXT,
  override_alt TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wcag22_attestations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  criterion TEXT NOT NULL,
  verified INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- F: editor section maps + review tokens
CREATE TABLE IF NOT EXISTS editor_section_maps (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_file TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (site_id, section_id)
);

CREATE TABLE IF NOT EXISTS review_tokens (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  agency_org_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  decision TEXT
);

-- G: meters + referrals + cost attribution + campaigns
CREATE TABLE IF NOT EXISTS meter_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  value REAL NOT NULL,
  identifier TEXT NOT NULL UNIQUE,
  stripe_event_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_ledger (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  referee_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upsell_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  trigger_expr TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- H: observability (OTLP + SLO + tenant Sentry)
CREATE TABLE IF NOT EXISTS otlp_spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otlp_spans_trace ON otlp_spans (trace_id);

CREATE TABLE IF NOT EXISTS slo_definitions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  route TEXT NOT NULL,
  availability_target REAL NOT NULL,
  p99_latency_ms_target INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_sentry_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

-- I: media generation
CREATE TABLE IF NOT EXISTS veo_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  cost_usd_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS podcast_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  page_id TEXT,
  duration_s INTEGER NOT NULL,
  model TEXT NOT NULL,
  r2_key TEXT,
  transcript TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS style_refs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  image_r2_keys_json TEXT NOT NULL,
  locked_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_kits (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  assets_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- J: gap surface (push, manifest overrides)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS pwa_manifest_overrides (
  org_id TEXT PRIMARY KEY,
  name TEXT,
  short_name TEXT,
  theme_color TEXT,
  background_color TEXT,
  screenshots_json TEXT,
  shortcuts_json TEXT,
  updated_at TEXT NOT NULL
);
