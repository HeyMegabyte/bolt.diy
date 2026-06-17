-- Migration: 0562_status_incidents
-- Creates the status_incidents table for the status_page_live feature module.

CREATE TABLE IF NOT EXISTS status_incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_status_incidents_status ON status_incidents (status);
CREATE INDEX IF NOT EXISTS idx_status_incidents_severity ON status_incidents (severity);
CREATE INDEX IF NOT EXISTS idx_status_incidents_created_at ON status_incidents (created_at DESC);
