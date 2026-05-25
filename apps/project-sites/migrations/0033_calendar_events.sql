-- 0033_calendar_events.sql
-- Calendar surface for the new /admin dashboard (Perplexity-like AI surface).
-- Backs CalendarWidget CRUD, Google-Calendar sync, Cal.com-style booking links.
--
-- Tables:
--   calendar_events     - user-owned events with RRULE recurrence + tz awareness
--   calendar_calendars  - per-user calendar collections (color-coded)
--   calendar_bookings   - public booking links (Cal.com style) + their slot rules

CREATE TABLE IF NOT EXISTS calendar_calendars (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  org_id       TEXT,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#00E5FF',
  is_default   INTEGER NOT NULL DEFAULT 0,
  google_id    TEXT,                 -- google calendar id when synced
  sync_token   TEXT,                 -- incremental sync token (Google API v3)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_calendars_user ON calendar_calendars(user_id, deleted_at);

CREATE TABLE IF NOT EXISTS calendar_events (
  id            TEXT PRIMARY KEY,
  calendar_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  org_id        TEXT,
  title         TEXT NOT NULL,
  description   TEXT,
  location      TEXT,
  start_utc     TEXT NOT NULL,       -- ISO 8601 UTC
  end_utc       TEXT NOT NULL,
  tz            TEXT NOT NULL DEFAULT 'UTC',
  all_day       INTEGER NOT NULL DEFAULT 0,
  rrule         TEXT,                -- RFC 5545 RRULE string, NULL = single
  exdates       TEXT,                -- JSON array of ISO dates excluded from rrule
  attendees     TEXT,                -- JSON array of {email,name,rsvp}
  google_id     TEXT,                -- google event id when synced
  status        TEXT NOT NULL DEFAULT 'confirmed', -- confirmed|tentative|cancelled
  visibility    TEXT NOT NULL DEFAULT 'private',   -- private|public
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_range
  ON calendar_events(user_id, start_utc, end_utc) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar
  ON calendar_events(calendar_id, start_utc) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS calendar_bookings (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  org_id          TEXT,
  slug            TEXT NOT NULL UNIQUE, -- public URL slug e.g. /book/brian-30
  title           TEXT NOT NULL,
  description     TEXT,
  duration_min    INTEGER NOT NULL,     -- 15|30|45|60|...
  buffer_min      INTEGER NOT NULL DEFAULT 0,
  tz              TEXT NOT NULL DEFAULT 'UTC',
  weekdays        TEXT NOT NULL,        -- JSON [1,2,3,4,5] (mon-fri)
  window_start    TEXT NOT NULL,        -- '09:00'
  window_end      TEXT NOT NULL,        -- '17:00'
  calendar_id     TEXT,                 -- created bookings dropped onto this calendar
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_user
  ON calendar_bookings(user_id, deleted_at);
