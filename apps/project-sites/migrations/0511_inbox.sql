-- Migration 0511: Unified Visitor Inbox + Identity Resolution
--
-- Adds persistence for #24 Unified Visitor Inbox.
-- Feature flag: unified_inbox (enabled=0, rollout=0, stage='experimental').
--
-- Tables:
--   visitor_identities  — cross-channel identity resolution (email/phone/anon)
--   conversations       — one thread per visitor × channel
--   messages            — append-only message log per conversation
--
-- All: UUID PK, ISO-8601 timestamps, soft-delete via deleted_at.

-- ── visitor_identities ──────────────────────────────────────────────────────
-- Joins form submissions, chat sessions, voice calls, SMS by the best
-- available stable identifier. Priority: email > phone > visitor_id > anon_id.
CREATE TABLE IF NOT EXISTS visitor_identities (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  site_id        TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  visitor_id     TEXT,            -- set by client-side cookie / localStorage
  anon_id        TEXT,            -- CF-Ray or random UUID for unauthenticated visitors
  display_name   TEXT,
  first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  channel_flags  TEXT NOT NULL DEFAULT '{}', -- JSON: {"form":1,"chat":1,"voice":0,"sms":0}
  metadata_json  TEXT NOT NULL DEFAULT '{}', -- arbitrary enrichment
  deleted_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visitor_identities_org_site
  ON visitor_identities(org_id, site_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_visitor_identities_email
  ON visitor_identities(email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_visitor_identities_phone
  ON visitor_identities(phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_identities_visitor_id
  ON visitor_identities(org_id, site_id, visitor_id)
  WHERE visitor_id IS NOT NULL AND deleted_at IS NULL;

-- ── conversations ────────────────────────────────────────────────────────────
-- One conversation = one thread between a visitor identity and the org on a
-- given channel. A visitor who emails + chats = two conversations that are
-- linked via visitor_id.
CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  site_id          TEXT NOT NULL,
  visitor_id       TEXT NOT NULL REFERENCES visitor_identities(id),
  channel          TEXT NOT NULL CHECK (channel IN ('form','chat','voice','sms','email')),
  subject          TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','pending','resolved','spam')),
  assigned_to      TEXT,           -- user_id of assigned agent (NULL = unassigned)
  sla_due_at       TEXT,           -- ISO-8601; NULL = no SLA set
  first_response_at TEXT,          -- set when first reply lands
  resolved_at      TEXT,
  last_message_at  TEXT NOT NULL DEFAULT (datetime('now')),
  message_count    INTEGER NOT NULL DEFAULT 0,
  unread_count     INTEGER NOT NULL DEFAULT 0,
  tags_json        TEXT NOT NULL DEFAULT '[]',
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  deleted_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_org_site_status
  ON conversations(org_id, site_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to
  ON conversations(assigned_to)
  WHERE assigned_to IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
  ON conversations(org_id, site_id, last_message_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_sla_due_at
  ON conversations(sla_due_at)
  WHERE sla_due_at IS NOT NULL AND status = 'open' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_visitor_id
  ON conversations(visitor_id)
  WHERE deleted_at IS NULL;

-- ── messages ─────────────────────────────────────────────────────────────────
-- Append-only; never soft-deleted (keep full audit trail).
-- direction: 'inbound' = visitor→org, 'outbound' = org→visitor.
CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id),
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  author_type      TEXT NOT NULL CHECK (author_type IN ('visitor','agent','ai','system')),
  author_id        TEXT,           -- user_id for agents, NULL for visitor/ai
  body             TEXT NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('form','chat','voice','sms','email')),
  ai_drafted       INTEGER NOT NULL DEFAULT 0, -- 1 if body was AI-drafted and agent approved
  sent_at          TEXT NOT NULL DEFAULT (datetime('now')),
  read_at          TEXT,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON messages(conversation_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_read_at
  ON messages(conversation_id)
  WHERE read_at IS NULL;
