-- Add columns the writeAiLog INSERT and ai-logs SELECT both reference but
-- which were never present on the live table. Without them, every endpoint
-- run returned HTTP 500 and the Traces page returned "Can't reach server".
ALTER TABLE ai_form_logs ADD COLUMN endpoint_slug TEXT;
ALTER TABLE ai_form_logs ADD COLUMN credits_debited INTEGER;
CREATE INDEX IF NOT EXISTS idx_ai_form_logs_site_created
  ON ai_form_logs(site_id, created_at DESC);
