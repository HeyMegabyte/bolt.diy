# Runbook — Better Auth (embedded) activation + cutover

Better Auth is embedded in the main worker (`src/auth/better-auth.ts`), mounted at
`/api/auth/*` behind the `better_auth` flag. See ADR-0006.

## Secrets (main worker)
- `BETTER_AUTH_SECRET` — session/token secret. Self-generable: `openssl rand -base64 32`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — for Google social (already set for legacy Google).

## Cutover sequence (do NOT skip)
1. **Phase 2** — ship the frontend sign-in UI (email+pw, magic link, Google, 2FA) against `/api/auth/*`.
2. **Phase 3** — backfill existing D1 `users` → Better Auth `user`/`account` tables (no re-register).
3. **Phase 4** — flip the `better_auth` flag ON. Better Auth now owns `/api/auth/*` + issues sessions;
   legacy auth becomes fallback. Verify sign-in/up/magic-link/Google/2FA end-to-end against prod.
4. **Phase 5** — enable the SSO/SAML plugin for enterprise.
5. **Phase 6** — remove `services/auth.ts` (legacy) + the standalone `auth.projectsites.dev` worker.

## Rollback
Flip `better_auth` OFF → `/api/auth/*` falls through to the legacy auth (still present until Phase 6).
Instant, no redeploy.

## Verify (prod smoke, flag on)
- `POST /api/auth/sign-up/email` → creates a user + session.
- `POST /api/auth/sign-in/email` → session cookie set.
- `POST /api/auth/sign-in/magic-link` → email sent (SES/Listmonk).
- Google + 2FA flows complete without console errors.
