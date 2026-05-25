-- 0035_pulse_inbox.sql
--
-- Pulse Inbox — Chatwoot-equivalent multi-channel customer messaging surface.
--
-- Channels: website widget · email (Cloudflare Email Routing) · Slack · Discord ·
-- Telegram · raw API. One inbox = one (org, channel, optional external_id) tuple.
-- A conversation is a thread between a single contact and a single inbox.
-- Every message in either direction lands in `chat_messages`.
--
-- Realtime fan-out + presence is owned by the `ConversationHub` Durable Object
-- (one DO per conversation, SQLite-backed, WebSocket entry, write-back into D1).
--
-- ## Tables
--   chat_inboxes          - one per (org, channel) — Website, Email, Slack ws, etc.
--   chat_contacts         - remote-side person (email/phone/Slack uid/Discord uid)
--   chat_conversations    - thread (contact × inbox), assignee, status, priority, sentiment
--   chat_messages         - every inbound/outbound/internal-note message
--   chat_canned_responses - reusable templates per org (/shortcode)
--   chat_csat_surveys     - CSAT surveys sent after resolution
--
-- ## Indexes
--   - List open conversations per inbox sorted by last_message_at (hot dashboard path)
--   - "My conversations" by assignee + status
--   - Messages-per-conversation timeline
--   - Per-org contact lookup by email
--   - Org-scoped inbox list (soft-delete aware)
--
-- ## Foreign keys
--   D1 does NOT enforce FK constraints at runtime — every cross-table join filters
--   on `org_id` in the worker for tenant isolation regardless. Declaring intent
--   anyway so future Drizzle/Neon mirror picks it up.

CREATE TABLE IF NOT EXISTS chat_inboxes (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  site_id      TEXT,                  -- optional FK → sites.id
  name         TEXT NOT NULL,
  channel      TEXT NOT NULL,         -- website|email|slack|discord|telegram|api
  config_json  TEXT,                  -- channel-specific config (encrypted blobs for tokens)
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_inboxes_org
  ON chat_inboxes(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_inboxes_channel
  ON chat_inboxes(org_id, channel) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_contacts (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  name           TEXT,
  email          TEXT,
  phone          TEXT,
  external_ids   TEXT,                -- JSON {slack:"U123", discord:"456", email:"a@b.com", telegram:"789"}
  avatar_url     TEXT,
  custom_attrs   TEXT,                -- JSON of arbitrary key/values
  first_seen_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_contacts_org_email
  ON chat_contacts(org_id, email);
CREATE INDEX IF NOT EXISTS idx_chat_contacts_org_phone
  ON chat_contacts(org_id, phone);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  inbox_id          TEXT NOT NULL,
  contact_id        TEXT NOT NULL,
  assignee_user_id  TEXT,             -- which staff is assigned
  status            TEXT NOT NULL DEFAULT 'open',     -- open|pending|resolved|snoozed
  snoozed_until     TEXT,
  priority          TEXT NOT NULL DEFAULT 'normal',   -- low|normal|high|urgent
  sentiment         TEXT,             -- positive|neutral|negative — AI tag
  intent            TEXT,             -- sales|support|billing|complaint|other
  subject           TEXT,
  last_message_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unread_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at       TEXT,
  csat_score        INTEGER,          -- 1-5 after resolution
  csat_feedback     TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_inbox_last
  ON chat_conversations(inbox_id, last_message_at DESC) WHERE status != 'resolved';
CREATE INDEX IF NOT EXISTS idx_chat_conv_assignee
  ON chat_conversations(assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_conv_org_status
  ON chat_conversations(org_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conv_snoozed
  ON chat_conversations(snoozed_until) WHERE status = 'snoozed';

CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  direction       TEXT NOT NULL,      -- inbound|outbound|note (note = internal-only)
  sender_type     TEXT NOT NULL,      -- contact|agent|system|bot
  sender_id       TEXT,               -- user.id or contact.id
  content         TEXT NOT NULL,
  content_type    TEXT NOT NULL DEFAULT 'text',  -- text|markdown|html|image|file
  attachments     TEXT,               -- JSON [{r2_key, mime, name, size}]
  external_id     TEXT,               -- platform-side message id (Slack ts, Discord id, email Message-Id)
  ai_generated    INTEGER NOT NULL DEFAULT 0,
  ai_confidence   REAL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_conv
  ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_msg_external
  ON chat_messages(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_canned_responses (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  short_code  TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_id, short_code)
);
CREATE INDEX IF NOT EXISTS idx_chat_canned_org
  ON chat_canned_responses(org_id, short_code);

CREATE TABLE IF NOT EXISTS chat_csat_surveys (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  contact_id      TEXT NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at    TEXT,
  score           INTEGER,
  feedback        TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_csat_conv
  ON chat_csat_surveys(conversation_id);
