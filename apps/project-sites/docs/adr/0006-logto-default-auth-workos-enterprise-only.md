# 0006 — Logto default auth, WorkOS enterprise-only

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

The convergence doctrine (§27/§28) prescribes Logto as the app-auth provider and
WorkOS for enterprise SSO/SAML/SCIM. The repo shipped with CUSTOM auth instead —
passwordless magic-link + Google OAuth, with sessions in the D1 `sessions` table
(SHA-256 hashed tokens). That custom auth works and is in production. We want the
prescribed IdPs integrated WITHOUT a risky big-bang replacement of working auth.

## Decision

Introduce an `IdentityProvider` port (`platform/identity.ts`) modelling EXTERNAL
identity via OIDC/SSO, with two adapters:

- **`LogtoIdentityProvider`** (`services/logto_provider.ts`) — the DEFAULT
  consumer-auth IdP. Standard OIDC authorization-code flow against a Logto tenant,
  fetch-based (Workers-native, no SDK).
- **`WorkOsEnterpriseIdentityProvider`** (`services/workos_provider.ts`) — ENTERPRISE
  SSO/SAML only, for org-scoped logins.

`getIdentityProvider(env, { enterprise? })` (`middleware/identity.ts`) selects:
WorkOS when `enterprise` + `WORKOS_*` configured; else Logto when `LOGTO_*`
configured; else **`null`** — in which case the existing custom auth stays the live
path. The IdP replaces only "how the user proves identity"; after `handleCallback`
returns a verified `AuthenticatedUser`, the EXISTING D1 session machinery
(`auth.findOrCreateUser` → `auth.createSession`) issues our session unchanged.

Ships dark: with no `LOGTO_*`/`WORKOS_*` secrets the factory returns null and
nothing changes. Enabling Logto is a config flip (set the secrets + wire the login
routes), per `no-staging-doctrine` (reversible via env).

## Consequences

- **Positive:** the prescribed IdPs are integrated + tested behind a clean port;
  enterprise SSO is available without forcing it on $50/mo SMB logins; the D1
  session model (and everything built on it) is untouched; rollback is unsetting a
  secret.
- **Negative:** two auth code paths coexist during the migration window (custom +
  Logto). Cutover is a deliberate, per-environment step, not automatic.
- **Neutral:** WorkOS `validateSession` is a no-op (SSO returns the profile only at
  exchange; the D1 session is the post-callback source of truth).

## Alternatives considered

- **Big-bang replace custom auth with Logto** — rejected: a one-way-door migration
  (session format, user data, live sessions) with no safety margin. The port +
  ships-dark approach gets the integration in place and lets cutover be gradual.
- **WorkOS for everyone (AuthKit)** — rejected: overkill + cost for SMB solo logins;
  WorkOS is reserved for enterprise per §28.
- **Keep custom auth only, mark deviation** — rejected: Brian's explicit directive is
  to integrate Logto (preferred) + WorkOS (enterprise).

## Migration notes

- Provision `LOGTO_*` (endpoint/app-id/app-secret) and, for enterprise, `WORKOS_*`
  (api-key/client-id) per `docs/runbooks/auth-logto-workos-activation.md`.
- Wire the `/api/auth/logto` + callback routes through `getIdentityProvider` →
  `findOrCreateUser` → `createSession`.
- Custom magic-link/Google remain available as a fallback until Logto is proven in
  prod; then they can be retired in a follow-up.

## Operational risks

- A misconfigured Logto tenant blocks new logins on the Logto path — mitigated by
  keeping custom auth live until proven, and by the null-factory fallback.
- OIDC redirect-URI / CORS misconfiguration — standard OIDC setup hazard; verify in
  the activation runbook before cutover.

## Rollback strategy

- Unset `LOGTO_*` (and `WORKOS_*`) → the factory returns null → custom auth is the
  live path again, no redeploy. D1 sessions are unaffected throughout.
