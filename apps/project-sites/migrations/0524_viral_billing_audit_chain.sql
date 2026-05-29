-- Migration 0520 — Viral + Billing + Audit-Chain modules
--
-- Tables created:
--   referrals               — Each invite the referrer sends; tracked to conversion.
--   referral_rewards        — Granted credits/extensions (referrer + referee).
--   agency_tenants          — White-label agency reseller tenants.
--   stripe_marketplace_installs — Stripe App Marketplace OAuth installs per org.
--   audit_log_chain         — Hash-chain integrity for audit_logs (parallel ledger).
--   changelog_entries       — Admin-publishable build-in-public posts (#35 admin half).
--
-- Feature flags this migration enables:
--   referral_loop, agency_white_label, stripe_marketplace, audit_hash_chain (exists).
--
-- Idempotent: every CREATE uses IF NOT EXISTS.

-- ─── #33 Referral Loop ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id),
  referrer_org_id TEXT NOT NULL REFERENCES orgs(id),
  referee_email TEXT NOT NULL,
  referee_user_id TEXT REFERENCES users(id),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'clicked', 'signed_up', 'converted', 'expired')),
  source TEXT,                              -- e.g. 'email', 'link', 'social'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  clicked_at TEXT,
  signed_up_at TEXT,
  converted_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_code ON referrals(code);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  referral_id TEXT NOT NULL REFERENCES referrals(id),
  side TEXT NOT NULL CHECK (side IN ('referrer', 'referee')),
  type TEXT NOT NULL
    CHECK (type IN ('credit_cents', 'pro_days', 'credit_pack')),
  value_cents INTEGER NOT NULL DEFAULT 0,
  pro_days INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  redeemed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'expired', 'revoked'))
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_user ON referral_rewards(user_id, status);

-- ─── #34 White-Label Agency Tier ────────────────────────────────

CREATE TABLE IF NOT EXISTS agency_tenants (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  owner_org_id TEXT NOT NULL REFERENCES orgs(id),
  brand_name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT,                       -- hex e.g. #00E5FF
  custom_domain TEXT,                       -- e.g. studio.acmedesign.com
  stripe_account_id TEXT,                   -- Stripe Connect account
  support_email TEXT,
  tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'studio', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  activated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agency_tenants_owner ON agency_tenants(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_tenants_domain ON agency_tenants(custom_domain)
  WHERE custom_domain IS NOT NULL;

-- ─── #35 Build-in-Public Changelog (admin half) ────────────────

CREATE TABLE IF NOT EXISTS changelog_entries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  body_html TEXT,                           -- rendered cache
  category TEXT NOT NULL DEFAULT 'feature'
    CHECK (category IN ('feature', 'fix', 'perf', 'security', 'breaking', 'docs')),
  author_user_id TEXT REFERENCES users(id),
  published_at TEXT,                        -- NULL = draft
  unpublished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_changelog_published ON changelog_entries(published_at DESC)
  WHERE published_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_changelog_slug ON changelog_entries(slug);

-- ─── #36 Stripe Marketplace ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS stripe_marketplace_installs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  stripe_account_id TEXT NOT NULL,
  installer_user_id TEXT REFERENCES users(id),
  scopes_json TEXT,                         -- JSON array of granted scopes
  refresh_token_encrypted TEXT,             -- AES-GCM via MCP_ENCRYPTION_KEY
  refresh_token_iv TEXT,
  livemode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'uninstalled', 'revoked')),
  installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  uninstalled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_marketplace_account
  ON stripe_marketplace_installs(stripe_account_id);
CREATE INDEX IF NOT EXISTS idx_stripe_marketplace_org
  ON stripe_marketplace_installs(org_id, status);

-- ─── #46 Hash-Chained Audit Log ────────────────────────────────

-- Parallel ledger keyed by audit_logs.id. We don't modify audit_logs
-- to preserve the append-only contract — instead we chain on write via
-- the AuditChain service. Both rows are inserted in the same request.

CREATE TABLE IF NOT EXISTS audit_log_chain (
  audit_id TEXT PRIMARY KEY REFERENCES audit_logs(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  sequence INTEGER NOT NULL,                -- per-org monotonic sequence
  prev_hash TEXT NOT NULL,                  -- hex SHA-256, '0'*64 for genesis
  entry_hash TEXT NOT NULL,                 -- hex SHA-256(prev_hash || payload || ts)
  payload_canonical TEXT NOT NULL,          -- canonicalised JSON used as hash input
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_chain_org_seq
  ON audit_log_chain(org_id, sequence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_chain_org_seq
  ON audit_log_chain(org_id, sequence);
