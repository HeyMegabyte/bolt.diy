# hostnames

Owns the **custom-hostname lifecycle** for a site — the Cloudflare-for-SaaS (CF4SaaS)
custom domains + free `*.projectsites.dev` subdomains that map to a site, the primary-
hostname (canonical URL) toggle, and the admin-side verify / health / deprovision ops.

Extracted VERBATIM from `src/routes/api.ts` (route-decomposition **installment 12**) —
byte-for-byte handler bodies, only the Hono receiver changed (`api.` → `hostnames.`).

## Owns two surfaces, one resource

This module owns the `hostnames` D1 resource across BOTH paths it is reached through:

- **Owner surface** — `/api/sites/:siteId/hostnames/*` (org-scoped self-service:
  list, provision, set-primary, reset-primary, delete, unsubscribe).
- **Admin surface** — `/api/admin/domains/*` (historical path naming; the SAME
  `hostnames` table, org-scoped — NOT super-admin-gated: summary stats, live CF4SaaS
  re-verify, read-only health probe, hard deprovision).

The `/api/admin/domains/*` prefix is a legacy name. Those routes org-scope by comparing
`hostnames.org_id` to `c.get('orgId')` (cross-org → 404, never 403). The site-scoped
routes additionally guard via `requireOwnedSite`.

## Routes

| Method | Path                                                  | Auth  | Purpose                                                |
| ------ | ----------------------------------------------------- | ----- | ------------------------------------------------------ |
| GET    | /api/sites/:siteId/hostnames                          | orgId | List a site's provisioned hostnames                    |
| POST   | /api/sites/:siteId/hostnames                          | orgId | Provision a free subdomain OR a custom CF4SaaS domain  |
| PUT    | /api/sites/:siteId/hostnames/:hostnameId/primary      | orgId | Mark a hostname as the site's primary (canonical)      |
| POST   | /api/sites/:siteId/hostnames/reset-primary            | orgId | Clear all `is_primary` → fall back to default subdomain |
| DELETE | /api/sites/:siteId/hostnames/:hostnameId              | orgId | Hard-delete a hostname row (+ CF4SaaS de-register)     |
| POST   | /api/sites/:siteId/hostnames/:hostnameId/unsubscribe  | orgId | Soft-delete a premium hostname (billing reconciliation) |
| GET    | /api/admin/domains/summary                            | orgId | Aggregate hostname stats for the caller's org          |
| POST   | /api/admin/domains/:hostnameId/verify                 | orgId | Force a CF4SaaS re-verify + persist + owner email      |
| GET    | /api/admin/domains/:hostnameId/health                 | orgId | Live CF status + DNS CNAME probe (read-only)           |
| DELETE | /api/admin/domains/:hostnameId                        | orgId | Hard deprovision (remove CF custom hostname + soft-del) |

## Flag / gating

**No feature flag** — core custom-hostname capability, always on. Custom domains are
**entitlement-gated** (paid-plan `topBarHidden` check inside the POST handler), not
flag-gated. Same class as the sibling route-organization extractions
(`domains`/`billing`/`siteVersioning`). Added to the base ALLOWLIST in
`scripts/validate-feature-drift.mjs`.

## Safe disabled behavior

Not disable-able (no flag). If the module were unmounted, every hostname route would
404 and sites would fall back to their default `{slug}.projectsites.dev` subdomain
(the wildcard Worker route still resolves those from D1 independent of this module).

## Dependencies

- `domainService` (`../../../src/services/domains.js`) — `getSiteHostnames`,
  `provisionFreeDomain`, `provisionCustomDomain`, `checkCnameTarget`,
  `setPrimaryHostname`, `checkHostnameStatus`, `deleteCustomHostname`
- `billingService` (`../../../src/services/billing.js`) — `getOrgEntitlements`
- `auditService` (`../../../src/services/audit.js`) — `writeAuditLog`
- `dbQuery` / `dbQueryOne` (`../../../src/services/db.js`)
- `requireOwnedSite` (`../../../src/services/site_ownership.js`)
- `posthog` (`../../../src/lib/posthog.js`) — `trackDomain`
- `createHostnameSchema`, `DOMAINS`, error helpers from `@project-sites/shared`
- `Env` / `Variables` from `../../../src/types/env.js`
- Dynamic imports (kept off the hot-path bundle): `../../../src/services/notify.js`
  (`notifyUser`, `notifyEvent`), `../../../src/services/db.js` (`dbUpdate`),
  `../../../src/services/notifications.js` (`notifyDomainVerified`)

## Not moved (stayed in api.ts)

`DELETE /api/sites/:id` (site soft-delete) sat physically between the owner-scoped
hostname POST and PUT in the original file. It is NOT a hostname route — it remains in
`api.ts`, untouched.
