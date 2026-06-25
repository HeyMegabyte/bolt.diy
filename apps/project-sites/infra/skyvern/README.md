# browser.projectsites.dev — Skyvern on CF Workers Containers

LLM browser-automation agent (drives a real headless browser to complete web tasks).
Mirrors `infra/listmonk` + `infra/litellm`. Heavy image (bundled Chromium) → standard-4;
Postgres → Neon; an LLM key powers the agent. AGPL-3.0 — internal/admin use.

## Deploy (from this dir) — proven container playbook
1. `npm install`
2. Neon DB — `CREATE DATABASE projectsites_skyvern;` in the SHARED Neon project
   (`jolly-pine-24431114`, per neon-database-conservation — NOT a new project); grab the
   connection string for `DATABASE_STRING`.
3. Secrets — `wrangler secret put` for: `DATABASE_STRING`, `OPENAI_API_KEY` and/or
   `ANTHROPIC_API_KEY`, `SKYVERN_API_KEY` (`openssl rand -hex 24`).
4. Cutover routing — add an EXPLICIT Workers route `browser.projectsites.dev/*` →
   `projectsites-skyvern` (beats the wildcard) AND remove `browser` from the main worker's
   `system_service_landing` map (so the status page stops answering) + redeploy main worker.
5. WAF — broaden the existing skip rule (`9c8324ff…`, zone `9ceaa211…`) to include
   `browser.projectsites.dev`.
6. `WRANGLER_DOCKER_BIN=/usr/local/bin/docker npx wrangler deploy` (Docker + global CF key).
7. Verify — `curl https://browser.projectsites.dev/heartbeat` (or the Skyvern health path)
   → 200; first boot is slow (~2-3 min, Chromium) so the port-ready window is 180s.

## Gotchas (learned from the Inngest/Listmonk/LiteLLM arc)
- Container DO → `new_sqlite_classes` (NOT `new_classes`; CF API error 10074).
- `@cloudflare/containers` ^0.3.3 → object-form `startAndWaitForPorts({ports, cancellationOptions})`.
- Self-hosted apps need their host in the WAF skip rule (5-rule phase cap → broaden, don't add).
- Verify the exact Skyvern health/API path against the running container (`/heartbeat`,
  `/api/v1/...`) — the root `/` may be the UI or a redirect.
