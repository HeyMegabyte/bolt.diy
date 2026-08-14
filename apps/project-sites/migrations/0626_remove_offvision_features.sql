-- 0626 — Teardown for 23 off-vision feature removals (Brian directive 2026-08-14).
--
-- The runtime source of truth is FLAG_REGISTRY (src/modules/feature_flags/registry.ts),
-- which no longer contains these keys — so every one already resolves to 404 via
-- isFlagOn(). These statements clean the now-orphaned D1 config rows + drop the only
-- feature-owned tables (site_tags/site_tag_assignments). The other 22 features were
-- stateless (pure functions / computed from existing data). Recoverable via D1 Time
-- Travel (30-day window) if ever needed.

-- ── Orphaned flag rows (legacy seed table + both override tables) ──
DELETE FROM feature_flags WHERE key IN (
  'voice_site_mgmt','white_label','ab_testing','ai_content_strategist','builtin_crm',
  'site_tags','seo_agent','nl_site_management','geo_toolkit','lifecycle_agent',
  'conversational_analytics','turnstile_build_gate','upgrade_moments','ai_video_hero',
  'ai_site_critic','visual_point_edit','visitor_dsar','status_page_live','url_clone_seed',
  'site_thumbnail_grid','figma_import','generative_ui_stream','deploy_buttons'
);

DELETE FROM flag_overrides WHERE flag_key IN (
  'voice_site_mgmt','white_label','ab_testing','ai_content_strategist','builtin_crm',
  'site_tags','seo_agent','nl_site_management','geo_toolkit','lifecycle_agent',
  'conversational_analytics','turnstile_build_gate','upgrade_moments','ai_video_hero',
  'ai_site_critic','visual_point_edit','visitor_dsar','status_page_live','url_clone_seed',
  'site_thumbnail_grid','figma_import','generative_ui_stream','deploy_buttons'
);

DELETE FROM feature_flag_overrides WHERE flag_key IN (
  'voice_site_mgmt','white_label','ab_testing','ai_content_strategist','builtin_crm',
  'site_tags','seo_agent','nl_site_management','geo_toolkit','lifecycle_agent',
  'conversational_analytics','turnstile_build_gate','upgrade_moments','ai_video_hero',
  'ai_site_critic','visual_point_edit','visitor_dsar','status_page_live','url_clone_seed',
  'site_thumbnail_grid','figma_import','generative_ui_stream','deploy_buttons'
);

-- ── Feature-owned tables (site_tags is the only stateful one) ──
DROP TABLE IF EXISTS site_tag_assignments;
DROP TABLE IF EXISTS site_tags;
