-- 0020_ai_endpoints_ide.sql
-- Adds the columns required by the in-admin AI-endpoint IDE (multi-file editor,
-- language dispatch, per-endpoint auth/rate-limit/cache/cron/tags). All columns
-- have safe defaults so existing rows continue to work unchanged.
--
-- See: src/routes/ai_admin.ts (PUT/POST /api/sites/:siteId/ai-endpoints/:id),
--      src/services/ai_endpoints_ide.ts (deploy + dispatch),
--      frontend/src/app/pages/admin/sections/ai-endpoints.component.ts.

-- language: 'ai-prompt' | 'javascript' | 'typescript' | 'python' | 'rust-wasm'.
-- ai-prompt is the new canonical value for the previous kind='prompt' row.
ALTER TABLE ai_endpoints ADD COLUMN language TEXT NOT NULL DEFAULT 'ai-prompt';

-- Multi-file editor payload: JSON object { "<path>": "<contents>", ... }.
-- When NULL the endpoint runs from worker_code/prompt_template (legacy single-file).
ALTER TABLE ai_endpoints ADD COLUMN files_json TEXT;

-- Worker bindings declared inside the IDE (KV, R2, D1, AI, Queue, Vars).
-- JSON shape: [{ "type": "kv", "name": "MY_KV", "id": "..." }, ...].
ALTER TABLE ai_endpoints ADD COLUMN bindings_json TEXT;

-- Authentication mode the public dispatch enforces before invoking user code.
-- 'open' | 'bearer' | 'turnstile' | 'hmac'.
ALTER TABLE ai_endpoints ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'open';

-- Per-endpoint rate limit (requests / second / client IP). 0 disables.
ALTER TABLE ai_endpoints ADD COLUMN rate_limit_per_sec INTEGER NOT NULL DEFAULT 60;

-- Cache TTL applied to GET responses (KV-backed). 0 disables caching.
ALTER TABLE ai_endpoints ADD COLUMN cache_ttl_seconds INTEGER NOT NULL DEFAULT 0;

-- Cron expression (CF Workers cron). NULL = no cron.
ALTER TABLE ai_endpoints ADD COLUMN cron_expression TEXT;

-- User-defined tags for filtering in admin. JSON array of {label,color}.
ALTER TABLE ai_endpoints ADD COLUMN tags_json TEXT;

-- Track current deploy status surfaced in the IDE status bar.
-- 'idle' | 'deploying' | 'live' | 'error'.
ALTER TABLE ai_endpoints ADD COLUMN deploy_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE ai_endpoints ADD COLUMN deploy_error TEXT;
ALTER TABLE ai_endpoints ADD COLUMN deployed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_endpoints_language ON ai_endpoints(language);
