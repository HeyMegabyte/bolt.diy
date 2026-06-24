# Runbook — Activate Logto (default) + WorkOS (enterprise) Auth (§27/§28, ADR-0006)

The `IdentityProvider` port + Logto/WorkOS adapters + factory ship DARK behind env
gates. With no `LOGTO_*`/`WORKOS_*` secrets the factory returns null and the
existing custom auth (magic-link + Google OAuth + D1 sessions) stays live. These
steps turn on Logto, then optionally WorkOS for enterprise. Each is reversible
(unset the secret → custom auth resumes, no redeploy).

## What is already built (no code work remaining)

- `platform/identity.ts` — IdentityProvider port + AuthenticatedUser + FakeIdentityProvider.
- `services/logto_provider.ts` — LogtoIdentityProvider (OIDC code flow, fetch-based).
- `services/workos_provider.ts` — WorkOsEnterpriseIdentityProvider (SSO code flow).
- `middleware/identity.ts` — `getIdentityProvider(env, { enterprise? })` (Logto default, WorkOS enterprise, null→custom-auth).
- Tested end-to-end (identity.test.ts). Registry: `auth-logto`, `auth-workos`.

## Step 1 — Create the Logto application

1. In your Logto tenant (`https://<tenant>.logto.app`), create a **Traditional Web**
   application.
2. Set the redirect URI to `https://api.projectsites.dev/api/auth/logto/callback`
   and the post-logout redirect to `https://app.projectsites.dev`.
3. Note the App ID + App Secret + the tenant endpoint.

## Step 2 — Set the Logto secrets (flips Logto on)

```bash
cd apps/project-sites
# vars (wrangler.toml [env.production.vars] or secret):
#   LOGTO_ENDPOINT = https://<tenant>.logto.app
#   LOGTO_APP_ID   = <app id>
npx wrangler secret put LOGTO_APP_SECRET --env production
```

The moment `LOGTO_ENDPOINT` + `LOGTO_APP_ID` + `LOGTO_APP_SECRET` are all set,
`getIdentityProvider(env)` returns the Logto adapter and the live
`GET /api/auth/logto/login` route (`routes/auth_idp.ts`) drives the OIDC flow →
`handleCallback` → `findOrCreateUser` → `createSession`. Until the secrets are
set the route 404s (ships dark) and the custom magic-link/Google auth stays live.

## Step 3 — (Optional) WorkOS enterprise SSO

```bash
# WorkOS dashboard: create an SSO connection per enterprise org; note the API key + client id.
#   WORKOS_CLIENT_ID = client_xxx   (var)
npx wrangler secret put WORKOS_API_KEY --env production
```

Enterprise org-scoped logins pass `{ enterprise: true, organizationId }` to the
factory → WorkOS; everyone else stays on Logto.

## Step 4 — Verify

- Hit `GET /api/auth/logto/login` → expect a 302 to `https://<tenant>.logto.app/oidc/auth?...`
  (a one-time CSRF `state` is stored in KV for the callback to verify).
- Before secrets are set, `GET /api/auth/logto/login` returns 404 `{ error: { code: 'NOT_FOUND' } }` — confirms the route is mounted + dark.
- Complete a login → callback verifies state, exchanges the code, and `findOrCreateUser`
  → `createSession` issues a D1 `sessions` row; the user lands on `/?token=…&auth_callback=logto`.
- For WorkOS: `GET /api/auth/workos/login?org=<org>` → expect a 302 to
  `https://api.workos.com/sso/authorize?...&organization=<org>`.

## Step 5 — (Later) retire the custom auth path

Once Logto is proven in prod, the magic-link/Google routes can be removed in a
follow-up and `auth-logto` promoted to the sole consumer-auth rail.

## Rollback

- Unset `LOGTO_*` (and `WORKOS_*`) → `getIdentityProvider` returns null → custom
  magic-link/Google auth is live again, no redeploy. D1 sessions are unaffected.

## See

- `docs/adr/0006-logto-default-auth-workos-enterprise-only.md` — the decision.
- `~/.agentskills/` auth doctrine (§27/§28).
