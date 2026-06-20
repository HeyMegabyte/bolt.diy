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

`llm.` today is an env-var proxy (`SELFHOST_LLM_URL` → vLLM); the target is RouteLLM+LiteLLM
in front so every model call gets routing + logging + fallback. AI Gateway stays mandatory
in front of all of it per `cloudflare-first.md`.

## Jobs / automation

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `jobs.`/`events.projectsites.dev` | **Inngest** — self-hosted durable jobs server (`inngest start`, §13). Code (`InngestContainer` DO + `src/inngest/*` serve) ships LIVE-but-inert (503) on a normal deploy; secrets stored; container go-live = staged wrangler blocks + watched deploy. | `containers/inngest/Dockerfile` (FROM `inngest/inngest`) | 🟡 | SHIP |

## Browser / agents

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `browser.projectsites.dev` | **CF Browser Rendering** + Playwright/Stagehand — the product browser-automation abstraction | — (CF primitive) | ✅ | n/a |
| `agent.projectsites.dev` | **Skyvern** — heavy browser-workflow agent (logged-in portals, multi-step) — behind CF Access | `public.ecr.aws/skyvern/skyvern:latest` | 🔵 | SHIP |

The internal Browserbase MCP bridge stays at `mcp.megabyte.space` (behind CF Access) per
`cloudflare-first.md` — no `mcp.projectsites.dev`. Product/agent code calls
`browser.projectsites.dev`, never the bridge directly.

## Search

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `search.projectsites.dev` | **Typesense** — full-text search | `typesense/typesense:latest` | 🔵 | SHIP |

## Secrets

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `secrets.projectsites.dev` | **Infisical** — secrets management | `infisical/infisical:latest` | 🔵 | SHIP |

## Comms

| Subdomain | Container | Image | Status | Slim |
|---|---|---|---|---|
| `mail.projectsites.dev` | **Listmonk** — newsletters (SES SMTP relay) | `listmonk/listmonk:latest` | 🔵 | SHIP |

## Platform-internal CF Containers (Durable Objects — no public subdomain)

| Class | Image | Role | Status | Slim |
|---|---|---|---|---|
| `SiteBuilderContainer` | `./Dockerfile` | AI site-build executor (Claude Code, on-demand) | ✅ | MEASURE |
| `AppRuntimeContainer` | `./containers/app-runtime/Dockerfile` | customer-installed app runtime — serves `{app}-app.projectsites.dev` | ✅ | MEASURE |
| `VoiceBrowseAgent` | `./Dockerfile.voice-browse` | headless Playwright screen-recording (flag-gated, dormant) | 🟡 | MEASURE |

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

## Launch backends — provisioned 2026-06-20 (Neon + Upstash, CF-native)

The three active launch targets (`traces.`, `jobs.`, `mail.`) run as **CF Containers built
from a local `./containers/<svc>/Dockerfile`** (`FROM` upstream — the same path
`SiteBuilderContainer` uses, which bypasses the `IMAGE_REGISTRY_NOT_CONFIGURED` blocker that
only hits bare-registry `image =` refs). Data plane = **Neon Postgres + Upstash Redis**
(connection strings live as `wrangler secret`s, never in git).

- **`traces.` → Langfuse** — pin **v2** (Neon Postgres only). v3 needs ClickHouse → no CF
  primitive, so v2 is the CF-compatible build. Neon project `Langfuse` (`plain-heart-31877384`).
- **`jobs.` → Inngest** — `inngest start`, Neon project `Inngest` (`calm-sunset-61361436`) +
  Upstash Redis `inngest` (`stirring-cricket-93162.upstash.io`).
- **`mail.` → Listmonk** — reuses existing Neon project `Listmonk` (`jolly-pine-24431114`).

Remaining to go live: thin Dockerfiles + 3 `Container` DO subclasses + `[[containers]]`/DO
bindings/migration in `wrangler.toml` + host routing (`traces.`/`jobs.`/`mail.` → DO) in
`index.ts` + `wrangler secret put` the conn strings + watched `wrangler deploy` (one-way DO
migration — deploy with eyes on it).

## Reconciliation with `SUBDOMAIN_MAP.md`

`SUBDOMAIN_MAP.md` currently homes the ops stack on `megabyte.space` (Megabyte Labs infra).
This manifest is the `projectsites.dev`-native plan: the same images, addressed under the
product domain with semantic per-feature subdomains. When a service is stood up, add its row
to BOTH files + a `CONTAINERS`/`REGISTRY_IMAGES` entry in `scripts/slim-containers.sh` the
same turn (`drift-detection`). SHIP images are built → `slim build` → smoke-tested → push the
`.slim`; MEASURE (CF) images fold slim deletions into the Dockerfile by hand.
