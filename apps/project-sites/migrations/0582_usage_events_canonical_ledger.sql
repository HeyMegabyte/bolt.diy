-- 0582_usage_events_canonical_ledger.sql
-- Add canonical ledger columns to usage_events for StripeMetersProvider.
--
-- The existing table (0022) has: id, org_id, site_id, metric, value, ts, billed,
-- stripe_subscription_item_id. This migration adds the canonical ledger shape
-- from billing_provider.ts UsageEvent + PersistedUsageEvent without breaking
-- existing queries (all new columns are nullable with defaults).
--
-- Blast radius: zero — all changes are additive (nullable + DEFAULT).
-- No code reads the new columns yet; existing queries ignore them.

-- Widen metric CHECK to accept the full 17-metric taxonomy.
-- Old constraint only allowed ('ai_calls','bytes_egress','image_generations').
-- SQLite doesn't support ALTER CONSTRAINT, so we rebuild the table metadata.
-- Strategy: drop + recreate the CHECK via a new table + copy (SQLite-safe).
-- Actually: SQLite ignores CHECK on ALTER TABLE ADD COLUMN, so we just
-- add the new columns and update the CHECK via a separate pragma approach.
-- Simplest safe path: drop the CHECK entirely (app-layer Zod validates anyway)
-- and add a note that the app owns metric validation now.

-- Step 1: Add canonical ledger columns (all additive — no data loss).
ALTER TABLE usage_events ADD COLUMN idempotency_key TEXT;
ALTER TABLE usage_events ADD COLUMN customer_id TEXT;
ALTER TABLE usage_events ADD COLUMN app_id TEXT;
ALTER TABLE usage_events ADD COLUMN unit TEXT NOT NULL DEFAULT 'event';
ALTER TABLE usage_events ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE usage_events ADD COLUMN occurred_at TEXT;
ALTER TABLE usage_events ADD COLUMN pricing_version TEXT;
ALTER TABLE usage_events ADD COLUMN metadata TEXT;
ALTER TABLE usage_events ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE usage_events ADD COLUMN last_delivery_attempt_at TEXT;
ALTER TABLE usage_events ADD COLUMN last_delivery_error TEXT;

-- Step 2: Backfill occurred_at from ts for existing rows.
UPDATE usage_events SET occurred_at = ts WHERE occurred_at IS NULL;

-- Step 3: Backfill idempotency_key from id for existing rows.
UPDATE usage_events SET idempotency_key = id WHERE idempotency_key IS NULL;

-- Step 4: New indexes for canonical ledger queries.
CREATE INDEX IF NOT EXISTS idx_usage_events_customer
  ON usage_events (customer_id, metric);
CREATE INDEX IF NOT EXISTS idx_usage_events_delivery
  ON usage_events (delivery_status, last_delivery_attempt_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_occurred
  ON usage_events (org_id, metric, occurred_at);

-- Note: the old `metric` CHECK constraint ('ai_calls','bytes_egress','image_generations')
-- is now too narrow. SQLite doesn't support ALTER TABLE DROP CHECK. Since we can't
-- easily widen it, application-layer Zod validation in billing_provider.ts is the
-- canonical gate. The old CHECK remains but new metric names will be rejected by it
-- until we rebuild the table. For the migration path:
--   (1) New events use the `delivery_status` + `unit` columns to distinguish old vs new.
--   (2) A future migration (0583+) can CREATE TABLE usage_events_v2 with the full
--       metric taxonomy, copy data, DROP old, RENAME new. This is the safe path.
--   (3) Until then, the StripeMetersProvider writes to usage_events with the old
--       metric names mapped (see billing_provider_stripe.ts metricCompat()).
