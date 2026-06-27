# ProjectSites.dev — Selected Tooling

> **Canonical, opinionated, Cloudflare-first + TypeScript-first.** Single source of truth for the
> open-source tools that shape ProjectSites.dev. Use ONLY the selected stack below plus tightly
> coupled companion packages — no broad extra recommendations.
>
> **Listing ≠ installing.** A row here is a decision, not an install. Adopt a Recommended/Conditional
> tool only when a concrete feature needs it. Agent policy mirror: `~/.agentskills/rules/projectsites-recommended-stack.md`.
> Binding infra doctrine (allowed infra + hot path): `apps/project-sites/docs/architecture/cloudflare-first.md`.

## Platform priority order (non-negotiable)

1. Prefer **no database** when possible.
2. Prefer **Cloudflare-native primitives** before external infra (Workers · D1 · KV · R2 · DO · Queues · Workflows · Vectorize · AI Gateway).
3. **D1 before Neon** unless Postgres semantics are required (Neon via Hyperdrive only).
4. **DO / KV / Queues / Workflows before Redis** unless Redis semantics are required (Upstash only).
5. **Fly.io** only for stateful/container services that don't fit Cloudflare.
6. Never default to Google Cloud Run, Supabase, Firebase, or random managed services.
7. No inferior duplicate package when a selected tool already solves the need.

Status: **Core** (shapes the platform now) · **Recommended** (adopt when a feature needs it) · **Conditional** (only with the noted justification) · **Study / optional**.

## Selected tooling matrix

### Backend · contracts · validation · runtime

| Tool | Category | Status | Purpose | Companion packages | Notes |
|------|----------|--------|---------|--------------------|-------|
| Hono | Backend | Core | Worker API framework | `@hono/zod-validator` | In use across the worker |
| Effect | Backend | Core | Typed services, retries, typed errors, resource safety, workflow correctness | — | Targeted services only; never replaces Zod at I/O |
| Zod | Validation | Core | SSOT at every runtime boundary | `zod-validation-error` | `z.infer` for types — never hand-duplicate |
| Drizzle ORM | Data | Core | D1 / Neon ORM | `drizzle-kit` | In use |
| Drizzle Kit | Data | Core | Migration workflow | (Drizzle ORM) | Generate/apply migrations |
| OpenFGA | Authz | Core | Relationship-based authorization model | `@openfga/sdk` | Adopt as permission graph outgrows `@casl/ability` |
| OpenFeature | Flags | Core | Vendor-neutral feature-flag SDK | OpenFeature provider | Over the existing D1+KV flag plane |
| CloudEvents | Events | Core | Typed event-envelope convention | `cloudevents` | Durable event contracts |
| DOMPurify | Security | Core | Sanitize user/customer/generated HTML | `isomorphic-dompurify` | Mandatory on every untrusted-HTML path |
| hono-openapi | API contracts | Recommended | Serve OpenAPI from Hono routes | (Hono + Zod) | Preferred for new OpenAPI work |
| @hono/zod-openapi | API contracts | Recommended | Hono routes generate OpenAPI from Zod | (Hono + Zod) | Older route-builder; use where already wired |
| zod-openapi | API contracts | Recommended | Shared schema → OpenAPI generation | — | Pick one OpenAPI-from-Zod path per surface |
| zod-to-openapi | API contracts | Recommended | Derive OpenAPI 3.x from Zod (`@asteasolutions/zod-to-openapi`) | `drizzle-zod` (schema reuse, optional) | In use; never hand-maintain OpenAPI |
| Unkey | API keys | Recommended | API keys, tenant quotas, metering | `@unkey/api` | Complements `psk_` keys |
| jose | Auth | Conditional | JWT/JWKS signing + verify | — | Only if JWT/JWKS is already required |

### Builder · editor · admin UX

| Tool | Category | Status | Purpose | Companion packages | Notes |
|------|----------|--------|---------|--------------------|-------|
| TanStack Virtual | UI | Recommended | Virtualize very large lists (sites, leads, customers, logs, events, jobs, traces, generated pages) | `@tanstack/react-virtual` / `@tanstack/angular-virtual` | Match the surface's framework |
| Radix UI | UI | Recommended | Accessible React primitives | (with shadcn/ui) | React surfaces only |
| shadcn/ui | UI | Recommended | React component layer | `class-variance-authority`, `clsx`, `tailwind-merge` | React surfaces only; admin is Angular/Spartan |
| cmdk | UI | Recommended | Command palette | — | React surface; Angular admin needs an equiv |
| Storybook | UI | Recommended | Component/block workshop | `@storybook/test`, `@storybook/addon-a11y` | `storybook.projectsites.dev` (site-kit blocks) |
| Plate.js | Editor | Recommended | Rich/block content editing | — | React surface |
| React Flow / XYFlow | UI | Recommended | Workflows, site maps, deployment/resource/agent graphs | `@xyflow/react` | React surface; no Angular renderer |
| Monaco Editor | Editor | Recommended | Code/config editing | `@monaco-editor/react` (React surface), `@shikijs/monaco` | In admin (log/config viewers) |
| Satori | Media | Recommended | OpenGraph / social image generation | — | Edge OG cards |
| Shiki | Docs/UI | Recommended | Docs + code highlighting | `@shikijs/monaco` (with Monaco) | Lighter than a full editor |
| GrapesJS | Builder | Conditional | HTML / email / template-builder workflows | — | Plate/Storybook cover most builder needs; use only for HTML/email/template builders or if already depended on |
| NgRx | State | Conditional | Angular admin shared-state store | `@ngrx/{store,effects,entity,router-store,component-store,signals}` | Angular admin surfaces ONLY — never forced into React areas; signals-first today |
| RxJS | State | Conditional | Reactive stream foundation | — | Angular/admin reactive edge |

### Search · AI · observability · LLM platform

| Tool | Category | Status | Purpose | Companion packages | Notes |
|------|----------|--------|---------|--------------------|-------|
| Orama | Search | Recommended | **Generated child-site search (default)** — search WITHIN a `{slug}.projectsites.dev` site | `@orama/orama` | Edge-friendly, ships in the generated bundle. **NOT for platform/admin search** — see below. |
| Cloudflare AI Search (AutoRAG) | Search | Recommended | **Platform + admin search** (submissions, sites, leads, logs) — managed RAG/semantic search | CF binding (`AI`, `Vectorize`/AutoRAG) | Cloudflare-native; the choice for first-party admin/platform search. Orama stays the per-generated-site default. |
| MCP TypeScript SDK | AI | Core | Foundation for the ProjectSites MCP | `@modelcontextprotocol/sdk` | `platform_mcp` is live |
| Langfuse | Observability | Core | LLM traces: prompts, generations, tool calls, agent workflows | `langfuse` | Emit where LLM calls happen |
| OpenTelemetry | Observability | Core | Trace propagation across APIs, jobs, AI workflows | `@opentelemetry/api` + runtime-compatible SDK | Workers Tracing OTLP |
| Sentry | Observability | Core | Error + performance monitoring | `@sentry/*` matching runtime | Wired |
| LiteLLM | AI | Recommended | Internal LLM gateway service | — | A service, NOT a per-app dependency |

### Infrastructure

| Tool | Category | Status | Purpose | Companion packages | Notes |
|------|----------|--------|---------|--------------------|-------|
| OpenTofu | IaC | Recommended | Infrastructure-as-code for Cloudflare-first resources | Cloudflare provider; Neon/Upstash/GitHub providers only when used | Use only when the repo has/needs IaC; don't imply unprovisioned infra exists |

## Conditional-tool guidance

- **GrapesJS** — conditional: Plate.js/Storybook cover most builder needs. Use only for HTML/email/template-builder workflows or where already depended on.
- **NgRx / RxJS** — Angular admin surfaces only. Do not introduce into React-only areas.
- **LiteLLM** — an internal LLM gateway *service*, not a package every app imports.
- **OpenTofu** — infrastructure definitions only when the repo has or needs IaC.
- **jose** — only if JWT/JWKS signing/verification is already required.

## Selection rules

- Use only the selected families above; a new tool needs explicit approval.
- Companion packages allowed ONLY when tightly coupled to a selected tool (see matrix).
- No duplicate library solving the same problem as a selected tool.
- Prefer Cloudflare primitives → D1 before Neon → DO/KV/Queues/Workflows before Redis.
- Prefer typed contracts, OpenAPI, schema validation, typed events, explicit authorization.
- Never claim an integration complete unless working code/tests prove it.

## ProjectSites.dev Convergence Loop Work Items

> Every approved stack item is a concrete, trackable work item below. **Listing ≠ implementing.**
> No item is marked done unless working code/tests/docs prove it (integration-truth rule).
> Status labels: **Core** (foundational, non-negotiable) · **Approved** (adopt when the need lands) ·
> **Conditional** (only when the named precondition is true) · **Angular-only** · **Internal service**
> (a hosted service behind a subdomain, not a per-app dependency) · **Non-OSS service** (commercial).
> Checkbox `[x]` = the repo demonstrably uses it; `[ ]` = work item open.
>
> **Definition of done (by category):**
> - *Library/convention* — pattern standardized in code + one reference usage + a doc/JSDoc note.
> - *Internal service (subdomain)* — container/Dockerfile + DO binding + host route + secrets + live 2xx + smoke test.
> - *Domain mapping* — row in `apps/project-sites/docs/CONTAINER_MANIFEST.md` (both planes) + `scripts/slim-containers.sh`.
>
> **Domains (Brian directive):** `events.projectsites.dev` → **Inngest** (event-driven product-lifecycle jobs;
> live `InngestContainer` DO + Neon + Upstash). `jobs.projectsites.dev` → **Hatchet** (heavy/stateful/browser/AI
> execution plane; Hatchet Cloud preferred, self-host container otherwise). `secrets.` → Infisical only if Cloudflare
> Secrets Store is insufficient. Dittofeed (lifecycle messaging) **replaces Novu**. Deepcrawl **replaces Firecrawl**.

### Phase 0 — Stack policy, removals, repo hygiene
- [x] [Core] Canonical approved stack matrix — every tool: category, status, purpose, domain/route, notes (this doc).
- [x] [Core] Update `~/.agentskills` with the ProjectSites.dev stack policy (`rules/projectsites-recommended-stack.md`).
- [ ] [Core] Remove stale tool recommendations — delete default recs for explicitly-removed tools (see Removed list).
- [ ] [Core] Replace Firecrawl with Deepcrawl — update docs/TODOs/agent instructions so Deepcrawl is the approved website-context extractor.
- [x] [Core] No-duplicate-tools rule — justification required before adding tools overlapping an approved choice.
- [x] [Core] Integration-truth rule — no integration marked complete without code/tests/docs proving it.
- [ ] [Approved] Knip — repo cleanup work item: unused deps, exports, files, AI-context bloat.
- [ ] [Approved] Repomix — repo packing/context-generation work item for AI-agent workflows.
- [ ] [Approved] Biome — formatter/linter standardization work item (eval vs the oxlint+ESLint+Prettier stack first).
- [ ] [Approved] Oxlint — fast linting work item where compatible.
- [ ] [Approved] Semgrep — focused static-analysis/security-rule work item.
- [ ] [Approved] Lighthouse CI — generated-site perf/SEO/a11y/best-practices budget work item.

### Phase 1 — API, contracts, validation, authz, events
- [x] [Core] Hono — standardize Worker/API route conventions; document the default route/module pattern.
- [ ] [Core] Effect — define where Effect is required (typed services, retries, typed errors, resource safety, DI, workflow correctness). Never replaces Zod at I/O.
- [ ] [Core] Zod — standardize input/output/env/config validation around Zod (SSOT at every boundary).
- [ ] [Approved] hono-openapi — evaluate + document where Hono routes generate OpenAPI (preferred for new work).
- [ ] [Approved] @hono/zod-openapi — preferred Hono/Zod route-contract pattern where already wired.
- [ ] [Approved] zod-openapi — document when shared Zod schemas emit OpenAPI.
- [ ] [Approved] zod-to-openapi — document whether still needed beside the above two; pick one path per surface.
- [x] [Core] Drizzle ORM — standardize typed D1/Neon access around Drizzle.
- [x] [Core] Drizzle Kit — migration/schema workflow conventions for D1 and Neon.
- [ ] [Core] OpenFGA — authorization model for orgs, sites, resources, roles, agents, admin actions.
- [ ] [Approved] Unkey — API key, quota, metering, tenant usage-limit work item; `keys.projectsites.dev` if provisioned.
- [ ] [Approved] OpenFeature — platform/per-site feature-flag convention over the D1+KV flag engine.
- [ ] [Approved] CloudEvents — standard event envelopes for queues, workflows, webhooks, lifecycle events.
- [ ] [Approved] DOMPurify — require sanitization for customer/generated HTML, embeds, imported content.

### Phase 2 — Builder, editor, admin UX
- [ ] [Core] Puck — primary visual page/block builder integration work item.
- [x] [Core] Storybook — component/block workshop; define how Puck blocks are documented/tested (`storybook.projectsites.dev`).
- [ ] [Approved] Plate.js — rich/block content editor for customer/admin content editing (React surface).
- [ ] [Approved] Monaco Editor — code/config editor for advanced editing surfaces.
- [ ] [Approved] React Flow / XYFlow — graph UI for workflows, site maps, deployment/resource/agent graphs.
- [ ] [Conditional] GrapesJS — HTML/email/template-builder only where Puck/Plate do not fit.
- [ ] [Approved] TanStack Query — server-state/cache for React surfaces.
- [ ] [Conditional] TanStack Router — type-safe routing only for React surfaces that need it.
- [ ] [Approved] TanStack Table — admin tables: sites, leads, customers, events, invoices, jobs.
- [ ] [Approved] TanStack Form — typed React forms.
- [ ] [Approved] TanStack Virtual — virtualize huge lists: sites, leads, customers, logs, events, jobs, traces, pages, files, search results.
- [ ] [Approved] cmdk — command palette for admin/editor power actions.
- [ ] [Approved] Radix UI — accessible primitive convention (React surfaces).
- [ ] [Approved] shadcn/ui — copy-owned UI component convention (React surfaces).
- [ ] [Approved] Motion — animation/reveal/storytelling for premium UI + homepage.
- [ ] [Approved] Satori — OG/social image generation.
- [ ] [Approved] Shiki — syntax highlighting for docs, snippets, editor displays.
- [ ] [Angular-only] NgRx — Angular admin shared-state where needed.
- [ ] [Angular-only] RxJS — Angular/admin reactive-stream convention.
- [ ] [Angular-only] Angular Material / CDK — Angular admin primitive/component work item (CDK only; no Material kit).

### Phase 3 — CMS, content, search, media, SEO
- [ ] [Approved] Payload CMS — CMS/content/app-backend; per-tenant provisioned at `cms.projectsites.dev` (see Phase 6 + CONTAINER_MANIFEST).
- [ ] [Conditional] Lexical — document whether it still has a distinct role beside Plate.js.
- [ ] [Approved] Orama — generated-site search (default, ships in the site bundle).
- [ ] [Conditional] Pagefind — static generated-site search where better than Orama.
- [ ] [Approved] schema-dts — type-safe Schema.org JSON-LD: local SEO, services, orgs, FAQs, breadcrumbs, reviews, products.
- [ ] [Conditional] unified — Markdown/HTML content-transform pipeline only if needed.
- [ ] [Conditional] MDX — component Markdown/docs/content only if needed.
- [ ] [Approved] SVGO — SVG/logo optimization.
- [ ] [Approved] Uppy — media upload: logos, galleries, PDFs, customer files.
- [ ] [Conditional] Unpic — responsive image helper where helpful.
- [ ] [Conditional] sharp — image processing only where runtime-compatible and superior to CF image/R2 pipelines.
- [ ] [Conditional] Docusaurus — docs/developer-portal only if docs outgrow markdown.
- [ ] [Approved] Scalar — OpenAPI docs / API reference.

### Phase 4 — AI, MCP, LLM routing, observability
- [x] [Core] MCP TypeScript SDK — ProjectSites MCP server/client foundation (`platform_mcp` live).
- [ ] [Core] Langfuse — LLM tracing, prompt versioning, generation/tool-call tracing, cost observability; `traces.projectsites.dev`.
- [ ] [Internal service] LiteLLM — internal LLM gateway; `llm.projectsites.dev`.
- [ ] [Core] OpenTelemetry — trace/metric/log context propagation across APIs, jobs, browser automation, AI workflows.
- [ ] [Conditional] OpenTelemetry Collector — telemetry-pipeline only for heavier/self-hosted observability.
- [x] [Approved] Sentry — frontend/backend error + performance monitoring.
- [x] [Approved] PostHog — product/admin analytics; explicitly NOT default-tracked on generated customer sites.
- [ ] [Approved] Promptfoo — LLM eval/regression tests for generated sites, prompts, agents, routing decisions.
- [ ] [Approved] Deepcrawl — website-context extraction for research, lead enrichment, AI-generated-site grounding (replaces Firecrawl).
- [ ] [Approved] Vercel AI SDK — typed AI streaming/tool-calling where useful.
- [x] [Approved] Playwright — E2E/browser automation/testing.
- [ ] [Approved] Stagehand — AI-assisted browser automation for `browser.projectsites.dev`.
- [ ] [Core] AI metadata standard — require trace IDs, prompt versions, model/provider, cost, fallback, grounding, customer/site IDs on AI work.

### Phase 5 — Workflows, jobs, integrations, webhooks, metering
- [ ] [Core] Cloudflare Workflows/Queues-first rule — CF workflows/queues are the default before any external engine.
- [ ] [Approved] Inngest — event-driven product-lifecycle workflows where CF Workflows is insufficient; `events.projectsites.dev`.
- [ ] [Approved] Hatchet — heavy/stateful/browser/AI execution plane; `jobs.projectsites.dev` (Hatchet Cloud preferred, self-host container otherwise).
- [ ] [Approved] Nango — integrations/OAuth sync.
- [ ] [Approved] Svix — outbound customer-facing webhook delivery.
- [ ] [Approved] Hookdeck — inbound webhook management, routing, retry, debugging, observability.
- [ ] [Approved] Dub — short/referral/claim links, affiliate + QR + campaign attribution.
- [ ] [Approved] OpenMeter — usage metering: AI credits, API calls, site visits, build minutes, browser automation, add-ons, quotas.
- [ ] [Approved] OpenMeter — Stripe metered-billing integration work item (meter → Stripe usage records).
- [ ] [Core] Metering event standard — CloudEvents-compatible usage events: site visits, AI calls, API calls, workflow runs, browser jobs, storage, bandwidth, form submissions, email sends, add-on usage.
- [ ] [Core] Metering scale rule — never one physical metering resource per website; logical tenancy via site/org/plan IDs, quotas, aggregation windows.

### Phase 6 — Product services + control-plane apps
- [ ] [Approved] Logto — app auth/orgs.
- [ ] [Non-OSS service] WorkOS — enterprise SSO/SCIM (enterprise only).
- [ ] [Approved] Chatwoot — support/live-chat; `support.projectsites.dev`.
- [ ] [Approved] Twenty CRM — CRM/sales-pipeline; `crm.projectsites.dev`; **per-tenant provisioned, paid opt-in add-on** (see CONTAINER_MANIFEST § Per-tenant add-ons).
- [ ] [Approved] Payload CMS — per-tenant provisioned CMS; `cms.projectsites.dev`; nominal-fee opt-in, same provisioning model as Twenty.
- [ ] [Approved] Listmonk — newsletter/list management; `mail.projectsites.dev`.
- [ ] [Approved] Dittofeed — lifecycle messaging, journeys, segmentation, campaign orchestration (**replaces Novu**).
- [ ] [Approved] Postiz — social-media scheduling/social add-on; `social.projectsites.dev`.
- [ ] [Conditional] Infisical — secrets management only if Cloudflare Secrets Store insufficient; `secrets.projectsites.dev` if used.
- [ ] [Conditional] Cal.diy — scheduling/booking for customer sites where needed.
- [ ] [Conditional] Formbricks — feedback/surveys where useful.
- [ ] [Conditional] Documenso — e-sign/proposal/signature where useful.
- [ ] [Conditional] Medusa — commerce/storefront only for commerce-specific customer apps.
- [ ] [Conditional] Better Auth — lightweight auth eval only for smaller embedded apps where Logto is too heavy.
- [ ] [Conditional] Auth.js — lightweight auth eval only where it does not conflict with Logto.
- [ ] [Conditional] Directus — CMS alternative note only; Payload CMS preferred.
- [ ] [Conditional] Typesense — search alternative note only if Orama/Pagefind insufficient; `search.projectsites.dev` if stood up.
- [ ] [Conditional] React Email — email-template work item only if useful beside Listmonk/Dittofeed (server-render only, never in the Angular admin bundle).

### Phase 7 — Infrastructure, runtime, monitoring, service domains
- [ ] [Approved] OpenTofu — Cloudflare-first infrastructure-as-code.
- [x] [Approved] Wrangler / Workers SDK — Cloudflare dev/deploy tooling.
- [ ] [Approved] workerd — Workers runtime compatibility/testing-awareness.
- [ ] [Conditional] Loki — logs backend only if self-hosted logs needed; `logs.projectsites.dev`.
- [ ] [Conditional] Grafana — dashboards only if Loki/Prometheus/self-hosted observability used; `logs.projectsites.dev`.
- [ ] [Conditional] Prometheus — metrics only if self-hosted metrics needed.
- [ ] [Approved] OpenStatus — public status page + uptime monitoring; `status.projectsites.dev`.
- [ ] [Approved] Healthchecks.io — dead-man-switch for crons, backups, rebuilds, queues, billing syncs; `checks.projectsites.dev`.
- [ ] [Core] Domain map — preserve the service-domain mapping in docs + this loop. Canonical record: `apps/project-sites/docs/CONTAINER_MANIFEST.md`.
  - `mail.` → Listmonk · `crm.` → Twenty CRM · `cms.` → Payload CMS · `support.` → Chatwoot · `social.` → Postiz
  - `status.` → OpenStatus · `checks.`/`health.` → Healthchecks.io · `traces.` → Langfuse · `logs.` → Loki/Grafana (self-hosted only)
  - `events.` → **Inngest** · `jobs.` → **Hatchet** (Hatchet Cloud preferred) · `llm.` → LiteLLM · `browser.` → CF Browser Run/Rendering + Playwright + Stagehand
  - `cms.` → Payload CMS · `keys.` → Unkey (if used) · `secrets.` → Infisical (only if CF Secrets Store insufficient)
  - `skyvern.megabyte.space` → internal-only historical/fallback note (not product-facing)
  - `mcp.megabyte.space` → Browserbase MCP bridge, internal fallback only (not product-facing)

### Removed tools — do NOT re-add (removal/historical cleanup only)
- [ ] [Core] Removed-tools cleanup — search docs/TODOs/agentskills for these and delete, mark superseded, or move to a historical note.
- Superseded/removed: Tempo · AnalogJS · Mastra · **Firecrawl** (→ Deepcrawl) · Crawl4AI · Crawlee · LlamaIndex.TS · LangGraph.js · Ragas · Dify · Astro · UnoCSS · jose · Nano ID · oRPC · ArkType · ts-pattern · Nitro · MJML · Meilisearch · Browserless · Pulumi · SOPS · OpenBao · SigNoz · VictoriaMetrics · Perspective · Apache ECharts · Evidence.dev · Metabase · Cube · ClickHouse · DuckDB · PGlite · ElectricSQL · Qdrant · Webstudio · fast-check · Miniflare · MSW · Testing Library · k6 · Cosign · Sigstore · OWASP ZAP · Nuclei · Grype · Syft · OSV-Scanner · Trivy · Gitleaks · Renovate · Excalidraw · Mermaid · Lightning CSS · Style Dictionary · **Novu** (→ Dittofeed) · Trigger.dev · Skyvern-as-a-product-feature (internal-only OK) · Polar.sh · Supabase · Resend · Postmark · Socket.dev · Chainguard Images · Clay

## See also
- `apps/project-sites/docs/CONTAINER_MANIFEST.md` — canonical container ↔ subdomain registry: every hosted service + per-tenant add-on, across both the `projectsites.dev` product plane and the `megabyte.space` infra plane
- `apps/project-sites/README.md` — at-a-glance domain catalog table
- `apps/project-sites/docs/architecture/cloudflare-first.md` — binding infra doctrine
- `~/.agentskills/rules/projectsites-recommended-stack.md` — agent-facing selected-package policy
- `DECISIONS.md` — ADRs (binding architecture commitments)
- `apps/project-sites/ROADMAP.md` — revenue-sorted build queue (feature priority, not tooling)
