# mail.projectsites.dev — Listmonk on CF Workers Containers

Listmonk (newsletter/list manager) hosted as a Cloudflare Workers Container.
Adapted from `njsk.org/infra/listmonk`. Stateless container (port 9000) backed by
Neon Postgres; mail relays through Amazon SES (ADR-0019).

## Deploy (from this dir)
1. **Neon DB** — create a `projectsites_listmonk` database + role (via Neon MCP/console).
2. **Secrets** — `npm install`, then `wrangler secret put` for: `PG_HOST PG_USER PG_PASSWORD PG_DATABASE ADMIN_USER ADMIN_PASSWORD` (+ `SES_SMTP_HOST/USER/PASSWORD` for sending). `ADMIN_PASSWORD` = `openssl rand -base64 24`.
3. **Deploy** — `wrangler deploy` (builds the Dockerfile image — needs Docker locally OR push to CI). Creates the `mail.projectsites.dev` custom-domain route.
4. **Verify** — `curl https://mail.projectsites.dev/` → Listmonk login (200); first boot runs `--install` against Neon.

## Launch from Admin → Apps
A catalog entry points the Apps section's "Listmonk" tile at `https://mail.projectsites.dev`.
