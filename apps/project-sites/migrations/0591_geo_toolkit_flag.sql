-- 0591_geo_toolkit_flag.sql
-- Feature flag seed for GEO Toolkit (#46, ROI 3.24).
-- Gate: flag OFF by default (enabled=0, experimental). Analysis endpoint
-- returns 404 when disabled. Safe for deploy — read-only content analysis.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_geo_toolkit',
  NULL,
  'geo_toolkit',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"Generative Engine Optimization — dual-scoring content analyzer for traditional SEO + AI answer engine discoverability (ChatGPT, Gemini, Perplexity, Google AI Overviews). Extracts factual claims, checks citation rates, scores AI formatting quality, generates prioritized GEO suggestions. When disabled, analysis endpoints return 404. Risk: none (read-only analysis). Targets: site owners optimizing for AI search visibility. Acceptance: analysis returns dual scores (SEO + AI), A-F grade, factual claims list, and ≥1 actionable suggestion.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/geo_toolkit/analyze.spec.ts"]}'
);
