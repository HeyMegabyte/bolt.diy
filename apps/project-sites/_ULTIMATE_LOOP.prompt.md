# ULTIMATE CONVERGENCE LOOP — projectsites.dev

> The single source of truth for driving this entire project to a finished, fully-tested,
> gorgeous, deployed state. Supersedes and absorbs every prior convergence/completion doctrine
> (`_ULTIMATE_COMPLETION`, `_ULTIMATE_CONVERGENCE`, `_SPARTAN_CONVERGENCE`, `CONVERGENCE`,
> the cluster/WS integration logs — all now retired) AND the six infrastructure-architecture
> handoff prompts (automation plane · auth/authz/SSO/SCIM/API-keys · AI control plane
> LiteLLM+RouteLLM+AI-Gateway+Langfuse · Hyperdrive-sharded Postgres isolation · browser
> automation gateway · Infisical secrets + Novu) — all now folded into the single backlog below.
> Operate under EVERY rule, skill, and agent in `~/.claude` + `~/.agentskills`. **The loop is the
> unit of intelligence; the agent is fungible.** Do not stop until the ledger is empty and every
> gate is green.
>
> **`_CONVERGENCE_BACKLOG.md` is THE merged work-list** (the 5 infra planes + Novu + the MCP/AI
> endpoint + 30 NEW features + the original 30 research ideas + the de-stub catalog), each item a
> flagged module with E2E + DoD, expressed as ▸Technical / ▸In-spirit / ▸Philosophical /
> ▸Business-&-flags requirement classes. This prompt is the loop *driver*; that file is the loop
> *work-list*. The loop addresses it every fire.

---

## 0 — Operating doctrine (read every iteration)

- **TWO standing mandates fire EVERY iteration, regardless of which ledger item is picked (read §0.A + §0.B first):** (A) progressive gorgeousness — every fire leaves a touched surface measurably more beautiful; (B) completeness convergence — every fire drives the app toward full, perfect, shippable completeness OR honestly escalates when the autonomous vein is dry. These are not optional polish; they are the loop's reason to exist.
- **Fresh-context Ralph skeleton.** Each iteration is a fresh spawn whose ONLY inherited memory is `progress.md` + `git log`/`git diff` + `_LOOP_LEDGER.md` — never one long conversation (kills context rot + goal drift). Checkpoint = a git commit after every green phase; if compaction fires, read `git log` FIRST before any tool call.
- **Machine-verifiable DONE — the orchestrator decides, not the agent.** Every item resolves to named test(s). A phase closes only when its tests pass AND its **critic** approves (§4). No "I think it looks done." Emit a parseable `<promise>DONE: <item-id></promise>` so the outer loop advances deterministically.
- **Model-tier routing per phase (the LOOP's own Claude agents).** Haiku → grep/format/lint/changelog. Sonnet → implementation, test-writing, debugging, deploy. Opus → architecture, security/payment/auth review, visual-QA, the critic gate, meta-orchestration. **Never Opus for anything greppable.**
- **Provider cost-tier routing (the APP + the container build agent — distinct axis from the Claude-altitude line above).** Three tiers per `model-routing` § Provider cost tiers: **premium = Anthropic / OpenAI** for higher-order research, architecture, money/auth decisions, and ALL vision (DeepSeek has none); **mid-grade = DeepSeek** (`deepseek-chat`, `DEEPSEEK_API_KEY`) — the DEFAULT for most generation/implementation; **instant = Cloudflare Workers AI** (`@cf/meta/llama-*`, free, edge) for pre-routing, classification, and anything it does well. The container's Claude Code build agent runs **DeepSeek-primary** via `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` (Anthropic passive fallback; `BUILD_LLM_PROVIDER=anthropic` forces Claude; `deepseek-reasoner` for higher-order). End state: collapse everything toward Workers AI as it catches up — until then, premium for judgment, DeepSeek for volume, Workers AI for reflexes. Implemented in `external_llm.chooseProviderForTier` + `ai_gateway` deepseek slug.
- **Hard budgets (cost runaway is the #1 failure mode).** Set `max_parallel_agents = 4` (ceiling 6, justify in the assignment table), and a token budget per phase. Treat budget exhaustion as a hard stop + checkpoint, not a reason to degrade quality.
- **Batch of 10 per fire.** Each invocation runs **10 convergence rounds** (10 ledger items closed end-to-end), then reports — see §2. Budgets + parallelism caps apply across the whole batch.
- **Termination guards.** (a) 10-round batch cap per fire + a max-iteration cap; (b) **repetition detector** — hash the last 3 tool-call sequences; identical → halt + escalate; (c) a hard gate failing twice on one item → escalate, don't thrash; (d) the zero-recommendations gate in §8; (e) **converged-surface guard (arc-learned, fire-v2.60→63):** when the prior fire's `progress.md` marker says the autonomous vein is exhausted AND HEAD moved only via concurrent-session commits, do NOT re-investigate / re-run full suites / hunt marginal work — read marker → confirm HEAD → fast-no-op + escalate the gated tier (the cron firing every minute on a converged surface is the failure this prevents). NEVER fabricate a thin round to look busy; a clean fast-no-op with a crisp escalation IS the correct output.
- **Drift fixes ship the SAME turn** — never defer architecture drift to a follow-up PR (`drift-detection`). Stale docs are bugs.
- **Dogfood-first (no perf-harming abstractions).** Prefer the path that builds/deploys/operates the platform THROUGH its own primitives: deploy via `platform_mcp` (`deploy_site` once wired), generate our own marketing via `site-generation.ts`, compose admin/marketing from `site-kit` blocks. Use Cloudflare primitives DIRECTLY per `cloudflare-lock-in-is-leverage` — NEVER a portability/wrapper layer in the hot path; adopt only abstractions that RAISE perf (KV-poll → per-site DO actor, 5s-poll → AG-UI/SSE stream, D1 read-replica lookups, AI Gateway cache, inline WASM hardening gate). Measure INP/p99 before+after every structural swap; revert any regression. Full plan + the 30-idea edge-hosting thesis: `EDGE_HOSTING_STRATEGY.md`.

---

## 0.A — Progressive Gorgeousness mandate (EVERY iteration, non-negotiable)

> Per `gorgeous-by-default` + `cinematic-ui-patterns` + the user-level Progressively-Gorgeous UI Mandate. The app must be **measurably more beautiful after every fire than before** — investor-demo gorgeous, never "functional but plain." This is a per-iteration requirement, not an occasional polish pass.

- **Every fire that touches ANY user-visible surface (admin, marketing, generated-site template, dashboards) MUST leave it measurably more beautiful.** A pure-backend fire is exempt, but if it has a frontend touchpoint, the gorgeous bar applies.
- **Each touched surface advances ≥1 axis:** cinematic motion (View Transitions, scroll-driven, `@starting-style`, `appReveal` entrance, `0.333s` transitions) · refined type (`clamp()` fluid scales, OKLCH, `text-wrap: balance/pretty`) · bento/asymmetric layout · glass+grain texture · brand-locked cyan/black `--ps-*` tokens (never hardcoded hex) · `<app-rolling-counter>` on EVERY numeric stat · enumerables-as-pills (never CSV) · `:focus-within` on wrapped controls · a11y upgrade (axe 0 + WCAG 2.2 box-control 24px floor) · AI-native interaction.
- **Gorgeous is a build-VERIFY gate, not a vibe:** Turn-3 visual-QA (AI-vision rubric **≥8/10**, target ≥9 cinematic) + axe 0 violations at 6 breakpoints + the `cinematic-ui` regression spec. A surface that regresses on beauty fails the iteration even if logic is green.
- **A dedicated beauty round is a legitimate ledger item.** When no feature/correctness slice is autonomously available BUT a user-visible surface is merely "fine," a `supreme-polish`-style gorgeousness pass on the highest-traffic surface (homepage → /create → /admin dashboard → generated-site template) IS the highest-leverage work — pick it before fast-no-op'ing. Ship via `gorgeous-by-default` self-critique (would Brian call it gorgeous, not just functional?).
- **Never regress beauty for logic.** A correctness fix that flattens a gorgeous surface is incomplete until the gorgeousness is restored in the same fire.

## 0.B — Completeness Convergence mandate (the loop's terminal goal)

> The loop exists to drive ProjectSites.dev to **full, perfect, shippable completeness** — not to run forever. "Complete" is the §8 termination state, measured, never asserted.

- **Every fire advances the completeness frontier OR honestly escalates.** Acceptable per-fire outcomes, in priority order: (1) close a real ledger/feature slice end-to-end (RED→GREEN→clean→verify→doc→commit); (2) a §0.A gorgeousness pass on a "merely-fine" surface; (3) **deploy built-but-dark work** (a tested, committed, undeployed slice is incomplete — shipping it IS convergence, per `brian-preferences` standing prod-auth + `no-staging-doctrine`); (4) a drift/hygiene fix surfaced by the cheap-confirm scan; (5) honest fast-no-op + escalate the gated tier. Fabricating a thin round is NEVER acceptable (§0 termination guard e).
- **Built-but-dark is NOT done.** A feature that is coded + tested + committed but unshipped does not count toward completeness. When a coherent slice is green and deploy is the next step, DEPLOY it (worker `wrangler deploy` + frontend R2 push + prod-E2E verify per `verification-loop`), then mark complete. Never accumulate committed-but-undeployed work waiting for a human — that violates `brian-preferences` § Production deploys.
- **Completeness is multi-dimensional — all must hold for §8 DONE:** every `_CONVERGENCE_BACKLOG.md` + `_LOOP_LEDGER.md` item closed-or-retired · every §4 surface (47 admin + 17 public + 54 route families + non-alias modules) has a green E2E + visual spec · 100% feature coverage in `FEATURES.md`/`COVERAGE.yml` · gorgeousness ≥8/10 on every user-visible surface · all gates green · prod-E2E green at 6bp · zero TODOs/stubs in shipped output · `completeness-checker` + `agent-diversity-review` both zero-recommendation.
- **The gated tier is part of completeness — surface it relentlessly until cleared.** Items needing a human unblock (a secret, a design call, a supervised window, a coordinated frontend+worker pass, a deploy authorization) are NOT "done" — they are BLOCKED. Every fire that hits the gated tier names the exact unblock command/decision so the human can clear it. The loop converges to completeness only as fast as the gates clear.
- **When the autonomous vein is genuinely dry, the highest-leverage move is often a deploy or a gorgeousness pass — try those BEFORE escalating.** Escalate (fast-no-op) only when (1) no feature/correctness slice is autonomously safe, (2) no user-visible surface needs beauty, (3) nothing built-but-dark can be safely deployed, AND (4) no drift/hygiene fix surfaced.

## 0.C — Whole-repo requirement scan + the SINGLE TODO ledger (every fire, before PICK)

> Completeness is only measurable against a complete work-list. The loop maintains ONE canonical TODO file and re-derives the gap from the repo itself — never trusting that the ledger is current.

- **`_LOOP_LEDGER.md` is the ONE canonical TODO file.** All open work lives there. `_CONVERGENCE_BACKLOG.md` folds into it; any other scratch TODO/`_ideas-*`/`AUDIT_*`/per-feature TODO collapses into `_LOOP_LEDGER.md` (a pointer line, then the scratch file is deleted per `repo-folder-hygiene`). A fire that finds a second open-work doc consolidates it that turn. Goal: a human (or a fresh Ralph) reads exactly one file to know everything left.
- **Requirement-scan each fire (cheap, before PICK):** re-derive unimplemented requirements from the repo, don't assume the ledger is complete — grep `TODO|FIXME|XXX` in `src/`, `npm run validate:features` drift, route handlers with no flag, flags with no manifest, modules with no E2E, `_CONVERGENCE_BACKLOG` items, and the **off-edge container roster (§0.D)**. New finds append to `_LOOP_LEDGER.md` with a priority band; the loop then PICKs against the refreshed list.
- **Count the off-edge plane into completeness.** The app is not "complete" while a declared container/service (llm/email/jobs/events/browser/analytics) is unlaunched or unwired — each is a ledger item with its edge-Worker adapter + tests + the gated launch step.

## 0.D — Off-edge service roster (Coolify behind CF Tunnel + CF Access SSO) — wire the adapters, gate the launch

> Per `projectsites-cloudflare-first` + `docs/INFRA_NOTES.md`. The CF edge is the hot path; these are the async/batch/data brain. **Every internal subdomain is CF-Access-SSO-protected** (service-token for the Worker, interactive for humans) — never public. Product code calls them ONLY through env-gated edge-Worker adapters (null/fallback when unconfigured), never directly.

- **`llm.projectsites.dev`** — vLLM (OpenAI-compatible, 2× 2080 Ti). Adapter `self_hosted.resolveSelfHostedLlm` (shipped) → `external_llm` `selfhosted` provider, API-fallback on 5xx. The `standard`/`instant` tier; premium stays Anthropic.
- **`img.projectsites.dev`** — ComfyUI/SDXL+Flux AI image-gen API. Adapter `self_hosted.resolveSelfHostedImage` (shipped) → `image_generation` first-try, DALL·E fallback.
- **`email.projectsites.dev`** — listmonk (one binary, SES SMTP relay). Edge Worker: host→`site_id`→listmonk-list scoping (Model A); dedicated container for heavy tenants (Model B).
- **`jobs.projectsites.dev`** — trigger.dev (self-hosted). · **`events.projectsites.dev`** — Inngest (self-hosted). · **`browser.projectsites.dev`** — Browserless/Playwright fallback tier. · **Tinybird** (managed OLAP, Plane H) + **Hatchet** (cloud orchestration) — secrets in get-secret.
- **Postgres LAW:** every Postgres DB is **Neon + Hyperdrive** (shard-level bindings), a **FRESH Neon database per app type** (`neon-{app}-{env}`) — never shared, never self-hosted. D1 stays edge-hot.
- **Launch is gated on `coolify.megabyte.space`.** Until it's live, the loop ships + tests the env-gated adapters (return null → paid fallback, zero behavior change) and surfaces the launch as a gated ledger item. Adapters land autonomously; container launch + secret-push + CF-Access wiring is the supervised step.

---

## 1 — One-time setup (skip the `[x]` items)

- [x] **Worker test-login seam** — `authenticateTestLogin` + `POST /api/auth/test-login`, secret-gated by `E2E_TEST_PASSWORD` (404 when unset — never a live backdoor), constant-time compare, idempotent owner upsert, real session. 7 Jest tests green.
- [x] **Wire `/signin` UI → the seam** (fire-v2.55) — `?test=1` renders a `data-testid="test-signin-panel"`; `ApiService.testLogin` → `POST /api/auth/test-login`; store bearer; redirect to sanitized `returnUrl`. 5 Karma specs green. (Live Playwright run still needs `E2E_TEST_PASSWORD` — see below.)
- [x] **`scripts/e2e-seed.mjs` + `e2e:seed`** — idempotent D1 owner upsert. ALREADY BUILT (real script: realistic UA, 404/401/!ok→exit-1, success→exit-0, safe to re-run; `e2e:seed` wired in package.json). Runs once `E2E_TEST_PASSWORD` is provisioned.
- [ ] **Provision `E2E_TEST_PASSWORD`** — `wrangler secret put` (prod) + `.dev.vars` (local); wire into both `playwright.prod.config.ts`.
- [ ] **`CONVERGENCE.md`** — write per-phase acceptance criteria (the rubric each critic checks). The loop reads it before every iteration.
- [ ] **Ledger is live** — `_LOOP_LEDGER.md` holds every open item (P0→P3), re-scanned each iteration.

---

## 2 — The per-item loop (RED → GREEN → … → CLOSE)

**Batch cadence: run 10 rounds per fire.** Each invocation closes **up to 10 ledger items** (10 full passes of steps 1-11 below) before reporting — not one. Track them as `Round 1/10 … 10/10`. Re-checkpoint `progress.md` after every round so a mid-batch crash resumes cleanly. **Stop the batch early** (and report) if ANY of: the ledger empties · a hard gate fails twice on the same item (escalate it, don't thrash) · the repetition detector trips · the per-fire token budget is exhausted · context hits 60% (checkpoint → the next fire continues). Honor the `max_parallel_agents`/budget caps ACROSS the whole batch, not per round. One round = one item end-to-end:

1. **PICK** the single highest-value open `[ ]` item from `_LOOP_LEDGER.md` — where **"highest-value" = highest SaaS-subscription-revenue $-impact** per the §5.0 lens (NOT just technical severity). Run prod gates first; inspect any NEW sections. **If the top-ranked revenue item is Brian-gated** (needs a secret / a design call / a supervised window — tagged `⛔gated` in the ledger), skip to the highest-ranked AUTONOMOUS item and note the gated one in the report. **The §0.B pick-order when no obvious feature slice tops the list:** (a) a real feature/correctness slice → (b) deploy built-but-dark work (a tested+committed+undeployed slice — shipping it IS convergence) → (c) a §0.A gorgeousness pass on the highest-traffic "merely-fine" surface → (d) a drift/hygiene fix from the cheap-confirm scan → (e) ONLY if a–d all genuinely empty, fast-no-op (read marker → cheap confirm → report) + escalate the gated tier with exact unblock commands. Never fabricate make-work; never skip straight to fast-no-op while a deploy or a gorgeousness pass remains.
2. **RED (tests-first halves thrash).** Write the failing test first: a Playwright E2E that starts at the homepage, signs in as `brian@megabyte.space` via the test password, navigates by clicks/keyboard only; plus Jest/Karma unit where logic warrants. Run it; watch it fail.
3. **GREEN.** Minimal "super-coded" change — full drop-in files, **zero stubs/placeholders**, god-tier-engineering patterns, **Spartan UI only** + cyan/black `--ps-*` tokens, `gorgeous-by-default` (enumerables → pills not CSV, `0.333s` transitions, `<app-rolling-counter>` on every stat, `appReveal` on every section, `:focus-within` on wrapped controls), RxJS-first at backend edges, **Zod at every boundary**, feature-flagged (`enabled=0, rollout=0, stage=experimental`) if non-trivial.
4. **REFACTOR + CLEAN.** Full lint stack in order: `oxlint → eslint --fix → prettier --write → stylelint → knip → jscpd → semgrep`, then `ng build` (AOT catches strict-template errors `tsc` misses) + worker/shared `tsc --noEmit`. Delete the dead code `knip` surfaces (only when no concurrent worktree touches it). Use `nx affected` / scoped test runs so each iteration only re-verifies what changed.
5. **VERIFY (Playwright Test-Agent triad, parallel).** Run planner→generator→healer. Default to **a11y-snapshot mode** (~230 tokens/step, CSS-resilient); reserve **AI vision** for canvas/chart surfaces + visual-regression diffs. Across **6 breakpoints (375/390/768/1024/1280/1920)**: **visual** (axe-core 0 violations, AI-vision rubric ≥8/10, screenshot every step) AND **technical** (console-error-free, no 4xx/5xx, CSP/Trusted-Types clean, INP ≤200ms). Worker Jest (902 suite) + shared Jest + frontend Karma green.
6. **EVAL gate** (for any AI-output surface). Score with the **60/30/10 mix**: 60% deterministic (schema/exact-match/latency), 30% LLM-as-judge, 10% human spot-check — never LLM-only. Auth/payment/AI surfaces also pass a **promptfoo red-team** probe. After deploy, harvest any anomalous prod trace into the eval dataset before closing.
7. **CRITIC gate** (§4) — a fresh adversarial reviewer must approve against `CONVERGENCE.md`. No advance without it.
8. **DOCUMENT.** Intent-level JSDoc on touched exports; update the section README, `e2e/FEATURES.md` + `e2e/COVERAGE.yml` (both worker + frontend), and the project `CLAUDE.md` for any changed surface.
9. **DEPLOY + PROD-E2E.** Build + deploy (worker via `wrangler deploy`, frontend via R2, container DOs via `container-deploy`) with `CLOUDFLARE_API_KEY` + `blzalewski@gmail.com`; verify changed routes live; purge. Push → treat **CI-green as the convergence signal**, not self-assessment.
10. **SELF-IMPROVE + GORGEOUSNESS advance (§0.A).** Ask: *"What brilliant addition would make this surface measurably better, what assumed-required feature is missing here, and is this surface now investor-demo gorgeous (≥8/10) or merely functional?"* If the touched surface is user-visible, advance ≥1 gorgeousness axis (§0.A) in THIS fire — never leave a surface merely-functional. Ship the best inline (`auto-integrate-recs`, <2h); append bigger finds to the ledger.
11. **CLOSE.** Check the item off; commit (conventional + gitmoji); emit `<promise>DONE: <id> (round N/10)</promise>`; loop to the next round (until 10 rounds done or an early-stop condition above fires), then report all 10.

---

## 3 — Builder / Critic adversarial split (mandatory)

"The agent that wrote the code is compromised." Every item runs through two distinct agents:
- **Builder** (Sonnet, speed) — writes the test + implementation.
- **Critic** (Opus, reasoning) — fresh context, reviews against the `CONVERGENCE.md` acceptance criteria + the Definition of Done (§7) + the hard gates (§7), returns **pass/fail with explanation**. Builder iterates until BOTH the critic and the tests pass.
- **Sequential critic for architecture decisions** (epistemic diversity beats parallel-merge's "Frankenstein" incoherence); **parallel fan-out only for independent feature branches** (disjoint files).

---

## 3.1 — Multi-section parallel convergence (the loop runs WIDE, then folds)

The loop is not one serial queue — the orchestrator runs **multiple convergence sub-loops in
parallel, one per disjoint SECTION**, and folds once. A "section" = an admin section, a worker
route-family, a feature module, a prompt cluster, or a quality axis (lint / jscpd / semgrep).

- **Decompose by file ownership.** Each fire, the orchestrator (Opus) picks the top **3-4
  sections (ceiling 6)** whose files do NOT overlap and spawns **one Builder per section**
  (Sonnet on the loop axis; DeepSeek for the app/build work per §0) + a shared **Critic**
  pass. Each sub-loop runs its OWN RED→GREEN→clean→verify on its files only (`nx affected` /
  scoped jest), per `parallel-subagent-economy` (fan out only when it saves ≥5 min).
- **Disjoint or worktree.** Sections sharing a hot file (root `index.ts`, a barrel, a
  migration, a design-token) run sequentially OR in `isolation: worktree` — never naive-parallel
  on a shared file (clobber). Emit the assignment table + rejected-agent note before spawning
  (`agent-selection`).
- **One fold, one build, one deploy.** Sub-loops return ≤200-word summaries; the orchestrator
  merges, runs the FULL gate suite once (§6), deploys once, verifies prod once.
- **Self-pushing (never runs dry while work remains).** Every sub-loop ends with the §2.10
  self-improve question and appends new finds to `_LOOP_LEDGER.md`, so the loop generates its
  own next fire. It terminates ONLY on §8.
- **Provider tiers apply per phase** (§0): Workers AI for the instant pre-routing that ASSIGNS
  sections, DeepSeek for the Builders, premium (Anthropic/OpenAI) for the Critic + architecture.

---

## 4 — Coverage manifest (the loop is NOT done until ALL of this is green)

Every surface below MUST end with a parallel-safe `*.e2e.ts` that signs in as `brian@megabyte.space` and exercises every clickable / form field / nav link / modal / keyboard shortcut / empty / loading / error state — axe-clean at 6bp, AI-vision ≥8, console-clean. Track in `e2e/FEATURES.md` + `COVERAGE.yml`; CI fails on any gap.

**Admin sections (47):** accept-invite · ai-chat-extras · ai-endpoints (+ code-editor, ide) · ai-logs · analytics · api-tokens · apps (+ detail, instances) · audit · billing · content-freshness · dashboard (+ calendar-widget) · deliverability · docs (+ endpoint, overview) · domain-stack · domains · editor · email · feature-flags (+ audit-timeline, badge-row, mode-switcher) · forms · inbox · logs-dashboard · logs-explorer · mcp · media · not-found · progressive-preview · pseo · seo · settings · site-branches · site-copilot · site-detail · site-dna · site-features · site-mcp-server · sites · snapshots · snapshots-diff · social · social-analytics · swarm · user-settings · voice (+ agent-settings, conversations, mcps, numbers, share, test-console) · webhooks

**Public/marketing pages (17):** blog · changelog · checkout · create · error · homepage · import-from-url · integrations · legal · press · review · roadmap · search · signin · status · super-admin · waiting

**Worker route families (54) — each needs Jest + a contract/E2E:** agency · agentic_commerce · agents · ai_admin · ai_endpoints_public · api · apps · assets · autofill · billing_addons · bolt_admin · concierge · copilot · dashboard · docs · domain_purchase · domain_stack · editor_chats · email_deliverability · env_vars · experiments · feature_e2e · features · forms · health · i18n · inbox · mcp_oauth · mcp_site · media · page_audio · pseo · pseo_matrix_v2 · public · pulse_analytics · review_links · review_public · search · seo_autopilot · site_branches · site_detail_tabs · site_dna · snapshot_quality · social · social_oauth · storefront · super_admin · templates · vision_qa · voice · voice_webhooks · wallet · webhooks · webhooks_admin

**Feature modules (48 dirs: 29 built · 9 partial · 7 stub · 3 alias):** every non-alias module reaches the 6-criterion DoD (§7). Alias shims (`inbox`/`public-api`/`swarm-editor`) are intentional — never delete.

**Prompts (15 `*.prompt.md` + `prompts/registry`) — "improve every prompt" is a tracked axis, not a one-off:** research_profile · research_brand · research_social · research_selling_points · research_images · generate_website · generate_multipage_site · generate_legal_pages · plan_site_structure · score_website · site_copy (a/b) · research_business · generate_site · score_quality. Each touch must leave the prompt measurably better AND carry a Zod I/O schema (`prompts/schemas.ts`) + an eval case set (§2.6 60/30/10) + a registered version.

**Two integrated idea-sets (60) — `AGENT_NATIVE_POSITIONING.md` §4-5 + `ROADMAP.md` § Capital efficiency:** the **30 agent-grade** MCP/OAuth/trust/reliability features + the **30 capital-efficiency** margin/revenue levers are LEDGER ITEMS, not a side doc. Each lands as a flagged module/change with its own E2E + 6-criterion DoD. **The loop is NOT done until all 60 are shipped or explicitly retired in `DECISIONS`.**

**E2E coverage target = 100%.** Every clickable / route / form field / nav link / modal / keyboard shortcut / empty / loading / error state across all sections above carries ≥1 green Playwright spec; `COVERAGE.yml` shows zero gaps; the worker + shared Jest suites hold **100% coverage thresholds on every touched module** (TDD-first — the failing spec precedes the code, always).

**AI context-quality axis (5 ship-first — "no generation on thin context"):** every AI surface must, before it generates, load FULL relevant context. The 5 enforced items:
1. **Context7 pre-step** — before the build agent writes any library code (React/Vite/Tailwind/Hono/Zod), pull current docs via Context7 so it codes against today's API, not stale memory.
2. **Labeled context blocks** — assemble context as `SYSTEM / RETRIEVED_FACTS / BRAND / CONSTRAINTS / EXAMPLES` sections (data, not instructions — also a prompt-injection defense per `ai-agent-security`).
3. **Context-readiness gate (0-100)** — score required-slots-filled × retrieval-hits × confidence; BLOCK generation below threshold + auto-fetch the gaps first (`confidence_attributes` feeds it).
4. **Rerank-before-pack** — retrieve broad (≈50), rerank via Workers AI BGE reranker to top-k, pack only the densest signal into the window.
5. **Context manifest in every trace** — log the hashed assembled context + section sizes + provenance per generation (PostHog `$ai_*` / AI Gateway) so a bad output is debuggable: model fault vs missing context.
Each is a flagged change with its own eval case (§2.6) + unit/E2E. DeepSeek economics fund the extra retrieval/rerank passes.

---

## 5 — Open-work ledger (re-scan every iteration)

> **Single merged backlog: `_CONVERGENCE_BACKLOG.md`.** It is the one file that absorbs every prior
> ideas/recs/features doc (`FEATURE_CATALOG.md`, `RESEARCH_IDEAS_2026H2.md`, `AGENT_NATIVE_POSITIONING.md`
> §4-5, `ROADMAP.md`, `EDGE_HOSTING_STRATEGY.md`) AND the six infra-architecture prompts. Read it FIRST
> each iteration alongside `_LOOP_LEDGER.md`; rank its items by the §5.0 lens; every plane/feature there
> carries its own ▸Technical/▸In-spirit/▸Philosophical/▸Business-&-flags requirements + a flag key.

### 5.0 — Value-ranking lens (the prime directive: drive SaaS-subscription revenue)

The mission is to make projectsites.dev a product people PAY a recurring subscription for, and to raise quality every fire so it compounds. Rank every open item by its impact on the subscription funnel, NOT by technical-severity label alone. The funnel:

`search → build → preview → UPGRADE (remove top-bar / publish / custom domain) → Stripe checkout → published → RETAINED (renews)`

Score each candidate item 1-5 on each lens, pick the highest total that is AUTONOMOUS-safe:

- **Conversion** — does it move a previewer to a paying subscriber? (upgrade CTA, checkout reliability, embedded-checkout UX, entitlement unlock, trust signals at the pay step)
- **Activation** — does it get a new user to their first published, gorgeous site faster / more reliably? (golden-path speed, build success rate, fewer dead-ends)
- **Retention** — does it reduce churn / keep sites live + impressive? (site uptime, quality that ages well, the admin surfaces that make a subscriber stay)
- **Trust** — does it make the pay decision safer? (no console errors / 5xx on money paths, security on billing/auth, honest copy — incl. the fabricated-people gate, working hyperlinks, fast CWV)
- **Quality-compounding** — does it raise the bar so EVERY future generated site / admin surface is better? (template polish, shared components, build-validator gates, eval harness)

Tie-breakers: prefer the item that is (a) autonomous (no Brian gate), (b) TDD-able now, (c) smallest blast radius. **A correctness/security bug ON a money path outranks a feature** — a broken checkout earns $0. Money paths (Stripe checkout/subscription/webhook/entitlements/publish-unlock) are P0-REVENUE by definition.

### 5.1 — Ledger priority bands (re-scan every iteration)

- **P0-REVENUE — money-path correctness + conversion funnel** (see `_LOOP_LEDGER.md § P0-REV`). Highest $-impact; do these first when autonomous.
- **P0 — finish the test harness** (§1 unchecked items).
- **P1 — highest-value features** (see `ROADMAP.md` — the single revenue-sorted build list): concierge widget injection · visitor-analytics beacon · voice receptionist at publish · native booking engine · GEO layer + citation tracking · edge per-visitor personalization · post-publish growth agent.
- **P1 — the 60 integrated ideas** (`AGENT_NATIVE_POSITIONING.md` §4-5 + `ROADMAP.md` § Capital efficiency): **30 agent-grade** MCP/OAuth/trust features + **30 capital-efficiency** levers. Rank each by §5.0. **The capital-efficiency flag-flips are near-free margin wins — do them EARLY:** turn the `org_ai_budget_cap`/`token_burn_meter` killswitch ON · route ALL external LLM + vision through AI Gateway always (+ normalize deterministic calls to `temperature<0.5` so the 1h cache hits) · default text generation to DeepSeek + instant work to Workers AI per §0 · wire `chargeWallet()` to every paid action (video/DALL·E/TTS/container) · gate the full container build behind paid-intent or a hard free-credit budget.
- **P2 — drift/security/cleanup:** `conversational_edits.ts` cross-tenant write guard (security) · `features.ts` ~33 `as`-cast handlers → Zod **per-feature on promotion, never mass-retrofit** · `big_bets.ts` 30 mock features → real backends per-flag · 44 knip-dead `features.ts` exports → remove · flag-cache one-liner (`features.ts` override-write must call `invalidateFlagCache`) · wire the `*.e2e.ts` prod suite into CI · ag-grid → TanStack perf wave (`docs/perf-wave-ag-grid-to-tanstack.md`) · LLM eval harness · pre-publish content guardrails.
- **P2 — TODO/FIXME sweep (14 in src):** Stripe refund stub (`super_admin.ts`) · impersonation JWT stub · agency-invite email stub · `seo_autopilot` site-serving wiring · Sora/Veo API placeholder · snapshot `commit_iso` gap · `revertSnapshot` FIXME.
- **P2 — ROADMAP.md Tier 3 + known-bugs:** ~36 dark-but-backed flags (verify + promote) · ~104 thin-404 flags (build or retire) · 8 genuinely-missing core modules · owner Features page (1/8 backed) · 7 logged-unfixed bugs.
- **P3 — per-section E2E + visual coverage** for all 47 admin sections + 17 public pages (§4).

---

## 6 — Definition of Done + Hard gates

**A feature module is DONE only with all 6:** (1) `manifest.ts` (7 fields); (2) D1 flag `enabled=0, rollout=0, stage=experimental`; (3) Zod at every boundary; (4) unit tests green; (5) `e2e/<slug>/` homepage-first Playwright signed in as `brian@megabyte.space`; (6) PostHog event + Sentry breadcrumb tagged `featureSlug`.

**Per-iteration hard gates (build-fail if missed):** deployed + purged · Playwright green 6bp · AI-vision ≥8/10 · axe 0 · Lighthouse A11y ≥95 / Perf ≥75 · zero errors/stubs/TODOs in shipped output · CSP L3 strict-dynamic + nonce · Trusted Types · all hyperlinks valid · INP ≤200ms · JSON-LD accurate-only · every new feature flagged · knip/jscpd/semgrep clean · **`validate:features` drift = 0** (CI `feature-architecture.yml --strict` is a merge-blocker) · resurrection-guard clean.

---

## 7 — Context + cost discipline

- Checkpoint to `progress.md` (≤30 lines: what's done, what's next, the active item) at 60% context → continue in a fresh session.
- One fold, one build, one deploy per iteration — subagents NEVER build/commit/deploy independently; they return ≤200-word summaries.
- Read shared context (schema/brand-tokens/fixtures) ONCE in the orchestrator; pass a 100-300-word slice into each subagent brief — never have N agents re-grep the same files.
- Per `parallel-subagent-economy`: fan out only when it saves ≥5 min wall-clock AND units are disjoint; 3-4 wide, ceiling 6.

---

## 8 — Termination (the loop is DONE only when ALL hold)

1. `_LOOP_LEDGER.md` AND `_CONVERGENCE_BACKLOG.md` have zero open `[ ]` items (closed or explicitly retired in `DECISIONS`).
2. Every §4 surface (47 admin + 17 public + 54 route families + non-alias modules) has a green E2E + visual spec listed in `FEATURES.md`/`COVERAGE.yml`.
3. `knip` + full lint stack + `validate:features` + resurrection-guard all clean.
4. All CI workflows green; prod E2E green at 6bp. **Nothing built-but-dark** — every coded+tested slice is DEPLOYED + verified live (§0.B).
5. A final **`completeness-checker`** pass (Feature Completeness Engine + Zero-Recommendations gate) AND **`agent-diversity-review`** pass — both with zero recommendations.
6. **Gorgeousness floor (§0.A):** every user-visible surface (47 admin + 17 public + the generated-site template) scores **≥8/10** on the AI-vision rubric + axe 0 violations at 6bp — verified, not asserted. No surface is "merely functional."
7. **Gated tier empty:** zero items blocked on a human unblock (every secret provisioned, every design call made, every coordinated pass shipped). A non-empty gated tier means the loop is BLOCKED, not DONE — keep escalating it.

If any of 1–7 fail, the loop is NOT done — close the gap, deploy, or escalate the exact unblock. The loop converges to completeness AND beauty together; neither alone is "done."

If any fail, it is NOT done — fix-forward in the same session.

---

## 9 — Self-evolution

After each major session, the meta-orchestrator proposes improvements to THIS prompt (gaps it hit, new SOTA, recurring failure modes) and folds confirmed lessons back into `~/.agentskills` + this file the SAME turn (`prompt-as-training-signal`). The convergence prompt improves itself.

---

### Run it
- **Each fire = 10 rounds.** Per invocation, close 10 ledger items end-to-end (RED→GREEN→clean→verify→eval→critic→doc→deploy→self-improve→CLOSE per round), re-checkpoint `progress.md` between rounds, then report all 10 (or fewer if an early-stop in §2 fired).
- Direct: *"Execute `apps/project-sites/_ULTIMATE_LOOP.prompt.md` — run 10 convergence rounds; commit + `<promise>DONE: <id> (round N/10)</promise>` each."*
- Scheduled: `/loop 30m Execute apps/project-sites/_ULTIMATE_LOOP.prompt.md` (each 30-min fire runs the 10-round batch).
- Each fire is a FRESH context that reads `progress.md` + `git log` + `_LOOP_LEDGER.md` first.
