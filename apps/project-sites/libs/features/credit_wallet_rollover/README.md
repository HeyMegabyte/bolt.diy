# credit_wallet_rollover

Monthly credit wallet that accumulates unused subscription credits up to a 3× monthly cap.
Credits apply toward AI generation and premium features.

## Feature flag

**Key:** `credit_wallet_rollover`  
**Default:** `enabled=0, rollout_percent=0, stage='experimental'`

When the flag is **off**, all routes return **404** (never 403).

## API routes

| Method | Path                     | Auth   | Description                                 |
|--------|--------------------------|--------|---------------------------------------------|
| GET    | `/api/credits/balance`   | Bearer | Current wallet balance + plan metadata      |
| POST   | `/api/credits/apply`     | Bearer | Deduct credits (idempotent via optional key)|
| GET    | `/api/credits/history`   | Bearer | Ledger history, newest first (max 200)      |

## D1 table

### `credit_wallet_ledger`

Append-only double-entry ledger. Positive `amount` = credits added; negative = credits consumed.

| Column            | Type    | Notes                                              |
|-------------------|---------|----------------------------------------------------|
| id                | TEXT PK | UUID                                               |
| org_id            | TEXT    | FK → orgs.id                                      |
| kind              | TEXT    | `earned` \| `rollover` \| `applied` \| `expired`  |
| amount            | INTEGER | Positive for earned/rollover; negative for applied |
| balance_after     | INTEGER | Running balance snapshot after this entry          |
| description       | TEXT    | Human-readable reason (nullable)                   |
| idempotency_key   | TEXT    | Caller-supplied dedup key (nullable, unique)       |
| created_at        | TEXT    | ISO 8601 UTC                                       |

### Balance semantics

- **Balance** = `SUM(amount)` across all ledger rows for the org.
- A `rollover` entry grants `MIN(current_balance + monthly_allowance, 3 × monthly_allowance) − current_balance` credits.
- Credits cannot go below 0; `applyCredits` caps the debit to the available balance.

## Monthly rollover logic

`processMonthlyRollover(env, orgId)` is called once per billing cycle:

1. Resolve monthly allowance from `subscriptions.monthly_credits` (default: 100).
2. Compute cap = `allowance × ROLLOVER_CAP_MULTIPLIER` (3).
3. Grant = `MIN(balance + allowance, cap) − balance`.
4. If grant > 0, insert a `rollover` ledger entry.

Returns the **credits granted this cycle** (0 when the wallet is already at/above
the cap). Read the resulting balance separately via `getBalance` if needed.

## Idempotency

`POST /api/credits/apply` accepts an optional `idempotency_key` (max 128 chars). On retry with the same key the prior result is returned without a second debit.

## Safe disabled behavior

When the flag is off, the billing UI should fall back to showing the base plan credits only. No data is accessible or leaked.

## Removal

1. Drop `credit_wallet_ledger` D1 table via a migration.
2. Remove this module folder.
3. Remove the `app.route` mount from `src/index.ts`.
