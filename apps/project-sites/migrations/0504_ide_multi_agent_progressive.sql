-- IDE Sandbox + multi-agent + progressive skeleton schema. Idempotent.

CREATE TABLE IF NOT EXISTS ide_sandboxes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('spinning_up','ready','busy','idle','destroyed')),
  container_image TEXT DEFAULT 'node:22-slim',
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  destroyed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ide_sandboxes_user ON ide_sandboxes (user_id, state);
CREATE INDEX IF NOT EXISTS idx_ide_sandboxes_site ON ide_sandboxes (site_id, state);

CREATE TABLE IF NOT EXISTS multi_agent_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  agents_json TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK(status IN ('running','done','failed','cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  total_duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_multi_agent_runs_site ON multi_agent_runs (site_id, started_at);

CREATE TABLE IF NOT EXISTS multi_agent_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_multi_agent_events_run ON multi_agent_events (run_id, ts);

CREATE TABLE IF NOT EXISTS progressive_builds (
  site_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('queued','skeleton_live','streaming_components','complete','failed')),
  components_done_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
