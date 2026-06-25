# ProjectSites.dev — Tooling Matrix

> **Flat index** of every adopted/candidate tool with its lifecycle status. The narrative
> source of truth is `docs/STACK.md`; this file is the at-a-glance grid for audits + agents.
> Status legend + selection gate: `docs/STACK.md` §1/§3. Infra doctrine: `apps/project-sites/docs/architecture/cloudflare-first.md`.

**Columns:** tool · category · status · purpose · install target · runtime compat · owner area · duplicate policy (the one canonical job it owns).

## Backend / contracts / runtime

| Tool | Status | Purpose | Install target | Runtime | Owner | Canonical job |
|------|--------|---------|----------------|---------|-------|---------------|
| Hono | Core | Worker API framework | worker | CF Workers | platform | HTTP edge — no Express/Fastify |
| Zod | Core | Runtime validation SSOT | worker + shared | universal | platform | boundary validation — no Yup/Joi |
| Effect | Core | Typed errors/retry/DI (targeted) | worker | universal | platform | control-flow inside services only |
| hono-openapi | Core | OpenAPI serving for Hono | worker | CF Workers | platform | spec serving — supersedes @hono/zod-openapi |
| @asteasolutions/zod-to-openapi | Core | Derive OpenAPI 3.x from Zod | worker | universal | platform | OpenAPI generation |
| Drizzle ORM + Kit | Core | D1/Neon ORM + migrations | worker | CF Workers | data | SQL ORM — no Prisma/Kysely |
| jose | Core | JWT/JWK sign+verify | worker | CF Workers | auth | token crypto |
| DOMPurify | Core | Sanitize user/generated HTML | worker + sites | universal | security | HTML sanitization |
| Nano ID | Core | URL-safe IDs | worker | universal | platform | ID generation — no uuid for short IDs |
| OpenFeature | Recommended | Vendor-neutral flag SDK | worker | universal | platform | flag SDK over D1+KV plane |
| CloudEvents | Recommended | Event envelope contract | worker | universal | platform | durable event schema |
| OpenFGA | Recommended | Relationship authz | worker | adapter | auth | authz graph — grows past @casl/ability |
| Unkey | Recommended | API keys + quotas + metering | worker | adapter | platform | key/quota plane |

## Cloudflare / platform

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| Workers · Pages · D1 · KV · R2 · DO · Queues · Workflows | Core | Edge compute + storage + jobs | wrangler.toml | platform | the substrate |
| Hyperdrive · Vectorize · Analytics Engine · AI Gateway · Workers AI | Core | Pooling · vectors · analytics · LLM gateway/inference | wrangler.toml | platform | edge data/AI |
| Browser Rendering · Turnstile · WAF · Access · Secrets Store | Core | Headless browser · captcha · edge security | wrangler.toml | security | edge protection |
| Cloudflare for SaaS · Workers for Platforms | Core | Custom domains + tenant isolation | wrangler.toml | platform | multi-tenancy |
| Wrangler · Miniflare · workerd | Core | Dev/test/runtime-compat | devDeps | platform | CF toolchain |

## Data / storage / search

| Tool | Status | Purpose | Install target | Runtime | Owner | Canonical job |
|------|--------|---------|----------------|---------|-------|---------------|
| D1 / KV / R2 / DO | Core | System of record + cache + assets | wrangler.toml | CF | data | default storage |
| Neon Postgres (via Hyperdrive) | Recommended | Postgres semantics/RLS | adapter | adapter | data | only when D1 insufficient |
| Upstash Redis | Conditional | True Redis semantics | adapter | adapter | data | only sorted-sets/streams/locks |
| Orama | Recommended | Edge/hybrid search | worker | CF Workers | search | dynamic search |
| Pagefind | Recommended | Static-site search | sites build | static | search | generated-site search |
| Vectorize | Core | Vector store | wrangler.toml | CF | AI | embeddings |
| Qdrant · ElectricSQL · PGlite · DuckDB · ClickHouse/Tinybird | Conditional | Vector fallback · local-first · local analytics | adapter | adapter | data | only with ADR note |

## Builder / editor / UI — Angular admin

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| Angular 21 (zoneless/signals) | Core | Admin SPA | apps/dashboard | admin | admin framework (ADR-0002) |
| Spartan UI + Angular CDK | Core | Component system | apps/dashboard | admin | the only admin kit (ADR-0003) |
| Tailwind CSS | Core | Styling | apps/dashboard | admin | utility CSS |
| TanStack Table · Monaco · ECharts · Uppy | Core | Tables · editor · charts · uploads | apps/dashboard | admin | each = one canonical job |
| RxJS | Core | Backend-edge streams | apps/dashboard | admin | reactive streams (ADR-0006) |
| Motion | Recommended | Reduced-motion micro-motion | apps/dashboard | admin | animation |
| NgRx | Conditional | Complex shared state | apps/dashboard | admin | signals-first today |
| Angular Material | Avoid | — | — | admin | Spartan-only (ADR-0003) |

## Builder / editor / UI — React surfaces (generated sites + bolt.diy editor)

> React-only libs NEVER enter the Angular admin bundle.

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| Puck | Recommended | Visual block/page builder | sites/editor | sites | page builder |
| Plate.js | Recommended | Rich/block content editing | sites/editor | sites | rich text |
| Radix UI · shadcn/ui | Recommended | Accessible primitives | sites/editor | sites | React component kit |
| cmdk | Recommended | Command palette | sites/editor | sites | palette |
| TanStack Router/Form/Virtual | Conditional/Recommended | Routing · forms · virtualization | sites/editor | sites | React data UX |
| React Flow / XYFlow | Conditional | Workflow/resource/site graphs | sites/editor | sites | node graphs (no Angular renderer) |
| GrapesJS | Conditional | HTML/email/template builder | sites/editor | sites | template builder view |
| Storybook | Recommended | Block/component workshop | site-kit | sites | component workshop |
| Satori | Recommended | OG/social image generation | worker | sites | OG images |
| Shiki | Recommended | Syntax highlight | sites + docs | sites | code highlight |
| Style Dictionary · Lightning CSS · SVGO | Recommended | Tokens · CSS transform · SVG opt | build | sites | asset pipeline |

## AI / agents / LLM ops

| Tool | Status | Purpose | Install target | Runtime | Owner | Canonical job |
|------|--------|---------|----------------|---------|-------|---------------|
| MCP TypeScript SDK | Core | Platform MCP | worker | CF Workers | AI | MCP surface |
| Cloudflare Agents SDK + Containers | Core | Stateful agents on DO | worker | CF | AI | agent runtime |
| AI Gateway + Workers AI | Core | Gateway + first-pass inference | wrangler.toml | CF | AI | inference + gateway |
| Langfuse | Recommended | Prompt/trace/cost observability | adapter | adapter | AI | LLM tracing |
| LiteLLM + RouteLLM | Recommended | Model routing/fallback | `llm.projectsites.dev` | service | AI | model routing |
| Promptfoo | Recommended | LLM evals/regression | devDeps + CI | node | AI | eval gate |
| Vercel AI SDK | Recommended | Typed streaming/tool-calling | sites/editor | universal | AI | stream/tool layer |
| Stagehand + Playwright | Recommended | Browser automation | devDeps | node | AI/QA | automation |
| Dify | Study | Pattern study only | — | — | AI | not core platform |

## Auth / identity / permissions

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| Custom D1 auth | Core | Live fallback rail | worker | auth | magic-link + OAuth + sessions |
| Logto | Recommended | Default IdP (dark-launched) | service | auth | app auth/orgs |
| WorkOS | Conditional | Enterprise SSO/SAML/SCIM (dark) | service | auth | enterprise IdP |
| OpenFGA | Recommended | Relationship authz | adapter | auth | authz graph |
| Better Auth · Auth.js | Conditional | Small embedded apps | adapter | auth | only where non-conflicting |

## Product / service apps (per subdomain)

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| Listmonk | Recommended | Newsletters (`mail.`) | CF Container | growth | campaign email (relays via SES) |
| Chatwoot | Conditional | Support (`support.`) | service | growth | support inbox |
| Twenty CRM | Conditional | CRM (`crm.`) | service | growth | CRM |
| Dittofeed | Conditional | Lifecycle journeys | service | growth | messaging journeys |
| Nango · Svix · Hookdeck | Recommended | Integrations · outbound · inbound webhooks | service | platform | each = one webhook job |
| Inngest | Recommended | Product workflows beyond CF Workflows | adapter | node | jobs | durable workflows |
| Hatchet Cloud | Conditional | Heavy/stateful/AI jobs | service | jobs | heavy job runner |
| Cal.diy · Formbricks · Documenso | Conditional | Booking · surveys · signatures | service | growth | each on real need |
| Medusa | Conditional | Customer commerce | service | sites | heavy commerce only (Square default) |
| Novu | Avoid | — | — | platform | custom `psnotify` instead |
| Resend | Avoid | — | — | platform | SES is sender; react-email templating only |

## Observability / testing / quality

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| OpenTelemetry JS | Core | Trace abstraction (OTLP) | worker | observability | tracing |
| Sentry JS SDK | Core | Exception tracking | worker + admin | observability | errors |
| PostHog | Core | Product/admin analytics | admin + worker | observability | product analytics (not every site) |
| Vitest · Playwright · Testing Library | Core | Unit + E2E | devDeps | QA | tests |
| MSW · fast-check | Recommended | Network mocks · property tests | devDeps | QA | test fixtures |
| Lighthouse CI | Recommended | Perf/a11y budgets | CI | QA | generated-site budgets |
| Knip · Oxlint | Core | Dead-code · fast lint | devDeps | DX | hygiene |
| Semgrep · Gitleaks · Trivy · OSV-Scanner · Syft · Grype | Recommended/Core | Security + supply-chain | CI | security | see `docs/security-supply-chain.md` |
| Cosign / Sigstore | Recommended | Artifact signing | CI | security | provenance |
| Renovate | Core | Dependency maintenance | repo | DX | dep updates |
| Biome | Avoid | — | — | DX | ESLint+Prettier+Oxlint per Brian |

## Infra / docs

| Tool | Status | Purpose | Install target | Owner | Canonical job |
|------|--------|---------|----------------|-------|---------------|
| OpenTofu | Recommended | IaC for all non-Wrangler resources | repo | infra | IaC — one canonical (no Pulumi) |
| Grafana · Loki · Prometheus | Conditional | Self-hosted observability | service | infra | services that need it |
| Infisical | Conditional | Secrets beyond Secrets Store | service | security | only if Secrets Store insufficient |
| Scalar | Recommended | OpenAPI reference UI | worker | docs | API docs |
| Mermaid · Shiki | Recommended | Diagrams · highlight | docs | docs | doc visuals |
| Docusaurus | Conditional | Docs site | service | docs | only if MkDocs outgrown |

## Maintenance

- New tool adopted → add a row here + a `docs/STACK.md` table entry in the SAME change (drift = audit fail).
- Status change (Conditional→Recommended→Core) → update both files + add the ADR note in `DECISIONS.md`.
- Never two tools for one "Canonical job" cell — pick one, document the loser in `DECISIONS.md`.
