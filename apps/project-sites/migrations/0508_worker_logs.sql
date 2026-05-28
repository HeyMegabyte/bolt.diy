-- Migration 0508: Worker Tail Log Explorer
-- Persists Worker tail log lines for 30-day full-text search and cost attribution.
-- Feature flag: log_explorer (default off, experimental)

CREATE TABLE IF NOT EXISTS worker_logs (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  level         TEXT NOT NULL DEFAULT 'info'
                  CHECK (level IN ('debug','info','warn','error','fatal')),
  request_id    TEXT,
  route         TEXT NOT NULL DEFAULT '',
  method        TEXT NOT NULL DEFAULT '',
  status        INTEGER,
  duration_ms   INTEGER,
  cost_estimate REAL DEFAULT 0,   -- USD micro-estimate based on CPU + response bytes
  message       TEXT NOT NULL DEFAULT '',
  meta_json     TEXT NOT NULL DEFAULT '{}',   -- extra structured fields
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full-text search via SQLite FTS5
CREATE VIRTUAL TABLE IF NOT EXISTS worker_logs_fts USING fts5(
  id UNINDEXED,
  level,
  route,
  message,
  content='worker_logs',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS worker_logs_ai AFTER INSERT ON worker_logs BEGIN
  INSERT INTO worker_logs_fts(rowid, id, level, route, message)
    VALUES (new.rowid, new.id, new.level, new.route, new.message);
END;

CREATE TRIGGER IF NOT EXISTS worker_logs_ad AFTER DELETE ON worker_logs BEGIN
  INSERT INTO worker_logs_fts(worker_logs_fts, rowid, id, level, route, message)
    VALUES ('delete', old.rowid, old.id, old.level, old.route, old.message);
END;

-- Index for time-range and route-cost queries
CREATE INDEX IF NOT EXISTS idx_worker_logs_ts     ON worker_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_worker_logs_route  ON worker_logs (route, ts DESC);
CREATE INDEX IF NOT EXISTS idx_worker_logs_level  ON worker_logs (level, ts DESC);

-- Auto-prune rows older than 30 days. Run as a scheduled Cron.
-- DELETE FROM worker_logs WHERE ts < datetime('now', '-30 days');
