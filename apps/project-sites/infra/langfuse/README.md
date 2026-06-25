# traces.projectsites.dev — Langfuse v2 on CF Workers Containers

LLM observability/tracing. Single Next.js container (port 3000), Postgres → Neon.
Use the **v2** line (`langfuse/langfuse:2`) — v3 needs ClickHouse+Redis+S3 (excluded).
Mirrors infra/listmonk + infra/skyvern. Deployed live 2026-06-25.

## Deploy (proven playbook)
1. `npm install`
2. Neon DB `projectsites_langfuse` in the SHARED project (neon-database-conservation).
3. Secrets: `DATABASE_URL` (standard `postgresql://...?sslmode=require` — Prisma, NOT asyncpg),
   `NEXTAUTH_SECRET` (`openssl rand -base64 32`), `SALT` (same), `ENCRYPTION_KEY` (`openssl rand -hex 32`).
4. Explicit route `traces.projectsites.dev/*` → `projectsites-langfuse` + WAF skip host.
5. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy`.
6. Verify `/api/public/health` 200 + `/` 200 (Langfuse serves a UI at root — no rewrite needed).

## Gotchas
- Container DO → `new_sqlite_classes`. `@cloudflare/containers` ^0.3.3 → object-form start.
- Langfuse is Node/Prisma → STANDARD `postgresql://` URL (NOT asyncpg, unlike Skyvern).
- First boot runs `prisma migrate deploy` (slow, ~30-60s) then binds :3000.
