-- 0613_prune_dead_flags.sql
-- Prune the 42 DEAD feature flags (0 code readers — verified 2026-08-12 via
-- scripts/audit-feature-flags.mjs + grep across src/frontend/skills). Removed from
-- FLAG_REGISTRY (registry.ts) + FLAG_DOCS (docs.ts) in the same commit; this migration
-- clears any stray admin overrides from the runtime override table so the resolver
-- (services.ts reads flag_overrides.flag_key) has nothing dangling.
--
-- NOTE: the legacy `feature_flags` D1 table (seeded by the old 05xx_*_flag.sql
-- migrations) is NOT read at runtime — only `flag_overrides` + the code registry are.
-- Its orphaned rows are harmless; not deleted here to avoid the flag_name↔key mismatch.

DELETE FROM flag_overrides WHERE flag_key IN (
  'abuse_takedown', 'accessibility_statement', 'aeo_pass', 'ai_gateway_guardrails',
  'analytics_rollup_read', 'audit_trail_export', 'cmdk_ai_actions', 'cms_content',
  'credit_wallet_rollover', 'deploy_buttons', 'edge_personalization', 'figma_import',
  'generative_ui_stream', 'llms_txt', 'mcp_oauth_provider', 'mcp_server', 'model_registry',
  'multi_agent_concurrent', 'native_booking_engine', 'observability_gateway', 'onboarding_copilot',
  'page_audio_summary', 'payments_rail', 'platform_mcp', 'preview_share_card', 'prod_readiness_score',
  'prompt_studio', 'quotable_answer_block', 'referral_loop', 'site_analytics', 'site_doctor',
  'site_semantic_search', 'site_thumbnail_grid', 'site_video_gen', 'speculation_rules',
  'status_page_live', 'structured_data_autopilot', 'url_clone_seed', 'visitor_dsar',
  'visitor_events_core', 'visual_point_edit', 'wireframe_planning'
);
