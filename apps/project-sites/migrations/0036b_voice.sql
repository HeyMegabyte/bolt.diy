-- 0036_voice.sql
-- Voice + SMS — Twilio-powered AI Voice Agent + SMS Agent for sites.
-- Per-site cap of 3 numbers. Per-agent system prompts merged with an
-- immutable "ultra-sweet talented salesperson + lawful + threat-aware"
-- meta-override (composed in src/services/voice_agent.ts).
--
-- Tables:
--   voice_numbers         - Twilio-provisioned phone numbers (per site, cap 3)
--   voice_calls           - call records (inbound/outbound) with recording + transcript refs
--   voice_messages        - SMS records (inbound/outbound) with optional MMS media
--   voice_sessions        - per-(site, from_number) rolling conversational context
--   voice_recordings      - R2-backed audio + video + transcript artifacts per call
--   voice_agent_settings  - per-site agent configuration (1 row per site)

-- ─── voice_numbers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_numbers (
  id                   TEXT PRIMARY KEY,
  site_id              TEXT NOT NULL,
  org_id               TEXT NOT NULL,
  phone_number         TEXT NOT NULL UNIQUE,                  -- E.164: +18558225267
  friendly_name        TEXT,
  vanity_display       TEXT,                                  -- "(855) 82L-ABOR"
  twilio_sid           TEXT UNIQUE,                           -- PN…
  capabilities         TEXT,                                  -- JSON: {voice, sms, mms, fax}
  voice_url            TEXT,
  sms_url              TEXT,
  monthly_cost_cents   INTEGER NOT NULL DEFAULT 100,          -- US local ≈ $1.00/mo
  purchased_at         TEXT,
  released_at          TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('active', 'released', 'pending')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_numbers_site
  ON voice_numbers(site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_numbers_org
  ON voice_numbers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_numbers_status
  ON voice_numbers(status) WHERE deleted_at IS NULL;

-- ─── voice_calls ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_calls (
  id                    TEXT PRIMARY KEY,
  voice_number_id       TEXT NOT NULL,
  site_id               TEXT NOT NULL,
  org_id                TEXT NOT NULL,
  twilio_call_sid       TEXT NOT NULL UNIQUE,                 -- CA…
  direction             TEXT NOT NULL
                        CHECK (direction IN ('inbound', 'outbound')),
  from_number           TEXT NOT NULL,
  to_number             TEXT NOT NULL,
  status                TEXT,                                 -- queued|ringing|in-progress|completed|failed|busy|no-answer|canceled
  started_at            TEXT,
  ended_at              TEXT,
  duration_seconds      INTEGER,
  recording_url         TEXT,
  recording_sid         TEXT,
  video_recording_url   TEXT,
  transcript_json       TEXT,                                 -- JSON: [{role, text, ts_ms}]
  summary               TEXT,
  sentiment             TEXT,                                 -- positive|neutral|negative|escalated_safety|flagged_scam
  cost_cents            INTEGER,
  hangup_reason         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_calls_site
  ON voice_calls(site_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_calls_org
  ON voice_calls(org_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_calls_number
  ON voice_calls(voice_number_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_calls_from
  ON voice_calls(from_number);

-- ─── voice_messages ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_messages (
  id                    TEXT PRIMARY KEY,
  voice_number_id       TEXT NOT NULL,
  site_id               TEXT NOT NULL,
  org_id                TEXT NOT NULL,
  twilio_message_sid    TEXT NOT NULL UNIQUE,                 -- SM…
  direction             TEXT NOT NULL
                        CHECK (direction IN ('inbound', 'outbound')),
  from_number           TEXT NOT NULL,
  to_number             TEXT NOT NULL,
  body                  TEXT,
  media_urls            TEXT,                                 -- JSON string[]
  status                TEXT,                                 -- queued|sent|delivered|undelivered|failed
  sent_at               TEXT,
  delivered_at          TEXT,
  ai_reply_id           TEXT,                                 -- self-FK to voice_messages.id for auto-replies
  cost_cents            INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_messages_site
  ON voice_messages(site_id, sent_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_messages_org
  ON voice_messages(org_id, sent_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_messages_number
  ON voice_messages(voice_number_id, sent_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_messages_from
  ON voice_messages(from_number);

-- ─── voice_sessions ───────────────────────────────────────────
-- Rolling per-caller context the agent reads on every new turn. Stores
-- last-30-turn ring buffer + lightweight extracted facts in context_json.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id                    TEXT PRIMARY KEY,
  site_id               TEXT NOT NULL,
  from_number           TEXT NOT NULL,
  last_active_at        TEXT NOT NULL DEFAULT (datetime('now')),
  context_json          TEXT,                                 -- JSON: {turns:[...], facts:{...}, opted_out_sms:bool, recording_opt_out:bool}
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT,
  UNIQUE(site_id, from_number)
);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_active
  ON voice_sessions(site_id, last_active_at DESC) WHERE deleted_at IS NULL;

-- ─── voice_recordings ─────────────────────────────────────────
-- R2-backed artifacts produced by a call. One call may have multiple kinds:
-- the original audio, transcript .vtt, transcript .txt, browse-agent video.
CREATE TABLE IF NOT EXISTS voice_recordings (
  id                    TEXT PRIMARY KEY,
  call_id               TEXT NOT NULL,
  kind                  TEXT NOT NULL
                        CHECK (kind IN ('audio', 'video', 'transcript_text', 'transcript_vtt')),
  r2_key                TEXT NOT NULL,                        -- voice/{site_id}/{call_id}/audio.mp3 etc
  mime                  TEXT,
  size_bytes            INTEGER,
  duration_seconds      INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_recordings_call
  ON voice_recordings(call_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_recordings_kind
  ON voice_recordings(call_id, kind) WHERE deleted_at IS NULL;

-- ─── voice_agent_settings ─────────────────────────────────────
-- Exactly one row per site. The owner-authored prompts get merged with the
-- immutable PROMPT_META in src/services/voice_agent.ts → composeSystemPrompt.
CREATE TABLE IF NOT EXISTS voice_agent_settings (
  id                       TEXT PRIMARY KEY,
  site_id                  TEXT NOT NULL UNIQUE,
  voice_system_prompt      TEXT,
  sms_system_prompt        TEXT,
  voice_provider           TEXT NOT NULL DEFAULT 'twilio-callgpt',
  voice_voice_id           TEXT,                              -- ElevenLabs voice id
  voice_model              TEXT,                              -- LLM model override for voice turns
  sms_model                TEXT,                              -- LLM model override for SMS turns
  max_call_seconds         INTEGER NOT NULL DEFAULT 600,
  recording_enabled        INTEGER NOT NULL DEFAULT 1,
  video_browse_enabled     INTEGER NOT NULL DEFAULT 1,
  mcp_connection_ids       TEXT,                              -- JSON string[]
  escalation_phone         TEXT,                              -- E.164 human-handoff number
  business_hours_json      TEXT,
  knowledge_base_urls      TEXT,                              -- JSON string[]
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at               TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_agent_settings_site
  ON voice_agent_settings(site_id) WHERE deleted_at IS NULL;
