-- Migration 0513: Site Branches (#27 Branch-Style Site Previews)
-- Branch previews: each edit gets a {branch}.{slug}.projectsites.dev URL.
-- Approvals via Slack/Email; merge to prod on green checks.

CREATE TABLE IF NOT EXISTS site_branches (
  id                 TEXT    NOT NULL PRIMARY KEY,
  site_id            TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  branch_name        TEXT    NOT NULL, -- URL-safe, e.g. "feat-new-hero"
  created_by         TEXT    NOT NULL, -- user_id
  status             TEXT    NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','review','merged','closed')),
  r2_path            TEXT,             -- sites/{slug}/branches/{branch_name}/
  preview_url        TEXT,             -- https://{branch_name}--{slug}.projectsites.dev
  approvals_required INTEGER NOT NULL DEFAULT 1,
  approvals_received INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT,

  UNIQUE (site_id, branch_name)
);

CREATE INDEX IF NOT EXISTS idx_site_branches_site_id ON site_branches(site_id);
CREATE INDEX IF NOT EXISTS idx_site_branches_status  ON site_branches(status);

-- Per-branch approvals log (who approved, when)
CREATE TABLE IF NOT EXISTS site_branch_approvals (
  id          TEXT NOT NULL PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES site_branches(id) ON DELETE CASCADE,
  approver_id TEXT NOT NULL, -- user_id
  approved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_branch_approvals_branch ON site_branch_approvals(branch_id);

-- Feature flag: branch previews (#27)
-- Default: disabled. Admin promotes via /admin/feature-flags.
INSERT OR IGNORE INTO feature_flags (key, description, enabled_globally, rollout_pct)
VALUES (
  'branch_previews',
  'Branch-style site previews — each edit gets {branch}--{slug}.projectsites.dev. Requires approval before merging to prod.',
  0,
  0
);
