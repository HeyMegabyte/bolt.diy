-- Durable Object SQLite schema for TraceHub + ActivityHub (item #61).
--
-- This file is the canonical, human-readable copy of the schema that the
-- DO classes run on first request via:
--
--   this.ctx.storage.sql.exec(schemaSQL);
--
-- The DO class embeds the same DDL inline so the runtime never depends on
-- a file fetch. Edit BOTH places in lockstep when the schema changes.
--
-- Backend: Cloudflare Durable Objects SQLite (GA April 2025, paid since
-- Jan 7 2026). Storage limit: 10 GiB per DO. Reads are local-CPU-bound and
-- support full SQLite syntax (CTEs, window funcs, FTS5, etc.).

CREATE TABLE IF NOT EXISTS trace_events (
  id          TEXT PRIMARY KEY,            -- UUID
  ts          INTEGER NOT NULL,            -- unix ms
  request_id  TEXT,                        -- correlation ID
  service     TEXT NOT NULL,               -- 'workflow' | 'route' | 'do' | ...
  level       TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message     TEXT NOT NULL,
  payload     TEXT                         -- JSON blob (small enough to inline)
);

CREATE INDEX IF NOT EXISTS trace_events_ts_idx
  ON trace_events(ts DESC);

CREATE INDEX IF NOT EXISTS trace_events_request_idx
  ON trace_events(request_id);

CREATE TABLE IF NOT EXISTS activity_events (
  id         TEXT PRIMARY KEY,
  ts         INTEGER NOT NULL,
  org_id     TEXT,
  actor_id   TEXT,
  action     TEXT NOT NULL,                -- 'site.created' | 'site.published' | ...
  target_id  TEXT,
  metadata   TEXT                          -- JSON blob
);

CREATE INDEX IF NOT EXISTS activity_events_ts_idx
  ON activity_events(ts DESC);

CREATE INDEX IF NOT EXISTS activity_events_org_idx
  ON activity_events(org_id, ts DESC);
