# jobs./events.projectsites.dev — self-hosted Inngest durable-jobs server.
# Convergence prompt §13 (events. → Inngest SELF-HOST, LAW-clean, no Inngest Cloud).
#
# Local-Dockerfile path (FROM upstream) — the same mechanism SiteBuilderContainer
# uses, which bypasses the account-level IMAGE_REGISTRY_NOT_CONFIGURED blocker
# that only hits bare `image = "registry/name:tag"` refs in wrangler.toml.
#
# Data plane is external + managed (CF-first escape hatches per cloudflare-first.md):
#   - Postgres → Neon  (INNGEST_POSTGRES_URI, wrangler secret)
#   - Redis    → Upstash (INNGEST_REDIS_URI, wrangler secret)
# Auth keys (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY) are self-generated and
# injected by the InngestContainer DO via Container#envVars — never baked here.
FROM inngest/inngest:latest

# 8288 = HTTP API + dashboard (the port the InngestContainer DO proxies).
# 8289 = Connect WebSocket gateway (SDK connect mode; reserved).
EXPOSE 8288 8289

# `inngest start` is the single-binary production server (Postgres + Redis backed,
# vs. `inngest dev` which is in-memory + no auth). Bind 0.0.0.0 so the CFC proxy
# can reach the port. Postgres/Redis URIs + auth keys arrive via env at boot.
CMD ["inngest", "start", "--host", "0.0.0.0", "--port", "8288"]
