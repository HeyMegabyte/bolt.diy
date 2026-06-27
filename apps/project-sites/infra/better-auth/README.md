# auth.projectsites.dev — self-hosted Better Auth (OIDC IdP)

Replaces Logto (which cannot run on Neon — it reads tenant-role passwords from
`pg_authid`, which Neon hides). Better Auth uses plain tables only, so it runs on
Neon natively. Deployed as a CF Workers Container; state lives in Neon Postgres.

## What it is

- A tiny Hono/Node server (`src/index.ts`) running Better Auth with the
  `oidcProvider` plugin → a real OIDC IdP at `/api/auth/oauth2/{authorize,token,userinfo}`.
- The main worker's IdentityProvider port (`src/services/better_auth_provider.ts`,
  ADR-0006) redirects to these endpoints. Ships dark behind `BETTER_AUTH_*`.
- Schema is applied on boot via `getMigrations` (standard DDL, Neon-compatible).
- `/` → `/sign-in` (200 HTML login screen). `/health` → `{ ok: true }`.

## Deploy

```bash
# 1. Create the Neon database (shared project, per neon-database-conservation)
#    → database `projectsites_better_auth`; grab its connection string.
# 2. Set secrets on this worker:
cd apps/project-sites/infra/better-auth
wrangler secret put DATABASE_URL          # postgres://…/projectsites_better_auth?sslmode=require
wrangler secret put BETTER_AUTH_SECRET    # openssl rand -base64 32
wrangler secret put OIDC_CLIENT_ID        # first-party client id
wrangler secret put OIDC_CLIENT_SECRET    # first-party client secret
# 3. Deploy (builds the Dockerfile — needs Docker locally or Workers Builds CI):
wrangler deploy
# 4. Verify the login screen is live:
curl -sI https://auth.projectsites.dev/sign-in   # expect HTTP 200
```

## Wire the main worker

Set the matching secrets on `projectsites` (the main worker) so its IdP port turns on:

```bash
cd apps/project-sites
wrangler secret put BETTER_AUTH_URL --env production            # https://auth.projectsites.dev
wrangler secret put BETTER_AUTH_CLIENT_ID --env production       # same as OIDC_CLIENT_ID
wrangler secret put BETTER_AUTH_CLIENT_SECRET --env production   # same as OIDC_CLIENT_SECRET
```

With all three set, `/api/auth/betterauth/login` goes live (it 404s dark until then,
so the custom magic-link/Google auth stays the live path).
