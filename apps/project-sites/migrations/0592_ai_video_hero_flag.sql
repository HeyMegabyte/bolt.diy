-- 0592_ai_video_hero_flag.sql
-- Feature flag seed for AI Video Hero (#11, ROI 3.60).
-- Gate: flag OFF by default (enabled=0, experimental). Script generation
-- endpoint returns 404 when disabled. Safe for deploy — read-only script
-- generation, no video API calls until explicitly queued.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_ai_video_hero',
  NULL,
  'ai_video_hero',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"AI-generated 60-second cinematic brand video script. Produces 8 clips with Sora/Veo visual prompts, Piper TTS narration, transitions, and cost estimation. Actual video generation is async (queued via media.ts stubs) — this endpoint generates the script for preview. When disabled, POST /api/sites/:id/video-hero returns 404. Risk: none (read-only script generation, no video API cost until explicitly queued). Targets: site owners wanting cinematic brand videos. Acceptance: script returns 8 clips totaling 55-65 seconds, each clip has visual prompt + narration, cost estimate is accurate.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/ai_video_hero/generate.spec.ts"]}'
);
