-- 0028_editor_chats.sql
--
-- Native Angular editor (Phase 1) — chat persistence for the
-- `/admin/editor-native` route. Replaces the bolt.diy iframe's local
-- IndexedDB chat-state with a real D1-backed thread so chats survive
-- across devices, tabs, and the eventual iframe retirement (Phase 6).
--
-- ## Tables
--
-- 1. `editor_chats` — one row per conversation. Soft-deletable via
--    `deleted_at`. `provider` records the LLM provider chosen at
--    chat-creation time so a chat history is reproducible even if the
--    user later switches providers globally.
--
-- 2. `editor_chat_messages` — one row per message in a chat. `role` is
--    'user' | 'assistant' | 'system' | 'tool'. `tokens_in` / `tokens_out`
--    / `cost_usd` are populated by the streaming response handler in
--    `services/editor_llm.ts` so we can show running cost in the UI
--    without a second telemetry query.
--
-- ## Indexes
--
-- - `idx_editor_chats_site_id` — list-chats-per-site for the sidebar.
-- - `idx_editor_chats_user_id` — "my chats" cross-site view.
-- - `idx_editor_chat_messages_chat_id` — load-messages-for-chat path.
--
-- ## Foreign keys
--
-- - `editor_chats.site_id → sites.id` ON DELETE CASCADE — when a site is
--   deleted, every associated chat goes with it (no orphans).
-- - `editor_chats.user_id → users.id` ON DELETE CASCADE — when a user is
--   deleted, their chats are removed.
-- - `editor_chat_messages.chat_id → editor_chats.id` ON DELETE CASCADE.

CREATE TABLE IF NOT EXISTS editor_chats (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  -- Default model alias for the chat — overridable per message.
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  -- Provider routing key: 'workers-ai' | 'openai' | 'anthropic' | 'ollama'.
  provider TEXT NOT NULL DEFAULT 'workers-ai',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_editor_chats_site_id
  ON editor_chats(site_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_editor_chats_user_id
  ON editor_chats(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS editor_chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  -- 'user' | 'assistant' | 'system' | 'tool' — enforced at the worker
  -- (Zod) and rendered as a string in SQLite.
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chat_id) REFERENCES editor_chats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_editor_chat_messages_chat_id
  ON editor_chat_messages(chat_id, created_at ASC);
