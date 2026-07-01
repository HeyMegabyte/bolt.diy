-- 0570_chatwoot_agent_bot_flag.sql
-- Feature flag for Chatwoot AgentBot AI triage webhook.
-- Gated behind chatwoot_agent_bot flag (experimental, disabled by default).
-- The webhook POST /webhooks/chatwoot/agent_bot receives Chatwoot conversation
-- events and returns AI-driven triage actions (classification, labels, urgency,
-- draft replies).

INSERT OR IGNORE INTO feature_flags (key, enabled, rollout_percent, stage, description, e2e_tests, smoke_steps, owner_email, created_at, updated_at)
VALUES (
  'chatwoot_agent_bot',
  0,
  0,
  'experimental',
  'Chatwoot AgentBot AI triage webhook. Receives Chatwoot conversation events and responds with AI-driven classification, label suggestions, urgency detection, and draft replies. When disabled, POST /webhooks/chatwoot/agent_bot returns 404.',
  '["e2e/chatwoot/agent-bot.spec.ts"]',
  '1. Deploy with flag enabled
2. POST test payload to /webhooks/chatwoot/agent_bot
3. Verify JSON response with actions array
4. Check label/urgency/reply are sensible for test message content',
  'brian@megabyte.space',
  datetime('now'),
  datetime('now')
);
