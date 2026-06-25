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

## Phased TODOs

### Phase 0 — Repo & agent instructions
- [x] One canonical selected-tooling matrix (this doc)
- [x] Update `~/.agentskills` with ProjectSites.dev selected-package policy (`rules/projectsites-recommended-stack.md`)
- [ ] Remove contradictory package recommendations from docs as they surface
- [ ] Merge duplicate markdown planning files where appropriate
- [x] Rule: agents must not introduce unselected duplicate libraries without justification
- [x] Rule: companion packages allowed only when tightly coupled to a selected tool
- [x] Rule: integrations not claimed complete unless working code/tests exist

### Phase 1 — API foundation
- [ ] Standardize APIs around Hono
- [ ] Standardize validation around Zod
- [ ] Hono + Zod OpenAPI pattern via hono-openapi / @hono/zod-openapi / zod-openapi / zod-to-openapi
- [ ] Standardize database access around Drizzle ORM
- [ ] Drizzle Kit migration workflow
- [ ] Consider `drizzle-zod` only if it reduces schema duplication
- [ ] Effect patterns: typed services, retries, typed errors, resource safety, workflow correctness
- [ ] CloudEvents event-envelope conventions
- [ ] OpenFeature feature-flag conventions
- [ ] OpenFGA authorization model
- [ ] Unkey API-key / quota / metering
- [ ] DOMPurify sanitization on customer/generated HTML

### Phase 2 — Builder / editor / admin UX
- [ ] Storybook as the component/block workshop
- [ ] Plate.js rich/block editor — investigation or integration plan
- [ ] Monaco Editor for code/config editing
- [ ] React Flow / XYFlow for workflows, site maps, deployment/resource/agent graphs
- [ ] cmdk command palette
- [ ] Radix UI / shadcn/ui conventions (React UI surfaces)
- [ ] TanStack Virtual for very large lists (sites, leads, customers, logs, events, jobs, traces, generated pages)
- [ ] Satori for OpenGraph/social image generation
- [ ] Shiki for docs/code highlighting
- [ ] GrapesJS — conditional, only for HTML/email/template-builder workflows
- [ ] NgRx / RxJS — Angular admin surfaces only

### Phase 3 — Search & generated-site quality
- [ ] Orama for **generated child-site** search (default, ships in the site bundle)
- [ ] Cloudflare AI Search (AutoRAG) for **platform/admin** search (submissions, sites, leads, logs) — NOT Orama
- [ ] DOMPurify requirements for generated/customer HTML
- [ ] Satori OG image generation plan
- [ ] Shiki highlighting for docs/code snippets
- [ ] Large-list virtualization rules for admin/search/log/event pages

### Phase 4 — AI, MCP, LLM observability
- [ ] MCP TypeScript SDK as the foundation for the ProjectSites MCP
- [ ] Langfuse tracing for LLM calls, prompts, generations, tool calls, agent workflows
- [ ] LiteLLM as the internal LLM gateway (documented as a service)
- [ ] OpenTelemetry trace propagation across APIs, jobs, AI workflows
- [ ] Sentry error/performance monitoring across frontend + backend
- [ ] AI features carry trace IDs, prompt versions, budget metadata, fallback metadata

### Phase 5 — Infrastructure
- [ ] OpenTofu IaC for Cloudflare-first infrastructure
- [ ] OpenTofu conventions for Cloudflare resources
- [ ] OpenTofu conventions for Neon/Upstash only when those services are actually used
- [ ] IaC docs must not imply unsupported infrastructure is already provisioned

## See also
- `apps/project-sites/docs/architecture/cloudflare-first.md` — binding infra doctrine
- `~/.agentskills/rules/projectsites-recommended-stack.md` — agent-facing selected-package policy
- `DECISIONS.md` — ADRs (binding architecture commitments)
- `apps/project-sites/ROADMAP.md` — revenue-sorted build queue (feature priority, not tooling)
