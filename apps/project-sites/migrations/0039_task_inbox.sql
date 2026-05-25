-- Migration 0039 — AI task inbox
--
-- Bridges long-running Cloudflare Workflows that need user input mid-run
-- (e.g. "which Stripe customer should we attach this site to?") to the
-- admin UI. The workflow posts a row here, then `step.waitForEvent` blocks
-- until the user resolves it through the task tray. Expired+unresolved
-- tasks fall back to their `default_choice` via the scheduled sweep.
--
-- Lifecycle: open (resolved_at IS NULL AND expires_at > now)
--         -> resolved (resolved_at IS NOT NULL, resolution_json populated)
--         -> expired (resolved_at IS NULL AND expires_at <= now; applyExpiredDefaults
--            converts to resolved when default_choice is set)
CREATE TABLE IF NOT EXISTS ai_task_inbox (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workflow_instance_id TEXT,
  task_kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT,
  default_choice TEXT,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution_json TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

-- Hot path: tray polls `WHERE org_id = ? AND resolved_at IS NULL`
CREATE INDEX IF NOT EXISTS idx_task_inbox_org_open ON ai_task_inbox(org_id, resolved_at);

-- Workflow resume lookup when sendEvent fans out
CREATE INDEX IF NOT EXISTS idx_task_inbox_workflow ON ai_task_inbox(workflow_instance_id);
