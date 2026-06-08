# UNFINISHED FEATURES — completion audit

> Full-project scan of `projectsites.dev` (worker + Angular admin + `libs/features`) to enumerate
> everything still needed to "finish the project," plus the complete feature-flag ledger.
> Generated 2026-06-07 by auditing `src/modules/feature_flags/registry.ts` (flag SSOT),
> every `libs/features/*/feature.manifest.ts`, `src/routes/`, the admin frontend, and the
> logged-but-unfixed items in `FEATURE_CATALOG.md` + `CONVERGENCE.md`.
>
> **Companion docs:** `FEATURE_CATALOG.md` (de-stub source of truth) · `_ULTIMATE_COMPLETION.md` (doctrine).
> **Method note:** per-flag "backing" status is derived from the module-build audit, not raw grep
> (many dark flags appear only as a catalog-array string or a thin 404-ing `features.ts` handler).

---

## 0. Executive summary

| Dimension | Count |
|---|---|
| **Feature flags (registry SSOT)** | **33** (was 155 — 125 removed, 3 added 2026-06-07; see §9–§11) |
| — LIVE (stage `stable`, `default_enabled:true`) | 12 |
| — DARK but BACKED by a real module (verify + promote) | ~36 |
| — DARK, NEEDS BUILD (registry flag / thin 404 handler only) | ~104 |
| — DEPRECATED / ALIAS shims (no action / cleanup only) | 3 |
| **`libs/features` modules** | 48 dirs |
| — BUILT (manifest + service + handlers + tests + mounted) | 29 |
| — PARTIAL (real code scattered in `src/routes`, not colocated / untested) | 9 |
| — STUB (manifest/README only, no impl) | 7 |
| — ALIAS (intentional drift-shims — leave) | 3 |
| **Genuinely-missing modules (no dir at all)** | 8 core/owner features |
| **Owner-facing "Features" page** | 1 of 8 features backed (donations only) |
| **Logged-but-unfixed bugs** | 7 |

**The one-line truth:** the backend skeleton is broad (155 flags reserved) but ~2/3 of flags have
no real implementation, the owner-facing **Features** page is a frontend catalog with **7 of 8
features hollow** (no backend), and the worker `/api/site-features` toggle persists state for
features that have no handler to serve them. "Finishing" = implementing the dark flags' backends,
wiring the 8 owner features, promoting the built-but-dark modules, and closing 7 logged bugs.

---

## 1. Feature-flag ledger (all 155)

### 1a. LIVE — stable + enabled (12) ✅ done
`core_auth` · `core_admin_detail` · `core_site_create` · `core_feature_flags` (always-on sentinels) ·
`speculation_rules` · `structured_data_autopilot` · `quotable_answer_block` · `llms_txt` ·
`accessibility_statement` · `mcp_server` · `public_api` · `cli_tool`

### 1b. DEPRECATED / ALIAS (3) — DO NOT DELETE (intentional drift-shims)
`alias_swarm_editor` · `alias_inbox` · `alias_public_api`

### 1c. DARK but BACKED by a real module — finish = VERIFY + PROMOTE, not build (~36)
These have a BUILT or PARTIAL `libs/features` module (or live `src/routes` handler). Remaining work
is route-layer tests, the logged ownership/bug fixes (§5), flag promotion experimental→beta→stable,
and a clean batch deploy. Each is `default_enabled:false, stage:experimental` today.

**Capture/CRM core:** `contacts_core` · `site_analytics` · `visitor_events_core` (⚠ no live producer — needs beacon, §6) · `email_marketing` · `data_export` · `donations_engine`
**Growth/marketplace:** `affiliate_program` · `agency_white_label` · `referral_loop` · `stripe_marketplace` · `template_marketplace` (PARTIAL) · `plugin_marketplace` (PARTIAL) · `section_marketplace` · `public_gallery` · `token_burn_meter`
**SEO/reputation:** `seo_autopilot` (PARTIAL) · `gbp_assist` · `review_synthesis` · `review_requests` · `review_responder` · `reputation_monitor` · `search_engine_submit` · `comparison_pages` · `integration_directory` (PARTIAL) · `pseo_matrix_v2` (PARTIAL)
**Editor/content:** `conversational_editing` · `content_freshness` (PARTIAL) · `automation_builder` (PARTIAL) · `bulk_site_ops` (PARTIAL)
**Enterprise wave:** `trust_center` (PARTIAL) · `stripe_app_status` (PARTIAL) · `enterprise_plan` · `audit_hash_chain`
**Inbox:** `unified_inbox` · `multimodal_intake` (manifest says PARKED) · `public_api_v1`

### 1d. DARK, NEEDS BUILD — registry flag only / thin 404 handler, NO real backend (~104)
Grouped by the registry's own sections. These are the bulk of "unfinished." Most are gated handlers
in the `src/routes/features.ts` grab-bag that **404 in prod** (no implementation behind them).

**Compete-or-die:** `multi_model_router` · `db_provisioning` · `github_sync` · `snapshot_rollback` · `streaming_generation`
**Multi-tenant / agency:** `wfp_dispatch` · `egress_control` · `agency_tier` · `tenant_hot_state` · `whitelabel_admin`
**Core Web Vitals:** `cwv_publish_gate` · `rum_telemetry` · `critical_css_inline` · `image_triplet_pipeline` · `speed_score_widget`
**GEO:** `geo_visibility_tracker` · `cornerstone_autorefresh`
**Accessibility:** `axe_publish_gate` · `ai_alt_text` · `wcag22_wizard` · `oklch_contrast_lift`
**Editor UX:** `section_overlay` · `voice_editing` · `diff_revert` · `crdt_coedit` · `approval_workflow`
**Monetization:** `stripe_meters` · `upsell_campaign_month3` · `referral_credits` · `cost_attribution`
**Observability:** `workflows_v2_sitegen` · `otlp_unified_events` · `tenant_sentry_releases` · `slo_tracker`
**Media gen:** `veo_hero_loop` · `page_podcast` · `runway_style_ref` · `logo_regenerator`
**Platform ext:** `mobile_admin`
**Gap surface:** `i18n_auto_locale` · `pwa_manifest_full` · `web_push` · `auto_changelog` · `tier_rate_limit`
**"10 brilliant":** `site_mcp_server` (partial FE) · `cold_tier_thaw` · `ai_auto_router` · `ghost_routes` · `speed_compare_widget` · `auto_gen_static_files` · `hallucination_guard` · `visitor_recognition` · `faq_from_tickets` · `competitor_monitor`
**Round-2 admin UX:** `sparkline_overlays` · `split_view_drawer` · `row_hover_actions` · `saved_views` · `predicted_actions`
**30 big-bet engines:** `visual_editor_drag_drop` · `ecommerce_engine` · `native_booking_engine` · `lms_engine` · `community_engine` · `newsletter_engine` · `membership_paywall` · `native_mobile_admin` · `native_desktop_admin` · `browser_extension` · `chat_ops_bot` · `soc2_program` · `hipaa_variant` · `pci_dss_l1` · `enterprise_sso` · `d1_multi_region` · `byo_cloudflare` · `worker_marketplace` · `domain_reseller` · `brand_voice_clone` · `ai_agent_marketplace` · `customer_site_copilot` · `ai_video_courses` · `ai_ab_test_generator` · `sms_marketing` · `loyalty_engine` · `crm_engine` · `cdp_engine`
**IDE / multi-agent:** `ide_sandbox` · `multi_agent_concurrent` · `progressive_skeleton_build`
**Content/pSEO:** `pseo_matrix_builder` · `vertical_templates` · `public_changelog`
**Domain/logs:** `domain_stack_wizard` (STUB module) · `log_explorer` (STUB module)
**Inbox/copilot:** `multimodal_copilot`
**Swarm:** `swarm_editor` (STUB) · `live_stream_preview` · `site_dna_taste_graph`
**Native editor:** `native_editor` (partial FE route)
**Marketplace/creator:** `ai_components` (STUB — schema+test, no service)
**Enterprise SDK:** `agent_sdk_mcp` (STUB)
**Email:** `email_deliverability_wizard` (STUB) · `outbound_webhooks` (STUB)

> ⚠ Per `apps/project-sites/CLAUDE.md` Known-Issue #10: `features.ts` has 123 flag-gated handlers,
> NONE of which overlap the 12 enabled flags → every one **404s in prod**. They are scaffolding,
> not shipped features. Mass-retrofit forbidden; build/validate per-feature on promotion.

---

## 2. Genuinely-missing modules (no `libs/features/<x>` dir at all)

From `FEATURE_CATALOG.md` STEP 1/2 cross-checked against the live tree:

| Module | Catalog ref | Notes |
|---|---|---|
| **`payments_rail`** | STEP 1 core | Shared Square + Stripe-SaaS + Stripe-Connect idempotency/webhook seam. **Unblocks booking, donations capture, marketplaces.** Build FIRST. |
| **`native_booking_engine`** | STEP 2, "highest local value" | Flag `native_booking_engine` exists + owner-Features card exists; **no module, no handler**. Cal.com-class. → needs `payments_rail` + `contacts_core`. |
| **`newsletter_engine`** | owner-Features card | Flag exists; distinct from `email_marketing`. No module. |
| **`ecommerce_engine`** / `storefront_ecommerce` | STEP 2 (DECISION NEEDED) | Medusa.js (Neon + Upstash + R2 + Docker on Container DO). Large; own session. |
| **`membership_paywall`** | owner-Features card | Flag exists; no module. |
| **`enterprise_sso`** | owner-Features card | SAML/OIDC native; flag exists; no module (Clerk is current auth). |
| **`brand_voice_clone`** | owner-Features card | ElevenLabs consent-gated; flag exists; no module. |
| **`ai_concierge_widget`** | STEP 2 | Visitor-facing site chat/voice. CONFIRMED GAP (`ai_components` is builder-side codegen, not a visitor widget). Maps loosely to `customer_site_copilot` flag. |
| **`onboarding_copilot`** | STEP 2, mandated CLAUDE.md PART 6 | No module. |
| **`media_library`** | STEP 2 | Owner DAM (R2). Distinct from builder `src/services/media.ts`. No module. |
| **`i18n_localization`** | STEP 2 | Locale-mirror module (flag `i18n_auto_locale`). No module. |

> `ab_testing` (STEP 2) is effectively shipped as the `experiments` route/module (A/B + predictive
> prerender, hardened in convergence fire 30) — not missing. Flag `ai_ab_test_generator` is the
> AI-variant generator layer, still unbuilt.

---

## 3. Owner-facing "Features" page — backend wiring gap (HIGH priority)

`frontend/.../admin/sections/site-features.component.ts` shows an 8-feature owner catalog.
Worker `GET/POST /api/site-features[/:key]` exist (`src/routes/features.ts`) BUT the catalog is
**frontend-complete, backend-hollow** — toggling persists state for features that have no handler
to serve them on the published site.

| Owner feature key | Backend module? | Serves on published site? | Action |
|---|---|---|---|
| `donations_engine` | ✅ YES | ✅ wired | verify + promote |
| `native_booking_engine` | ❌ no | ❌ | **BUILD module** (§2) |
| `newsletter_engine` | ❌ no | ❌ | **BUILD module** (§2) |
| `ecommerce_engine` | ❌ no | ❌ | **BUILD (Medusa)** (§2) |
| `membership_paywall` | ❌ no | ❌ | **BUILD module** (§2) |
| `enterprise_sso` | ❌ no | ❌ | **BUILD module** (§2) |
| `brand_voice_clone` | ❌ no | ❌ | **BUILD module** (§2) |
| `site_mcp_server` | ⚠ partial | ⚠ | finish + verify |

> Also tied to this surface (per memory `two-layer-features-plane` + `stale-route-fake-empty`):
> the worker `/api/site-features` route was 404ing on prod → Features showed a read-only fallback
> catalog (the "Features shows nothing under brian@megabyte.space" report). Frontend now degrades
> gracefully; **making toggles live requires the per-feature backends above + a clean worker deploy.**

---

## 4. Stub & partial modules to finish (`libs/features`)

**STUB (manifest/README only — build service + handlers + tests, then mount):**
- `agent_sdk_mcp` — public Agent SDK + MCP server packages
- `ai_components` — has schema + 1 test but NO `service.ts`/`handlers.ts`
- `domain-stack` (`domain_stack_wizard`) — 7-step domain wizard
- `logs-explorer` (`log_explorer`) — worker tail log explorer + FTS
- `swarm_editor` — multi-agent swarm editor (non-alias variant)
- `email_deliverability_wizard` — SPF/DKIM/DMARC scorer (logic lives in `src/routes/email_deliverability.ts`; colocate)
- `outbound_webhooks` — customer webhook subscriptions (signed, retried)

**PARTIAL (real code in `src/routes`, drift — colocate into the module + add tests):**
- `automation_builder` · `bulk_site_ops` · `content_freshness` · `integration_directory` ·
  `plugin_marketplace` · `pseo_matrix` / `pseo_matrix_v2` · `stripe_app_status` ·
  `template_marketplace` · `trust_center` · `seo_autopilot`

---

## 5. Logged-but-unfixed bugs (from FEATURE_CATALOG / CONVERGENCE)

1. **`conversational_editing` cross-tenant gap** — `/api/conversational-edits/*` routes (`:siteId`/`:changesetId`) verify auth + flag but NOT org-ownership → cross-tenant read+write by id-guessing. Dormant (flag off). Fix: `assertSiteOwned(c, siteId)` on the 4 `:siteId` handlers + resolve changeset→site for the diff route. (~1hr, fire-36.)
2. **`stripe_app_status` lifecycle — no Stripe-signature verification** on the unauthenticated marketplace callback → forged install events for arbitrary `org_id`. Needs Stripe App callback signing scheme + secret.
3. **`template_marketplace.recordPurchase`** accepts a buyer-supplied `stripe_payment_intent` with no Stripe-side verification (webhook-vs-user-facing ambiguity); `buyer_site_id` not validated. Design call.
4. **Referral attribution** (template_marketplace) — collusion between two real accounts still possible; move to platform-tracked referral codes.
5. **Audit-log UUID tightening** — Zod requires UUID `org_id` but platform contact form uses `'system'` and tests use `'org_1'` → 2 red suites (`billing`, `service_error_paths`). OWNER decision: relax schema to allow `'system'` or confirm UUID-only.
6. **`UNSUBSCRIBE_SECRET`** — unsubscribe links HMAC with `STRIPE_WEBHOOK_SECRET` (key reuse); provision a dedicated secret.
7. **`integration_directory` route-layer test gap** — service `siteOrgId()` unit-tested; the route gate covered only indirectly (awkward `db.js` mock). Add a dedicated route-layer pass.

---

## 6. Stubbed code paths / "coming soon" / deferred (TODO sweep)

**Worker stubs:**
- `src/routes/templates.ts:128` — TODO: debit wallet for `price_cents` (paid templates).
- `src/routes/agency.ts:97,121` — TODO ×2: send client-invite email via Resend (invites not mailed).
- `src/routes/super_admin.ts:583` — refund records intent only; no real Stripe refund API call.
- `src/routes/super_admin.ts:891` — impersonation: short-lived signed JWT not yet issued.
- `src/routes/ai_admin.ts:868,876` — LLM-backed AI-admin features are placeholder/"coming soon" stubs.
- `src/services/seo_autopilot.ts:473,494` — publish path is D1-only stub; should call `site_serving.applySeoMeta(env, draft)`.
- `src/routes/social.ts:607` — schedule-publish path returns **501 NOT_IMPLEMENTED** (deferred).
- `src/routes/media.ts:18` — Sora/Veo video generation = queued stub.
- `src/services/ai_endpoints_ide.ts:8` — Python + Rust-WASM runtimes stubbed (JS only live).
- `src/durable_objects/app_runtime.ts:33` — unsupported installed-app → "coming soon" interstitial.

**Admin UI affordances (disabled / "coming soon"):**
- Settings → **Email** tab: "Bring your own SMTP / Configure SMTP" button disabled + "Coming soon" pill (`data-testid=email-smtp-configure`) — needs worker-backed SMTP persistence (§7).
- `ai-endpoints.component.ts` — frontend renders, backend partial → "coming soon" toast.
- `seo.component.ts` — "coming soon" pill on unbuilt sub-section.
- `apps.component.ts` / `apps-detail.component.ts` — "Coming soon" lifecycle pills for unprovisioned catalog apps (424 by design).

**Deprecation (cleanup, not feature work):**
- `src/index.ts:146-157` — Pulse Inbox 410-stub; safe to delete after 2026-08-01 (Wave 3).
- `AdminFeaturesHubComponent` — unrouted/dead since Features Hub retirement; `git rm` when no worktrees active.

---

## 7. Queued worker-backed work (push-gated; Docker-blocked locally)

- **SMTP / outgoing-mail persistence** — worker route to store per-site SMTP config (host/port/user/pass/from), **AES-GCM encrypted via `MCP_ENCRYPTION_KEY`** (Tier-1.5) + D1 row; replace the disabled "Configure SMTP" affordance with a validated form; enforce the **500-emails/mo free-send cap server-side** in `services/notifications.ts`.
- **Make `/api/site-features` toggles live** — currently persists state with no serving backend (§3).
- **`visitor_events_core` beacon producer** — inject a CSP-nonce-safe beacon into served sites so the (built) analytics ingest has a producer. Hot-path + CSP-sensitive → land with a deploy, not a blind fire.

**Explicitly DEFERRED (do NOT build without a decision):**
- `_ULTIMATE_COMPLETION.md` #8 seat-caps (`maxSeats`) — pricing decision pending.
- `_ULTIMATE_COMPLETION.md` #17 bulk-republish executor — high API-credit cost; dedicated session.

---

## 8. Recommended build order

1. **`payments_rail`** (shared core) — unblocks booking + donations capture + marketplaces.
2. **Owner-Features backends** (§3): `native_booking_engine` → `newsletter_engine` → `membership_paywall` → `site_mcp_server` finish → `enterprise_sso` → `brand_voice_clone`. Wire each to `/api/site-features` so toggles go live.
3. **Close the 7 logged bugs** (§5) — security-class first (`conversational_editing`, `stripe_app_status` signature).
4. **Finish STUB/PARTIAL modules** (§4) — colocate drift, add route-layer tests, promote experimental→beta.
5. **Queued worker work** (§7) — SMTP persistence + free-cap + `/api/site-features` live + beacon producer.
6. **AI-native gaps** — `ai_concierge_widget`/`customer_site_copilot`, `onboarding_copilot`, `media_library`, `i18n_localization`.
7. **Then the big-bet engine flags** (§1d) by demand, each behind its flag, dark-launched.
8. **`ecommerce_engine` (Medusa)** — own session (Neon + Upstash + Docker provisioning).

> Every new module: `npm run gen:feature -- --slug <x>`, claim next migration number atomically,
> ship `enabled=0, rollout=0, stage=experimental`, colocate Jest + E2E, `npm run validate:features`
> must stay green. Deploy is a separate gated step (worker deploy needs Docker → push → Workers Builds).

---

## 9. Scope curation (2026-06-07) — CUT + ADD

> **STATUS — EXECUTED 2026-06-07:** §9a CUT (40 flags) **removed** from the registry SSOT
> (`registry.ts` 155→117), their 52 dead handlers stripped from `src/routes/features.ts`, and 16
> `FLAG_DOCS` entries removed from `docs.ts`. **Added** `abuse_takedown` + `dunning_recovery` (§9b).
> Verified green: `tsc` 0 · `validate:features` 0 errors · 162 affected unit tests pass.
> **Remaining hygiene (deferred, knip-guided):** the cut features' helper fns still live in
> `src/services/big_bets.ts` + `brilliant.ts` (mixed files with kept fns) and their unit tests still
> pass — now unreferenced by any route. A knip sweep should excise the dead exports + their test
> blocks (caveat: `newsletterSubscribe` in `big_bets.ts` is wired to `contacts_core` — keep that one).

> Rationale: 155 flags is a reserved skeleton, not a roadmap. A solo + AI shop delivering AI-built
> sites to small businesses cannot operate HubSpot, an LMS, a forum, SOC2, and native shells.
> Cut the products-inside-the-product and the enterprise/infra vanity; add what a real hosting +
> delivery SaaS legally and operationally must have. Cuts marked `stage:deprecated` in the registry
> (flag kept for history; no build), or deleted on the next flag-cleanup pass.

### 9a. CUT — descoped (~38 flags), grouped by reason

**Whole-product clones (core already exists — don't rebuild the giant):**
`crm_engine`, `cdp_engine` (→ `contacts_core` IS the CRM core) · `lms_engine` · `community_engine` ·
`ai_video_courses` · `loyalty_engine` · `sms_marketing` (A2P-heavy; defer) ·
`newsletter_engine` (**duplicate of BUILT `email_marketing`** — repoint the owner "Newsletter" card to it).

**Enterprise theater (revisit only on a signed enterprise deal):**
`soc2_program` · `hipaa_variant` · `pci_dss_l1` (Square/Stripe own card scope) · `d1_multi_region` ·
`byo_cloudflare` · `wfp_dispatch` · `egress_control` · `tenant_hot_state` · `worker_marketplace` ·
`ai_agent_marketplace` · `enterprise_sso` (Clerk already does SSO).

**Editor sprawl (doctrine: bolt.diy is THE editor foundation — one surface):**
`visual_editor_drag_drop` · `ide_sandbox` · `crdt_coedit`.

**Native shells (responsive PWA admin suffices for solo):**
`native_mobile_admin` · `native_desktop_admin` · `mobile_admin` · `browser_extension`.

**Vanity / clever-low-ROI:**
`ghost_routes` · `cold_tier_thaw` · `speed_compare_widget` · `competitor_monitor` ·
`visitor_recognition` · `chat_ops_bot` · `domain_reseller` · `predicted_actions`.

**Observability over-build (solo tier = PostHog + Workers Tracing):**
`slo_tracker` · `tenant_sentry_releases` · `otlp_unified_events` · `cost_attribution`.

**Consolidate duplicates:** `multi_model_router` → fold into `ai_auto_router` · `runway_style_ref` →
keep one video path (`veo_hero_loop`).

> **Effect:** §1d "DARK, NEEDS BUILD" shrinks from ~104 to ~66 real build targets. The cut flags
> move to `stage:deprecated` in `registry.ts` (kept for audit; never built).

### 9b. ADD — important but missing (7 new flags/modules)

| New flag/module | Why it's non-negotiable | Depends on |
|---|---|---|
| **`dunning_recovery`** | Failed-payment retry + recovery emails. Direct churn/revenue protection — missing today. | `billing` |
| **`org_ai_budget_cap`** | Hard per-org AI spend cap + kill-switch. `token_burn_meter` only measures; this stops a runaway bill. | `token_burn_meter` |
| **`abuse_takedown`** | Abuse report + content takedown for published sites. DMCA/illegal-content handling = hosting-platform necessity. | `site_serving` |
| **`visitor_dsar`** | Visitor data deletion / GDPR DSAR on captured contacts. `data_export` is portability; deletion is the legal other half. | `contacts_core` |
| **`cookie_consent`** | GDPR consent banner injected on GENERATED sites serving EU traffic (compliance for your customers). | generation pipeline + `site_serving` |
| **`site_search`** | On-site search / faceted nav for info-heavy generated sites — CLAUDE.md benchmark (whitehouse.gov) requires it at >12 routes. | generation pipeline |
| **`backup_restore_ui`** | Owner-facing site version history + 1-click restore — promote `snapshot_rollback` into a real owner surface. | `snapshot_rollback` + R2/D1 Time Travel |

**Verify-then-promote (likely partial, confirm before building new):** owner self-service plan
upgrade/downgrade/cancel with proration (extends `billing`); public uptime/status page (`/health` exists).

### 9c. KEEP — explicitly NOT cut
`hallucination_guard` (EU AI Act / trust) · `payments_rail` (keystone) · admin-UX polish
(`sparkline_overlays`, `split_view_drawer`, `row_hover_actions`, `saved_views` — cheap, high daily
value) · AI-native media (`logo_regenerator`, `page_podcast`, `veo_hero_loop` — on-brand, "later").

### 9d. Revised build order (supersedes §8 where they conflict)
1. `payments_rail` → 2. Owner-Features backends (booking, membership_paywall, site_mcp_server finish; "Newsletter"→`email_marketing`) →
3. **New compliance/safety adds**: `abuse_takedown`, `visitor_dsar`, `cookie_consent` (legal exposure first) →
4. **New revenue/cost adds**: `dunning_recovery`, `org_ai_budget_cap` →
5. Close the 7 logged bugs (§5) → 6. Finish STUB/PARTIAL modules (§4) + `backup_restore_ui` + `site_search` →
7. Queued worker work (§7) → 8. AI-native gaps (concierge/onboarding/media_library/i18n) →
9. `ecommerce_engine` (Medusa, own session). Everything in §9a is OUT.

### 9e. Round-2 removal scan (2026-06-07) — RECOMMENDED (awaiting confirm)

Second pass over the remaining 117 flags found duplicate clusters + parked/doctrine-violating items.
Recommend cutting these ~12 (confirm and I'll remove them the same way as §9a):

**Parked / doctrine-violating:**
- `multimodal_intake` — its own manifest says *"PARKED pending product fit."* Cut.
- `native_editor` — a parallel Angular port of the bolt.diy editor; contradicts the **bolt.diy-is-THE-editor** doctrine ([[bolt-diy-as-editor-foundation]]). Cut; keep bolt.diy.
- `multimodal_copilot` — overlaps the kept AI-concierge direction (`customer_site_copilot`). Consolidate → cut.

**Swarm wave (clever, heavy, low SMB ROI):**
- `swarm_editor` (STUB) · `live_stream_preview` · `site_dna_taste_graph` — multi-agent co-edit + per-tenant taste ML. Cut the wave; the container orchestrator already fans out subagents.

**Duplicate clusters (keep ONE, cut the rest):**
- Agency: keep BUILT `agency_white_label` → **cut `agency_tier` + `whitelabel_admin`**.
- Referral: keep BUILT `referral_loop` → **cut `referral_credits`**.
- Streaming build: keep `progressive_skeleton_build` → **cut `streaming_generation`** (and `multi_agent_concurrent` — the build already runs concurrent subagents).

**Speculative for SMB delivery:**
- `db_provisioning` — per-site Neon/Supabase provisioning; no SMB-site demand. Cut/defer.
- `github_sync` — two-way GitHub sync on generated sites; power-user only. Cut/defer.

**Keep (considered, NOT cutting):** `cwv_publish_gate`/`axe_publish_gate` (quality gates, on-doctrine) ·
`stripe_meters` (revenue) · `gbp_assist`/`search_engine_submit`/`comparison_pages`/`integration_directory`/
`pseo_matrix_v2`/`review_*`/`reputation_monitor`/`public_gallery` (SEO/growth, mostly BUILT) ·
`veo_hero_loop`/`page_podcast`/`logo_regenerator` (AI-native media, on-brand later) ·
`pwa_manifest_full`/`web_push`/`i18n_auto_locale`/`tier_rate_limit`/`auto_changelog` (platform basics).

> Cutting all 12 → registry would land at ~105 flags. None have a `libs/features` module
> (verified) so removal is registry + `features.ts` handlers + `docs.ts`, same clean pattern as §9a.

---

## 10. Thorough scan (2026-06-07) — REMOVE + CONSOLIDATE

> **STATUS — EXECUTED 2026-06-07:** registry **155 → 74** (83 removed, 2 added). Done this pass:
> §9e round-2 (loose) + §10a de-flags + §10c admin-UX + all §10b **loose** sub-flags folded out
> (42-flag batch) + the `multimodal_intake` module deleted (dir + index.ts mount + tests). Verified
> green: `tsc` 0 · `validate:features` 0 errors (6 pre-existing warnings) · **4785 unit tests pass**.
> **DEFERRED to per-module passes** (entangled — do when each area is next touched, per §10e):
> (1) `swarm_editor` + `public_api_v1` are wired into the intentional **alias-shim** system
> (`alias_swarm_editor`/`alias_public_api` + `e2e/_fortress/*` — never bulk-delete per
> [[feedback_alias_modules_intentional]]); (2) `streaming_generation` is a mounted module;
> (3) `public_api_v1` is a **merge** (move its 12 endpoints under `public_api`), not a delete;
> (4) the §10b **module→module** merges (reputation/seo/pseo/marketplace/perf/a11y suites) — fold
> loose handlers into each survivor module as it's built/promoted. The dead helper-fn sweep
> (§9 note: `big_bets.ts`/`brilliant.ts` orphans) is still pending knip.

> Of the **117** remaining flags, **50 are real `libs/features` modules** and **67 are LOOSE**
> (registry + `features.ts` grab-bag only). Most loose flags are *sub-capabilities that were given
> their own flag* — a direct violation of the [[feature-flags]] rule "one flag per feature;
> sub-toggles via overrides, never new keys." This section (a) finds more pure removals and
> (b) maps the loose flags onto the module they belong inside. **Target: 117 → ~55 coherent flags,
> each = exactly one feature module.**

### 10a. Additional REMOVALS (beyond §9e round-2)
- **`public_api_v1`** — duplicate of the LIVE `public_api`. Merge v1's 12 endpoints under `public_api`; remove the v1 flag.
- **`upsell_campaign_month3`** — a single hardcoded campaign. That's *data*, not a feature flag — express it as an `automation_builder` recipe. Remove the flag.
- **`tier_rate_limit`** — infra middleware that should be **always-on**, not a customer toggle. De-flag (keep code, drop the registry key).
- **`workflows_v2_sitegen`** — the site-generation pipeline engine; core infra, not a customer-facing feature. De-flag.
- **`cli_tool`** (LIVE) — "CLI metadata" only; **verify a real `npx projectsites` package ships** — if not, it's vapor → remove until real.

### 10b. CONSOLIDATION map — loose flags → the module they belong in
Each surviving module keeps ONE flag; the folded capabilities become config/overrides (or always-on
where already `stable`). `→` = fold into.

| Target module (survivor) | Flags folded in | Δ |
|---|---|---|
| **`reputation`** (exists) | `review_requests` + `review_responder` (loose) + `review_synthesis` + `reputation_monitor` + `gbp_assist` (modules) | 5→1 |
| **`seo_autopilot`** (exists) | `structured_data_autopilot` + `quotable_answer_block` + `llms_txt` (LIVE→keep on) + `geo_visibility_tracker` + `cornerstone_autorefresh` + `auto_gen_static_files` | 6→1 |
| **`pseo_matrix`** (exists, v2) | `pseo_matrix_builder` + `vertical_templates` (loose) + `comparison_pages` + `integration_directory` (modules) | 5→1 |
| **`performance_suite`** (NEW) | `cwv_publish_gate` + `rum_telemetry` + `critical_css_inline` + `image_triplet_pipeline` + `speed_score_widget` | 5→1 |
| **`accessibility_suite`** (NEW) | `axe_publish_gate` + `ai_alt_text` + `wcag22_wizard` + `oklch_contrast_lift` + `accessibility_statement` (LIVE→keep on) | 5→1 |
| **`marketplace`** (exists) | `template_marketplace` + `plugin_marketplace` + `section_marketplace` (`stripe_marketplace` stays — it's a Stripe-App listing, different) | 3→1 |
| **`agency_white_label`** (exists) | `agency_tier` + `whitelabel_admin` (loose) | 3→1 |
| **`referral_loop`** (exists) | `referral_credits` (loose) (+ `upsell_campaign_month3` removed per §10a) | 2→1 |
| **`ai_media_studio`** (NEW) | `veo_hero_loop` + `page_podcast` + `logo_regenerator` | 3→1 |
| **`editor_pro`** (fold into bolt.diy / `conversational_editing`) | `section_overlay` + `voice_editing` + `diff_revert` + `approval_workflow` | 4→1 |
| **`live_build`** (keep `progressive_skeleton_build`) | `live_stream_preview` + `multi_agent_concurrent` + `swarm_editor` + `site_dna_taste_graph` (overlaps §9e) | 4→1 |
| **`public_api`** (LIVE) | `public_api_v1` (§10a) | 2→1 |
| **`site_analytics`** (exists) | `visitor_events_core` (module — already its data producer) | 2→1 |
| **`pwa`** (NEW small) | `pwa_manifest_full` + `web_push` | 2→1 |
| **`changelog`** (NEW small) | `auto_changelog` + `public_changelog` | 2→1 |
| **`unified_inbox`** (exists) | `faq_from_tickets` (clusters tickets→FAQ; needs inbox data) + `multimodal_copilot` (loose) | 3→1 |

### 10c. De-flag entirely — internal admin polish, NOT customer features
`sparkline_overlays` · `split_view_drawer` · `row_hover_actions` · `saved_views` — these are admin-
console UX enhancements. **Ship them unflagged** (or one dev-only `admin_ux` flag); they don't belong
in the customer feature registry. **4 flags → 0.**

### 10d. Net effect
117 → **~55** coherent flags. Each survivor = one `libs/features` module with sub-toggles via
`flag_overrides` (not new keys). Per-module the change is: move the loose handlers from `features.ts`
into the module's `handlers.ts`, drop the folded flags from the registry, and re-gate on the survivor.

### 10e. Execution recommendation
- **Now (low-risk, do immediately):** §10a removals (`public_api_v1` merge, `upsell_campaign_month3`,
  `tier_rate_limit`, `workflows_v2_sitegen` de-flag) + §10c admin-UX de-flag + §9e round-2. ≈ 20 flags gone.
- **Per-module (do when each area is next built/promoted):** the §10b consolidations — fold loose
  handlers into the module as you touch it, so each promotion experimental→beta also collapses its
  sub-flags. Avoids one risky big-bang refactor; aligns with the drift-detection "fix in-turn" rule.

---

## 11. Platform vs Site flag split (2026-06-07) — APPROVED + current (65 flags)

> Two-layer plane per [[two-layer-features-plane]]: **System Admin** tab (operator-only platform
> flags) vs **Features** tab (site-owner, per *.projectsites.dev site). Reflects the registry after
> the §10/§11 removals (155 → 65). Round-2/§10a/§10c/edge-cases all executed; build_progress removed
> (it was the `streaming_generation` impl — replaced by "reload after each build pass").

### LIST 1 — Platform (Feature Flags, operator-only) — 4
- **Build/gen:** `ai_auto_router`
- **Dev platform:** `public_api` · `mcp_server`
- **Ops/compliance:** `abuse_takedown`
  (platform SaaS billing — `core_billing`, checkout/subscriptions/wallet/`/webhooks/stripe` — is KEPT as infra, see below)

### LIST 2 — Site-provided (Features tab, site owner/editor) — 20
- **Sell/convert:** *(none as a flag)* — the **Donations** card stays in the owner catalog but is processed by the site form-hijack → **Stripe MCP** (no dedicated `donations_engine` flag/module)
- **Grow/market:** `email_marketing` · `seo_autopilot` (now also folds in content-freshness rewrites) · `search_engine_submit` · `gbp_assist` · `pseo_matrix_v2` (now covers comparison + integration pages)
- **Engage/leads:** `unified_inbox` · `contacts_core` · `site_analytics` · `visitor_events_core` · `automation_builder` · `outbound_webhooks` · `site_mcp_server`
- **Data/deliverability:** `data_export` · `email_deliverability_wizard`
- **Published-site quality (auto, default-on):** `speculation_rules` · `structured_data_autopilot` · `quotable_answer_block` · `llms_txt` · `accessibility_statement` · `pwa_manifest_full`

### BOTH layers — 3
- `section_marketplace` (platform catalog + owner installs) · `trust_center` (per-org + per-site) · `token_burn_meter` (operator cost + owner usage)

### Platform infra (always-on / internal — not a toggle) — 6
- Sentinels: `core_auth` · `core_admin_detail` · `core_site_create` · `core_feature_flags` · `core_billing`
- Drift shim: `alias_inbox`

### Owner Features catalog (the toggleable cards on /admin/site-features) — 3
Trimmed to surviving flags: **Donations** (`donations_engine`) · **Newsletter** (`email_marketing`) · **AI Assistant Access** (`site_mcp_server`). Updated in both the worker `SITE_FEATURE_CATALOG` and the frontend `SITE_FEATURE_CATALOG_DISPLAY` (+ spec assertions 8→3).

### 11a. FURTHER removals — EXECUTED 2026-06-07 (65 → 59)
- ✅ `agent_sdk_mcp` (STUB dir + flag) · ✅ `cli_tool` (vapor — gated nothing, no CLI package) · ✅ `brand_voice_clone` · ✅ `ai_ab_test_generator`
- ✅ `swarm_editor` (+ `alias_swarm_editor`, `src/routes/swarm.ts`, `e2e/_fortress/swarm-editor`, `swarm-editor` dir, tests)
- ❌ **`public_api_v1` KEPT** — re-inspection showed it is **NOT** a duplicate of `public_api`. It's the real `/v1/*` REST API (sites CRUD, deploy, media, snapshots) + token-scoped auth with **IDOR security tests** (`token_mgmt_idor.test.ts`); the LIVE `public_api` flag is only its OpenAPI discovery metadata. They're complementary — removing v1 would delete a working, security-tested public API. (Earlier "duplicate" call was wrong.)

### 11b. COMBINES still pending (module→module merges — do per-module, each is a real refactor)
- `template_marketplace`+`plugin_marketplace`+`section_marketplace` → **`marketplace`**
- `pseo_matrix_v2`+`integration_directory`+`comparison_pages` → **`pseo`**
- `content_freshness`+`seo_autopilot` → **`site_seo_autopilot`**
- `audit_hash_chain`+`trust_center` → **`compliance_center`**
- `stripe_meters`+`token_burn_meter` → **`usage_metering`**

> These are BUILT/PARTIAL modules with mounts + tests + migrations; merging means moving handlers
> into one survivor dir + reconciling schemas/migrations + deleting the others. Per [[drift-detection]]
> + safety, do one group at a time as that area is next touched. Executing all 11b → registry ~52.
>
> **Cost finding (2026-06-07):** investigated the `marketplace` merge — it is NOT a flag rename.
> Each of the 3 routes imports its own `libs/features/<x>/feature.schemas.ts` (also imported by tests),
> and the manifest-validator's no-duplicate-flagKey rule blocks pointing 3 manifests at one flag. A real
> merge = consolidate 3 schema dirs + 4 routes + 4 tests into one `marketplace` module (~30+ edits,
> high break-risk) for −2 dark flags. The other 4 groups are the same shape. **Recommendation: stop
> flag-minimization at 59 (155→59 = −62%); do each §11b merge only when that module is next built**,
> not as speculative churn. The vapor `/api/cli/version` endpoint is KEPT — it's e2e-locked (3 specs) +
> has an admin `/integrations/cli` page; the `cli_tool` flag (the real cruft) is already removed.

### 11c. EXECUTED 2026-06-07 (59 → 45) — Brian's removal batch
Removed (14 flags + modules + src routes/services + tests + e2e specs):
`snapshot_rollback` (already implemented in the editor) · `bulk_site_ops` · `hallucination_guard` ·
`ai_components` · `public_api_v1` (+ `alias_public_api`, `/v1` routes, token-mgmt, IDOR tests) ·
`enterprise_plan` · `agency_white_label` · `stripe_marketplace` (the Stripe-App listing — the
donation cash-connection is now folded into `donations_engine`'s description: "connect a Stripe/Square
payout account to route the cash") · `log_explorer` · `audit_hash_chain` · `native_booking_engine` ·
`ecommerce_engine` · `membership_paywall`.
Catalogs trimmed to 3 cards (worker + frontend + spec). Deleted 7 orphaned e2e specs (logs-explorer,
enterprise, public-api, hub-interactions, big-bets, all-endpoints, ide-features — ≥93% stale; the
parametrized `all-flags.spec` is registry-driven and auto-adjusts). Verified: `tsc` 0 ·
`validate:features` 0 violations · 4432 unit tests pass.

### 11d. FURTHER removal candidates (your "what else" — recommend)
- **`plugin_marketplace` + `template_marketplace`** — keep `section_marketplace` only (bento sections for the builder); plugins + paid templates are creator-economy scope an SMB site-builder doesn't need yet. → −2
- **`stripe_meters`** — AI-token metered billing. Only needed if you charge customers per-token; flat plans don't need it (`token_burn_meter` already shows cost). → −1
- **`i18n_auto_locale`** — auto locale-mirrors; speculative + heavy. Cut until a real multilingual customer. → −1
- **`public_gallery` + `public_changelog`** — platform/site growth surfaces, nice-to-have, not core. → −2
- **`referral_loop`** — projectsites' own referral program; defer until there's traffic to refer. → −1
- **`customer_site_copilot` OR `site_mcp_server`** — both make the published site AI-accessible (RAG chat vs MCP). Keep one. → −1
- **Combine:** `content_freshness` + `seo_autopilot` → one `site_seo_autopilot`; `pseo_matrix_v2` + `integration_directory` + `comparison_pages` → one `pseo`.
- Taking the cuts above → registry ~37; with the combines → ~33.

### 11e. EXECUTED 2026-06-07 (45 → 35) — §11d batch + section dedup
**Removed (11 flags + modules/routes/services/workflow/tests/e2e):** `plugin_marketplace` · `template_marketplace` (kept `section_marketplace`) · `public_gallery` · `referral_loop` · `content_freshness` (incl. its Cloudflare Workflow + wrangler bindings dev/prod — folded the rewrite mention into `seo_autopilot`) · `integration_directory` · `comparison_pages` (both folded into `pseo_matrix_v2`) · `stripe_meters` · `i18n_auto_locale` · `customer_site_copilot` (kept `site_mcp_server`) · `public_changelog`.
**Correction:** `stripe_meters` was the **core `billing` module's** flagKey (zero runtime gating — a mislabel). Removing it orphaned the billing manifest, so re-pointed billing → new **`core_billing`** sentinel (always-on, per the `core_*` convention). Net 45 −11 +1 = **35**.
**Section dedup (Brian's ask):** there is now exactly **ONE owner Features section** (`/admin/site-features`, label "Features") + **ONE operator section** (`/admin/feature-flags`, label "System Admin"). Deleted the retired `features-hub.component.ts` + its spec; removed the `features: 'Features Hub'` label; `/admin/features` still redirects → `site-features` (no 404). Nav already had exactly one of each.
**Verified:** worker `tsc` 0 · frontend SPA + spec `tsc` 0 · `validate:features` 0 errors · 4289 unit tests pass.

> Note on naming: the operator section is labeled **"System Admin"** (a deliberate prior rename of "Feature Flags"). It IS the single sys-admin flag-management surface. Say the word to relabel it literally "Feature Flags" if preferred.

### 11f. EXECUTED 2026-06-07 (35 → 33) — Stripe site-payment removal
Per Brian: removed the dedicated Stripe **site-payment** features; payments run through the form-hijack → **Stripe MCP** instead.
- Removed flags: `donations_engine` (+ its `libs/features/donations_engine` module, handlers/service/schemas/tests, index mount, + the `/api/donations/campaigns` & `/api/donations/process` handlers) and `dunning_recovery`.
- **KEPT** the platform's own SaaS billing — `core_billing` sentinel + `src/services/billing.ts` + `billing_addons` + wallet/top-up + `/webhooks/stripe` (that's how projectsites.dev charges its customers; out of scope).
- **KEPT** the **Donations** owner card (catalog key `donations_engine`, re-described: "payments processed through Stripe via the site form handler"). The card is display+toggle only now — the actual charge is a form-hijack → Stripe MCP call.
- **TO BUILD (next):** wire the form-hijack script (`public/widgets.js` / `public/app.js`) to invoke the Stripe MCP when a form needs to take a payment. Not built this turn (payment-handling = careful, focused build).
- Verified: worker `tsc` 0 · frontend SPA+spec `tsc` 0 · `validate:features` 0 violations · 4279 unit tests pass.

### 11g. /loop iteration 1 (2026-06-07) — abuse_takedown fully built + tested
Hourly loop (job 42281387) goal: "all feature flags + features completely implemented + fully tested." First gap closed: **`abuse_takedown`** had a registry flag but ZERO implementation. Now a complete feature module:
- `migrations/0536_abuse_reports.sql` (`abuse_reports` table) · `libs/features/abuse_takedown/` (manifest + schemas + service + handlers + README + 17 tests) · mounted in `src/index.ts`.
- Routes: public rate-limited `POST /api/abuse/report` (resolves site by slug/id, 404 unknown, 202 pending) · super-admin `GET /api/abuse/reports` + `POST /api/abuse/reports/:id/resolve` (dismiss | takedown→archives the site).
- Verified: `tsc` 0 · `validate:features` 0 violations · 17/17 module tests · 4296 full-suite tests pass · migration parses.
- Flag stays dark (experimental) — recommend promoting to **stable** so abuse/DMCA intake is always reachable (the destructive takedown stays super-admin gated). Worker ships on push (Docker-gated locally) — migration applies on deploy.

### 11h. /loop iteration 2 (2026-06-07) — features control-plane route coverage
`src/routes/features.ts` (the public discovery surfaces backing the LIVE `llms_txt` / `accessibility_statement` / `mcp_server` / `public_api` / `cli_tool` flags + the two control-plane reads `GET /api/feature-flags` and `GET /api/site-features`) had ZERO tests. Added `src/__tests__/features_routes.test.ts` (16 tests): every discovery route 200s with the right content-type/body; the flag-registry list is a **trim regression guard** (count 20–60, KEEPS core_*/mcp_server/public_api/abuse_takedown, EXCLUDES the 2026-06-07 removed flags); `:key` 200/404; site-features catalog ≥8 + plan-aware; `POST /api/site-features/:key` 404/400.
- Verified: `tsc` 0 · `validate:features` 0 errors · full suite 231 suites / 4312 tests pass.

### 11i. /loop iteration 3 (2026-06-07) — published-site-quality LIVE flags now tested
Audited every flag for genuine (non-false-zero) test gaps. `pwa_manifest_full` + `structured_data_autopilot` are exercised via `build_validators.test` (required-file + JSON-LD gates); `gbp_assist`/`email_deliverability`/`search_submit`/`mcp_site` ARE tested (the flag-key string just doesn't appear because their tests use relative imports). The genuine gap: the **marketing-serve injection** of three LIVE flags — `speculation_rules`, `structured_data_autopilot`, `quotable_answer_block` — applied to every `projectsites.dev` HTML response in `src/index.ts` `app.all('*')`, had ZERO coverage (a flaky-grep false-positive on `meta_tags.test.ts`, which actually only covers the top-bar + email colors).
- Added `src/__tests__/marketing_serve_injection.test.ts` (8 tests) exercising the **real worker fetch** end-to-end (mocks only the R2 boundary): speculationrules script (prerender+prefetch, admin/api excluded) + `Link: rel="prerender"`; Organization/WebSite/WebPage/BreadcrumbList/SearchAction JSON-LD; **route-accuracy** (a `/pricing` request gets its own WebPage `@id`/url + a "Pricing" breadcrumb, not a hardcoded homepage); sr-only `data-quotable` lead; runtime env meta injection; and guardrails (non-HTML assets NOT mutated, missing marketing asset → JSON info fallback).
- **Reusable test recipe unlocked** (nothing imported the full worker before — the heavy ESM/runtime deps blocked it): `jest.mock('@cloudflare/containers', …)` + virtual `jest.mock('cloudflare:workers', …, { virtual:true })` + a complete `EnvSchema` env stub (parseEnv() runs as the first middleware and 400s on any missing required secret).
- Test-only addition — no worker source changed, no deploy needed. Verified: `tsc` 0 · `validate:features` 0 errors (4 pre-existing warnings) · full suite **232 suites / 4320 tests pass**.
