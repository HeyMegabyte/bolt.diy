# donations_engine

Donorbox-class fundraising layer for customer sites: one-time gifts, monthly
recurring donations, DAFpay (Donor-Advised Fund routing via Fidelity/Schwab/
Vanguard), and memorial gifts.

## What it does

- Embeds a donation widget (`/_widget/donate.js` + `/_widget/donate/embed`)
  as a sandboxed iframe on any customer site page.
- Processes payments via **Stripe Link Express Checkout** with a 1.5 %
  platform `application_fee` via Stripe Connect.
- Supports one-time amounts and recurring subscriptions (monthly/annual).
- Tax receipt auto-issued via Resend within 30 s of Stripe webhook fire.

## Where surfaces live

| Surface | Path |
|---------|------|
| Checkout API | `src/routes/search.ts` — `POST /api/donate` (~line 2887) |
| Widget JS served | `src/routes/public.ts` — `GET /_widget/donate*` |
| Billing service | `src/services/billing.ts` — Stripe Connect checkout helpers |
| Admin UI (DRIFT) | Not yet — needs `frontend/…/admin/sections/donations.component.ts` |

## Flag key

`donations_engine` — default off (`enabled=0, rollout_percent=0, stage='experimental'`).

Enable for your org in `/admin/feature-flags` or via the DB:
```sql
UPDATE feature_flags SET enabled_globally = 1 WHERE key = 'donations_engine';
```

## Tests

| Suite | Files |
|-------|-------|
| Unit | `src/__tests__/billing.test.ts` (Stripe checkout session tests) |
| E2E (tangential) | `e2e/forms-handling-widget.spec.ts` |
| E2E (DRIFT) | **Missing** — `e2e/donations_engine/` needs to be created |

## Drift notes

- No dedicated D1 tables yet (uses `subscriptions` + Stripe as source of truth).
- No Angular admin component for donation stats / history.
- No dedicated E2E spec — `e2e/donations_engine/` directory is missing.
- Consider: `_widget/donate.js` should be flag-gated on the serve path (currently
  it is served unconditionally; the checkout endpoint is gated).

## How to enable for testing

```bash
# Add an override for your org
curl -X POST https://projectsites.dev/api/super-admin/feature-flags/donations_engine/override \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"org_id":"<your_org_id>","enabled":1}'
```

## Removal

See `removalNotes` in `feature.manifest.ts`.
