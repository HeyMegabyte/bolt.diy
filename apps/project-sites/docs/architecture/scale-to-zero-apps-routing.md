# Scale-to-Zero Apps — Routing & Shared-Instance Architecture (design)

> **Status:** Design / proposed. One-way-door (`one-way-two-way-doors`): it changes
> how every app instance is served + where tenant data lives, so it gets a written
> design before code. Nothing here is implemented yet beyond the **Hyperdrive
> contract** (`withHyperdrive()` in `apps-catalog.data.ts`, shipped) which this doc
> consumes. Author: loop fire, 2026-06-18.

---

## 1. Why

The brief: *"All the Docker containers… should be the kind of apps that do not need
to stay running — essentially scale-to-zero services. All the CNAMEs should point
to projectsites.dev, then the projectsites.dev worker should be in charge of loading
the appropriate Docker container based on the URL it is launched as… if I have 50
customers running Umami, we should leverage the same instance with a worker that
coordinates it with the appropriate Postgres settings. Ensure Hyperdrive is included
anytime Postgres is included."*

Three distinct asks, in dependency order:

1. **CNAME → Worker dispatch** — every app hostname resolves to the projectsites.dev
   Worker, which picks the right app + tenant from the hostname.
2. **Scale-to-zero containers** — an app container idle-hibernates and cold-boots on
   the first request, so 1000 provisioned apps cost ~0 when nobody is using them.
3. **Shared-instance multi-tenancy** — one Umami *image* serves N tenants; the Worker
   injects each tenant's own Postgres connection (through Hyperdrive) per request.

---

## 2. Current state (as built today)

Source: `src/routes/apps.ts`, `services/app_provisioner.ts`,
`services/container_dispatcher.ts`, `durable_objects/app_runtime.ts`.

- **One instance = one of everything.** `POST /api/apps/instances` calls
  `provisionInfra()` → a **dedicated Neon Postgres project** (`neon_project_id`) +
  **dedicated Upstash database** (`upstash_database_id`) + a **dedicated container**
  per `app_instances` row. `resolveAppEnv()` bakes those connection strings into the
  container env.
- **Hostname:** `{subdomain}.app.projectsites.dev`, one per instance.
- **Container runtime:** an `app_runtime` Durable Object subclass per instance
  (`app_runtime_subclasses.ts`). Dispatch via `container_dispatcher.ts`.
- **Cost:** every instance carries a live Neon project + Upstash db + a container —
  paid whether or not anyone visits. This is what the brief wants to collapse.

```
today:  50 Umami tenants  →  50 containers + 50 Neon projects + 50 Upstash dbs
target: 50 Umami tenants  →  1 (hibernating) Umami image, N warm replicas on demand
                              + 1 shared Postgres (50 logical DBs/schemas) via Hyperdrive
```

---

## 3. Target architecture

### 3.1 CNAME → Worker dispatch (`apps.projectsites.dev/*` + custom domains)

- Every app hostname (`{tenant}.app.projectsites.dev` and any customer CNAME) points
  at the Worker. The Worker's `fetch` resolves the hostname → `{app_slug, tenant_id}`
  via a **KV host-map** (`apphost:{hostname}` → `{instanceId, appSlug, orgId}`,
  60s TTL, mirrors the existing site host-resolution in `site_serving`).
- Unknown host → 404 (never 403, per `feature-flags` guard convention).
- Custom domains: same KV map; the customer CNAMEs `app.theirdomain.com →
  apps.projectsites.dev` and we add the `apphost:` entry on domain verify.

### 3.2 Scale-to-zero container runtime

- The `app_runtime` DO already brokers the container. Add **idle hibernation**:
  `sleepAfter = '30m'`, auto-restart capped 3/rolling-minute, ring-buffer logs
  (the god-tier Container DO pattern). On a request to a hibernated app, the DO
  cold-boots the image (~5–30s) behind a **boot-progress splash** (reuse the
  `/waiting` build-progress UX) and streams once warm.
- **Warm-pool** (optional, phase 3): keep the top-K most-trafficked images warm to
  avoid cold-boot on popular apps.

### 3.3 Shared-instance multi-tenancy (the big one)

Two viable models — **decide per app class**:

- **(A) Shared image, isolated DB per tenant (DEFAULT).** One Umami container image,
  N warm replicas; the Worker injects the tenant's own Postgres connection
  (through Hyperdrive) + tenant env per request via the DO. Works for apps that read
  their DB connection from env at request scope. Tenant isolation = separate logical
  Postgres database/schema on a **shared Neon instance** (50 logical DBs on 1 project
  instead of 50 projects).
- **(B) Container-per-tenant, scale-to-zero (FALLBACK).** For apps that cache DB
  state in memory or can't re-point per request, keep one container per tenant but
  hibernate aggressively. Cheaper than today (idle = $0) without the shared-image
  complexity.

> Reality check (`self-argue`): most self-hosted apps (Umami, Outline, n8n…) read
> `DATABASE_URL` **once at boot**, not per request — so true "one container, many
> tenants via per-request Postgres" (A) is NOT possible without forking the app.
> The honest shared model is: **shared Neon *instance* (many logical DBs) + Hyperdrive
> pooling + scale-to-zero container per tenant (B)**. That already delivers the cost
> win the brief wants ("leverage the same instance… appropriate Postgres settings")
> — the *database instance* is shared and pooled; the lightweight container
> hibernates. Pure shared-container (A) is reserved for apps explicitly built
> multi-tenant. **This is the key design decision for Brian.**

### 3.4 Connection pooling for Postgres apps (Phase 3 — REVISED finding)

`withHyperdrive(app.infra)` declares Hyperdrive whenever Postgres is present
(frontend contract + tests, shipped). But building the worker side surfaced a
**load-bearing constraint** (`root-cause-validator`):

- **Cloudflare Hyperdrive is Worker-binding-scoped.** Its connection endpoint is
  reachable only from inside a Worker isolate (via `env.HYPERDRIVE`). These catalog
  apps are **containers that connect to Postgres directly** (the container's own
  `DATABASE_URL`), with no Worker in the DB path — so a container **cannot** reach a
  Hyperdrive config. Creating one would produce an unusable resource.
- **The viable pooling for container apps is Neon's own pooler** (PgBouncer). Neon
  exposes a pooled endpoint by inserting `-pooler` into the endpoint id
  (`ep-x-1` → `ep-x-1-pooler`). Connections share a small upstream pool — exactly
  the "50 tenants on one instance, pooled" win the brief wants, and it works for a
  container connecting directly.
- **Caveat (why it's opt-in, not forced):** Neon's pooler runs PgBouncer in
  *transaction* mode → no session features (LISTEN/NOTIFY, advisory locks, cross-tx
  prepared statements). Apps needing those keep the **direct** string. So the
  primitive is exposed per app, not blindly swapped onto every container.

**Shipped this phase:** `toPooledConnectionString()` + a `pooledConnectionString`
field on `NeonProvisionResult` (the pooling primitive, fully tested). Wiring it onto
specific apps' `DATABASE_URL`, and the per-app session-vs-pooled flag, is a follow-on
once the catalog records which apps are pooler-safe.

**To use CF Hyperdrive *specifically*** (Brian's call) the apps would need
**Worker-mediated DB access** (a Worker DB proxy in front of Postgres) — a larger
design change. Until then "Hyperdrive" in the catalog reads as "pooled Postgres",
realized via the Neon pooler.

---

## 4. Phased migration (each phase ships + verifies independently)

1. **Phase 1 — CNAME router (additive, two-way).** Worker resolves `apphost:` KV →
   instance; serve through the existing per-instance container. No data move. Ship +
   E2E that `{tenant}.app.projectsites.dev` routes correctly.
2. **Phase 2 — Scale-to-zero (additive, two-way).** Add `sleepAfter` + cold-boot
   splash to `app_runtime`. Idle instances stop costing. Reversible (raise
   `sleepAfter` to ∞).
3. **Phase 3 — Postgres connection pooling (additive).** REVISED per § 3.4: CF
   Hyperdrive is Worker-scoped → unreachable from a container, so pooling comes
   from Neon's pooler instead. Shipped: `toPooledConnectionString()` +
   `pooledConnectionString` on the provision result (the primitive). Follow-on:
   flag pooler-safe apps + route their `DATABASE_URL` through the pooled string.
   Backwards-compatible (direct connection is the default/fallback).
4. **Phase 4 — Shared Neon instance (ONE-WAY — needs Brian).** Migrate from
   project-per-instance to logical-DB-per-tenant on a shared Neon instance. This
   moves tenant data → requires a migration + backfill + a tested rollback (Neon
   branch/restore). Gate behind a flag; migrate cohort-by-cohort.

---

## 5. Risks & classification

| Decision | Door | Mitigation |
|---|---|---|
| CNAME router | two-way | KV map; revert = stop writing entries |
| Scale-to-zero hibernation | two-way | `sleepAfter` is a config dial; cold-boot splash hides latency |
| Hyperdrive provisioning | two-way | additive; raw connection is the fallback |
| Shared Neon instance | **one-way** | per-tenant logical DB + Neon branch backups + cohort migration + flag |
| Shared *container* (model A) | **one-way + app-specific** | only for apps built multi-tenant; default to model B |

- **Confidence:** 0.8 on phases 1–3 (additive, well-understood CF primitives); 0.6 on
  phase 4 shared-Neon (needs a data-migration plan + Brian's call on isolation model)
  → below the 0.7 bar, so phase 4 does **not** proceed without a dedicated design +
  Brian's direction.

## 6. Open questions for Brian

1. **Isolation model** — logical-DB-per-tenant on shared Neon (cost win, weaker
   blast-radius isolation) vs project-per-tenant (today; stronger isolation, higher
   cost)? Recommend shared-instance + per-tenant logical DB + Hyperdrive.
2. **Shared container (A) vs hibernating per-tenant container (B)** as the default?
   Recommend **B** — most catalog apps aren't multi-tenant-aware; B still delivers the
   cost win.
3. **Cold-boot SLA** — acceptable first-request latency on a hibernated app (5–30s)?
   Drives whether we keep a warm pool (phase 3.5).

## 7. Sharded Hyperdrive at scale — 10k+ tenants, fast Postgres (Brian's directive)

> Directive: *"the Postgres connection should be as fast as possible and capable
> of giving 10k+ sites their own Neon instance behind sharded Hyperdrive."*

**The load-bearing constraint (verified vs CF docs 2026-06-18,
`/hyperdrive/platform/limits/`):** Cloudflare Hyperdrive allows **≤ 25 configured
databases per account** (10 free), each config is a **wrangler-declared static
binding**, and there is **no dynamic per-request origin**. So you literally cannot
give 10,000 tenants their own Hyperdrive config — the ceiling is 25.

### The reconciliation (what "sharded Hyperdrive" must mean here)

A **fixed pool of ≤ 25 Hyperdrive shards**, each a static binding
(`HYPERDRIVE_SHARD_0 … _24`) fronting **one Neon instance**. Tenants are **hashed**
to a shard (`services/db_sharding.ts`, shipped: deterministic murmur3-finalized
FNV-1a → even spread, verified across 10k ids). On a shard:

- **Speed** comes from the shard's Hyperdrive binding — edge-located connection
  pool (transaction mode) + automatic **query caching**, so reads are served near
  the user without a round-trip to Neon.
- **"Own Neon instance"** is honoured as **own logical database + own role/creds**
  on the shard's Neon instance (true data isolation). At 10k scale, per-tenant
  *physical* instances + per-tenant Hyperdrive is impossible (25 cap); per-tenant
  *logical* DB on a sharded instance is the scalable equivalent.
- **Scale-out:** add shards up to 25; beyond ~25×(tenants-per-Neon) add more Neon
  instances per shard (one binding can only point at one origin, so growth past 25
  origins means bigger Neon instances, not more bindings).
- **Enterprise / "must be a dedicated instance"** tenants get a **Neon-pooler
  direct** path (the `pooledConnectionString` primitive, shipped) — their own
  physical Neon instance, pooled by Neon's PgBouncer, **not** consuming a
  Hyperdrive shard. Unlimited of these; just no edge query-cache.

### Fastest-possible connection — the levers

1. **Hyperdrive on the hot shards** — pooling + query cache at the edge (the big
   win for read-heavy tenants).
2. **`origin_connection_limit`** tuned up per shard (paid: ~100) via the CF API /
   `wrangler hyperdrive update` so a busy shard isn't connection-starved.
3. **Neon's `-pooler` endpoint** as the origin (compounds: Hyperdrive pools client
   side, Neon's PgBouncer pools at the DB) for the long-tail tenants.
4. **Same-region placement** — pin each shard's Neon instance to the region its
   tenants cluster in; Hyperdrive caches at the nearest colo regardless.

### Shipped this fire (the routing core)

- `services/db_sharding.ts` — `assignShard(tenantId, shardCount)` (deterministic,
  capped at 25), `hyperdriveBindingName(shard)`, `hyperdriveBindingForTenant(...)`.
  Pure + fully tested (`__tests__/db_sharding.test.ts`).

### Remaining (needs ops + Brian's isolation call)

- Declare the `HYPERDRIVE_SHARD_*` bindings in `wrangler.toml` (one per shard,
  pointing at each shard's Neon instance) — a one-time ops setup, ≤ 25 entries.
- A `db_shards` registry (which Neon instance + creds back each shard) + a Worker
  DB-proxy or per-request connection that reads `env[hyperdriveBindingForTenant()]`
  — this is the **Worker-mediated DB access** that makes Hyperdrive usable (the
  container-direct apps can't use a Worker binding; this path is for site/worker
  Postgres + any Worker-fronted app DB).
- Per-tenant logical-DB provisioning on the shard's Neon instance (the Phase-4
  data model) — **one-way-door**, gated on Brian's isolation decision.

## 8. See also

- `services/db_sharding.ts` — the sharded-Hyperdrive routing core (shipped)
- `apps-catalog.data.ts` `withHyperdrive()` — the shipped Hyperdrive contract this consumes
- `services/app_provisioner.ts` · `container_dispatcher.ts` · `durable_objects/app_runtime.ts` — current impl
- `services/site_serving` — the host-resolution KV pattern Phase 1 mirrors
- Rules: `one-way-two-way-doors`, `state-is-the-enemy`, `cost-per-request-accountability`, `vendor-risk-tiering`
