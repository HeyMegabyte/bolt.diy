-- 0590_ai_site_critic_flag.sql
-- Feature flag seed for AI Website Critic (#8, ROI 3.20).
-- Gate: flag OFF by default (enabled=0, experimental). Critic endpoint returns
-- 404 when disabled. Safe for deploy — read-only, no mutations.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_ai_site_critic',
  NULL,
  'ai_site_critic',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"AI-powered site critique with per-dimension scoring (layout, typography, color, imagery, trust, copy, SEO, mobile), A-F grading, industry benchmarking, and prioritized auto-fix suggestions. Uses CF Browser Rendering for screenshots + Workers AI Llama 4 Scout for vision scoring. Extends site_doctor grading infrastructure. When disabled, GET/POST /api/sites/:id/critic returns 404. Risk: none (read-only). Targets: site owners evaluating design quality. Acceptance: critique returns ≥5 dimensions scored, A-F grade, and ≥1 priority fix.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/ai_site_critic/critique.spec.ts"]}'
);
