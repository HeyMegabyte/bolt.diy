# Infra Services

> Consolidated per-service infra notes (folded from per-folder `README.md`, 2026-06-27).
> One section per self-hosted/infra service. Container↔subdomain SSOT is `docs/CONTAINER_MANIFEST.md`.



---

## better-auth

# auth.projectsites.dev — self-hosted Better Auth (OIDC IdP)

Replaces Better Auth (which cannot run on Neon — it reads tenant-role passwords from
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


---

## hatchet

# jobs.projectsites.dev — Hatchet on CF Workers Containers

Distributed task queue/orchestration. Brian 2026-06-25: jobs. → Hatchet INSTEAD of
Inngest (events. stays Inngest). hatchet-lite = single container (port 8888), Postgres → Neon.

## Deploy (proven container playbook)
1. `npm install`
2. Neon DB `projectsites_hatchet` in the SHARED project (neon-database-conservation).
3. **Generate encryption keysets** (Hatchet's one extra step vs the others):
   `docker run --rm ghcr.io/hatchet-dev/hatchet/hatchet-admin:latest /hatchet-admin keyset create-local-keys`
   → prints MASTER + JWT_PUBLIC + JWT_PRIVATE base64 keysets. Set each as a secret.
4. Secrets: `DATABASE_URL` (Neon `postgresql://...?sslmode=require`),
   `SERVER_AUTH_COOKIE_SECRETS` (`"$(openssl rand -hex 16),$(openssl rand -hex 16)"`),
   `SERVER_ENCRYPTION_MASTER_KEYSET`/`_JWT_PUBLIC_KEYSET`/`_JWT_PRIVATE_KEYSET`,
   `SERVER_DEFAULT_ADMIN_EMAIL`/`_PASSWORD`.
5. Explicit route `jobs.projectsites.dev/*` → `projectsites-hatchet` + WAF skip host.
6. Detach jobs. from Inngest: in `src/inngest/serve.ts`, change `isInngestServerHost` to
   match ONLY `events.${DOMAINS.SITES_BASE}` (drop the `jobs.` clause) + redeploy main worker.
7. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy`; verify `/` 200 (dashboard).

## Gotchas (Inngest/Skyvern/Langfuse arc)
- Container DO → `new_sqlite_classes`. `@cloudflare/containers` ^0.3.3 → object-form start.
- Hatchet needs the 3 encryption keysets (step 3) — the one extra step vs the others.
- Run the image locally first (`docker run -e DATABASE_URL=... ... hatchet-lite`) to read the
  boot/migration output (the repro technique that cracked Inngest + Skyvern).


---

## langfuse

# traces.projectsites.dev — Langfuse v2 on CF Workers Containers

LLM observability/tracing. Single Next.js container (port 3000), Postgres → Neon.
Use the **v2** line (`langfuse/langfuse:2`) — v3 needs ClickHouse+Redis+S3 (excluded).
Mirrors infra/listmonk + infra/skyvern. Deployed live 2026-06-25.

## Deploy (proven playbook)
1. `npm install`
2. Neon DB `projectsites_langfuse` in the SHARED project (neon-database-conservation).
3. Secrets: `DATABASE_URL` (standard `postgresql://...?sslmode=require` — Prisma, NOT asyncpg),
   `NEXTAUTH_SECRET` (`openssl rand -base64 32`), `SALT` (same), `ENCRYPTION_KEY` (`openssl rand -hex 32`).
4. Explicit route `traces.projectsites.dev/*` → `projectsites-langfuse` + WAF skip host.
5. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy`.
6. Verify `/api/public/health` 200 + `/` 200 (Langfuse serves a UI at root — no rewrite needed).

## Gotchas
- Container DO → `new_sqlite_classes`. `@cloudflare/containers` ^0.3.3 → object-form start.
- Langfuse is Node/Prisma → STANDARD `postgresql://` URL (NOT asyncpg, unlike Skyvern).
- First boot runs `prisma migrate deploy` (slow, ~30-60s) then binds :3000.


---

## listmonk

# mail.projectsites.dev — Listmonk on CF Workers Containers

Listmonk (newsletter/list manager) hosted as a Cloudflare Workers Container.
Adapted from `njsk.org/infra/listmonk`. Stateless container (port 9000) backed by
Neon Postgres; mail relays through Amazon SES (ADR-0019).

## Deploy (from this dir)
1. **Neon DB** — create a `projectsites_listmonk` database + role (via Neon MCP/console).
2. **Secrets** — `npm install`, then `wrangler secret put` for: `PG_HOST PG_USER PG_PASSWORD PG_DATABASE ADMIN_USER ADMIN_PASSWORD` (+ `SES_SMTP_HOST/USER/PASSWORD` for sending). `ADMIN_PASSWORD` = `openssl rand -base64 24`.
3. **Deploy** — `wrangler deploy` (builds the Dockerfile image — needs Docker locally OR push to CI). Creates the `mail.projectsites.dev` custom-domain route.
4. **Verify** — `curl https://mail.projectsites.dev/` → Listmonk login (200); first boot runs `--install` against Neon.

## Launch from Admin → Apps
A catalog entry points the Apps section's "Listmonk" tile at `https://mail.projectsites.dev`.


---

## litellm

# llm.projectsites.dev — LiteLLM proxy on CF Workers Containers

OpenAI-compatible `/v1` gateway (LiteLLM) with native cost/quality routing, in one
container image. Mirrors `infra/listmonk`. Stateless container (port 4000); model creds
via wrangler secrets.

## Deploy (from this dir) — proven container playbook
1. `npm install`
2. Secrets — `wrangler secret put` for: `LITELLM_MASTER_KEY` (`sk-$(openssl rand -hex 24)`),
   plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` (per provider in config.yaml).
3. **Cutover routing** — the main `project-sites` worker currently serves `llm.` (landing +
   `/v1/*`). Either (a) keep `custom_domain` in wrangler.toml + add an EXPLICIT Workers route
   `llm.projectsites.dev/*` → `projectsites-litellm` (more specific than the wildcard — wins),
   AND remove the main worker's `llm.` landing handler; or (b) leave `/v1/*` on the main worker
   and route only the LiteLLM UI. Decide at deploy time.
4. WAF — broaden the existing skip rule (`9c8324ff…`, zone `9ceaa211…`) to include
   `llm.projectsites.dev` so proxy POSTs aren't challenged (5-rule phase cap → broaden, don't add).
5. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy` (Docker needed for the build;
   global CF key for container deploys).
6. Verify — `curl https://llm.projectsites.dev/health/liveliness` → 200; `curl .../v1/models`
   with `Authorization: Bearer $LITELLM_MASTER_KEY` lists the model_list.

## Gotchas (learned from the Inngest/Listmonk arc)
- Container DO → `new_sqlite_classes` (NOT `new_classes`; CF API error 10074).
- `@cloudflare/containers` ^0.3.3 → object-form `startAndWaitForPorts({ports, cancellationOptions})`.
- LiteLLM root `/` serves the admin UI (200); health is `/health/liveliness`.


---

## payload

# Payload CMS — cms.projectsites.dev

Payload 3.85 (Next.js standalone) on a Cloudflare Workers Container. Schema + content
in Neon Postgres; media in R2; behind Cloudflare Access. Admin at `/admin`, public
frontend at `/`.

## Schema migrations (REQUIRED — `push:true` is dev-only)

Payload's postgres `push:true` does NOT create the schema in production. Apply
migrations with `./migrate.sh` (runs the Payload CLI in a Node-22 container against
Neon — the local Mac's Node 26 breaks Payload's tsx loader). Run once for the initial
schema, and again after any collection change. Tables come from `app/src/migrations/*`,
NOT from a boot-time push. First admin: `/admin/create-first-user`.

- `./migrate.sh` — create (diff schema → new migration) + apply.
- `./migrate.sh apply` — apply existing migrations only (also runs on container boot).

## Architecture

- **Collections** — `Posts` (blog), `Pages` (page-builder blocks), `Categories`
  (nested taxonomy), `Tags`, `Media` (R2 + responsive sizes), `Users` (roles + auth).
- **Globals** — `Header`, `Footer`, `SiteSettings`.
- **Access** (`src/access/`) — role-based + row-level helpers (`admins`, `editors`,
  `publishedOrAuth`, `adminsOrSelf`, field-level `adminsFieldLevel`).
- **Editor** (`src/lexical.ts`) — fixed/inline toolbar, internal-doc links, inline blocks.
- **Blocks** (`src/blocks/`) — Hero, Content, MediaBlock, CallToAction, Archive.
- **Hooks** (`src/hooks/`) — `populatePublishedAt`, virtual `readingTime`, on-demand
  ISR `revalidate`.
- **Plugins** — SEO, redirects, search, form-builder, nested-docs, S3 storage, Resend email.
- **Frontend** (`src/app/(frontend)/`) — renders published Pages + Posts, `/posts` blog,
  draft preview (`/next/preview`), live preview.
- **Delivery** — `sitemap.xml`, `robots.txt`, `feed.xml` (RSS), `/healthz` probe.
- **Jobs** — queue with `autoRun` cron (every minute) so scheduled-publish fires in-container.

## Env (forwarded into the container by `worker.ts`)

`DATABASE_URI`, `PAYLOAD_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `PAYLOAD_PUBLIC_SERVER_URL`.

## Deploy

`wrangler deploy` (needs Docker — builds `app/Dockerfile`). Run `./migrate.sh` first
when collections changed, so the new schema exists before the container boots.


---

## skyvern

# browser.projectsites.dev — Skyvern on CF Workers Containers

LLM browser-automation agent (drives a real headless browser to complete web tasks).
Mirrors `infra/listmonk` + `infra/litellm`. Heavy image (bundled Chromium) → standard-4;
Postgres → Neon; an LLM key powers the agent. AGPL-3.0 — internal/admin use.

## Deploy (from this dir) — proven container playbook
1. `npm install`
2. Neon DB — `CREATE DATABASE projectsites_skyvern;` in the SHARED Neon project
   (`jolly-pine-24431114`, per neon-database-conservation — NOT a new project); grab the
   connection string for `DATABASE_STRING`.
3. Secrets — `wrangler secret put` for: `DATABASE_STRING`, `OPENAI_API_KEY` and/or
   `ANTHROPIC_API_KEY`, `SKYVERN_API_KEY` (`openssl rand -hex 24`).
4. Cutover routing — add an EXPLICIT Workers route `browser.projectsites.dev/*` →
   `projectsites-skyvern` (beats the wildcard) AND remove `browser` from the main worker's
   `system_service_landing` map (so the status page stops answering) + redeploy main worker.
5. WAF — broaden the existing skip rule (`9c8324ff…`, zone `9ceaa211…`) to include
   `browser.projectsites.dev`.
6. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy` (Docker + global CF key).
7. Verify — `curl https://browser.projectsites.dev/heartbeat` (or the Skyvern health path)
   → 200; first boot is slow (~2-3 min, Chromium) so the port-ready window is 180s.

## Gotchas (learned from the Inngest/Listmonk/LiteLLM arc)
- Container DO → `new_sqlite_classes` (NOT `new_classes`; CF API error 10074).
- `@cloudflare/containers` ^0.3.3 → object-form `startAndWaitForPorts({ports, cancellationOptions})`.
- Self-hosted apps need their host in the WAF skip rule (5-rule phase cap → broaden, don't add).
- Verify the exact Skyvern health/API path against the running container (`/heartbeat`,
  `/api/v1/...`) — the root `/` may be the UI or a redirect.


---

## voice-agent

# projectsites-voice-agent

AI phone receptionist for ProjectSites — a Node [`@livekit/agents`](https://docs.livekit.io/agents) worker deployed to **LiveKit Cloud agent hosting**. See the decision record: [`docs/decisions/voice-architecture.md`](../../docs/decisions/voice-architecture.md) (LiveKit amendment + runtime pivot).

## Pipeline

| Stage | Choice | Notes |
|---|---|---|
| Transport | Twilio number → Twilio Elastic SIP trunk → LiveKit Cloud SIP → room | agent joins as a participant |
| STT | Deepgram **Flux** (`STTv2`, `flux-general-en`) | model-integrated end-of-turn; our `DEEPGRAM_API_KEY` |
| LLM | OpenAI `gpt-4o-mini` (streaming) | our `OPENAI_API_KEY`, per-site persona |
| TTS | OpenAI `gpt-4o-mini-tts` (**first-light**) → **Piper** | swap to bundled Piper custom plugin (free, self-hosted) |
| Turn-taking | silero VAD + LiveKit multilingual turn detection + barge-in | built-in |

Uses our own vendor keys (not LiveKit inference billing) for cost control.

## Local dev

```bash
npm install
cp .env.example .env   # fill from get-secret
npm run typecheck
npm run dev            # connects to LiveKit Cloud, registers, waits for dispatch
```

## Deploy (LiveKit Cloud agent hosting)

```bash
# one-time: install the LiveKit CLI + authenticate the project
brew install livekit-cli            # or: curl -sSL https://get.livekit.io/cli | bash
lk cloud auth                        # browser auth, or set LIVEKIT_API_KEY/SECRET/URL

# first deploy generates/uses livekit.toml + Dockerfile, uploads secrets, builds the image
lk agent create        # first time only (writes the agent id back into livekit.toml)
lk agent deploy        # subsequent deploys

# set the agent's runtime secrets in LiveKit Cloud (or via the dashboard):
#   LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET DEEPGRAM_API_KEY OPENAI_API_KEY
```

## Wire the phone path (slice 3)

1. Twilio: create an **Elastic SIP Trunk**, origination URI → `sip:5i7qjsfbhz7.sip.livekit.cloud`; point the receptionist number at the trunk.
2. LiveKit: create an **inbound SIP trunk** + a **dispatch rule** that dispatches `agentName = projectsites-receptionist` for inbound SIP calls (`AgentDispatchService` / `lk sip` ). Per-site routing keys off the dialed DID.

## Next (TODO)

- **Piper TTS plugin** — implement `src/piper-tts.ts` (spawn Piper, stream PCM → frames), bundle the binary + an `en_US-*-medium.onnx` voice in the Dockerfile (uncomment the block), set `tts` to it.
- **Per-site persona** — `resolvePersona()` currently returns a default; look the dialed DID up against the platform (number → site → persona).
- **Recording + transcript** — LiveKit egress → R2; transcript → D1 `conversations` via the live `/webhooks/livekit` receiver (`room_finished` / egress-ended).
