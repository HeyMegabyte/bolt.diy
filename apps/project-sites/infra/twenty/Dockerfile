# crm.projectsites.dev — Twenty CRM on CF Workers Containers.
#
# Twenty is a NestJS server + React frontend served as ONE process on port 3000.
# Its data plane is external + managed (CF Containers have no persistent volume):
#   - Postgres → Neon  (PG_DATABASE_URL, wrangler secret)
#   - Redis    → Upstash (REDIS_URL, wrangler secret; powers the BullMQ message queue)
#
# The upstream image's entrypoint runs DB migrations on boot when DISABLE_DB_MIGRATIONS
# is not "true", so first cold-start self-migrates the Neon database, then serves.
# Local-Dockerfile path (FROM upstream) — the same mechanism the Inngest/Listmonk
# containers use, which bypasses the account-level IMAGE_REGISTRY_NOT_CONFIGURED blocker.
FROM twentycrm/twenty:latest

# 3000 = HTTP (server + bundled frontend) — the port the TwentyCrm Container DO proxies.
EXPOSE 3000
