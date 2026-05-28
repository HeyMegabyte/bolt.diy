# billing — Billing

Stripe checkout, subscriptions, entitlements, and billing portal.

- **Flag key**: `stripe_meters` (metered add-ons gated here; base checkout stable)
- **Lifecycle**: `beta`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/admin-and-billing.spec.ts`
- `e2e/billing/billing-flows.spec.ts`
- `e2e/_fortress/billing/` — adversarial attack surface
- `src/__tests__/billing.test.ts`
