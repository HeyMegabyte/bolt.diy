# Twenty CRM (crm.projectsites.dev) — repair runbook

Twenty on a single CF Workers Container. Data plane: Neon project **Twenty**
(`fancy-hill-79480548`, db `neondb`, schema `core`) + Upstash Redis. Image pinned by
digest in the `Dockerfile`. The container runs **server + worker** in one process
(`CMD ["sh","-c","node dist/queue-worker/queue-worker & exec node dist/main"]`).

## STATUS: FIXED — login works end-to-end (2026-06-27)

`brian@megabyte.space` / `Megabyte2026!` logs in at crm.projectsites.dev → reaches the
authenticated onboarding flow (`/sync/emails`) with **0 console errors**. Workspace
**"Megabyte Labs"** is ACTIVE: 28 standard objects, 448 fields, 28 `workspace_<id>` tables.

## The ONE insight that unlocked everything: logs were BUFFERED, not hung

Every Twenty Nest-CLI command (`database:init:prod`, `run-instance-commands`, …) *appeared*
to hang — boot Nest, idle ~0.25% CPU, 0 output, never exit. **They were not hanging.** Twenty
buffers logs by default (`LOGGER_IS_BUFFER_ENABLED` defaults on). With **`LOGGER_IS_BUFFER_ENABLED=false`**
every command streams its output AND runs to completion (exit 0). The whole multi-hour
"whack-a-mole flat-column" detour existed only because the buffer hid that the proper init
command works fine. **Set `LOGGER_IS_BUFFER_ENABLED=false` for ANY Twenty maintenance command.**

## Original symptom + root cause

Email-entry "Continue" → toast *"An error occurred while checking user existence"*. The
container ran `twentycrm/twenty:latest`, which drifted months ahead of the Neon schema; the
image's `entrypoint.sh` **swallows migration/upgrade failures**, so it served with columns
the frontend queries missing → GraphQL 500s on the auth path.

## The clean fix (canonical — do THIS, not manual column patching)

1. **Pin the image by digest** (Dockerfile) — no more silent `:latest` drift.
2. **Neon autosuspend off** (`suspend_timeout_seconds=-1`) — DB stays warm, no cold-start races.
3. **Single-workspace mode** (`IS_MULTIWORKSPACE_ENABLED=false`) — multiworkspace needs
   per-workspace subdomains + a wildcard cert we don't have (`true` → redirects to
   `app.crm.projectsites.dev` → chrome-error).
4. **Worker in-container** (`MESSAGE_QUEUE_TYPE=bull-mq` + the dual-process CMD) — async
   jobs (signing-key rotation, workspace activation/metadata-sync) need a worker to drain.
5. **Clean re-init with the buffer OFF.** Drop `core`+`metadata`+any `workspace_*` schema,
   then run, with `LOGGER_IS_BUFFER_ENABLED=false`:
   ```
   node dist/database/commands/database-init.command.js   # = `yarn database:init:prod`
   ```
   This runs setup-db + 182 typeorm migrations + **131 instance commands up to 2.16.0**,
   advancing the **upgrade CURSOR** to latest in `core.upgradeMigration`. The cursor was THE
   missing piece — entities/columns (`searchFieldMetadata`, signingKey, flat-sync cols) are
   gated by `@WasIntroducedInUpgrade` and are invisible until the cursor advances. Raw
   `migration:run` alone does NOT advance the cursor; manual `ADD COLUMN` patching conflicts
   with init (`pageLayoutId already exists`) — so re-init clean, don't patch.
6. **Onboard via `/metadata`** (see chain below): signIn → signUpInNewWorkspace →
   activateWorkspace → workspace ACTIVE.
7. **Align prod APP_SECRET**: the workspace's signing key (`core.signingKey.privateKey`) is
   encrypted with `APP_SECRET`. Build the workspace with a known APP_SECRET, set prod's
   `APP_SECRET` (wrangler secret) to match, redeploy. Then prod's stored key decrypts and
   signIn mints JWTs.

## Auth API is on `/metadata`, NOT `/graphql`

```
signIn(email,password) -> availableWorkspaces.availableWorkspacesForSignIn[].loginToken (scalar String)
getAuthTokensFromLoginToken(loginToken, origin)  -> tokens.accessOrWorkspaceAgnosticToken.token
signUpInNewWorkspace(input:{displayName})        -> creates workspace (PENDING_CREATION) + membership
activateWorkspace(data:{displayName})            -> builds workspace_<id> schema, sets ACTIVE
```

`core.signingKey`: once the table exists (created by init), `jwtKeyManager.getCurrentSigningKey()`
→ `loadOrCreateCurrentSigningKey()` auto-generates an ES256 key (privateKey encrypted with
`APP_SECRET`) on first signIn. That fixed *"No active signing key available to sign asymmetric token"*.

## Observability dead-ends (verified — don't waste time)

- Container stdout is **NOT** in `wrangler tail` (Worker JS console only) and **NOT** in the
  CF Workers telemetry API. The CF dashboard container Logs/Observability *would* show it, but
  the real win was never reading the error — it was `LOGGER_IS_BUFFER_ENABLED=false` locally.

Backup branch `backup-before-reinit-20260627` (`br-late-base-aiuqj4zd`) = pre-reset state.
