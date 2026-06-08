-- Abuse / takedown intake for published sites (flag: abuse_takedown).
-- DMCA + illegal-content reporting workflow: public submit → operator review →
-- dismiss or takedown (archives the offending site). Hosting-platform necessity.

CREATE TABLE IF NOT EXISTS abuse_reports (
  id              TEXT PRIMARY KEY,
  site_id         TEXT,                         -- resolved published site the report targets
  org_id          TEXT,                         -- owning org of that site (for owner visibility)
  reporter_email  TEXT,                         -- optional contact for the reporter
  category        TEXT NOT NULL,                -- dmca | illegal | malware | phishing | spam | other
  reason          TEXT NOT NULL,                -- free-text description of the abuse
  evidence_url    TEXT,                         -- optional URL backing the claim
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | reviewing | upheld_takedown | dismissed
  resolution_note TEXT,
  resolved_by     TEXT,                         -- super-admin user id who actioned it
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON abuse_reports(status);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_site ON abuse_reports(site_id);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_org ON abuse_reports(org_id);
