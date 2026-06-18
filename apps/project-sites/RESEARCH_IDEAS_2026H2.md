# 30 Research-Grounded Ideas — projectsites.dev (2026 H2)

> Synthesized from heavy web research (2026): the MCP ecosystem, AI app-builders (Bolt/Lovable/v0/Replit), edge-hosting, agent commerce, and dev GTM. Each idea is specific to our live stack (CF Workers/D1/R2/DO/Workflows/Sandbox SDK + the now-live platform MCP + OAuth 2.1 provider + the generator). The MCP wedge already shipped — these are the next frontier. Tag: 🚀 wedge-extend · ⚙️ substrate · 🔒 trust · 💰 money · 📈 GTM · ✨ UX.

## A. The MCP-native moat — own builder + host + MCP (nobody else does)

1. **🚀 Per-site MCP server** — every generated site exposes ITS OWN D1 tables / R2 assets / KV config as scoped MCP tools, so any agent (Claude/Cursor/Windsurf) reads+writes the site's data with no REST API. Builder.io Fusion does workspace-MCP; no one owns *generation + hosting + MCP* together. Reuses `mcp_site.ts`. The single biggest differentiator.
2. **🚀 Stateless MCP (2026-07-28 spec)** — adopt the session-less RC (no `initialize` handshake, client metadata in `_meta` per request) → round-robin-able across PoPs with zero session store. Market "instant edge MCP, zero config." CF Workers are the native fit.
3. **🚀 MCP Apps (sandboxed-iframe tool UIs)** — a deploy ships a Worker + an iframe tool-UI in one push; every app becomes a visual tool agents AND humans use (declared ahead-of-time so hosts prefetch/security-review). New in the 2026-07-28 spec.
4. **⚙️ Dual discovery: MCP + A2A** — expose every deployed Worker as both an MCP server and a Signed-Agent-Card A2A endpoint. One deploy, two protocols (vertical agent↔tools + horizontal agent↔agent), full ecosystem reach. A2A v1.0 (Linux Foundation, 150+ orgs).
5. **⚙️ Server-side agent jobs** — a "long-running agent job" primitive on Workflows+DO exposing a Tasks-compliant `tasks/get` poll API behind MCP (SEP-1577 sampling-with-tools). Sell managed agentic compute behind an edge MCP endpoint.
6. **⚙️ Hosted elicitation broker** — when an agent needs a credential we don't hold, return a short-lived URL (CF Worker page) that completes OAuth/payment in the user's real browser and vaults the result to Workers Secrets. Agents never stall on a human (URL-mode elicitation, SEP-1036).

## B. Edge-app substrate — full-stack apps, not just sites

7. **⚙️ `run_code` MCP tool via Cloudflare Sandbox SDK** — agents submit code → Worker sandboxes it ($0.00002/vCPU-s, billed per 10ms) → output streams back via `tools/call`. Zero escape surface, one billing line. Closes generate→**test**→deploy in the editor.
8. **⚙️ Database-per-app, free** — a D1 (or DO-SQLite) per deployed app; GDPR-delete = drop the DB; branch-a-DB for preview envs. Replit Agent 4 added built-in PG + checkpoint rollback — we can default it.
9. **⚙️ `db_query` / `kv_put` / `r2_put` data MCP tools** — scoped, org-isolated, so an agent manages app data from the editor with no dashboard. The control plane IS the MCP.
10. **✨ "Seed DB from AI"** — user describes a schema in a prompt → we generate the D1 migration + seed realistic demo rows. Kills the "blank database paralysis" that stalls MVPs.
11. **⚙️ Bindings-as-conversation** — "give this app a database + a bucket + an AI binding" → the MCP provisions + wires them and returns the typed env. Infra-by-intent.
12. **🔒 WASM/sandbox hardening gate on every deploy** — generated/uploaded code validated in a capability-deny sandbox (security + a11y + perf budget) before going live. The "vibe-code → production" pipeline.

## C. Security & production-readiness — the #1 unsolved gap, a real moat

> 91.5% of vibe-coded apps ship ≥1 vuln (Q1 2026); AI code = 2.74× human vuln rate; Lovable CVE-2025-48757 (CVSS 8.26): 170 apps with RLS off + `anon_key` embedded client-side + full table dumps. 16/18 CTOs reported AI-codegen prod disasters. No builder addresses this.

13. **🔒 "Production Readiness Score"** — a gate before any site goes live: auth-on-data check, rate-limit presence, secret scan, error-boundary check, SSRF check. Visible dashboard widget with a letter grade.
14. **🔒 "Security Posture" panel per site** — auto-scan for hardcoded secrets, unauthenticated data endpoints, public-readable storage, SSRF-vulnerable URL inputs, missing CSRF — the FIRST thing an owner sees post-generate.
15. **🔒 No-client-secrets guarantee** — the generator never embeds keys client-side (Lovable's exact failure); secrets → Workers Secrets, server-only. A build gate fails on any secret in the client bundle.
16. **🔒 AI-code provenance + adversarial diff review** — every AI-generated change gets a security-reviewer pass; risky diffs flagged before deploy (we already run this pattern in-house — productize it for generated apps).
17. **🔒 Trust center + status page** — `status.projectsites.dev` (free CF status page) + a `/trust` route (uptime SLA, edge data residency, SOC 2 roadmap). ~$0 today; signals enterprise-readiness and shortens security reviews.

## D. Agent commerce & monetization

> x402 (HTTP 402 + USDC on Base, ~$0.011/call, sub-2s; CF native support) + Stripe Machine Payments Protocol (Mar 18 2026, session spend-cap + bulk settle). Apify pays creators 80%. Per-call MCP billing is infrastructure now, not a roadmap item.

18. **💰 `paidTool()` — dual rails** — platform-level metering so a dev marks an MCP tool paid and we bill via **x402** (per-call micro-billing) OR **Stripe MPP** (session cap). Devs never touch payment infra; we take a cut.
19. **💰 Per-generation + per-served-request metering** — an agent deploying sites = metered revenue with zero human checkout friction (Stripe MPP).
20. **💰 "Site credit" pricing, not token** — credits per generated page/section + an AI-budget meter per site. Flat/predictable beats token sticker-shock (Replit $100-300/mo heavy-user churn; Tempo's flat-rate is cited as its stickiness driver). Hybrid: free (1 site, shared domain) → $29 base (custom domain + 5 sites) → credit overage.
21. **📈 Creator revenue share** — template/MCP-app authors earn ~80% per install/use (Apify model); a marketplace where the best starters earn, pulling in builders.
22. **💰 Agent-usage PQL** — agents hammering the generate endpoint with no billing record = upgrade candidate. PostHog PQL events (`site_generated`, `custom_domain_added`, `third_deploy`) → in-app upgrade prompt. PQL frameworks = 3× conversion vs MQL.

## E. Distribution / GTM / PLG

> MCP SDK hit 97M downloads/mo (early 2026). Cursor → $2B ARR on instant activation + zero gates. Vercel → $200M ARR on templates + Deploy buttons + fork-embedded attribution. AI-referred traffic converts 4-5× and spends 68% longer.

23. **📈 List in every MCP registry day-one** + build a **downstream aggregator** with verified security scans, SLA badges, usage stats, ratings — the official registry deliberately defers curation/trust to aggregators. The slug is the install handle.
24. **📈 `/llms.txt` + `/llms-full.txt`** — agent-discoverable API reference + MCP tool schemas + starter templates. Matters for Cursor/Claude Code real-time doc retrieval (cuts agent token waste), not search bots — but real value for our exact audience.
25. **📈 5 "Deploy to projectsites.dev" starter templates** with one-click GitHub-README buttons (SaaS landing, local biz, nonprofit, portfolio, restaurant); every deployed site carries a "Hosted on projectsites.dev" footer badge → viral loop. Vercel's #1 top-of-funnel.
26. **📈 `npx @projectsites/create <template>`** — one command scaffolds a full-stack edge app + wires the MCP; sub-60-second first deploy, zero auth gate (Cursor's activation playbook). Extends the shipped `psctl connect`.
27. **📈 GEO-optimized docs** — H2s phrased as developer questions ("How do I deploy to Cloudflare in 60 seconds?") + FAQPage JSON-LD per doc page. AI-search is now a primary acquisition channel for dev infra.

## F. AI-native generation UX

28. **✨ "Design Intent" pre-step** — before generation, the user picks tone/density/palette/hero → we generate a mood-board + user-flow diagram for approval BEFORE touching code. Prevents the regenerate-8×-burning-tokens loop (Tempo's architecture-first approach; v0 Design Mode).
29. **✨ "Hand off to engineer" export** — one-click GitHub repo with full Worker source + D1 schema + `wrangler.toml` + a generated `HANDOFF.md` (what was built, secrets needed, next steps). Makes us the START not the end, and turns every handoff into a referral (the universal "graduate to Cursor" workflow; Lovable's GitHub sync is why it survives it).
30. **✨ "PWA upgrade" button per site** — auto manifest + Workbox sw.js + offline.html + A2HS prompt + iOS splash from the same generation pipeline. Zero-friction mobile; a0.dev proved the mobile gap and no web-first builder competes there.

---

### Top 6 to ship first (highest leverage × lowest risk, all on our live stack)
- **#1 Per-site MCP server** (the moat; reuses mcp_site.ts) · **#13 Production Readiness Score** (the category's #1 gap) · **#25 Deploy buttons + "Hosted on" badge** (viral, cheap) · **#7 `run_code` Sandbox tool** (completes the editor loop) · **#24 llms.txt** (agent-discoverable, ~1h) · **#17 Trust center + status page** (~$0, enterprise signal).
</content>
