# Subdomain ↔ Docker-Project Map

Canonical list of every subdomain + the Docker project behind it. Two domains:

- **`projectsites.dev`** — the product (marketing, generated sites, editor, app-runtime).
- **`megabyte.space`** — Megabyte Labs infra / self-host ops stack.

**Slim mode** per `~/.agentskills/rules/docker-slim-all-containers.md`:

- **MEASURE** — Cloudflare Container DOs (`image = "./Dockerfile"`). CF rebuilds from the
  Dockerfile on `wrangler deploy` and does NOT consume a local `.slim` image, so `slim build`
  is run report-only and the deletions are folded back into the Dockerfile by hand.
- **SHIP** — registry/Fly/VM images. `slim build` produces the image that actually runs;
  push the `.slim` tag.
- **n/a** — Worker / Pages / R2 surfaces (no container).

Build + slim everything: `bash scripts/slim-containers.sh` (custom) · `--registry` (self-host pull-slim).

---

## Product — `projectsites.dev`

| Subdomain | Project | Backing | Image / source | Slim |
|---|---|---|---|---|
| `projectsites.dev` | Marketing + API | Worker (Hono) | `src/index.ts` | n/a |
| `*.projectsites.dev` | Generated customer sites | R2 static | `sites/{slug}/…` | n/a |
| `{app}-app.projectsites.dev` | Installed-app runtime | **CF Container DO** `APP_RUNTIME` | `containers/app-runtime/Dockerfile` | MEASURE |
| `editor.projectsites.dev` | bolt-diy editor | CF Pages | bolt.diy | n/a |
| `preview.projectsites.dev` | Build previews | Worker + R2 | per `EDGE_HOSTING_STRATEGY.md` | n/a |
| `storybook.projectsites.dev` | Storybook | CF Pages | `frontend` Storybook | n/a *(currently 404 — not deployed)* |
| `voice.projectsites.dev` | Voice answering gateway (Twilio webhook + Media Streams WS, all account numbers) | **Fly.io** app `voice-gateway`, region `iad` (us-east VA), autoscale by concurrent calls | `apps/voice-gateway/` (fork of `twilio-labs/call-gpt`) — ADR-0011 | SHIP *(planned — V0 epic)* |
| `crm.projectsites.dev` | **Twenty CRM** — per-tenant provisioned add-on (one instance per opt-in org) | **CF Container DO** `AppRuntimeContainer` | `twentycrm/twenty:latest` | SHIP *(proposed)* |
| `cms.projectsites.dev` | **Payload CMS** — per-tenant provisioned add-on (nominal-fee opt-in) | **CF Container DO** `AppRuntimeContainer` | `payloadcms/payload:latest` | SHIP *(proposed)* |
| _(internal, no subdomain)_ | AI site builder | **CF Container DO** `SITE_BUILDER` | `./Dockerfile` | MEASURE |
| _(internal, no subdomain)_ | Voice-browse agent | **CF Container DO** `VoiceBrowseAgent` | `Dockerfile.voice-browse` | MEASURE *(flag-gated, dormant)* |

`browser.projectsites.dev` is the **product browser-automation abstraction** — it's CF Browser
Rendering (not a container) fronting CF Browser Run → Browserbase fallback. No Docker image.

> **Canonical service-domain home = `projectsites.dev` (not `megabyte.space`).** The ops services
> below are mirrored here for history, but the authoritative plan addresses them under the product
> domain with semantic subdomains — see `docs/CONTAINER_MANIFEST.md`: `mail.` → Listmonk · `secrets.`
> → Infisical (only if CF Secrets Store insufficient) · `events.` → **Inngest** · `jobs.` → **Hatchet**
> (Hatchet Cloud preferred) · `traces.` → Langfuse · `llm.` → LiteLLM · `crm.` → Twenty · `cms.` → Payload
> · `support.` → Chatwoot · `social.` → Postiz · `status.` → OpenStatus · `checks.` → Healthchecks.io.

---

## Infra / self-host — `megabyte.space`  (all SHIP-slim; deploy Fly.io or registry→VM)

### AI control plane
| Subdomain | Project | Image |
|---|---|---|
| `llm.megabyte.space` | **LiteLLM** — unified LLM gateway/proxy (premium↔DeepSeek↔Workers-AI routing) | `ghcr.io/berriai/litellm` |
| `langfuse.megabyte.space` | **Langfuse** — LLM tracing / prompt mgmt / evals | `langfuse/langfuse` |
| `chat.megabyte.space` | **Open WebUI** — internal LLM chat UI | `ghcr.io/open-webui/open-webui` |

### Jobs / automation
| `inngest.megabyte.space` | **Inngest** — durable jobs/workflows dev server + UI | `inngest/inngest` |
| `n8n.megabyte.space` | **n8n** — visual automation | `n8nio/n8n` |

### Secrets / identity
| `secrets.megabyte.space` | **Infisical** — secrets management | `infisical/infisical` |
| `vault.megabyte.space` | **Vaultwarden** — password manager | `vaultwarden/server` |

### Data / content
| `db.megabyte.space` | **NocoDB** — no-code DB UI | `nocodb/nocodb` |
| `pb.megabyte.space` | **PocketBase** — BaaS (auth/db/files) | `spectado/pocketbase` |
| `wiki.megabyte.space` | **Outline** — knowledge base | `outlinewiki/outline` |
| `notes.megabyte.space` | **Memos** — lightweight notes | `neosmemo/memos` |

### Growth / comms / observability
| `analytics.megabyte.space` | **Umami** — privacy analytics | `ghcr.io/umami-software/umami` |
| `news.megabyte.space` | **Listmonk** — newsletters (SES SMTP relay) | `listmonk/listmonk` |
| `status.megabyte.space` | **Uptime Kuma** — uptime monitoring | `louislam/uptime-kuma` |
| `grafana.megabyte.space` | **Grafana** — dashboards *(optional)* | `grafana/grafana` |

### Agent / MCP (internal — behind CF Access)
| `skyvern.megabyte.space` | **Skyvern** — heavy browser-workflow agent | `skyvern` (internal) |
| `mcp.megabyte.space` | **Browserbase MCP bridge** — internal agent tooling | custom |

---

## Deploy/slim status (2026-06-19)

- **Live now:** `projectsites.dev`, `*.projectsites.dev` (e.g. `megabytespace.`), `editor.`, `/health` (all 200).
- **CF containers deployed (on-demand DOs):** `SITE_BUILDER`, `APP_RUNTIME` — built from Dockerfile by CF, slim = MEASURE (fold into Dockerfile).
- **Self-host stack:** catalog above is the TARGET. Each is `[[containers]]`-commented in `wrangler.toml`
  OR Fly-bound — provision (compose + env + secrets) then `slim build`→push per service. NOT yet stood up.
- **storybook.** = 404 (Pages project not deployed). **grafana/skyvern/mcp** = optional/internal.

Single source of truth — when a new Docker project is added, add its row here + a `CONTAINERS`/`REGISTRY_IMAGES`
entry in `scripts/slim-containers.sh` the same turn (`drift-detection`).
