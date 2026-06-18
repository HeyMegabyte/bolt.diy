# Feature Backlog — projectsites.dev

> Single source of truth. Cross-referenced against `libs/features/` (36 modules) and
> `src/modules/feature_flags/registry.ts` (47 registered flag keys).
> Sources: RESEARCH_IDEAS_2026H2, EDGE_HOSTING_STRATEGY, ROADMAP, FEATURE_CATALOG,
> .claude/RECS.md, e2e/FEATURES.md.
> Last updated: 2026-06-17.

Legend: ✅ BUILT (libs/ module + flag registered) | 🟡 PARTIAL (flag or service exists, module or UI missing) | ⬜ REMAINING (not yet started)

---

## ✅ BUILT — 36 modules (libs/features/ + registry confirmed)

| Slug | Name | Notes |
|------|------|-------|
| `abuse_takedown` | Abuse & Takedown | |
| `admin-detail` | Admin Site Detail | flag key: `core_admin_detail` |
| `aeo_pass` | AEO Pass | |
| `ai_concierge_widget` | AI Concierge Widget | |
| `ai_gateway_guardrails` | AI Gateway Guardrails | |
| `auth` | Authentication | flag key: `core_auth` |
| `billing` | Billing | flag key: `core_billing` |
| `cmdk_ai_actions` | Cmd+K AI Actions | |
| `credit_wallet_rollover` | Credit Wallet Rollover | |
| `edge_personalization` | Edge Personalization | |
| `email_deliverability_wizard` | Email Deliverability Wizard | |
| `email_marketing` | Email Marketing | |
| `feature-flags` | Feature Flags Admin | flag key: `core_feature_flags` |
| `gbp_assist` | Google Business Profile Assist | |
| `mcp_oauth_provider` | MCP OAuth 2.1 Authorization Server | |
| `native_booking_engine` | Native Booking Engine | |
| `outbound_webhooks` | Outbound Webhooks | |
| `payments_rail` | Unified Payments Rail | |
| `platform_mcp` | Platform MCP Server | flag key: `mcp_server` |
| `prompt_studio` | Prompt Studio | |
| `pseo_matrix` | pSEO Matrix v2 | |
| `referral_loop` | Referral Loop — Viral Credit Engine | |
| `search_submit` | Search/AI-Engine Auto-Submit | |
| `seo_autopilot` | SEO Autopilot | includes `speculation_rules`, `structured_data_autopilot`, `quotable_answer_block` |
| `site_analytics` | Site Analytics | |
| `site_semantic_search` | Site Semantic Search | |
| `site_thumbnail_grid` | Site Thumbnail Grid | |
| `site-create` | Site Creation | flag key: `core_site_create` |
| `status_page_live` | Status Page Live | |
| `storefront_ecommerce` | AI Storefront and Product Catalog | |
| `token_burn_meter` | Token-Burn Meter + Budget Killswitch | |
| `unified_inbox` | Unified Visitor Inbox | |
| `url_clone_seed` | URL Clone Seed | |
| `visitor_events_core` | Visitor Events Core | known bug: cross-tenant guard missing in `conversational_edits.ts` — see FEATURE_CATALOG |
| `visual_point_edit` | Visual Point Edit | |
| `wireframe_planning` | Wireframe Planning | |

---

## 🟡 PARTIAL — flag or service exists, module or UI incomplete

| Item | What Exists | What's Missing |
|------|-------------|----------------|
| `site_mcp_server` | flag in registry + route at `src/routes/` | no `libs/features/` module; just extends `platform_mcp` — wrap into a module |
| `ai_auto_router` | flag in registry | no libs/ module, no service found |
| `site_video_gen` | flag in registry | no libs/ module — likely a `src/services/` stub |
| `editor_vision_qa` | flag in registry | no libs/ module |
| `trust_center` | route at `src/routes/trust.ts` + tests | no libs/ module; needs manifest + flag wiring |
| `llms_txt` | flag in registry | inline handler in `src/index.ts`, no dedicated module |
| `accessibility_statement` | flag in registry | inline handler, no module |
| `pwa_manifest_full` | flag in registry, `getPwaManifest` service fn | no dedicated module beyond the service fn |
| `social_ai_ui` | `summarizeConversation`, `repurpose`, `translateContent` service fns in unified_inbox | UI entry-points missing — no button/panel to invoke repurpose or translate |
| `social_best_time` | per-platform best-time model in service | no per-account model config UI |
| `auto_reply_threshold` | 0.85 confidence threshold hard-coded | not exposed in any settings UI |
| `social_analytics_backfill` | analytics snapshot service exists | no cron to backfill first 30d of data |
| `contacts_core` | migration applied, D1 table exists | not confirmed in registry; flag status unknown |

---

## ⬜ REMAINING — ranked by revenue / strategic impact

### TIER 0 — Direct revenue (build first)

| # | Slug | One-line spec | Classification |
|---|------|--------------|---------------|
| 1 | `dunning_recovery` | Stripe webhook listener → retry failed payments → downgrade org after N failures → email notice via Resend | **(A) buildable now** |
| 2 | `credit_wallet_metering` | Per-org D1 ledger tracking AI token spend against soft/hard caps; decrement on each generation; block at hard cap | **(A) buildable now** |
| 3 | `org_ai_budget_cap` | Admin-settable monthly AI spend ceiling per org; killswitch disables AI features when exceeded; resets on billing cycle | **(A) buildable now** |
| 4 | `membership_paywall` | Stripe-gated page sections (`paywalled: true` in site config); visitor hits Stripe Checkout; posts to `site_members` D1 table on success | **(A) buildable now** |

### TIER 1 — Conversion / Retention

| # | Slug | One-line spec | Classification |
|---|------|--------------|---------------|
| 5 | `onboarding_copilot` | Step-by-step "next action" guide for new orgs (no published site, no domain, no analytics); surfaces from admin dashboard as a dismissible guided checklist | **(A) buildable now** |
| 6 | `prod_readiness_score` | Scoring engine (0-100) checking: SSL, custom domain, analytics wired, sitemap submitted, LCP<2.5s, structured data valid; surfaces in admin as a progress badge | **(A) buildable now** |
| 7 | `deploy_buttons` | One-click Cloudflare Pages / Vercel / Netlify deploy buttons for generated sites; writes deploy config to R2 and redirects to provider | **(A) buildable now** |

### TIER 2 — Infrastructure / Platform moat

| # | Slug | One-line spec | Classification |
|---|------|--------------|---------------|
| 8 | `run_code_sandbox` | Cloudflare Sandbox SDK `run_code` MCP tool; executes arbitrary JS/TS in isolated sandbox for agent-generated code validation before publish | **(B) big/needs-decision** — requires Sandbox SDK beta access |
| 9 | `db_per_app` | Per-site D1 database provisioned via Workers for Platforms; site config references its own DB binding; total isolation | **(B) big/needs-decision** — architecture decision: Workers for Platforms billing + migration strategy |
| 10 | `do_per_app_actor` | Durable Object per live site for stateful actor (presence, real-time counters, per-site state); replaces current KV-poll approach | **(B) big/needs-decision** — D0 + DO topology change, session-scope work |
| 11 | `ag_ui_streaming` | Replace 5s progress poll in site-generation workflow with AG-UI SSE stream; frontend subscribes to typed event stream | **(B) big/needs-decision** — requires AG-UI library + Workflow SSE adapter |
| 12 | `x402_micropayments` | x402 HTTP payment header support for agent-initiated billing; per-tool-call micro-billing via Stripe Machine Payments Protocol | **(B) big/needs-decision** — x402 spec still evolving; Stripe MMP in beta |
| 13 | `wasm_validation_gate` | WASM sandbox to validate generated site build output before R2 publish; deterministic, no network access | **(B) big/needs-decision** — WASM runtime in Workers has size/perf constraints to evaluate |

### TIER 3 — Trust / Ops

| # | Slug | One-line spec | Classification |
|---|------|--------------|---------------|
| 14 | `visitor_dsar` | GDPR data subject access request endpoint (`GET /api/visitor-data?email=`) returns all D1 rows for that visitor; 30-day deletion cron | **(A) buildable now** |
| 15 | `newsletter_engine` | Resend audience list + campaign composer; double-opt-in via transactional email; per-site subscriber list in D1; send via Resend batch | **(A) buildable now** |
| 16 | `audit_trail_enhanced` | Immutable append-only D1 ops log with structured `{actor, action, resource, before, after, ip, ua}` rows; admin UI with filter/export | **(A) buildable now** |
| 17 | `quota_dashboard` | Per-org AI spend dashboard: burn rate chart (ECharts), daily/monthly token counts, cost projection, alert thresholds | **(A) buildable now** |
| 18 | `agent_test_harness` | Unit test runner for site-generation agents; mocked LLM responses + fixture sites; CI integration for prompt regressions | **(B) big/needs-decision** — requires eval framework design first |

### TIER 4 — UI completions / E2E unblocking

| # | Slug | One-line spec | Classification |
|---|------|--------------|---------------|
| 19 | `social_ai_ui_extensions` | Add repurpose/translate/schedule UI entry-points to unified_inbox post-detail panel; wires to existing service fns | **(A) buildable now** |
| 20 | `social_analytics_backfill` | Cron trigger to backfill `social_analytics_snapshots` for first 30 days after connect; fills the "0 data" gap on new connections | **(A) buildable now** |
| 21 | `task_tray_seed_endpoint` | `POST /api/internal/inbox/seed` for E2E test seeding (TDD-RED specs in e2e/FEATURES.md exist but can't run); admin-only, flag-gated | **(A) buildable now** |
| 22 | `mcp_scoped_env_vars_ui` | Scoped env var UI inside MCP card (per-tool env overrides); referenced in e2e/FEATURES.md as missing | **(A) buildable now** |

---

## Known bugs (not features — fix in-turn)

| Bug | Location | Fix |
|-----|----------|-----|
| Cross-tenant read leak | `src/services/conversational_edits.ts` — no `org_id` scoping in WHERE | Add `AND org_id = ?` to all queries |
| Cross-org publish | `src/routes/content.ts` `publishRewriteDraft` — missing ownership guard | Check `site.org_id === session.orgId` before publish |
| Flag cache stale 60s | `src/routes/features.ts:387` — override write never calls `invalidateFlagCache` | One-liner: call `invalidateFlagCache(env, key)` after D1 write |
| 44 knip-dead exports | `src/services/features.ts` — 44 exported fns confirmed unused by Knip | Delete in a quiet-tree session; do not delete while other worktrees are active |

---

## Summary counts

- **✅ BUILT:** 36 modules
- **🟡 PARTIAL:** 13 items (flag/service exists, needs module or UI)
- **⬜ REMAINING:** 22 items (0 code exists)
  - **(A) buildable now (independent modules):** 14 items (#1-7, #14-17, #19-22)
  - **(B) big/needs-decision:** 6 items (#8-13, #18)
- **Bugs (not features):** 4 known, fix in-turn

---

## Build progress (2026-06-18, orchestrated fan-out)

**SHIPPED this session — 5 new modules (built by parallel fresh-context agents; orchestrator wired mounts/flags single-writer; deployed dark behind off-flags):**
- ✅ `prod_readiness_score` — GET /api/sites/:siteId/readiness (19 tests) — deploy f2b4f424
- ✅ `deploy_buttons` — GET /api/deploy-buttons/:siteId (8 tests) — deploy f2b4f424
- ✅ `visitor_dsar` — POST /api/sites/:siteId/dsar (12 tests) — deploy f2b4f424
- ✅ `onboarding_copilot` — GET /api/onboarding/checklist (14 tests) — deploy 0aa27eb9
- ✅ `audit_trail_export` — GET /api/audit/export (15 tests) — deploy 0aa27eb9

**REMAINING (A) — deferred with reason (avoid duplicate/migration/conflict per the rules):**
- `org_ai_budget_cap`, `quota_dashboard`, `credit_wallet_metering` — likely OVERLAP `token_burn_meter` / `credit_wallet_rollover` (already built); need a dedupe pass before building, not blind.
- `newsletter_engine`, `membership_paywall` — need a NEW D1 table (migration); the repo's migration state is fragile (commented-out DO migrations) → do deliberately, not in a parallel agent.
- `dunning_recovery` — touches shared `webhooks.ts` (Stripe) → single-writer, not parallel.
- `social_ai_ui_extensions` — FRONTEND (Angular) → blocked by the active concurrent convergence session editing frontend files.
- `social_analytics_backfill` — a cron touching the shared scheduled handler in index.ts → single-writer.

**(B) big/needs-decision (unchanged):** run_code_sandbox, db_per_app, do_per_app_actor, ag_ui_streaming, x402_micropayments, agent_test_harness.

## Provider-platform loop (cron 59e1dbb3) — progress
- ✅ slice 1: DeepSeek Claude Code setup — scripts/setup-claude-deepseek.sh + verify + docs (commit 885f75f6; verify 8/8 + negative-test)
- ✅ slice 2: `model_registry` — OpenAI-compatible GET /v1/models + ProviderCapabilityRegistry + ModelAliasRegistry (commit; deploy 8eac35ac; flag ON; LIVE: object:list, 13 aliases incl premium-quorum/deepseek-code/grok-live-business). The /v1 surface the AiRouter hangs off.
- NEXT: the AiRouter request seam — `AiRouterService` resolving a model alias → provider via the registries, with `RouterDecisionStore` (D1) recording route+model+why+cost+latency (the trace side-effect every other provider feature asserts). Then `/v1/chat/completions` (OpenAI-compatible) routing deepseek-default through external_llm, writing a router_decisions row. Then LiteLLM container scaffold (containers/litellm).
