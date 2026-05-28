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

- [ ] SITE-01 — Create site (manual `POST /api/sites`) → row in D1 → (no spec yet — to RED)
- [ ] SITE-02 — Create from search → triggers `site-generation` workflow → `e2e/ai-workflow.spec.ts`
- [ ] SITE-03 — `GET /api/sites` lists caller's sites → (no spec yet — to RED)
- [ ] SITE-04 — `GET /api/sites/:id` returns single → (no spec yet — to RED)
- [ ] SITE-05 — `GET /api/sites/:id/workflow` shows step-by-step progress → `e2e/ai-workflow.spec.ts`
- [ ] SITE-06 — `GET /api/sites/:id/logs` returns audit log slice → `e2e/logs-and-delete.spec.ts`
- [ ] SITE-07 — `POST /api/sites/:id/reset` flips status to draft + rebuilds → (no spec yet — to RED)
- [ ] SITE-08 — `POST /api/sites/:id/deploy` accepts zip → unpacks to R2 → (no spec yet — to RED)
- [ ] SITE-09 — `POST /api/sites/:id/publish-bolt` publishes bolt files → (no spec yet — to RED)
- [ ] SITE-10 — `DELETE /api/sites/:id` soft-deletes + clears KV → `e2e/logs-and-delete.spec.ts`
- [ ] SITE-11 — Subdomain serving: `{slug}.projectsites.dev` resolves from D1+KV → (no spec yet — to RED)
- [ ] SITE-12 — Unpaid site injects top bar after `<body>` → (no spec yet — to RED)
- [ ] SITE-13 — Custom hostname provisioning via CF for SaaS → `e2e/domain-management.spec.ts`
- [ ] SITE-14 — Set primary hostname swaps default → `e2e/domain-management.spec.ts`
- [ ] SITE-15 — Hostname unsubscribe removes from primary → `e2e/domain-management.spec.ts`
- [ ] SITE-16 — Branded error pages (400/404/500/503) render with Fira Code → (no spec yet — to RED)

## H. Editor / Bolt embed — `EDITOR-*`

- [ ] EDITOR-01 — `/admin/editor` mounts iframe to `editor.projectsites.dev` → `e2e/bolt-chat-ready.spec.ts`
- [ ] EDITOR-02 — Bolt iframe survives admin sub-route nav (BoltEmbedService) → (no spec yet — to RED)
- [ ] EDITOR-03 — `PS_BOLT_READY` postMessage flips loading state → `e2e/bolt-chat-ready.spec.ts`
- [ ] EDITOR-04 — `PS_APP_RUNNING` postMessage enables save → (no spec yet — to RED)
- [ ] EDITOR-05 — `PS_FILES_READY` postMessage enables publish → (no spec yet — to RED)
- [ ] EDITOR-06 — Bolt chat persists via `/api/editor/chats/*` → (no spec yet — to RED)
- [ ] EDITOR-07 — AI-edit (Cmd+I in iframe) round-trips → `e2e/ai-edit.spec.ts`
- [ ] EDITOR-08 — Inline editing in published preview → `e2e/inline-editing.spec.ts`

## I. Media library — `MEDIA-*`

- [ ] MEDIA-01 — `/api/media/assets` GET lists by kind+source+q → `e2e/media-library.spec.ts`
- [ ] MEDIA-02 — `/api/media/upload` multipart upload to R2 → `e2e/media-drop-zone.spec.ts`
- [ ] MEDIA-03 — Stock search across Unsplash/Pexels/Pixabay → `e2e/media-stock-search.spec.ts`
- [ ] MEDIA-04 — DALL·E image generation → `e2e/media-image-studio.spec.ts`
- [ ] MEDIA-05 — Podcast TTS generation (ElevenLabs / OpenAI) → `e2e/media-podcast-studio.spec.ts`
- [ ] MEDIA-06 — Send-to-bolt mints signed URL consumed by iframe → `e2e/media-send-to-bolt.spec.ts`
- [ ] MEDIA-07 — Soft-delete asset hides from list → (no spec yet — to RED)

## J. Env vars — `ENV-*`

- [ ] ENV-01 — `/api/env-vars` GET lists org+site+mcp vars with values hidden → `e2e/env-vars-manager.spec.ts`
- [ ] ENV-02 — Create scoped env var (org / site / mcp) → `e2e/env-vars-manager.spec.ts`
- [ ] ENV-03 — Update value + label preserves ID → `e2e/env-vars-manager.spec.ts`
- [ ] ENV-04 — Bulk import dotenv-style payload → `e2e/env-vars-import-export.spec.ts`
- [ ] ENV-05 — MCP-scoped env var picked up by AI dispatch → `e2e/env-vars-mcp-scope.spec.ts`

## K. AI workflow & build — `WORK-*`

- [ ] WORK-01 — Workflow step 1: `research-profile` returns business_type → `e2e/ai-workflow.spec.ts`
- [ ] WORK-02 — Workflow step 2 parallel: social+brand+selling-points+images all complete → (no spec yet — to RED)
- [ ] WORK-03 — Workflow step 2.5: logo + favicon-set + section-images generated → (no spec yet — to RED)
- [ ] WORK-04 — Workflow step 2.5b: scrape-website populates `_scraped_content.json` → (no spec yet — to RED)
- [ ] WORK-05 — Workflow step 3: structure-plan emits route tree → (no spec yet — to RED)
- [ ] WORK-06 — Workflow step 4: container-build returns dist → R2 → (no spec yet — to RED)
- [ ] WORK-07 — Workflow step 5: visual-inspection-final scores ≥7 → (no spec yet — to RED)
- [ ] WORK-08 — Workflow retries on transient failure (3x backoff) → (no spec yet — to RED)
- [ ] WORK-09 — Confidence UI surfaces per-attribute scores → `e2e/confidence-ui.spec.ts`
- [ ] WORK-10 — Business enrichment via Google Places → `e2e/business-enrichment.spec.ts`

## L. Webhooks — `WEBHOOK-*`

- [ ] WEBHOOK-01 — `/webhooks/stripe` signature verification rejects bad signature → (no spec yet — to RED)
- [ ] WEBHOOK-02 — `/webhooks/stripe` dedupes by `event.id` (idempotency) → (no spec yet — to RED)
- [ ] WEBHOOK-03 — `/webhooks/voice/twilio-voice` accepts call events → (no spec yet — to RED)
- [ ] WEBHOOK-04 — `/webhooks/sms/twilio-sms` accepts inbound SMS → (no spec yet — to RED)
- [ ] WEBHOOK-05 — `/internal/voice/media-stream` bridges Twilio audio → ElevenLabs → (no spec yet — to RED)

## M. Per-feature-flag — `FLAG-*` (one per of 103 flags)

> Each flag spec verifies: (a) GET `/api/feature-flags/:key` returns docs+resolved, (b) flag-off API returns 404, (c) toggle ON via admin UI flips state.

### Stage = stable (7 flags — verify happy path only)
- [ ] FLAG-accessibility_statement → (no spec yet — to RED)
- [ ] FLAG-cli_tool → (no spec yet — to RED)
- [ ] FLAG-llms_txt → (no spec yet — to RED)
- [ ] FLAG-mcp_server → (no spec yet — to RED)
- [ ] FLAG-public_api → (no spec yet — to RED)
- [ ] FLAG-quotable_answer_block → (no spec yet — to RED)
- [ ] FLAG-speculation_rules → (no spec yet — to RED)
- [ ] FLAG-structured_data_autopilot → (no spec yet — to RED)

### Stage = experimental (95 flags — verify flag-off 404 + flag-on 200)
- [ ] FLAG-affiliate_program → (no spec yet — to RED)
- [ ] FLAG-agency_tier → (no spec yet — to RED)
- [ ] FLAG-ai_ab_test_generator → (no spec yet — to RED)
- [ ] FLAG-ai_agent_marketplace → (no spec yet — to RED)
- [ ] FLAG-ai_alt_text → (no spec yet — to RED)
- [ ] FLAG-ai_auto_router → (no spec yet — to RED)
- [ ] FLAG-ai_video_courses → (no spec yet — to RED)
- [ ] FLAG-approval_workflow → (no spec yet — to RED)
- [ ] FLAG-audit_hash_chain → (no spec yet — to RED)
- [ ] FLAG-auto_changelog → (no spec yet — to RED)
- [ ] FLAG-auto_gen_static_files → (no spec yet — to RED)
- [ ] FLAG-axe_publish_gate → (no spec yet — to RED)
- [ ] FLAG-brand_voice_clone → (no spec yet — to RED)
- [ ] FLAG-browser_extension → (no spec yet — to RED)
- [ ] FLAG-byo_cloudflare → (no spec yet — to RED)
- [ ] FLAG-cdp_engine → (no spec yet — to RED)
- [ ] FLAG-chat_ops_bot → (no spec yet — to RED)
- [ ] FLAG-cold_tier_thaw → (no spec yet — to RED)
- [ ] FLAG-community_engine → (no spec yet — to RED)
- [ ] FLAG-competitor_monitor → (no spec yet — to RED)
- [ ] FLAG-cornerstone_autorefresh → (no spec yet — to RED)
- [ ] FLAG-cost_attribution → (no spec yet — to RED)
- [ ] FLAG-crdt_coedit → (no spec yet — to RED)
- [ ] FLAG-critical_css_inline → (no spec yet — to RED)
- [ ] FLAG-crm_engine → (no spec yet — to RED)
- [ ] FLAG-customer_site_copilot → (no spec yet — to RED)
- [ ] FLAG-cwv_publish_gate → (no spec yet — to RED)
- [ ] FLAG-d1_multi_region → (no spec yet — to RED)
- [ ] FLAG-db_provisioning → (no spec yet — to RED)
- [ ] FLAG-diff_revert → (no spec yet — to RED)
- [ ] FLAG-domain_reseller → (no spec yet — to RED)
- [ ] FLAG-donations_engine → (no spec yet — to RED)
- [ ] FLAG-ecommerce_engine → (no spec yet — to RED)
- [ ] FLAG-egress_control → (no spec yet — to RED)
- [ ] FLAG-enterprise_sso → (no spec yet — to RED)
- [ ] FLAG-faq_from_tickets → (no spec yet — to RED)
- [ ] FLAG-geo_visibility_tracker → (no spec yet — to RED)
- [ ] FLAG-ghost_routes → (no spec yet — to RED)
- [ ] FLAG-github_sync → (no spec yet — to RED)
- [ ] FLAG-hallucination_guard → (no spec yet — to RED)
- [ ] FLAG-hipaa_variant → (no spec yet — to RED)
- [ ] FLAG-i18n_auto_locale → (no spec yet — to RED)
- [ ] FLAG-ide_sandbox → (no spec yet — to RED)
- [ ] FLAG-image_triplet_pipeline → (no spec yet — to RED)
- [ ] FLAG-lms_engine → (no spec yet — to RED)
- [ ] FLAG-logo_regenerator → (no spec yet — to RED)
- [ ] FLAG-loyalty_engine → (no spec yet — to RED)
- [ ] FLAG-membership_paywall → (no spec yet — to RED)
- [ ] FLAG-mobile_admin → (no spec yet — to RED)
- [ ] FLAG-multi_agent_concurrent → (no spec yet — to RED)
- [ ] FLAG-multi_model_router → (no spec yet — to RED)
- [ ] FLAG-native_booking_engine → (no spec yet — to RED)
- [ ] FLAG-native_desktop_admin → (no spec yet — to RED)
- [ ] FLAG-native_mobile_admin → (no spec yet — to RED)
- [ ] FLAG-newsletter_engine → (no spec yet — to RED)
- [ ] FLAG-oklch_contrast_lift → (no spec yet — to RED)
- [ ] FLAG-otlp_unified_events → (no spec yet — to RED)
- [ ] FLAG-page_podcast → (no spec yet — to RED)
- [ ] FLAG-pci_dss_l1 → (no spec yet — to RED)
- [ ] FLAG-predicted_actions → (no spec yet — to RED)
- [ ] FLAG-progressive_skeleton_build → (no spec yet — to RED)
- [ ] FLAG-pwa_manifest_full → (no spec yet — to RED)
- [ ] FLAG-referral_credits → (no spec yet — to RED)
- [ ] FLAG-row_hover_actions → (no spec yet — to RED)
- [ ] FLAG-rum_telemetry → (no spec yet — to RED)
- [ ] FLAG-runway_style_ref → (no spec yet — to RED)
- [ ] FLAG-saved_views → (no spec yet — to RED)
- [ ] FLAG-section_overlay → (no spec yet — to RED)
- [ ] FLAG-site_mcp_server → (no spec yet — to RED)
- [ ] FLAG-slo_tracker → (no spec yet — to RED)
- [ ] FLAG-sms_marketing → (no spec yet — to RED)
- [ ] FLAG-snapshot_rollback → (no spec yet — to RED)
- [ ] FLAG-soc2_program → (no spec yet — to RED)
- [ ] FLAG-sparkline_overlays → (no spec yet — to RED)
- [ ] FLAG-speed_compare_widget → (no spec yet — to RED)
- [ ] FLAG-speed_score_widget → (no spec yet — to RED)
- [ ] FLAG-split_view_drawer → (no spec yet — to RED)
- [ ] FLAG-streaming_generation → (no spec yet — to RED)
- [ ] FLAG-stripe_meters → (no spec yet — to RED)
- [ ] FLAG-template_marketplace → (no spec yet — to RED)
- [ ] FLAG-tenant_hot_state → (no spec yet — to RED)
- [ ] FLAG-tenant_sentry_releases → (no spec yet — to RED)
- [ ] FLAG-tier_rate_limit → (no spec yet — to RED)
- [ ] FLAG-token_burn_meter → (no spec yet — to RED)
- [ ] FLAG-upsell_campaign_month3 → (no spec yet — to RED)
- [ ] FLAG-veo_hero_loop → (no spec yet — to RED)
- [ ] FLAG-visitor_recognition → (no spec yet — to RED)
- [ ] FLAG-visual_editor_drag_drop → (no spec yet — to RED)
- [ ] FLAG-voice_editing → (no spec yet — to RED)
- [ ] FLAG-wcag22_wizard → (no spec yet — to RED)
- [ ] FLAG-web_push → (no spec yet — to RED)
- [ ] FLAG-wfp_dispatch → (no spec yet — to RED)
- [ ] FLAG-whitelabel_admin → (no spec yet — to RED)
- [ ] FLAG-worker_marketplace → (no spec yet — to RED)
- [ ] FLAG-workflows_v2_sitegen → (no spec yet — to RED)

## N. MCP — `MCP-*`

- [ ] MCP-01 — `/api/mcp/:provider/connect` returns authorize URL with PKCE → (no spec yet — to RED)
- [ ] MCP-02 — `/api/mcp/:provider/callback` exchanges code + encrypts token → (no spec yet — to RED)
- [ ] MCP-03 — `/api/mcp/:provider/connect` returns 501 when OAuth unconfigured → (no spec yet — to RED)
- [ ] MCP-04 — `/api/mcp/:provider/paste` accepts paste-key when 501 → (no spec yet — to RED)
- [ ] MCP-05 — Site MCP server `/{slug}/mcp` serves manifest → (no spec yet — to RED)
- [ ] MCP-06 — Site MCP server `/{slug}/.well-known/mcp` discovery → (no spec yet — to RED)

## O. Domains — `DOMAIN-*`

- [ ] DOMAIN-01 — `/api/domains/search` returns availability across TLDs → `e2e/domain-management.spec.ts`
- [ ] DOMAIN-02 — `/api/domains/purchase` charges wallet → registers domain → (no spec yet — to RED)
- [ ] DOMAIN-03 — Domain picker shows live RDAP availability → (no spec yet — to RED)
- [ ] DOMAIN-04 — Add custom hostname → CF for SaaS verifies CNAME → `e2e/domain-management.spec.ts`
- [ ] DOMAIN-05 — Hostname modal interactive (delete/primary toggle) → `e2e/domain-modal-interactive.spec.ts`
- [ ] DOMAIN-06 — `/api/admin/domains` super-admin lists all domains → (no spec yet — to RED)

## P. Voice / SMS — `VOICE-*` (flag-gated `voice_editing`)

- [ ] VOICE-01 — Reserve Twilio phone number → (no spec yet — to RED) — needs `TWILIO_*` secrets
- [ ] VOICE-02 — Configure inbound voice agent prompt → (no spec yet — to RED)
- [ ] VOICE-03 — Outbound SMS campaign send → (no spec yet — to RED)
- [ ] VOICE-04 — Voice-mode keyboard shortcut activates dictation → (no spec yet — to RED)

## Q. Pulse Social — `SOCIAL-*`

- [ ] SOCIAL-01 — Connect social account via OAuth (X, IG, FB, LI) → (no spec yet — to RED)
- [ ] SOCIAL-02 — Paste-key fallback when OAuth unconfigured → (no spec yet — to RED)
- [ ] SOCIAL-03 — Create + schedule cross-platform post → (no spec yet — to RED)
- [ ] SOCIAL-04 — Aggregate analytics across accounts → (no spec yet — to RED)
- [ ] SOCIAL-05 — Pulse post fan-out via Workflow → (no spec yet — to RED)

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
- [ ] LINT-02 — `npx tsc --noEmit` exits 0 (Worker)
- [ ] LINT-03 — `npx tsc --noEmit -p tsconfig.app.json` exits 0 (SPA)

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
