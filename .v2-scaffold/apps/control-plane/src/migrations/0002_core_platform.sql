-- 0002_core_platform.sql
-- Platform tables read/written by every control-plane route. Mirrors ARCHITECTURE.md § 4.1.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  org_id TEXT,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  stripe_account_id TEXT,
  d1_database_id TEXT,
  d1_database_name TEXT,
  primary_hostname TEXT,
  default_currency TEXT NOT NULL DEFAULT 'usd',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  d1_database_id TEXT,
  worker_name TEXT,
  primary_hostname TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);

CREATE TABLE IF NOT EXISTS hostnames (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  cf_hostname_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  permissions_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  accepted_at TEXT,
  invited_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_state (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_email TEXT,
  tenant_id TEXT,
  event TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS connected_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0,
  default_currency TEXT,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  metadata_json TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON quotes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  quote_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_for TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  booking_id TEXT,
  crew_id TEXT,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_for TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON jobs(tenant_id, scheduled_for ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_crew ON jobs(crew_id, scheduled_for ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id, scheduled_for ASC);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  access_ciphertext TEXT NOT NULL,
  access_iv TEXT NOT NULL,
  refresh_ciphertext TEXT,
  refresh_iv TEXT,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, provider) ON CONFLICT REPLACE
);
