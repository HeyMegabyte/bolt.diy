# Architecture Decision: Cloudflare vs Fly.io Split

## Rule

The default hosting choice for every service in projectsites.dev is **Cloudflare Containers + Neon + Upstash**. Fly.io is used only when Cloudflare genuinely cannot meet a service's requirements.

This document records the current split, the rationale for each Fly.io deployment, and the migration path back to CF if/when CF closes the gap.

---

## Decision Table

| Service | Host | Rationale for Fly.io | CF Alternative (if it existed) |
|---|---|---|---|
| ClickHouse | Fly.io | Needs persistent block storage significantly larger than CF Container ephemeral disk; persistent volumes on CF Containers are limited; ClickHouse requires fast local NVMe for MergeTree operations | CF Containers with large persistent volumes — revisit when CF adds 50GB+ persistent block storage |
| Chatwoot | Fly.io | Requires multi-process supervision: Rails, Sidekiq workers, and background job processing run as separate OS processes. CF Containers is a single-process runtime per container instance. | CF Containers with multi-process support, OR a purpose-built Worker-native support inbox (psnotify + inbox) that replaces Chatwoot long-term |

All other services (Inngest, LiteLLM, Twenty CRM, Payload CMS, Listmonk, Postiz) run on CF Containers.

---

## Operational Differences

| Characteristic | CF Containers | Fly.io |
|---|---|---|
| Startup model | On-demand (cold start on first request) | Always-on (min_machines_running = 1) |
| Billing | Per-request when scaled to zero; per-second when active | Always-on VM cost (~$5-50/mo per VM depending on size) |
| Persistent storage | Ephemeral disk per container restart (limited volumes in preview) | Persistent volumes up to TB range; survives restarts/redeploys |
| Multi-process | Single entrypoint process per container | Full VM — supervisor (Overmind, Foreman, s6) can run multiple processes |
| Integration with Workers | Native — Workers can invoke CF Containers via DO bindings | External HTTP — Workers call Fly apps via HTTPS |
| Networking | CF global edge — zero-latency from Workers | Fly anycast — ~20-50ms from CF Workers to Fly iad region |
| Scale to zero | Yes (configurable) | Optional (`auto_stop_machines = true`; analytics warehouse keeps `false`) |
| CF Access | Native (same account, zero config) | Requires CF Tunnel or public domain + Access policy |
| Deploy tooling | `wrangler deploy` | `fly deploy` |
| Secrets management | `wrangler secret put` → CF secrets | `fly secrets set` → Fly secrets |

---

## Why Not More Fly.io

Fly.io VMs have persistent processes, native volumes, and multi-process support — genuinely better for some workloads. However:

1. **Deep CF lock-in is the feature, not the risk.** Every primitive on CF (D1, KV, R2, Queues, Durable Objects, Workflows, Access) reduces integration surface, eliminates egress costs between services, and simplifies the operational model. Adding Fly.io breaks this cohesion.
2. **CF Workers and CF Containers share a deployment pipeline.** `wrangler deploy` deploys both; no separate CI job, no separate secrets store. Adding Fly.io requires a parallel `fly deploy` step and a separate `fly secrets` store.
3. **Egress costs.** Data transferred from a Fly.io VM to a CF Worker incurs egress fees on Fly's side. CF Container → CF Worker is intra-platform, zero egress.
4. **CF is improving.** Persistent volumes, larger container sizes, and multi-process support are on CF's roadmap. Every Fly.io deployment is a candidate for future migration back.

---

## Migration Path: Fly.io → CF

### ClickHouse

**Trigger:** CF Containers adds persistent volumes >= 50GB with fast local NVMe, or CF announces a managed ClickHouse-compatible product.

**Migration steps:**
1. Provision CF Container with persistent volume.
2. Run `clickhouse-backup` to export from Fly ClickHouse to R2.
3. Restore to new CF Container ClickHouse.
4. Update `CLICKHOUSE_HOST` Worker secret to point to CF Container.
5. Verify event counts and query performance.
6. Decommission Fly ClickHouse VM and volume.

**Alternative:** If volume requirements stay moderate (<50M events/day), migrate to Tinybird managed service instead. See [ClickHouse Tinybird promotion path](../analytics/clickhouse.md#tinybird-managed-alternative-and-promotion-path).

### Chatwoot

**Trigger:** CF Containers adds multi-process support, OR psnotify (the ProjectSites-native support inbox) matures to replace Chatwoot's core feature set.

**Migration steps (psnotify path):**
1. psnotify implements: inbox, conversations, agent assignment, email routing, webhook.
2. Migrate open Chatwoot conversations to psnotify (export via Chatwoot API).
3. Update DNS: `support.projectsites.dev` CNAME to `projectsites.dev`.
4. Decommission Fly Chatwoot app and Neon database.

---

## Neon and Upstash Note

Neon (Postgres) and Upstash (Redis) are used by Fly.io services because those services require their respective databases. They are not used by the main Worker (which uses D1 for relational data). This is consistent with the CF-first rule: D1 is the default; Neon is the fallback only when Postgres semantics are genuinely required.

When Fly.io services are decommissioned, their Neon databases are dropped (not the Neon project — see [Neon Database Conservation](../../rules/neon-database-conservation.md)).

---

## Related Docs

- [Architecture overview](./current.md)
- [ClickHouse warehouse](../analytics/clickhouse.md)
- [Chatwoot service](../services/chatwoot.md)
- [Deployment: Fly.io guide](../deployment/fly.md)
