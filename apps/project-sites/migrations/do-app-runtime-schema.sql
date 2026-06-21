-- Durable Object SQLite schema for AppRuntimeContainer (installed-app runtime).
--
-- Canonical, human-readable copy of the schema the DO runs on first request via:
--
--   this.appSql?.exec(SCHEMA_SQL);
--
-- The DO class (src/durable_objects/app_runtime.ts) embeds the SAME DDL inline so
-- the runtime never depends on a file fetch. Edit BOTH places in lockstep when the
-- schema changes — enforced by src/__tests__/app_runtime_schema_lockstep.test.ts.
--
-- Backend: Cloudflare Durable Objects SQLite (10 GiB per DO). `app_logs` is a ring
-- buffer (the DO trims to the last LOG_RING_LIMIT=1000 lines on write).

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_logs (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  stream TEXT    NOT NULL,
  line   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_logs_ts ON app_logs(ts DESC);
