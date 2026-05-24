-- 0023 — audit_logs gets a human-readable `message` column.
--
-- Until now every audit row only had `action` (a dot-namespaced enum like
-- `site.snapshot.created`) plus opaque `metadata_json`. Operators reading
-- the Audit Log page saw the action code but had to drill into the JSON
-- to figure out what actually happened. From Turn 6 every audit row also
-- carries a one-line English `message` such as "Brian created snapshot
-- v2-redesign on vitos-mens-salon" so the UI grid is self-explanatory.
--
-- The column is nullable for backfill safety — existing rows display the
-- raw action as a fallback until the next operation rewrites them.
ALTER TABLE audit_logs ADD COLUMN message TEXT;

-- Speeds up substring searches over the new column (filtering by event
-- summary in the Audit Log page).
CREATE INDEX IF NOT EXISTS idx_audit_logs_message ON audit_logs (org_id, created_at DESC) WHERE message IS NOT NULL;
