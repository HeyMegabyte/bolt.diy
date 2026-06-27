# 0006 — Better Auth is the only auth system (embedded)

**Status:** accepted (supersedes the prior external-IdP federation design)
**Date:** 2026-06-27
**Deciders:** Brian Zalewski

## Context

The platform needs one auth system. Earlier iterations explored an OIDC `IdentityProvider`
federation port over external IdPs. That added needless surface and a vendor that did not
fit our Cloudflare-first / Neon-D1 model. Better Auth (Workers-native, D1-compatible) covers
consumer auth, social, magic-link, 2FA, passkeys, and SSO/SAML in one OSS library we own.

## Decision

**Better Auth is the ONLY auth system, EMBEDDED in the main worker.** It runs inside
`apps/project-sites` on the main D1 (Kysely D1 dialect) and OWNS sessions directly.

- Module: `src/auth/better-auth.ts` (`makeAuth(env)`), mounted at `/api/auth/*`.
- Methods: email+password, magic link (via the existing SES/Listmonk email path), Google
  social, TOTP 2FA. Passkeys (WebAuthn) and SSO/SAML land in later slices.
- Tables: singular `user`/`session`/`account`/`verification` + plugin tables — no collision
  with the legacy plural `users`/`sessions` during migration.
- Cutover is gated by the `better_auth` flag: ON → Better Auth owns `/api/auth/*`; OFF →
  the legacy magic-link/Google/D1-session auth (`services/auth.ts`) stays live until the
  frontend sign-in UI + user-migration backfill land.

## Consequences

- **Positive:** one OSS auth system, fully owned, CF-native (D1, no external IdP); social +
  magic-link + 2FA + passkeys + SSO under one roof; no federation port.
- **Negative:** a real migration (backfill users; swap the session model); one-way once cutover completes.
- **Removed:** the OIDC federation port (`platform/identity.ts`, `middleware/identity.ts`,
  `routes/auth_idp.ts` + its provider adapters) and (later) the standalone
  `auth.projectsites.dev` worker.

## Alternatives considered

- External consumer IdP — D1-incompatible; rejected.
- A second enterprise-SSO vendor — Better Auth's SSO plugin covers it natively; rejected.
- Keeping the bespoke magic-link/Google/D1-session auth — no 2FA/passkeys/SSO and more custom
  code than one OSS library; superseded.
