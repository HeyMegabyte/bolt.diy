CREATE TABLE IF NOT EXISTS credit_wallet_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_org ON credit_wallet_ledger(org_id, created_at);
