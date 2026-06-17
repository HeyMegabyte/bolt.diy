-- claimyour.site — build-session persistence (#1).
-- One row per claim build session; the pure reducer (claim_build_session.ts)
-- drives transitions, the store (claim_session_store.ts) round-trips here.
-- Idempotency lives in the reducer + the store's no-op-skip; this is just storage.
CREATE TABLE IF NOT EXISTS claim_build_sessions (
  session_id      TEXT PRIMARY KEY,
  lead_id         TEXT NOT NULL,
  site_id         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending|building|completed|failed
  preview_url     TEXT,
  pending_rebuild INTEGER NOT NULL DEFAULT 0,         -- 0/1 — edits awaiting a rebuild
  pending_context TEXT,                               -- JSON: merged edit context for next build
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Look up all sessions for a lead (attribution / "did this lead already build").
CREATE INDEX IF NOT EXISTS idx_claim_build_sessions_lead ON claim_build_sessions (lead_id);
