# Plane — pm.megabyte.space (Cloudflare Workers Containers)

Self-hosted Plane (project management) for Megabyte Labs at **pm.megabyte.space**, on
**Cloudflare Workers Containers** (`cloudflare-lock-in-is-leverage` — NOT Fly, even though Plane
is multi-process). The CF-native pattern: **this Worker is the proxy/router**, **each Plane
service is its own Container DO**, every container talks to the **external data plane** directly,
and the **celery daemons are kept warm by a cron**. Data plane is fully provisioned:

| Service | Provider | Resource | Secret (get-secret key) |
|---|---|---|---|
| Postgres | Neon | DB `plane` in project `n8n` (`dawn-bread-71972871`, us-east-1) | `PLANE_DATABASE_URL` (direct endpoint) |
| Redis (cache) | Upstash | `plane-pm` (`sweet-ibex-138916.upstash.io`, us-east-1) | `PLANE_REDIS_URL` |
| RabbitMQ (Celery broker) | CloudAMQP | `plane-pm` (id 393848, Little Lemur, AWS us-east-1) | `PLANE_AMQP_URL` |
| Object storage | Cloudflare R2 | bucket `plane-media` | `PLANE_R2_ACCESS_KEY_ID` / `PLANE_R2_SECRET_ACCESS_KEY` ⚠ mint (below) |
| Django secret | self-gen | `openssl rand -hex 32` | `PLANE_SECRET_KEY` |

## Architecture (one Worker, 4 Container DOs)

```
pm.megabyte.space ─▶ Worker projectsites-plane (worker.ts)  ── path router ──┐
  /api · /auth · /plane-media  ─▶ PlaneApi   (Dockerfile.backend)            │  each container →
  /spaces                      ─▶ PlaneSpace (Dockerfile.space)              │  Neon · Upstash ·
  /god-mode                    ─▶ PlaneAdmin (Dockerfile.admin)             │  CloudAMQP · R2
  (else)                       ─▶ PlaneWeb   (Dockerfile.web)               │  (external, direct)
                                                                            ┘
cron */2 ─▶ scheduled() re-pokes PlaneApi → keeps gunicorn + celery worker + beat warm
```

- **PlaneApi** runs **api (gunicorn :8000) + celery worker + celery beat** together via
  supervisord (`supervisord.conf`), with a migrate-on-boot entrypoint (`start.sh`, idempotent).
  One container covers all three backend roles — CF Containers can't run docker-compose, so we
  consolidate the same-image processes and keep them alive with the keep-warm cron.
- **PlaneWeb / PlaneSpace / PlaneAdmin** are the three Next.js images, each :3000, pointed at the
  public API (`NEXT_PUBLIC_API_BASE_URL=https://pm.megabyte.space`) which the Worker routes back to
  PlaneApi. No container↔container private network needed.
- Files: `worker.ts` (router + classes + keep-warm), `wrangler.toml` (4 `[[containers]]` + DO
  bindings + migration + cron + custom_domain), `Dockerfile.{backend,web,space,admin}`,
  `supervisord.conf`, `start.sh`. Env reference: `.env.plane.example`.

## Remaining blockers (2)

1. **Mint the R2 S3 token for `plane-media`** — the one CF credential not cleanly API-mintable:
   dash.cloudflare.com → R2 → **Manage R2 API Tokens** → Create (Object Read & Write, scoped to
   `plane-media`) → copy Access Key ID + Secret, then store:
   ```
   SD=~/.local/share/chezmoi/home/.chezmoitemplates/secrets-macbook-pro
   printf '%s' '<ACCESS_KEY_ID>'     | chezmoi encrypt --output "$SD/PLANE_R2_ACCESS_KEY_ID"
   printf '%s' '<SECRET_ACCESS_KEY>' | chezmoi encrypt --output "$SD/PLANE_R2_SECRET_ACCESS_KEY"
   ```
2. **Deploy** — builds 4 container images → needs **Docker** (or push to CF Workers Builds, which
   has Docker). The `wrangler deploy` of a container worker rebuilds `FROM makeplane/*` images.

## Deploy (Docker up — or via Workers Builds)

```bash
cd apps/project-sites/infra/plane
export CLOUDFLARE_API_KEY="$(get-secret CLOUDFLARE_API_KEY)" CLOUDFLARE_EMAIL=blzalewski@gmail.com
W="--name projectsites-plane --env production"   # (omit --env if single-env)

# secrets → the Worker (injected into each Container DO's envVars by worker.ts)
for kv in \
  "SECRET_KEY:PLANE_SECRET_KEY" "DATABASE_URL:PLANE_DATABASE_URL" "REDIS_URL:PLANE_REDIS_URL" \
  "AMQP_URL:PLANE_AMQP_URL" "S3_ACCESS_KEY_ID:PLANE_R2_ACCESS_KEY_ID" \
  "S3_SECRET_ACCESS_KEY:PLANE_R2_SECRET_ACCESS_KEY"; do
  name="${kv%%:*}"; key="${kv##*:}"
  printf '%s' "$(get-secret "$key")" | npx wrangler secret put "$name" --name projectsites-plane
done

open -a Docker && until docker info >/dev/null 2>&1; do sleep 3; done   # builder
npx wrangler deploy        # builds the 4 images + provisions the 4 Container DOs + the route
```

DNS/TLS: `wrangler.toml` declares `routes = [{ pattern = "pm.megabyte.space", custom_domain = true }]`
on the megabyte.space zone (`75a6f8d5e441cd7124552976ba894f83`) — CF provisions the proxied
hostname + cert automatically on deploy (account-owned zone). Migrations run on PlaneApi boot
(`start.sh`).

## Verify (per verification-loop)
- `curl -sI https://pm.megabyte.space` → 200, body = Plane login (NOT a CF placeholder).
- First sign-up = instance admin (god-mode at `/god-mode`).
- Upload an attachment → `npx wrangler r2 object list plane-media` shows the object.
- Celery: a worker log line on first project create (CloudAMQP broker reachable) — the keep-warm
  cron keeps it draining between requests.

## Notes / pins
- Pin `makeplane/*:stable` → a specific CE version before prod; verify the `bin/docker-entrypoint-*.sh`
  names match that version (stable across recent CE releases).
- pm.megabyte.space is INFRA (megabyte.space plane), so the customer-facing 4-service rule doesn't
  bind it — RabbitMQ is an allowed 5th service here per Brian's explicit direction.

## CloudAMQP account reference (for later — SSO / team roles)
- Customer API key → `get-secret CLOUDAMQP_API_KEY` (never commit). Per-instance apikey returned on create.
- Team/SSO group UUID: `f222f8b0-ab89-400b-85fe-3f6db8004478`. Role tags: `…/admin · …/billing manager · …/devops · …/member · …/monitor · …/<custom>`.
- SAML: login/ACS `https://customer.cloudamqp.com/login/saml` · audience/metadata `https://customer.cloudamqp.com/saml/metadata/f222f8b0-ab89-400b-85fe-3f6db8004478`.
