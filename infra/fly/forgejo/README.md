# Forgejo — ProjectSites.dev Git Forge

**URL:** https://git.projectsites.dev
**Alias:** https://forgejo.projectsites.dev
**Host:** Fly.io (`projectsites-forgejo`)
**Region:** iad (Ashburn, VA)
**Database:** SQLite on persistent Fly volume (`/data/gitea/gitea.db`)
**Admin:** `professormanhattan` / `hey@megabyte.space`

## Architecture

```
git.projectsites.dev (DNS, grey-cloud)
    └─ CNAME → projectsites-forgejo.fly.dev
                  └─ Fly.io proxy → Machine (iad) :3000
                                      └─ Forgejo 10 (SQLite, /data volume)
```

Cloudflare DNS resolves directly to Fly.io (no proxying). The `*.projectsites.dev/*` Worker route would intercept proxied traffic, so DNS proxies are disabled for git subdomain.

## Hosting Decision

**Fly.io with persistent volume** was chosen because:
- Cloudflare Containers have ephemeral disk → unsafe for Git repositories
- Fly.io provides persistent, encrypted volumes with snapshot support
- Forgejo stores repos, config, SSH keys, and SQLite on `/data`

**Neon Postgres** was configured but deferred. Forgejo on Fly with Postgres had startup issues. SQLite on the persistent volume is the current working setup. Postgres migration is a follow-up optimization.

## Known Limitation

**Forgejo post-install restart breaks Fly proxy connectivity.** After completing the web installation, the Forgejo process restarts, and Fly's proxy sometimes fails to re-establish the health check. If the login page becomes inaccessible:

```bash
# Restart the machine
flyctl machine restart <machine-id> --app projectsites-forgejo --force

# Or redeploy (creates new machine with existing volume)
flyctl deploy --config infra/fly/forgejo/fly.toml --app projectsites-forgejo
```

The data persists on the volume across machine restarts and redeploys.

## Secrets

Set via Fly secrets:

```bash
flyctl secrets set \
  FORGEJO__security__SECRET_KEY="$(openssl rand -hex 64)" \
  FORGEJO__security__INTERNAL_TOKEN="$(openssl rand -hex 64)" \
  FORGEJO__oauth2__JWT_SECRET="$(openssl rand -hex 43)" \
  FORGEJO__lfs__JWT_SECRET="$(openssl rand -hex 43)" \
  --app projectsites-forgejo
```

## Deploy

```bash
# First deploy
flyctl volumes create forgejo_data --size 20 --region iad --app projectsites-forgejo --yes
flyctl deploy --config infra/fly/forgejo/fly.toml --app projectsites-forgejo

# Complete installation via browser at https://projectsites-forgejo.fly.dev/
# Or via curl (INSTALL_LOCK=false required in fly.toml)
```

## DNS

```bash
# Cloudflare (grey-cloud — no proxying)
git.projectsites.dev      CNAME → projectsites-forgejo.fly.dev
forgejo.projectsites.dev  CNAME → projectsites-forgejo.fly.dev

# Fly certificates
flyctl certs create git.projectsites.dev --app projectsites-forgejo
flyctl certs create forgejo.projectsites.dev --app projectsites-forgejo
```

## Backup

Automated daily backup script: `scripts/backup-forgejo.sh`

```bash
# Run manually
./scripts/backup-forgejo.sh

# Schedule via cron (daily at 3am)
# 0 3 * * * cd ~/emdash/repositories/projectsites.dev && ./scripts/backup-forgejo.sh

# Output: ./backups/forgejo-YYYY-MM-DD-HHMMSS.zip
# R2 target: r2://projectsites-backups/forgejo/YYYY-MM-DD/
```

The backup script:
1. Runs `forgejo dump` inside the Fly machine (DB + config + repos)
2. Downloads the dump locally
3. Uploads to R2 (if AWS CLI or wrangler configured)
4. Prunes local backups older than 7 days

## Restore

```bash
# 1. Deploy fresh app with clean volume
# 2. Upload dump to new machine
# 3. Restore via CLI
flyctl ssh console --app projectsites-forgejo -C "su - git -c '/app/gitea/gitea restore --config /data/gitea/conf/app.ini -w /data/gitea --file /data/forgejo-dump-*.zip'"
```

## Upgrade

```bash
# Update image tag in fly.toml
# [build] image = "codeberg.org/forgejo/forgejo:<new-version>"
flyctl deploy --config infra/fly/forgejo/fly.toml --app projectsites-forgejo
```

## Deprovision

```bash
flyctl apps destroy projectsites-forgejo --yes
# Delete Cloudflare DNS records for git and forgejo subdomains
```

## Admin

- **URL:** https://git.projectsites.dev/user/login
- **Username:** professormanhattan
- **Password:** Auto-generated and stored at `/tmp/forgejo-admin-creds.txt` — move to `get-secret FORGEJO_ADMIN_PASSWORD`
- **Email:** hey@megabyte.space

## Next Improvements

1. **Neon Postgres migration** — Move from SQLite to Postgres for durability
2. **R2 object storage** — Configure S3-compatible storage for LFS, attachments, avatars
3. **Fly proxy fix** — Investigate and fix the post-install Fly proxy disconnect
4. **Cloudflare proxying** — Re-enable Cloudflare proxy once Worker route exception is added
5. **OIDC integration** — Add Logto OIDC SSO login
6. **Actions runner** — Deploy separate Forgejo Actions runner
7. **Redis cache** — Add Upstash Redis for cache/session/queue
