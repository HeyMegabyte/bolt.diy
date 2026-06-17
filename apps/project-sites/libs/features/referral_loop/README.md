# referral_loop

Viral referral system that credits referrers when their referred user upgrades to paid.

## Feature flag

| Key | Stage | Default |
|-----|-------|---------|
| `referral_loop` | experimental | disabled |

Enable via `/admin/feature-flags`. Do NOT enable in production until the credit
issuance webhook handler is wired and tested end-to-end.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/referral/code` | Required | Get or create the caller-org referral code |
| POST | `/api/referral/track` | Optional | Record a click on a referral URL |
| GET | `/api/referral/stats` | Required | Caller-org referral stats |

All routes return `404` when the flag is off. `GET /api/referral/code` and
`GET /api/referral/stats` return `401` when called without a valid session.

## D1 tables

- `referral_codes` — one row per org; stores the unique code + click/conversion counters
- `referral_attributions` — one row per click; status progresses `click -> signup -> converted`

Both tables are seeded by migration `0542_native_booking_credit_referral.sql`.

## Credit issuance

Credits are NOT yet issued automatically. The `referral_attributions.status` column
tracks progress. When a referred org upgrades to paid, a Stripe webhook handler
should:

1. Locate the `referral_attributions` row for the org.
2. Update `status = 'converted'` and set `converted_at = datetime('now')`.
3. Increment `referral_codes.conversions`.
4. Insert a `credit_wallet_ledger` row for the referrer org (direction = `credit`).

## Safe disabled behavior

When `referral_loop` is off, all three routes return `404`. No existing data is
modified; the tables remain intact for when the flag is re-enabled.

## Removal

Remove this module, unmount from `src/index.ts`, drop
`referral_codes` + `referral_attributions` tables, and delete the
`referral_loop` feature flag row.
