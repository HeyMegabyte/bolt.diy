# ProjectSites.dev — Convergence Backlog (single merged source of ideas + recommendations + features)

> **This is THE one backlog the convergence loop addresses.** It absorbs and supersedes every
> prior ideas/recs/features doc. `_ULTIMATE_LOOP.prompt.md` is the loop *driver*; THIS file is the
> loop *work-list*. Each item is a flagged module/change with its own E2E + 6-criterion DoD
> (`feature-module-architecture`). The loop is NOT done until every item here is shipped or
> explicitly retired in `DECISIONS.md`.
>
> **Format law (per the convergence mandate).** Every plane + feature below is expressed as four
> requirement classes: **▸Technical** (what the code must do) · **▸In-spirit** (the UX/quality
> feeling) · **▸Philosophical** (the durable principle) · **▸Business / flags** (the revenue lever +
> the `feature_flags` key that gates it, always launched `enabled=0, rollout=0, stage=experimental`).
> Sources are grounded with a compact **Evidence** line (`Source — takeaway — retrieved 2026-06-18`).

---

## 0 — Folded sources (the loop reads these; this file is the index)

- `_LOOP_LEDGER.md` — live P0→P3 open-item ledger (re-scanned every iteration).
- `FEATURE_CATALOG.md` — de-stub source of truth: 3 shared cores + verified-missing modules + build order. **Merged-pointer → this file is canonical.**
- `RESEARCH_IDEAS_2026H2.md` — the original 30 research-grounded ideas (MCP moat, edge substrate, security, agent commerce, GTM, gen-UX). **Merged-pointer → §F below indexes them; this file is canonical.**
- `AGENT_NATIVE_POSITIONING.md` §4-5 — the 30 agent-grade MCP/OAuth/trust/reliability features.
- `ROADMAP.md` — the single revenue-sorted build list + the 30 capital-efficiency margin levers.
- `EDGE_HOSTING_STRATEGY.md` — the edge-hosting thesis + the dogfood-through-our-own-primitives plan.
- `DECISIONS.md` — where any item is explicitly retired (the only way to remove an item from scope).

---

## 1 — Architecture planes (absorbed from the 6 source prompts)

Five **infrastructure planes** + the main app. **No mega-container** — each plane is its own
container/scaling boundary on a shared private network, shared secrets strategy, shared ingress,
shared observability, shared backup. Public names are vendor-neutral; vendor names live only as
internal `*.internal` aliases. Live in `infra/automation-plane/` (compose split by profile:
`compose.yml` + `compose.{jobs,events,traces,llm,browser,observability,backup,dev}.yml`, one private
network `projectsites-automation`).

### Plane boundary law (the rule of thumb)
- **Hono main app owns PRODUCT policy** — tenant resolution, domain→site/customer lookup, auth
  decisions, billing status, plan entitlements, feature flags, claim-flow logic, permissions,
  task *classification*, "is this action allowed". The app calls SDKs, never raw provider SDKs.
- **The planes own EXECUTION policy** — model/provider routing, retries, fallbacks, spend, browser
  provider selection, trace emission. If it needs to know tenants/billing/domains → Hono. If it
  needs to know model cost/latency/provider compatibility → llm-gateway. **Never duplicate.**

### Plane A — `llm.projectsites.dev` (AI control plane: LiteLLM + RouteLLM, ONE service)
- **▸Technical** — combined LiteLLM proxy + RouteLLM/custom routing in one horizontally-scalable
  container (`ghcr.io/berriai/litellm-database:main-stable` + Postgres + Redis). Model aliases
  (`cheap`/`cheap-code`/`content`/`site-builder`/`architect`/`security`/`database`/`auth`/`billing`/
  `final-review`/`research`/`eval`/`quorum-premium`). Provider base URLs point at **Cloudflare AI
  Gateway** (`https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/{provider}`) for caching, rate/spend
  limits, DLP, `llama-guard-3-8b` guardrails, fallback, OTLP export. Virtual keys + per-key budgets.
  The Hono app calls a typed **`@projectsites/ai-gateway-client`** SDK (`ai.complete({tenantId, siteId,
  actorId, domain, task, importance, input, budgetPolicy, traceContext})`) — NEVER a raw `openai`/
  `@anthropic-ai/sdk`/`@google/genai` import (lint-blocked outside `services/llm-gateway` + adapters).
  Shared `AiTask`/`AiImportance`/`AiCapability` unions in `packages/ai-policy`. RouteLLM starts in
  **shadow mode** (rules router decides; RouteLLM predicts in background; promote on ≥90% agreement,
  never first for auth/billing/db/security/final-review). **Quorum/bake-off** (flag-gated, off by
  default): fan N premium providers, wait for first K, LLM-as-judge merge — critical tasks only.
- **▸In-spirit** — every AI call streams; the user never waits on a trace; cheap-by-default feels
  instant, premium feels considered.
- **▸Philosophical** — *one place for secrets, budgets, fallbacks, observability, routing.* DeepSeek
  for volume, premium (Anthropic/OpenAI) for judgment + ALL vision, Workers AI for reflexes; collapse
  toward Workers AI as it matures (`model-routing` § Provider cost tiers).
- **▸Business / flags** — `ai_quorum_premium` (bake-off), `ai_routellm_shadow`, `org_ai_budget_cap`
  (margin killswitch — turn ON early), `token_burn_meter`. Default text→DeepSeek, instant→Workers AI.
- **Evidence** — LiteLLM docs — OpenAI-compat proxy, config.yaml aliases, per-key budgets, Redis+PG — retrieved 2026-06-18. · Cloudflare AI Gateway docs — `gateway.../{provider}` URL, caching, guardrails (llama-guard-3-8b), DLP, OTLP export, `default` gateway auto-create — retrieved 2026-06-18. · lm-sys/RouteLLM (ICLR 2025) — shadow-mode promote-on-agreement, ~85% cost cut at 95% quality — retrieved 2026-06-18. · DeepSeek pricing 2026 — V4-Flash $0.14/$0.28 per M, 1M ctx, default-on cache (74% input cut) — retrieved 2026-06-18.

### Plane B — `traces.projectsites.dev` (Langfuse observability — SEPARATE, never merged into llm-gateway)
- **▸Technical** — current v3 self-host shape: `langfuse-web` (3000) + `langfuse-worker` (3030) +
  Postgres 17 + ClickHouse + Redis 7 (`noeviction`) + S3-compatible object store (R2). **Async-only**
  ingestion (web → S3 → Redis queue → worker → ClickHouse; never blocks the hot path; send via
  `waitUntil()`/Queues). Protect with Cloudflare Access/SSO. Trace fields carry `tenantId/siteId/
  domain/actor/task/model/provider/route_reason/latency/first_token_ms/tokens/cost_usd/cache_hit/
  fallback_count/prompt_version/prompt_hash/response_hash/eval_score/trace_id`. Sampling: 100% errors
  + 100% premium + 100% evals + configurable for cheap successes. **Prefer Langfuse Cloud** if
  self-host overhead isn't justified (DB-heavy backend).
- **▸In-spirit** — every bad output is debuggable in one click: model fault vs missing context.
- **▸Philosophical** — *observability is the product for AI maintainers* (`production-observability-default-on`).
- **▸Business / flags** — `langfuse_tracing` (always-on once wired); links surfaced in admin → §K.
- **Evidence** — Langfuse self-host docs — v3 six-container (web/worker/PG17/ClickHouse/Redis7/MinIO), async S3→Redis→ClickHouse pipeline — retrieved 2026-06-18.

### Plane C — `browser.projectsites.dev` (provider-neutral browser gateway)
- **▸Technical** — `packages/browser-router` + provider adapters (`cloudflare-browser-run`,
  `stagehand-cloudflare`, `skyvern`, `browserbase`, `steel`, `local`) + `browser-artifacts` +
  `browser-safety` + `browser-evals` + a **Firecrawl** adapter (`G4brym/workers-firecrawl`, the
  CF-Workers Firecrawl) for managed crawl/scrape/markdown when self-driving Browser Run is overkill.
  Typed contract (`BrowserTaskRequest`/`BrowserTaskResult`,
  discriminated `BrowserProvider`/`BrowserEngine`/`BrowserTaskMode`/`BrowserFailureCode`, exhaustive
  switches). Endpoints `POST /run|/screenshot|/pdf|/extract|/crawl|/session|/stagehand/{act,extract,
  observe}` + `GET /runs/:id|/runs/:id/events(SSE)` + `POST /runs/:id/cancel`. **Default = Cloudflare
  Browser Run** (REST Quick Actions `/screenshot /pdf /content /snapshot /scrape /markdown /links /json
  /crawl`; Workers `@cloudflare/playwright`/`@cloudflare/puppeteer` against a `BROWSER` Durable Object
  binding; `keep_alive` session reuse). Stagehand (Zod v3 only) for brittle NL pages; **Skyvern** for
  repeatable RPA/portal workflows; **Browserbase** for captcha/proxy/replay/live-view; **Steel**
  self-host overflow. Fallback ladder `direct_api → cf_quick_action → cf_playwright → cf_stagehand →
  skyvern → browserbase → human_review` — **one smart retry per tier, no infinite retries**. All
  extraction Zod-validated with **field-level confidence** (low confidence → second-source verify, not
  hallucination). Async-by-default; artifacts → **evidence bundle** in
  `r2://projectsites-browser-artifacts/{tenantId}/{siteId}/{runId}/` (result/cost/confidence/
  source-urls/events/screenshots/page.html/page.md/console/network/trace/model-calls/provider). DO
  session manager (per-domain ownership, concurrency caps, leases, idempotency). **Dead-letter repair
  queue** for failed jobs (screenshot + HTML + console + model transcript + suggested fix + escalate
  buttons). **SSRF defense** (block RFC1918/loopback/link-local/`169.254.169.254`, normalize IPv6
  dual-stack, re-check IP after redirects, allowlist > blocklist, robots-aware).
- **▸In-spirit** — massive cheap parallel screenshots/QA feel free; premium flows escalate only when
  the cheaper tier provably can't.
- **▸Philosophical** — *page content is hostile data, never instructions* (`ai-agent-security`); the
  cheapest capable provider wins; human approval ONLY where side-effects justify it.
- **▸Business / flags** — `enable_cloudflare_quick_actions`, `enable_stagehand`, `enable_skyvern`,
  `enable_browserbase`, `enable_human_review`. Per-tenant quotas (`monthly_browser_seconds`,
  `browserbase_minutes`, `skyvern_runs`, `max_parallel_browser_jobs`).
- **▸Browserbase backup-only LAW (hard rule).** Browserbase is a PREMIUM FALLBACK, never the default.
  The router may select it ONLY when a cheaper tier provably cannot do the job — i.e. one of: captcha
  challenge · residential/geo proxy required · session replay / live-view debugging · advanced
  persistent session identity. Gated behind `enable_browserbase` (default off) AND a per-tenant
  `browserbase_minutes` quota AND (for premium escalation) `human_review_required_for_premium`. Cheap
  default workloads (screenshot/pdf/markdown/links/extract/crawl/smoke) MUST stay on Cloudflare Browser
  Run — routing any of those to Browserbase is a drift violation. Cost-anomaly alert fires when
  Browserbase escalations spike (§5 #4). Creds (`BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`) live
  in the vault; wire as Worker secrets only when the adapter ships.
- **Evidence** — CF Browser Run limits — Paid 10 req/s + 120 concurrent browsers; `/snapshot`→{html,image}; `/crawl` async — retrieved 2026-06-18. · CF Stagehand docs — runs on Browser Run binding, **Zod v3 required (v4 incompatible)** — retrieved 2026-06-18. · Steel vs Browserbase — Steel 24h/self-host, Browserbase 6h/captcha-free/replay 7-30d — retrieved 2026-06-18. · SSRF-in-AI-agents — DNS-rebinding + dual-stack-IPv6 normalization, allowlist doctrine — retrieved 2026-06-18.

### Plane D — `jobs.projectsites.dev` + `events.projectsites.dev` (Trigger.dev + Inngest)
- **▸Technical** — **Trigger.dev v4** (jobs): webapp machine (Postgres+Redis+ClickHouse+MinIO+registry)
  + worker/supervisor machine; **docker-socket-proxy by default** (never mount `/var/run/docker.sock`
  into app containers); resource limits per task; for long-running/scheduled/AI/deploy jobs needing run
  history + retries. **Inngest** (events): durable functions, fan-out/fan-in, step memoization,
  idempotency; external Postgres (Neon) + Redis for multi-node; for event-driven tenant-lifecycle +
  site-generation chains. **Keep Cloudflare Workflows** for the existing AI site-generation pipeline
  (already wired) + Queues for sub-second fire-and-forget. Every job/event carries `tenantId/siteId/
  userId/correlationId/runId/traceId/provider/engine`. HMAC-signed webhook payloads; per-tenant scoped
  keys (`jobs:run`, `events:publish`).
- **▸In-spirit** — background work is observable + resumable; a dropped worker never loses a job.
- **▸Philosophical** — *Cloudflare-native first* (Workflows/Queues) — reach for Trigger/Inngest only
  for richer run-history/durability than CF primitives give.
- **▸Business / flags** — `jobs_plane`, `events_plane`. Use-case docs in `docs/operations/`.
- **Evidence** — Trigger.dev v4 self-host — webapp+supervisor split, docker-socket-proxy default — retrieved 2026-06-18. · Inngest self-host — Postgres unlocks multi-node, step memoization, fan-out — retrieved 2026-06-18.

### Plane E — Auth / Authz / SSO / API-keys (app-owned, Cloudflare-first)
- **▸Technical** — **Better Auth** on Workers+Hono+**D1** (source of truth) + KV (hot cache only,
  ≥60s TTL); **factory pattern `createAuth(env, cf, baseURL)` per-request — never a singleton** (Workers
  are stateless; binding changes per invocation). Google OAuth + magic link + passkeys + 2FA. **Ory
  Polis** (BoxyHQ Jackson) on **Cloudflare Containers** for SAML/OIDC + **SCIM** (JIT provision +
  immediate deprovision, IdP-group→role map). **OpenFGA** on Containers (Postgres 14+ via Hyperdrive)
  for fine-grained authz — **every mutation requires a check**; **tuple-outbox** (write tuple in the
  same D1 txn as the domain mutation, background-publish to OpenFGA). ProjectSites-owned **Unkey-style
  API keys** on Workers+D1+KV (prefix lookup + SHA-256 hash + `crypto.subtle` constant-time compare +
  scopes + expiry + rate limit + revocation; KV short-TTL cache, D1 truth). Request flow:
  *session|API-key → scope check → OpenFGA check → audit*. Roles `owner|admin|editor|viewer|
  billing_admin`; scopes `site:{read,update,publish}`, `domain:{read,write}`, `forms:{read,write}`,
  `analytics:read`, `billing:{read,write}`, `ai:generate`, `mcp:invoke`, `api_keys:{create,revoke}`.
  Never trust client `org_id/site_id`; never let an ID infer another tenant's resources;
  billing/owner perms never via API key unless owner-created. Turnstile (invisible) on public auth
  forms; rate-limit login/magic-link/key-verify/SSO-callback; Cloudflare Access on internal/admin.
- **▸In-spirit** — auth is invisible when it works; a revoked key dies instantly; cross-tenant access
  fails *safely* (404, never a leak).
- **▸Philosophical** — *authentication proves identity; ProjectSites owns tenancy/billing/roles.* Don't
  roll your own crypto (`vendor-risk-tiering`). Hyperdrive cap (10 free / 25 paid) is a one-way door →
  sharded `DB Access Worker` pool (§Plane F), never thousands of configs on the router.
- **▸Business / flags** — `enterprise_sso`, `scim_provisioning`, `scoped_api_keys`. Tables: users,
  accounts, sessions, verification_tokens, orgs, org_memberships, sites, site_memberships, site_claims,
  tenant_domains, api_keys, api_key_usage, audit_events, enterprise_connections, scim_{users,groups,
  group_memberships}, fga_tuple_outbox.
- **Evidence** — better-auth-cloudflare — D1 adapter + KV secondary, factory-not-singleton, KV min 60s TTL — retrieved 2026-06-18. · OpenFGA docs — Postgres 14+, `HIGHER_CONSISTENCY` post-write reads, BatchCheck — retrieved 2026-06-18. · CF Hyperdrive pricing — 10 configs free / 25 paid — retrieved 2026-06-18. · Ory Polis — SAML→OIDC bridge + SCIM 2.0, Postgres store — retrieved 2026-06-18.

### Plane F — Data isolation (Hyperdrive-gated Postgres, sharded, quota-aware)
- **▸Technical** — **every Worker→Postgres call goes through Hyperdrive; no raw `DATABASE_URL` in
  Worker source** (lint-gated). Free/trial → shared DB, schema-per-site; standard paid → dedicated
  Neon DB per site; growth → tuned compute; enterprise → Neon project per customer. **Sharded DB-Access-
  Worker pool**: router resolves Host→site/customer/`db_access_shard`; each shard owns a *bounded* set
  of Hyperdrive bindings, validates tenant scope, logs every query with `trace_id`, denies cross-tenant.
  Quota-aware provisioning (capacity manager + account/config registries + capacity alerts + limit-
  increase workflow + fallback queue when exhausted; multiple CF accounts as capacity pools). Lifecycle:
  provision/verify/migrate/suspend/resume/rotate-credentials/resize-pool/move-region/recreate-config/
  archive/delete. Neon scale-to-zero: on for free/trial, warm for paid/enterprise.
- **▸In-spirit** — the public site router resolves the app **before** any container; routing is edge-fast.
- **▸Philosophical** — *every query asserts tenant scope before data access* (`tenant-isolation`).
- **▸Business / flags** — `dedicated_db_per_site`, `hyperdrive_sharding`. Tables: customer_databases,
  hyperdrive_{accounts,configs,capacity_events}, customer_db_{migrations,audit_log}, app_db_bindings.
- **Evidence** — CF Hyperdrive — Postgres 9-17, 25 configs/account paid; bind shards, not the router — retrieved 2026-06-18.

### Plane G — Secrets (Infisical platform secrets + per-tenant encrypted vault)
- **▸Technical** — **Infisical = source of truth for PLATFORM secrets** (LiteLLM master/salt, Langfuse
  keys, provider API keys, CF tokens, Browserbase/Steel, Postgres/Redis URLs, Sentry DSN, PostHog key,
  internal service tokens, **Novu secret key**). Sync to Cloudflare Worker secret bindings at
  deploy-time (Infisical CF-Workers sync / `wrangler secret bulk`) — **never per-request fetch**. Models
  never see raw secrets; tools get them via server bindings; expose capability names not values; redact
  from logs + model outputs; block prompts asking to reveal secrets. **Per-tenant credential vault**
  (customer OAuth tokens) = envelope encryption (per-tenant DEK wrapped by KMS/`crypto.subtle` KEK),
  audit on every decrypt, never plaintext in logs/responses, key-rotation plan. **Novu credential split
  (verified):** application identifier `TmBjOXewtEG8` is PUBLIC (frontend bundle); secret key is
  SERVER-ONLY (`NOVU_SECRET_KEY` Worker secret). Both saved to the chezmoi `get-secret` vault this turn;
  `NOVU_SECRET_KEY` still needs `wrangler secret put` on the prod worker.
- **▸In-spirit** — a secret is never one copy-paste from a leak; rotation is a runbook, not a panic.
- **▸Philosophical** — *platform secrets ≠ customer secrets* (different ownership → different stores).
- **▸Business / flags** — `infisical_sync`, `tenant_credential_vault`.
- **Evidence** — Infisical CF-Workers Sync — push-on-change to Worker env, not per-request; `wrangler secret bulk` ≤100 — retrieved 2026-06-18. · Vault Transit envelope encryption — per-tenant DEK, context-scoped KEK — retrieved 2026-06-18.

### Plane H — Unified Analytics ingestion (event API → PostHog/Sentry/GA4/GTM fan-out)
- **▸Technical** — a single `POST /api/events` Worker endpoint collects events from every
  generated customer site (the generator injects a `navigator.sendBeacon` tracker into each
  `index.html`), Zod-validates (`IncomingEventSchema`), writes a local copy to **per-site D1**
  (`analytics_events`), and enqueues to a per-site **Durable Object `EventDispatcher`** keyed by
  `siteId` (single instance → lock-free dedup). The DO: dedups by `eventId` (48h window), batches
  (10 events OR 5s), retries with exponential backoff (≤6) then a **dead-letter queue**, runs a
  **per-provider circuit breaker** (open at 5 consecutive fails, half-open after 60s), and fans out
  via `Promise.allSettled` to **Sentry FIRST** (error-critical path), then PostHog, GA4
  (Measurement Protocol), GTM — each via a provider-specific payload transform (never raw to all).
  Fast-ack `202` to the client (<500ms SLA; never blocks on provider latency). Idempotency keys on
  forward; GeoIP from `CF-Connecting-IP`; HMAC-signed payloads; per-site quotas (`site_quotas`,
  free 10k/mo · pro 1M · enterprise ∞ → `429` + quota-DLQ); sampling (`sample_rate`); replay/forensics
  (`raw_headers`). Debug surfaces: `GET /api/analytics-debug` (last-50 + circuit state),
  `POST /api/test-event?provider=` (synthetic per-provider connection test), `/api/analytics-data`
  (the Analytics tab feed). Diagnostics-first: the existing "Analytics tab shows nothing" bug is the
  injected-tracker + D1-schema + query-target checklist in the handoff.
- **▸In-spirit** — a site owner sees real traffic within seconds; ops see per-provider delivery
  status live without waiting on a vendor dashboard.
- **▸Philosophical** — *at-least-once delivery with dedup; degrade gracefully, never drop silently*
  (DLQ + circuit breakers); Sentry is the critical path, the rest are best-effort.
- **▸Business / flags** — `unified_analytics_ingest`, `analytics_live_events`. Tables:
  analytics_events, dead_letter_events, event_dedup, provider_credentials, circuit_breaker_state,
  site_quotas. Credentials already in D1; rotate via `/api/rotate-credentials` (admin).
- **Evidence** — CF Durable Objects — single-instance-per-key gives lock-free dedup + alarm-based retry scheduling + SQLite state across crashes — retrieved 2026-06-18. · GA4 Measurement Protocol / PostHog capture / Sentry envelope — provider-specific payload shapes (never forward raw) — retrieved 2026-06-18.

---

## 2 — Novu, fully integrated at every level (the notification backbone)

- **▸Technical** — Novu is THE notification layer (no ad-hoc email/toast-only events). **Server triggers**
  (`@novu/api`, `env.NOVU_SECRET_KEY`) at every state transition: `build.{started,finished,failed}`,
  `domain.{verifying,active,failed}`, `payment.{succeeded,failed}`, `quota.near_limit`, `trial.ending`,
  `member.{invited,joined}`, `ai.job.{completed,failed}`, `lead.scan.completed`, `browser.job.escalated`,
  `db.provision.{queued,ready,failed}`. Already wired: `src/services/novu_triggers.ts` (Zod discriminated
  union + `triggerNovu` never-throws) — **extend its event union to the full set above + call it from the
  workflow/billing/domain/auth services.** **Frontend** (`@novu/js`, public app id `TmBjOXewtEG8`,
  `api.novu.co` + `wss://socket.novu.co`): the admin bell (`NovuInboxService`) → ship the full trio —
  **Inbox** (bell + unread count + grouped feed), **Notification Center** (full history, filter,
  mark-read, archive), **Preferences** (per-channel, per-category opt-in) — all in Spartan UI + cyan/black
  `--ps-*` tokens, `gorgeous-by-default` (fade-in-up, `0.333s`, `<app-rolling-counter>` on the unread
  count). Topics for fan-out; subscriber sync on user create/update; tenant-tagged payloads.
- **▸In-spirit** — the bell feels alive (live socket), every notification says *what happened · why it
  matters · what to do next* (deep link); toasts are ephemeral, the center is the durable record.
- **▸Philosophical** — *every user-relevant event flows through Novu, tenant-scoped, typed, actionable.*
- **▸Business / flags** — `novu_inbox` (bell, can ship on), `novu_notification_center`,
  `novu_preferences`. Drives retention (re-engagement) + trust (build/payment transparency).
- **Evidence** — Novu Angular quickstart — `applicationIdentifier` public/client-safe, API key server-only, `@novu/js/ui` + `socketUrl: wss://socket.novu.co` — retrieved 2026-06-18. · novuhq/novu — topics fan-out, in-app+email+push channels, subscriber sync — retrieved 2026-06-18.

---

## 3 — Cross-cutting requirement lists (apply to EVERY plane + feature)

- **▸Technical (universal):** Zod at every boundary; TypeScript-first; discriminated unions + exhaustive
  switches for provider/job states; idempotency keys on every write; HMAC-signed webhooks; OTel
  `trace_id`/`correlationId` flow through every layer; structured JSON logs (`structured-logging`);
  per-call timeout + retry policy + tracing; dry-run mode for dangerous tools; append-only audit table
  for every external write; no raw provider SDK in app routes (lint-blocked); no secrets in logs.
- **▸In-spirit (universal):** blazing-fast (TTFR LCP ≤2.0s, INP ≤200ms, streaming everywhere, preload
  every route, SWR on list pages); gorgeous-by-default (Spartan UI, cyan/black, enumerables→pills,
  `0.333s`, rolling counters, `appReveal`, `:focus-within`); never a needless skeleton on re-visit.
- **▸Philosophical (universal):** Cloudflare-first (don't invent infra CF has natively); server-side
  tool execution by default (the user's machine runs nothing unless they connect local MCP);
  human-approval ONLY for genuine side-effects (outreach/social-post/charge/DNS/claim/gov-form/legal/
  delete/publish); open-source-first for commodity systems, in-house for ProjectSites business logic;
  the loop is the unit of intelligence.
- **▸Business / flags (universal):** every non-trivial feature ships `enabled=0, rollout=0,
  stage=experimental`; kill switches per model/provider/tenant/site/route/agent + global AI killswitch;
  per-tenant budgets + rate limits + cost-anomaly alerts; PostHog PQL milestones (`site_generated`,
  `custom_domain_added`, `third_deploy`) → in-app upgrade.

---

## 4 — The ProjectSites MCP (canonical programmatic UI) + OpenAI-compatible AI endpoint

- **▸Technical** — a complete **ProjectSites MCP server** (CF Worker + Hono + Agents SDK, Streamable
  HTTP, OAuth 2.1 + per-user consent) exposing *everything the admin UI can do* (list/create/generate/
  regenerate/edit sites, pages, assets, forms, submissions, customers, subscriptions, Stripe/Square,
  domains+DNS verify, claim flows, research+confidence, approve/reject content, publish/unpublish,
  rollback, analytics/logs/errors, trigger tests + Lighthouse, feature flags, integrations, social
  connect+post+schedule, MCP tool status, export audit logs). Read-only mode + write-with-scopes +
  dry-run + confirmation gates for irreversible actions; tool schema from OpenAPI/Zod; tenant isolation;
  idempotency keys; tool results scrubbed of secrets; append-only audit. **OpenAI-compatible endpoint**
  (`/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/embeddings`, `/mcp`, `/oauth/{authorize,
  token,register}`, `/health`, `/admin/{model-router,tool-registry}`) with **server-side tool execution**
  (social/GitHub/Bash/Linux run in the server sandbox, not the user's machine, unless they connect local
  MCP). Controlled Linux sandbox (ffmpeg/imagemagick/pandoc/poppler/rg/jq/node/python/playwright/lint/
  vitest) — command allowlist, egress allowlist, per-run CPU/mem/disk/timeout, per-tenant isolation,
  full audit.
- **▸In-spirit** — an agent operates ProjectSites as fluently as a human in the dashboard — but never
  *more* powerfully (same-or-stricter permissions).
- **▸Philosophical** — *the MCP is a programmatic UI, never a permission bypass.*
- **▸Business / flags** — `projectsites_mcp`, `ai_endpoint_openai_compat`, `server_side_tool_exec`,
  `linux_sandbox`. The MCP-native moat = own generate + host + MCP together (nobody else does).
- **Evidence** — Vercel AI-Gateway index — agents drive >50% of commits, Claude Code 75% of agent deploys; agent apps 20× more inference-hungry; Vercel has no native DB — retrieved 2026-06-18.

---

## 5 — Thirty NEW brilliant features (my recommendations — net-new, grounded, bundle-ready)

> Distinct from the 30 in `RESEARCH_IDEAS_2026H2.md` (§F). Each is a flagged module with E2E + DoD.
> Format kept tight: **name — what + why — flag.**

1. **Unified Trace Lens** — one `correlationId` joins app→job→event→browser-run→LLM-call→Langfuse trace; admin "Trace Lens" follows one request across all planes. → `trace_lens`.
2. **AI Budget Governor (live)** — per-tenant/site $-meter with soft-warn + hard-stop + Novu `quota.near_limit` at 80%; blocks the call, not the user. → `ai_budget_governor`.
3. **Provider Health Auto-Failover** — passive health checks on every provider; AI Gateway + browser router auto-route around a degrading provider; admin sees green/amber/red. → `provider_auto_failover`.
4. **Cost Variance Watchdog** — store estimated vs actual cost per AI/browser run; alert when variance, retry-rate, or Browserbase escalations spike (anomaly events → Novu). → `cost_variance_watchdog`.
5. **Eval-Gated Promotion** — no model-alias/route change ships without passing the promptfoo CI suite (schema/route/injection/tenant-leak/isolation); CI fails on isolation or secret-leak. → `eval_gated_promotion`.
6. **Golden Workflow Replay** — a corpus of real pages (restaurant/church/contractor/nonprofit/Stripe/Square/gov-form/claim-flow) replayed nightly through the browser router; tracks success/schema/cost/confidence per provider. → `golden_workflow_replay`.
7. **Context-Readiness Gate** — score required-slots × retrieval-hits × confidence (0-100); BLOCK generation below threshold, auto-fetch gaps first (Context7 pre-step + rerank-before-pack). → `context_readiness_gate`.
8. **Per-Site MCP Auto-Mint** — every published site auto-exposes its D1/R2/KV as scoped MCP tools (reuses `mcp_site.ts`); the single biggest differentiator. → `per_site_mcp`.
9. **Production-Readiness Score** — letter-grade gate before publish (auth-on-data, rate-limit, secret-scan, error-boundary, SSRF, no client-secrets); the category's #1 unsolved gap. → `production_readiness_score`.
10. **No-Client-Secrets Build Gate** — build fails on any secret in the client bundle (Lovable's exact CVE). → `no_client_secrets_gate`.
11. **Claim Auto-Build Resume** — `claimyour.site/{slug}` prefills `/create` + auto-starts an event-sourced, resumable build that continues if the user leaves; `/create` edits merge into the next rebuild. → `claim_auto_build`.
12. **Integration Tile `?` Doctrine** — every OAuth/MCP/integration tile carries a `?` tooltip (required account · requested scopes · what it enables · optional/required · data-retention). → `integration_tile_help`.
13. **Dead-Letter Repair Studio** — failed browser/AI/job runs become repairable cards (last screenshot + HTML + console + model transcript + suggested fix + escalate-to-Skyvern/Browserbase/human). → `dead_letter_studio`.
14. **Human-Approval Inbox** — a single queue for the *few* side-effect actions that need a human (outreach/social/charge/DNS/claim/gov-form/legal/delete/publish); Novu-driven, mobile-approvable. → `human_approval_inbox`.
15. **Field-Confidence Extraction** — every business-research field records value+confidence+source-URL+provider+screenshot+timestamp; low confidence → second-source, never hallucinate. → `field_confidence_extraction`.
16. **Quorum Bake-Off (critical only)** — N premium providers in parallel, first-K, judge/merge; flagged off; for architecture/security/final-QA only (cost = N×). → `ai_quorum_premium`.
17. **RouteLLM Shadow Dashboard** — live agreement-rate between the rules router and RouteLLM's prediction; promote a task class only past the threshold. → `routellm_shadow`.
18. **Grok Live-Research Lane** — a dedicated freshness lane (is-this-business-active, competitor discovery, reputation, claim-confidence) when public-web/social signal matters. → `grok_research_lane`.
19. **Edge Per-Visitor Personalization** — DO-backed per-visitor hero/CTA swap on generated sites (behavioral), measured by conversion lift. → `edge_personalization`.
20. **Visitor Analytics Beacon** — a privacy-light, cookie-free beacon on every generated site feeding the owner's admin + the upgrade PQL. → `visitor_beacon`.
21. **Concierge Widget Injection** — the published site gets an AI concierge (site-scoped MCP-backed) that answers visitors + books; retention + conversion. → `concierge_widget`.
22. **Voice Receptionist at Publish** — opt-in voice agent (already partly built) offered at the publish step. → `voice_receptionist`.
23. **GEO + Citation Tracking** — generated sites ship FAQPage JSON-LD + quotable answer blocks; track when AI-search engines cite the site. → `geo_citation_tracking`.
24. **Hand-off-to-Engineer Export** — one-click GitHub repo (Worker source + D1 schema + `wrangler.toml` + `HANDOFF.md`); makes us the start, not the end → every handoff is a referral. → `engineer_handoff_export`.
25. **PWA-Upgrade Button** — one click adds manifest + Workbox sw.js + offline.html + A2HS + iOS splash to any generated site. → `pwa_upgrade`.
26. **Deploy-Button + "Hosted on" Badge** — 5 starter templates with one-click deploy + a footer badge → viral loop (Vercel's #1 top-of-funnel). → `deploy_buttons`.
27. **`run_code` Sandbox MCP Tool** — agents submit code → CF Sandbox SDK runs it (per-10ms billing) → streams back; closes generate→**test**→deploy in the editor. → `run_code_sandbox`.
28. **DB-per-App, free** — a D1/DO-SQLite per deployed app (GDPR-delete = drop DB; branch-a-DB for preview); the gap Vercel left open. → `db_per_app`.
29. **`paidTool()` Dual Rails** — devs mark an MCP tool paid; bill via x402 (per-call) or Stripe MPP (session cap); platform takes a cut. → `paid_tool_metering`.
30. **Trust Center + Status Page** — `status.projectsites.dev` (free CF status) + `/trust` (uptime SLA, edge residency, SOC-2 roadmap, "no client secrets" guarantee); ~$0, shortens enterprise security reviews. → `trust_center`.

---

## 6 — Admin surfaces the planes need (per `L`/§K of the source prompts)

AI routes · model catalog · provider health · per-site AI usage/budget · routing decisions · eval
results · Langfuse trace links · promptfoo reports · domain routing · custom hostnames · DB shards ·
Hyperdrive bindings/accounts/capacity · DB Access Workers · customer DB provisioning queue/health ·
browser jobs + evidence viewer · provider runs · cost dashboard · tenant limits · dead-letter repair ·
human approvals · claim-flow builds · feature flags (simple + super-admin, rollout %, allowlists, kill
switches) · generated-site visual-diff · Novu inbox/center/preferences. All Spartan UI + TanStack Table
+ Monaco (where editing) + ECharts (where charts) + cyan/black tokens.

---

## 7 — Status endpoint + ops scripts

`/health` status check: Trigger · Inngest · Langfuse web+worker · llm-gateway · browser providers ·
Postgres · Redis/Valkey · ClickHouse · object storage · Novu. Scripts: `automation:{up,down,logs,ps,
health,backup,restore,test}`. Docs: `docs/architecture/{ai-gateway,model-routing,browser-automation,
secrets,ollama}.md` + `docs/operations/{llm-gateway,langfuse,browser-run,infisical,trigger,inngest,
novu}.md` + provider decision matrix + cost model + safety policy + feature-flag docs. **No real secrets
in the repo; `.env.example` is names-only.**

---

## 8 — Agent-OS meta-layer (global `~/.claude` / `~/.agentskills` — distinct from this repo)

Two of the source prompts are **meta**: they optimize Brian's global AI operating system
(`~/.claude/CLAUDE.md` short durable laws · skills loaded on trigger · subagents · hooks · path-scoped
rules · the 25-paradigm `~/.agentskills/skill-*` set · the model-routing + server-side-tool-execution +
ProjectSites-MCP + AI-endpoint doctrines). That work lands in `~/.claude` + `~/.agentskills` (backed up
timestamped first, audit file, evidence-cited, list-based), **not** in this repo. The convergence LOOP
already operates under those rules; new lessons fold back into `~/.agentskills` the same turn
(`prompt-as-training-signal`). This backlog tracks only the PRODUCT planes (§1) + features (§5); the
agent-OS refactor is its own session against the home dir.

---

## 9 — Credentials status (this arc)

- **Novu** — `NOVU_APPLICATION_IDENTIFIER` (`TmBjOXewtEG8`, public), `NOVU_SECRET_KEY`, `NOVU_API_URL`,
  `NOVU_SOCKET_URL` all saved to the chezmoi `get-secret` vault; `NOVU_SECRET_KEY` uploaded to the prod
  worker secret; frontend app id fixed. **Rotate the secret** (it traveled through chat). 
- **Firecrawl** — wire `FIRECRAWL_API_KEY` (or self-host `G4brym/workers-firecrawl`) as a Worker secret
  before enabling the `firecrawl` browser adapter.
- **Browserbase** — `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` saved to the chezmoi `get-secret`
  vault. **Backup-only** per the Plane-C hard rule (premium fallback for captcha/proxy/replay/identity
  ONLY, `enable_browserbase` default off). Upload to the Worker secret only when the adapter ships.
  **Rotate the key** — it traveled through chat.

---

> **F — The original 30 research ideas** live in `RESEARCH_IDEAS_2026H2.md` (MCP moat #1-6, edge
> substrate #7-12, security #13-17, agent commerce #18-22, GTM #23-27, gen-UX #28-30). They remain in
> scope as ledger items; this file is the single entry point that points at them.
