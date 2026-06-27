# 0005 — OpenFGA as the authorization graph (not authentication)

**Status:** accepted
**Date:** 2026-06-20
**Deciders:** Brian Zalewski

## Context

ProjectSites needs relationship-based authorization across user→org→site→app→
resource, agency-managed client sites, scoped API keys, support delegation, and
subscription→entitlement→feature (§29). Authentication (who you are) is Better Auth's job
(ADR-0006); authorization (what you may do) is a separate graph problem best modeled
as relationship tuples, not scattered `if (user.role === …)` checks.

## Decision

- Authorization flows through an `AuthorizationProvider` port
  (`src/platform/authorization.ts`): `check / batchCheck / writeRelationship /
  deleteRelationship / listObjects`. App code calls `authz.check({ user, relation,
  object })` on dashboard/API/admin/mutation paths.
- **Default deny.** Anything not explicitly granted is refused. Unknown permissions
  resolve to false.
- The role→permission model is explicit (`PERMISSION_RULES`): owner publishes +
  manages billing/api-keys; editor edits but not billing; viewer reads; agency manages
  assigned client sites; platform_admin performs platform actions.
- `FakeAuthorizationProvider` (in-memory graph) is the §16 local mode + test substrate;
  `DenyAllAuthorizationProvider` is the fail-closed default when OpenFGA is unconfigured
  (§58). The real `OpenFgaAuthorizationProvider` is the follow-on adapter.
- NOT on the public static hot path (§29) — only authenticated dashboard/API/admin.

## Consequences

- Positive: one place to reason about access; BOLA/object-level checks (§61) become
  `authz.check` calls; testable model (the §29 cases are unit tests); fail-closed safe.
- Negative: a real OpenFGA deployment + relationship-bootstrap (on user/org/site create)
  is still to build; cached decisions + invalidation (§29) are a later concern.
- Neutral: `PERMISSION_RULES` is the SSOT for what each role may do.

## Alternatives considered

- **Hard-coded role checks in handlers** — rejected: scatters policy, impossible to audit,
  no agency/delegation/scoped-key modeling.
- **Casbin / custom RBAC table** — rejected: OpenFGA's relationship-tuple model fits the
  user→org→site→resource graph natively; the port keeps us swappable anyway.

## Migration notes

- Wire `authz.check` into mutation routes incrementally (start with site
  edit/publish/billing). Bootstrap relationships in the OpenFGA store on tenant/site
  create + Stripe entitlement changes (a follow-on).

## Operational risks

- OpenFGA outage → fail closed for mutations (DenyAll); safe cached reads only by explicit
  policy (§58). A mis-modeled permission grants/denies wrongly — the §29 model tests guard
  the role→permission table.

## Rollback strategy

- Pure port + in-memory providers today (no runtime wiring) — reverting is a file delete.
  Once wired, the provider is swappable (Fake/DenyAll/OpenFGA) behind the port.
