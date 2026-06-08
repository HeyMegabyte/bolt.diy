-- 0538_drop_automation_recipes.sql
-- Cleanup: the Automation Builder (#11) feature was removed 2026-06-08 (route +
-- services + flag + admin section all deleted). Drop its now-orphaned table so
-- the schema reflects the removal. IF EXISTS — idempotent + a no-op on any DB
-- where 0533 (the CREATE) was never applied (e.g. production, which never had it).
-- Recoverable within 30 days via D1 Time Travel if ever needed.
DROP TABLE IF EXISTS automation_recipes;
