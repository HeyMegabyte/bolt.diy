# Checkmate Runbook — monitor.projectsites.dev

## Hosting

| Aspect | Detail |
|--------|--------|
| Platform | **Fly.io** (app: `projectsites-checkmate`, region: `iad`) |
| Domain | `monitor.projectsites.dev` |
| DNS | Cloudflare (zone `9ceaa211750dd31899fd5fd1bf8d1ec46`, **proxied**) |
| TLS | Terminated at Fly.io, Cloudflare proxy |
| MongoDB | Fly persistent volume `checkmate_mongo_data` (1 GB, `/data/db`) |
| Backend | Node.js Express on `127.0.0.1:52345` |
| Frontend | nginx + React SPA on port `80` |
| Process mgmt | supervisord (mongod → checkmate-server → nginx) |
| Queue | In-process (QUEUE_MODE=primary, no external Redis) |

## Why not Cloudflare-only?

- Checkmate requires **MongoDB** for persistent data storage.
- Cloudflare Workers Containers have **ephemeral disks** — MongoDB data would be lost on restart.
- Cloudflare D1 is SQLite, not a MongoDB-compatible document store.
- The app would require an invasive rewrite to use D1 or another CF-native store.
- **Fly.io with a persistent volume** provides durable MongoDB storage while keeping
  Cloudflare as the DNS/WAF/proxy front door — the best practical architecture.

## Quick Commands

```bash
# Deploy
cd apps/project-sites/infra/checkmate
bash scripts/deploy.sh

# Smoke test
CHECKMATE_URL=https://monitor.projectsites.dev bash scripts/smoke.sh

# View logs
flyctl logs --app projectsites-checkmate

# SSH into machine
flyctl ssh console --app projectsites-checkmate

# Restart services
flyctl ssh console --app projectsites-checkmate --command "supervisorctl restart all"

# Check MongoDB
flyctl ssh console --app projectsites-checkmate --command \
  "mongosh --eval 'db.adminCommand(\"ping\")' --quiet"

# Backup MongoDB
bash scripts/backup-mongo.sh --r2

# Restore MongoDB
bash scripts/restore-mongo.sh /tmp/checkmate-backups/checkmate-mongo-<timestamp>.gz

# Set a secret
flyctl secrets set KEY=VALUE --app projectsites-checkmate

# List secrets
flyctl secrets list --app projectsites-checkmate

# Scale up (if needed)
flyctl scale vm shared-cpu-2x --app projectsites-checkmate
```

## Monitoring the Monitor

Checkmate monitors itself via:
1. **Fly.io health checks** — HTTP GET `/health` every 15s
2. **Cloudflare analytics** — DNS + proxy metrics
3. **Self-monitor** — After admin setup, add `https://monitor.projectsites.dev` as a
   Checkmate HTTP monitor so the monitoring plane watches itself.

## Rollback

```bash
# List previous Fly releases
flyctl releases --app projectsites-checkmate

# Rollback to previous version
flyctl releases rollback --app projectsites-checkmate

# If MongoDB was corrupted, restore from backup
bash scripts/restore-mongo.sh <backup-file.gz>
```

## Backup / Restore

### Automated backup (recommended: cron)

```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * cd /path/to/infra/checkmate && bash scripts/backup-mongo.sh --r2
```

### Manual backup

```bash
bash scripts/backup-mongo.sh --r2
```

Backups are stored:
- Locally: `/tmp/checkmate-backups/checkmate-mongo-<timestamp>.gz`
- Cloud: R2 bucket `checkmate-backups/`

### Restore

```bash
bash scripts/restore-mongo.sh /tmp/checkmate-backups/checkmate-mongo-20260630-020000.gz
# Follow the prompt to confirm.
```

RPO target: 24 hours (daily backups)
RTO target: <15 minutes (restore + restart)

### Quarterly restore drill

1. Create a disposable Fly app: `flyctl apps create checkmate-drill`
2. Restore the latest backup to it
3. Smoke test the drill app
4. Delete the drill app
5. Log the drill result

## Secrets

All secrets are managed via `flyctl secrets`. Current secret list:

| Secret | Purpose | Rotation |
|--------|---------|----------|
| JWT_SECRET | Session token signing | Quarterly |
| (SMTP creds) | Email notifications | When provisioned |

## Incident Response

### App is down (health check failing)

1. Check Fly status: `flyctl status --app projectsites-checkmate`
2. Check logs: `flyctl logs --app projectsites-checkmate --since 5m`
3. SSH in: `flyctl ssh console --app projectsites-checkmate`
4. Check supervisor: `supervisorctl status`
5. Check MongoDB: `mongosh --eval 'db.adminCommand("ping")'`
6. Check disk: `df -h /data/db`
7. Restart all: `supervisorctl restart all`
8. If disk full: expand volume `flyctl volumes extend checkmate_mongo_data --size 3`

### MongoDB disk full

```bash
# Check usage
flyctl ssh console --app projectsites-checkmate --command "du -sh /data/db"

# Expand volume (1 GB → 3 GB)
flyctl volumes extend checkmate_mongo_data --app projectsites-checkmate --size 3

# Clean old metrics data if needed (inside mongosh)
mongosh --eval 'use uptime_db; db.checks.deleteMany({createdDate: {$lt: new Date(Date.now()-90*86400000)}})'
```

### DNS not resolving

```bash
# Check Cloudflare DNS record
curl -s -H "X-Auth-Email: blzalewski@gmail.com" \
  -H "X-Auth-Key: $(get-secret CLOUDFLARE_API_KEY)" \
  "https://api.cloudflare.com/client/v4/zones/9ceaa211750dd31899fd5fd1bf8d1ec46/dns_records?name=monitor.projectsites.dev" \
  | jq '.result[0] | {name, type, content, proxied}'

# Verify the IP matches Fly
flyctl ips list --app projectsites-checkmate
```

### Full recovery from scratch

1. `flyctl apps create projectsites-checkmate`
2. `flyctl volumes create checkmate_mongo_data --app projectsites-checkmate --region iad --size 1`
3. `bash scripts/deploy.sh`
4. `bash scripts/restore-mongo.sh <latest-backup.gz>`
5. Verify: `bash scripts/smoke.sh`
