# crm.projectsites.dev — Twenty CRM on CF Workers Containers.
#
# Twenty is a NestJS server + React frontend served as ONE process on port 3000.
# Its data plane is external + managed (CF Containers have no persistent volume):
#   - Postgres → Neon  (PG_DATABASE_URL, wrangler secret)
#   - Redis    → Upstash (REDIS_URL, wrangler secret; powers the BullMQ message queue)
#
# The upstream image's entrypoint runs DB migrations on boot when DISABLE_DB_MIGRATIONS
# is not "true", BUT it swallows migration/upgrade failures (`if ! cmd; then echo Warning;
# continue`) and serves anyway — so a `:latest` that drifts ahead of the Neon schema boots
# with missing columns and 500s the auth path. PIN the digest so deploys are deterministic
# and the schema stays in lockstep. To bump Twenty: pull the new digest, run the image's
# `node typeorm/cli.js migration:run -d dist/database/typeorm/core/core.datasource.js`
# against the Neon DB, THEN update this digest. (Pinned 2026-06-27, was `:latest`.)
# Local-Dockerfile path (FROM upstream) — the same mechanism the Inngest/Listmonk
# containers use, which bypasses the account-level IMAGE_REGISTRY_NOT_CONFIGURED blocker.
FROM twentycrm/twenty:latest@sha256:62bd82f203fd9edc59bfdebf01467a967971c31e66beefc01ff5a57c87044ecd

# Cache-busting label: bump this when a worker.ts envVar change (e.g. MESSAGE_QUEUE_TYPE)
# must reach a warm container. CF only rolls the container when the built image changes;
# a new label = new image hash = forced cold start that re-applies the DO's envVars.
LABEL dev.projectsites.config-rev="2026-06-27-google-apis-sync"

# 3000 = HTTP (server + bundled frontend) — the port the TwentyCrm Container DO proxies.
EXPOSE 3000

# Run the Twenty WORKER (queue consumer) in-process alongside the server. Twenty's
# architecture is server + worker; async jobs (workspace activation/metadata-sync that
# builds the workspace_<id> schema, signing-key rotation, email) enqueue to BullMQ and
# are drained by the worker. The single CF container previously ran only `node dist/main`
# (server) → those jobs never ran → workspace stuck PENDING_CREATION, auth tokens unsignable.
# Co-locating the worker keeps it a single container (fine for a small CRM). The upstream
# entrypoint runs migrations then `exec "$@"` (this CMD). (Added 2026-06-27.)
CMD ["sh", "-c", "node dist/queue-worker/queue-worker & exec node dist/main"]
