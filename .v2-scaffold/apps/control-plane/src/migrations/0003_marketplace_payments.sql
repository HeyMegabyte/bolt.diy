-- 0003_marketplace_payments.sql
-- Wave 1E Marketplace + Payments tables — backlog items 16, 19, 20, 24, 36, 38.
-- (Items 17, 25, 29, 33 are computed on-the-fly or routed through Stripe Connect.)

-- Item #16 — dispatch state tracked by the AI dispatch optimizer DO. The DO holds
-- transient assignment proposals; this table persists historical assignments so we
-- can audit greedy-nearest-neighbor decisions + retrain heuristics.
CREATE TABLE IF NOT EXISTS dispatch_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  crew_id TEXT NOT NULL,
  distance_m REAL NOT NULL,
  crew_rating REAL,
  score REAL NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_dispatch_tenant ON dispatch_assignments(tenant_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_job ON dispatch_assignments(job_id);

-- Item #19 — GPS+EXIF photo verification. Server-signed chain-of-custody record.
CREATE TABLE IF NOT EXISTS job_photos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  uploader_user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy_m REAL,
  captured_at TEXT,
  server_signed_at TEXT NOT NULL,
  server_signature TEXT NOT NULL,
  exif_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id, server_signed_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_photos_tenant ON job_photos(tenant_id, server_signed_at DESC);

-- Item #20 — Background-check verification statuses. One row per crew member;
-- 4 separate pill statuses tracked.
CREATE TABLE IF NOT EXISTS crew_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  crew_user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'persona',
  inquiry_id TEXT,
  id_status TEXT NOT NULL DEFAULT 'pending',
  background_status TEXT NOT NULL DEFAULT 'pending',
  insurance_status TEXT NOT NULL DEFAULT 'pending',
  bonded_status TEXT NOT NULL DEFAULT 'pending',
  metadata_json TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, crew_user_id)
);
CREATE INDEX IF NOT EXISTS idx_crew_verif_tenant ON crew_verifications(tenant_id);

-- Item #24 — Loyalty discount tracking. A flat ledger so we can audit which
-- bookings actually received the 5%-off application_fee reduction.
CREATE TABLE IF NOT EXISTS loyalty_completions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  crew_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  discount_applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_loyalty_pair ON loyalty_completions(tenant_id, customer_id, crew_id, completed_at DESC);

-- Item #36 — Meter-alert dedupe. One row per (tenant, period) so the daily cron
-- only fires the 80% email once per billing period.
CREATE TABLE IF NOT EXISTS meter_alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  threshold_pct INTEGER NOT NULL DEFAULT 80,
  usage_at_alert INTEGER NOT NULL,
  projected_overage_cents INTEGER NOT NULL DEFAULT 0,
  meter_alert_sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, period_start, threshold_pct)
);

-- Extend subscriptions with pause + nonprofit discount fields (idempotent).
-- D1 SQLite supports ALTER TABLE ADD COLUMN.
ALTER TABLE subscriptions ADD COLUMN paused_until INTEGER;
ALTER TABLE subscriptions ADD COLUMN pause_started_at TEXT;
ALTER TABLE subscriptions ADD COLUMN discount_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN nonprofit_ein TEXT;
ALTER TABLE subscriptions ADD COLUMN nonprofit_verified_at TEXT;

-- Tenant-level usage counter for meter-alert cron.
CREATE TABLE IF NOT EXISTS tenant_usage_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  included INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  overage_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_tenant_usage ON tenant_usage_periods(tenant_id, period_start DESC);

-- Crew profile augmentation for dispatch optimizer (rating + last GPS).
ALTER TABLE team_members ADD COLUMN rating REAL;
ALTER TABLE team_members ADD COLUMN last_lat REAL;
ALTER TABLE team_members ADD COLUMN last_lng REAL;
ALTER TABLE team_members ADD COLUMN last_ping_at TEXT;
ALTER TABLE team_members ADD COLUMN online_status TEXT NOT NULL DEFAULT 'offline';

-- Job augmentation for dispatch optimizer (origin coords for haversine).
ALTER TABLE jobs ADD COLUMN origin_lat REAL;
ALTER TABLE jobs ADD COLUMN origin_lng REAL;
