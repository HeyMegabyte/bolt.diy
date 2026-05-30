-- Contacts Core (CRM) — shared person/lead entity.
-- The single contact store that unified_inbox, gbp_assist, review_synthesis,
-- reputation, donations_engine (donors), referral_loop and affiliate_program
-- all read/write through `recordContact()` instead of each forking its own table.
-- Additive + idempotent indexes. D1 has no `ADD COLUMN IF NOT EXISTS`, so the
-- CREATE TABLE runs once per environment.

CREATE TABLE IF NOT EXISTS contacts (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  site_id         TEXT,                                   -- nullable: org-level contacts have no site
  email           TEXT,
  phone           TEXT,                                   -- E.164 when present
  name            TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',         -- inbox|gbp|donation|referral|affiliate|review|booking|manual
  tags            TEXT NOT NULL DEFAULT '[]',             -- JSON array of strings
  metadata        TEXT NOT NULL DEFAULT '{}',             -- JSON object (source-specific payload)
  consent_email   INTEGER NOT NULL DEFAULT 0,             -- 0/1 marketing-email consent
  consent_sms     INTEGER NOT NULL DEFAULT 0,             -- 0/1 SMS consent
  first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

-- Dedupe key: one contact per (org, lowercased email). Partial — only when email present + not deleted.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_org_email
  ON contacts (org_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

-- Fallback dedupe by phone when no email.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_org_phone
  ON contacts (org_id, phone)
  WHERE email IS NULL AND phone IS NOT NULL AND deleted_at IS NULL;

-- List/filter by org (most common query) + by site.
CREATE INDEX IF NOT EXISTS idx_contacts_org      ON contacts (org_id, last_seen_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_site     ON contacts (site_id, last_seen_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_source   ON contacts (org_id, source) WHERE deleted_at IS NULL;
