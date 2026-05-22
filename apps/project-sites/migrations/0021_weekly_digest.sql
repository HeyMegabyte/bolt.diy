-- 0021_weekly_digest.sql
-- #96 Weekly summary digest + #97 Stripe Connect onboarding.
-- Both touch the orgs table so they share a migration.
--
-- See: src/services/weekly_digest.ts, src/services/billing.ts (Connect helpers),
--      src/routes/api.ts (billing.connect.*), src/routes/webhooks.ts (account.updated).

-- ─── orgs: digest opt-out + Stripe Connect account caching ──────────────────
-- digest_opt_out flips to 1 when the recipient clicks the signed unsubscribe
-- link emitted in the weekly digest. Idempotent: a second click is a no-op.
ALTER TABLE orgs ADD COLUMN digest_opt_out INTEGER NOT NULL DEFAULT 0;

-- Stripe Connect Standard account id for the org's own payment account.
-- NULL means the org has never started onboarding.
ALTER TABLE orgs ADD COLUMN stripe_connect_account_id TEXT;
ALTER TABLE orgs ADD COLUMN stripe_connect_charges_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN stripe_connect_payouts_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN stripe_connect_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orgs_stripe_connect ON orgs (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL AND deleted_at IS NULL;

-- ─── weekly_digest_sent: idempotency table ──────────────────────────────────
-- One row per (org, ISO week). The weekly cron upserts with INSERT OR IGNORE
-- before sending so a re-run inside the same week never double-sends.
CREATE TABLE IF NOT EXISTS weekly_digest_sent (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  week_iso TEXT NOT NULL, -- e.g. '2026-W21' (year + ISO week number)
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  opens_count INTEGER NOT NULL DEFAULT 0,
  recipient_email TEXT,
  UNIQUE (org_id, week_iso)
);
CREATE INDEX IF NOT EXISTS idx_weekly_digest_sent_org_week
  ON weekly_digest_sent (org_id, week_iso);
CREATE INDEX IF NOT EXISTS idx_weekly_digest_sent_week
  ON weekly_digest_sent (week_iso);
