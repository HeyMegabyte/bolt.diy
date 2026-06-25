# ProjectSites.dev — Recommended Open Source Stack & Tooling Roadmap

> **Canonical, opinionated, Cloudflare-first.** This is the single source of truth for *which*
> open-source tools shape ProjectSites.dev and *when* to reach for them. Pairs with the global
> agent policy at `~/.agentskills/rules/package-preference-registry.md` § ProjectSites.dev.
>
> **Binding infra doctrine:** `apps/project-sites/docs/architecture/cloudflare-first.md` (mirror:
> `~/.agentskills/rules/projectsites-cloudflare-first.md`) governs allowed infra + the public hot
> path. This file defers to it on any conflict — it adds the categorized tool roadmap, not new infra policy.
>
> **Listing ≠ installing.** Nothing here is installed by reading this file. Each item carries a
> status; an item is adopted only when its status gate (below) is satisfied **and** the
> integration checklist passes.

---

## 0 — Platform priority order (non-negotiable)

1. **Prefer no database.** Static/edge-rendered, KV, R2, or DO storage before any SQL.
2. **Cloudflare-native first** — Workers · Pages · D1 · KV · R2 · Durable Objects · Queues ·
   Workflows · Hyperdrive · Vectorize · Analytics Engine · AI Gateway · Workers AI ·
   Browser Rendering · Turnstile · Zaraz · Cloudflare for SaaS · Workers for Platforms ·
   Secrets Store · Access · WAF.
3. **Neon Postgres via Hyperdrive** only when real Postgres semantics/scale/RLS isolation are needed.
4. **Upstash Redis** only when Redis-specific semantics (sorted sets, streams, atomic counters at scale) are needed.
5. **Fly.io** only for stateful/container services that do not fit Cloudflare Containers/Workers.
6. **Never default** to Google Cloud Run, Supabase, Firebase, or random managed services.
7. **No inferior duplicate tools** — one canonical choice per job (see § Selection rules).

---

## 1 — Status legend

| Tag | Meaning | Gate to advance |
|-----|---------|-----------------|
| **Core** | Shapes the platform now; already in-repo or adopt imminently | — |
| **Recommended** | Adopt when a concrete feature needs it | a real feature requirement exists |
| **Conditional** | Adopt only with an architecture note (runtime fit, duplicate check) | write the note in `DECISIONS.md` first |
| **Study / borrow** | Read the source for patterns; do **not** install | promote to Conditional with justification |
| **Avoid for now** | Documented anti-choice | needs an ADR to reverse |

> **Surface reality:** the **admin SPA is Angular 21** (ADR-0002, zoneless, signals). **Generated
> customer sites + the bolt.diy editor are React/Vite/Remix.** React-only libraries (Puck, Plate.js,
> Radix, shadcn/ui, cmdk, React Flow, TanStack Router) are for the **React surfaces only** — they do
> **not** enter the Angular admin bundle. Each is tagged accordingly.

---

## 2 — Recommended stack (deduplicated, categorized)

### Backend / contracts / runtime
| Tool | Status | Notes |
|------|--------|-------|
| Hono | **Core** | Worker API framework (in use) |
| Zod | **Core** | SSOT at every runtime boundary (`zod-everywhere`) |
| Effect | **Core** | Typed errors/retry/timeout/DI on *specific* services — not a wholesale rewrite; never replaces Zod at I/O |
| hono-openapi | **Core** | OpenAPI serving for Hono (`describeRoute`/`openAPISpecs`) — in use |
| @hono/zod-openapi | **Conditional** | Older route-builder; prefer `hono-openapi` for new work |
| @asteasolutions/zod-to-openapi | **Core** | Derive OpenAPI 3.x from Zod (in use) |
| zod-to-json-schema | **Recommended** | Forms/AI-tools/docs targets (different target than OpenAPI) |
| Drizzle ORM + Drizzle Kit | **Core** | D1/Neon ORM + migrations (in use) |
| jose | **Core** | JWT/JWK signing + verify (Workers-native) |
| DOMPurify | **Core** | Sanitize all user/customer/generated HTML |
| Nano ID | **Core** | URL-safe IDs |
| OpenFeature | **Recommended** | Vendor-neutral flag SDK over the existing D1+KV flag plane |
| CloudEvents | **Recommended** | Canonical envelope for durable event contracts |
| OpenFGA | **Recommended** | Relationship-based authz when typed-permission graph grows past `@casl/ability` |
| Unkey | **Recommended** | API keys + per-tenant quotas + metering (complements `psk_` keys) |
| unstorage | **Conditional** | Only as a KV/R2 abstraction where multi-driver portability is real |

### Cloudflare / platform
| Tool | Status |
|------|--------|
| Workers · Pages · D1 · KV · R2 · Durable Objects · Queues · Workflows | **Core** |
| Hyperdrive · Vectorize · Analytics Engine · AI Gateway · Workers AI | **Core** |
| Browser Rendering · Turnstile · WAF · Access · Secrets Store | **Core** |
| Cloudflare for SaaS · Workers for Platforms | **Core** (multi-tenant custom domains + tenant isolation) |
| Wrangler / Workers SDK · Miniflare · workerd | **Core** (dev/test/runtime-compat) |
| Zaraz | **Recommended** (third-party tag loading on generated sites) |

### Data / storage / search
| Tool | Status | Notes |
|------|--------|-------|
| Cloudflare D1 / KV / R2 / DO | **Core** | Default system of record + cache + assets |
| Neon Postgres (via Hyperdrive) | **Recommended** | Adapter-only; when Postgres semantics/RLS required |
| Upstash Redis | **Conditional** | Adapter-only; only for true Redis semantics |
| Orama | **Recommended** | In-Worker / edge hybrid search |
| Pagefind | **Recommended** | Static-site search for generated sites where appropriate |
| Vectorize | **Core** | Default vector store |
| Qdrant | **Conditional** | Fallback only if Vectorize is insufficient |
| ElectricSQL · PGlite · DuckDB | **Conditional** | Local-first / offline / local analytics only |
| ClickHouse / Tinybird | **Conditional** | High-volume analytics only; prefer Analytics Engine first |

### Builder / editor / UI — Angular admin
| Tool | Status | Notes |
|------|--------|-------|
| Angular 21 (standalone, signals, zoneless) | **Core** | Admin SPA (ADR-0002) |
| Spartan UI + Angular CDK | **Core** | The only admin component system (ADR-0003) |
| Tailwind CSS | **Core** | Styling substrate |
| TanStack Table | **Core** | Headless tables (in use) |
| Monaco Editor | **Core** | Code/config/log viewers (in use) |
| Apache ECharts | **Core** | Dashboard charts (in use) |
| Uppy (`@uppy/core` + `@uppy/xhr-upload`) | **Core** | Uploads (in use) |
| Motion | **Recommended** | `prefers-reduced-motion`-gated micro-motion |
| RxJS | **Core** | Backend-edge streams (ADR-0006) |
| NgRx | **Conditional** | Signals-first today; adopt only for genuinely complex shared state |
| TanStack Query / Virtual | **Recommended** | Server-cache / large lists when complexity warrants |
| Angular Material | **Avoid for now** | Spartan-only (ADR-0003) |

### Builder / editor / UI — React surfaces (generated sites + bolt.diy editor)
| Tool | Status | Notes |
|------|--------|-------|
| Puck | **Recommended** | Primary visual block/page builder (React surface) |
| Plate.js | **Recommended** | Rich/block content editing (React surface) |
| Radix UI · shadcn/ui | **Recommended** | Accessible primitives (React surface only) |
| cmdk | **Recommended** | Command palette (React surface) |
| TanStack Router | **Conditional** | Only where React routing is used |
| TanStack Form | **Recommended** | React forms |
| React Flow / XYFlow | **Conditional** | Workflow/resource/site graphs — **no Angular renderer**; React surface only, or study patterns for an Angular equiv |
| GrapesJS | **Conditional** | HTML/email/template-builder patterns; third editor view |
| Storybook | **Recommended** | Block/component workshop (already targeted: `storybook.projectsites.dev`, site-kit only) |
| Satori | **Recommended** | OG/social image generation at the edge |
| Shiki | **Recommended** | Syntax highlight where a full editor is overkill |
| Astro | **Conditional** | Only for specific static surfaces; not a default (frontend-stack: React/Vite SSG) |
| AnalogJS | **Conditional** | Only if Angular SSR/meta-framework support is needed |
| UnoCSS | **Conditional** | Only if Tailwind cannot meet a need |
| Style Dictionary | **Recommended** | Design-token pipeline |
| Lightning CSS | **Recommended** | CSS transform/minify |
| SVGO | **Recommended** | SVG optimization |
| Excalidraw / Mermaid | **Conditional** | Diagrams; Mermaid for docs/architecture |

### AI / agents / LLM ops
| Tool | Status | Notes |
|------|--------|-------|
| MCP TypeScript SDK | **Core** | ProjectSites platform MCP (`platform_mcp` live) |
| Cloudflare Agents SDK + Containers | **Core** | Stateful agents on Workers/DO (per global registry) |
| AI Gateway + Workers AI | **Core** | First-pass inference + gateway |
| Langfuse | **Recommended** | Prompt/version/trace/cost observability |
| LiteLLM + RouteLLM | **Recommended** | Model routing/fallback behind `llm.projectsites.dev` |
| Promptfoo | **Recommended** | LLM evals / regression tests (CI gate) |
| Vercel AI SDK | **Recommended** | Typed streaming/tool-calling where consistent |
| Stagehand + Playwright | **Recommended** | Browser automation (Stagehand AI-fallback over Playwright) |
| Firecrawl · Crawl4AI · Crawlee | **Conditional** | Research/lead-discovery inputs; license/deploy fit |
| LlamaIndex.TS · LangGraph.js · Ragas · Mastra | **Conditional** | Only if they clearly improve RAG/agent quality |
| Dify | **Study / borrow** | Internal prototyping/pattern study only — not core platform |

### Auth / identity / permissions
| Tool | Status | Notes |
|------|--------|-------|
| Custom D1 auth | **Core** | Live fallback rail — magic-link + Google/GitHub OAuth + D1 sessions (`auth.ts`) |
| Logto | **Recommended** | Default app-auth IdP per ADR-0006 — **built + dark-launched** (`logto_provider.ts`); flip via `LOGTO_*` secrets, custom auth stays the fallback. `_LOOP_LEDGER` A20 = activate |
| WorkOS | **Conditional** | Enterprise SSO/SAML/SCIM only — built dark (`workos_provider.ts`); enable via `WORKOS_*` |
| OpenFGA | **Recommended** | Relationship authz (currently `@casl/ability`); adopt as permission graph grows |
| Better Auth | **Conditional** | Smaller embedded apps only |
| Auth.js | **Conditional** | Only where it fits a small app and does not conflict with Logto/custom auth |

### Product / service apps (separate self-hosted services, per subdomain)
| Tool | Status | Notes |
|------|--------|-------|
| Listmonk (`mail.projectsites.dev`) | **Recommended** | Scaffolded on CF Containers; relays via SES |
| Chatwoot (`support.projectsites.dev`) | **Conditional** | Deploy when support product is real |
| Twenty CRM (`crm.projectsites.dev`) | **Conditional** | Deploy when CRM product is real |
| Dittofeed | **Conditional** | Lifecycle messaging/journeys |
| Nango | **Recommended** | Integrations/connectors hub |
| Svix | **Recommended** | Outbound webhook delivery + sig verify |
| Hookdeck | **Recommended** | Inbound webhook management |
| Inngest | **Recommended** | Product lifecycle workflows where CF Workflows is not enough |
| Hatchet Cloud | **Conditional** | Heavier/stateful/browser/AI jobs |
| Cal.diy | **Conditional** | Booking when it fits customer sites |
| Formbricks | **Conditional** | Surveys/feedback |
| Documenso | **Conditional** | Proposals/signatures |
| Medusa | **Conditional** | Customer commerce only — not default core (Square checkout is default) |
| Novu | **Avoid for now** | Brian directive 2026-06-24: ZERO Novu — build custom `psnotify` |
| Resend | **Avoid for now** | Removed 2026-06-19 — SES is the transactional sender (`react-email` for templating only) |

### Observability / testing / quality
| Tool | Status | Notes |
|------|--------|-------|
| OpenTelemetry JS | **Core** | Trace abstraction (Workers Tracing OTLP) |
| Sentry JS SDK | **Core** | Exception tracking (wired) |
| PostHog | **Core** | Product/admin analytics only — **not** every generated site by default |
| Langfuse | **Recommended** | LLM traces (see AI section) |
| Vitest · Playwright · Testing Library | **Core** | Unit + E2E |
| MSW · fast-check | **Recommended** | Network mocks · property tests |
| k6 | **Conditional** | Load testing when scale work warrants |
| Lighthouse CI | **Recommended** | Perf/a11y budgets on generated sites |
| Knip · Oxlint | **Core** | Dead-code/unused-dep · fast lint |
| Biome | **Avoid for now** | Repo lint = ESLint + Prettier + Oxlint (per CLAUDE.md / Brian: never Biome) |
| Semgrep | **Recommended** | Codebase security rules |
| Renovate | **Core** | Dependency maintenance |
| Gitleaks | **Core** | Secret scanning |
| Trivy · OSV-Scanner · Syft · Grype | **Recommended** | Supply-chain scan / SBOM / vuln workflow |
| Nuclei · OWASP ZAP | **Conditional** | DAST against live surfaces |
| Cosign / Sigstore | **Recommended** | Artifact signing/attestation |
| OpenTelemetry Collector | **Conditional** | Only for self-hosted services |

### Infra / ops
| Tool | Status | Notes |
|------|--------|-------|
| OpenTofu | **Recommended** | IaC for non-Wrangler resources |
| Pulumi | **Conditional** | Only if TS-native IaC is strongly preferred over OpenTofu |
| Grafana · Loki · Prometheus | **Conditional** | Self-hosted observability for services that need it |
| VictoriaMetrics · SigNoz | **Conditional** | Alt metrics/APM where justified |
| Infisical · SOPS · OpenBao | **Conditional** | Only if Cloudflare Secrets Store is insufficient |

### Docs / developer experience
| Tool | Status | Notes |
|------|--------|-------|
| Scalar | **Recommended** | OpenAPI reference UI (pairs with `hono-openapi`) |
| Shiki | **Recommended** | Code highlighting in docs |
| Mermaid | **Recommended** | Architecture/flow diagrams |
| Docusaurus | **Conditional** | Only if MkDocs (current) is outgrown |
| Apache ECharts | **Core** | (admin charts — see UI) |
| Evidence.dev · Metabase · Cube · Perspective | **Conditional** | Analytics/BI surfaces where a real reporting need exists |

---

## 3 — Selection rules (the gate)

- **Core** — may be installed soon; already shapes the platform.
- **Recommended** — install only when a concrete feature requires it.
- **Conditional** — requires an architecture note in `DECISIONS.md` (runtime fit + duplicate check) before install.
- **Study / borrow** — never install; read for patterns, then promote with justification.
- **Avoid for now** — documented anti-choice; reverse only via ADR.
- One canonical tool per job. **No inferior duplicate** unless it serves a clearly separate role.
- Prefer Cloudflare primitives → D1 before Neon → DO/KV/Queues/Workflows before Redis.
- Prefer typed contracts, OpenAPI, generated SDKs, explicit validation, event schemas.
- Prefer small composable libs over heavy frameworks unless the heavy tool is clearly justified.
- Never expose raw Redis/Postgres credentials to customer sites.

---

## 4 — Integration checklist (every adoption)

- [ ] API contract exists (typed boundary)
- [ ] Zod schema validation at the boundary
- [ ] Unit + E2E tests (failing-first, TDD)
- [ ] Observability (logs/traces/events carry correlation + `featureSlug`)
- [ ] Security review done (authz, sanitization, secret handling)
- [ ] Cost/scale impact noted (1M-site tenancy implications)
- [ ] Cloudflare compatibility checked (Workers runtime / adapter)
- [ ] Agent instructions updated (`~/.agentskills` + this doc)

---

## 5 — Phased integration TODOs

### Phase 0 — Repo hygiene / agent context
- [ ] Normalize package/tool recommendations across docs + `~/.agentskills` (this doc is canonical)
- [ ] Maintain the canonical package/tool allowlist (this doc + global registry)
- [ ] Enforce "no inferior duplicate tools" rule in reviews
- [ ] Add Knip-style cleanup guidance + scheduled `knip` run
- [ ] Add AI-agent package-selection comments at each package boundary
- [ ] CI guardrails: format · lint · tests · secret scan (Gitleaks) · dep scan (OSV/Trivy) · generated-docs validation
- [x] Create `docs/tooling-matrix.md` (tool · category · status · purpose · install target · runtime compat · owner area · duplicate policy) — ✅ landed
- [x] Create `docs/ai-agent-rules.md` (cleanup rules · no dup packages · preferred libs · CF-first policy · selection rubric · how to update TODOs · how to avoid bloating markdown) — ✅ landed
- [x] Create `docs/generated-site-quality.md` (max JS budget · image policy · a11y budget · Lighthouse CI thresholds · schema-dts · DOMPurify · Pagefind/Orama selection · Satori OG) — ✅ landed
- [x] Create `docs/ai-observability.md` (Langfuse traces · Promptfoo evals · LiteLLM/RouteLLM routing · AI Gateway · model fallback · prompt versioning · budget controls · grounding checks) — ✅ landed
- [x] Create `docs/security-supply-chain.md` (Gitleaks · Trivy · OSV-Scanner · Syft · Grype · Semgrep · Nuclei · OWASP ZAP · Cosign/Sigstore · Renovate policy) — ✅ landed

### Phase 1 — Cloudflare-first platform foundation
- [ ] Confirm Hono + Zod foundation (✅ in use) and document boundary pattern
- [ ] Standardize OpenAPI via `hono-openapi` + `@asteasolutions/zod-to-openapi` (✅ landed `cdd837fa`)
- [ ] Effect on targeted services (typed errors/retry/resource-safety) — start with build/deploy seam
- [ ] OpenFeature SDK over existing D1+KV flag plane
- [ ] CloudEvents envelopes for durable event contracts
- [ ] OpenFGA for relationship authz (when permission graph grows)
- [ ] Unkey for API keys / tenant quotas / metering
- [ ] DOMPurify sanitize on every user/customer/generated HTML path
- [ ] OpenTelemetry + Sentry coverage on every boundary
- [ ] Langfuse LLM traces wired to AI Gateway
- [ ] LiteLLM + RouteLLM behind `llm.projectsites.dev`
- [ ] MCP TS SDK hardening (✅ `platform_mcp` live; continue per `AGENT_NATIVE_POSITIONING`)

### Phase 2 — Builder / editor / admin UX
- [ ] Puck as primary visual block/page builder (React surface)
- [ ] Storybook block/component workshop (site-kit blocks)
- [ ] Plate.js rich/block content editing (React surface)
- [ ] Monaco editor for code/config (✅ in admin; extend to editor surfaces)
- [ ] GrapesJS conditional builder/email/template view
- [ ] React Flow / XYFlow for workflow/resource/site graphs (React surface; note Angular gap)
- [ ] cmdk command palette (React surface) + Angular equiv pattern for admin
- [ ] Radix UI / shadcn/ui primitives (React surface)
- [ ] TanStack Virtual for large lists
- [ ] Satori OG/social image generation
- [ ] Shiki syntax highlighting
- [ ] Motion premium animated UI (reduced-motion-gated)
- [ ] Angular admin: keep signals-first; NgRx only with an architecture note

### Phase 3 — Search, content, media, SEO
- [ ] Orama edge/hybrid search
- [ ] Pagefind static-site search where appropriate
- [ ] schema-dts type-safe Schema.org JSON-LD
- [ ] unified / MDX content transformation where needed
- [ ] Satori OG images
- [ ] Image pipeline: prefer Cloudflare Images/R2; Sharp only where runtime supports
- [ ] Unpic-style responsive image helper if a lightweight need exists

### Phase 4 — AI, research, automation
- [ ] Vercel AI SDK (typed streaming/tool-calling) where consistent
- [ ] MCP TS SDK for all ProjectSites operations
- [ ] Langfuse prompt/version/trace/cost observability
- [ ] Promptfoo LLM evals/regression in CI
- [ ] Stagehand / Browser Rendering / Playwright automation
- [ ] Firecrawl / Crawl4AI / Crawlee research/lead-discovery inputs (conditional)
- [ ] LlamaIndex.TS / LangGraph.js / Ragas only if they clearly improve RAG/agent quality

### Phase 5 — Ops, security, infra, scale
- [ ] OpenTofu for non-Wrangler IaC
- [ ] Wrangler/Workers SDK + Miniflare dev/test (✅) ; workerd compat awareness
- [ ] Renovate dependency maintenance
- [ ] Gitleaks secret scanning (CI)
- [ ] Trivy · OSV-Scanner · Syft · Grype supply-chain/SBOM/vuln workflow
- [ ] OWASP ZAP / Nuclei DAST on live surfaces
- [ ] Grafana/Loki/Prometheus/OTel Collector only for self-hosted services
- [ ] Infisical/SOPS/OpenBao only if Secrets Store is insufficient

### Phase 6 — Product services / internal control plane
- [ ] Logto for app auth/orgs (`_LOOP_LEDGER` A20) — keep custom auth until migration is proven
- [ ] WorkOS only for enterprise SSO/SCIM
- [ ] Chatwoot → `support.projectsites.dev`
- [ ] Twenty CRM → `crm.projectsites.dev`
- [ ] Listmonk → `mail.projectsites.dev` (✅ scaffolded)
- [ ] Dittofeed lifecycle messaging
- [ ] Nango integrations · Svix outbound webhooks · Hookdeck inbound webhooks
- [ ] Inngest product workflows where CF Workflows is not enough
- [ ] Hatchet Cloud for heavier/stateful/browser/AI jobs
- [ ] Cal.diy booking · Formbricks feedback · Documenso signatures (when each fits)
- [ ] Medusa only for customer commerce where needed (Square is default)

---

## 6 — Generated customer-site quality bar (summary)

Performance · low JS · image optimization · accessibility (WCAG 2.2 AA) · SEO · schema.org JSON-LD
(`schema-dts`) · safe sanitization (`DOMPurify`) · search via Pagefind (static) or Orama (dynamic) ·
OG images via Satori. Full thresholds + budgets → **`docs/generated-site-quality.md`**.

## 7 — AI feature bar (summary)

Every AI feature requires: evals (Promptfoo) · tracing (Langfuse) · prompt/version tracking ·
budget controls + killswitch · fallback routing (LiteLLM/RouteLLM via AI Gateway) · grounding checks.
Full policy → **`docs/ai-observability.md`**.

---

## See also
- `docs/tooling-matrix.md` — flat tool grid (status · purpose · install target · runtime · owner · canonical job)
- `docs/ai-agent-rules.md` — agent operating rules (CF-first policy, no-dup, selection rubric, integration checklist)
- `docs/generated-site-quality.md` — generated customer-site quality gates (budgets, a11y, SEO, sanitization)
- `docs/ai-observability.md` — AI traces/evals/routing/budget/grounding governance
- `docs/security-supply-chain.md` — Gitleaks/Trivy/OSV/Syft/Grype/Semgrep/Cosign + Renovate policy
- `apps/project-sites/docs/architecture/cloudflare-first.md` — binding infra doctrine (allowed infra + hot path)
- `~/.agentskills/rules/package-preference-registry.md` § ProjectSites.dev — global agent policy
- `DECISIONS.md` — ADRs (the binding architecture commitments)
- `apps/project-sites/ROADMAP.md` — the revenue-sorted build queue (feature priority, not tooling)
- `apps/project-sites/FEATURE_CATALOG.md` — module build statuses
