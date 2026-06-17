-- Migration 0565: native_booking_engine, credit_wallet_rollover, and referral_loop tables + flag seeds

CREATE TABLE IF NOT EXISTS booking_slots (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  site_id    TEXT NOT NULL,
  start_at   TEXT NOT NULL,
  end_at     TEXT NOT NULL,
  capacity   INTEGER DEFAULT 1,
  booked     INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS booking_appointments (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  slot_id      TEXT NOT NULL,
  guest_name   TEXT NOT NULL,
  guest_email  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled')),
  notes        TEXT,
  created_at   TEXT,
  updated_at   TEXT,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS credit_wallet_ledger (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  amount_credits  INTEGER NOT NULL,
  direction       TEXT NOT NULL CHECK(direction IN ('credit','debit')),
  reason          TEXT NOT NULL,
  ref_id          TEXT,
  created_at      TEXT
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  clicks      INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS referral_attributions (
  id               TEXT PRIMARY KEY,
  referral_code_id TEXT NOT NULL,
  referred_org_id  TEXT,
  status           TEXT NOT NULL DEFAULT 'click' CHECK(status IN ('click','signup','converted')),
  converted_at     TEXT,
  created_at       TEXT
);

INSERT OR IGNORE INTO feature_flags (key, enabled, rollout_percent, stage, description, owner_email)
VALUES (
  'native_booking_engine',
  0,
  0,
  'experimental',
  'Native appointment booking for sites. Orgs define available slots; guests book by email. Replaces external Calendly embeds with a first-party booking flow per site.',
  'brian@megabyte.space'
);

INSERT OR IGNORE INTO feature_flags (key, enabled, rollout_percent, stage, description, owner_email)
VALUES (
  'credit_wallet_rollover',
  0,
  0,
  'experimental',
  'In-platform credit wallet for orgs. Credits are earned via referrals or promotions and spent on platform features. Ledger tracks every credit and debit with a reason and optional reference ID.',
  'brian@megabyte.space'
);

INSERT OR IGNORE INTO feature_flags (key, enabled, rollout_percent, stage, description, owner_email)
VALUES (
  'referral_loop',
  0,
  0,
  'experimental',
  'Viral referral system giving each org a unique referral code. When a referred org upgrades to paid the referrer receives a platform credit. Tracks clicks, signups, and conversions per code.',
  'brian@megabyte.space'
);
