<!--
SearXNG README — ProjectSites.dev private search infrastructure
search.projectsites.dev · CF Workers Container + Cloudflare Access + Upstash Valkey
-->
# SearXNG — search.projectsites.dev

Private search infrastructure for ProjectSites.dev.
SearXNG behind Cloudflare Access, proxied by a Cloudflare Workers Container.

## Architecture

User → Cloudflare Access → search.projectsites.dev → Worker proxy → SearXNG container

- **Worker**: TypeScript proxy at `worker.ts`. Handles `/healthz` directly. Proxies all other traffic to SearXNG. Strips CF-Access auth headers before forwarding. Adds security headers. Never logs raw search queries.
- **Container**: `searxng/searxng:latest` at `Dockerfile`. SearXNG listens on `:8080`. Config at `searxng/settings.yml` + `searxng/limiter.toml`.
- **Valkey/Redis**: Upstash Redis-compatible database for limiter + bot-detection. URL stored as `SEARXNG_VALKEY_URL` secret.
- **Access**: Cloudflare Access gates the hostname. Unauthenticated → login page. Authenticated → SearXNG.

## Quick Deploy

### 1. Secrets

Generate a secret key:

```bash
openssl rand -base64 32
```

Set secrets on the worker:

```bash
cd apps/project-sites/infra/searxng
npx wrangler secret put SEARXNG_SECRET          # paste the base64 value above
npx wrangler secret put SEARXNG_VALKEY_URL      # Upstash Redis URL (redis://...)
```

### 2. Create Upstash Redis (if needed)

Go to https://console.upstash.com/redis → Create Database.
Region: `us-east-1` (co-located with CF Workers).
Copy the `redis://` URL → `npx wrangler secret put SEARXNG_VALKEY_URL`.

### 3. Deploy

```bash
cd apps/project-sites/infra/searxng
npx wrangler deploy
```

Docker must be running (`docker info` succeeds).

### 4. Configure Cloudflare Access

1. **Cloudflare Zero Trust Dashboard** → Access → Applications → Add
2. **Type**: Self-hosted
3. **Application name**: ProjectSites SearXNG
4. **Subdomain**: `search.projectsites.dev`
5. **Identity providers**: Google / GitHub as configured
6. **Policy**: Allow — Emails ending in `@megabyte.space` (or specific admin emails)
7. **Session duration**: 24h
8. **Create access policy**: Save

### 5. Verify

```bash
bash scripts/verify.sh
```

Expected:
- `GET /healthz` → 200 `ok`
- `GET /` (unauthenticated) → CF Access login page (200 or redirect chain to 200 login page)
- Authenticated via Access → SearXNG search page

## Secrets Reference

| Secret | Purpose | How to generate |
|---|---|---|
| `SEARXNG_SECRET` | Cryptography key for SearXNG | `openssl rand -base64 32` |
| `SEARXNG_VALKEY_URL` | Upstash Redis URL for limiter | Create at https://console.upstash.com/redis |

## Configuration

### settings.yml

At `searxng/settings.yml`. Uses `use_default_settings: true` so upstream defaults flow through. Overrides:
- Server: base_url, bind_address, port, limiter, method
- Search: safe_search=1, formats: html+json, conservative engine set
- UI: simple theme, no infinite scroll
- Valkey: URL injected via `SEARXNG_VALKEY_URL` env var

### limiter.toml

At `searxng/limiter.toml`. Conservative bot detection:
- Trusts Cloudflare IP ranges for correct client IP extraction
- No link_token (private instance, not public)
- No hardcoded pass/block IPs
- SearXNG org IPs allowed

## Engine Policy

Default engines enabled:
- Web: DuckDuckGo, Brave, Google, Bing
- Images: Google Images, Bing Images
- Videos: Google Videos
- News: Google News
- Science: Google Scholar, arXiv
- Code: GitHub, Stack Overflow
- Maps: OpenStreetMap
- Reference: Wikipedia

Engines that frequently CAPTCHA or break are disabled. Enable additional engines by editing `searxng/settings.yml` → `search.engines`.

## JSON/API Mode

Internal ProjectSites tools use JSON format:

```bash
# Authenticated via CF Access service token
curl -fsS \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "https://search.projectsites.dev/search?q=projectsites&format=json"
```

HTML format for browser UI (behind Access).

## No Raw Query Logging

- Worker logs only the request path, never the full URL or query string
- CF Workers Observability traces are structured, not raw URLs
- SearXNG logs are retained per-container lifecycle only
- Search queries are NOT persisted to D1, KV, R2, or any logging sink

## Health Checks

`GET /healthz` → `ok` (200). No engine calls. No external searches.
The container's Docker HEALTHCHECK uses `pgrep` — process check only.

## Update Process

1. Edit `searxng/settings.yml` or `searxng/limiter.toml`
2. `npx wrangler deploy` (rebuilds image + deploys)
3. `bash scripts/verify.sh`

For SearXNG version bumps: update `FROM searxng/searxng:latest` digest pin in `Dockerfile`.

## Fallback Plans

If CF Workers Containers blocks deployment:

1. **Fly.io** — `fallback/fly.toml` (same image, same config, same hostname behind CF Access)
2. **Railway** — `fallback/railway.md` (container deploy, CF Access via Cloudflare Tunnel)
3. **GCP Cloud Run** — `fallback/gcp-cloud-run.md` (serverless container, CF Access via public URL)

## File Layout

```
apps/project-sites/infra/searxng/
├── Dockerfile               # searxng/searxng:latest + config + custom entrypoint
├── entrypoint.sh            # URL scheme rewrite + ownership fix → stock entrypoint
├── worker.ts                # CF Worker proxy (/healthz + container proxy)
├── wrangler.toml            # CF Workers Container config
├── package.json             # Deps: @cloudflare/containers + wrangler
├── .env.example             # Env var template
├── README.md                # This file
├── searxng/
│   ├── settings.yml         # SearXNG configuration
│   └── limiter.toml         # Bot detection + proxy trust
├── scripts/
│   └── verify.sh            # Post-deploy verification
└── fallback/
    ├── fly.toml             # Fly.io fallback
    ├── railway.md           # Railway fallback
    └── gcp-cloud-run.md     # GCP Cloud Run fallback
```

## Cost Estimate

- **CF Workers Container** (standard-4): ~$0.000014/GB-s + ~$0.000005/request. At ~500 req/day + idle sleep → ~$1-3/month.
- **Upstash Redis**: Free tier (256MB) sufficient for limiter state.
- **CF Access**: Free for ≤50 seats.
- **Total**: ~$1-3/month, mostly CF Container compute.
