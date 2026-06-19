# Infrastructure Notes — self-hosted + data plane (deploy when `coolify.megabyte.space` is live)

> Standing architecture decisions for projectsites.dev's off-edge plane. The Cloudflare
> edge stays the hot path (per `projectsites-cloudflare-first`); everything here is the
> async/batch/data brain behind a **Cloudflare Tunnel + Cloudflare Access SSO**.
> Status: **NOTE / PLANNED** — provision once `coolify.megabyte.space` is available.

## Postgres — ALWAYS Neon + Hyperdrive (LAW)

- **Every Postgres database is hosted on Neon.** Never self-host Postgres on the Coolify box, never Fly Postgres. Tinybird/ClickHouse is the analytics OLAP store; Neon is the OLTP store.
- **Hyperdrive fronts every Worker→Neon connection** to pool + cache + cut connection latency from the edge. Shard-level Hyperdrive bindings, never one config per site (per `projectsites-cloudflare-first` § Postgres path).
- **A FRESH Neon Postgres database per application type.** Each distinct app/service gets its own Neon database (not a shared one): projectsites.dev core, the email/listmonk plane, the jobs plane, events, llm-ops, analytics-meta, etc. — each isolated. New app type ⇒ new Neon DB + new Hyperdrive binding. Naming: `neon-{app}-{env}` (e.g. `neon-projectsites-prod`, `neon-listmonk-prod`).
- D1 stays the edge-hot relational store (tenants/hostnames/flags/rollups); Neon is the escape hatch for true Postgres workloads + per-app isolation.

## Container roster (Coolify, behind CF Tunnel + CF Access SSO)

All `*.megabyte.space` / internal `*.projectsites.dev` service subdomains are **protected by Cloudflare Access SSO** — no public exposure. Customer sites never depend on them directly; product code calls them through edge-Worker adapters.

| Subdomain | Service | Purpose | Adapter / wiring |
|---|---|---|---|
| `llm.projectsites.dev` / `llm.megabyte.space` | **vLLM** (OpenAI-compatible, 2× 2080 Ti) | mid-grade/standard LLM tier — site-gen, content, pSEO, summarization, container build agent | `self_hosted.resolveSelfHostedLlm` → `external_llm` `selfhosted` provider (API fallback on 5xx) |
| `img.projectsites.dev` | **ComfyUI / SDXL + Flux** (AI image gen API) | hero/section image generation, upscale, bg-removal | `self_hosted.resolveSelfHostedImage` → `image_generation` first-try (DALL·E fallback) |
| `email.projectsites.dev` | **listmonk** (one binary; SES SMTP relay) | multi-tenant newsletters/campaigns/subscribers/MJML editor | edge Worker: host→`site_id`→listmonk-list scoping (Model A); promote heavy tenants to dedicated listmonk container (Model B) |
| `jobs.projectsites.dev` | **trigger.dev** (self-hosted) | durable background jobs / scheduled work | edge Worker dispatch; Neon DB `neon-jobs-prod` + Hyperdrive |
| `events.projectsites.dev` | **Inngest** (self-hosted) | event-driven workflows / fan-out | edge Worker emits; Neon DB `neon-events-prod` |
| `scan.projectsites.dev` / internal | **Skyvern** | heavy logged-in 12-step agent flows ONLY (CF Access, internal) | NOT default architecture; product uses `browser.projectsites.dev` for routine work |
| `browser.projectsites.dev` | **Browserless / Playwright grid** | screenshots / visual-QA / scrape fallback tier | the CF-first browser abstraction's self-hosted fallback |
| (analytics) | **Tinybird** (managed, us-east AWS) | ClickHouse OLAP for high-cardinality per-tenant analytics (Plane H) | secrets stored: `TINYBIRD_*` in get-secret |
| (jobs/orchestration) | **Hatchet** (cloud-hosted, NOT Fly yet) | durable task orchestration | secrets: `HATCHET_API_TOKEN`, `HATCHET_MANAGEMENT_TOKEN` in get-secret |

### Candidate add-ons (per the brainstorm, lower priority)
text-embeddings-inference (BGE) · Whisper + Piper/XTTS TTS · Real-ESRGAN + rembg · self-hosted PostHog + Sentry (front with the observability-gateway Worker) · MinIO (R2 cold tier on the 8TB) · Crawlee/Firecrawl-OSS.

## vLLM + ComfyUI launch plan (the cost-killer)

1. Coolify: deploy vLLM (Qwen2.5-32B-Instruct AWQ or Llama-3.3-70B tensor-parallel across both cards) → OpenAI-compatible `:8000`; ComfyUI `:8188`.
2. Cloudflare Tunnel → `llm.projectsites.dev` + `img.projectsites.dev`; both behind **CF Access SSO** (service-token for the Worker, interactive for humans).
3. Set env (get-secret → `wrangler secret put`): `SELFHOST_LLM_URL`, `SELFHOST_LLM_MODEL`, `SELFHOST_LLM_API_KEY`, `SELFHOST_IMAGE_URL`, `SELFHOST_IMAGE_MODEL`, `SELFHOST_IMAGE_API_KEY`. Worker→tunnel calls carry the CF Access service-token headers (`CF-Access-Client-Id`/`Secret`).
4. Wire `external_llm` `selfhosted` provider (the rippling provider-union change — its own focused pass) + `image_generation` first-try. **`self_hosted.ts` adapter + tests already shipped (fire-v2.67, commit 1561f45e).**
5. Route through AI Gateway where possible (the every-call mandate); self-hosted is the `standard`/`instant` tier, premium (Anthropic) keeps judgment + vision.
6. **Never in the hot path** — batch/async/build-time only (residential uplink).

## Secrets stored this session (get-secret + chezmoi age-encrypted)

`TINYBIRD_API_HOST` · `TINYBIRD_MCP_SERVER` · `TINYBIRD_MCP_TOKEN` · `TINYBIRD_PORT` · `TINYBIRD_HOST` · `TINYBIRD_USERNAME` · `TINYBIRD_PASSWORD` · `TINYBIRD_WORKSPACE_ID` · `HATCHET_API_TOKEN` · `HATCHET_MANAGEMENT_TOKEN` · `CF_API_TOKEN_PROJECTSITES_DEPLOY`. Push to prod Worker secrets when the consuming code lands (`wrangler secret put`, minted-token recipe in `secret-provisioning`).
