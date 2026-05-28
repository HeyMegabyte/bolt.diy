-- Migration 0507: Domain Stack One-Click Wizard
-- Adds domain_stack_runs table for the 7-step state machine.
-- Feature flag: domain_stack_wizard (default off, experimental)

CREATE TABLE IF NOT EXISTS domain_stack_runs (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  hostname_id  TEXT NOT NULL,
  hostname     TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'register'
                 CHECK (state IN ('register','dns','ssl','email_auth','discovery','gsc','done','error')),
  step_results TEXT NOT NULL DEFAULT '{}',   -- JSON map of step → {ok, error, data, attempts}
  retries      INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  done_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_domain_stack_runs_org
  ON domain_stack_runs (org_id, state);

CREATE INDEX IF NOT EXISTS idx_domain_stack_runs_hostname
  ON domain_stack_runs (hostname);
