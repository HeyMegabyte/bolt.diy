/**
 * @module platform/authz-subjects
 *
 * @description
 * The canonical typed-subject/resource naming for authorization tuples (§29).
 * OpenFGA requires typed identifiers (`user:<id>`, `site:<id>`), so both the
 * relationship WRITES (bootstrap) and the CHECKS (requireAuthz) must build them
 * the same way — these helpers are the single source of that convention.
 *
 * @see docs/adr/0005-openfga-authorization-graph.md
 */

/** `user:<id>` — the subject form for a person/API-key identity. */
export function userSubject(userId: string): string {
  return `user:${userId}`;
}

/** `site:<id>` — a generated-site resource. */
export function siteResource(siteId: string): string {
  return `site:${siteId}`;
}

/** `org:<id>` — a tenant/org resource. */
export function orgResource(orgId: string): string {
  return `org:${orgId}`;
}

/** `platform` — the singleton platform resource for super-admin actions. */
export function platformResource(): string {
  return 'platform';
}
