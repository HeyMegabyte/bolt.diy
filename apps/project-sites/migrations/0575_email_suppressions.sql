-- §42/ADR-0019 email deliverability — suppression list + append-only event log.
-- A hard bounce or complaint suppresses an address PLATFORM-WIDE: SES sending
-- reputation is account-level, not per-tenant, so re-sending to a hard-bounced
-- address from ANY tenant damages the shared sending domain. email_suppressions
-- is therefore intentionally NOT tenant-scoped (documented exception to the
-- tenant_id rule). The email seam consults isSuppressed() before every send.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email             TEXT PRIMARY KEY NOT NULL,       -- lowercased recipient
  reason            TEXT NOT NULL,                   -- bounce | complaint
  sub_type          TEXT,                            -- Permanent | abuse | ...
  source_message_id TEXT,                            -- originating SES mail.messageId
  created_at        TEXT NOT NULL
);

-- Append-only deliverability event log (every bounce/complaint notification),
-- for audit + the activation funnel. Platform-level for the same reason.
CREATE TABLE IF NOT EXISTS email_events (
  id                TEXT PRIMARY KEY NOT NULL,
  email             TEXT NOT NULL,
  type              TEXT NOT NULL,                   -- bounce | complaint
  sub_type          TEXT,
  source_message_id TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_events_email ON email_events (email, created_at);
