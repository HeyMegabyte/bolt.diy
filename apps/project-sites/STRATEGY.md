# Strategy — Agent-native positioning + Edge-hosting thesis

> Consolidated (folded from AGENT_NATIVE_POSITIONING.md + EDGE_HOSTING_STRATEGY.md, 2026-06-27).
> Actionable items flow to ROADMAP.md; this is the durable positioning + thesis reference.

---

# Agent-native positioning

# Agent-Native Positioning & Requirements

> Canonical positioning + the agent-grade feature backlog for projectsites.dev.
> Authored 2026-06-17. Pricing model + curated ideas integrated from the AI-native
> positioning pass. Actionable items flow into `ROADMAP.md`; this file is the WHY +
> the full idea catalog. Statuses live in `FEATURE_CATALOG.md`.

---

## 1. Positioning — we deliver premium sites, we don't host toys

**Old way:** a small business pays an agency **$5,000 up front + $100/month** for hosting,
then waits weeks and still gets a static brochure nobody maintains.

**Our way:** the site arrives **pre-built** by AI — researched, designed, SEO'd, deployed,
SSL'd — and the owner pays **$50/month**, which includes a wallet of build/AI credits and
an agent that keeps it alive. Same outcome the $5,000 agency promised, a tenth of the
ongoing cost, none of the wait.

- **Do NOT frame this as "free hosting."** It is a premium, pre-built, AI-maintained
  property. The free tier is a genuine taste of that value, not the product.
- **Do NOT undersell.** The anchor is the $5,000 + $100/mo agency, not a $0 static host.
  Lead with the delivered outcome and the credit-included wallet, never with "free."
- **The agent angle is the moat, not the price.** We are the site host an AI agent can
  fully drive — build, deploy, edit, measure — via MCP + OAuth + a typed API. No premium
  host is agent-native; no agent-native tool is a real host. We own that intersection.

### One-liners (own the sentence)

- "The website your AI agent builds, deploys, and keeps alive — $50/month."
- "Agency-grade sites, delivered by AI, maintained by your agent."
- "Not another builder humans babysit. The host agents reach for."

## 2. Pricing model (canonical — supersedes the old "5 sites for $50")

- **Free tier — real value, deliberately bounded.** 1 live site on a `*.projectsites.dev`
  subdomain, AI-built, SSL'd. **No custom domain** (`ENTITLEMENTS.free.maxCustomDomains = 0`).
  A small monthly credit float for light edits. Top bar shown. This is the demo that sells
  the paid tier — complete enough to be useful, bounded enough to convert.
- **Paid — $50/month per site, minimum.** Each active site is its own $50/mo subscription
  (not "5 for $50"). $50 **includes a monthly credit allotment** (`monthly_credit_cents = 5000`)
  that funds builds, AI edits, research crawls, and standard media.
- **Credits + wallet (MUST exist — this is how Brian gets paid).** Advanced/expensive
  actions — **video generation (Sora/Veo), DALL·E batches, ElevenLabs/TTS podcasts,
  full rebuilds, container minutes** — debit the org wallet. Wallet auto-tops-up from the
  stored card when the balance drops below threshold (`auto_topup_*` already in
  `wallet_accounts`). Overage is metered, itemized, predictable.
- **Custom domain is paid-only.** It is an upgrade trigger, not a free-tier line item.
- **No undersell:** the comparison framing is always "$5,000 + $100/mo agency" and "40
  hours/yr of dev time you don't spend," never "cheaper than a free host."

> Implementation spine already in code: `services/wallet.ts` (chargeWallet / creditWallet /
> topUpWallet / auto-topup / Stripe webhook dispatch) + `migrations/0036_wallet_billing.sql`
> (`wallet_accounts`, `wallet_transactions`, `cost_categories`). The gap is **wiring
> `chargeWallet()` to the expensive actions** and **turning the budget killswitch ON**
> (`token_burn_meter` / `org_ai_budget_cap` flag is OFF today → unlimited free spend).

## 3. How `claimyour.site` (Dub.co) becomes the MCP install front door

`claimyour.site` is our Dub.co-managed short-link domain (`DOMAINS.CLAIM_BASE`). MCP servers
aren't installed by a plain link-click the way a browser extension is — but a Dub link is the
perfect **trackable, branded, device-aware front door** to the install flow:

- **`claimyour.site/mcp`** (a Dub link) detects the client and routes:
  - **Cursor / VS Code** → redirect to the editor's native MCP deep-link
    (`cursor://anysphere.cursor-deeplink/mcp/install?name=projectsites&config=<base64>` /
    `vscode:mcp/install?...`) → genuine one-click "Add to editor."
  - **Claude Code** (no URL deep-link) → land on a tiny page with the copy-paste
    `claude mcp add --transport http projectsites https://mcp.projectsites.dev` + an
    **OAuth 2.1 "Connect" button** that provisions the free org on first connect.
- **The remote MCP server lives at a real host** (e.g. `mcp.projectsites.dev`) behind OAuth
  2.1 + Resource Indicators. `claimyour.site` is the marketing/onboarding shortlink in front
  of it — never the server itself.
- **Dub gives us the funnel for free:** per-channel click attribution, QR codes (printable
  "scan to add projectsites to your AI editor" for talks/stickers), and A/B-able landing
  variants. Every install attempt is measured.

## 4. Curated AI-native ideas — integrated (corrections applied)

From the positioning pass. **Skipped per direction: #7 (auto-signup-on-connect as the only
path), #13 (white-label connect — deferred), #21 (AI maintenance as the price story — the
price story is the $5k anchor, not maintenance), #26 (free-site-is-complete — no; $50/mo per
site is the floor).** "Free host" framing dropped everywhere.

- **Category:** "agent-native hosting" — plant the flag, define the rubric (MCP + OAuth +
  API + AI-build + credit wallet). Lead with the verb ("deploy from your editor"), not
  "AI website builder."
- **MCP front door:** publish to the MCP Registry (`registry.modelcontextprotocol.io`);
  `claimyour.site/mcp` one-click install (§3); expose every dashboard action as an MCP tool;
  sites readable AND writable as MCP resources; OAuth 2.1 + audience-bound tokens as a trust
  badge.
- **Integrations as moat:** generated sites arrive pre-wired to the owner's real tools via
  the existing MCP-OAuth layer (Mailchimp/Stripe/HubSpot/GitHub/Slack/Notion/Linear/Discord/
  Calendar/Calendly); paste-key fallback framed as "every integration works day one";
  managed token refresh so agent deploys never 401.
- **Non-MCP agents:** public REST + RPC API documented with Redocly/OpenAPI; idempotency
  keys + structured envelopes on every mutation; `/api/llms` + `llms.txt` that teaches an
  agent to build & deploy here; API access included in paid (not a separate paywall).
- **Every site is an agent surface:** each published site exposes its own scoped MCP endpoint
  so the owner's agent edits copy / swaps images / reads form submissions post-launch;
  sites ship GEO/AEO-optimized (FAQPage schema = highest AI-citation rate) so they are born
  *citable*.
- **Pricing clarity + distribution:** one-line "$5k+$100/mo → $50/mo, credits included"
  comparison; be the deploy target in agent tutorials; get listed in every "best MCP servers"
  roundup; template marketplace addressable as MCP resources; publish the machine-verifiable
  trust dossier AI buyers screen for.

## 5. The 30 above-and-beyond agent-grade features

The premium, principal-engineer-grade capabilities that prove "$50/mo, not a toy" and that
no competitor ships. These are the moat. (Build behind flags per feature-module rules.)

### Trust, security & provenance
1. **Scoped, expiring `psk_` keys** — per-tool capability scopes (deploy-only / read-only /
   edit-copy-only), short TTL. Least-privilege per MCP spec; an injected agent can't exceed
   its grant.
2. **Signed deploy receipts** — every deploy returns a verifiable receipt
   (content hash + version id + signer + timestamp) the agent logs as proof.
3. **Audience-bound tokens (RFC 8707)** — a token minted for site A physically cannot touch
   site B. Confused-deputy-proof; the enterprise screening checkbox.
4. **C2PA-style "built-by" provenance manifest** on each site — cryptographic proof of the
   AI build chain. Trust + AEO signal.
5. **Per-site immutable audit log as an MCP resource** — SOC-style, queryable
   (`get_audit_log` already exists); every agent action attributable.
6. **Content-safety gate (Llama Guard) on agent-submitted content** before publish —
   protects the brand from prompt-injected or off-policy text.
7. **Per-site secrets vault via OAuth-scoped MCP** (AES-GCM, `ai_env_vars` exists) — agents
   store/read integration creds without ever seeing plaintext.
8. **Tool-call replay log** — every agent action replayable + exportable for debugging and
   dispute resolution.

### Reliability & safe mutation
9. **Dry-run on every mutating tool** (`dryRun: true`) — agent previews the exact diff
   before it commits. Safe-by-default.
10. **Idempotency keys on every deploy/edit** — retries never double-publish.
11. **Optimistic concurrency** (`deploy_if_unchanged_since`) — two agents can't silently
    clobber each other's edits.
12. **Instant rollback as a tool** (`rollback_site` to any prior R2 version) — agent
    self-heals a bad deploy without a human.
13. **Preview-then-promote** — agent publishes to a staging subdomain, gets a URL, promotes
    only on approval. No blind prod writes.
14. **Quota-aware backpressure** — when credits run low, tools return a structured
    `insufficient_credits` with a top-up deep-link the agent surfaces to its human.
15. **Time-travel diff** — "what did this site look like 3 versions ago" as a resource
    (D1 Time Travel + R2 versioning).

### Agent ergonomics & self-description
16. **Runtime schema introspection** — agent reads the exact JSON schema of every tool's
    input/output at runtime. Self-documenting API.
17. **Capability discovery** — agent asks "what can I do with this site?" and gets the live
    tool list + the org's entitlements/credit balance.
18. **Structured Problem-Details (RFC 7807) on every tool + API error** — agents parse and
    recover; never handed a prose blob.
19. **Budget/quota headers on every response** — remaining credits + rate limit in-band, so
    the agent plans instead of failing.
20. **"Explain this site" tool** — agent gets an AI-generated structured summary of the
    site's IA + content for grounding before it edits.
21. **Agent-facing GEO/AEO report** — structured "how citable is this site to ChatGPT/
    Perplexity" so the agent optimizes against a number.
22. **Agent-readable Lighthouse + axe report per deploy** — the build returns a structured
    quality report the agent can act on, not a screenshot.

### Real-time, capability & portability
23. **MCP elicitation (2025-11 spec)** — the deploy tool asks the agent's human for a missing
    field (logo, domain) mid-flow instead of failing.
24. **Real-time build-progress stream (SSE)** — typed events the agent consumes, not a log
    tail; pairs with `event-sourced-build-progress`.
25. **Webhook subscriptions agents register (Svix)** — agent is notified on build/deploy/
    domain completion instead of polling.
26. **Streaming partial edits** — agent edits one section, sees it live in <1s, no full
    rebuild (ties to `visual_point_edit`).
27. **Content-addressed assets** — each published asset has a content-hash URL so agents can
    diff exactly what changed between deploys.
28. **Bring-your-own-model env vars** (AES-GCM, `ai_env_vars` exists) — the owner plugs their
    own OpenAI/Anthropic key; generation runs on their dime, our COGS drops, we still bill the
    $50.
29. **Cross-editor parity** — the same MCP server + OAuth works identically in Claude Code,
    Cursor, VS Code, and the web dashboard. One mental model, zero per-client logic.
30. **Template clone-customize-deploy as a 3-tool MCP sequence** — agent discovers templates
    as resources, clones, customizes, ships. Distribution via the template repo.

---

## 6. AI-ecosystem avenues — 40 ways into the AI scene (get listed · become eligible · integrate)

> ⛔ **PUBLISH GATE (hard, Brian-approval-required).** Every item that submits/registers/lists
> projectsites with an EXTERNAL party (registries, app stores, directories, roundups, badge
> programs, npm publish, open-sourcing) is BUILD-the-artifact-only. Prepare the `server.json`,
> the `.well-known` files, the listing copy, the PR branch — then STOP. Outward-facing
> publication is an `approval-required` action per `autonomous-engineering`; do NOT auto-submit.
> Internal eligibility features (transports, discovery files, schemas) ship dark-flagged as usual.

### A. MCP registries & directories (get listed — artifact-ready, do not submit)
1. **Official MCP Registry** (`registry.modelcontextprotocol.io`) — author `server.json`; canonical source clients pull.
2. **Smithery** (`smithery.ai`) — largest hosted directory, one-click install.
3. **Aggregators** — `glama.ai/mcp`, `mcp.so`, PulseMCP, `mcpservers.org`.
4. **Awesome-MCP-Servers + Docker MCP Catalog/Toolkit** — curated-list PR + Docker image.
5. **Client-native galleries** — VS Code MCP gallery, Cursor directory, Cline Marketplace, Zed, Continue, Goose.

### B. Eligibility features (add to qualify + rank — ship internally, flagged)
6. **Streamable-HTTP transport + OAuth 2.1 + Dynamic Client Registration** (have OAuth; add DCR + streamable).
7. **Discovery files** — `server.json` + `.well-known/oauth-protected-resource` + `.well-known/mcp`.
8. **Rich tool metadata** — JSON schemas + tool annotations (read-only/destructive) + titles/examples + clean MCP Inspector pass.
9. **Listing assets** — logo, categories/tags, README quickstart, 60s demo, semver, public health endpoint.
10. **Trust marks** — security.txt/disclosure, privacy policy, rate limits, changelog, namespace claim/verify.

### C. AI-assistant app stores & integration directories (artifact-ready, do not submit)
11. **Anthropic Claude connectors directory** — remote-MCP connector (closest-fit, highest-intent audience).
12. **OpenAI Apps SDK / ChatGPT app directory** — "build me a website" in-chat.
13. **Google Gemini Extensions** — register as a tool/extension.
14. **Microsoft Copilot Agent Store + Copilot Studio connector**.
15. **Perplexity / Poe / HuggingChat** tool ecosystems.

### D. Agent frameworks & tool hubs (integrate-with)
16. **Composio** — managed tool; they hold auth. 17. **Arcade** — MCP-native runtime entry. 18. **Nango** — just-in-time agent builds.
19. **LangChain / LlamaIndex** — `langchain-projectsites` + LlamaIndex tool spec. 20. **Vercel AI SDK / CopilotKit / AG-UI** adapters.

### E. Automation platforms (no-code reach)
21. **Zapier + Zapier MCP**. 22. **n8n + Make + Pipedream** nodes/apps. 23. **Cloudflare Agents/Workflows** referenceable block.
24. **Slack / Discord / Teams** marketplaces (chat-deploy bot). 25. **Retool / Airtable / Notion** automation actions.

### F. Protocols to support (interoperate + future-proof)
26. **MCP (platform + per-site server)** — flagship; per-site MCP is the unique hook. 27. **A2A** — other agents delegate site-building.
28. **OpenAI function-calling / Apps SDK schema**. 29. **AG-UI** — stream build progress. 30. **Email-as-interface** (Email Routing Worker).

### G. Discovery / GEO / distribution
31. **`llms.txt` + `/api/llms`** — agent self-onboard. 32. **AEO/GEO so projectsites itself gets cited** (FAQPage + quotable blocks).
33. **"Best MCP servers / AI website builders 2026" roundups** (Builder.io, Composio, Toloka, Fastio). 34. **OSS the MCP server + `npx create-projectsites-mcp`** (publish-gated). 35. **Partner template galleries** (CF Workers / Vercel / Replit / Bolt starters using the MCP).

### H. Integrate-WITH (consume the scene; be the host agents reach for)
36. **Deploy target in agent IDEs** — Cursor/Windsurf/Replit/Bolt/Lovable "deploy to projectsites." 37. **Consume others' MCPs inside builds** (Stripe/Resend/Notion via the OAuth layer → richer sites).
38. **Model marketplaces** — OpenRouter / HF Spaces demo via AI Gateway. 39. **Agent-commerce rails** — agentic-checkout so an agent can buy a $50/mo site. 40. **Verification/badge programs** — "Works with Claude," OpenAI/Google partner badges, MCP "verified server."

**Eligibility bundle (#6-#10) first** — ship once → ~15 listings become possible. Then prep #1/#2/#11 artifacts (do not submit). All `platform_mcp`-adjacent; track in `ROADMAP.md`.

---

> See `ROADMAP.md` for the priority-ordered, $-sorted build queue (these items land there as
> flagged modules). Capital-efficiency program: `ROADMAP.md` § Capital efficiency.


---

# Edge-hosting strategy

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
