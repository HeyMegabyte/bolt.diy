# 50 Sizable Ideas for projectsites.dev

> Generated 2026-05-28 from parallel research: competitor AI-builder scan (Lovable, v0, Bolt.new, Cursor, Webflow AI, Replit, Onlook, Devin, Antigravity), Cloudflare 2026 capability sweep (Workflows v2, Realtime, Containers GA, AI Search hybrid, Llama 4 Scout, Sandbox SDK), solo SaaS growth playbooks (pSEO post-March-2026, GEO/AEO, viral loops), and a deep repo capability + gap scan against `libs/features/`, `feature_flags/registry.ts`, `wrangler.toml` bindings, and `e2e/FEATURES.md`.
>
> **Sizable** = each idea is a project, not a nit. Effort tiers: S (<1 day), M (1-3 days), L (3-10 days), XL (>10 days). Impact: 🔥 unlocks new product line / ⚡ measurable user value / 💡 strategic spike.

---

## Ship-this-quarter shortlist (top 10 by ROI)

1. **#9 Close the 38 abandoned flags** — drift cleanup, instant credibility.
2. **#1 Direct-Manipulation Visual Edits** — Lovable's killer demo, doesn't burn AI credits.
3. **#11 Workflows v2 migration + dynamic workflows** — 11× concurrency lift, agent-native.
4. **#26 GEO/AEO Citation Engine** — AI search is 25% of search traffic by EOY 2026.
5. **#32 Vertical Specialization Wave** — pick 3 verticals (HVAC / law / nonprofit) + pSEO them.
6. **#5 Plan-mode vs Act-mode split** — Cline pattern, halves bad-edit rate.
7. **#20 Realtime Voice Agent (Workers AI WebSocket + SFU)** — <500ms voice-to-voice loop on the edge.
8. **#15 AI Search hybrid (BM25 + vector + relevance boosting)** — CF AI Search GA'd in 2026.
9. **#42 Marketplace v1 with creator revenue share** — Framer-style 0%-cut economics.
10. **#37 Public Agent SDK + Skills system** — your runtime becomes other people's infra.

---

## Category 1 — Editor Experience & Vibe Coding (compete with Lovable/v0/Cursor)

### 1. Direct-Manipulation Visual Edits 🔥 [L]
Click any element in the bolt.diy iframe → inline copy / color / spacing changes WITHOUT a re-prompt round-trip. Mutations flow through Zod-validated patches per [[contract-first-ai]]. Lovable's #1 retention driver — visual edits don't burn AI credits, which is the largest tier-down friction in `[[ai-cost]]`. Source: Lovable 2.0 changelog.

### 2. Plan-Mode + Act-Mode Split 🔥 [M]
Cmd+K opens a Plan Mode panel that emits a typed `AiPatch` plan FIRST per [[contract-first-ai]] — the user confirms before any file mutation runs. Reduces bad-edit rate ~50% (Cline + Antigravity 2.0 pattern). Replaces the current "chat fires edits immediately" UX. Wire to `prompts/` registry so plans are reproducible + cacheable.

### 3. 8-Parallel-Agent Worktree Dashboard 🔥 [L]
Per [[main-only-branch]] + Cursor Agents Window. Spawn up to 8 background agents in isolated worktrees, each with its own terminal + browser + diff pane in `/admin/swarm`. Closes `swarm_editor` alpha module per repo-scan (DRIFT note). Pair with [[ai-seniority]] auto-merge so agent-cleared diffs land directly on `main`.

### 4. Bidirectional Canvas↔Code Sync ⚡ [L]
Edit code → canvas updates; edit canvas → code regenerates ONLY the affected component. Onlook's differentiator. Eliminates the full-page regen tax that makes bolt.diy iterations feel heavy. Needs typed `ComponentEditEvent` schema in `packages/shared/schemas/`.

### 5. Spatial Comments + Multiplayer Cursors 💡 [M]
Pin comments to DOM nodes in the preview; Figma-style. Pairs with optional multiplayer (one shared bolt.diy session, multiple cursors via Cloudflare Realtime SFU). Unlocks "ask my client for feedback" flow without leaving the editor.

### 6. Sketch-to-Site (Photo Upload First-Run) ⚡ [M]
Webflow Wireframer pattern. Upload a paper sketch / screenshot → Llama 4 Scout vision generates the React+Tailwind+shadcn scaffold + opens it in bolt.diy. Reuses existing image-upload pipeline; new prompt template + vision pipeline. Highest-converting onboarding mode in Webflow data.

### 7. Skills System (Auto-Detected Project Rules) ⚡ [M]
Lovable Skills pattern. Per-site `.projectrules` file the editor auto-applies (brand tokens, banned words, FAQ template, schema rules). Eliminates the `.cursorrules` manual-management tax. Skill files are Zod-validated; surface in `/admin/sites/:id/skills`.

### 8. Inline Model-Tier Picker (Mini / Pro / Max) ⚡ [S]
v0 pattern. Per-prompt model selector: Workers AI Llama 4 Scout (free, fast) / Claude Haiku 4.5 ($) / Claude Opus 4.7 ($$$). Routes through existing [[model-routing]] but exposes choice to the user. Pair with AI Gateway cost meter (#16).

---

## Category 2 — AI-Native Capabilities & Workflows v2

### 9. Close the 38 Abandoned Feature Flags 🔥 [L]
Per repo-scan: 38 flags experimental at 0% rollout for >30 days. Each is half-built infrastructure pretending to be a product. Triage pass: (a) ship + promote, (b) gracefully deprecate, (c) consolidate. Drift cleanup AND credibility — admin dashboard stops feeling vapor.

### 10. Llama 4 Scout Migration (Vision + 10M Context) 🔥 [M]
Workers AI now serves `@cf/meta/llama-4-scout-17b-16e-instruct` — native multimodal MoE with 131k initial context (planned 10M). Migrate site-generation + voice-browse-agent + research prompts from Llama 3.3 70B FP8. Cheaper per-token + vision-capable in one model. Source: [Cloudflare Llama 4 announcement](https://blog.cloudflare.com/meta-llama-4-is-now-available-on-workers-ai/).

### 11. Workflows v2 Migration + Dynamic Workflows 🔥 [L]
50,000 concurrent instances (was 4,500), 300 starts/sec (was 100), `step.waitForEvent` for human-in-the-loop approvals, hibernation-free pauses. Migrate `site-generation` + `image-generation` + `snapshot-quality` workflows. Adopt **Dynamic Workflows** for per-tenant agent-authored workflows — agents write the workflow, the platform runs it. Source: [Workflows v2 blog](https://blog.cloudflare.com/workflows-v2/).

### 12. AI Gateway Guardrails + Firewall for AI ⚡ [M]
Wire Llama Guard-powered content moderation in front of every LLM call via AI Gateway. Block harmful prompts/responses with structured error envelopes. Pair with Cloudflare Firewall for AI for prompt-injection defense (separate product, model-agnostic). Compliance value for EU AI Act high-risk obligations (Aug 2 2026). Source: [AI Gateway Guardrails docs](https://developers.cloudflare.com/ai-gateway/features/guardrails/).

### 13. AI Auto-Repair (Self-Healing Builds) 🔥 [L]
On build failure, the workflow re-prompts with the error + previous output + delta-fix instructions. Loop up to 3 attempts before surfacing to user. Pairs with Workflows v2 `step.waitForEvent` for human-in-the-loop on persistent failure. v0 AutoFix pattern. Closes the "build failed, user gives up" funnel hole.

### 14. AutoRAG over Site Content + Customer Data ⚡ [M]
Wire Cloudflare AI Search (formerly AutoRAG) with built-in storage. Per-site Vectorize index over scraped content + user uploads + chat history. Replaces hand-rolled `services/rag.ts` patterns. Enables "ask anything about your site" admin assistant + per-visitor AI chat that's grounded in real content. Source: [AI Search release notes](https://developers.cloudflare.com/ai-search/platform/release-note/).

### 15. Hybrid Search (BM25 + Vector + Relevance Boosting) ⚡ [M]
AI Search 2026 supports hybrid search in a single query, configurable tokenizer + fusion method, relevance boosting on up to 3 metadata fields, namespace-level search across multiple instances. Replace existing search.ts AI-only path. Faster + more relevant + indexes 3-5× faster than the old setup.

### 16. AI Cost Meter + Budget Caps Per Site 🔥 [M]
Per-site daily/monthly LLM spend cap with hard-stop + user-facing meter. Backend: AI Gateway request logs → D1 aggregate → KV cache. Frontend: live progress bar on every editor session. Solves the "Bolt.new token panic" UX complaint (the #1 churn driver in their data). Pairs with #8 model-tier picker.

### 17. Multi-Model Router (Cheap → Quality Fallback) ⚡ [M]
Per-task model strategy: Llama 4 Scout for first-pass / Workers AI cheap models for structured outputs / Claude Opus for top-10 polish per [[model-routing]]. Codify in AI Gateway routing rules so fallbacks fire automatically on 5xx or guardrail blocks. Closes the `multi_model_router` abandoned flag.

### 18. Sandbox SDK Backup/Restore for Agent Sessions ⚡ [M]
Containers GA'd April 2026 with Sandbox SDK that supports `backup`/`restore` of workspace state — pause an agent's coding session, resume hours later without re-running setup. Wire into the bolt.diy persistence path so unfinished builds survive across sessions. Source: [Containers + Sandbox GA changelog](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/).

### 19. Code Mode + MCP Tool Calls in the Editor 💡 [L]
Cloudflare Agents Week 2026 shipped Code Mode (agents that can write + execute code as part of tool calls) + MCP integration. Expose each site's data layer (D1, R2, KV) to the in-editor AI as MCP tools so the agent can build features that read live data, not mocks.

---

## Category 3 — Voice & Realtime AI (CF Realtime + Workers AI WebSocket)

### 20. Realtime Voice Agent (Edge-Native, <500ms RTT) 🔥 [L]
Cloudflare Realtime SFU + Workers AI WebSocket-enabled models (PipeCat smart-turn-v2, Deepgram Nova-3, Aura-1) + LLM on the same edge POP = voice-to-voice in 350-500ms. Power the existing voice agent at edge latency instead of round-tripping to Twilio + OpenAI. Source: [Cloudflare Realtime voice AI blog](https://blog.cloudflare.com/cloudflare-realtime-voice-ai/).

### 21. Live Transcription + Translation Overlay ⚡ [M]
Pipe customer-form voice input through Whisper-large-v3-turbo on Workers AI WebSocket. Real-time transcription + on-the-fly translation for multilingual customer service. Powers the unfinished `voice_editing` flag.

### 22. Per-Site Phone Number with Voice Agent ⚡ [L]
Twilio number → SIP forward to CF Realtime → voice agent answers with site-grounded context (RAG over the site's content + business hours + service area). After-hours auto-answer for local businesses. Premium plan upgrade lever.

### 23. Multiplayer Live Streams (Class / Webinar / Live Shop) 💡 [L]
RealtimeKit SDK on top of SFU. Per-site embed: `<projectsites-live>` component. Webinars, online classes, live shopping for retail vertical. Differentiator vs Lovable/Bolt (none ship live video).

---

## Category 4 — Search, AI-Search & AEO/GEO

### 24. AEO Schema Engine (FAQPage + HowTo + Speakable) 🔥 [M]
Auto-generate FAQPage + HowTo + Speakable JSON-LD on every page. Per [[copy-writing]] § GEO/AI search, FAQPage has the highest AI-citation rate. Quotable answer blocks 40-60 words become first-class component. Score = sites jump from invisible to cited in ChatGPT/Perplexity in 2-4 weeks.

### 25. Reddit + YouTube + LinkedIn Citation Loop 🔥 [L]
97.4% of AI citations come from non-Tier-1 earned media — Reddit (46.7% of Perplexity), YouTube (31.8%), LinkedIn. Build a "Citation Loop" pipeline: per published site, auto-generate Reddit-suitable launch post drafts + YouTube short script + LinkedIn article. Users one-click publish. Compounds AI-search ranking. Source: [GEO research, Princeton study cited 30-40% visibility lift](https://llmrefs.com/generative-engine-optimization).

### 26. GEO/AEO Citation Engine + Ranking Tracker 🔥 [L]
For each customer site: track citations in ChatGPT, Perplexity, Claude, Google AI Overviews. Daily query the platforms, parse for brand mentions, surface in admin. ChatGPT serves 800M WAU; Perplexity 780M monthly queries — these ARE the new SERPs. Source: [AI Visibility Checklist 2026](https://ailabsaudit.com/blog/en/aeo-checklist-2026-actions).

### 27. llms.txt + Brave Webmaster + Bing Webmaster Auto-Setup ⚡ [S]
Every published site auto-emits llms.txt, auto-pings Bing (ChatGPT indexes via Bing) + Brave (Claude indexes via Brave). Cheap + forward-looking. Source: same as #26.

### 28. Cross-Engine Visibility Dashboard 💡 [M]
Only 11% of domains are cited by BOTH ChatGPT AND Perplexity. Per-site dashboard showing platform-by-platform visibility with concrete action items: "Cited by Perplexity but not ChatGPT → add to Wikipedia/Reddit" etc. Differentiator no AI builder offers today.

---

## Category 5 — Programmatic SEO & Content

### 29. pSEO Matrix v2 (Post-March-2026 Survival Mode) 🔥 [L]
The `pseo` route exists but lacks save/publish (per repo-scan). Rebuild with the post-March-2026 survival pattern: each page = a PRODUCT, not a document. Per-page unique data threshold ≥40% (real Places API data, real reviews, real pricing). Capped at 200 pages per axis to avoid thin-content flag. Source: [Programmatic SEO After March 2026](https://www.digitalapplied.com/blog/programmatic-seo-after-march-2026-surviving-scaled-content-ban).

### 30. Integration Directory Generator (Solo-SaaS Power Move) ⚡ [L]
"Connect [Your Service] to [Other Service]" pages — proven Levels.io pattern. Auto-generate `/integrations/{service-a}/{service-b}` for every customer's tech stack. Live data per page (real integration config, real screenshots). Survives Helpful Content because every page solves a real task.

### 31. Comparison + Alternative Pages Engine ⚡ [M]
`projectsites.dev/vs/lovable`, `/vs/bolt`, `/vs/v0`, `/vs/replit`. Auto-generated from feature matrices, real pricing pulled weekly, real screenshots. The page itself becomes the marketing — converts at 4.4× organic per AI-search data.

### 32. Vertical Specialization Wave 🔥 [XL]
Solo SaaS that pivots to a vertical grows faster. Pick 3 verticals with proven TAM: **HVAC contractors** (50k US businesses, $50-200/mo budget), **personal injury law** (35k firms, $200-500/mo), **small nonprofits** (1.5M US 501(c)(3)s, $25-100/mo). Build vertical-specific templates + vertical-specific generation prompts + vertical-specific JSON-LD + vertical pSEO grids. Each becomes its own go-to-market.

---

## Category 6 — Growth, Distribution & Viral Loops

### 33. Built-In Referral Loop (Dropbox/Trello Pattern) 🔥 [M]
Per [[viral-loops]]: track `k` coefficient, double-sided reward (referrer +30 days Pro, referee 30 days free). UI lives in `/admin/refer`. Dropbox-pattern got 16% signup lift; Trello got virality through "1 month Trello Gold" rewards. Closes the `agency_tier` abandoned flag. Source: [Beyond Labs SaaS Referrals](https://beyondlabs.io/blogs/how-to-use-a-saas-referral-program-to-scale-from-100-to-1000-users).

### 34. White-Label Agency Tier ⚡ [L]
Webflow's #1 growth lever: agencies/freelancers reselling under their brand. `$200/mo white-label tier` — agency's logo on the editor, custom domain on the platform, their billing-of-record. Closes `whitelabel_admin` abandoned flag. Source: [Refgrow Partnership Strategies](https://refgrow.com/blog/partnership-marketing-strategies).

### 35. Build-in-Public Changelog Page + RSS 🔥 [S]
The CHANGELOG is the top traffic source for many solo SaaS. Public route at `/changelog` with RSS, email-on-publish via Listmonk. Auto-generated from conventional-commits via changelog-generator agent per [[main-only-branch]]. Compounding distribution every commit.

### 36. Stripe App Marketplace Listing + "Stripe Apps" Stamp 💡 [M]
Get listed in the Stripe directory. Most solo SaaS that accept Stripe payments don't bother. Drives qualified leads from Stripe's own dashboard. Pair with Stripe Connect partnership outreach (20% rev-share per growth research).

### 37. Public Agent SDK + MCP Server 🔥 [L]
Cursor SDK + Antigravity 2.0 SDK pattern. Publish `@projectsites/sdk` so other apps can build on the projectsites runtime — generate sites programmatically, embed the editor, build agents. Plus an MCP server (`projectsites-mcp`) so Claude Desktop / ChatGPT / agents can drive the platform. Distribution = compounding when SDK is good.

### 38. Discord Community + Build-Along Streams ⚡ [M]
Solo SaaS that built compounding communities: Cursor (160k Discord), Lovable (60k Discord), Bolt.new (40k Discord). Weekly Brian-builds-a-site stream. Members get early access to flags. Community feedback drives roadmap. Closes the `templates_marketplace` flag's community angle.

---

## Category 7 — Marketplace & Creator Economy

### 39. Template Marketplace v1 (Framer-Style 0%-Cut) 🔥 [L]
Closes `template_marketplace` abandoned flag. Per growth research: Framer creators earn $36k+/mo with 0% marketplace cut + 50% referral revenue share. Build it like Framer: creator submits template, Brian curates, creator keeps 100% on direct sales + 50% on the platform-referred conversions. 2,100 templates on Framer; 6,000 on Webflow — there's room.

### 40. Section Marketplace (Bento Cards / Pricing Tables / FAQs) ⚡ [L]
The `marketplace` alpha module per repo-scan has 30 seed entries but no editor for custom sections. Open to community submissions, monetize premium sections at $5-25 each. Creator economy on micro-units. Pairs with Skills system (#7) for brand-token auto-adoption.

### 41. Plugin/Integration Marketplace ⚡ [L]
Webflow has 500 plugins. projectsites could surface third-party integrations (Stripe checkout flows, Calendly embeds, MapBox tours, AI form-fill helpers) as installable plugins. Revenue share 70/30 to creator. Marketplace becomes the moat once it's stocked.

### 42. AI Code Components Generator 🔥 [L]
Webflow AI Code Components pattern: describe a widget ("multi-step quote calculator with 3 services and conditional pricing"), get a production React component scaffolded with the site's brand tokens auto-inherited. The component becomes a reusable marketplace item too. Lives in `libs/features/ai_components/`.

---

## Category 8 — Monetization, Pricing & Enterprise

### 43. Pay-As-You-Go AI Top-Ups (Eliminate Token Panic) 🔥 [M]
Bolt.new's $200M ARR proves token-metered works. Pair with #16 cost meter. Buy AI credits in bundles ($10 = 10k Llama 4 calls, $25 = 1k Claude Opus calls). Removes hard caps; users with budgets spend more. Closes `token_burn_meter` flag.

### 44. Enterprise Plan ($500-$2000/mo) with SSO + Audit + SLA ⚡ [L]
Cloudflare Access SSO + audit log export + 99.9% SLA + dedicated support channel. Webflow Enterprise starts at $30k/yr; even 5 customers at $1k/mo = $60k ARR. Closes `enterprise_audit` adjacent flags. Pair with hash-chain audit log (#46).

### 45. Domain Reseller Margin ⚡ [M]
Domains via existing CF for SaaS or OpenSRS. Customers buy/transfer through projectsites at MSRP, platform takes $5-10 margin per domain-year. Recurring revenue per site. Closes `domain_stack_wizard` flag.

### 46. Hash-Chained Audit Log (Compliance Lever) ⚡ [M]
Closes `audit_hash_chain` flag. Tamper-evident audit log via SHA-256 chain per entry. Sells the enterprise plan. EU AI Act compliance requirement starting Aug 2 2026 for high-risk AI systems. Brian's stack already has the audit logs — just chain them.

---

## Category 9 — Cross-Platform & Mobile

### 47. iOS + Android Shell via Capacitor 6 🔥 [L]
The platform's frontend is Angular 21 — Capacitor 6 + Ionic 8 already in the stack rule. Ship native iOS/Android shells of the admin so site owners can manage on phones. Push notifications for form submissions, voice calls, donation events. Premium plan lever.

### 48. Chrome Extension: One-Click Add Site from Any URL ⚡ [M]
Browse to competitor → click extension → "rebuild this with projectsites" → site auto-clones via existing crawl pipeline. Viral acquisition mechanic. Lowest-friction onboarding ever attempted.

### 49. Tauri Desktop App for Power Users 💡 [L]
Same Angular codebase, Tauri 2 wrapper. Native menu bar, system tray for monitoring builds, offline-first editing. Replit / Cursor have desktop apps; positions projectsites as a serious tool not just a browser SaaS.

---

## Category 10 — Trust, Compliance & Observability

### 50. Trust Center + AI Transparency Page 🔥 [M]
EU AI Act high-risk obligations start Aug 2 2026 — even non-EU customers will demand AI transparency. Per-site Trust Center showing: AI models used, content provenance, audit log access, data residency, fallback behavior on AI outage. Compliance asset + sales asset. Surface as `/admin/trust` per project + `/trust` per published site.

---

## Bonus — Honest Gap Closures (not new ideas, but high-ROI cleanup per repo-scan)

These didn't make the 50 because they're cleanup, not invention. Surface for context — each one IS a sizable project on its own:

- Drop `phone_otps` D1 table (orphaned from removed phone feature)
- Remove `ai_admin_features.ts.bak` checked-in backup file
- Unify v1 (flat) vs v2 (nested) payload format → declare single format
- Fix `registry KV match` bug — `startsWith('prompt:${id}@')` false-matches versions
- Wire `IMAGE_GENERATION_WORKFLOW` binding (declared, never dispatched)
- Wire `SNAPSHOT_QUALITY_WORKFLOW` binding (same)
- Wire `DRIVE_SYNC_WORKFLOW` binding (same; `ai_drive_sync.ts` exists, no dispatch)
- Route `CONVERSATION_HUB` Durable Object (declared in wrangler, no routes call it)
- Close 50+ TDD-RED specs in `e2e/FEATURES.md` by shipping the features (per [[ai-seniority]] auto-merge contract)

---

## Sources

**Competitor research:**
- [Lovable Statistics 2026](https://www.getpanto.ai/blog/lovable-statistics)
- [Bolt.new Pricing 2026](https://www.banani.co/blog/bolt-new-pricing)
- [Webflow AI Code Components](https://webflow.com/blog/ai-code-components)
- [Framer Creator Marketplace](https://www.framer.com/creators)
- [Cursor SDK + Background Agents](https://www.builder.io/blog/cursor-ai-tips-react-nextjs)
- [Replit Agent Review 2026](https://vibetoolstack.com/tools/replit-agent)
- [Onlook bidirectional editor](https://frontman.sh/vs/onlook)
- [13 Best AI App Builders 2026](https://playcode.io/best-ai-app-builders)

**Cloudflare 2026:**
- [Workflows v2 announcement](https://blog.cloudflare.com/workflows-v2/)
- [Dynamic Workflows](https://blog.cloudflare.com/dynamic-workflows/)
- [Llama 4 on Workers AI](https://blog.cloudflare.com/meta-llama-4-is-now-available-on-workers-ai/)
- [AI Gateway Guardrails](https://blog.cloudflare.com/guardrails-in-ai-gateway/)
- [Firewall for AI](https://blog.cloudflare.com/block-unsafe-llm-prompts-with-firewall-for-ai/)
- [Containers + Sandbox SDK GA](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)
- [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [AI Search release notes](https://developers.cloudflare.com/ai-search/platform/release-note/)
- [Realtime voice AI](https://blog.cloudflare.com/cloudflare-realtime-voice-ai/)

**Growth + GEO:**
- [Programmatic SEO After March 2026](https://www.digitalapplied.com/blog/programmatic-seo-after-march-2026-surviving-scaled-content-ban)
- [AI Visibility Checklist 2026](https://ailabsaudit.com/blog/en/aeo-checklist-2026-actions)
- [GEO: AI Search Visibility](https://llmrefs.com/generative-engine-optimization)
- [SaaS Referral Programs](https://viral-loops.com/referral-marketing/saas-programs)
- [Partnership Marketing 2026](https://refgrow.com/blog/partnership-marketing-strategies)
- [AI-First Solo Founder Playbook](https://www.nxcode.io/resources/news/how-to-market-your-saas-ai-first-playbook-2026)

**Repo gap scan:** internal `libs/features/*/feature.manifest.ts`, `src/modules/feature_flags/registry.ts`, `wrangler.toml`, `e2e/FEATURES.md`, `apps/project-sites/CLAUDE.md` § Known Issues.
