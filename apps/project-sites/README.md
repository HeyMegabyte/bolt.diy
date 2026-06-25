# Project Sites Worker — `projectsites.dev`

Cloudflare Worker (Hono) powering the AI SaaS website-delivery engine. Full AI/onboarding
guide: [`CLAUDE.md`](CLAUDE.md). Stack selection + convergence work items: [`../../docs/STACK.md`](../../docs/STACK.md).

## Domain Catalog

Every domain we run, what's behind it, and its status. **Canonical records:**
[`docs/CONTAINER_MANIFEST.md`](docs/CONTAINER_MANIFEST.md) (container ↔ subdomain registry) +
[`docs/SUBDOMAIN_MAP.md`](docs/SUBDOMAIN_MAP.md). This table is the at-a-glance index — keep all
three in sync the same turn a service is added (`drift-detection`).

**Status:** ✅ live · 🟡 defined, not stood up · 🔵 proposed
**Tenancy:** *platform* = one shared instance · *per-tenant* = one isolated instance per opt-in org · *per-site* = one per generated site

### Product surfaces

| Domain | Service | Backing | Tenancy | Status | Notes |
|---|---|---|---|---|---|
| `projectsites.dev` | Marketing + API gateway | Worker (Hono) | platform | ✅ | `src/index.ts` |
| `*.projectsites.dev` | Generated customer sites | R2 static | per-site | ✅ | `sites/{slug}/…` |
| `{app}-app.projectsites.dev` | Installed-app runtime | CF Container DO `AppRuntimeContainer` | per-tenant | ✅ | self-host marketplace (`apps-catalog.ts`) |
| `editor.projectsites.dev` | bolt-diy editor | CF Pages | platform | ✅ | — |
| `preview.projectsites.dev` | Build previews | Worker + R2 | per-site | ✅ | `EDGE_HOSTING_STRATEGY.md` |
| `storybook.projectsites.dev` | Storybook (site-kit blocks) | CF Pages | platform | 🟡 | 404 — not deployed |

### Per-tenant provisioned add-ons (opt-in, paid)

Each opt-in org gets its **own isolated instance**, billed via the credit wallet / Stripe add-on.
Provisioned as per-tenant `AppRuntimeContainer`s (work item `tenant_app_provisioning`, not yet built).

| Domain | Service | Image | Tenancy | Status | Notes |
|---|---|---|---|---|---|
| `crm.projectsites.dev` | **Twenty CRM** | `twentycrm/twenty` | per-tenant | 🔵 | priced CRM add-on; instances at `{tenant}.crm.` |
| `cms.projectsites.dev` | **Payload CMS** | `payloadcms/payload` | per-tenant | 🔵 | nominal-fee CMS add-on; same provisioning model |

### Platform control-plane services

| Domain | Service | Image | Tenancy | Status | Notes |
|---|---|---|---|---|---|
| `llm.projectsites.dev` | **LiteLLM + RouteLLM** — model router + OpenAI-compatible gateway | `ghcr.io/berriai/litellm` + `lm-sys/RouteLLM` | platform | 🔵 | today an env-var proxy; behind CF AI Gateway |
| `traces.projectsites.dev` | **Langfuse** — LLM tracing / prompts / evals (v2, Neon) | `langfuse/langfuse` | platform | 🟡 | Neon provisioned |
| `events.projectsites.dev` | **Inngest** — event-driven durable jobs (§13) | `inngest/inngest` | platform | 🟡 | live-but-inert; Neon + Upstash provisioned |
| `jobs.projectsites.dev` | **Hatchet** — heavy/stateful/browser/AI execution plane | `ghcr.io/hatchet-dev/hatchet/hatchet-lite` | platform | 🔵 | Hatchet Cloud preferred; self-host container otherwise |
| `mail.projectsites.dev` | **Listmonk** — newsletters / lists (SES relay) | `listmonk/listmonk` | platform | 🟡 | Neon provisioned |
| `support.projectsites.dev` | **Chatwoot** — support / live-chat | `chatwoot/chatwoot` | platform | 🔵 | — |
| `social.projectsites.dev` | **Postiz** — social scheduling | `ghcr.io/gitroomhq/postiz-app` | platform | 🔵 | social add-on |
| `status.projectsites.dev` | **OpenStatus** — public status + uptime | `openstatushq/openstatus` | platform | 🔵 | — |
| `checks.projectsites.dev` | **Healthchecks.io** — dead-man-switch (crons/backups/syncs) | `healthchecks/healthchecks` | platform | 🔵 | — |
| `secrets.projectsites.dev` | **Infisical** — secrets mgmt | `infisical/infisical` | platform | 🔵 | only if CF Secrets Store insufficient |
| `search.projectsites.dev` | **Typesense** — full-text search | `typesense/typesense` | platform | 🔵 | only if Orama/Pagefind insufficient |
| `keys.projectsites.dev` | **Unkey** — API keys / quotas / metering | `@unkey/api` | platform | 🔵 | wraps the `psk_` keystore |
| `agent.projectsites.dev` | **Skyvern** — heavy browser-workflow agent | `skyvern` | platform | 🔵 | behind CF Access |
| `browser.projectsites.dev` | CF Browser Rendering + Playwright + Stagehand | — (CF primitive) | platform | ✅ | product browser-automation abstraction |
| `infer.projectsites.dev` | **vLLM** — GPU inference target | `vllm/vllm-openai` | platform | 🟡 | GPU box |
| `img.projectsites.dev` | **ComfyUI** — image generation | `yanwk/comfyui-boot` | platform | 🟡 | GPU box |
| `logs.projectsites.dev` | **Loki + Grafana** — logs / dashboards | `grafana/loki` + `grafana/grafana` | platform | 🔵 | only if self-hosted logs adopted |

### Platform-internal CF Container DOs (no public subdomain)

| Class | Image | Role | Status |
|---|---|---|---|
| `SiteBuilderContainer` | `./Dockerfile` | AI site-build executor (Claude Code) | ✅ |
| `AppRuntimeContainer` | `./containers/app-runtime/Dockerfile` | per-tenant installed-app runtime | ✅ |
| `VoiceBrowseAgent` | `./Dockerfile.voice-browse` | headless Playwright screen-recording | 🟡 dormant |

### Internal (behind CF Access — not product-facing)

| Domain | Service | Notes |
|---|---|---|
| `skyvern.megabyte.space` | Skyvern | internal-only historical/fallback |
| `mcp.megabyte.space` | Browserbase MCP bridge | internal fallback only |

### Managed, never containerized (CF-first)

Postgres → **Neon** (via Hyperdrive) · Redis → **Upstash** · D1 / KV / R2 / Vectorize / Queues /
Workflows / Browser Rendering → **CF primitives**.

> **Job planes:** `events.projectsites.dev` = **Inngest** (event-driven durable jobs — already built as
> `InngestContainer` DO with Neon + Upstash). `jobs.projectsites.dev` = **Hatchet**, the heavy/stateful/
> browser/AI execution plane (Hatchet Cloud preferred). **Dittofeed** replaces Novu for lifecycle
> messaging. **Deepcrawl** replaces Firecrawl for website-context extraction.
