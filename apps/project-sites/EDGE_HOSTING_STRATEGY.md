# Edge-Hosting Strategy + Dogfooded Convergence

> Researched 2026-06-17 (edge-hosting landscape + AI-native design paradigms). The thesis:
> **the frontier gap is an MCP-first full-stack edge host with per-tenant isolation baked in.**
> Cloudflare ships every primitive (Workers for Platforms · Dynamic Workflows · D1 · DO+SQLite ·
> Agents SDK · AI Gateway · MCP) but **no product assembles them into "AI editor → deploy → manage
> from Claude Code."** projectsites.dev already owns the stack + the generator + the platform MCP
> (`libs/features/platform_mcp/`). The move: become that product.

---

## PART A — Convergence re-architected around DOGFOODING (no perf-harming abstractions)

**Principle:** the platform is built, deployed, and operated *using its own primitives* — every
internal need is solved with the same surface a customer gets. Pain shows up in hours, not sprints
(finding: JetBrains/Cloudflare/Rakuten dogfooding). **Hard constraint: dogfood with the Cloudflare
primitives DIRECTLY — never add a portability/wrapper layer** (per `cloudflare-lock-in-is-leverage`).
The abstractions we adopt are the ones that *raise* performance, not lower it.

### The 6 dogfooding loops (loop picks the topmost each fire)
1. **Deploy the platform THROUGH the platform MCP.** The convergence loop's deploy step calls
   `platform_mcp deploy_site` (once wired) instead of bespoke `wrangler`/R2 scripts → every deploy
   exercises the customer deploy path. If the MCP can't deploy the platform, that's a P0 product bug.
2. **Generate projectsites.dev's own marketing site with the generator.** Eat `site-generation.ts`.
   A generator that can't produce our own homepage isn't shippable.
3. **Compose the admin from `site-kit` blocks where they fit.** The owned blocks (hero/stats/pricing/
   FAQ) render the marketing + onboarding surfaces — Storybook is the contract.
4. **Run the convergence loop as an Agent ON the platform** (Agents SDK on a DO) — dogfoods durable
   execution, per-tenant isolation, observability.
5. **Every platform capability ships as a tenant-visible feature first.** Internal-only tooling is a
   smell: if an operator needs it, a customer-developer will too (IDP thinking).
6. **The platform MCP is how WE operate the platform** — list sites, check builds, tail logs, deploy —
   from Claude Code. Our daily driver = the customer's daily driver.

### Perf-positive structural swaps the loop should make (dogfooding that SPEEDS things up)
These replace current anti-patterns with CF-native primitives — *less* abstraction, *more* speed:
- **KV-poll → per-site Durable Object actor.** Build-progress + draft state + concurrent-admin
  arbitration move to a per-site DO (SQLite-backed). Kills the 5s/60s poll loops; single-writer, zero
  cold-start. (research #5)
- **5s progress poll → AG-UI event stream.** `section_started/section_complete/image_found` stream
  into Angular signals over SSE (ADR-0007 already picks SSE). No polling, instant UI. (research #9)
- **Site-metadata lookup → D1 read-replica + Sessions API.** Every `{slug}.projectsites.dev` request
  reads the nearest replica — microsecond lookup, no extra layer. (research #4) Highest-ROI single query.
- **Per-step build → event-sourced `build_events` (D1).** Append-only `build.started → section.generated
  → publish.completed` → replay + per-step billing + eval regressions, no new infra. (research #11)
- **LLM calls → AI Gateway** (cache + rate-limit + fallback). 60-80% cost cut on repeated site-types
  (`plumber in Phoenix`), -40% P95. A firewall, not an abstraction in the hot path. (research #21)
- **WASM validation gate in the request path** for AI-generated HTML/JS before R2 publish (capability-
  deny sandbox; 45% of AI code fails security tests). <5ms, runs inline — no round-trip. (research #6/7)

### What the loop must NOT do (the constraint)
- No portability/adapter layer over Workers/D1/R2/DO (migration tax we never pay).
- No generic "hosting abstraction" interface in the request path — reach for the CF primitive directly.
- No added indirection that costs a subrequest/await on the serve path. Measure INP/p99 before+after
  every structural swap; revert anything that regresses.

---

## PART B — Top 30 ideas: a groundbreaking AI edge-hosting company (host full-stack edge apps on the projectsites stack via MCP)

Sorted by strategic leverage. Tier marks: **🚀 wedge** (do first) · **⚙️ platform** · **📈 GTM/moat**.

### The wedge — "deploy a full-stack edge app from Claude Code"
1. 🚀 **`deploy_site` / `deploy_app` MCP tool** — one call from Claude Code writes files → R2 → live URL. The headline. Owns the AI-editor → deploy acquisition loop (research #19).
2. 🚀 **`npx @projectsites/connect`** — one command wires `.mcp.json` + mints a scoped `psk_` token via device-code OAuth. Connecting must be 30 seconds, not hand-edited JSON.
3. 🚀 **Full-stack, not just sites** — accept a Worker + D1 schema + R2 assets, not only generated marketing pages. The MCP provisions the bindings. Positions as *edge app host*, not site builder.
4. 🚀 **Instant preview URLs per deploy** (`<hash>.preview.projectsites.dev`) returned in the MCP response — the agent gets a clickable link the moment it deploys. (research #15/19)
5. 🚀 **`tail_logs` / `get_traces` MCP tools** — the agent debugs its own deploy from the editor (Workers Tracing/Logpush behind the tool). Closes the generate→deploy→debug loop with zero tool-switching.

### Per-tenant isolation + the edge-app substrate
6. ⚙️ **Workers for Platforms** as the isolation core — every customer app is its own dispatch-namespace Worker with scoped KV/D1/R2 + per-customer CPU/subrequest caps. The untrusted-code moat. (research #3)
7. ⚙️ **Database-per-app, free** — a D1 (or DO-SQLite) per deployed app; GDPR-delete = drop the DB; branch a DB for preview. "Every app gets its own DB" as a default UX primitive. (research #13/14)
8. ⚙️ **Per-app Durable Object actor** — owns state, sessions, realtime, build progress; the actor model at the edge replaces poll loops. (research #5)
9. ⚙️ **Dynamic Workflows per tenant** — each app's deploy/build/cron pipeline carries its own step logic at the isolate level, zero idle cost, no monolithic workflow. (research #1/3)
10. ⚙️ **WASM hardening gate** — every deploy's generated/uploaded code is validated in a capability-deny WASM sandbox before going live (security + a11y + perf budget). The "vibe-code → production" pipeline. (research #6/7/8)
11. ⚙️ **Agent sandbox for `run_code`** — an MCP tool that executes the app's code in an isolated sandbox (CF Sandbox SDK / Firecracker-class) and returns output — test before deploy. (research #10/11)
12. ⚙️ **Scale-to-zero + cold-start-free** by construction (Workers isolates) — the cost story Vercel Fluid/Fly Sprites chase, native here. (research #4/16)
13. ⚙️ **Edge-native data tools in the MCP** — `db_query`, `db_migrate`, `kv_put`, `r2_put` as scoped tools so the agent manages data without a dashboard. The control plane IS the MCP.
14. ⚙️ **Durable cron + queues per app** (`schedule_job`, `enqueue`) exposed as MCP tools — full-stack means background jobs, not just request handlers.
15. ⚙️ **Bindings-as-a-conversation** — the agent asks "give this app a database + a bucket + an AI binding" and the MCP provisions + wires them, returning the typed env. Infra-by-intent. (research #2)

### AI-native engineering moat (vertical integration of the full loop)
16. ⚙️ **Spec-driven deploys** — the MCP accepts a Zod/intent spec; the platform generates, hardens, and grades the app against it before publish. The spec is the contract. (research #1/10)
17. ⚙️ **AG-UI streaming of build/deploy** into Claude Code AND the admin (one event stream, two consumers) — live progress, no polling. (research #9)
18. ⚙️ **Event-sourced deploys** → replay any deploy, attribute cost per step, feed eval regressions. (research #11)
19. ⚙️ **Evals + prompt-versioning as CI gates** — generated-app quality scored against a rubric (Promptfoo) before publish; KV prompt hot-patch gated by the eval. (research #12/13)
20. ⚙️ **AI Gateway in front of every model call** — semantic cache + fallback + per-token metering = the cost+quality firewall that makes margins work. (research #21)
21. ⚙️ **Contract-first everywhere (oRPC + Zod SSOT)** — `packages/shared` schemas derive the admin types, the public API, the MCP tool schemas, and `/spec.json` from one source. No drift. (research #10)
22. ⚙️ **A2A specialist handoff** in the generator (SEO→copy→image agents coordinate without polling) + CRDT merge in a DO when they co-write a draft. (research #2/16)

### Billing, trust, GTM, and the moat
23. 📈 **Usage-based metering wired to caps** — per-request accounting blocks a runaway agent *before* the bill lands (org AI budget cap). The architectural requirement for agent infra. (research #17)
24. 📈 **MCP-first marketing site** — a `/developers` page whose hero IS the `.mcp.json` snippet + a 60-second "deploy from Claude Code" video. The acquisition surface for the new market.
25. 📈 **"Made with projectsites" + agent-deployed gallery** — every agent-deployed app carries a badge → viral loop into the developer market. (PLG)
26. 📈 **Template marketplace = MCP-installable starters** — `install_template saas-starter` from Claude Code scaffolds a full-stack edge app. The generator's site-kit + worker templates become 1-call starters.
27. 📈 **MCP Server Card + registry listing** — publish to the MCP registry + a Server Card for auto-discovery so Claude Code/Cursor surface "projectsites" natively. Distribution = being in the registry. (research #18)
28. 📈 **OAuth 2.1 one-click connect** (RFC 8707 audience-bound) — "Connect projectsites" consent in the editor; the existing `mcp_oauth.ts` extends to it. Removes the paste-a-key friction for non-power users. (research #18)
29. 📈 **Dogfooded credibility** — "this entire platform (site + admin + deploys) is built, hosted, and operated through its own MCP + generator." The story IS the proof. (Part A)
30. 📈 **The assembled-primitives moat** — own the *full loop* with zero handoffs: intent → generate → WASM-harden → deploy (Workers for Platforms) → preview → eval → observe → prompt-patch, all driveable from Claude Code. Each handoff a competitor needs is a churn point we don't have. (research #20/22)

---

> Build order (feeds ROADMAP TIER 0): wire `deploy_site` (#1) → `npx connect` (#2) → preview URLs (#4)
> → `tail_logs` (#5) → Workers-for-Platforms isolation (#6) → DB-per-app (#7). Ship the wedge, then the substrate.
