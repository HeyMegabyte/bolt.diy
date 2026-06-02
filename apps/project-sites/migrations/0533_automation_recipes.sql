-- Automation Builder (#11) — no-code trigger->action recipes per site. The
-- recipe shape is validated by services/automation_builder.ts (allowlisted
-- trigger/action types) BEFORE insert; trigger_filter + actions are JSON.
-- Soft-deleted; org+site scoped. Dispatch (firing actions on events) is a
-- later slice that reuses the #10 outbound-webhook signer + email.

CREATE TABLE IF NOT EXISTS automation_recipes (
  id             TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL,
  org_id         TEXT NOT NULL,
  name           TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  trigger_type   TEXT NOT NULL,
  trigger_filter TEXT,            -- JSON object, or NULL for no filter
  actions        TEXT NOT NULL,   -- JSON array of { type, config? }
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_recipes_site
  ON automation_recipes (site_id, deleted_at);
