# Database Allocation

> Per-site DB allocation for the Cloudflare-first platform. Parent doctrine:
> [`cloudflare-first.md`](cloudflare-first.md) §4–§7.

**D1 is the default. Neon is the Postgres escape hatch.** Every paid site gets DB
capability, but not every paid site gets a dedicated Neon project.

## Allocation order

```
none  →  d1_tenant_db  →  neon_shared_shard  →  neon_dedicated_project
```

The decision LAW (`src/services/db_allocation.ts` → `chooseDbAllocation`):

| Input | Plan | → db_plan | reason |
|---|---|---|---|
| any | `free` | `none` | free-plan (overrides everything) |
| isolation required | paid+ | `neon_dedicated_project` | isolation |
| — | `enterprise` | `neon_dedicated_project` | enterprise |
| noisy-neighbour | paid+ | `neon_dedicated_project` | noisy-neighbor |
| true Postgres needed | paid+ | `neon_shared_shard` | postgres-required |
| default | paid/pro | `d1_tenant_db` | d1-default |

"True Postgres needed" = advanced SQL / RLS / extensions / large relational app
data / Postgres-tooling compatibility. Otherwise D1.

## Storage

- **Canonical**: D1 table `site_database_allocations` (migration `0573`). Columns:
  `tenant_id, site_id (PK), db_plan, region, shard_id, hyperdrive_binding_name,
  neon_project_id, neon_database, neon_schema, status, created_at, updated_at`.
- **Hot-path cache**: KV `site-db:{site_id}` / `hostname-db:{hostname}` (600s TTL),
  via `cacheAllocation` / `resolveAllocation`.

## Shard-level Hyperdrive (never one config per site)

`neon_shared_shard` sites route through a **shared** Hyperdrive binding derived
from the tenant's shard: `HYPERDRIVE_SHARD_{shardIndex}` (`hyperdriveBindingForShard`).
Shard PLACEMENT is the existing stable tenant→shard service (`db_shards.getOrAssignShard`
+ `tenant_db_assignments`/`db_shards`, migration `0572`) — adding shards re-routes
only NEW tenants, never remapping existing data. Colocate DB-heavy Workers near the
shard's Neon region (Worker placement). Access via postgres.js / pg / Drizzle over
Hyperdrive; raw Neon only for migrations/backups/restore/replication/long admin jobs.
**Never expose Neon credentials to customer code or browsers.**

## Caching policy (Postgres reads)

Cacheable in KV/R2/Hyperdrive: published content, tenant settings, public
catalog/listing, theme config, plan config, non-private public data. **Never
cache**: auth/session checks, payments, admin mutations, private user data,
secrets, per-user authorization.

## Tenant promotion (next slice)

`D1 → shared Neon shard → dedicated Neon project` via Workflows + Queues when p95
latency / query volume / storage / connection pressure / noisy-neighbour / plan /
isolation thresholds trip. Process: mark pending in D1 → create destination →
copy → verify row-counts/checksums → pause-writes-or-dual-write at cutover →
switch KV allocation → smoke test → keep old shard read-only → finalize after a
verification window.
