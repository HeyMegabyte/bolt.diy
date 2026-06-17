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

> See `ROADMAP.md` for the priority-ordered, $-sorted build queue (these items land there as
> flagged modules). Capital-efficiency program: `ROADMAP.md` § Capital efficiency.
