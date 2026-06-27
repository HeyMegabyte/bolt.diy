# Twenty CRM (crm.projectsites.dev) — repair runbook

Twenty on a single CF Workers Container. Data plane: Neon project **Twenty**
(`fancy-hill-79480548`, db `neondb`, schema `core`) + Upstash Redis. Image pinned by
digest in the `Dockerfile`. The container runs **server + worker** in one process
(`CMD ["sh","-c","node dist/queue-worker/queue-worker & exec node dist/main"]`).

## What broke + what's fixed (2026-06-27)

Original symptom: email-entry "Continue" → toast *"An error occurred while checking user
existence"*. Root cause: the container ran `twentycrm/twenty:latest`, which drifted months
ahead of the Neon schema; the image's `entrypoint.sh` **swallows migration/upgrade
failures**, so it served with columns the frontend queries missing → GraphQL 500s.

Fixes applied (all live):

1. **Pin the image by digest** (Dockerfile) — no more silent `:latest` drift.
2. **Neon autosuspend off** (`suspend_timeout_seconds=-1`) — DB stays warm, no cold-start races.
3. **Single-workspace mode** (`IS_MULTIWORKSPACE_ENABLED=false`) — multiworkspace needs
   per-workspace subdomains + wildcard cert we don't have.
4. **Worker in-container** (`MESSAGE_QUEUE_TYPE=bull-mq` + the dual-process CMD) — async
   jobs (signing-key rotation, workspace activation/metadata-sync) need a worker to drain.
5. **Clean schema re-init**: the image's own typeorm migrations
   (`node ../../node_modules/typeorm/cli.js migration:run -d dist/database/typeorm/core/core.datasource.js`)
   = 61 tables, 182 migrations. BUT this MISSES the "flat-sync" columns/tables.
6. **Created `core.signingKey`** (absent from migrations) — once it exists,
   `jwtKeyManager.getCurrentSigningKey()` auto-generates the RS/ES key (encrypted with
   `APP_SECRET`). This fixed `"No active signing key available to sign asymmetric token"`.
   ⇒ **`signIn` now mints JWTs. Auth works.**
7. **Reconciled ALL flat columns** via `reconcile-flat-schema.mjs` → `reconcile-flat-schema.sql`
   (544 idempotent `ADD COLUMN IF NOT EXISTS`). This advanced `activateWorkspace` from
   "missing column" errors to actually running the metadata sync.

## CRITICAL — auth API is on `/metadata`, NOT `/graphql`

The onboarding chain (drive via browser fetch to `/metadata`, or any client):

```
signIn(email,password) -> availableWorkspaces.availableWorkspacesForSignIn[].loginToken (scalar String)
getAuthTokensFromLoginToken(loginToken, origin)  -> tokens.accessOrWorkspaceAgnosticToken.token
signUpInNewWorkspace(input:{displayName})        -> creates workspace (PENDING_CREATION) + membership
activateWorkspace(data:{displayName})            -> builds workspace_<id> schema, sets ACTIVE
```

`brian@megabyte.space` / `Megabyte2026!` — user + workspace + signing key all exist.

## REMAINING blocker (the last 5%)

`activateWorkspace` runs the metadata sync, creates the `workspace_<id>` schema, then fails
on the FIRST object: `Migration action 'create' for 'objectMetadata' (universalIdentifier
20202020-bd3d-4c60-8dca-571c71d4447a) failed` / "Migration execution failed". The detailed
Postgres error is in the **container stdout** — NOT visible via `wrangler tail` (that's the
Worker only), and a local repro needs the prod `APP_SECRET` (not in get-secret).

### To finish (next session)
- **The ONLY way to read the error: Cloudflare dashboard.** Workers & Pages →
  `projectsites-twenty` → **Logs / Observability** (real-time), then trigger `activateWorkspace`
  (curl the `/metadata` chain in RUNBOOK or click through `/welcome`). The container's NestJS
  stdout — including the wrapped Postgres error behind "Migration execution failed" — shows
  there. It's almost certainly ONE more schema/type tweak (then re-run `activateWorkspace`).
- ⚠️ **DEAD ENDS — do not re-try (all verified blocked 2026-06-27):** the container's stdout is
  NOT in `wrangler tail` (that's the Worker JS console only), NOT in the CF Workers
  observability **telemetry API** (`cloudflare-workers` dataset = Worker console only), and a
  **local repro won't surface it either** — Twenty's server in this slim image writes 0 lines
  to a piped/redirected stdout (no `stdbuf`/`script`/`python3`/pty in the image; `-t` only
  flushes the run-and-exit *command* path, and `node dist/main` produced 0 log lines to a file
  over 3+ min). So the dashboard UI is the only window.
- Alternative that sidesteps logs: run Twenty's **official docker-compose** (server+worker+redis,
  PG → this Neon `neondb`) on a host with a normal terminal — `docker compose logs` shows the
  error there — complete onboarding, then the CF container just serves the ACTIVE workspace.
- Before re-running `activateWorkspace`, `DROP SCHEMA "workspace_<id>" CASCADE` (the partial
  empty schema from prior attempts) so the migration starts clean.

Backup branch `backup-before-reinit-20260627` (`br-late-base-aiuqj4zd`) = pre-reset state.
