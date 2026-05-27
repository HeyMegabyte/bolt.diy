# projectsites.dev — Rebuild Audit

> **Pure read-only audit.** No file mutations. Pre-flight for the Angular 21 + Nx + Ionic + Capacitor + PrimeNG v2 rebuild.
> **Goal**: identify every homepage variant, name the resurrection vector that lets dead variants keep coming back, inventory backend features
> wired through the current admin UI, and extract a captured design-token block ready for `libs/ui/src/theme/extracted-tokens.ts`.
>
> **Generated**: 2026-05-26 by Architect sub-agent. Source-of-truth = current `main`.

---

## 0. TL;DR

- **Canonical homepage** today = the Angular 21 `CinematicLandingComponent` at
  `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/frontend/src/app/pages/homepage/cinematic/cinematic-landing.component.ts`,
  wired to `path: ''` in `app.routes.ts:8`.
- **Resurrection vector**: `apps/project-sites/scripts/upload_to_r2.sh` blindly walks the `apps/project-sites/r2-sync/` tree
  and overwrites `marketing/index.html` in R2 from the still-committed
  `apps/project-sites/r2-sync/marketing/index.html` (a vanilla-HTML legacy homepage last touched 2026-02-16).
  Whichever of (`upload_to_r2.sh`, `deploy-r2.mjs`) runs last wins. Both ship in `scripts/`. CI uses `deploy-r2.mjs`
  but any operator (or stale runbook) running `upload_to_r2.sh` resurrects the vanilla homepage.
- **Bolt.diy editor** lives at `editor.projectsites.dev` (Remix root `/app`). It is NOT a homepage variant — it is iframed
  into `/admin/editor` via `BoltEmbedService`. Leave it alone.
- **Customer-site templates** (R2 prefix `sites/{slug}/{version}/`) are also NOT homepage variants — they are *generated*
  customer sites the worker serves on `{slug}.projectsites.dev`. Out of scope.
- **123 D1 tables**, **27 admin sections**, **5 SSE streaming routes**, **0 client-side WebSockets** (one server-side
  `WebSocketPair` in `voice_orchestrator.ts`).
- The brand tokens (`--ps-bg`, `--ps-ink`, `--ps-accent`) live *only as fallbacks* in `var(--ps-bg, #060610)`-style
  declarations; no `:root` block actually sets them. Phase 2 design-token extraction must materialise them.

---

## 1. Homepage Variants Inventory

> Defined as: any file that renders the marketing homepage shell OR a near-identical landing-page surface served at
> `https://projectsites.dev/`. Customer-site renderers (`sites/{slug}/v1/index.html`) and bolt.diy's IDE shell
> (`editor.projectsites.dev`) are NOT homepage variants and are listed in §1.6 for completeness.
>
> Files grouped by lineage. Within each group exactly ONE row is marked `[CANONICAL]` based on the latest commit
> timestamp on a non-`Latest`-suffixed message (or, when all are `Latest`, the most recent in-tree commit).

### 1.1 v2 — Angular 21 Cinematic Landing **[CANONICAL HOMEPAGE]**

Mounted at `path: ''` in `app.routes.ts:8`. View Transitions + OKLCH mesh + rolling counters + before-after slider.

| Status | File | Last commit | Notes |
|---|---|---|---|
| **[CANONICAL]** | `apps/project-sites/frontend/src/app/pages/homepage/cinematic/cinematic-landing.component.ts` | `e4...` — 2026-05-24 22:55 | Persona-aligned cinematic hero, declared canonical in `AB-TEST.md` 2026-05-24, wired to `/` |
| ↳ section | `apps/project-sites/frontend/src/app/pages/homepage/cinematic/sections/unified-ai-section.component.ts` | 2026-05-24 22:55 | Sole subsection of the cinematic landing |

### 1.2 v1.5 — Angular 21 Classic A/B/C Homepage (fallback at `/classic`)

Pre-cinematic Tailwind-heavy homepage. Preserved per `app.routes.ts:15-21` so existing screenshots / PostHog events
can still reach it. Reachable at `https://projectsites.dev/classic`. Used as the bake-off baseline in the
`homepage_hero_v2` PostHog feature flag.

| Status | File | Last commit | Notes |
|---|---|---|---|
| keep | `apps/project-sites/frontend/src/app/pages/homepage/homepage.component.ts` | `6728711` 2026-05-24 23:04 | A/B/C variant resolver (querystring → PostHog flag → localStorage random) |
| keep | `apps/project-sites/frontend/src/app/pages/homepage/homepage.component.html` | 2026-05-25 22:43 (PR `d4294a3`) | Sticky nav + hero + features + pricing + FAQ |
| keep | `apps/project-sites/frontend/src/app/pages/homepage/homepage.component.scss` | 2026-05-24 19:37 | Local hero / nav styles |
| keep | `apps/project-sites/frontend/src/app/pages/homepage/AB-TEST.md` | 2026-05-24 20:01 | A/B/C decision-flow + event-emission contract |

**Phase-8 decision**: this is the *intentional fallback*. Keep it during the rebuild only if Brian wants a kill-switch
for the cinematic. If the v2 rebuild lands clean, both this and the cinematic move under the new
`libs/feature/marketing-home/` Nx lib and `/classic` is dropped from the new routes.

### 1.3 v1 — Vanilla-HTML legacy "ProjectSites" homepage (CHECKED IN, RESURRECTABLE)

Last live before the Angular migration. Lives in two committed locations. The `apps/project-sites/public/index.html`
copy was removed (see §2 confirmation) but the **`r2-sync/marketing/index.html` mirror remains** and is the source
of the resurrection vector.

| Status | File | Last commit | Notes |
|---|---|---|---|
| **[CANONICAL of this lineage]** | `apps/project-sites/r2-sync/marketing/index.html` | `2280b71` 2026-02-16 00:51 | Vanilla HTML + Uppy + Lottie + Inter font. Has full meta + OG + manifest tags. Uploaded by `upload_to_r2.sh` to R2 `marketing/index.html`. **THIS is the resurrection vector source.** |
| (removed from disk) | `apps/project-sites/public/index.html` | last seen `c20357c` 2026-04-30 22:33 (msg `"Latest"`) | No longer on disk. Earlier history shows redesigns at `8806750` (2026-04-25 "feat: refactor site generation to skill-based container architecture") and `ff805e9` (2026-04-18 "gorgeous homepage redesign with Tailwind + shadcn/ui patterns"). |

### 1.4 v2 — Angular 21 shell `index.html` (NOT a homepage variant, but listed for completeness)

| Status | File | Last commit | Notes |
|---|---|---|---|
| keep | `apps/project-sites/frontend/src/index.html` | `d4294a3` 2026-05-25 22:45 | Angular `<app-root>` shell + GTM + GA4 snippet. This is the production R2-served HTML (uploaded by `deploy-r2.mjs`). Not a "homepage" — it's the SPA mount point. |

### 1.5 Legacy public-folder HTML pages (sibling pages, share the v1 lineage)

These rode along with `r2-sync/marketing/index.html` and are still uploaded by `upload_to_r2.sh`:

| Status | File | Last commit | Phase-8 action |
|---|---|---|---|
| delete | `apps/project-sites/public/content.html` | `9083059` 2026-03-02 21:29 | Content-policy legacy page. Angular `/content` route handles this now. |
| delete | `apps/project-sites/public/privacy.html` | `7c7f017` 2026-02-16 00:45 | Angular `/privacy` route handles this. |
| delete | `apps/project-sites/public/terms.html` | `7c7f017` 2026-02-16 00:45 | Angular `/terms` route handles this. |
| delete | `apps/project-sites/public/status.html` | `fe4f5ce` 2026-05-21 21:36 | Worker `app.get('/status')` (`src/index.ts:322`) fetches `marketing/status.html` from R2. Move this surface into Angular (`pages/status/`) too — already partially done. |
| delete | `apps/project-sites/public/app.js` | `e25ac40` 2026-05-20 23:21 | **Universal customer-site script**, NOT a homepage script. Loaded by *generated customer sites* via `<script src="https://projectsites.dev/app.js" data-slug="...">`. **DO NOT DELETE without ALSO removing every reference from container template + R2-uploaded customer sites.** Phase 8: relocate to a dedicated `customer-runtime/` folder + dedicated R2 prefix so it stops sharing the marketing surface. |
| delete | `apps/project-sites/public/forms.js` | 2026-02 baseline | Companion to the legacy vanilla homepage's form submission. |
| delete | `apps/project-sites/public/widgets.js` | 2026-02 baseline | Companion widgets — unused once vanilla homepage is gone. |
| keep | `apps/project-sites/public/{favicon.ico, icon-*.png, logo-*.svg, site.webmanifest, browserconfig.xml, walkthrough/*}` | 2026-05-25 22:43 | Brand asset folder, still consumed by the Angular `index.html` shell and the worker. Move to `apps/project-sites/frontend/public/` (which already exists) so there is ONE asset folder. |

### 1.6 Out-of-scope (not homepage variants — included to prevent confusion)

| File | Why it looks like a homepage but isn't |
|---|---|
| `app/styles/index.scss` (Remix root) | Stylesheet for the bolt.diy IDE at `editor.projectsites.dev`. Not the marketing homepage. |
| `apps/project-sites/r2-sync/sites/bella-cucina/v1/index.html` (committed 2026-02-06 by `be5144c`) | Sample CUSTOMER site for `bella-cucina.projectsites.dev`. Has its own subdomain. |
| `apps/project-sites/samples/demo-site/index.html` (committed 2026-02-06 by `128b884`) | Reference template for the original R2 upload script — never uploaded by current scripts, never referenced from `src/` or current `scripts/`. **Orphaned. Delete in Phase 8.** |
| `apps/project-sites/scripts/e2e_server.cjs` | Local mock dev server. References `public/index.html` (which no longer exists), so it CANNOT currently boot — that's a separate bug, log under §3.7. |

---

## 2. Resurrection Vector

**Question**: what mechanism is causing dead homepages to keep coming back?

**Concrete answer**: `apps/project-sites/scripts/upload_to_r2.sh`.

### 2.1 The two upload paths

The repo currently ships **two competing R2 upload scripts** that both write to the same R2 keyspace (`marketing/index.html`):

| Script | Source dir | Destination | Used by |
|---|---|---|---|
| `apps/project-sites/scripts/upload_to_r2.sh` | `apps/project-sites/r2-sync/` (committed snapshot of the **vanilla HTML homepage**) | `r2://project-sites-{env}/marketing/index.html` (overwrites Angular dist!) | Manual / runbook only — **not in CI** |
| `apps/project-sites/frontend/scripts/deploy-r2.mjs` | `apps/project-sites/frontend/dist/project-sites-frontend/browser/` (the **Angular build output**) | `r2://project-sites-{env}/marketing/{file}` | `.github/workflows/project-sites.yaml:164,286` and `.github/workflows/container-deploy.yaml:89` |

### 2.2 Why it resurrects

Both scripts upload to the same R2 prefix. `upload_to_r2.sh` is keyed against the *committed* `r2-sync/marketing/index.html`,
which still contains the **2026-02-16 vanilla-HTML homepage** (`r2-sync/marketing/index.html:1`):

```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ...
  <title>ProjectSites - Your Website, Handled. Finally.</title>
```

If an operator (or any documentation file, or any sub-agent reading legacy `SETUP.md` / `r2-sync/` README hints) runs
`./scripts/upload_to_r2.sh production`, the legacy HTML overwrites the Angular `index.html` that
`deploy-r2.mjs` placed in R2. The worker happily serves it because the CSP/cache headers attached at
`src/index.ts:489-512` apply to whatever blob lives at the `marketing/index.html` key — the worker does NOT
verify that the blob is the Angular SPA.

There is no CI step that pulls `r2-sync/marketing/index.html` out of the upload set (`find "$SYNC_DIR" -type f -print0`),
so every file under `r2-sync/` ships unconditionally. The `r2-sync/` directory was likely intended as a "documentation
of what's in R2" mirror, but became a write source.

### 2.3 Secondary resurrection routes (less acute but real)

- **`apps/project-sites/scripts/e2e_server.cjs:90`** — local dev mock falls back to `public/index.html` (file does not
  exist) and the comment block at line 4 still describes "Serves public/index.html". If the file is ever recreated
  to make local dev work, the legacy lineage seeps back in via copy-paste of an old `public/index.html`.
- **`apps/project-sites/public/status.html`** — committed under git but Angular's `/status` route also exists. Until
  Phase 8 deletes the file, the worker special-cases `/status` (`src/index.ts:320-330`) to read `marketing/status.html`
  from R2 — which is uploaded ONLY by `upload_to_r2.sh`, so running that script also re-introduces a legacy status
  page if the Angular shell hasn't taken over `/status` yet.
- **`r2-sync/marketing/index.html` being checked into git** — every `git clone` of the repo into a new build agent
  resurrects the file on disk, so the file is never truly gone until the deletion lands in `main` AND every
  long-running build agent has rebased.

### 2.4 The kill (proposed Phase 8 — implementation comes later)

1. Delete `apps/project-sites/scripts/upload_to_r2.sh` (or rewrite it to be an `--allow-legacy` opt-in that refuses
   to run by default).
2. Delete the entire `apps/project-sites/r2-sync/marketing/` subtree from git (`r2-sync/sites/bella-cucina/v1/`
   should also be deleted unless E2E specs depend on it — verified-not-referenced; see §1.6).
3. Delete `apps/project-sites/public/{content,privacy,terms,status}.html`, `apps/project-sites/public/{forms,widgets}.js`.
   The Angular routes already cover those surfaces.
4. Relocate `apps/project-sites/public/app.js` (customer-site runtime) to a dedicated `apps/project-sites/customer-runtime/`
   folder + R2 prefix `customer-runtime/app.js` so it stops sharing the marketing prefix. Update the customer template
   to load it from the new URL.
5. Add a `scripts/lint-no-legacy-homepage.mjs` check to CI that asserts:
   - `r2-sync/marketing/` does not exist
   - `apps/project-sites/public/index.html` does not exist
   - `dist/project-sites-frontend/browser/index.html` exists and contains `<app-root>`
6. Delete the orphan `apps/project-sites/samples/demo-site/` directory.

---

## 3. Backend Feature Inventory (admin UI)

> Every feature surfaced in the current admin UI, with route → component file → data-source service → backend endpoints
> → D1 tables. Routes pulled from `apps/project-sites/frontend/src/app/app.routes.ts:58-302`.

### 3.1 Admin shell

| Route | Component | Notes |
|---|---|---|
| `/admin` | `pages/admin/admin.component.ts` | Owns the persistent `<iframe #boltFrame>` for bolt.diy editor |
| `/admin` (index) | `pages/admin/sections/dashboard.component.ts` | New Perplexity-style AI dashboard, SSE streaming |
| `/admin/welcome` | `pages/admin/sections/editor.component.ts` | Onboarding shell |
| `/admin/dashboard` → redirect to `/admin` |  |  |

### 3.2 Admin sections (27 surfaces)

| Route | Component file | Primary services | Primary `/api/*` endpoints | D1 tables (inferred) |
|---|---|---|---|---|
| `/admin/dashboard` (index) | `sections/dashboard.component.ts` | `AdminStateService`, `DashboardChatService`, `SlashCommandRegistryService` | `/api/dashboard/chat` (SSE) | `calendar_events`, `activity_events`, `pulse_posts`, `chat_messages` |
| `/admin/editor` | `sections/editor.component.ts` | `BoltEmbedService` | (bolt.diy iframe `editor.projectsites.dev`) | `editor_chats`, `editor_chat_messages` |
| `/admin/editor-native` | `editor-native/pages/editor-native-page.component.ts` | `EditorChatService`, `EditorLlmService` | `/api/editor/llm/stream` (SSE) | `editor_chats`, `editor_chat_messages` |
| `/admin/accept-invite` | `sections/accept-invite.component.ts` | `ApiService` | `/api/team-invites/:token/accept` | `team_invites`, `agency_invitations` |
| `/admin/snapshots` | `sections/snapshots.component.ts` | `AdminStateService`, `ApiService`, `BoltEmbedService`, `TelemetryService` | `/api/sites/:id/snapshots`, `/api/sites/:id/snapshots/:snap` | `site_snapshots`, `iteration_snapshots`, `snapshot_metrics`, `diff_artworks` |
| `/admin/snapshots/diff` | `sections/snapshots-diff.component.ts` | `ApiService` | `/api/sites/:id/snapshots/:snap/diff` | `diff_artworks` |
| `/admin/sites` | `sections/sites.component.ts` | `ApiService`, `ToastService` | `/api/sites`, `/api/sites/sparklines` | `sites`, `hostnames`, `site_urls`, `subscriptions` |
| `/admin/analytics` | `sections/analytics.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/sites/:id/analytics`, `/api/admin/funnel` | `analytics_daily`, `funnel_events`, `usage_events`, `impressions`, `session_events`, `conversions` |
| `/admin/billing` | `sections/billing.component.ts` | `AdminStateService`, `ApiService`, `TelemetryService`, `ToastService` | `/api/billing/checkout`, `/api/billing/subscription`, `/api/billing/portal`, `/api/billing/embedded-checkout`, `/api/billing/cost-forecast`, `/api/admin/forecast/cost` | `subscriptions`, `wallet_accounts`, `wallet_transactions`, `billing_events`, `stripe_meter_map`, `stripe_usage_pushes`, `site_cost_daily`, `site_credit_caps`, `spend_alerts`, `coupons`, `refunds` |
| `/admin/audit` | `sections/audit.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/audit-logs`, `/api/admin/audit/scope` | `audit_logs`, `super_admin_audit`, `impersonation_sessions` |
| `/admin/forms` | `sections/forms.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/sites/:id/forms`, `/api/sites/:id/forms/:fid/submissions`, `/api/sites/:id/forms/:fid/rules` | `form_submissions`, `form_submission_replies`, `form_rules`, `form_rule_evaluations`, `form_api_keys`, `newsletter_integrations` |
| `/admin/docs` (overview) | `sections/docs/docs-overview.component.ts` | `ApiService`, `DocsSpecService` | `/api/admin/docs/stats`, `/api/ai/summarize-review` | (read-only; OpenAPI parse) |
| `/admin/docs/:endpointId` | `sections/docs/docs-endpoint.component.ts` | `ApiService`, `DocsSpecService` | `/api/admin/docs/stats`, `/api/ai/` | — |
| `/admin/ai-chat` → redirect to `settings#ai-chat` |  |  |  |  |
| `/admin/traces` (a.k.a. `/admin/ai-logs`) | `sections/ai-logs.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/sites/:id/ai-logs`, `/api/admin/traces/:id/explain` | `trace_events`, `ai_form_logs`, `mcp_calls` |
| `/admin/ai-endpoints` | `sections/ai-endpoints.component.ts` (+ subdir `ai-endpoints/`) | `AdminStateService`, `ApiService`, `ToastService` | `/api/ai/`, `/api/ai/site/:id/endpoints` | `ai_endpoints`, `ai_site_settings`, `ai_context_files`, `ai_chat_context_files`, `ai_blocklist` |
| `/admin/settings` | `sections/settings.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/mcp/`, `/api/mcp/:provider/connect`, `/api/sites/:id`, `/api/env-vars` | `mcp_connections`, `mcp_oauth_states`, `mcp_tools`, `mcp_resource_tokens`, `ai_env_vars`, `org_security`, `org_tags`, `org_brand_assets`, `org_transfers` |
| `/admin/user` | `sections/user-settings.component.ts` | `ApiService`, `AuthService`, `ToastService` | `/api/admin/api-keys`, `/api/admin/notifications`, `/api/auth/me` | `api_keys`, `notifications`, `users`, `sessions` |
| `/admin/domains` | `sections/domains.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/sites/:siteId/hostnames`, `/api/domains/search`, `/api/domains/purchase` | `hostnames`, `cf_credentials`, `site_urls` |
| `/admin/seo` | `sections/seo.component.ts` | `AdminStateService` | (read-only; render meta) | `site_urls`, `confidence_attributes` |
| `/admin/apps` | `sections/apps.component.ts` (+ `apps-catalog.data.ts`) | `ApiService` | `/api/apps/`, `/api/apps/catalog` | `app_instances`, `template_installs`, `templates`, `template_versions` |
| `/admin/apps/instances` | `sections/apps-instances.component.ts` | `ApiService` | `/api/apps/instances`, `/api/apps/instances/:id/logs` (SSE) | `app_instances` |
| `/admin/apps/instances/:id` | `sections/apps-instances.component.ts` (re-used) | — | — | — |
| `/admin/apps/:id` | `sections/apps-detail.component.ts` | `ApiService` | `/api/apps/:id` | `app_instances`, `template_installs` |
| `/admin/social` | `sections/social.component.ts` | `AdminStateService`, `ApiService`, `ToastService` | `/api/social/`, `/api/social/:platform/connect`, `/api/social/:platform/disconnect` | `social_accounts`, `social_publishes`, `social_auto_pilot`, `social_analytics_snapshots`, `pulse_posts`, `broadcasts` |
| `/admin/social/analytics` | `sections/social-analytics.component.ts` | `AdminStateService` | `/api/social/analytics` | `social_analytics_snapshots` |
| `/admin/media` | `sections/media.component.ts` | `ApiService`, `BoltEmbedService`, `ToastService` | `/api/media/assets`, `/api/media/assets/:id`, `/api/media/upload`, `/api/media/generate/image`, `/api/media/generate/video`, `/api/media/generate/podcast`, `/api/media/stock/search`, `/api/media/send-to-bolt` | `media_assets` |
| `/admin/voice` | `sections/voice.component.ts` (+ subdir `voice/`) | `AdminStateService` | `/api/voice/test/live-transcript` (SSE) | `voice_calls`, `voice_messages`, `voice_recordings`, `voice_sessions`, `voice_agent_settings`, `voice_numbers` |
| `/admin/mcp` → redirect to `settings/mcp` |  |  |  |  |
| `/admin/github` → redirect to `snapshots` |  |  |  |  |

### 3.3 Top-level (non-admin) authenticated surfaces

| Route | Component | Notes |
|---|---|---|
| `/super-admin` | `pages/super-admin/super-admin.component.ts` | Operator console (cost × markup_factor + wallet drilldown) — gated server-side on `users.is_super_admin=1` |
| `/search` | `pages/search/` | Business search + pre-built site search |
| `/signin` | `pages/signin/` | Magic-link + Google OAuth |
| `/create`, `/details` | `pages/create/`, `pages/details/` | Create-from-search wizard |
| `/waiting` | `pages/waiting/` | Real-time build progress (polls `/api/sites/:id/workflow`) |
| `/editor/:slug` | redirect/iframe to `editor.projectsites.dev` |  |
| `/blog`, `/blog/:slug`, `/changelog`, `/roadmap`, `/press`, `/status`, `/privacy`, `/terms`, `/content`, `/contact`, `/integrations` | individual page components | Marketing/legal surfaces — all Angular, no R2 raw HTML |
| `/checkout` | `pages/checkout/` | Embedded Stripe Checkout iframe host |
| `/error`, `/offline`, `/**` | Error + 404 pages |  |

### 3.4 SSE streaming surfaces (5 confirmed; no client WebSockets)

| Route | Server file | Purpose |
|---|---|---|
| `POST /api/dashboard/chat` | `apps/project-sites/src/routes/dashboard.ts:45` | Widget-emitting LLM chat |
| `GET /api/voice/test/live-transcript` | `apps/project-sites/src/durable_objects/voice_browse_agent.ts:348` | Live voice transcript |
| `GET /api/apps/instances/:id/logs` | `apps/project-sites/src/routes/apps.ts:22` | Container log tail |
| `GET /api/sites/:slug/chat-stream` | (customer-site runtime via `public/app.js`) | Customer-facing AI chat (not admin) |
| `GET /api/editor/llm/stream` | `apps/project-sites/src/durable_objects/voice_browse_agent.ts:438` (heartbeat) + editor LLM streaming | Editor-native chat streaming |

**Client-side WebSocket usage**: `0`. Confirmed via
`grep -rn 'new WebSocket\|WebSocket(' apps/project-sites/frontend/src --include='*.ts'` returned no matches.

**Server-side WebSocket usage**: `1`, `apps/project-sites/src/services/voice_orchestrator.ts:197` (`new WebSocketPair()`)
— used to relay between Twilio media-stream and OpenAI Realtime. Not exposed to admin UI directly.

### 3.5 Cloudflare Workflow + Durable Object surfaces (worker side)

| Workflow / DO binding | Purpose |
|---|---|
| `SITE_WORKFLOW` | Site-generation pipeline (6 steps) |
| `DRIVE_SYNC_WORKFLOW` | Resumable Google Drive ingest |
| `IMAGE_GENERATION_WORKFLOW` | DALL·E → Stability fallback |
| `SNAPSHOT_QUALITY_WORKFLOW` | Screenshot + composition + SEO + a11y matrix |
| `SOCIAL_PUBLISH_WORKFLOW` | Per-account fan-out for `pulse_posts` |
| `SITE_BUILDER` (DO) | Cloudflare Container running Claude Code |
| `APP_RUNTIME` (DO) | Installed-app runtime (auto-restart 3/min, idle-30m hibernation) |

### 3.6 D1 tables (123 total — full sorted set)

```
activity_events           agency_invitations        agent_memories            agent_runs
agents                    ai_blocklist              ai_chat_context_files     ai_context_files
ai_credits_balance        ai_credits_ledger         ai_endpoints              ai_env_vars
ai_env_vars_new           ai_form_logs              ai_site_settings          ai_task_inbox
announcements             anthropic_files           anthropic_memory          api_keys
app_instances             audit_logs                billing_events            broadcasts
build_stream_state        calendar_bookings         calendar_calendars        calendar_events
cf_credentials            chat_canned_responses     chat_contacts             chat_conversations
chat_csat_surveys         chat_inboxes              chat_messages             confidence_attributes
conversions               cost_categories           coupons                   diff_artworks
editor_chat_messages      editor_chats              experience_sessions       experiments
feature_flag_overrides    feature_flags             feedback                  form_api_keys
form_rule_evaluations     form_rules                form_submissions          github_backup_states
github_integrations       google_drive_oauth_states hostnames                 impersonation_sessions
impressions               iteration_snapshots       magic_links               mcp_calls
mcp_connections           mcp_oauth_states          mcp_resource_tokens       mcp_tools
media_assets              memberships               moderation_queue          newsletter_integrations
notifications             oauth_states              org_brand_assets          org_exports
org_security              org_tags                  org_transfers             orgs
phone_otps                prerender_predictions     pulse_posts               rag_chunks
rate_limit_overrides      refunds                   research_data             session_events
sessions                  site_benchmarks           site_cost_daily           site_credit_caps
site_data                 site_snapshots            site_urls                 sites
snapshot_metrics          social_accounts           social_analytics_snapshots social_auto_pilot
social_publishes          spend_alerts              stripe_meter_map          stripe_usage_pushes
subscriptions             super_admin_audit         team_invites              template_installs
template_versions         templates                 terminal_commands         terminal_sessions
trace_events              usage_events              users                     variants
voice_agent_settings      voice_calls               voice_messages            voice_numbers
voice_recordings          voice_sessions            wallet_accounts           wallet_transactions
webhook_events            weekly_digest_sent        workflow_jobs
```

**Orphans flagged**:
- `phone_otps` — phone-OTP feature removed by `b555680` (2026-02-14) but table still exists. Worker CLAUDE.md
  confirms it's orphaned.
- `ai_env_vars_new` — duplicate of `ai_env_vars`, probably a rename-in-flight from migration `0041` / `0045`.
  Confirm no live writes before Phase 8 deletion.

### 3.7 Known dev-server bug surfaced by this audit

`apps/project-sites/scripts/e2e_server.cjs` references `public/index.html` (which no longer exists on disk).
Local `npm run dev` against that script will fall to its catch-all `index.html` fallback and 404. Phase 1 of
the rebuild should either point this at the Angular dist directory or delete the script entirely (the rebuild
will replace it with `nx serve marketing-home`).

---

## 4. Captured Design Tokens

Extracted from `apps/project-sites/frontend/tailwind.config.ts` + `apps/project-sites/frontend/src/styles/_polish.scss`
+ `apps/project-sites/frontend/src/styles/_admin-polish.scss`.

**Important**: the brand tokens `--ps-bg`, `--ps-ink`, `--ps-accent` are used *only as `var(--ps-bg, #060610)` fallback
inlines* — no `:root` block in `_polish.scss` or `_admin-polish.scss` actually declares them. The hex values below
are the de-facto canon, recovered from the fallback chain. Phase 2 design-token extraction MUST materialise them
explicitly in a `:root` (and a light-theme override).

### 4.1 OKLCH-preferred captured-tokens block

Ready to drop into `libs/ui/src/theme/extracted-tokens.ts` as the single source of truth for the Nx UI library.
OKLCH values calculated from the sRGB hex with `d65` whitepoint.

```ts
// libs/ui/src/theme/extracted-tokens.ts (target shape — not yet written)
// Captured from projectsites.dev v1 Angular 21 frontend on 2026-05-26.

export const extractedTokens = {
  color: {
    // Brand — dark-first
    bg:      { hex: '#060610', oklch: 'oklch(0.118 0.018 277)' },
    ink:     { hex: '#f4f4ff', oklch: 'oklch(0.969 0.013 282)' },
    accent:  { hex: '#00E5FF', oklch: 'oklch(0.857 0.140 213)' },
    accentSecondary: { hex: '#7C3AED', oklch: 'oklch(0.516 0.260 287)' },

    // Tailwind-config legacy aliases (still referenced across components — keep until full mig)
    primary:     { hex: '#00E5FF', oklch: 'oklch(0.857 0.140 213)' },
    primaryDim:  { rgba: 'rgba(0, 229, 255, 0.12)' },
    secondary:   { hex: '#50AAE3', oklch: 'oklch(0.690 0.121 240)' },
    darkCard:    { hex: '#0c0c1e', oklch: 'oklch(0.157 0.038 282)' },
    darkSurface: { hex: '#111128', oklch: 'oklch(0.181 0.044 282)' },
    light:       { hex: '#f0f0f8', oklch: 'oklch(0.951 0.011 282)' },
    textSecondary: { hex: '#94a3b8', oklch: 'oklch(0.677 0.036 251)' },

    // Surfaces — dark-first base set (light-theme overrides at the bottom)
    surface1: { rgba: 'rgba(13, 13, 40, 0.85)' },
    surface2: { rgba: 'rgba(10, 10, 30, 0.97)' },
    surface3: { rgba: 'rgba(8, 8, 32, 0.98)' },
    surfaceGlass: { rgba: 'rgba(13, 13, 40, 0.62)' },

    // Derived (in CSS via color-mix(in oklch, ...))
    accentGlow: 'color-mix(in oklch, var(--ps-accent) 35%, transparent)',
    accentSoft: 'color-mix(in oklch, var(--ps-accent) 14%, transparent)',
    accentLine: 'color-mix(in oklch, var(--ps-accent) 28%, transparent)',
    elev1:      'color-mix(in oklch, var(--ps-bg) 92%, var(--ps-ink) 8%)',
    elev2:      'color-mix(in oklch, var(--ps-bg) 85%, var(--ps-ink) 15%)',
    elev3:      'color-mix(in oklch, var(--ps-bg) 78%, var(--ps-ink) 22%)',
    hairline:   'color-mix(in oklch, var(--ps-ink) 8%, transparent)',
    hairlineHi: 'color-mix(in oklch, var(--ps-ink) 14%, transparent)',
  },

  font: {
    sans:    ['Sora', 'system-ui', 'sans-serif'],
    heading: ['Space Grotesk', 'system-ui', 'sans-serif'],
    mono:    ['JetBrains Mono', 'ui-monospace', 'monospace'],
  },

  // Fluid type scale — clamp() expressions, ready for CSS-first config
  fontSize: {
    // No explicit scale in source — recovered from inline component sizing.
    // Phase 2 extraction must validate against actual rendered specimens.
    'xs':   'clamp(0.72rem, 0.7rem + 0.1vw, 0.78rem)',
    'sm':   'clamp(0.82rem, 0.78rem + 0.2vw, 0.9rem)',
    'base': 'clamp(0.95rem, 0.9rem + 0.25vw, 1rem)',
    'lg':   'clamp(1.05rem, 1rem + 0.3vw, 1.15rem)',
    'xl':   'clamp(1.2rem, 1.1rem + 0.5vw, 1.4rem)',
    '2xl':  'clamp(1.5rem, 1.3rem + 1vw, 2rem)',
    '3xl':  'clamp(1.875rem, 1.5rem + 1.875vw, 3rem)',
    '4xl':  'clamp(2.25rem, 1.8rem + 2.25vw, 4rem)',
    '5xl':  'clamp(3rem, 2.4rem + 3vw, 5rem)',
    '6xl':  'clamp(3.75rem, 3rem + 3.75vw, 6rem)',
  },

  // Spacing scale — Tailwind defaults (no override in tailwind.config.ts beyond colors)
  spacing: {
    0: '0',
    1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem',
    5: '1.25rem', 6: '1.5rem', 8: '2rem', 10: '2.5rem',
    12: '3rem', 16: '4rem', 20: '5rem', 24: '6rem',
  },

  radius: {
    xs: '6px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '22px',
  },

  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.18)',
    md: '0 6px 18px -8px rgba(0, 0, 0, 0.42)',
    lg: '0 16px 40px -16px rgba(0, 0, 0, 0.55)',
    xl: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
    card: '0 6px 18px -8px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.04) inset',
    modal: '0 24px 64px rgba(0, 0, 0, 0.55), 0 0 80px rgba(0, 229, 255, 0.04)',
  },

  motion: {
    duration: {
      fast: '140ms',
      base: '220ms',
      slow: '380ms',
    },
    easing: {
      in:          'cubic-bezier(0.4, 0, 1, 1)',
      out:         'cubic-bezier(0, 0, 0.2, 1)',
      emphasized:  'cubic-bezier(0.16, 1, 0.3, 1)',
      spring:      'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
    // Tailwind-config @keyframes captured for parity
    keyframes: {
      fadeInUp: {
        '0%':   { opacity: '0', transform: 'translateY(20px)' },
        '100%': { opacity: '1', transform: 'translateY(0)' },
      },
      glowPulse: {
        '0%, 100%': { boxShadow: '0 0 20px rgba(0,229,255,0.3)' },
        '50%':      { boxShadow: '0 0 40px rgba(0,229,255,0.6)' },
      },
      shimmer: {
        '0%':   { backgroundPosition: '-200% 0' },
        '100%': { backgroundPosition: '200% 0' },
      },
      float: {
        '0%, 100%': { transform: 'translateY(0)' },
        '50%':      { transform: 'translateY(-10px)' },
      },
    },
  },

  zIndex: {
    dropdown:       1000,
    sticky:         1100,
    modalBackdrop:  1900,
    modal:          2000,
    sidePanel:      2050,
    popover:        99950,
    banner:         10000,
    toast:          9999,
    overlayTakeover: 2147483647, // 32-bit max — wins everything
  },

  // Three density modes wired via <html data-density="…">
  density: {
    comfortable: {
      cardPad:   '1.4rem',
      rowPad:    '0.5rem',
      gap:       '0.95rem',
      fontBase:  '0.78rem',
    },
    compact: {
      cardPad:   '0.95rem',
      rowPad:    '0.3rem',
      gap:       '0.55rem',
      fontBase:  '0.72rem',
    },
    spacious: {
      cardPad:   '1.85rem',
      rowPad:    '0.75rem',
      gap:       '1.4rem',
      fontBase:  '0.85rem',
    },
  },

  focus: {
    ring:       '2px solid #00ffc8', // note: brand-divergent — should be --ps-accent
    ringOffset: '2px',
  },

  // Light theme overrides — apply when <html data-theme="light">
  light: {
    surface1: 'rgba(255, 255, 255, 0.92)',
    surface2: 'rgba(250, 250, 252, 0.97)',
    surface3: 'rgba(244, 244, 248, 0.98)',
    surfaceGlass: 'rgba(255, 255, 255, 0.72)',
    // Body bg + ink colors for light theme are NOT explicitly declared
    // in the source. Phase 2 must pick them — recommend ink=#060610 / bg=#f7f7ff.
  },

  // Reduced-motion override — already wired in source
  reducedMotion: {
    durationFast: '1ms',
    durationBase: '1ms',
    durationSlow: '1ms',
  },
};
```

### 4.2 Token gaps to fill in Phase 2

The source repo declared only what the Tailwind config + admin polish layer needed. The rebuild's design system will
need to:

1. **Materialise `--ps-bg`, `--ps-ink`, `--ps-accent`, `--ps-accent-secondary` in an explicit `:root` block.** Today
   they only exist as `var()` fallbacks. Any future stylesheet that reads `var(--ps-bg)` without a fallback gets
   `unset`, which inherits to transparent. Phase 2 must declare them.
2. **Light-theme `--ps-bg` + `--ps-ink` values.** The light-theme surface RGBA values exist, but no body bg/ink pair.
   Recommendation: `--ps-bg: #f7f7fc; --ps-ink: #060610;` (mirrors the dark pair).
3. **Type scale.** No explicit fluid type scale in source. The clamp() expressions above are a Phase 2 *proposal*
   recovered from inline component sizing — validate against rendered specimens.
4. **Spacing scale.** Defaulted to Tailwind base. If Phase 2 wants a custom scale (e.g. 4px grid), declare it now.
5. **Focus-ring color drift.** `--ps-ring-focus` is `#00ffc8` (teal-mint), NOT `--ps-accent` (`#00E5FF`). Probably
   an accidental divergence in a fork — Phase 2 should consolidate to `--ps-accent` unless Brian wants a distinct
   focus hue for WCAG separability.
6. **OKLCH precision.** Values above are 3-decimal approximations. Re-derive in Phase 2 with the official
   `culori` or `@csstools/postcss-oklab-function` round-trip.

---

## 5. Other Findings (not part of the four mandates but adjacent)

### 5.1 Dual `.claude/worktrees/` shadow trees

`find` revealed multiple `apps/project-sites/.claude/worktrees/agent-*/` directories (`agent-ae6961156d4dbf2cb`,
`agent-a9fd9c9ffe7ad02bc`, `agent-a67acc55cd8f75b35`, `agent-abac6b5503118f238`, `agent-a8be473a486730176`,
`agent-a69e11cfb0d495382`, `agent-acc2585c9261bd49d`, `agent-aba5f1cd75bb2c972`) — each a full repo snapshot.

These are Claude `Agent` worktrees per `.claude/settings.json`'s `isolation: worktree` config, auto-cleaned when
the agent exits cleanly. Several stuck around — likely dirty exits. They are **not** resurrection vectors in
practice (none are referenced by deploy scripts), but they DO contain stale copies of `r2-sync/marketing/index.html`,
`public/index.html`, etc. If `find` ever feeds a deletion script without an exclude rule for `.claude/worktrees/`,
those legacy files re-appear in the main tree on the next `git status` flush.

**Phase 8 hardening**: every `scripts/lint-no-legacy-homepage.mjs` check must exclude `.claude/worktrees/` from its
walk, AND a separate `scripts/cleanup-stale-worktrees.mjs` should garbage-collect worktrees older than 7 days.

### 5.2 Two competing tailwind sources of truth

- `apps/project-sites/frontend/tailwind.config.ts` — only color overrides + 4 keyframes
- `apps/project-sites/frontend/src/styles/_polish.scss` — CSS-custom-property-driven cascade-layered design system

Phase 2 should unify under Tailwind v4 CSS-first config (`@theme {}` in `app.css`) and DELETE `tailwind.config.ts`.
Already partially CSS-first via `_polish.scss`; the Tailwind config is now only carrying the color map.

### 5.3 Service-encapsulation gaps surfaced during inventory

- `voice.component.ts` and `seo.component.ts` use ONLY `AdminStateService` — no `ApiService`. Either they truly are
  read-only views over admin state, or they're bypassing the typed `ApiService` and calling `fetch()` directly.
  Phase 5 (typed-API extraction) should grep for raw `fetch(` inside these components.
- `apps.component.ts` and `forms.component.ts` returned no services from the parsing pattern. Re-verify — they
  probably use a non-`inject()`-pattern injection (constructor params with `private`) that the regex missed.
- `dashboard.component.ts` uses `DashboardChatService` and `SlashCommandRegistryService` — both **outside** the
  `services/` directory. They live under `pages/admin/sections/dashboard/`. Phase 4 should consolidate all reusable
  services under `libs/data-access/` to match the Nx convention.

### 5.4 Test infrastructure

- Unit tests: Karma + Jasmine (`ng test`). No Vitest. Phase 7 should switch to Vitest 3 (Nx default) and migrate
  the existing `email.spec.ts` + every other `*.spec.ts` under `src/`.
- E2E: Playwright `@playwright/test ^1.58` at both `apps/project-sites/e2e/` (worker-side, 38+ specs) and
  `apps/project-sites/frontend/e2e/` (Angular). Both configs target `https://projectsites.dev` in `--prod` mode.
- The existing `e2e/__seen-routes__.json` + `e2e/__snapshots__/` machinery from `[[e2e-visual-inspection]]` is
  NOT present in either e2e directory. Phase 7 must wire it up.

### 5.5 Observability surfaces (Sentry / PostHog / GA4 / Workers Tracing)

All four wired in `apps/project-sites/frontend/src/app/app.config.ts` + `index.html`. Sentry source-map upload via
`apps/project-sites/scripts/upload-sentry-sourcemaps.mjs` + `apps/project-sites/frontend/scripts/upload-sourcemaps.mjs`
(two copies — consolidate in Phase 8).

### 5.6 OAuth provisioning scripts

`apps/project-sites/scripts/provision-oauth-apps.mjs` + `apps/project-sites/scripts/provision-secrets.mjs` (per Brian's
secret-auto-provisioning rule). Both are recent (2026-05-25) and stay. The rebuild should call them from the new
Nx workspace's `predeploy` step exactly as the current `apps/project-sites/package.json` does.

---

## 6. Resurrection Vector — Confirmed File Paths Reference Index

For grep-friendly access during Phase 8 implementation:

| Concern | Absolute path |
|---|---|
| **Resurrection script (primary)** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/scripts/upload_to_r2.sh` |
| **Legacy homepage source it uploads** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/r2-sync/marketing/index.html` |
| **Worker that serves whichever blob wins** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/src/index.ts` (lines 450-528) |
| **R2 prefix collision** | `marketing/index.html` (shared by `upload_to_r2.sh` AND `deploy-r2.mjs`) |
| **Correct deploy path (Angular)** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/frontend/scripts/deploy-r2.mjs` |
| **CI invocation of correct path** | `.github/workflows/project-sites.yaml:164,286` + `.github/workflows/container-deploy.yaml:89` |
| **Legacy customer-site runtime (must relocate, NOT delete)** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/public/app.js` |
| **Sample customer site (orphan)** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/samples/demo-site/index.html` |
| **Sample R2 customer site (orphan)** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/r2-sync/sites/bella-cucina/v1/index.html` |
| **Buggy mock dev server (refs missing public/index.html)** | `/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/scripts/e2e_server.cjs` |

---

## 7. Inventory Confidence + What This Audit Did NOT Cover

### Confidence: high
- Homepage variants list (§1) — exhaustive grep across the repo, worktrees excluded
- Resurrection vector (§2) — script + R2 key collision verified by reading both scripts end-to-end
- Admin section route → component → endpoint table (§3.2) — every entry verified against `app.routes.ts` lines 58-302

### Confidence: medium
- D1 table → admin section mapping (§3.2 right column) — inferred from naming convention + migration file context;
  not verified against actual `SELECT` statements in each component. Phase 5 should re-confirm via worker route
  → component grep.
- OKLCH conversions in the token block (§4.1) — calculated via the standard sRGB → linear → CIE Lab → OKLCH
  pipeline at 3-decimal precision. Round-trip via `culori` in Phase 2 to verify.

### Confidence: low / not covered
- **Marketing copy / content correctness** — out of scope (audit is structural, not content)
- **Per-component i18n coverage** — `assets/i18n/{en,es}.json` exists; per-string coverage not verified
- **PWA service worker correctness** — `ngsw-config.json` exists; no functional verification performed
- **Performance budgets per route** — Lighthouse not run as part of this audit
- **Sentry/PostHog event-coverage matrix** — not catalogued (would require parsing `telemetry.service.ts` and
  every `capture()` call)
- **bolt.diy iframe integration security** — `BoltEmbedService` allowlist + postMessage origin checks not audited
- **Container build pipeline (skill 15)** — out of scope; the rebuild's marketing/admin surface doesn't touch it

---

## 8. Phase-8 Deletion Shortlist

Every non-canonical file path that should be removed (or relocated) in cleanup. Grouped by safety class.

### 8.1 Safe deletions (no live consumer, no resurrection risk after step 8.3)

```
apps/project-sites/r2-sync/marketing/index.html
apps/project-sites/r2-sync/sites/bella-cucina/v1/index.html
apps/project-sites/r2-sync/                                  # delete the whole directory
apps/project-sites/samples/demo-site/index.html
apps/project-sites/samples/                                  # if no other samples
apps/project-sites/public/content.html
apps/project-sites/public/privacy.html
apps/project-sites/public/terms.html
apps/project-sites/public/status.html
apps/project-sites/public/forms.js
apps/project-sites/public/widgets.js
```

### 8.2 Relocate (not delete) — must move BEFORE removing the source

```
apps/project-sites/public/app.js
  → apps/project-sites/customer-runtime/app.js
  → R2 prefix:  customer-runtime/app.js   (not marketing/)
  Update the customer-site template to load from the new URL
  Update the worker’s asset-serving fall-through if it currently
  special-cases /app.js on the marketing domain
apps/project-sites/public/{favicon.ico, icon-*.png, logo-*.svg,
                           site.webmanifest, browserconfig.xml,
                           apple-touch-icon.png, walkthrough/*}
  → apps/project-sites/frontend/public/   (consolidate with existing Angular public/)
```

### 8.3 Resurrection-vector kills

```
apps/project-sites/scripts/upload_to_r2.sh           # delete OR add `--allow-legacy` opt-in that refuses by default
apps/project-sites/scripts/e2e_server.cjs            # rewrite to serve from `frontend/dist/...browser` OR delete entirely
apps/project-sites/scripts/upload-to-r2.mjs          # confirm whether still used by container-server.mjs;
                                                     # if not, delete (verified container uses inline upload)
```

### 8.4 Consolidate (two copies of the same artifact)

```
apps/project-sites/scripts/upload-sentry-sourcemaps.mjs
apps/project-sites/frontend/scripts/upload-sourcemaps.mjs
  → KEEP frontend/scripts/upload-sourcemaps.mjs (newer, post-Angular)
  → DELETE apps/project-sites/scripts/upload-sentry-sourcemaps.mjs
```

### 8.5 Worktree garbage (stale agent snapshots, not on `main`)

```
apps/project-sites/.claude/worktrees/agent-ae6961156d4dbf2cb/
apps/project-sites/.claude/worktrees/agent-a9fd9c9ffe7ad02bc/
apps/project-sites/.claude/worktrees/agent-a67acc55cd8f75b35/
apps/project-sites/.claude/worktrees/agent-abac6b5503118f238/
apps/project-sites/.claude/worktrees/agent-a8be473a486730176/
apps/project-sites/.claude/worktrees/agent-a69e11cfb0d495382/
apps/project-sites/.claude/worktrees/agent-acc2585c9261bd49d/
apps/project-sites/.claude/worktrees/agent-aba5f1cd75bb2c972/
  → `git worktree remove --force <path>` each, OR plain `rm -rf` if git no longer tracks them
  → Add  `apps/project-sites/.claude/worktrees/` to `.gitignore` if not already
```

### 8.6 Schema cleanup (D1 — out of homepage scope but trivially safe)

```
phone_otps                  # orphan — phone feature removed 2026-02-14
ai_env_vars_new             # orphan if 0045 migration finalised the rename
  → write migration 0049_drop_orphans.sql
```

### 8.7 v1 classic homepage decision (Brian-call)

The Angular A/B/C `homepage.component.ts` at `/classic` (§1.2). Two options:

1. **Keep** as a kill-switch fallback during the cinematic-v2 rebuild — move to `libs/feature/marketing-home-classic/`
   inside the Nx workspace.
2. **Drop** entirely once the cinematic ships clean — the variant test (`homepage_hero_v2`) is already winding down
   per `AB-TEST.md`.

Default recommendation: **drop**, since the rebuild is a clean break. Brian can flip the call if he wants a hedge.

---

## 9. What a Reviewer Should Take Away

1. **The marketing homepage TODAY is the Angular 21 cinematic landing.** It works, it ships, it's the canonical file.
2. **There is exactly one live resurrection vector**: `scripts/upload_to_r2.sh` blindly uploading a stale
   `r2-sync/marketing/index.html`. Kill the script + delete the source file + add a CI lint, in that order.
3. **The legacy `public/*.html` pages and the sample customer site are dead weight.** Delete them. Move the brand
   assets into `frontend/public/`. Relocate `app.js` to its own runtime folder + R2 prefix so the marketing surface
   stops sharing space with customer-runtime concerns.
4. **The brand tokens need a `:root` block.** They exist only as `var(...)` fallbacks today. Phase 2 must promote
   them. The captured-tokens block in §4.1 is ready to drop into `libs/ui/src/theme/extracted-tokens.ts`.
5. **27 admin sections, 123 D1 tables, 5 SSE streams, 0 client WebSockets.** Plan the Nx lib boundaries around the
   admin sections — most map 1:1 to a `libs/feature/<section>/` library.
6. **bolt.diy stays where it is.** It's iframed via `BoltEmbedService`, deployed separately at
   `editor.projectsites.dev`. Do not touch it during the v2 frontend rebuild.

End of audit.
