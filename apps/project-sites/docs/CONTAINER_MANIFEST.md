# Container Manifest — every Docker container under `projectsites.dev`

Authoritative list of every Docker container the platform runs, each with its
`projectsites.dev` subdomain. Semantic per-feature subdomains only — never umbrella
prefixes (`/api/allstar/*`, category letters). Sibling: `docs/SUBDOMAIN_MAP.md` (the
two-domain `projectsites.dev` ↔ `megabyte.space` map). Slim doctrine:
`scripts/slim-containers.sh` + `~/.agentskills/rules/docker-slim-all-containers.md`.

**Status:** ✅ live · 🟡 defined-not-stood-up · 🔵 proposed (this manifest)
**Slim:** SHIP (registry/Fly image, push the `.slim`) · MEASURE (CF rebuilds from Dockerfile,
fold deletions in by hand) · GPU (runs on the 2× RTX 2080 Ti box behind a CF Tunnel) ·
n/a (Worker/Pages/R2/managed — no container)

---

## AI / LLM control plane

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `llm.projectsites.dev` | **RouteLLM + LiteLLM** — model router (cost/quality routing) in front of a unified OpenAI-compatible gateway | `ghcr.io/berriai/litellm:main-latest` + `lm-sys/RouteLLM` routing layer | 🔵 | SHIP |
| `infer.projectsites.dev` | **vLLM** — raw OpenAI-compatible GPU inference (the model `llm.` routes to) | `vllm/vllm-openai:latest` | 🟡 | GPU |
| `img.projectsites.dev` | **ComfyUI** — image generation (`flux.1-dev`) | `yanwk/comfyui-boot:cu128-megapak` | 🟡 | GPU |
| `traces.projectsites.dev` | **Langfuse** — LLM tracing / prompt mgmt / evals | `langfuse/langfuse:latest` | 🔵 | SHIP |
| `chat.projectsites.dev` | **Open WebUI** — internal LLM chat console | `ghcr.io/open-webui/open-webui:main` | 🔵 | SHIP |

`llm.` today is an env-var proxy (`SELFHOST_LLM_URL` → vLLM); the target is RouteLLM+LiteLLM
in front so every model call gets routing + logging + fallback. AI Gateway stays mandatory
in front of all of it per `cloudflare-first.md`.

## Jobs / automation / workflows

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `jobs.projectsites.dev` | **Inngest** — durable jobs/workflows dev server + UI | `inngest/inngest:latest` | 🔵 | SHIP |
| `flows.projectsites.dev` | **n8n** — visual automation | `n8nio/n8n:latest` | 🔵 | SHIP |

## Browser / agents

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `browser.projectsites.dev` | **CF Browser Rendering** + Playwright/Stagehand — the product browser-automation abstraction | — (CF primitive) | ✅ | n/a |
| `agent.projectsites.dev` | **Skyvern** — heavy browser-workflow agent (logged-in portals, multi-step) — behind CF Access | `public.ecr.aws/skyvern/skyvern:latest` | 🔵 | SHIP |
| `mcp.projectsites.dev` | **Browserbase MCP bridge** — internal agent tooling — behind CF Access | custom | 🔵 | SHIP |

## Search / vectors

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `search.projectsites.dev` | **Typesense** — full-text search | `typesense/typesense:latest` | 🔵 | SHIP |
| `vectors.projectsites.dev` | **Qdrant** — vector DB (only if self-host beats CF Vectorize) | `qdrant/qdrant:latest` | 🔵 | SHIP |

## Data / content / BaaS

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `db.projectsites.dev` | **NocoDB** — no-code DB UI | `nocodb/nocodb:latest` | 🔵 | SHIP |
| `base.projectsites.dev` | **PocketBase** — BaaS (auth/db/files) | `spectado/pocketbase:latest` | 🔵 | SHIP |
| `wiki.projectsites.dev` | **Outline** — knowledge base | `outlinewiki/outline:latest` | 🔵 | SHIP |
| `notes.projectsites.dev` | **Memos** — lightweight notes | `neosmemo/memos:stable` | 🔵 | SHIP |

## Secrets / identity

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `secrets.projectsites.dev` | **Infisical** — secrets management | `infisical/infisical:latest` | 🔵 | SHIP |
| `vault.projectsites.dev` | **Vaultwarden** — password manager | `vaultwarden/server:latest` | 🔵 | SHIP |

## Growth / comms / observability

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `analytics.projectsites.dev` | **Umami** — privacy analytics | `ghcr.io/umami-software/umami:postgresql-latest` | 🔵 | SHIP |
| `mail.projectsites.dev` | **Listmonk** — newsletters (SES SMTP relay) | `listmonk/listmonk:latest` | 🔵 | SHIP |
| `status.projectsites.dev` | **Uptime Kuma** — uptime monitoring | `louislam/uptime-kuma:1` | 🔵 | SHIP |
| `metrics.projectsites.dev` | **Grafana** — dashboards (optional) | `grafana/grafana:latest` | 🔵 | SHIP |
| `errors.projectsites.dev` | **GlitchTip** — self-host Sentry-compatible (optional; hosted Sentry is default) | `glitchtip/glitchtip:latest` | 🔵 | SHIP |

## Platform-internal CF Containers (Durable Objects — no public subdomain)

| Class | Image | Role | Status | Slim |
|---|---|---|---|---|
| `SiteBuilderContainer` | `./Dockerfile` | AI site-build executor (Claude Code, on-demand) | ✅ | MEASURE |
| `AppRuntimeContainer` | `./containers/app-runtime/Dockerfile` | customer-installed app runtime — serves `{app}-app.projectsites.dev` | ✅ | MEASURE |
| `VoiceBrowseAgent` | `./Dockerfile.voice-browse` | headless Playwright screen-recording (flag-gated, dormant) | 🟡 | MEASURE |

The 10 catalog apps (Umami, Outline, n8n, Vaultwarden, Uptime Kuma, NocoDB, Listmonk,
Memos, PocketBase, Open WebUI) are ALSO `[[containers]]`-defined-but-blocked
(`IMAGE_REGISTRY_NOT_CONFIGURED`) as **customer-installable** apps at
`{app}-app.projectsites.dev` via `AppRuntimeContainer` subclasses — a separate role from the
platform's own ops instances above.

## Non-container product surfaces (for completeness)

| Subdomain | Backing | Status |
|---|---|---|
| `projectsites.dev` | Worker (Hono) — marketing + API | ✅ |
| `*.projectsites.dev` | R2 static — generated customer sites | ✅ |
| `editor.projectsites.dev` | CF Pages — bolt-diy editor | ✅ |
| `preview.projectsites.dev` | Worker + R2 — build previews | ✅ |
| `storybook.projectsites.dev` | CF Pages — Storybook | 🟡 (404, not deployed) |

## Managed, never containerized (CF-first escape hatches)

- **Postgres** → Neon (via Hyperdrive) — not a container.
- **Redis** → Upstash — not a container.
- **D1 / KV / R2 / Vectorize / Queues / Workflows / Browser Rendering** → CF primitives — not containers.

---

## Reconciliation with `SUBDOMAIN_MAP.md`

`SUBDOMAIN_MAP.md` currently homes the ops stack on `megabyte.space` (Megabyte Labs infra).
This manifest is the `projectsites.dev`-native plan: the same images, addressed under the
product domain with semantic per-feature subdomains. When a service is stood up, add its row
to BOTH files + a `CONTAINERS`/`REGISTRY_IMAGES` entry in `scripts/slim-containers.sh` the
same turn (`drift-detection`). SHIP images are built → `slim build` → smoke-tested → push the
`.slim`; MEASURE (CF) images fold slim deletions into the Dockerfile by hand.
