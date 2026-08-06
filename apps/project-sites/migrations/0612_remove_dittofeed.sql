-- 0612_remove_dittofeed.sql
-- Completely removes the Dittofeed customer-engagement integration (Brian, 2026-08-06).
--
-- The whole Dittofeed surface was deleted in the same change: the client + dispatch +
-- wiring + outbox + embed + site-lifecycle services, the /api/dittofeed/* route mount,
-- the DITTOFEED_* env vars, the platform service-registry entry, the system-status probe,
-- and the feature-flag registry + docs entries. This migration drops the live flag rows
-- so no orphaned `dittofeed_integration` flag remains in D1. Supersedes migration 0583.
--
-- Lifecycle messaging is covered by the native notification stack + Listmonk per ADR-0034
-- (platform consolidation to CF-native). Forward-only + idempotent; safe on a fresh DB.
DELETE FROM feature_flags WHERE flag_name = 'dittofeed_integration';
DELETE FROM flag_overrides WHERE flag_key = 'dittofeed_integration';
DELETE FROM feature_flag_overrides WHERE flag_key = 'dittofeed_integration';
