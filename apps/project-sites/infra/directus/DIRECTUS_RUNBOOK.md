# Directus Runbook — directus.projectsites.dev

## Quick reference

| Item | Value |
|------|-------|
| URL | https://directus.projectsites.dev |
| Worker | projectsites-directus |
| Container app | a035851c-da89-492f-97ee-7380295cb3c0 |
| Neon project | jolly-pine-24431114 (Listmonk) |
| Neon DB | directus |
| Upstash Redis | 54781325-1d46-4288-97cc-c36b67b70bb7 |
| R2 bucket | projectsites-directus-assets |
| Account ID | 84fa0d1b16ff8086dd958c468ce7fd59 |
| Zone ID | 9ceaa211750dd31899fd5d1bf8d1ec46 |

## Deploy

```bash
cd apps/project-sites/infra/directus
export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"
export WRANGLER_DOCKER_BIN=/usr/local/bin/docker
npx wrangler deploy
```

## Tail logs

```bash
cd apps/project-sites/infra/directus
npx wrangler tail --format pretty
```

## Restart/redeploy

The Worker auto-restarts crashed containers. To force a cold restart:

```bash
cd apps/project-sites/infra/directus
npx wrangler deploy  # triggers new deploy, kills old container
```

## Smoke test

```bash
curl -I https://directus.projectsites.dev/
curl https://directus.projectsites.dev/server/ping
# Expected: 200, "pong"
```

## Verify DB connectivity

```bash
# Uses the same connection string as the container
PGPASSWORD='hqkGFP6nsS6wVWKf1wHIVc+fW3W0co7GJqwJmbjm6IE=' psql \
  "postgresql://directus@ep-round-wildflower-aigybxdk-pooler.c-4.us-east-1.aws.neon.tech/directus?sslmode=require" \
  -c "SELECT count(*) FROM directus_collections;"
```

## Verify Redis connectivity

```bash
redis-cli -u "rediss://default:PASSWORD@large-oyster-155724.upstash.io:6379" PING
```

## Rotate secrets

```bash
cd apps/project-sites/infra/directus

# Generate new secret
NEW_SECRET=$(openssl rand -base64 48)
echo "$NEW_SECRET" | npx wrangler secret put SECRET

# Generate new admin password
NEW_PW=$(openssl rand -base64 24)
echo "$NEW_PW" | npx wrangler secret put ADMIN_PASSWORD

# Redeploy
npx wrangler deploy
```

## Create additional admin user

```bash
docker run --rm \
  -e "DB_CONNECTION_STRING=postgresql://..." \
  -e "ADMIN_EMAIL=new-admin@example.com" \
  -e "ADMIN_PASSWORD=generate-a-strong-one" \
  directus/directus:12.0.2 \
  npx directus users create --email new-admin@example.com --password ... --role admin-id
```

Or use the Directus admin UI after logging in.

## Verify uploads persist (after R2 configured)

1. Log into Directus admin
2. Upload a file to a collection
3. Note the file URL
4. Redeploy the worker: `npx wrangler deploy`
5. Verify the file URL still loads

## Rollback Directus version

Edit `Dockerfile` to pin an older version, then redeploy:

```dockerfile
FROM directus/directus:11.17.4
```

Then `npx wrangler deploy`.

Database migrations are forward-compatible within major versions. Rolling back across major versions (12→11) may require DB rollback. Test locally first.

## Export/import schema snapshot

```bash
# Export schema
docker run --rm \
  -e DB_CONNECTION_STRING="..." \
  directus/directus:12.0.2 \
  npx directus schema snapshot ./snapshot.yaml

# Apply schema
docker run --rm \
  -e DB_CONNECTION_STRING="..." \
  directus/directus:12.0.2 \
  npx directus schema apply ./snapshot.yaml
```

Store snapshots in git: `apps/project-sites/infra/directus/snapshots/`

## Recover from failed migration

1. Neon Point-in-Time Restore: restore the database to a pre-migration timestamp
2. Or: rollback the Directus version in Dockerfile
3. Run `npx directus database migrate:down` to undo the last migration

## Backup (Neon)

Neon automatically creates PITR backups. For manual backup:

```bash
pg_dump "postgresql://..." > directus-backup-$(date +%Y%m%d).sql
```

## AI/MCP access

To connect Claude Code to Directus via MCP:

1. Create a dedicated Directus user with limited permissions
2. Create a static token for API access: Admin → Settings → API Tokens
3. Configure the MCP server with the Directus URL + token
4. Default stance: read-only, no schema mutation, no system collections

**Security note:** Never grant full admin to MCP/AI users. Start read-only on specific collections only.

## R2 S3 credentials

Generate at: https://dash.cloudflare.com/84fa0d1b16ff8086dd958c468ce7fd59/r2/api-tokens

Then update secrets:
```bash
echo "YOUR_R2_ACCESS_KEY" | npx wrangler secret put STORAGE_R2_KEY
echo "YOUR_R2_SECRET_KEY" | npx wrangler secret put STORAGE_R2_SECRET
npx wrangler deploy
```
