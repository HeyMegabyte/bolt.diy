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
