# Plane — pm.megabyte.space (Neon + Upstash + R2 + CloudAMQP)

Self-hosted Plane (project management) for Megabyte Labs at **pm.megabyte.space**. Plane is a
6-process app (Django API + Celery worker + Celery beat + Next.js web/space/admin + a path-routing
proxy), so its **compute runs on Fly.io** (the multi-process escape hatch, like Chatwoot — CF
Workers Containers are single-process). The **data plane is fully managed + already provisioned**:

| Service | Provider | Resource | Secret (get-secret key) |
|---|---|---|---|
| Postgres | Neon | DB `plane` in project `n8n` (`dawn-bread-71972871`, us-east-1) | `PLANE_DATABASE_URL` (direct endpoint) |
| Redis (cache) | Upstash | `plane-pm` (`sweet-ibex-138916.upstash.io`, us-east-1) | `PLANE_REDIS_URL` |
| RabbitMQ (Celery broker) | CloudAMQP | `plane-pm` (id 393848, Little Lemur, AWS us-east-1) | `PLANE_AMQP_URL` |
| Object storage | Cloudflare R2 | bucket `plane-media` | `PLANE_R2_ACCESS_KEY_ID` / `PLANE_R2_SECRET_ACCESS_KEY` ⚠ mint (below) |
| Django secret | self-gen | `openssl rand -hex 32` | `PLANE_SECRET_KEY` |

> All connection strings are in the chezmoi secret store (`get-secret <KEY>`), never committed.
> Neon uses the **direct** (non-`-pooler`) endpoint — Plane's Django migrations dislike PgBouncer
> transaction mode. Region: everything is **us-east-1** (CloudAMQP + Upstash + Neon) to keep
> Fly↔data latency low — run Fly in `iad`.

## Remaining blockers (2)

1. **Mint the R2 S3 token for `plane-media`** — the one CF credential not cleanly API-mintable:
   dash.cloudflare.com → R2 → **Manage R2 API Tokens** → Create (Object Read & Write, scope to
   `plane-media`) → copy Access Key ID + Secret, then:
   ```
   printf '%s' '<ACCESS_KEY_ID>'     | chezmoi encrypt --output "$SD/PLANE_R2_ACCESS_KEY_ID"
   printf '%s' '<SECRET_ACCESS_KEY>' | chezmoi encrypt --output "$SD/PLANE_R2_SECRET_ACCESS_KEY"
   ```
   (`$SD = ~/.local/share/chezmoi/home/.chezmoitemplates/secrets-macbook-pro`)
2. **Fly compute launch** (below) — needs `flyctl` (`brew install flyctl`) + `FLY_API_TOKEN`
   (present in get-secret). Run as a dedicated focused session (5 Fly apps + migrations).

## Fly topology (5 apps, one 6PN private network, region `iad`)

Plane's api/worker/beat **share the `makeplane/plane-backend` image** (different commands) → one
Fly app with 3 process groups. The frontends are separate images → separate apps. A proxy app
fronts the public hostname and path-routes.

| Fly app | Image | Role | Public? |
|---|---|---|---|
| `pm-plane-backend` | `makeplane/plane-backend:stable` | processes: `web` (gunicorn api :8000), `worker` (celery), `beat` (celery beat) | internal |
| `pm-plane-web` | `makeplane/plane-frontend:stable` | main SPA (:3000) | internal |
| `pm-plane-space` | `makeplane/plane-space:stable` | public views (:3000) | internal |
| `pm-plane-admin` | `makeplane/plane-admin:stable` | god-mode admin (:3000) | internal |
| `pm-plane-proxy` | `makeplane/plane-proxy:stable` | nginx path router (:80) → fronts pm.megabyte.space | **public** |

Proxy routes: `/` → web · `/spaces` → space · `/god-mode` → admin · `/api`,`/auth` → backend web ·
`/${BUCKET}` (uploads) → backend. Internal addressing via `<app>.internal` (Fly 6PN).

## Launch (dedicated session)

```bash
SD=~/.local/share/chezmoi/home/.chezmoitemplates/secrets-macbook-pro
export FLY_API_TOKEN="$(get-secret FLY_API_TOKEN)"
brew install flyctl 2>/dev/null || true

# shared secret set (every app that needs them)
DB="$(get-secret PLANE_DATABASE_URL)"; RD="$(get-secret PLANE_REDIS_URL)"
AMQP="$(get-secret PLANE_AMQP_URL)"; SK="$(get-secret PLANE_SECRET_KEY)"
R2K="$(get-secret PLANE_R2_ACCESS_KEY_ID)"; R2S="$(get-secret PLANE_R2_SECRET_ACCESS_KEY)"
R2_ENDPOINT="https://84fa0d1b16ff8086dd958c468ce7fd59.r2.cloudflarestorage.com"

# 1) backend (api+worker+beat) — fly.toml in ./backend/, processes defined there
fly launch --no-deploy --copy-config --name pm-plane-backend --region iad --image makeplane/plane-backend:stable
fly secrets set -a pm-plane-backend \
  SECRET_KEY="$SK" DATABASE_URL="$DB" REDIS_URL="$RD" AMQP_URL="$AMQP" \
  AWS_REGION=auto AWS_ACCESS_KEY_ID="$R2K" AWS_SECRET_ACCESS_KEY="$R2S" \
  AWS_S3_ENDPOINT_URL="$R2_ENDPOINT" AWS_S3_BUCKET_NAME=plane-media USE_MINIO=0 \
  WEB_URL=https://pm.megabyte.space CORS_ALLOWED_ORIGINS=https://pm.megabyte.space \
  GUNICORN_WORKERS=2
# run DB migrations once (release_command or one-off):
fly deploy -a pm-plane-backend
fly ssh console -a pm-plane-backend -C "python manage.py migrate"

# 2-4) web / space / admin (each: fly launch --image makeplane/plane-<svc>:stable, region iad,
#      secrets: NEXT_PUBLIC_API_BASE_URL=https://pm.megabyte.space, WEB_URL, etc.)
# 5) proxy (makeplane/plane-proxy:stable) with BACKEND/WEB/SPACE/ADMIN internal hosts +
#    FILE_SIZE_LIMIT + BUCKET_NAME=plane-media; this app is the public one.

# DNS + cert (megabyte.space zone 75a6f8d5e441cd7124552976ba894f83):
fly certs add pm.megabyte.space -a pm-plane-proxy        # prints the validation/target
# add the CNAME pm.megabyte.space → pm-plane-proxy.fly.dev via CF API (proxied=false for cert):
#   POST /zones/75a6f8d5e441cd7124552976ba894f83/dns_records {"type":"CNAME","name":"pm","content":"pm-plane-proxy.fly.dev","proxied":false}
```

## Verify (per verification-loop)
- `curl -sI https://pm.megabyte.space` → 200, body = Plane login (NOT a Fly placeholder).
- First sign-up creates the instance admin (Plane god-mode at `/god-mode`).
- Upload an attachment → confirm the object lands in R2: `wrangler r2 object list plane-media`.
- Celery: a worker log line on first project creation (RabbitMQ broker reachable).

## Env reference (full set lives in `.env.plane.example`)
See sibling `.env.plane.example` — every Plane env var mapped to its get-secret key / value.

## CloudAMQP account reference (for later — SSO / team roles)

- **Customer API key** → `get-secret CLOUDAMQP_API_KEY` (never commit). Per-instance apikey for
  `plane-pm` is returned on create (also retrievable via the API).
- **Team / SSO group UUID:** `f222f8b0-ab89-400b-85fe-3f6db8004478`. Role tags:
  `…/admin` · `…/billing manager` · `…/devops` · `…/member` · `…/monitor` · `…/<custom tag>`.
- **SAML (for SSO setup):**
  - Login/SSO URL + ACS: `https://customer.cloudamqp.com/login/saml`
  - Audience / SP Entity ID / metadata: `https://customer.cloudamqp.com/saml/metadata/f222f8b0-ab89-400b-85fe-3f6db8004478`
