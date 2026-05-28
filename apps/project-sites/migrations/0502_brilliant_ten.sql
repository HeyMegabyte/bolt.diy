-- Migration 0502 — 10 brilliant features schema.
-- Idempotent (IF NOT EXISTS). Safe to re-apply.

-- #1 Site-as-MCP-server — per-site MCP tool registry
CREATE TABLE IF NOT EXISTS site_mcp_subscriptions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_mcp_subs_site ON site_mcp_subscriptions (site_id);

-- #2 Cold-tier auto-thaw — track idle + archive + thaw
CREATE TABLE IF NOT EXISTS cold_tier_state (
  site_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('warm', 'cooling', 'frozen', 'thawing')),
  last_active_at TEXT NOT NULL,
  archived_at TEXT,
  thawed_at TEXT,
  r2_archive_key TEXT,
  thaw_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- #3 AI auto-router — track routing decisions for retrospective tuning
CREATE TABLE IF NOT EXISTS ai_router_decisions (
  id TEXT PRIMARY KEY,
  prompt_shape TEXT NOT NULL,
  picked_model TEXT NOT NULL,
  org_id TEXT,
  prompt_length INTEGER,
  classification_confidence REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_router_org_created ON ai_router_decisions (org_id, created_at);

-- #4 Ghost routes — track which non-existent paths visitors hit + the auto-gen result
CREATE TABLE IF NOT EXISTS ghost_routes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hit_count INTEGER DEFAULT 1,
  first_hit_at TEXT NOT NULL,
  last_hit_at TEXT NOT NULL,
  generated_at TEXT,
  r2_key TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'rejected')),
  UNIQUE (site_id, path)
);
CREATE INDEX IF NOT EXISTS idx_ghost_routes_site_status ON ghost_routes (site_id, status);

-- #5 Speed-compare widget — per-comparison results
CREATE TABLE IF NOT EXISTS speed_compare_runs (
  id TEXT PRIMARY KEY,
  customer_site TEXT NOT NULL,
  competitor_url TEXT NOT NULL,
  customer_lcp_ms INTEGER,
  competitor_lcp_ms INTEGER,
  customer_inp_ms INTEGER,
  competitor_inp_ms INTEGER,
  customer_score INTEGER,
  competitor_score INTEGER,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_speed_compare_customer ON speed_compare_runs (customer_site, created_at);

-- #6 Auto-gen static files — track which of the 50 files exist per site
CREATE TABLE IF NOT EXISTS auto_gen_files (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT,
  generated_at TEXT,
  ttl_seconds INTEGER DEFAULT 2592000,
  byte_size INTEGER,
  source_data_hash TEXT,
  UNIQUE (site_id, filename)
);
CREATE INDEX IF NOT EXISTS idx_auto_gen_files_site ON auto_gen_files (site_id);

-- #7 Hallucination guard — flagged claims awaiting citation
CREATE TABLE IF NOT EXISTS hallucination_flags (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  page_route TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('cited', 'flagged', 'fabricated')),
  source_ref TEXT,
  confidence REAL,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hallucination_site_status ON hallucination_flags (site_id, classification);

-- #8 Visitor recognition — anon session DO mirror (lightweight; full state in DO)
CREATE TABLE IF NOT EXISTS visitor_sessions (
  anon_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  visit_count INTEGER DEFAULT 1,
  segment TEXT,
  city TEXT,
  country TEXT,
  source TEXT,
  preferences_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitor_site_last_seen ON visitor_sessions (site_id, last_seen_at);

-- #9 FAQ-from-tickets — clustered support tickets → FAQ drafts
CREATE TABLE IF NOT EXISTS faq_drafts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  cluster_size INTEGER NOT NULL,
  source_ticket_ids_json TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'rejected')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_faq_drafts_site_status ON faq_drafts (site_id, status);

-- #10 Competitor monitor — daily competitor scans + counter-ship drafts
CREATE TABLE IF NOT EXISTS competitor_alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  competitor_url TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('new_section', 'pricing_change', 'feature_ship', 'redesign')),
  diff_summary TEXT NOT NULL,
  counter_draft_id TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'shipped', 'dismissed')),
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competitor_alerts_org_status ON competitor_alerts (org_id, status);
