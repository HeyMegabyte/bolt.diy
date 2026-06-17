-- Claim shortlinks (#1 claimyour.site + #9 lead scanner).
-- A scanned lead is issued a short URL-safe token; a click resolves it back to
-- the lead to open the build session. See src/services/claim_links.ts.
CREATE TABLE IF NOT EXISTS claim_links (
  token       TEXT PRIMARY KEY,            -- URL-safe base62, claimyour.site/<token>
  lead_id     TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0,
  clicked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claim_links_lead ON claim_links (lead_id);
