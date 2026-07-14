# Infra Cleanup — 2026-07-14

## 1. Onyx R2 Tokens (2 min)

Onyx is crash-looping — missing S3 credentials for R2 file storage.

1. Go to https://dash.cloudflare.com/84fa0d1b16ff8086dd958c468ce7fd59/r2/onyx-projectsites/settings/tokens
2. Click "Manage R2 API Tokens" → "Create API Token"
3. Set permissions: Object Read & Write
4. Copy the Access Key ID and Secret Access Key
5. Run:

```bash
fly secrets set \
  S3_ACCESS_KEY_ID='<Access Key ID>' \
  S3_SECRET_ACCESS_KEY='<Secret Access Key>' \
  -a onyx-projectsites
```

6. Wait 60s, then verify: `curl -s https://onyx.projectsites.dev/health` should return `{"result":"ok"}`

## 2. Delete Upstash Databases ($256/mo)

10 databases still billing even though all traffic is on Fly Redis.

1. Go to https://console.upstash.com
2. Delete these databases one by one:

| Database Name | Upstash ID |
|---|---|
| projectsites-medusa | rational-macaque |
| projectsites-n8n | moral-adder |
| projectsites-nango | stirring-marlin |
| projectsites-onyx | assuring-cat |
| projectsites-postiz | composed-eagle |
| projectsites-searxng | fine-sponge |
| projectsites-teable-cache | open-tortoise |
| projectsites-teable-perf | golden-spaniel |
| twenty-crm | natural-chamois |
| unkey | national-vulture |

3. Verify at https://console.upstash.com — should show $0/mo

## 3. Start Docker (CF Container deploys)

4 CF Container apps have new Redis secrets but haven't been redeployed.

1. Open Docker Desktop from Applications
2. Wait for whale icon to stop animating
3. Run:

```bash
for app in medusa twenty searxng unkey; do
  cd apps/project-sites/infra/$app && npx wrangler deploy
done
```

## 4. Grafana Cloud Setup

Grafana Fly app deleted. Using Grafana Cloud free tier.

1. Go to https://grafana.com/auth/sign-up/create-user
2. Create free account → get API key at https://grafana.com/orgs/<org>/api-keys
3. Save to get-secret:
```bash
# Save to /Users/Apple/.local/share/chezmoi/home/.chezmoitemplates/secrets-macbook-pro/GRAFANA_CLOUD_API_KEY
```

4. Wire into admin dashboard at `/admin/grafana` — embed Grafana Cloud dashboards via iframe

## 5. Verify Final State

```bash
# Should show only these Fly apps
fly apps list | grep deployed

# Expected: projectsites-activepieces, projectsites-checkmate,
#   projectsites-clickhouse, projectsites-forgejo,
#   projectsites-nango, projectsites-redis,
#   projectsites-temporal-fly, social-postiz,
#   support-chatwoot, onyx-projectsites

# Redis health
fly ssh console -a projectsites-redis -C "redis-cli -a ohyi2Fjm8gCJ8Bfuh8rO/anHQYa1cMuk PING"
```
