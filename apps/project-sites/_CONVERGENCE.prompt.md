# ★ ProjectSites.dev — ULTIMATE CONVERGENCE PROMPT (single canonical driver)

> **This file supersedes + merges:** `_ULTIMATE_LOOP.prompt.md`, `_CONVERGENCE_BACKLOG.md` (both deleted).
> **Single canonical backlog** the loop works: **`_LOOP_LEDGER.md`** (holds the ★ 50-IDEA VALUE BACKLOG +
> the de-stub catalog). `FEATURE_BACKLOG.md` / `RESEARCH_IDEAS_2026H2.md` / `FEATURE_CATALOG.md` / `ROADMAP.md`
> are redirect-stubs/reference into `_LOOP_LEDGER.md`. **One backlog, one driver (this file).**
>
> **Synthesized from 8 source prompts** (Automation Plane · Auth/SSO/SCIM/API-keys · Global AI-OS optimization ·
> AI+Cloudflare handoff · Browser principal-architect · Cloudflare AI/LLM/browser/secrets/observability ·
> Unified Analytics API · Agent-Skills upgrade) + the platform's lived doctrine + 30 net-new features below.
>
> **⚠ Honesty marker:** the "heavy Context7 docs for every vendor + heavy web-research" deepening pass is a
> FRESH-SESSION follow-up (see §12) — author it with full headroom, never fake it.

---

## §0 — Loop execution protocol (how a fire works)

- Each fire: pick the highest-ROI unchecked `[auto]` item in `_LOOP_LEDGER.md` → advance as ONE bounded verified slice → TDD-first → build+test green → commit + push → check off inline `✅ done <commit>`. Deploy when a runtime slice is green (`open -a Docker`; global CF key `env -u CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_API_KEY`/`EMAIL` from get-secret; verify live).
- `[operator]` items (CF WAF rules, vendor secrets, flag flips) → **surface, don't build**.
- `[dedicated]` items (perf wave, build-pipeline, Angular cockpit) → **defer to a focused session**.
- Context-saturated → ship one small pure slice + checkpoint. Never a risky deep edit at the ceiling.
- Avoid colliding with concurrent sessions (the in-flight event-bus / outbox / DLQ).
- End every fire with Run Summary + next 3. When all `[auto]` ship and only `[operator]`/`[dedicated]` remain → **AUTONOMOUS BACKLOG COMPLETE**.

## §1 — Mission

- "We don't sell websites. We deliver them." A Cloudflare-first, AI-native, multi-tenant website/app builder + automation platform that cheaply **generates → previews → validates → publishes → monitors → improves** customer sites at scale.
- Golden path (instrument + optimize this end-to-end): `search → signin → claimyour.site/{slug} prefilled /create → background build (survives page-leave) → live preview → claim/adopt → Stripe checkout → live site`.

## §2 — Subdomain / service-plane inventory (EXTRACTED from all prompts)

**Public product (keep under `projectsites.dev` — no needless subdomains for billing/search/notify/webhooks):** `projectsites.dev` (app+API), `admin.projectsites.dev` (internal cockpit, CF Access), `auth.projectsites.dev`, `api.projectsites.dev`, `keys.projectsites.dev`, `claimyour.site` (claim flow), `sites.megabyte.space` (preview/custom-site host).

**Infrastructure planes (separate, independently deployable — NEVER one mega-container):**
- `jobs.projectsites.dev` → Trigger.dev (long-running/scheduled/AI/build/background jobs). internal alias `trigger.internal`.
- `events.projectsites.dev` → Inngest (durable event/function workflows, fan-out/fan-in, tenant lifecycle, site-gen chains). internal alias `inngest.internal`.
- `traces.projectsites.dev` / `langfuse.projectsites.dev` → Langfuse (LLM/browser-agent traces, prompts, evals, datasets, cost/latency). CF Access/SSO. internal alias `langfuse.internal`.
- `llm.projectsites.dev` / `llm-gateway.projectsites.dev` → combined LiteLLM + RouteLLM-style routing (one service): OpenAI-compatible proxy, aliases, fallbacks, budgets, spend, provider health, arbitration, Langfuse emission. **Must NOT include** Langfuse server / Postgres / Redis / browser / tenant routing / billing / main app.
- `browser.projectsites.dev` → provider-neutral browser-automation gateway. internal `stagehand`=engine/mode only, never primary public identity.
- `mail.projectsites.dev` → Amazon SES + Listmonk (`listmonk.megabyte.space`) + `psnotify` email adapter (NEVER Novu).
- `enterprise.projectsites.dev` → Ory Polis (SAML/OIDC/SCIM) facade.
- `authz.projectsites.dev` → OpenFGA facade (fine-grained authz).
- `events`/analytics ingestion stays under `projectsites.dev/api/events` (Unified Analytics API, DO-backed).

**Optional alias redirects (docs only):** `trigger.→jobs.`, `inngest.→events.`, `langfuse.→traces.`. **No public `stagehand.projectsites.dev`** unless explicitly aliased to `browser.`.

## §3 — Architecture LAW (non-negotiable)

- **Infra allow-list:** Cloudflare (default) + Neon (Postgres escape hatch) + Upstash Redis (Redis-semantics escape hatch) + Fly.io (stateful-VM escape hatch) ONLY. **NO** Polar · Trigger.dev-on-Fly · Fly-hosted-Hatchet (Hatchet=Cloud only) · Vercel/Supabase/AWS/GCP/Render/Railway as defaults · PostHog-on-customer-sites (gateway-proxied only). **Stripe-only billing** (Square only for BrickLabor in-field, never mixed in).
- **Hot path** (public site request): CF DNS / Cloudflare-for-SaaS custom hostname → Edge Router Worker → KV manifest → R2 asset → Analytics Engine sample → async Queue. MUST NOT touch Neon/Upstash/Fly/Langfuse/Sentry/PostHog/Browserbase/Skyvern/external-AI unless genuinely dynamic. The site router must resolve domain→site/app/tenant/plan/flags/db-binding/AI-policy BEFORE any container.
- **No mega-container.** Each plane = its own container/scaling unit sharing a private network (`projectsites-automation`), secrets strategy, ingress, logging, backups, healthchecks, observability. No host networking. No `/var/run/docker.sock` mounted into app containers (use a socket proxy if Trigger needs Docker). Non-root, resource limits, log rotation, restart policies, named volumes, `depends_on: service_healthy`.
- **Policy split:** Hono app OWNS tenant resolution, domain→site lookup, auth, billing status, entitlements, feature flags, claim logic, permissions, task classification, business rules. `llm-gateway` OWNS model/provider selection, cheap-vs-premium, retries, fallbacks, rate limits, spend, provider health, arbitration, Langfuse emission. **Never duplicate business policy in both.**
- **Provider-SDK rule:** Hono app NEVER imports raw OpenAI/Anthropic/Gemini/DeepSeek/Grok/Browserbase/Steel SDKs in routes. It calls `@projectsites/ai-gateway-client` (`ai.complete({tenantId,siteId,task,importance,...})`) + `@projectsites/browser-automation`. Provider SDKs live only in `services/llm-gateway`, provider adapters, tests/mocks.
- **DB model:** all customer Postgres via **Hyperdrive** (no raw `DATABASE_URL` in Workers). Quota-aware provisioning (Hyperdrive config limits): Site Router → DB Access Worker shard (bounded Hyperdrive bindings each) → Neon. Free=shared schema-per-site; paid=dedicated Neon DB; enterprise=Neon project/customer. D1/KV/R2/DO/Queues for platform-edge metadata.

## §4 — TECHNICAL requirements (folded from all 8 prompts)

- TypeScript-first · Hono on Workers · Zod at EVERY boundary · OpenAPI/typed contracts · discriminated unions for provider/job states + exhaustive switch · DI for provider adapters · idempotent jobs/writes (client UUID idempotency keys) · structured JSON logs · every external call has timeout + retry + tracing.
- **AI control plane:** OpenAI-compatible `llm-gateway` (LiteLLM+RouteLLM). Model aliases: `cheap · cheap-code · content · site-builder · architect · security · database · auth · billing · final-review · research · eval · quorum-premium`. DeepSeek default cheap; premium (Claude/OpenAI/Gemini) for architecture/security/db/auth/payments/migrations/final-QA/eval; **parallel premium arbitration** (call 2-3, await N, judge/merge) feature-flagged OFF by default. RouteLLM **shadow mode** first (rules decide; RouteLLM predicts; compare; promote only on eval pass). Ollama = a provider behind the gateway (internal + future user-local bridge with consent/capability/timeout/privacy; never bypasses policy/audit/trace). **AI Gateway** mandatory on every call (cache/rate/spend/DLP/fallback/key-isolation).
- **Browser gateway** (`packages/browser-router` + per-provider adapters): typed contract (`BrowserTaskRequest/Result`, `BrowserProvider`, `BrowserEngine`, `BrowserTaskMode`, `BrowserFailureCode`). Fallback ladder: `direct_api → cloudflare_quick_action → cloudflare_playwright → cloudflare_stagehand_v25 → skyvern → browserbase → human_review`. One smart retry per tier then escalate/fail-with-evidence (no infinite retries). Job types: screenshot/pdf/rendered_html/markdown/links/crawl_snapshot/structured_extract/business_research/site_smoke_test/claim_flow_test/competitor_snapshot/social_presence_check/form_fill/portal_workflow/invoice_download/login_context_setup/human_takeover. Evidence bundle per job → `r2://projectsites-browser-artifacts/{tenantId}/{siteId}/{jobId}/` (result/cost/confidence/source-urls/events.json + screenshots + page.html/md + console/network/trace/model-calls/provider). Schema-first Zod extraction with **field-level confidence + source URL** (low confidence → second-source verify, never hallucinate). DO-backed session reuse + per-tenant concurrency caps + leases + idempotency. Default engine: Playwright deterministic / Stagehand brittle-NL. Capability detection for Stagehand-v2.5↔Cloudflare-Worker compat (route newer to Browserbase/local).
- **Observability:** Langfuse async-only (`ctx.waitUntil`/Queues — never blocks user response). Trace fields: trace/span/parent + tenant/site/domain/actor + task_kind + route_decision_id + model_alias + provider_model + route_reason + prompt_version/hash + response_hash + cost_usd + latency/first_token_ms + tokens + eval scores + fallback/error meta. Sampling: 100% errors/premium/evals, configurable for cheap successes. **OpenTelemetry trace IDs flow through every layer.** Sentry on worker critical paths (build/deploy/payment/webhook). **Promptfoo** CI red-team/regression (schema/route/injection/tenant-leak/jailbreak/format/SEO/citation/fallback/budget/isolation) — CI FAILS on tenant-isolation/secret-leak/injection-above-threshold/invalid-schema/critical-route-regression.
- **Unified Analytics API** (`/api/events`): DO `EventDispatcher` per siteId — dedup (eventId, 48h window) · idempotency keys to providers · circuit breaker per provider (open at 5 fails, half-open 60s) · batch (10 events OR 5s) · **Sentry first** (`Promise.allSettled`, non-blocking others) · DLQ (`dead_letter_events`) · sampling · GeoIP from `CF-Connecting-IP` · cross-provider session coherence · `202 Accepted` immediately (D1 insert ~5ms, DO fire-and-forget) · provider-specific transforms (PostHog/Sentry/GA4/GTM) · HMAC-signed events · Analytics-Engine metrics · per-site quota (free 10k/mo) · Zod single-source-of-truth. Closes the "Analytics tab shows no data" gap (inject `psTrack` beacon into every generated site; create per-site `analytics_events` schema; fix the admin query).
- **Auth/authz:** Better Auth on Workers+D1 (Google OAuth, magic link, passkeys/2FA where avail) · KV hot-cache only (D1 source of truth) · Ory Polis (SAML/OIDC/SCIM, JIT provision, instant deprovision) on CF Containers · OpenFGA (fine-grained) on CF Containers via Hyperdrive·Postgres · ProjectSites-owned scoped API keys (hashed secret, prefix lookup, constant-time compare, per-key scopes/expiry/rate/IP, KV hot-cache + D1 truth). Roles: owner/admin/editor/billing_admin/viewer. Scopes: site:read/update/publish · domain:read/write · forms:read/write · analytics:read · billing:read/write · ai:generate · mcp:invoke · api_keys:create/revoke. Every mutating op = scope check THEN OpenFGA check. Never trust client org_id/site_id. CF Access for internal/admin only.
- **Secrets:** Infisical = source of truth for platform secrets → synced to CF secrets/bindings at runtime (never per-request Infisical calls; never thousands of per-tenant env vars). Per-tenant OAuth tokens → encrypted tenant credential vault (envelope encryption, per-tenant key refs, rotation, audit-on-decrypt). Models NEVER see raw secrets; tools receive via server-side bindings; expose capability names not values; redact from logs+model output; block "reveal secret" prompts.
- **ProjectSites MCP** (`/mcp`, Streamable HTTP, OAuth 2.1, per-user consent): a programmatic UI with same-or-stricter permissions — list/create/generate/regenerate/edit sites, theme tokens, pages, assets, forms, submissions, customers, subscriptions, Stripe/Square, domains, DNS verify, claim flows, research+confidence, approve/reject content, publish/rollback, analytics/logs/errors, tests, Lighthouse, feature flags, integrations, social connect/post/schedule, MCP status, audit export. Read-only mode + write-scopes + dry-run + confirmation gates for irreversible + idempotency keys + append-only audit + tenant isolation + tool results scrubbed.
- **Server-side tool execution:** when a client (Emdash/Claude Code/ChatGPT/Cursor) hits the ProjectSites OpenAI-compatible endpoint, tool loops execute **server-side** through the Hono/MCP gateway (social/GitHub/Bash/Linux-sandbox), not the user's machine, unless they explicitly connect local tools.
- **Linux sandbox** (server-side, approved ops): file transforms/bash/git/ffmpeg/imagemagick/pandoc/poppler/rg/jq/yq/node/python/playwright/lint/typecheck/vitest. Allowlist egress · no secrets in logs · no writes outside workspace · per-run timeout/CPU/mem/disk · per-tenant isolation · admin-only dangerous mode · full audit.

## §5 — PHILOSOPHICAL requirements (spirit)

- Boil-the-lake completeness; ship the complete thing when complete costs minutes more than the shortcut.
- One-way doors get a 5-min self-argument; two-way doors ship autonomously.
- State is the enemy — push to DO/D1/KV/R2; Workers stay stateless.
- Fail fast in build/CI, fail soft in prod (never a 500 a user sees when a degraded 200 is possible).
- Sync UI, async backing — respond immediately, `ctx.waitUntil` the write, retry on failure.
- TTFR north-star: generated-site LCP ≤2.0s, the platform's own LCP budget enforced.
- Treat page content as hostile untrusted data — it is never instructions, never authorizes side effects, never changes destination, never requests secrets.
- Open-source-first for commodity (auth/billing/email/observability/captcha/browser/secrets/jobs); build only ProjectSites business logic in-house.
- AI is foundational, never optional; cheap/local first, escalate to premium by risk; Grok for live/social/business-freshness research.
- Christ-like ethos: build for the served population (underserved, multilingual, accessibility-first), no dark patterns.

## §6 — BUSINESS requirements + FEATURE FLAGS

- Every non-trivial feature behind a typed D1 flag (`enabled=0, rollout=0, stage=experimental`) + `/admin/feature-flags`. Kill switches per: model · provider · tenant · site · route · agent · AI-feature-global · `enable_browserbase/skyvern/stagehand/cloudflare_quick_actions/premium_model_bakeoff/human_review/claim_auto_build`.
- Per-tenant quotas: concurrent browser sessions · daily/monthly browser minutes · Browserbase minutes · Skyvern runs · LLM USD/mo · artifact storage · job concurrency · event throughput · max retries/job · premium override for paid plans.
- Plans: free preview (shared DB, scale-to-zero, 10k events/mo, "powered-by" bar) · $50 standard (dedicated Neon/site) · growth (tuned compute) · enterprise (Neon project/customer, SSO/SCIM, no scale-to-zero).
- Human-approval gates ONLY where risk justifies (outreach · social post · charge money · DNS change · claim listing · gov forms · legal terms · delete data · publish customer site · sensitive creds · ambiguous MFA) — not a blanket bottleneck.
- Payments: Stripe + Stripe Link preferred; avoid PayPal; Square only BrickLabor in-field. Email: Amazon SES + Listmonk + `psnotify` adapter (Resend removed; NEVER Novu). Cost anomaly alerts (Browserbase/model/retry spikes, quota hits, provider-failure abnormal).

## §7 — `psnotify`: CUSTOM notification engine (NEVER Novu — Brian absolute 2026-06-24)

- **Hard rule:** Absolutely NO Novu anywhere in projectsites.dev. Build `psnotify` — a custom in-house notification engine with the same features (inbox/center/preferences/multi-channel), customized for this platform. No `@novu/*` deps, no `NOVU_*` secrets, no `api.novu.co`. See [[feedback_no_novu_custom_notifications]].
- **Architecture:** DO-backed per-subscriber inbox (SQLite ring of notifications) + a Hono `/api/notifications/*` surface (list/markRead/preferences) + server-side `NotifyService` in `libs/core/notifications/` that fans an event to the channels. Multi-channel: in-app (the durable record) + email (SES + Listmonk adapters, already in the stack) + web-push. Toasts stay ephemeral; the inbox is the durable record.
- **Backbone doctrine:** `psnotify` is THE notification layer wherever a user should be informed: `build.started/failed · publish.completed · domain.verifying/active/failed · ai.job.completed/failed · payment.succeeded/failed · quota.near_limit · trial.ending · member.invited/joined · draft.published · review.requested · claim.started/completed · browser.human_review_required` + the Apps lifecycle (`deploy.* · instance.crashed · backup.*`).
- **Typed + Zod payloads**, tenant-aware (`{orgId, userId, featureSlug}`), subscribers namespaced per tenant, zero cross-tenant bleed. Triggers fire server-side (no vendor SDK).
- **Gorgeous Angular:** Spartan-styled bell (cyan/black `--ps-*` cockpit) in the admin topbar: unread count (rolling-counter) + grouped feed (`appReveal` entrance) + per-channel/per-category preferences in Settings + deep-link + "what to do next" on every notification + reduced-motion + WCAG AA + `:focus-visible`. The bell reads our own `/api/notifications` endpoint (SSE/poll) — verify by asserting OUR endpoint calls, not a vendor's.
- **First wave = server triggers** (frontend bell wired to our API): fire `psnotify` from the build-status callback, domain provisioning, Stripe webhook, AI-job, claim completion, Apps deploy/crash/backup. Then preferences UI. Then web-push channel.

## §8 — THE 30 BRILLIANT FEATURES (net-new, my synthesis — research-validate in §12)

1. **Unified correlation envelope** — every job/event/trace/browser-run/LLM-call carries `{tenantId,siteId,userId,correlationId,runId,traceId,provider,engine}`; one OTel trace links app→gateway→provider→artifact.
2. **Provider-router eval loop** — Promptfoo + Langfuse score route decisions; cheaper model promoted only when eval-parity proven.
3. **Cost-anomaly `psnotify` alerts** — per-tenant spend spike / retry-rate / provider-failure → `psnotify` + admin kill-switch suggestion (NEVER Novu).
4. **Dead-letter REPAIR queue UI** — every failed browser/event job → repairable card (last screenshot/HTML/console/transcript + suggested fix + retry/escalate-to-Skyvern/Browserbase/human buttons).
5. **Evidence-bundle diff viewer** — before/after screenshots + visual regression for generated-site QA, per build.
6. **Streaming live-preview during build** — render-as-it-generates iframe (the conversion "magic moment").
7. **Per-section AI-vision auto-reroll** — score each generated section, regenerate <8/10.
8. **Research/brand/asset cache per business** — rebuild skips re-research (~15min→~5min, cheaper).
9. **Field-level confidence research graph** — every business fact (name/phone/hours/social/logo) carries value+confidence+source+screenshot; low → second-source.
10. **Claim-confidence scorer (Grok live lane)** — "is this business active?" from public/social signals before sending a claim link.
11. **Hyperdrive capacity manager** — quota-aware DB provisioning, config registry, capacity alerts, fallback provisioning queue, limit-increase tracker, multi-CF-account capacity pools.
12. **DB Access Worker shards** — bounded Hyperdrive bindings each, internal-only, tenant-scope-validated, query-logged with trace_id, cross-tenant denied.
13. **Credential-rotation workflow** — new role/pw → new Hyperdrive config → verify → switch registry → revoke old → audit (per customer DB).
14. **Quorum-premium arbitration** — flag-gated parallel premium bake-off + judge/merge for architecture/security/final-review.
15. **RouteLLM shadow-mode dashboard** — predicted-vs-actual route, projected savings, promote-when-evals-pass.
16. **Tenant AI budget guard middleware** — `assertAiBudget()` + `assertModelAllowed()` before every call; hard-cap protects margin.
17. **Generated-site beacon auto-injection** — `psTrack` sendBeacon into every build → Unified Analytics → owner dashboard (closes the empty-analytics gap).
18. **Owner-facing live-events tab** — real-time per-site event monitor + per-provider delivery status (separate from Analytics).
19. **Per-build cost accounting** — estimate→actual→variance (browser-seconds/tokens/provider) attributed per tenant.
20. **Abandoned-build recovery (`psnotify` + SES)** — build-started-never-claimed → nudge with preview link.
21. **Contextual upgrade prompts** — paywall at the friction moment (custom domain / remove top-bar / more pages).
22. **"Built with projectsites.dev" badge + public template gallery** — backlinks + social proof + massive pSEO surface.
23. **GEO/AI-search optimization** — FAQPage + quotable-answer blocks on marketing + generated sites so ChatGPT/Perplexity cite them.
24. **Auto-rollback watcher** — `wrangler rollback` on post-deploy 5xx/LCP-regression spike.
25. **SSRF/robots safety engine** — block private ranges, allowlist internal, robots-aware crawl, sanitize extraction, per-tenant domain allow/deny.
26. **Idempotent everything** — client UUID idempotency on all writes/jobs/events/provider-forwards (no double-charge, accurate error rates).
27. **Golden-workflow eval suite** — restaurants/churches/contractors/nonprofits/Stripe/Square/GBP/CMS-login/invoice-portal/gov-form/claim-flow/generated-site-validation, tracked by model×provider (success/schema/seconds/cost/manual-rate/confidence).
28. **Kill-switch console** — one admin surface for model/provider/tenant/site/route/agent/AI-global instant disable.
29. **Synthetic provider test-buttons** — "Test Connection" per provider (Sentry/PostHog/GA/`psnotify`/browser) routes a synthetic event without real side effects.
30. **End-of-session skill maintenance** — tiny diffs folding each fire's lesson into the durable layer (this file + `_LOOP_LEDGER.md` + rules).

## §9 — VERIFICATION requirements (gate every slice)

- TDD-first (failing test before impl). Vitest/Jest units + API/contract tests; Playwright E2E from homepage for every user-visible side effect (`npm run test:e2e:prod` → `playwright.prod.config.ts`). Migration tests when DB touched. Provider mocks for Browser Run/Skyvern/Browserbase/LLM.
- Must-pass before "done": install/build · typecheck · lint · units · contract · relevant E2E · migration · provider-router · quota/cost · safety-policy · prompt-injection-isolation · SSRF · tenant-isolation. `architecture_fitness.test.ts` keeps the infra LAW (forbidden vendors + Tinybird-env-gated + Hatchet-not-Fly + idempotency/DLQ invariants).
- Deploy + prod-E2E live-verify (never "build passes = done"). Console-error/CSP/axe gates. Cloudflare WAF note: `POST` to new paths is edge-challenged → real-browser in-page fetch in prod specs.

## §10 — Where everything lives (the markdown map)

- **This file** = the single convergence driver (loop reads `_LOOP_LEDGER.md`).
- **`_LOOP_LEDGER.md`** = the single canonical backlog (★ 50-IDEA VALUE BACKLOG + de-stub catalog + fire log).
- `FEATURE_CATALOG.md` = de-stub reference (which modules exist). `ROADMAP.md` = revenue-sorted reference.
- `FEATURE_BACKLOG.md` / `RESEARCH_IDEAS_2026H2.md` / `_CONVERGENCE_BACKLOG.md` (deleted) / `_ULTIMATE_LOOP.prompt.md` (deleted) → all subsumed here / into `_LOOP_LEDGER.md`.
- The 30 features above → fold into `_LOOP_LEDGER.md` as tagged backlog rows on the next maintenance fire.

## §11 — Implementation order (when building a plane)

1. Inspect repo/structure/tests/boundaries. 2. Shared types/schemas (`packages/ai-policy`, tenant/job/provider/cost/evidence/trace/flag). 3. Provider-neutral router with MOCKS first. 4. Real adapters behind flags. 5. Cost/quota/safety engines. 6. Evidence/artifact writers. 7. DB migrations + tenant-isolation tests. 8. Admin UI. 9. Tests + E2E. 10. Docs + runbooks. 11. Verify → fix → repeat until green or blocked by a missing secret/account (surface it).

## §12 — FRESH-SESSION DEEPENING PASS (honest follow-up — not done here)

- **Context7 docs** (load per plane in a fresh session, then refine the relevant §): Cloudflare Workers/Hono/Browser-Rendering/AI-Gateway/Agents-SDK/Containers/D1/R2/KV/Queues/DO/Hyperdrive · Better Auth · Ory Polis · OpenFGA · LiteLLM · RouteLLM · Langfuse · Promptfoo · Trigger.dev · Inngest · web-push (`psnotify` — NEVER Novu) · Stagehand · Browserbase · Skyvern · Neon · Infisical · OpenAI/Anthropic/DeepSeek/xAI/Gemini APIs · Firecrawl (`G4brym/workers-firecrawl`).
- **Heavy web research** (DORA 2024/25 · SO Dev Survey 2025 · NN/g · Baymard · WCAG 2.2) → add compact Evidence lines to each requirement section.
- Each deepening fire: append source-backed Evidence + tighten one requirement list. Never bloat — Evidence is one line: `<source> — <takeaway> — retrieved <date>`.

---

## §13 — AUTOMATION PLANE: DEPLOY-READY (decisions locked 2026-06-20)

**All 4 planes are credential-unblocked. Every secret loads from get-secret (chezmoi store); Upstash Redis is provisioned at deploy via `UPSTASH_API_KEY`.** Execute in a FRESH session (load Context7 docs per plane FIRST so Dockerfiles/wrangler-container configs are correct, never guessed).

- **events. → Inngest SELF-HOST** (LAW-clean; no Inngest Cloud). Single container (`inngest/inngest` server) → Neon Postgres + Upstash Redis. `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` **self-generated** (`openssl rand -hex 32`), stored to chezmoi + `wrangler secret`. Hono worker serves functions via the `inngest/cloudflare` handler (ref: inngest.com/docs/deploy/cloudflare).
- **llm. → LiteLLM + RouteLLM** (one container). Providers routed through **Cloudflare AI Gateway** (DeepSeek key lives IN the gateway → route DeepSeek via the gateway universal endpoint; OpenAI/Anthropic/Gemini keys from get-secret). `LITELLM_MASTER_KEY` + `LITELLM_SALT_KEY` self-gen. Upstash Redis for shared state (provision via `UPSTASH_API_KEY`). OpenAI-compatible internal API + Langfuse/Tinybird trace emit. Cheap default = DeepSeek (via gateway); premium = Claude/OpenAI/Gemini.
- **traces. → Langfuse via Tinybird-direct** (path A, LAW-clean, all creds present: `TINYBIRD_API_HOST/HOST/PORT/USERNAME/PASSWORD/WORKSPACE_ID` + Neon + `CLOUDFLARE_R2_*`). Trace store = Tinybird (no ClickHouse self-host, no Redis). If self-hosted Langfuse-server is later required, it needs a raw ClickHouse endpoint (verify Tinybird exposes one) — default stays Tinybird-direct.
- **email. → Listmonk** container → Neon Postgres. SES via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (derive SMTP password from the secret key per the SES SMTP algorithm; region `AWS_DEFAULT_REGION`). Verified sender `mail.projectsites.dev`. Novu email adapter points here for bulk; per-user transactional stays Novu (creds present).

**DNS/ingress:** Cloudflare-for-SaaS custom hostnames `jobs|events|traces|llm|email.projectsites.dev` (zone `CLOUDFLARE_ZONE_ID_PROJECTSITES_DEV`), CF Access on admin surfaces. **Integration:** Hono app calls `@projectsites/ai-gateway-client` → llm-gateway; `ctx.waitUntil` async trace emit → Tinybird; Inngest client publishes events; NotifyService → `psnotify` (transactional, custom — NEVER Novu) + Listmonk (bulk). **Verify live** per plane (healthcheck + one real round-trip) before marking done.
