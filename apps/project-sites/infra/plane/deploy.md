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

## Architecture (one Worker, ONE Container DO — Plane AIO)

```
pm.megabyte.space ─▶ Worker projectsites-plane (worker.ts) ─▶ Plane AIO container (:80)
                                                               │  internal supervisor + proxy runs
                                                               │  web + space + admin + api +
                                                               │  celery worker + beat
                     cron */2 ─▶ scheduled() re-pokes it ──────┘  talks to Neon · Upstash ·
                     (keeps celery worker/beat warm)              CloudAMQP · R2 (external, direct)
```

- **ONE container** — Plane's **all-in-one (AIO) image** runs every Plane process behind its own
  internal supervisor + proxy on a single port (80). The Worker just forwards every request to it
  (no path-routing, no per-service containers). AIO runs DB migrations itself on boot.
- The container talks to the EXTERNAL data plane directly (Neon/Upstash/CloudAMQP/R2). Celery has
  no HTTP port, so the `*/2` cron re-pokes the container to keep worker/beat draining the queue.
- Files: `worker.ts` (one `Plane` class + forward + keep-warm), `wrangler.toml` (one
  `[[containers]]` + DO binding + migration + cron + custom_domain), `Dockerfile`
  (`FROM makeplane/plane-aio:stable`). Env reference: `.env.plane.example`.

## Remaining blockers (2)

1. **Mint the R2 S3 token for `plane-media`** — the one CF credential not cleanly API-mintable:
   dash.cloudflare.com → R2 → **Manage R2 API Tokens** → Create (Object Read & Write, scoped to
   `plane-media`) → copy Access Key ID + Secret, then store:
   ```
   SD=~/.local/share/chezmoi/home/.chezmoitemplates/secrets-macbook-pro
   printf '%s' '<ACCESS_KEY_ID>'     | chezmoi encrypt --output "$SD/PLANE_R2_ACCESS_KEY_ID"
   printf '%s' '<SECRET_ACCESS_KEY>' | chezmoi encrypt --output "$SD/PLANE_R2_SECRET_ACCESS_KEY"
   ```
2. **Deploy** — builds the single AIO image → needs **Docker** (or push to CF Workers Builds,
   which has Docker). `wrangler deploy` rebuilds `FROM makeplane/plane-aio:stable`.

## Deploy (Docker up — or via Workers Builds)

```bash
cd apps/project-sites/infra/plane
export CLOUDFLARE_API_KEY="$(get-secret CLOUDFLARE_API_KEY)" CLOUDFLARE_EMAIL=blzalewski@gmail.com

# secrets → the Worker (injected into the Plane container's envVars by worker.ts)
for kv in \
  "SECRET_KEY:PLANE_SECRET_KEY" "DATABASE_URL:PLANE_DATABASE_URL" "REDIS_URL:PLANE_REDIS_URL" \
  "AMQP_URL:PLANE_AMQP_URL" "S3_ACCESS_KEY_ID:PLANE_R2_ACCESS_KEY_ID" \
  "S3_SECRET_ACCESS_KEY:PLANE_R2_SECRET_ACCESS_KEY"; do
  name="${kv%%:*}"; key="${kv##*:}"
  printf '%s' "$(get-secret "$key")" | npx wrangler secret put "$name" --name projectsites-plane
done

open -a Docker && until docker info >/dev/null 2>&1; do sleep 3; done   # builder
npx wrangler deploy        # builds the AIO image + provisions the Plane Container DO + the route
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
