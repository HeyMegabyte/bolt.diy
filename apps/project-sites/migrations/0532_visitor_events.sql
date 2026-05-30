-- Visitor Events Core — pageview/session/click/conversion ingest from published
-- sites. The traffic foundation `site_analytics` was built to absorb. Append-only;
-- one row per event. Aggregated per site over a trailing window.

CREATE TABLE IF NOT EXISTS visitor_events (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  site_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,                          -- client-generated, anonymous
  event_type  TEXT NOT NULL DEFAULT 'pageview',       -- pageview|click|conversion|custom
  path        TEXT,                                    -- pathname the event fired on
  referrer    TEXT,
  metadata    TEXT NOT NULL DEFAULT '{}',             -- JSON object, event-specific
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visitor_events_site_time    ON visitor_events (site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_visitor_events_site_session ON visitor_events (site_id, session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_events_site_type    ON visitor_events (site_id, event_type);
