-- 0628 — Flag grouping: 13 member flags folded into 7 anchor flags (Brian 2026-08-14).
--
-- Members now READ their anchor flag (manifest flagKey + isFlagOn re-pointed); their own
-- FLAG_REGISTRY entries are removed. The anchors (site_analytics, site_doctor,
-- onboarding_copilot, mcp_server, activity_feed, batch_operations, social_publishing_native)
-- stay and now gate the whole group. This sweeps the members' orphaned D1 config rows.
-- NOTE: prod feature_flags keys on `flag_name`; override tables use `flag_key`.

DELETE FROM feature_flags WHERE flag_name IN (
  'visitor_events_core','prod_readiness_score','site_health_sparklines','onboarding_progress',
  'platform_mcp','mcp_oauth_provider','mru_cards','usage_gauges','notification_badge',
  'analytics_annotations','site_clone','site_comparison','social_agent'
);

DELETE FROM flag_overrides WHERE flag_key IN (
  'visitor_events_core','prod_readiness_score','site_health_sparklines','onboarding_progress',
  'platform_mcp','mcp_oauth_provider','mru_cards','usage_gauges','notification_badge',
  'analytics_annotations','site_clone','site_comparison','social_agent'
);

DELETE FROM feature_flag_overrides WHERE flag_key IN (
  'visitor_events_core','prod_readiness_score','site_health_sparklines','onboarding_progress',
  'platform_mcp','mcp_oauth_provider','mru_cards','usage_gauges','notification_badge',
  'analytics_annotations','site_clone','site_comparison','social_agent'
);
