-- 0627 — Teardown for nl_analytics, customer_portal, ai_payment_command removal (Brian 2026-08-14).
--
-- Flag-row cleanup ONLY — all three are stateless (no feature-owned D1 tables).
-- Runtime SoT is FLAG_REGISTRY (src/modules/feature_flags/registry.ts), already cleaned,
-- so each key resolves to 404 via isFlagOn(). These orphaned config rows are swept for hygiene.
-- NOTE: prod feature_flags keys on `flag_name` (PK `id`); override tables use `flag_key`.

DELETE FROM feature_flags        WHERE flag_name IN ('nl_analytics','customer_portal','ai_payment_command');
DELETE FROM flag_overrides       WHERE flag_key  IN ('nl_analytics','customer_portal','ai_payment_command');
DELETE FROM feature_flag_overrides WHERE flag_key IN ('nl_analytics','customer_portal','ai_payment_command');
