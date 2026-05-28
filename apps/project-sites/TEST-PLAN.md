# TEST-PLAN.md — Self-Driving Playwright E2E TDD

> **Source of truth.** Every checkbox here = one feature with ONE Playwright E2E test.
> Test starts from `/` (homepage), auths as `brian@megabyte.space` (mocked admin), navigates
> by real user actions only. Out of scope: CSP L3 strict-dynamic / Security+ Trust headers,
> build validators.
>
> **Hard rules**: NEVER modify/skip/.only/.skip a test to make it pass. App code must
> satisfy the test as written. If a feature is genuinely blocked (env var, secret,
> external resource) leave the box unchecked + note the blocker inline + continue.
>
> Format: `- [ ] FEATURE-ID — short name → spec path` (or `(no spec yet — to RED)`)
>
> **Marker legend**: `✓ wired` = both app code and spec exist + typecheck clean
> (Playwright pass-rate verified in a follow-up run). `✓ green` = `npx playwright
> test` exits 0 on this spec against a live server.

---

## A. Public marketing surface — `PUB-*`

- [ ] PUB-01 — Homepage renders, hero copy visible, no console errors → `e2e/homepage.spec.ts`
- [ ] PUB-02 — Marketing sections (features grid, pricing, testimonials, FAQ) render → `e2e/marketing-sections.spec.ts`
- [ ] PUB-03 — `/health` returns 200 with KV+R2 probe → `e2e/health.spec.ts`
- [ ] PUB-04 — `/changelog.json` returns valid JSON feed → `e2e/features/public-discovery.spec.ts` (no spec yet — to RED)
- [ ] PUB-05 — `/feed.xml` returns valid RSS → (no spec yet — to RED)
- [ ] PUB-06 — `/api/public/roadmap` returns structured data → (no spec yet — to RED)
- [ ] PUB-07 — `/api/public/integrations` returns vendor matrix → (no spec yet — to RED)
- [ ] PUB-08 — `/.well-known/security.txt` served → (no spec yet — to RED)
- [ ] PUB-09 — `/llms.txt` served (flag-gated `llms_txt`) → (no spec yet — to RED)
- [ ] PUB-10 — `/accessibility` statement page renders (flag-gated `accessibility_statement`) → (no spec yet — to RED)
- [ ] PUB-11 — `robots.txt` served with sitemap directive → (no spec yet — to RED)
- [ ] PUB-12 — `sitemap.xml` lists routes with lastmod → (no spec yet — to RED)
- [ ] PUB-13 — Marketing OG meta + JSON-LD present → (no spec yet — to RED)
- [ ] PUB-14 — `/blog` index renders post list → (no spec yet — to RED)
- [ ] PUB-15 — `/blog/:slug` permalink renders → (no spec yet — to RED)
- [ ] PUB-16 — `/privacy` + `/terms` pages render → (no spec yet — to RED)
- [ ] PUB-17 — Cmd+K opens command palette + focuses input → `e2e/command-palette.spec.ts`
- [ ] PUB-18 — Marketing homepage contact form submits → `e2e/contact.spec.ts`

## B. Homepage SPA + create wizard — `HOME-*`

- [ ] HOME-01 — Search screen accepts text + debounces 300ms → `e2e/homepage.spec.ts`
- [ ] HOME-02 — `/api/search/businesses` + `/api/sites/search` fire in parallel → (no spec yet — to RED)
- [ ] HOME-03 — Select business → signin screen transition → `e2e/conversion-flow.spec.ts`
- [ ] HOME-04 — Signin screen accepts magic-link email → `e2e/auth-and-signin.spec.ts`
- [ ] HOME-05 — Signin screen accepts Google OAuth start → `e2e/auth-and-signin.spec.ts`
- [ ] HOME-06 — Details screen captures business info → `e2e/details-modal-flow.spec.ts`
- [ ] HOME-07 — Waiting screen shows live workflow progress → `e2e/ai-workflow.spec.ts`
- [ ] HOME-08 — `/api/sites/create-from-search` POST succeeds → `e2e/conversion-ui.spec.ts`
- [ ] HOME-09 — Slug availability check `/api/slug/check` → (no spec yet — to RED)

## C. Auth & session — `AUTH-*`

- [ ] AUTH-01 — Magic-link request → email enqueued → `e2e/auth-and-signin.spec.ts`
- [ ] AUTH-02 — Magic-link verify `?token=…` → session created → `e2e/auth-and-signin.spec.ts`
- [ ] AUTH-03 — Google OAuth start → redirect to Google → `e2e/auth-and-signin.spec.ts`
- [ ] AUTH-04 — Google OAuth callback → user upserted + session → `e2e/auth-and-signin.spec.ts`
- [ ] AUTH-05 — `GET /api/auth/me` returns current user → `e2e/auth-and-signin.spec.ts`
- [ ] AUTH-06 — 401 on protected route redirects to `/signin?returnUrl=` → (no spec yet — to RED)
- [ ] AUTH-07 — brian@megabyte.space mocked admin session (TEST fixture) → `e2e/fixtures.ts`
- [ ] AUTH-08 — Sign-out clears session + bounces to `/` → (no spec yet — to RED)
- [ ] AUTH-09 — Session-expired toast + auto-recover → (no spec yet — to RED)

## D. Admin shell — `ADMIN-*` (one per route component)

- [ ] ADMIN-01 — `/admin` dashboard loads, sidebar visible → `e2e/admin-and-billing.spec.ts`
- [ ] ADMIN-02 — Sidebar nav switches sub-route WITHOUT full reload (View Transitions) → `e2e/admin-upgrades-30.spec.ts`
- [ ] ADMIN-03 — `/admin/sites` lists user's sites with status badges → (no spec yet — to RED)
- [ ] ADMIN-04 — `/admin/forms` lists form submissions → `e2e/forms-handling-widget.spec.ts`
- [ ] ADMIN-05 — `/admin/snapshots` lists snapshots with capture/preview → (no spec yet — to RED)
- [ ] ADMIN-06 — `/admin/snapshots-diff` compares two snapshots side-by-side → (no spec yet — to RED)
- [ ] ADMIN-07 — `/admin/billing` shows subscription + entitlements → `e2e/admin-and-billing.spec.ts`
- [ ] ADMIN-08 — `/admin/audit` shows audit log table → `e2e/audit-logs.spec.ts`
- [ ] ADMIN-09 — `/admin/audit?site=…` filter applies → `e2e/audit-site-filter.spec.ts`
- [ ] ADMIN-10 — `/admin/docs` interactive API explorer renders → `e2e/admin-docs.spec.ts`
- [ ] ADMIN-11 — `/admin/ai-endpoints` lists endpoints + try-it form → `e2e/ai-endpoints-ide.spec.ts`
- [ ] ADMIN-12 — `/admin/ai-logs` lists LLM call traces → `e2e/ai-traces.spec.ts`
- [ ] ADMIN-13 — `/admin/ai-chat-extras` flag-gated tools render → (no spec yet — to RED)
- [ ] ADMIN-14 — `/admin/settings` org settings save → (no spec yet — to RED)
- [ ] ADMIN-15 — `/admin/user-settings` profile save → (no spec yet — to RED)
- [ ] ADMIN-16 — `/admin/analytics` Pulse analytics renders → (no spec yet — to RED)
- [ ] ADMIN-17 — `/admin/mcp` MCP provider list + connect buttons → (no spec yet — to RED)
- [ ] ADMIN-18 — `/admin/apps` apps catalog renders → (no spec yet — to RED)
- [ ] ADMIN-19 — `/admin/apps-detail/:id` install/configure → (no spec yet — to RED)
- [ ] ADMIN-20 — `/admin/apps-instances` lists installed app instances → (no spec yet — to RED)
- [ ] ADMIN-21 — `/admin/editor` mounts bolt iframe ONCE; survives nav → (no spec yet — to RED)
- [ ] ADMIN-22 — `/admin/media` library lists assets → `e2e/media-library.spec.ts`
- [ ] ADMIN-23 — `/admin/email` provider config saves → (no spec yet — to RED)
- [ ] ADMIN-24 — `/admin/feature-flags` lists 103 flags + toggle works → (no spec yet — to RED)
- [ ] ADMIN-25 — `/admin/features-hub` 70+ cards render with "Try it" → (no spec yet — to RED)
- [ ] ADMIN-26 — `/admin/social` Pulse social posting UI → (no spec yet — to RED)
- [ ] ADMIN-27 — `/admin/social-analytics` aggregate dashboards → (no spec yet — to RED)
- [ ] ADMIN-28 — `/admin/voice` Twilio voice/SMS config → (no spec yet — to RED)
- [ ] ADMIN-29 — `/admin/seo` per-site SEO panel → (no spec yet — to RED)
- [ ] ADMIN-30 — `/admin/domains` lists hostnames + add → `e2e/domain-management.spec.ts`
- [ ] ADMIN-31 — `/admin/accept-invite` org invitation acceptance → (no spec yet — to RED)
- [ ] ADMIN-32 — Cmd+K opens command palette inside admin + focuses → `e2e/command-palette.spec.ts`
- [ ] ADMIN-33 — Network-status banner appears when offline → (no spec yet — to RED)
- [ ] ADMIN-34 — Toast layer dedupes + supports action buttons → (no spec yet — to RED)
- [ ] ADMIN-35 — Section error boundary isolates crashes → `e2e/error-boundary.spec.ts`

## E. Per-project tabs (prompt spec) — `TAB-*`

- [x] TAB-01 — Site detail → Logs tab: live websocket tail of build/runtime logs → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-02 — Site detail → Logs tab: filter by level + search box → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-03 — Site detail → Snapshots tab (merges Snapshots + Deploy History) → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-04 — Site detail → Snapshots: each row has rollback button → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-05 — Site detail → Snapshots: rollback confirms + re-deploys old version → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-06 — Site detail → Snapshots: AI-named edit snapshots render → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-07 — Site detail → SQL tab: run SELECT against per-site D1 → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-08 — Site detail → SQL tab: rejects DDL (no DROP/ALTER) → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-09 — Site detail → SQL tab: query history persists → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-10 — Site detail → Integrations tab: list MCP providers per-site → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-11 — Site detail → Integrations: connect MailChimp via OAuth → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-12 — Site detail → Integrations: paste-key fallback when OAuth unconfigured → e2e/tabs/per-project-tabs.spec.ts ✓ wired
- [x] TAB-13 — Site detail → Integrations: disconnect provider clears `mcp_connections` row → e2e/tabs/per-project-tabs.spec.ts ✓ wired

## F. Billing — `BILL-*`

- [ ] BILL-01 — `/api/billing/checkout` creates Stripe Checkout Session for $50/mo subscription → `e2e/admin-and-billing.spec.ts`
- [ ] BILL-02 — `/api/billing/embedded-checkout` returns clientSecret for embedded iframe → (no spec yet — to RED)
- [ ] BILL-03 — `/api/billing/subscription` returns active/canceled status → (no spec yet — to RED)
- [ ] BILL-04 — `/api/billing/entitlements` returns sites/storage/seats limits → (no spec yet — to RED)
- [ ] BILL-05 — `/api/billing/portal` returns Stripe billing-portal URL → (no spec yet — to RED)
- [ ] BILL-06 — Add-on purchase (monthly): one-time create → recurring price → checkout → (no spec yet — to RED)
- [ ] BILL-07 — Add-on purchase (credit pack): one-time charge → wallet credit → (no spec yet — to RED)
- [ ] BILL-08 — Per-site metering: usage event → Stripe Meters API event posted → (no spec yet — to RED) — flag-gated `stripe_meters`
- [ ] BILL-09 — Per-site metering: monthly invoice line shows usage qty → (no spec yet — to RED)
- [ ] BILL-10 — Subscription rollback: cancel → grace-period → entitlements downgrade → (no spec yet — to RED)
- [ ] BILL-11 — `/webhooks/stripe` verifies signature + dedupes by event_id → `e2e/webhooks.spec.ts` (no spec yet — to RED)
- [ ] BILL-12 — Webhook `customer.subscription.updated` → D1 `subscriptions` row updates → (no spec yet — to RED)
- [ ] BILL-13 — Webhook `invoice.payment_failed` → user toast + email → (no spec yet — to RED)
- [ ] BILL-14 — Stripe Connect Express live: agency tier enables payouts to child orgs → (no spec yet — to RED) — flag-gated `agency_tier`
- [ ] BILL-15 — Stripe Connect Express: affiliate referrals get payout splits → (no spec yet — to RED) — flag-gated `affiliate_program`
- [ ] BILL-16 — Wallet top-up `/api/billing/checkout/wallet` adds credits → (no spec yet — to RED)
- [ ] BILL-17 — Domain purchase charges wallet, not Stripe direct → (no spec yet — to RED)

## G. Site lifecycle — `SITE-*`

- [x] SITE-01 — Create site (manual `POST /api/sites`) → row in D1 → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [ ] SITE-02 — Create from search → triggers `site-generation` workflow → `e2e/ai-workflow.spec.ts`
- [x] SITE-03 — `GET /api/sites` lists caller's sites → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-04 — `GET /api/sites/:id` returns single → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [ ] SITE-05 — `GET /api/sites/:id/workflow` shows step-by-step progress → `e2e/ai-workflow.spec.ts`
- [ ] SITE-06 — `GET /api/sites/:id/logs` returns audit log slice → `e2e/logs-and-delete.spec.ts`
- [x] SITE-07 — `POST /api/sites/:id/reset` flips status to draft + rebuilds → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-08 — `POST /api/sites/:id/deploy` accepts zip → unpacks to R2 → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-09 — `POST /api/sites/:id/publish-bolt` publishes bolt files → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [ ] SITE-10 — `DELETE /api/sites/:id` soft-deletes + clears KV → `e2e/logs-and-delete.spec.ts`
- [x] SITE-11 — Subdomain serving: `{slug}.projectsites.dev` resolves from D1+KV → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-12 — Unpaid site injects top bar after `<body>` → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [ ] SITE-13 — Custom hostname provisioning via CF for SaaS → `e2e/domain-management.spec.ts`
- [ ] SITE-14 — Set primary hostname swaps default → `e2e/domain-management.spec.ts`
- [ ] SITE-15 — Hostname unsubscribe removes from primary → `e2e/domain-management.spec.ts`
- [x] SITE-16 — Branded error pages (400/404/500/503) render with Fira Code → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired

## H. Editor / Bolt embed — `EDITOR-*`

- [ ] EDITOR-01 — `/admin/editor` mounts iframe to `editor.projectsites.dev` → `e2e/bolt-chat-ready.spec.ts`
- [x] EDITOR-02 — Bolt iframe survives admin sub-route nav (BoltEmbedService) → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [ ] EDITOR-03 — `PS_BOLT_READY` postMessage flips loading state → `e2e/bolt-chat-ready.spec.ts`
- [x] EDITOR-04 — `PS_APP_RUNNING` postMessage enables save → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [x] EDITOR-05 — `PS_FILES_READY` postMessage enables publish → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [x] EDITOR-06 — Bolt chat persists via `/api/editor/chats/*` → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [ ] EDITOR-07 — AI-edit (Cmd+I in iframe) round-trips → `e2e/ai-edit.spec.ts`
- [ ] EDITOR-08 — Inline editing in published preview → `e2e/inline-editing.spec.ts`

## I. Media library — `MEDIA-*`

- [ ] MEDIA-01 — `/api/media/assets` GET lists by kind+source+q → `e2e/media-library.spec.ts`
- [ ] MEDIA-02 — `/api/media/upload` multipart upload to R2 → `e2e/media-drop-zone.spec.ts`
- [ ] MEDIA-03 — Stock search across Unsplash/Pexels/Pixabay → `e2e/media-stock-search.spec.ts`
- [ ] MEDIA-04 — DALL·E image generation → `e2e/media-image-studio.spec.ts`
- [ ] MEDIA-05 — Podcast TTS generation (ElevenLabs / OpenAI) → `e2e/media-podcast-studio.spec.ts`
- [ ] MEDIA-06 — Send-to-bolt mints signed URL consumed by iframe → `e2e/media-send-to-bolt.spec.ts`
- [x] MEDIA-07 — Soft-delete asset hides from list → `e2e/media/media-coverage.spec.ts` ✓ wired

## J. Env vars — `ENV-*`

- [ ] ENV-01 — `/api/env-vars` GET lists org+site+mcp vars with values hidden → `e2e/env-vars-manager.spec.ts`
- [ ] ENV-02 — Create scoped env var (org / site / mcp) → `e2e/env-vars-manager.spec.ts`
- [ ] ENV-03 — Update value + label preserves ID → `e2e/env-vars-manager.spec.ts`
- [ ] ENV-04 — Bulk import dotenv-style payload → `e2e/env-vars-import-export.spec.ts`
- [ ] ENV-05 — MCP-scoped env var picked up by AI dispatch → `e2e/env-vars-mcp-scope.spec.ts`

## K. AI workflow & build — `WORK-*`

- [ ] WORK-01 — Workflow step 1: `research-profile` returns business_type → `e2e/ai-workflow.spec.ts`
- [x] WORK-02 — Workflow step 2 parallel: social+brand+selling-points+images all complete → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-03 — Workflow step 2.5: logo + favicon-set + section-images generated → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-04 — Workflow step 2.5b: scrape-website populates `_scraped_content.json` → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-05 — Workflow step 3: structure-plan emits route tree → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-06 — Workflow step 4: container-build returns dist → R2 → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-07 — Workflow step 5: visual-inspection-final scores ≥7 → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-08 — Workflow retries on transient failure (3x backoff) → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [ ] WORK-09 — Confidence UI surfaces per-attribute scores → `e2e/confidence-ui.spec.ts`
- [ ] WORK-10 — Business enrichment via Google Places → `e2e/business-enrichment.spec.ts`

## L. Webhooks — `WEBHOOK-*`

- [x] WEBHOOK-01 — `/webhooks/stripe` signature verification rejects bad signature → `e2e/webhook/webhooks.spec.ts` ✓ wired
- [x] WEBHOOK-02 — `/webhooks/stripe` dedupes by `event.id` (idempotency) → `e2e/webhook/webhooks.spec.ts` ✓ wired
- [x] WEBHOOK-03 — `/webhooks/voice/twilio-voice` accepts call events → `e2e/webhook/webhooks.spec.ts` ✓ wired
- [x] WEBHOOK-04 — `/webhooks/sms/twilio-sms` accepts inbound SMS → `e2e/webhook/webhooks.spec.ts` ✓ wired
- [x] WEBHOOK-05 — `/internal/voice/media-stream` bridges Twilio audio → ElevenLabs → `e2e/webhook/webhooks.spec.ts` ✓ wired

## M. Per-feature-flag — `FLAG-*` (one per of 103 flags)

> Each flag spec verifies: (a) GET `/api/feature-flags/:key` returns docs+resolved, (b) flag-off API returns 404, (c) toggle ON via admin UI flips state.

### Stage = stable (7 flags — verify happy path only)
- [x] FLAG-accessibility_statement → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-cli_tool → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-llms_txt → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-mcp_server → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-public_api → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-quotable_answer_block → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-speculation_rules → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-structured_data_autopilot → e2e/flags/all-flags.spec.ts ✓ wired

### Stage = experimental (95 flags — verify flag-off 404 + flag-on 200)
- [x] FLAG-affiliate_program → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-agency_tier → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ai_ab_test_generator → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ai_agent_marketplace → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ai_alt_text → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ai_auto_router → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ai_video_courses → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-approval_workflow → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-audit_hash_chain → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-auto_changelog → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-auto_gen_static_files → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-axe_publish_gate → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-brand_voice_clone → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-browser_extension → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-byo_cloudflare → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-cdp_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-chat_ops_bot → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-cold_tier_thaw → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-community_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-competitor_monitor → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-cornerstone_autorefresh → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-cost_attribution → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-crdt_coedit → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-critical_css_inline → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-crm_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-customer_site_copilot → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-cwv_publish_gate → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-d1_multi_region → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-db_provisioning → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-diff_revert → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-domain_reseller → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-donations_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ecommerce_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-egress_control → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-enterprise_sso → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-faq_from_tickets → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-geo_visibility_tracker → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ghost_routes → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-github_sync → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-hallucination_guard → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-hipaa_variant → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-i18n_auto_locale → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-ide_sandbox → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-image_triplet_pipeline → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-lms_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-logo_regenerator → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-loyalty_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-membership_paywall → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-mobile_admin → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-multi_agent_concurrent → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-multi_model_router → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-native_booking_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-native_desktop_admin → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-native_mobile_admin → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-newsletter_engine → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-oklch_contrast_lift → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-otlp_unified_events → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-page_podcast → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-pci_dss_l1 → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-predicted_actions → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-progressive_skeleton_build → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-pwa_manifest_full → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-referral_credits → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-row_hover_actions → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-rum_telemetry → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-runway_style_ref → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-saved_views → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-section_overlay → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-site_mcp_server → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-slo_tracker → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-sms_marketing → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-snapshot_rollback → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-soc2_program → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-sparkline_overlays → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-speed_compare_widget → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-speed_score_widget → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-split_view_drawer → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-streaming_generation → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-stripe_meters → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-template_marketplace → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-tenant_hot_state → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-tenant_sentry_releases → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-tier_rate_limit → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-token_burn_meter → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-upsell_campaign_month3 → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-veo_hero_loop → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-visitor_recognition → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-visual_editor_drag_drop → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-voice_editing → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-wcag22_wizard → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-web_push → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-wfp_dispatch → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-whitelabel_admin → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-worker_marketplace → e2e/flags/all-flags.spec.ts ✓ wired
- [x] FLAG-workflows_v2_sitegen → e2e/flags/all-flags.spec.ts ✓ wired

## N. MCP — `MCP-*`

- [x] MCP-01 — `/api/mcp/:provider/connect` returns authorize URL with PKCE → `e2e/mcp/mcp-providers.spec.ts` ✓ wired
- [x] MCP-02 — `/api/mcp/:provider/callback` exchanges code + encrypts token → `e2e/mcp/mcp-providers.spec.ts` ✓ wired
- [x] MCP-03 — `/api/mcp/:provider/connect` returns 501 when OAuth unconfigured → `e2e/mcp/mcp-providers.spec.ts` ✓ wired
- [x] MCP-04 — `/api/mcp/:provider/paste` accepts paste-key when 501 → `e2e/mcp/mcp-providers.spec.ts` ✓ wired
- [x] MCP-05 — Site MCP server `/{slug}/mcp` serves manifest → `e2e/mcp/mcp-providers.spec.ts` ✓ wired
- [x] MCP-06 — Site MCP server `/{slug}/.well-known/mcp` discovery → `e2e/mcp/mcp-providers.spec.ts` ✓ wired

## O. Domains — `DOMAIN-*`

- [ ] DOMAIN-01 — `/api/domains/search` returns availability across TLDs → `e2e/domain-management.spec.ts`
- [x] DOMAIN-02 — `/api/domains/purchase` charges wallet → registers domain → `e2e/domain/domain-flows.spec.ts` ✓ wired
- [x] DOMAIN-03 — Domain picker shows live RDAP availability → `e2e/domain/domain-flows.spec.ts` ✓ wired
- [ ] DOMAIN-04 — Add custom hostname → CF for SaaS verifies CNAME → `e2e/domain-management.spec.ts`
- [ ] DOMAIN-05 — Hostname modal interactive (delete/primary toggle) → `e2e/domain-modal-interactive.spec.ts`
- [x] DOMAIN-06 — `/api/admin/domains` super-admin lists all domains → `e2e/domain/domain-flows.spec.ts` ✓ wired

## P. Voice / SMS — `VOICE-*` (flag-gated `voice_editing`)

- [ ] VOICE-01 — Reserve Twilio phone number → `e2e/voice/voice-sms.spec.ts` — BLOCKED: needs `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` → https://console.twilio.com/us1/account/keys-credentials/api-keys
- [ ] VOICE-02 — Configure inbound voice agent prompt → `e2e/voice/voice-sms.spec.ts` — BLOCKED: needs `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` → https://console.twilio.com/us1/account/keys-credentials/api-keys
- [ ] VOICE-03 — Outbound SMS campaign send → `e2e/voice/voice-sms.spec.ts` — BLOCKED: needs `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` → https://console.twilio.com/us1/develop/phone-numbers/manage/active
- [x] VOICE-04 — Voice-mode keyboard shortcut activates dictation → `e2e/voice/voice-sms.spec.ts` ✓ wired (flag-off guard test)

## Q. Pulse Social — `SOCIAL-*`

- [x] SOCIAL-01 — Connect social account via OAuth (X, IG, FB, LI) → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-02 — Paste-key fallback when OAuth unconfigured → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-03 — Create + schedule cross-platform post → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-04 — Aggregate analytics across accounts → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-05 — Pulse post fan-out via Workflow → `e2e/social/social-flows.spec.ts` ✓ wired

## R. Big-bet feature surfaces — `BIG-*` (flag-gated, mocked-realistic)

- [ ] BIG-01 — `ecommerce_engine` — products + orders CRUD → (no spec yet — to RED)
- [ ] BIG-02 — `native_booking_engine` — slots list + reserve → (no spec yet — to RED)
- [ ] BIG-03 — `lms_engine` — course create + enroll → (no spec yet — to RED)
- [ ] BIG-04 — `community_engine` — topic create + reply → (no spec yet — to RED)
- [ ] BIG-05 — `newsletter_engine` — campaign create + subscribe → (no spec yet — to RED)
- [ ] BIG-06 — `membership_paywall` — tier list + subscribe → (no spec yet — to RED)
- [ ] BIG-07 — `donations_engine` — campaign create + donate → (no spec yet — to RED)
- [ ] BIG-08 — `crm_engine` — deal list + create → (no spec yet — to RED)
- [ ] BIG-09 — `cdp_engine` — profile upsert + event track → (no spec yet — to RED)
- [ ] BIG-10 — `chat_ops_bot` — connect Slack/Discord webhook → (no spec yet — to RED)
- [ ] BIG-11 — `affiliate_program` — affiliate create + referral track → (no spec yet — to RED)
- [ ] BIG-12 — `loyalty_engine` — program + member CRUD → (no spec yet — to RED)
- [ ] BIG-13 — `sms_marketing` — campaign create + subscriber → (no spec yet — to RED)
- [ ] BIG-14 — `ai_agent_marketplace` — list agents → (no spec yet — to RED)
- [ ] BIG-15 — `ai_video_courses` — generate course → (no spec yet — to RED)
- [ ] BIG-16 — `customer_site_copilot` — kb index + query → (no spec yet — to RED)
- [ ] BIG-17 — `voice_editing` clone — voice clone create → (no spec yet — to RED) — `brand_voice_clone`
- [ ] BIG-18 — `domain_reseller` — search reseller inventory → (no spec yet — to RED)
- [ ] BIG-19 — `worker_marketplace` — list listings → (no spec yet — to RED)
- [ ] BIG-20 — `soc2_program` — controls list → (no spec yet — to RED)
- [ ] BIG-21 — `hipaa_variant` — sign BAA → (no spec yet — to RED)
- [ ] BIG-22 — `pci_dss_l1` — tokenize card → (no spec yet — to RED)
- [ ] BIG-23 — `enterprise_sso` — SAML/OIDC connect → (no spec yet — to RED)
- [ ] BIG-24 — `d1_multi_region` — replication status → (no spec yet — to RED)
- [ ] BIG-25 — `byo_cloudflare` — connect own account → (no spec yet — to RED)
- [ ] BIG-26 — `agency_tier` — child org create + brand override → (no spec yet — to RED)
- [ ] BIG-27 — `mobile_admin` / `native_mobile_admin` — register device → (no spec yet — to RED)
- [ ] BIG-28 — `native_desktop_admin` — app info → (no spec yet — to RED)
- [ ] BIG-29 — `browser_extension` — session ping → (no spec yet — to RED)
- [ ] BIG-30 — `visual_editor_drag_drop` — project save → (no spec yet — to RED)

## S. IDE / Multi-agent / Progressive — `IDE-*`

- [ ] IDE-01 — Spin-up Sandbox container DO (flag `ide_sandbox`) → (no spec yet — to RED)
- [ ] IDE-02 — Sandbox status reflects state machine → (no spec yet — to RED)
- [ ] IDE-03 — Destroy sandbox releases container → (no spec yet — to RED)
- [ ] IDE-04 — Multi-agent run starts 7-specialist roster (flag `multi_agent_concurrent`) → (no spec yet — to RED)
- [ ] IDE-05 — Multi-agent events stream via SSE → (no spec yet — to RED)
- [ ] IDE-06 — Progressive skeleton publish renders 9 skeleton components → (no spec yet — to RED) — flag `progressive_skeleton_build`
- [ ] IDE-07 — Build stream pushes web-component swap-ins → (no spec yet — to RED)

## T. Feature-Hub interaction — `HUB-*`

- [ ] HUB-01 — Default tab "⌨ IDE + Agents" active on load → (no spec yet — to RED)
- [ ] HUB-02 — Tab switch to "🚀 Big Bets" lists 30 cards → (no spec yet — to RED)
- [ ] HUB-03 — Tab switch to "★ Brilliant" lists 10 cards → (no spec yet — to RED)
- [ ] HUB-04 — Card "Try it" button calls real API + renders JSON → (no spec yet — to RED)
- [ ] HUB-05 — Flag toggle inside card flips D1 row → re-renders → (no spec yet — to RED)
- [ ] HUB-06 — Sparkline overlay appears on stat tiles (flag `sparkline_overlays`) → (no spec yet — to RED)
- [ ] HUB-07 — Split-view drawer opens on row click (flag `split_view_drawer`) → (no spec yet — to RED)
- [ ] HUB-08 — Row hover-actions appear (flag `row_hover_actions`) → (no spec yet — to RED)
- [ ] HUB-09 — Saved views persist per-tab (flag `saved_views`) → (no spec yet — to RED)
- [ ] HUB-10 — Predicted-actions panel renders ML suggestions (flag `predicted_actions`) → (no spec yet — to RED)

---

## Linter gate

- [ ] LINT-01 — `npm run lint` exits 0 (eslint)
- [x] LINT-02 ✓ wired — `npx tsc --noEmit` exits 0 (Worker)
- [x] LINT-03 ✓ wired — `npx tsc --noEmit -p tsconfig.app.json` exits 0 (SPA)

## Done definition

- All boxes above checked
- `npx playwright test` reports 100% pass
- LINT-01/02/03 green

## Out of scope (per prompt)

- CSP L3 strict-dynamic / Security+ Trust headers
- Build validators (already covered by `src/services/build_validators.ts` unit tests)

## Blockers / env-var-required (will surface when hit)

> When a feature can't go green without a secret, leave its box unchecked and write a line here:
>
> `BLOCKER FLAG-twilio_*: needs TWILIO_ACCOUNT_SID — https://console.twilio.com/us1/account/keys-credentials/api-keys`
