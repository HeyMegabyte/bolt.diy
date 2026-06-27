# Runbook — Self-host customer-facing apps on CF Workers Containers

Stand up Cal.com / Formbricks / Documenso (and future SKUs) as per-app CF Workers
Containers, each on its own subdomain + dedicated Neon DB. Pattern mirrors the live
`llm.megabyte.space` / `crm` / `cms` containers. Cross-refs: `neon-database-conservation`,
`worker-deploy-needs-docker`, `listmonk-mail-subdomain-live`, `cf-access-on-workers-gotchas`.

## Architecture decision (2026-06-27) — CF Workers Containers, NOT Fly.io

Host on **CF Workers Containers** (`cloudflare-lock-in-is-leverage`), not Fly.io. The CF
registry block only affects external `image = "ghcr.io/..."` refs; the working path is
`image = "./containers/<app>/Dockerfile"` with the Dockerfile `FROM <official-image>` — CF
builds it into its own managed registry, no external registry needed.

## The apps

| Brand | OSS app | Subdomain | Neon DB | Multi-tenant |
|---|---|---|---|---|
| cal.diy | Cal.com (repo `github.com/calcom/cal.diy`, NOT calcom/cal.com) | `schedule.projectsites.dev` | `projectsites_calcom` | Teams/Orgs (Orgs was license-gated — verify) |
| (survey) | Formbricks | `survey.projectsites.dev` | `projectsites_formbricks` | Multi-org ✅ |
| (sign) | Documenso | `sign.projectsites.dev` | `projectsites_documenso` | Teams ✅ |

All three are Postgres-only (Neon-native); confirm each repo's current docker-compose before
building (Redis can flip optional→required between majors).

## Per-app wiring (AppRuntimeContainer-subclass pattern — mirror Umami/Outline)

1. `containers/<app>/Dockerfile` = `FROM <official-image>` + `EXPOSE <port>`.
2. `[[env.production.containers]]` in `wrangler.toml`: `class_name = "<App>Container"` + `image = "./containers/<app>/Dockerfile"`.
3. `[[env.production.durable_objects.bindings]]` for the class + migration entry with `new_sqlite_classes = ["<App>Container"]`.
4. DO subclass in `src/durable_objects/app_runtime_subclasses.ts` + add slug to `SUPPORTED_APP_SLUGS`.
5. `BINDING_BY_SLUG['<slug>'] = '<APP>_CONTAINER'` in `src/services/container_dispatcher.ts` + add binding to `Env` (`src/types/env.ts`).
6. Host dispatch: route `survey|schedule|sign`.projectsites.dev → its container (hostname→slug map in the worker dispatch path). **An explicit per-host route is MANDATORY** — the `*.projectsites.dev/*` wildcard otherwise wins and swallows the subdomain (Listmonk incident).
7. Inject app env (DATABASE_URL → the app's dedicated Neon DB, NEXTAUTH_SECRET, etc.) via the AppRuntime env-resolution path.
8. `wrangler deploy --env production` — **Docker daemon MUST be up** (builds all container images).
9. Verify by BODY: `curl -sI https://<sub>.projectsites.dev` → 200 AND body = the app's login/landing HTML (wildcard fallback also returns 200 — assert content, not just status). Real-browser smoke: app shell renders, not blank/SPA-HTML.

## Secrets (per `secret-provisioning-recipe`)

chezmoi → wrangler manifest → Env+Zod → `wrangler secret put` (GLOBAL CF key; `secret put`
needs no Docker, but the container BUILD on deploy does).

- Cal.com: `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, `DATABASE_URL`, SMTP (via Listmonk/Resend)
- Formbricks: `ENCRYPTION_KEY` (EXACTLY 32 chars, `openssl rand -hex 16`), `NEXTAUTH_SECRET`, `DATABASE_URL` — enumerate Formbricks' full required-env zod set (it 500s "Invalid environment variables" with only DB/NEXTAUTH/ENCRYPTION)
- Documenso: `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_SIGNING_*` (cert), `DATABASE_URL`, SMTP

## Neon DBs

Per `neon-database-conservation`: one DATABASE per app inside a shared project (~100 DBs/project;
a new project is NOT justified). Some apps already have dedicated projects (Formbricks
`wild-sound-20069767`, + Twenty/Listmonk/n8n/Strapi/NocoDB/Windmill). Use the neon MCP
(`run_sql`, `get_connection_string`).

## Preconditions + gotchas

- **Docker daemon MUST be running** before any container deploy: `docker info >/dev/null 2>&1 || open -a Docker`, poll until ready. This (not just context thrash) is why early rounds never reached 200.
- **macOS Docker cred fix**: PATH + strip `credsStore` from `~/.docker/config.json` + keychain unlock.
- **Do NOT clone/read upstream source** — bind the official published image; reading repos/lockfiles thrashes context (`subagent_tokens: 0`). Run ONE app per FRESH session (`/clear` first), or sequential — spawning deploy agents from a thrashing parent reproduces the failure regardless of brief leanness.

## Status (as of 2026-06-27)

- Documenso: GO LIVE (`sign.projectsites.dev`).
- cal.diy: staged (`schedule.projectsites.dev`).
- Formbricks: `FormbricksContainer` + slug done; env-set completion pending.
- Each live app becomes an `/admin`-purchasable add-on SKU (booking / surveys / e-sign).
