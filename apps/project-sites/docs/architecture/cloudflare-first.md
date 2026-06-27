# Cloudflare-First Platform Architecture

> **Authoritative infrastructure doctrine for ProjectSites.dev.** Global rule mirror:
> `~/.agentskills/rules/projectsites-cloudflare-first.md`. When this doc and code
> disagree, this doc wins — fix the code (drift). Last finalized: 2026-06-19.

ProjectSites.dev is a **Cloudflare-native multi-tenant website/application platform**.
Cloudflare primitives are first-class citizens and **must be evaluated before any
external service**. The normal public page request is fast, cheap, global, and
Cloudflare-only.

---

## 0. The infrastructure LAW (non-negotiable)

| Provider | Role | When |
|---|---|---|
| **Cloudflare** | The platform | Default for everything |
| **Neon** | Postgres escape hatch | Only when D1 can't (true Postgres semantics, RLS, extensions, customer-isolated PG, large relational app data) |
| **Upstash** | Redis escape hatch | Only for Redis-shaped problems (pub/sub, streams, sorted sets, leaderboards, global token buckets, Redis locks) |
| **Fly.io** | Stateful VM/container escape hatch | Only when a true stateful VM is required AND no CF primitive can safely satisfy it |

**Never by default:** Google Cloud Run, AWS, GCP, Azure, Vercel, Supabase, Render,
Railway, or any managed app platform. Only on an explicit override.

**Never in the default product architecture:** Skyvern (internal tooling only — see §8).

---

## 1. First-class Cloudflare primitives

**Runtime** — Workers (Hono) for every API / webhook / custom-domain dispatch /
billing callback / telemetry ingestion / PostHog-Sentry proxy / AI orchestration /
browser-job orchestration / admin API / customer-site serving. Service Bindings for
internal Worker↔Worker calls (not public HTTP). Workers Static Assets where it fits.

**Multi-tenant** — Cloudflare for SaaS (custom domains + SSL). Workers for Platforms +
dispatch namespaces **only** for customer/AI-authored custom code, **not** every static
site. CF Access / Zero Trust for admin, staging, internal tools.

**Data & storage**
- **No DB** when a static R2/KV manifest suffices.
- **KV** — hostname→site_id routing, site_id→manifest version, flag/plan/capability cache, low-write/high-read config, routing metadata.
- **D1** (default relational) — tenants, users, sites, hostnames, subscriptions, claim flows, feature flags, analytics rollups, build/deploy status, lightweight tenant app data, db-allocation metadata.
- **Durable Objects** — per-site build locks, live-preview sessions, collab rooms, quota/counter coordinators, webhook idempotency, WebSocket coordination, presence, session state.
- **R2** — generated HTML/CSS/JS bundles, uploads, images, sourcemaps, screenshots, PDFs, HAR/debug, recordings, analytics exports, build logs, AI prompt/response archives, data-lake files. + R2 Data Catalog / R2 SQL when R2 data needs to be queryable.
- **Hyperdrive** — every Worker→Neon connection; **shard-level bindings**, never one config per site.

**Async** — Queues (every critical queue has retries + a DLQ) for generation/research/
outreach/email/image/analytics-batch/telemetry-forward/browser-QA/webhook-retry/
domain-verify/db-alloc. Workflows for durable multi-step (claim, payment activation,
domain provisioning, db allocation, generation, human review, QA, publish, notification,
tenant promotion, rollback). Cron Triggers for rollups/cleanup/domain-recheck/billing-
sync/health/cache-warm/sitemaps.

**AI** — Workers AI for cheap default tasks (classify/extract/summarize/rewrite/tag/
template-select/spam-score/embeddings). **AI Gateway is MANDATORY for every model call**
(logging, caching, rate limits, retries, fallback, tenant attribution, budget control,
model routing, eval tagging). Vectorize as the default vector DB. AI Search for managed
RAG. Agents SDK for durable agents (§9). Agent Memory, tenant/user/site-isolated. Sandbox
SDK only for isolated code exec.

**Edge services** — Turnstile (all public forms, validated server-side); WAF /
Rate-Limiting / Bot-Management / Rulesets before any custom anti-abuse; Secrets Store /
Worker secrets for all sensitive config; Analytics Engine for high-cardinality per-tenant
metrics; Workers Logs / Tail Workers; CF Email Service + Email Routing; Zaraz for
third-party scripts; Cloudflare Flagship for feature flags (D1/KV fallback);
Images / Stream / Realtime SFU-TURN for media + realtime.

---

## 2. The hot path (public site request)

```
CF DNS / Cloudflare-for-SaaS custom hostname
  → Worker dispatch
  → KV hostname → site_id lookup
  → KV/R2 manifest lookup
  → R2 / static asset response
  → Analytics Engine sample
  → async Queue (non-critical work)
```

**The hot path MUST NOT touch** Neon, Upstash, Fly.io, Sentry, PostHog, Browserbase,
Skyvern, or external AI — unless the request is genuinely dynamic and requires it.

---

## 3. Site capability manifest

Signed per-site manifest; canonical in **D1**, active copy cached in **KV**, full
generated bundle in **R2**.

```ts
type SiteCapabilityManifest = {
  tenantId: string; siteId: string; hostname: string;
  plan: "free" | "paid" | "pro" | "enterprise";
  staticServing: boolean;
  db: "none" | "d1_tenant_db" | "neon_shared_shard" | "neon_dedicated_project";
  storage: "r2";
  analytics: "included" | "growth" | "developer";
  sentry: "virtual" | "dedicated";
  posthog: "none" | "sampled" | "full_paid";
  browserAutomation: "cloudflare" | "browserbase_fallback" | "internal_skyvern";
  aiGatewayBudgetMonthlyCents: number;
  vectorizeNamespace?: string;
  featureFlags: Record<string, boolean | string | number>;
  manifestVersion: string; release: string;
};
```

---

## 4. Database allocation

Allocation order: **`none → d1_tenant_db → neon_shared_shard → neon_dedicated_project`**.
Every paid site gets DB capability, but not every paid site a dedicated Neon project. D1
first; Neon only when Postgres is truly required; **shard-level Hyperdrive**.

```sql
CREATE TABLE site_database_allocations (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL PRIMARY KEY,
  db_plan TEXT NOT NULL,          -- none | d1_tenant_db | neon_shared_shard | neon_dedicated_project
  region TEXT NOT NULL,
  shard_id TEXT,
  hyperdrive_binding_name TEXT,
  neon_project_id TEXT, neon_database TEXT, neon_schema TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

KV cache: `site-db:{site_id}`, `hostname-db:{hostname}`. Colocate DB-heavy Workers near
the Neon shard region (Worker placement). postgres.js / pg / Drizzle over Hyperdrive;
raw Neon only for migrations/backups/restore/replication/long admin jobs. **Never expose
Neon credentials to customer code or browsers.**

**Tenant promotion** `D1 → shared Neon shard → dedicated Neon` via Workflows + Queues
when p95 latency / query volume / storage / connection pressure / noisy-neighbor / plan /
isolation thresholds trip. Process: mark pending in D1 → create destination → copy →
verify row-counts/checksums → pause-writes-or-dual-write at cutover → switch KV allocation
→ smoke test → keep old shard read-only → finalize after a verification window.

**Cacheable PG reads** (KV/R2/Hyperdrive): published content, tenant settings, public
catalog/listing, theme config, plan config, non-private public data. **Never cache**:
auth/session checks, payments, admin mutations, private user data, secrets, per-user
authorization.

---

## 5. Browser automation — the naming split

| Host | Purpose | Public |
|---|---|---|
| `browser.projectsites.dev` | The product browser-automation gateway: CF Browser Run + Playwright + Stagehand; screenshots, PDF, QA, extract, visual/SEO/OG checks, metadata, health | Product / internal API |
| `mcp.megabyte.space/browserbase` | Internal Browserbase MCP bridge for Claude Code / internal agents / ops | Internal only, behind CF Access |
| `skyvern.megabyte.space` | Internal workflow agent for premium long-running logged-in portal automation | Internal only, behind CF Access |

Product/agent code calls **`browser.projectsites.dev`** — never Browserbase/Skyvern
directly. Backend order: **CF Browser Run + Playwright → CF Browser Run + Stagehand →
Browserbase fallback (managed session/replay/proxy only) → skyvern_internal (internal
long-running only)**. See `docs/architecture/browser-automation.md`. The worker-side
provider-routing primitive lives in `src/services/browser_gateway.ts`.

**Rule of thumb:** `browser.projectsites.dev` = product abstraction · Browserbase =
internal MCP/fallback provider · Skyvern = internal heavy workflow agent. Never use
Skyvern for routine screenshots/QA/forms/PDF/crawls/health.

---

## 6. Observability

Worker **observability gateway** at `/monitoring/{sentry,posthog}`: validate
hostname/site_id, attach tenant metadata, redact PII, sample, block noisy clients, enforce
quotas, forward to Sentry/PostHog, write rollups to Analytics Engine, optionally archive
sampled payloads to R2.

- **Sentry** — high-value errors only (payment/auth/build/deploy failures, sourcemaps,
  paid-tier traces). Shared projects + `{tenant_id,site_id,hostname,plan,template_id,
  release,runtime,worker_name,route}` tags; virtual per-site property via filtering;
  dedicated project only for paid dev/pro tiers.
- **PostHog** — sampled + schema-controlled only; autocapture OFF; approved events only
  (pageview, claim_started/completed, form_submitted, checkout_started/paid,
  site_published, browser_qa_completed, lead_generated, domain_connected);
  Worker-reverse-proxied. NOT the default high-volume backend — **Analytics Engine** is.

Per-tenant quota metrics (Analytics Engine, rolled up to D1, exported to R2): requests,
visits, route hits, status codes, latency buckets, R2/KV/D1/Neon/Hyperdrive/Upstash ops,
AI Gateway + Workers AI + Vectorize usage, Browser Run minutes, Browserbase/Skyvern usage,
Sentry/PostHog events, email sends, queue jobs, workflow runs. Per-plan quota enforcement.

See `docs/architecture/observability.md`.

---

## 7. Agents

Cloudflare Agents SDK durable agents: SiteBuilder, SiteQA, LeadResearch, Outreach, SEO,
Support, Billing, ObservabilityTriage, BrowserAutomation. Every agent uses AI Gateway for
model calls, Workers AI by default, Vectorize / AI Search for retrieval, Agent Memory for
durable state, **`browser.projectsites.dev`** for browser work, Queues for long jobs,
Workflows for multi-step, D1 for canonical state, R2 for artifacts, Analytics Engine for
metrics, Sentry for high-value failures. Agents MUST NOT call Browserbase/Skyvern directly
unless the request is internal/admin and explicitly routed to the Megabyte internal layer.
See `docs/architecture/agents.md`.

---

## 8. Security & isolation

Turnstile on every public form (claim/contact/donation/login/magic-link/signup/lead).
CF Access on every internal tool (admin, staging, private APIs, MCP tools, Browserbase
bridge, Skyvern). Every tenant op validates `tenant_id + site_id + hostname + plan +
capability manifest + quota`. Secrets Store / Worker secrets for all sensitive config;
never expose DB/Neon/Upstash/Sentry/PostHog/Browserbase/Skyvern/CF-API credentials to
customer code or browsers. See `docs/architecture/security.md` +
`docs/architecture/internal-megabyte-tools.md`.

---

## Sibling docs (per §14)

- `browser-automation.md` · `database-allocation.md` · `observability.md` · `agents.md`
  · `security.md` · `internal-megabyte-tools.md` — created as the migration lands each plane.


---

<!-- folded from architecture/database-allocation.md (2026-06-27) -->

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


---

<!-- folded from architecture/browser-automation.md (2026-06-27) -->

# Browser Automation

> Parent doctrine: [`cloudflare-first.md`](cloudflare-first.md) §5. Worker code:
> `src/services/browser_gateway.ts` (routing LAW) + `src/routes/browser_service.ts`
> (the `/v1/browser/*` service).

## The naming split (HARD)

| Host | Role | Public |
|---|---|---|
| `browser.projectsites.dev` | Product browser-automation abstraction — CF Browser Run + Playwright + Stagehand | Product / internal API |
| `mcp.megabyte.space/browserbase` | Internal Browserbase MCP bridge (Claude Code / agents / ops) | Internal, behind CF Access |
| `skyvern.megabyte.space` | Internal heavy-workflow agent (logged-in portals, 12-step flows) | Internal, behind CF Access |

**Product/agent code calls `browser.projectsites.dev` — never Browserbase or
Skyvern directly.**

## Routing LAW (`chooseBrowserProvider`)

Backend order: **CF Browser Run + Playwright → CF Browser Run + Stagehand →
Browserbase fallback → `skyvern_internal`**.

| Job input | → provider | reason |
|---|---|---|
| default (no preference/specialty) | `cf` | cf-default |
| `backendPreference` set | that provider | backend-preference |
| `specialty` (captcha / residential_proxy / session_replay / live_view / long_session / stealth) | `browserbase` | specialty |
| CF binding absent | `browserbase` | cf-unavailable-fallback |

`skyvern_internal` is **never** chosen by the default LAW or as a fallback — only
when an internal/admin job sets `backendPreference: skyvern_internal`. The product
gateway `connectBrowser` **refuses to execute** Skyvern (throws); the internal
Megabyte layer runs it.

## The service (`/v1/browser/*`)

Nine purposes: `screenshot · pdf · qa · form-test · extract · visual-check ·
metadata · health-check · stagehand`. Every job is tenant-scoped + Zod-validated
(`BrowserJobSchema`):

```ts
{ tenantId, siteId, hostname?, backendPreference?: "cloudflare"|"browserbase"|"skyvern_internal",
  specialty?, budgetCents?, timeoutMs?, priority? }
```

- `400` on an invalid job · `202 { status:'routed', provider, reason, purpose }` on
  accept · `503 BROWSER_PROVIDER_UNAVAILABLE` when the requested backend isn't
  configured.

## Outputs + observability (next sub-slice)

Execution (screenshot/pdf via CF Browser Run; Stagehand for AI-resilient pages)
stores outputs in R2 (screenshots, PDFs, HAR, extraction JSON, QA reports, logs),
job metadata in D1, metrics to Analytics Engine, failures to Sentry with
tenant/site tags. Browserbase fallback usage + Skyvern internal usage are tracked
for the cost-anomaly watchdog.


---

<!-- folded from architecture/scale-to-zero-apps-routing.md (2026-06-27) -->

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
