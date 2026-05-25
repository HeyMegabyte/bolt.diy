-- 0036_wallet_billing.sql
--
-- Stripe wallet billing system + super-admin cost-factor controls.
--
-- Business model:
--   - User subscribes to a $50/month plan via Stripe (Subscription + SetupIntent
--     captures a default payment method).
--   - The $50 funds a per-org wallet stored in D1. Every chargeable event
--     (domain register, container minute, AI token, image gen, snapshot, etc)
--     bills at base_cost_cents × quantity × markup_factor against the wallet.
--   - markup_factor is per-category, super-admin-tunable (default 1.5 = 50% margin).
--   - Wallet < $5 → auto-top-up via stored payment method (background, no UX).
--   - Sufficient balance + stored PM = zero-friction background charges
--     (no popups, no checkout, instant confirmation toast).
--
-- Tables:
--   wallet_accounts        - one row per org (subscription + balance + auto-topup settings)
--   cost_categories        - tunable cost catalog (slug, base_cost, markup_factor)
--   wallet_transactions    - audit ledger (every credit/debit/refund/adjustment)
--   users.is_super_admin   - new column gating /super-admin routes
--
-- All amounts are signed cents (positive=credit, negative=debit). balance_after
-- on every transaction lets us reconcile without summing the full ledger.

-- ─── Per-org wallet accounts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_default_payment_method TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',   -- active|past_due|canceled|inactive
  balance_cents INTEGER NOT NULL DEFAULT 0,
  auto_topup_threshold_cents INTEGER NOT NULL DEFAULT 500,    -- $5 trigger
  auto_topup_amount_cents INTEGER NOT NULL DEFAULT 5000,      -- top up $50
  monthly_credit_cents INTEGER NOT NULL DEFAULT 5000,         -- the $50/mo subscription credit
  last_topup_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wallet_org ON wallet_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_wallet_status ON wallet_accounts(subscription_status);

-- ─── Configurable cost catalog (super-admin tunable) ────────────────────────
CREATE TABLE IF NOT EXISTS cost_categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,                          -- 'domain' | 'minute' | '1k_tokens' | 'image' | etc
  base_cost_cents INTEGER NOT NULL,            -- our cost
  markup_factor REAL NOT NULL DEFAULT 1.5,     -- super-admin tunable (0.5-5.0)
  min_charge_cents INTEGER NOT NULL DEFAULT 1,
  billable INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Wallet transactions (audit ledger) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  direction TEXT NOT NULL,                     -- credit | debit | refund | adjustment
  category_slug TEXT,                          -- references cost_categories.slug for debits
  quantity REAL,                               -- number of units consumed
  base_cost_cents INTEGER,                     -- cost at time of charge (audit-frozen)
  markup_factor REAL,                          -- factor at time of charge (audit-frozen)
  amount_cents INTEGER NOT NULL,               -- signed: +credit / -debit
  balance_after_cents INTEGER NOT NULL,
  reference_type TEXT,                         -- 'domain' | 'app_instance' | 'workflow' | 'snapshot' | 'topup' | 'subscription'
  reference_id TEXT,
  stripe_event_id TEXT,                        -- on credits — Stripe invoice or PI id
  metadata_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_org_created ON wallet_transactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_category ON wallet_transactions(category_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_stripe ON wallet_transactions(stripe_event_id) WHERE stripe_event_id IS NOT NULL;

-- ─── Super-admin role flag ──────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

-- ─── Promote Brian to super-admin on apply (single-user shop) ──────────────
UPDATE users SET is_super_admin = 1 WHERE email = 'brian@megabyte.space';

-- ─── Seed cost_categories ──────────────────────────────────────────────────
-- All base costs cited from public Cloudflare + vendor pricing pages (2026).
-- Default markup_factor = 1.5 (50% margin). Super-admin can tune per-row.
INSERT INTO cost_categories (slug, label, unit, base_cost_cents, markup_factor, min_charge_cents, billable, description) VALUES
  ('domain_register',     'Domain registration',           'domain',         1200, 1.5, 100, 1, 'Cloudflare Registrar at-cost: avg .com $9.15/yr → ~$12 buffer; passthrough TLD cost varies per query.'),
  ('container_minute',    'Container compute',             'minute',            5, 1.5,   1, 1, 'Cloudflare Containers: $0.000020/vCPU-sec → $0.0012/min standard instance.'),
  ('ai_token_in',         'LLM input tokens',              '1k_tokens',         1, 1.5,   1, 1, 'Workers AI Llama 3.3 70B: ~$0.001/1k input tokens; OpenAI/Anthropic fallback varies.'),
  ('ai_token_out',        'LLM output tokens',             '1k_tokens',         2, 1.5,   1, 1, 'Workers AI Llama 3.3 70B: ~$0.002/1k output tokens; OpenAI/Anthropic fallback varies.'),
  ('image_gen_dalle3',    'DALL-E 3 image',                'image',           400, 1.5,   1, 1, 'OpenAI DALL-E 3 standard 1024x1024: $0.040/image.'),
  ('screenshot',          'Page screenshot',               'screenshot',       20, 1.5,   1, 1, 'Cloudflare Browser Rendering: ~$0.002/screenshot.'),
  ('workflow_step',       'Workflow step',                 'step',              3, 1.5,   1, 1, 'Cloudflare Workflows: ~$0.000025/step + included tier.'),
  ('r2_storage_gb_month', 'R2 storage',                    'gb_month',        150, 1.5,   1, 1, 'Cloudflare R2: $0.015/GB-month standard storage.'),
  ('r2_class_a_op_1k',    'R2 write ops',                  '1k_ops',           45, 1.5,   1, 1, 'Cloudflare R2: $0.0045/1k Class A operations.'),
  ('r2_class_b_op_1k',    'R2 read ops',                   '1k_ops',            4, 1.5,   1, 1, 'Cloudflare R2: $0.00036/1k Class B operations.'),
  ('email_send',          'Transactional email',           'email',             4, 1.5,   1, 1, 'Resend: $0.0004/email at the volume tier.');
