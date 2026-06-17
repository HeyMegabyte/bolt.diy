-- Leads (#9 scanner + #1 claimyour prefill).
-- The scanner persists a researched ClaimLeadProfile (as JSON) + scoring meta;
-- the claim flow reads it back to prefill /create. See src/services/lead_store.ts.
CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,                  -- crypto.randomUUID
  business_name TEXT NOT NULL,
  profile_json  TEXT NOT NULL,                     -- full ClaimLeadProfile (validated)
  place_id      TEXT,                              -- Google Places id (dedupe)
  has_website   INTEGER NOT NULL DEFAULT 0,        -- 0/1 — prime lead signal
  lead_score    INTEGER NOT NULL DEFAULT 0,        -- 0-100
  priority      INTEGER NOT NULL DEFAULT 0,        -- 0/1 — priority region
  email         TEXT,                              -- compliantly enriched, NOT from Places
  email_status  TEXT,                              -- pending|enriched|suppressed|...
  source        TEXT,                              -- e.g. google_places
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dedupe scanned places + filter the Super-Admin leads table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_place ON leads (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (lead_score);
