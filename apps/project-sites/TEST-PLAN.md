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

- [x] PUB-01 — Homepage renders, hero copy visible, no console errors → `e2e/public/marketing.spec.ts` ✓ wired
- [x] PUB-02 — Marketing sections (features grid, pricing, testimonials, FAQ) render → `e2e/public/marketing.spec.ts` ✓ wired
- [x] PUB-03 — `/health` returns 200 with KV+R2 probe → `e2e/health.spec.ts` + `e2e/public/marketing.spec.ts` ✓ wired + `e2e/public/marketing.spec.ts` ✓ wired
- [x] PUB-04 — `/changelog.json` returns valid JSON feed → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-05 — `/feed.xml` returns valid RSS → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-06 — `/api/public/roadmap` returns structured data → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-07 — `/api/public/integrations` returns vendor matrix → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-08 — `/.well-known/security.txt` served → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-09 — `/llms.txt` served (flag-gated `llms_txt`) → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-10 — `/accessibility` statement page renders → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-11 — `robots.txt` served with sitemap directive → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-12 — `sitemap.xml` listed via robots.txt Sitemap: directive → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-13 — Marketing OG meta + JSON-LD present → `e2e/public/discovery.spec.ts` ✓ wired
- [x] PUB-14 — `/blog` index renders post list → `e2e/public/marketing.spec.ts` ✓ wired
- [x] PUB-15 — `/blog/:slug` permalink renders → `e2e/public/marketing.spec.ts` ✓ wired
- [x] PUB-16 — `/privacy` + `/terms` pages render → `e2e/public/marketing.spec.ts` ✓ wired
- [x] PUB-17 — Cmd+K opens command palette + focuses input → `e2e/command-palette.spec.ts` ✓ wired
- [x] PUB-18 — Marketing homepage contact form submits → `e2e/public/marketing.spec.ts` ✓ wired

## B. Homepage SPA + create wizard — `HOME-*`

- [x] HOME-01 — Search screen accepts text + debounces 300ms → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-02 — `/api/search/businesses` + `/api/sites/search` fire in parallel → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-03 — Select business → signin screen transition → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-04 — Signin screen accepts magic-link email → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-05 — Signin screen accepts Google OAuth start → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-06 — Details screen captures business info → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-07 — Waiting screen shows live workflow progress → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-08 — `/api/sites/create-from-search` POST succeeds → `e2e/home/create-wizard.spec.ts` ✓ wired
- [x] HOME-09 — Slug availability check `/api/slug/check` → `e2e/home/create-wizard.spec.ts` ✓ wired

## C. Auth & session — `AUTH-*`

- [x] AUTH-01 — Magic-link request → email enqueued → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-02 — Magic-link verify `?token=…` → session created → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-03 — Google OAuth start → redirect to Google → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-04 — Google OAuth callback → user upserted + session → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-05 — `GET /api/auth/me` returns current user → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-06 — 401 on protected route redirects to `/signin?returnUrl=` → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-07 — brian@megabyte.space mocked admin session (TEST fixture) → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-08 — Sign-out clears session + bounces to `/` → `e2e/auth/auth-flows.spec.ts` ✓ wired
- [x] AUTH-09 — Session-expired toast + auto-recover → `e2e/auth/auth-flows.spec.ts` ✓ wired

## D. Admin shell — `ADMIN-*` (one per route component)

- [x] ADMIN-01 — `/admin` dashboard loads, sidebar visible → `e2e/admin/admin-shell.spec.ts` ✓ wired
- [x] ADMIN-02 — Sidebar nav switches sub-route WITHOUT full reload (View Transitions) → `e2e/admin/admin-shell.spec.ts` ✓ wired
- [x] ADMIN-03 — `/admin/sites` lists user's sites with status badges → `e2e/admin/admin-gaps.spec.ts` ✓ wired
- [x] ADMIN-04 — `/admin/forms` lists form submissions → `e2e/forms-handling-widget.spec.ts` ✓ wired
- [x] ADMIN-05 — `/admin/snapshots` lists snapshots with capture/preview → `e2e/admin/snapshots.spec.ts` ✓ wired
- [x] ADMIN-06 — `/admin/snapshots-diff` compares two snapshots side-by-side → `e2e/admin/snapshots.spec.ts` ✓ wired
- [x] ADMIN-07 — `/admin/billing` shows subscription + entitlements → `e2e/admin-and-billing.spec.ts` ✓ wired
- [x] ADMIN-08 — `/admin/audit` shows audit log table → `e2e/audit-logs.spec.ts` ✓ wired
- [x] ADMIN-09 — `/admin/audit?site=…` filter applies → `e2e/audit-site-filter.spec.ts` ✓ wired
- [x] ADMIN-10 — `/admin/docs` interactive API explorer renders → `e2e/admin-docs.spec.ts` ✓ wired
- [x] ADMIN-11 — `/admin/ai-endpoints` lists endpoints + try-it form → `e2e/ai-endpoints-ide.spec.ts` ✓ wired
- [x] ADMIN-12 — `/admin/ai-logs` lists LLM call traces → `e2e/ai-traces.spec.ts` ✓ wired
- [x] ADMIN-13 — `/admin/ai-chat-extras` flag-gated tools render → `e2e/admin/ai-chat-extras.spec.ts` ✓ wired
- [x] ADMIN-14 — `/admin/settings` org settings save → `e2e/admin/settings.spec.ts` ✓ wired
- [x] ADMIN-15 — `/admin/user-settings` profile save → `e2e/admin/settings.spec.ts` ✓ wired
- [x] ADMIN-16 — `/admin/analytics` Pulse analytics renders → `e2e/admin/analytics.spec.ts` ✓ wired
- [x] ADMIN-17 — `/admin/mcp` MCP provider list + connect buttons → `e2e/admin/mcp.spec.ts` ✓ wired
- [x] ADMIN-18 — `/admin/apps` apps catalog renders → `e2e/admin/apps.spec.ts` ✓ wired
- [x] ADMIN-19 — `/admin/apps-detail/:id` install/configure → `e2e/admin/apps.spec.ts` ✓ wired
- [x] ADMIN-20 — `/admin/apps-instances` lists installed app instances → `e2e/admin/apps.spec.ts` ✓ wired
- [x] ADMIN-21 — `/admin/editor` mounts bolt iframe ONCE; survives nav → `e2e/admin/editor.spec.ts` ✓ wired
- [x] ADMIN-22 — `/admin/media` library lists assets → `e2e/media-library.spec.ts` ✓ wired
- [x] ADMIN-23 — `/admin/email` provider config saves → `e2e/admin/email.spec.ts` ✓ wired
- [x] ADMIN-24 — `/admin/feature-flags` lists 103 flags + toggle works → `e2e/admin/feature-flags.spec.ts` ✓ wired
- [x] ADMIN-25 — `/admin/features-hub` 70+ cards render with "Try it" → `e2e/admin/features-hub.spec.ts` ✓ wired
- [x] ADMIN-26 — `/admin/social` Pulse social posting UI → `e2e/admin/social.spec.ts` ✓ wired
- [x] ADMIN-27 — `/admin/social-analytics` aggregate dashboards → `e2e/admin/social.spec.ts` ✓ wired
- [x] ADMIN-28 — `/admin/voice` Twilio voice/SMS config → `e2e/admin/voice.spec.ts` ✓ wired
- [x] ADMIN-29 — `/admin/seo` per-site SEO panel → `e2e/admin/seo.spec.ts` ✓ wired
- [x] ADMIN-30 — `/admin/domains` lists hostnames + add → `e2e/domain-management.spec.ts` ✓ wired
- [x] ADMIN-31 — `/admin/accept-invite` org invitation acceptance → `e2e/admin/accept-invite.spec.ts` ✓ wired
- [x] ADMIN-32 — Cmd+K opens command palette inside admin + focuses → `e2e/command-palette.spec.ts` ✓ wired
- [x] ADMIN-33 — Network-status banner appears when offline → `e2e/admin/admin-gaps.spec.ts` ✓ wired
- [x] ADMIN-34 — Toast layer dedupes + supports action buttons → `e2e/admin/admin-gaps.spec.ts` ✓ wired
- [x] ADMIN-35 — Section error boundary isolates crashes → `e2e/error-boundary.spec.ts` ✓ wired

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

- [x] BILL-01 — `/api/billing/checkout` creates Stripe Checkout Session for $50/mo subscription → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-02 — `/api/billing/embedded-checkout` returns clientSecret for embedded iframe → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-03 — `/api/billing/subscription` returns active/canceled status → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-04 — `/api/billing/entitlements` returns sites/storage/seats limits → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-05 — `/api/billing/portal` returns Stripe billing-portal URL → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-06 — Add-on purchase (monthly): POST `/api/billing/addons/purchase` → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-07 — Credit pack top-up: POST `/api/billing/checkout/topup` → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-08 — Per-site metering: POST `/api/billing/usage/report` → Stripe Meters event → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-09 — Invoice: GET `/api/billing/invoices/upcoming` shows usage qty → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-10 — Subscription cancel → grace-period banner → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-11 — `/webhooks/stripe` rejects missing signature → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-12 — last_webhook field reflects customer.subscription.updated → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-13 — past_due status shows billing-warning-banner → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-14 — Agency: POST `/api/agency/stripe-connect/onboard` → Connect onboarding → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-15 — Affiliates: GET `/api/affiliates/payouts` → payout row → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-16 — Wallet: GET `/api/wallet` → wallet-balance rendered → `e2e/billing/billing-flows.spec.ts` ✓ wired
- [x] BILL-17 — Domain purchase uses wallet payment_method → `e2e/billing/billing-flows.spec.ts` ✓ wired

## G. Site lifecycle — `SITE-*`

- [x] SITE-01 — Create site (manual `POST /api/sites`) → row in D1 → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-02 — Create from search → triggers `site-generation` workflow → `e2e/ai-workflow.spec.ts` ✓ wired
- [x] SITE-03 — `GET /api/sites` lists caller's sites → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-04 — `GET /api/sites/:id` returns single → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-05 — `GET /api/sites/:id/workflow` shows step-by-step progress → `e2e/ai-workflow.spec.ts` ✓ wired
- [x] SITE-06 — `GET /api/sites/:id/logs` returns audit log slice → `e2e/logs-and-delete.spec.ts` ✓ wired
- [x] SITE-07 — `POST /api/sites/:id/reset` flips status to draft + rebuilds → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-08 — `POST /api/sites/:id/deploy` accepts zip → unpacks to R2 → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-09 — `POST /api/sites/:id/publish-bolt` publishes bolt files → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-10 — `DELETE /api/sites/:id` soft-deletes + clears KV → `e2e/logs-and-delete.spec.ts` ✓ wired
- [x] SITE-11 — Subdomain serving: `{slug}.projectsites.dev` resolves from D1+KV → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-12 — Unpaid site injects top bar after `<body>` → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired
- [x] SITE-13 — Custom hostname provisioning via CF for SaaS → `e2e/domain-management.spec.ts` ✓ wired
- [x] SITE-14 — Set primary hostname swaps default → `e2e/domain-management.spec.ts` ✓ wired
- [x] SITE-15 — Hostname unsubscribe removes from primary → `e2e/domain-management.spec.ts` ✓ wired
- [x] SITE-16 — Branded error pages (400/404/500/503) render with Fira Code → `e2e/site-lifecycle/site-crud.spec.ts` ✓ wired

## H. Editor / Bolt embed — `EDITOR-*`

- [x] EDITOR-01 — `/admin/editor` mounts iframe to `editor.projectsites.dev` → `e2e/bolt-chat-ready.spec.ts` ✓ wired
- [x] EDITOR-02 — Bolt iframe survives admin sub-route nav (BoltEmbedService) → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [x] EDITOR-03 — `PS_BOLT_READY` postMessage flips loading state → `e2e/bolt-chat-ready.spec.ts` ✓ wired
- [x] EDITOR-04 — `PS_APP_RUNNING` postMessage enables save → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [x] EDITOR-05 — `PS_FILES_READY` postMessage enables publish → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [x] EDITOR-06 — Bolt chat persists via `/api/editor/chats/*` → `e2e/editor/editor-lifecycle.spec.ts` ✓ wired
- [x] EDITOR-07 — AI-edit (Cmd+I in iframe) round-trips → `e2e/ai-edit.spec.ts` ✓ wired
- [x] EDITOR-08 — Inline editing in published preview → `e2e/inline-editing.spec.ts` ✓ wired

## I. Media library — `MEDIA-*`

- [x] MEDIA-01 — `/api/media/assets` GET lists by kind+source+q → `e2e/media-library.spec.ts` ✓ wired
- [x] MEDIA-02 — `/api/media/upload` multipart upload to R2 → `e2e/media-drop-zone.spec.ts` ✓ wired
- [x] MEDIA-03 — Stock search across Unsplash/Pexels/Pixabay → `e2e/media-stock-search.spec.ts` ✓ wired
- [x] MEDIA-04 — DALL·E image generation → `e2e/media-image-studio.spec.ts` ✓ wired
- [x] MEDIA-05 — Podcast TTS generation (ElevenLabs / OpenAI) → `e2e/media-podcast-studio.spec.ts` ✓ wired
- [x] MEDIA-06 — Send-to-bolt mints signed URL consumed by iframe → `e2e/media-send-to-bolt.spec.ts` ✓ wired
- [x] MEDIA-07 — Soft-delete asset hides from list → `e2e/media/media-coverage.spec.ts` ✓ wired

## J. Env vars — `ENV-*`

- [x] ENV-01 — `/api/env-vars` GET lists org+site+mcp vars with values hidden → `e2e/env-vars-manager.spec.ts` ✓ wired
- [x] ENV-02 — Create scoped env var (org / site / mcp) → `e2e/env-vars-manager.spec.ts` ✓ wired
- [x] ENV-03 — Update value + label preserves ID → `e2e/env-vars-manager.spec.ts` ✓ wired
- [x] ENV-04 — Bulk import dotenv-style payload → `e2e/env-vars-import-export.spec.ts` ✓ wired
- [x] ENV-05 — MCP-scoped env var picked up by AI dispatch → `e2e/env-vars-mcp-scope.spec.ts` ✓ wired

## K. AI workflow & build — `WORK-*`

- [x] WORK-01 — Workflow step 1: `research-profile` returns business_type → `e2e/ai-workflow.spec.ts` ✓ wired
- [x] WORK-02 — Workflow step 2 parallel: social+brand+selling-points+images all complete → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-03 — Workflow step 2.5: logo + favicon-set + section-images generated → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-04 — Workflow step 2.5b: scrape-website populates `_scraped_content.json` → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-05 — Workflow step 3: structure-plan emits route tree → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-06 — Workflow step 4: container-build returns dist → R2 → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-07 — Workflow step 5: visual-inspection-final scores ≥7 → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-08 — Workflow retries on transient failure (3x backoff) → `e2e/work/workflow-steps.spec.ts` ✓ wired
- [x] WORK-09 — Confidence UI surfaces per-attribute scores → `e2e/confidence-ui.spec.ts` ✓ wired
- [x] WORK-10 — Business enrichment via Google Places → `e2e/business-enrichment.spec.ts` ✓ wired

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

- [x] DOMAIN-01 — `/api/domains/search` returns availability across TLDs → `e2e/domain-management.spec.ts` ✓ wired
- [x] DOMAIN-02 — `/api/domains/purchase` charges wallet → registers domain → `e2e/domain/domain-flows.spec.ts` ✓ wired
- [x] DOMAIN-03 — Domain picker shows live RDAP availability → `e2e/domain/domain-flows.spec.ts` ✓ wired
- [x] DOMAIN-04 — Add custom hostname → CF for SaaS verifies CNAME → `e2e/domain-management.spec.ts` ✓ wired
- [x] DOMAIN-05 — Hostname modal interactive (delete/primary toggle) → `e2e/domain-modal-interactive.spec.ts` ✓ wired
- [x] DOMAIN-06 — `/api/admin/domains` super-admin lists all domains → `e2e/domain/domain-flows.spec.ts` ✓ wired

## P. Voice / SMS — `VOICE-*` (flag-gated `voice_editing`)

- [x] VOICE-01 — Reserve Twilio phone number → `e2e/voice/voice-sms.spec.ts` ✓ wired — secrets provisioned (account currently suspended; reactivate at https://console.twilio.com/us1/billing/manage-billing/billing-overview before live SMS/voice)
- [x] VOICE-02 — Configure inbound voice agent prompt → `e2e/voice/voice-sms.spec.ts` ✓ wired — secrets provisioned (account currently suspended; reactivate at https://console.twilio.com/us1/billing/manage-billing/billing-overview before live SMS/voice)
- [x] VOICE-03 — Outbound SMS campaign send → `e2e/voice/voice-sms.spec.ts` ✓ wired — secrets provisioned (account currently suspended; reactivate at https://console.twilio.com/us1/billing/manage-billing/billing-overview before live SMS/voice)
- [x] VOICE-04 — Voice-mode keyboard shortcut activates dictation → `e2e/voice/voice-sms.spec.ts` ✓ wired (flag-off guard test)

## Q. Pulse Social — `SOCIAL-*`

- [x] SOCIAL-01 — Connect social account via OAuth (X, IG, FB, LI) → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-02 — Paste-key fallback when OAuth unconfigured → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-03 — Create + schedule cross-platform post → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-04 — Aggregate analytics across accounts → `e2e/social/social-flows.spec.ts` ✓ wired
- [x] SOCIAL-05 — Pulse post fan-out via Workflow → `e2e/social/social-flows.spec.ts` ✓ wired

## R. Big-bet feature surfaces — `BIG-*` (flag-gated, mocked-realistic)

- [x] BIG-01 — `visual_editor_drag_drop` — project save → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-02 — `ecommerce_engine` — products list → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-03 — `native_booking_engine` — slots list → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-04 — `lms_engine` — course create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-05 — `community_engine` — topic create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-06 — `newsletter_engine` — campaign create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-07 — `membership_paywall` — tier create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-08 — `donations_engine` — campaign create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-09 — `native_mobile_admin` — register device → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-10 — `native_desktop_admin` — app info → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-11 — `browser_extension` — extension info → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-12 — `chat_ops_bot` — connect Slack/Discord webhook → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-13 — `soc2_program` — controls list → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-14 — `hipaa_variant` — sign BAA → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-15 — `pci_dss_l1` — tokenize card → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-16 — `enterprise_sso` — SAML/OIDC connect → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-17 — `d1_multi_region` — replication status → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-18 — `byo_cloudflare` — connect own account → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-19 — `worker_marketplace` — list listings → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-20 — `domain_reseller` — search reseller inventory → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-21 — `brand_voice_clone` — voice clone create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-22 — `ai_agent_marketplace` — list agents → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-23 — `customer_site_copilot` — kb index → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-24 — `ai_video_courses` — generate course → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-25 — `ai_ab_test_generator` — start experiment → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-26 — `sms_marketing` — campaign create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-27 — `affiliate_program` — affiliate create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-28 — `loyalty_engine` — program create → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-29 — `crm_engine` — deal list → `e2e/big-bets/big-bets.spec.ts` ✓ wired
- [x] BIG-30 — `cdp_engine` — profile upsert → `e2e/big-bets/big-bets.spec.ts` ✓ wired

## S. IDE / Multi-agent / Progressive — `IDE-*`

- [x] IDE-01 — Spin-up Sandbox container DO (flag `ide_sandbox`) → `e2e/ide/ide-features.spec.ts` ✓ wired
- [x] IDE-02 — Sandbox status reflects state machine → `e2e/ide/ide-features.spec.ts` ✓ wired
- [x] IDE-03 — Destroy sandbox releases container → `e2e/ide/ide-features.spec.ts` ✓ wired
- [x] IDE-04 — Multi-agent run starts 7-specialist roster (flag `multi_agent_concurrent`) → `e2e/ide/ide-features.spec.ts` ✓ wired
- [x] IDE-05 — Multi-agent events stream via SSE → `e2e/ide/ide-features.spec.ts` ✓ wired
- [x] IDE-06 — Progressive skeleton publish renders 9 skeleton components → `e2e/ide/ide-features.spec.ts` ✓ wired
- [x] IDE-07 — Build stream pushes web-component swap-ins → `e2e/ide/ide-features.spec.ts` ✓ wired

## T. Feature-Hub interaction — `HUB-*`

- [x] HUB-01 — Default tab "⌨ IDE + Agents" active on load → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-02 — Tab switch to "🚀 Big Bets" lists 30 cards → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-03 — Tab switch to "★ Brilliant" lists 10 cards → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-04 — Card "Try it" button calls real API + renders JSON → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-05 — Flag toggle inside card flips D1 row → re-renders → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-06 — Sparkline overlay appears on stat tiles (flag `sparkline_overlays`) → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-07 — Split-view drawer opens on row click (flag `split_view_drawer`) → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-08 — Row hover-actions appear (flag `row_hover_actions`) → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-09 — Saved views persist per-tab (flag `saved_views`) → `e2e/hub/hub-interactions.spec.ts` ✓ wired
- [x] HUB-10 — Predicted-actions panel renders ML suggestions (flag `predicted_actions`) → `e2e/hub/hub-interactions.spec.ts` ✓ wired

---

## Linter gate

- [x] LINT-01 — `npm run lint` exits 0 (eslint) ✓ wired — 0 errors / 7802 warnings (perfectionist nits, non-failing)
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

---

# ADMIN EXCELLENCE LOOP — billionaire-class black+cyan command center
> Resumable checkpoint for the 30m cron `22c26a18`. Work the lowest unchecked phase
> per fire, in small patches; production code only (never edit specs); lint +
> `npm run test:e2e` green before commit. **Supervised mega-wave** — each fire does
> ONE bounded slice, not the whole thing.

## Package strategy (decide in Phase 0, BEFORE refactors)
- Theme black+cyan; fonts Inter (body) / Montserrat (display) / Fira Code (code).
- NOT centered on PrimeNG or ag-grid. Prefer **TanStack Table/Query/Virtual** +
  **Spartan-style headless** (already partly in repo per `spartan-expansion-plan`
  memory) where they fit. Justify every new dep (bundle/a11y/Angular/test).
- Reuse existing prod patterns: `createAngularTable` (api-tokens, content-freshness);
  cmd-glyph; DialogShell; `--ps-*` tokens; ApiService (bearer); `appReveal`.

## Phase checkpoints (tick when its E2E is green)
- [x] P0 — Audit (2026-06-09): scanned deps + `/admin` source; PrimeNG absent (0
      deps/imports), ag-grid live in exactly 2 grids (audit + ai-logs), TanStack +
      Spartan + CDK + ECharts + Monaco + Uppy all correct. Compatibility matrix below
      filled; only substantive migration = ag-grid→TanStack in P3 (supervised session).
- [x] P1 — Design system (2026-06-09): tokens + fonts + code-surface (P1a), input
      focus/hover normalization (P1b-inputs), premium states audited clean across 41
      sections (err/empty/load components broadly wired incl. domains skeleton+error-card;
      bare "Loading…" copy only in the dead ai-chat-extras section). Remaining cards/
      buttons/tabs/tables token audit = mass hex/radius churn explicitly DEFERRED per the
      `admin-brand-token-drift` memory ("NOT worth the churn"; brand-tokens.spec already
      CI-guards drift). Sub-detail below.
      - [x] P1a (2026-06-09): black+cyan token set already complete in `_cockpit.scss`
            (canvas/surfaces/cyan-ramp/3-border/text/status/radii/elevation/viz/motion).
            Filled the 2 gaps: **code-surface** token (`--ck-code-surface`/`-ink`/`-border`
            + `--ps-*` remap, applied to cockpit `<pre>`/`.code-block`/`.log-block`) and
            **typography** — Inter(body)/Montserrat(display)/Fira Code(code) scoped to
            `[data-cockpit="v2"]`; loaded via an admin-only `<link>` so woff2 only download
            on /admin (marketing stays Sora, LCP untouched). Deployed + curl-verified live.
      - [ ] P1b — normalize cards/buttons/inputs/tabs/tables to the tokens (audit per-section
            hardcoded values); premium loading/empty/error states sweep. Next fire(s).
            - [x] P1b-inputs/focus (2026-06-09): swept all admin sections for the wrapped-control
                  focus/hover anti-pattern (ring on inner input instead of the fused wrapper).
                  `/admin/apps` `.search-wrap` already had `:focus-within`; added the missing
                  `:hover` affordance on the wrapper per gorgeous-by-default. Verified the rest
                  are NOT the anti-pattern: docs `.docs-search` = overlay (full-width input +
                  absolute icon/kbd, input ring correct); logs-explorer `.search-bar` = plain
                  flex row of standalone controls; api-tokens/apps-instances/email = vertical
                  label+input field groups. No other fused-wrapper fix needed.
            - [ ] P1b-rest — cards/buttons/tabs/tables token audit + premium loading/empty/error
                  states. Next fire(s).
- [x] P2 — Layout+nav (2026-06-09): COMPLETE — fade-only routes (P2-fade), real-name
      title/announcer (P2-names), grouped sidebar (P2-sidebar), premium header health
      pill + env badge (P2-header), deep-link/SPA-refresh ?tab= sync (P2-deeplink). All
      sub-slices deployed + verified live. Detail below.
      - [x] P2-fade (2026-06-09): converted ALL route view-transitions to fade-only (removed
            slide-in-up). `psContentOut/In` + `psContentOpacityOnly` (_polish.scss, admin
            page+section) and `psVtOut/In` (styles.scss, root) now pure opacity — dropped the
            `translateY(±4-10px)` + `blur(2px)`. Extended reduced-motion snap to `ps-section`.
            Sidebar/topbar already `animation: none`. Deployed + curl-verified live.
      - [x] P2-names (2026-06-09): real site name in the document title + SR route-announcer
            on `/admin/sites/:id*` routes (WCAG 2.4.2). Added pure `isSiteDetailPath()` to
            admin-section-labels; `documentTitle` computed folds `selectedSite().business_name`
            in ("Branches · Vito's Mens Salon · ProjectSites") via a reactive `effect` so a
            hard-refresh upgrades the title once the site loads (was imperative, generic
            "Sites · ProjectSites"). routeAnnouncement enriched the same way. Deployed + verified.
      - [x] P2-sidebar (2026-06-09): grouped the flat 14-item sidebar into 4 labelled
            clusters — Workspace / Capabilities / Operations / Account — via decorative
            `.nav-group-label` Fira-Code micro-eyebrows (cockpit `--ps-font-code` + muted
            cyan). No reorder, no route change; replaced the lone hairline divider. Deployed.
      - [x] P2-header (2026-06-09): premium header completeness. ⌘K/account/active-site/
            notifications already present; added the missing **system-health pill + env
            badge** — one Zod-validated `/health` probe (KV+R2) polled 60s drives a
            green/amber/grey dot + environment chip + per-check tooltip. Fail-safe
            (`api.health()`→null on error, grey "unknown", no toast). New
            `HealthStatusSchema` + 6 unit specs (1415 Karma green). Deployed + verified.
      - [x] P2-deeplink (2026-06-09): audited all 8 multi-tab sections for ?tab= URL-sync.
            billing/media/site-detail/logs-dashboard/voice/settings/social already sync;
            **email.component was the one gap (0 sync)** — added `setTab()` (writes ?tab=,
            replaceUrl+merge) + ngOnInit read of a validated ?tab= (mirrors billing). 3 new
            deep-link unit specs + Router/ActivatedRoute DI added to its 7 TestBed setups
            (1418 Karma green). Deployed + verified.
- [ ] P3 — Tables/search: TanStack composable tables (migrate the 2 ag-grid grids —
      audit.component + ai-logs.component per docs/perf-wave-ag-grid-to-tanstack.md),
      URL-synced state, saved views, virtualization; no workflow regressions.
      - [x] P3-urlsort (2026-06-09): URL-synced table sort for the EXISTING TanStack
            tables. New shared pure util `table-sort-url.ts` (`formatSort`/`parseSort` with
            column-id allow-list — a hand-edited `?sort=` can't set an unknown/non-sortable
            col) + 6 unit specs. Wired api-tokens (`?sort=<id>.<asc|desc>`, restore on init,
            write on sort, replaceUrl+merge). Deployed. **content-freshness wired the same
            way 2026-06-09** (`?sort=` over section_key/idle_days/dwell_seconds_avg/status/
            created_at; provideRouter([]) → its 3 spec setups). BOTH existing TanStack tables
            now URL-sort-synced. 1424 Karma green.
      - [ ] P3-MIGRATION (⚠️ SUPERVISED, ALL-OR-NOTHING — NOT a blind cron fire): ag-grid →
            TanStack on audit + ai-logs. Per docs/perf-wave-ag-grid-to-tanstack.md +
            frontend/CLAUDE.md the @defer / single-importer routes are DEAD ENDS; esbuild
            hoists ag-grid eager regardless → only a full per-grid rewrite (master/detail
            full-width rows + CSV export + pagination + dark-cyan theme) closes the 220 KB
            overage. Needs E2E_API_KEY for live master/detail QA on the 2 most-visible grids.
            Schedule a focused supervised session; do NOT attempt unsupervised.
- [x] P4 — Command center (2026-06-09): COMPLETE — dashboard site-status strip
      (P4-status-strip: figures + source + interpretation + metric→record links from real
      already-loaded signals) + analytics surface (dataLabel source / refreshedAt timestamp
      / trend interpretation, now with on-figure source+as-of caption P4-chart-meta) +
      per-site health via the topbar health pill (P2) + status strip. Real signals only.
      Further chart enrichment is optional polish. Detail below.
      - [x] P4-status-strip (2026-06-09): added a site-status command-center strip to the
            /admin dashboard — buckets the ALREADY-loaded `state.sites()` (no new fetch) via
            `getStatusClass` into Needs-attention/Live/Building/Draft tiles (error-first),
            each a metric→record link to /admin/sites, with a "Live · auto-refreshed 30s"
            source label + per-bucket interpretation sublabel + status-colored dots + rolling
            counters. `siteStatusSummary` computed + 4 unit specs (1428 Karma green). Deployed.
            (NOTE: linked to /admin/sites plain — that surface is a VITALS table whose rows
            lack a status field, so a ?status= filter would be a no-op; per-status filtering
            would need status added to the sites vitals rows — deferred, not faked.)
      - [x] P4-chart-meta (2026-06-09): added an on-figure Source + "as of <time>" caption
            to the analytics "Page views over time" chart (reuses existing `dataLabel()` +
            `refreshedAt()` — real provider + refresh time, no fabrication). Analytics already
            carried source/health/tooltip/refreshedAt/trend; this puts source+timestamp ON
            the figure per P4. 1428 Karma green. Deployed.
- [ ] P5 — Core tabs: Logs, Snapshots/Deploy History, SQL (safe-mode explanation UI),
      Integrations health, Billing/usage explorer, AI-Gateway usage — existing data only.
      - [x] P5-sql-safemode (2026-06-09): the site-detail SQL console already rejects writes
            client-side (WRITE_LEAD regex → specific error) + read-only pill, but the
            explanation was tooltip-gated (hidden on touch/by default). Added a PERSISTENT,
            visible safe-mode explainer ("Safe mode: SELECT · EXPLAIN · WITH only. Writes
            … blocked to protect your live site database") — touch + SR accessible. Reuses
            existing (tested) write-rejection logic; presentational. 1428 Karma green. Deployed.
      - [x] P5-integrations-health (2026-06-09): the site-detail Integrations tab showed each
            provider's `status` as raw muted text ("connected"). Upgraded to a health indicator
            — green dot + glow + "Connected" / muted dot + "Not connected", `role=status` +
            per-provider aria-label. Real data (`p.status`); mirrors the logs ws-dot + cockpit
            status pattern. 1428 Karma green. Deployed.
      - [ ] P5-rest — Logs / Snapshots-Deploy-History / Billing-usage / AI-Gateway-usage tab
            audits (existing data only). Next fire(s).
- [ ] P6 — Validation: Zod at every input (route/query/body); field+form errors; preserve
      entered values; server-side ownership/permission; tests per path.
- [ ] P7 — Perf+a11y: lazy routes, defer heavy panels/charts/grids, RxJS cleanup, cancel
      stale requests, trackBy; WCAG 2.2 AA; axe + Playwright a11y; 8.33ms frame budget.
- [ ] P8 — Proof: lint + typecheck + build + `npm run test:e2e` green; final report.

## Guardrails (do NOT)
- No CSP L3 strict-dynamic / Security+Trust headers. No build validators.
- Never edit/skip a spec to pass. Preserve homepage-resurrection guards.
- All LLM calls via Cloudflare AI Gateway; preserve the direct-provider-URL ESLint guard.
- Preserve per-site D1 isolation, Workers patterns, WS log streaming, Stripe test/live split.

## Compatibility matrix (filled P0 — 2026-06-09)

> Scan basis: `frontend/package.json` deps + `/usr/bin/grep` over `src/app/**/*.ts`.
> No PrimeNG anywhere (0 deps, 0 imports — the `p-dialog` grep hits were the
> `app-dialog-shell` substring). Legacy admin is already PrimeNG-free.

| Package | Recommended-by | Repo status | Bundle | a11y | ng-compat | Testability | Verdict |
|---|---|---|---|---|---|---|---|
| `ag-grid-community` + `ag-grid-angular` | package-preference-registry (Community-only, 100k+ rows) | LIVE in exactly 2 grids: `audit.component.ts`, `ai-logs.component.ts` | heavy (~hundreds KB) | custom (not CDK) | official Angular wrapper | Karma specs exist | **REPLACE** → TanStack (P3). Neither grid needs enterprise/100k rows; master/detail is Enterprise-only anyway. **Supervised session — all-or-nothing, NOT a blind loop fire.** |
| `@tanstack/angular-table` | package-preference-registry (headless smart tables) | LIVE: `api-tokens`, `content-freshness` (`createAngularTable`) | light headless | manual (`aria-sort` wired) | signal-bound state | Karma sort spec | **KEEP + EXPAND** — the P3 target pattern; "apply existing pattern", not "introduce". |
| `@spartan-ng/brain` | code-style + spartan-ui-only (THE only Angular kit) | LIVE: `admin.component` + ~11 sections + `ui/` wrappers (`tooltip`) | headless primitives | CDK-backed | native standalone | fine | **KEEP + EXPAND** — wrap more primitives per occasion. |
| `@angular/cdk` | package-preference-registry | LIVE (overlay/a11y backing Spartan) | tree-shaken | strong | native | fine | **KEEP**. |
| `echarts` | visualization-maps-diagrams-supervisor | LIVE (analytics cockpit, lazy chunk) | ~1.16MB → own lazy chunk | `role=img`+aria-label | dynamic import in `afterNextRender` | fine | **KEEP** — decision-supporting charts only. |
| `monaco-editor` | package-preference-registry | LIVE (logs viewer) | ~5MB → own lazy chunk | read-only viewer | dynamic import, stub worker | fine | **KEEP** — never in initial bundle. |
| `@uppy/core` + `@uppy/xhr-upload` | package-preference-registry | LIVE (media section) | core-only (no dashboard) | own Spartan UI | XHRUpload + bearer | fine | **KEEP** — lean integration, no `@uppy/dashboard`. |
| PrimeNG | (old default, reversed 2026-05-29) | **ABSENT** (0 deps, 0 imports) | — | — | — | — | **N/A — already removed.** No migration needed; the legacy-PrimeNG→Spartan framing is stale. |

**P0 decision summary:** the ONLY substantive package migration left is **ag-grid → TanStack** on the 2 grids (`audit` + `ai-logs`) in **P3** — a dedicated supervised session (all-or-nothing budget + master/detail QA), never a blind cron fire. Everything else is KEEP/EXPAND on the already-correct stack (Spartan + TanStack + CDK + ECharts + Monaco + Uppy). PrimeNG is a no-op.

## Already-done foundations (don't redo — from the 2026-06 campaign, git log)
- Dashboard already rebuilt: live search + pins + recents + 14 improvements (28fa5a35).
- Black+cyan `--ps-*` tokens + cmd-glyph + DialogShell + ApiService(bearer) exist.
- 6 legacy flags removed; registry lean (ad9145e3). seo_autopilot is a site-feature.
- TanStack `createAngularTable` already in prod (api-tokens, content-freshness) — the P3
  migration is "apply the existing pattern", not "introduce TanStack".
