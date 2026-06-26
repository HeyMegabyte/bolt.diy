# jobs.projectsites.dev — Hatchet on CF Workers Containers

Distributed task queue/orchestration. Brian 2026-06-25: jobs. → Hatchet INSTEAD of
Inngest (events. stays Inngest). hatchet-lite = single container (port 8888), Postgres → Neon.

## Deploy (proven container playbook)
1. `npm install`
2. Neon DB `projectsites_hatchet` in the SHARED project (neon-database-conservation).
3. **Generate encryption keysets** (Hatchet's one extra step vs the others):
   `docker run --rm ghcr.io/hatchet-dev/hatchet/hatchet-admin:latest /hatchet-admin keyset create-local-keys`
   → prints MASTER + JWT_PUBLIC + JWT_PRIVATE base64 keysets. Set each as a secret.
4. Secrets: `DATABASE_URL` (Neon `postgresql://...?sslmode=require`),
   `SERVER_AUTH_COOKIE_SECRETS` (`"$(openssl rand -hex 16),$(openssl rand -hex 16)"`),
   `SERVER_ENCRYPTION_MASTER_KEYSET`/`_JWT_PUBLIC_KEYSET`/`_JWT_PRIVATE_KEYSET`,
   `SERVER_DEFAULT_ADMIN_EMAIL`/`_PASSWORD`.
5. Explicit route `jobs.projectsites.dev/*` → `projectsites-hatchet` + WAF skip host.
6. Detach jobs. from Inngest: in `src/inngest/serve.ts`, change `isInngestServerHost` to
   match ONLY `events.${DOMAINS.SITES_BASE}` (drop the `jobs.` clause) + redeploy main worker.
7. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy`; verify `/` 200 (dashboard).

## Gotchas (Inngest/Skyvern/Langfuse arc)
- Container DO → `new_sqlite_classes`. `@cloudflare/containers` ^0.3.3 → object-form start.
- Hatchet needs the 3 encryption keysets (step 3) — the one extra step vs the others.
- Run the image locally first (`docker run -e DATABASE_URL=... ... hatchet-lite`) to read the
  boot/migration output (the repro technique that cracked Inngest + Skyvern).
