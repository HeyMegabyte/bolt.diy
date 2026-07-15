# Redis Topology — projectsites.dev

> Single source of truth for Redis infrastructure. Updated 2026-07-15 after Teable cost-spike cleanup.

## Architecture

```
CF Container apps ──→ Upstash Redis (primary, 13 DBs) ──→ Fly Redis (fallback)
Fly apps          ──→ Fly Redis (primary, 1 machine)   ──→ Upstash (fallback)
```

**Rule:** CF-hosted services use Upstash-primary. Fly-hosted services use Fly Redis-primary. Both tiers have cross-backup to the other Redis so no single Redis failure takes anything down.

## Fly.io Redis (`projectsites-redis`)

- **Machine:** Fly `projectsites-redis` (ewr, 256MB, shared-cpu-1x)
- **Image:** `redis:7-alpine` with AOF persistence
- **Volume:** 1GB encrypted `redis_data`
- **Internal:** `redis://:ohyi2Fjm8gCJ8Bfuh8rO/anHQYa1cMuk@projectsites-redis.internal:6379`
- **Cost:** $5.70/mo
- **Config:** `infra/redis/fly.toml`

### Fly Redis users (3 apps)

| App | DB | Purpose |
|---|---|---|
| Teable | 0 | Cache + session store (migrated July 14 from Upstash) |
| Nango | 1 | OAuth token cache (needs sub-ms latency) |
| Postiz | 1 | Social schedule cache |

### Why Fly Redis for these?

Fly-hosted apps calling Upstash add 50-100ms round-trip latency. These 3 apps need sub-ms Redis for cache/token/session operations.

## Upstash Redis (13 databases)

All CF-hosted services use their own Upstash Redis database:

| Database | Service | Host | Daily Commands |
|---|---|---|---|
| dify-projectsites | Dify | CF Container | — |
| gitlink-sessions | GitLink | CF Container | — |
| inngest | Inngest | CF Container | — |
| plane-pm | Plane | CF Container | — |
| projectsites-activepieces | Activepieces | Fly | — |
| projectsites-chatwoot | Chatwoot | CF Container | — |
| projectsites-directus | Directus | CF Container | — |
| projectsites-lago | Lago | Fly | — |
| projectsites-langfuse | Langfuse | CF Container | — |
| projectsites-litellm | LiteLLM | CF Container | — |
| projectsites-n8n | n8n | CF Container | — |
| projectsites-nango | Nango (backup) | Fly | 3.5K |
| twenty-crm | Twenty CRM | CF Container | 998K |

Nango's Upstash DB is dual-wired as fallback for the Fly Redis primary.

## Deleted (7 orphaned DBs, 2026-07-15)

These were migrated to Fly Redis but their Upstash databases were never shut down — they burned idle traffic for days/weeks:

- `teable-cache` — 87 req/sec, 596 MB/day ($15-20/mo wasted)
- `teable-perf` — negligible
- `medusa` — 0 commands, 5 days dead
- `searxng` — 0 commands, 5 days dead
- `unkey` — 0 commands, 5 days dead
- `postiz` — 16/day, idle
- `onyx` — 98K→0/day, cut over (never actually migrated to Fly — abandoned for different Upstash hostname)

## Failover

`src/services/redis_failover.ts` provides the Upstash→Fly fallback for CF Workers. Fly apps get their failover via env var `REDIS_FALLBACK_URL`.

## Cost monitoring

- Every Redis operation tagged with `backend` (upstash/fly-fallback) and reported to PostHog as `$redis_operation`
- Weekly audit: `mcp__upstash__redis_database_get_statistics` on all DBs, flag any >50 req/sec
- Orphan detection: any DB with 0 commands for 48h → alert
