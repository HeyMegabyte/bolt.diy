# email

Transactional-email surface — the **weekly-digest** lifecycle endpoints: the
public one-click unsubscribe link shipped in every digest, and the authenticated
org-scoped manual digest trigger. **Core, un-gated** routes (no feature flag) — a
route-organization module extracted from the `api.ts` monolith (route-decomposition
installment 6), not a dark-launched feature. Extracted FIRST in its fire to
de-interleave the billing-admin region that surrounded these two routes.

## Routes (`handlers.ts` → `email`, mounted at `app.route('/', email)`)

| Method | Path                        | Auth   |
| ------ | --------------------------- | ------ |
| GET    | `/api/email/unsubscribe`    | public |
| POST   | `/api/email/digest/trigger` | orgId  |

## Boundaries

- `GET /api/email/unsubscribe?token=…` is public by design — the link lands in an
  inbox with no session. It is guarded by a signed token verified via
  `verifyUnsubscribeToken` (secret: `WEEKLY_DIGEST_SECRET`, falling back to
  `STRIPE_WEBHOOK_SECRET`); a valid token flips `orgs.digest_opt_out = 1` and
  returns a branded HTML confirmation. Missing/invalid token → 400 HTML.
- `POST /api/email/digest/trigger` is org-scoped via `c.get('orgId')`
  (`unauthorized()` → 401 when absent) and delegates to the same
  `sendWeeklyDigestsForAllOrgs` cron entrypoint so an owner can preview on demand.
- Both delegate to `services/weekly_digest.ts`. No request body is parsed (token is
  a query param; trigger takes no body), so there is no `schemas.ts`. Known
  AppErrors bubble to the app-level error handler unchanged.
