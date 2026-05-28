# App Feature Audit — projectsites.dev

> Generated 2026-05-28 by the `app-feature-audit` architect agent.
> Scan baseline: all Angular routes, 45 Hono route files, 193 Worker TS sources,
> 144 E2E spec files, 0516 D1 migrations, and 5 Durable Object classes.

---

## Scan 1 — Routes

### Angular Routes (`frontend/src/app/app.routes.ts`)

| Path | Component | Feature | Auth |
|---|---|---|---|
| `/` | `HomepageComponent` | Marketing | Public |
| `/classic` | → `/` (redirect) | Marketing | Public |
| `/search` | `SearchComponent` | Search | Public |
| `/signin` | `SigninComponent` | Auth | Public |
| `/create` | `CreateComponent` | Site Creation | Public |
| `/waiting` | `WaitingComponent` | Site Creation | Public |
| `/blog` | `BlogListComponent` | Blog | Public |
| `/blog/:slug` | `BlogPostComponent` | Blog | Public |
| `/changelog` | `ChangelogComponent` | Content | Public |
| `/roadmap` | `RoadmapComponent` | Content | Public |
| `/integrations` | `IntegrationsComponent` | Content | Public |
| `/press` | `PressComponent` | Content | Public |
| `/status` | `StatusComponent` | Observability | Public |
| `/checkout` | `CheckoutComponent` | Billing | Public |
| `/privacy` | `LegalComponent` | Legal | Public |
| `/terms` | `LegalComponent` | Legal | Public |
| `/content` | `LegalComponent` | Legal | Public |
| `/contact` | `ContactComponent` | Marketing | Public |
| `/error` | `ServerErrorComponent` | Errors | Public |
| `/offline` | `OfflineComponent` | Errors | Public |
| `/super-admin` | `SuperAdminComponent` | Super-Admin | Auth |
| `/admin` | `AdminComponent` (shell) | Admin | Auth |
| `/admin` (index) | `AdminDashboardComponent` | Dashboard | Auth |
| `/admin/welcome` | `AdminEditorComponent` | Editor | Auth |
| `/admin/editor` | `AdminEditorComponent` | Editor | Auth |
| `/admin/editor-native` | `EditorNativePageComponent` | Editor | Auth (flag) |
| `/admin/accept-invite` | `AdminAcceptInviteComponent` | Team | Auth |
| `/admin/snapshots` | `AdminSnapshotsComponent` | Snapshots | Auth |
| `/admin/snapshots/diff` | `AdminSnapshotsDiffComponent` | Snapshots | Auth |
| `/admin/sites` | `AdminSitesComponent` | Sites | Auth |
| `/admin/sites/:id` | `AdminSiteDetailComponent` | Sites | Auth |
| `/admin/sites/:id/branches` | `SiteBranchesComponent` | Branches | Auth |
| `/admin/sites/:id/mcp-server` | `SiteMcpServerComponent` | MCP | Auth |
| `/admin/sites/:id/copilot` | `AdminSiteCopilotComponent` | Copilot (flagged) | Auth |
| `/admin/swarm/:siteId` | `AdminSwarmComponent` | Swarm Editor | Auth |
| `/admin/marketplace` | `AdminMarketplaceComponent` | Section Marketplace | Auth |
| `/admin/analytics` | `AdminAnalyticsComponent` | Analytics | Auth |
| `/admin/billing` | `AdminBillingComponent` | Billing | Auth |
| `/admin/audit` | `AdminAuditComponent` | Audit | Auth |
| `/admin/api-tokens` | `AdminApiTokensComponent` | Public API v1 | Auth |
| `/admin/feature-flags` | `AdminFeatureFlagsComponent` | Feature Flags | Auth |
| `/admin/content-freshness` | `AdminContentFreshnessComponent` | Content Freshness | Auth |
| `/admin/pseo` | `AdminPseoComponent` | pSEO | Auth |
| `/admin/features` | `AdminFeaturesHubComponent` | Features Hub | Auth |
| `/admin/forms` | `AdminFormsComponent` | Forms | Auth |
| `/admin/import` | `ImportFromUrlComponent` | Site Import | Auth |
| `/admin/docs` | `AdminDocsComponent` | API Docs | Auth |
| `/admin/docs/:endpointId` | `DocsEndpointComponent` | API Docs | Auth |
| `/admin/traces` | `AdminAiLogsComponent` | AI Traces | Auth |
| `/admin/ai-endpoints` | `AdminAiEndpointsComponent` | AI Endpoints | Auth |
| `/admin/voice` | `VoiceComponent` | Voice | Auth |
| `/admin/media` | `AdminMediaComponent` | Media | Auth |
| `/admin/settings` | `AdminSettingsComponent` | Settings | Auth |
| `/admin/user` | `AdminUserSettingsComponent` | User Prefs | Auth |
| `/admin/domains` | `AdminDomainsComponent` | Domains | Auth |
| `/admin/domains/:id/stack` | `AdminDomainStackComponent` | Domain Stack (flagged) | Auth |
| `/admin/logs` | `AdminLogsExplorerComponent` | Logs Explorer (flagged) | Auth |
| `/admin/apps` | `AppsComponent` | Apps Store | Auth |
| `/admin/apps/instances` | `AppInstancesComponent` | Apps Store | Auth |
| `/admin/apps/instances/:id` | `AppInstanceDetailComponent` | Apps Store | Auth |
| `/admin/apps/:id` | `AppDetailComponent` | Apps Store | Auth |
| `/admin/social` | `AdminSocialComponent` | Social (Pulse) | Auth |
| `/admin/social/analytics` | `AdminSocialAnalyticsComponent` | Social Analytics | Auth |
| `/admin/inbox` | `AdminInboxComponent` | Inbox (flagged) | Auth |

**Total Angular routes:** 62 (including redirects)

---

### Hono Routes (`src/routes/*.ts` + `src/index.ts`)

| Route Module | Key Paths | Feature | Flag |
|---|---|---|---|
| `health.ts` | `GET /health`, `/health/deep` | Observability | — |
| `search.ts` | `GET /api/search/businesses`, `/api/sites/lookup`, `/api/sites/search` | Search | — |
| `api.ts` | `GET|POST|DELETE /api/sites`, `/api/auth/*`, `/api/billing/*`, `/api/sites/:id/hostnames/*` | Core CRUD / Auth / Billing | — |
| `webhooks.ts` | `POST /webhooks/stripe`, `/webhooks/resend` | Billing | — |
| `bolt_admin.ts` | `/api/bolt/*`, `/admin-api/*` (vision-ocr, transcribe, chat, suggest-prompts, chat-state) | Editor | — |
| `editor_chats.ts` | `/api/editor-chats/*` | Editor (native) | — |
| `assets.ts` | `/api/sites/:siteId/assets/*` | Media | — |
| `forms.ts` | `POST /api/v1/forms/submit`, `/api/forms/*` | Forms | — |
| `ai_admin.ts` | `/api/ai/*`, `/api/alerts/*`, `/api/team/*`, `/api/credits/*` | AI Admin | — |
| `ai_endpoints_public.ts` | `POST /api/ai/:slug/:endpoint` | AI Endpoints | — |
| `mcp_oauth.ts` | `/api/mcp/:provider/connect`, `/callback`, `/paste` | MCP OAuth | — |
| `env_vars.ts` | `/api/env-vars` (CRUD) | Env Vars | — |
| `docs.ts` | `/api/docs/*`, `/api/openapi.json` | API Docs | — |
| `autofill.ts` | `POST /api/sites/autofill` | Site Creation | — |
| `apps.ts` | `/api/apps/*`, `/api/app-instances/*` | Apps Store | — |
| `snapshot_quality.ts` | `/api/sites/:siteId/snapshots/:id/(capture|metrics|screenshot.png)` | Snapshots | — |
| `site_detail_tabs.ts` | `/api/sites/:siteId/(logs/tail|snapshots/:id/rollback|sql/exec|integrations)` | Site Detail | — |
| `swarm.ts` | `/api/swarm/:siteId/(start|stream|runs|run/:runId)` | Swarm Editor | `multi_agent_swarm` |
| `site_dna.ts` | `/api/site-dna/:siteId/(feedback|preferences|history)` | Site DNA | `site_dna` |
| `section_marketplace.ts` | `/api/section-marketplace/*`, `/sections` | Section Marketplace | `section_marketplace` |
| `dashboard.ts` | `/api/dashboard/chat` (SSE), `/api/calendar/*` | Dashboard | — |
| `pulse_analytics.ts` | `/api/social/analytics/aggregate` | Social Analytics | — |
| `social_oauth.ts` | `/api/social/:platform/(connect|callback|paste)` | Social OAuth | — |
| `social.ts` | `/api/social/(accounts|posts)/*` | Social (Pulse) | — |
| `voice.ts` | `/api/voice/*` | Voice | — |
| `voice_webhooks.ts` | `/webhooks/voice/*`, `/webhooks/sms/*`, `/internal/voice/*` | Voice | — |
| `domain_purchase.ts` | `/api/domains/purchase`, `/api/billing/checkout/*`, `/api/billing/wallet` | Domains / Billing | — |
| `domain_stack.ts` | `POST /api/domains/:hostname/stack`, `GET /api/domains/:hostname/stack-status` | Domain Stack | `domain_stack_wizard` |
| `logs.ts` | `POST /api/logs/search`, `GET /api/logs/cost-by-route` | Logs Explorer | `log_explorer` |
| `super_admin.ts` | `/api/super-admin/*` | Super-Admin | `is_super_admin=1` |
| `wallet.ts` | `/api/wallet/*` | Billing (wallet) | — |
| `agency.ts` | `/api/agency/*` | Agency / White-label | Pro plan |
| `billing_addons.ts` | `/api/billing/addons/*`, `/api/billing/invoices/*`, `/api/affiliates/*` | Billing | — |
| `agents.ts` | `/api/sites/:siteId/agents/*`, `/api/agents/:id/*` | AI Agents | Pro plan |
| `templates.ts` | `/api/templates`, `/api/sites/:siteId/install-template` | Templates | — |
| `inbox.ts` | `/api/inbox/*` | Inbox | `unified_inbox` |
| `copilot.ts` | `/api/sites/:slug/copilot/*`, `/sites/:slug/copilot.js` | Copilot | `multimodal_copilot` |
| `features.ts` | `/api/*` flag-gated paths, `/llms.txt`, `/accessibility`, `/.well-known/mcp`, `/api/openapi.json` | Feature Flags | — |
| `mcp_site.ts` | `/{slug}/.well-known/*`, `/{slug}/mcp`, `/api/sites/:siteId/mcp/*` | MCP per-site | — |
| `site_branches.ts` | `/api/sites/:siteId/branches` | Branches | — |
| `experiments.ts` | `/_ps/(i|c|e|predict)`, `/api/sites/:siteId/experiments` | A/B Experiments | — |
| `media.ts` | `/api/media/*` | Media | — |
| `public.ts` | `/changelog.json`, `/feed.xml`, `/api/public/(roadmap|integrations)` | Public Content | — |
| `public_api.ts` | `/v1/*`, `/api/v1-tokens` | Public REST API v1 | `public_api_v1` |
| `content.ts` (at `/api/content`) | Content Freshness CRUD | Content Freshness | `content_freshness` |
| `pseo.ts` (at `/api/pseo`) | pSEO Matrix Generator | pSEO | `pseo_matrix` |

**Total Hono route modules:** 45; **Total route files scanned:** 45

---

## Scan 2 — UI Components (Admin Sections)

| Component File | Feature | Section |
|---|---|---|
| `admin.component.ts` | Admin Shell | Shell |
| `admin-state.service.ts` | Admin Shell | Shell |
| `dashboard.component.ts` | Dashboard (AI Perplexity) | Dashboard |
| `editor.component.ts` | Editor (bolt.diy embed) | Editor |
| `sites.component.ts` | Sites List + CWV heatmap | Sites |
| `site-detail.component.ts` | Site Detail (4 tabs) | Sites |
| `site-branches.component.ts` | Branch Previews | Sites |
| `site-mcp-server.component.ts` | Per-site MCP | MCP |
| `snapshots.component.ts` | Snapshot Gallery | Snapshots |
| `snapshots-diff.component.ts` | Snapshot Diff | Snapshots |
| `analytics.component.ts` | Analytics | Analytics |
| `social.component.ts` | Pulse Social Composer | Social |
| `social-analytics.component.ts` | Pulse Analytics | Social |
| `billing.component.ts` | Billing | Billing |
| `audit.component.ts` | Audit Log | Audit |
| `api-tokens.component.ts` | API Tokens | Public API |
| `feature-flags.component.ts` | Feature Flags | Feature Flags |
| `content-freshness.component.ts` | Content Freshness | AI Features |
| `pseo.component.ts` | pSEO Builder | AI Features |
| `features-hub.component.ts` | Features Hub | Features |
| `forms.component.ts` | Forms / Submissions | Forms |
| `docs.component.ts` + `docs/*.ts` | API Explorer | Docs |
| `ai-logs.component.ts` | AI Traces | Observability |
| `ai-endpoints.component.ts` | AI Endpoints | AI Features |
| `ai-chat-extras.component.ts` | AI Chat Extras | AI Features |
| `voice.component.ts` | Voice / SMS Agent | Voice |
| `media.component.ts` | Media Library + Studios | Media |
| `settings.component.ts` | Settings (tabs: MCP, AI chat) | Settings |
| `user-settings.component.ts` | User Preferences | Settings |
| `domains.component.ts` | Domain Management | Domains |
| `domain-stack.component.ts` | Domain Stack Wizard | Domains |
| `logs-explorer.component.ts` | Logs Explorer | Observability |
| `apps.component.ts` | Apps Store Catalog | Apps |
| `apps-instances.component.ts` | App Instances | Apps |
| `apps-detail.component.ts` | App Detail | Apps |
| `inbox.component.ts` | Unified Inbox | Inbox |
| `site-copilot.component.ts` | Multimodal Copilot | Copilot |
| `swarm.component.ts` | Swarm Editor | Swarm |
| `marketplace.component.ts` | Section Marketplace | Marketplace |
| `seo.component.ts` | SEO Dashboard | SEO |
| `progressive-preview.component.ts` | Progressive Preview | Sites |

**Total admin section components scanned:** 41

**Customer-facing pages:** `homepage`, `create`, `search`, `signin`, `waiting`, `blog`, `changelog`, `roadmap`, `integrations`, `press`, `status`, `checkout`, `legal`, `contact`, `error/\*`

---

## Scan 3 — API Routes + Data Stores

| Feature | Route Module(s) | D1 Tables | KV Keys | R2 Paths | Workflows | DOs |
|---|---|---|---|---|---|---|
| Auth | `api.ts` | `sessions`, `magic_links`, `oauth_states`, `users`, `orgs`, `memberships` | `session:{token}` | — | — | — |
| Sites CRUD | `api.ts`, `search.ts`, `autofill.ts` | `sites`, `hostnames`, `research_data`, `confidence_attributes` | `host:{hostname}` (60s) | `sites/{slug}/{version}/*` | `SiteGenerationWorkflow` | — |
| Billing | `api.ts`, `domain_purchase.ts`, `billing_addons.ts`, `wallet.ts` | `subscriptions`, `webhook_events`, `audit_logs` | — | — | — | — |
| Snapshots | `snapshot_quality.ts`, `site_detail_tabs.ts` | `snapshots` (0501) | — | `sites/{slug}/snapshots/*` | `SnapshotQualityWorkflow` | `TraceHub` |
| Editor (bolt) | `bolt_admin.ts`, `editor_chats.ts` | `sites` (chat_state), `editor_chats` (0504) | `rl:vision`, `rl:transcribe` | — | — | — |
| Media | `media.ts`, `assets.ts` | `media_assets` (0501) | — | `media/{orgId}/*` | `ImageGenerationWorkflow` | — |
| AI Endpoints | `ai_admin.ts`, `ai_endpoints_public.ts` | `ai_endpoints` (0501) | `rl:ai` | — | — | — |
| AI Traces | `ai_admin.ts` | `ai_log_entries` (0501) | — | — | — | `TraceHub` |
| Social (Pulse) | `social.ts`, `social_oauth.ts`, `pulse_analytics.ts` | `social_accounts`, `pulse_posts`, `pulse_analytics` (0046) | — | — | `SocialPublishWorkflow` | — |
| Voice | `voice.ts`, `voice_webhooks.ts` | `voice_numbers`, `voice_calls`, `voice_conversations` (0501) | — | — | — | `VoiceBrowseAgent` |
| MCP OAuth | `mcp_oauth.ts` | `mcp_oauth_states`, `mcp_connections` | — | — | — | — |
| MCP per-site | `mcp_site.ts` | `site_mcp_tokens` (0514) | — | — | — | — |
| Domains | `domain_purchase.ts`, `domain_stack.ts` | `hostnames`, `domain_purchases`, `tenant_infra` (0500) | — | — | — | — |
| Forms | `forms.ts` | `form_definitions`, `form_submissions` (0501) | `rl:forms` | — | — | — |
| Env Vars | `env_vars.ts` | `ai_env_vars` (0045) | — | — | — | — |
| Feature Flags | `features.ts` | `flag_overrides` (0500) | `ff:*` (Flagship KV) | — | — | — |
| Apps Store | `apps.ts` | `app_catalog`, `app_instances` (0501) | — | — | — | `AppRuntimeContainer` |
| Swarm Editor | `swarm.ts` | `swarm_runs`, `swarm_agents` (0505) | — | — | — | `TraceHub` |
| Site DNA | `site_dna.ts` | `site_dna_preferences` (0505) | — | — | — | — |
| Section Marketplace | `section_marketplace.ts` | `section_marketplace` (0506) | — | — | — | — |
| Logs Explorer | `logs.ts` | `worker_logs` (0508) | — | — | — | — |
| Content Freshness | `content.ts` | `content_freshness_drafts` (0509) | — | — | `ContentFreshnessWorkflow` | — |
| pSEO | `pseo.ts` | `pseo_jobs`, `pseo_pages` (0510) | — | `sites/{slug}/pseo/*` | `PseoGenerationWorkflow` | — |
| Inbox | `inbox.ts` | `conversations`, `messages`, `conversation_sla` (0511) | — | — | — | — |
| Copilot | `copilot.ts` | `site_copilot_sessions` (0512) | — | `sites/{slug}/copilot.js` | — | — |
| Branches | `site_branches.ts` | `site_branches` (0513) | — | `sites/{slug}/branches/*` | — | — |
| Public API v1 | `public_api.ts` | `api_tokens` (0515) | — | — | — | — |
| Super-Admin | `super_admin.ts` | `users` (`is_super_admin`) | — | — | — | — |
| Experiments | `experiments.ts` | `experiments`, `experiment_variants`, `experiment_events` (0503) | — | — | — | — |
| Templates | `templates.ts` | `template_sections` (implied) | — | `templates/*` | — | — |
| A/B (Thompson) | `experiments.ts` | `experiments` | `_ps:*` | — | — | — |
| Google Drive Sync | — | — | — | — | `DriveSyncWorkflow` | — |
| Audit | `ai_admin.ts` | `audit_logs` | — | — | — | `ActivityHub` |
| Agency | `agency.ts` | `agency_orgs`, `agency_brands` (0503) | — | — | — | — |
| Search | `search.ts` | — (Google Places proxy) | `rl:search` | — | — | — |
| Health | `health.ts` | — | probe (read) | probe (head) | — | — |
| Webhooks | `webhooks.ts` | `webhook_events` | — | — | — | — |

---

## Scan 4 — E2E Test Coverage

| Directory / Spec | Feature | Status |
|---|---|---|
| `e2e/_fortress/auth/` | Auth (magic-link + Google OAuth) | GREEN (2 specs) |
| `e2e/_fortress/billing/` | Billing subscribe/cancel | GREEN (2 specs) |
| `e2e/_fortress/site-create/` | Site creation flow | GREEN (2 specs) |
| `e2e/_fortress/admin-detail/` | Admin site detail tabs | GREEN (2 specs) |
| `e2e/_fortress/feature-flags/` | Feature flags | GREEN (2 specs) |
| `e2e/_fortress/domain-stack/` | Domain Stack wizard | GREEN (2 specs) |
| `e2e/_fortress/logs-explorer/` | Logs Explorer | GREEN (2 specs) |
| `e2e/_fortress/swarm-editor/` | Swarm Editor | GREEN (2 specs) |
| `e2e/_fortress/marketplace/` | Section Marketplace | PARTIAL (1 of 2) |
| `e2e/_fortress/public-api/` | Public API v1 | GREEN (2 specs) |
| `e2e/_fortress/inbox/` | Unified Inbox | GREEN (2 specs) |
| `e2e/_fortress/swarm-editor/` | Multimodal Copilot | MISSING |
| `e2e/admin/*` | All admin sections (shell, analytics, billing, editor, feature-flags, mcp, seo, settings, snapshots, social, voice, features-hub, ai-chat-extras, apps, email) | GREEN (15 specs) |
| `e2e/allstar/` | CWV, GEO, a11y, competitive, platform, monetization, observability, media, editor | GREEN (10 specs) |
| `e2e/voice/`, `e2e/voice.spec.ts` | Voice + SMS | GREEN |
| `e2e/social/social-flows.spec.ts` | Pulse Social | GREEN |
| `e2e/swarm/swarm.spec.ts` | Swarm Editor | GREEN |
| `e2e/site-dna/site-dna.spec.ts` | Site DNA | GREEN |
| `e2e/site-mcp/site-mcp.spec.ts` | MCP per-site | GREEN |
| `e2e/media-library.spec.ts` etc. | Media Library, Stock, Studios | **TDD-RED** (14 specs unimplemented) |
| `e2e/env-vars-manager.spec.ts` etc. | Env Vars + MCP scope | **TDD-RED** (9 specs) |
| `e2e/task-tray.spec.ts` | Task Tray (Inbox) | **TDD-RED** + seed blocker |
| `e2e/streaming-markdown-render.spec.ts` | Chat Streaming | **TDD-RED** (7 specs) |
| `e2e/ai-workflow.spec.ts` | AI site generation | GREEN |
| `e2e/smoke-prod.spec.ts` | Production smoke | GREEN |
| `e2e/public/` | Marketing pages + discovery | GREEN |
| Other legacy specs (40+) | Various flows | GREEN |

**Total spec files:** 144  
**TDD-RED (spec written, impl pending):** ~30 specs across media, env-vars, task-tray, chat-streaming  
**Missing (no spec at all):** Multimodal Copilot fortress pair, marketplace adversarial

---

## Scan 5 — Observability Coverage

| Feature | Sentry (Worker/Toucan) | Sentry (@sentry/angular) | PostHog (server) | PostHog (client) | Workers Tracing |
|---|---|---|---|---|---|
| Auth | `addBreadcrumb` per magic-link + OAuth step | — | `capture("auth_*")` | — | `[observability] enabled=true` |
| Site Creation | `addBreadcrumb` at workflow steps | — | `capture("site_created")` | — | yes |
| Billing | `captureException` on Stripe error | — | `capture("billing_*")` | — | yes |
| Editor (bolt) | rate-limit misses captured | error-handler + `SentryService` | — | PostHog autocapture | yes |
| AI Endpoints | `captureException` on LLM error | — | `captureLLMCall($ai_*)` | — | yes |
| Voice | `captureException` on Twilio error | — | — | — | yes |
| Social | — | — | `capture("social_published")` | — | yes |
| Media | — | — | — | — | yes |
| Swarm | — | — | `capture("swarm_started")` | — | yes |
| Admin Shell | — | `GlobalErrorHandler` → Sentry | — | PostHog autocapture + `capture_pageview` | yes |
| Snapshots | `addBreadcrumb` at capture | — | — | — | yes |
| Domains | `captureException` on CF API error | — | — | — | yes |
| **Gaps** | Copilot, Inbox, pSEO, Content Freshness, Site DNA, Branches have no explicit Sentry breadcrumbs | Copilot/Inbox/Branches components lack `SentryService.addBreadcrumb` calls | pSEO/Content Freshness lack PostHog server events | Site Branches / Copilot lack PostHog client events | — |

**Global hooks wired:** `app.use('*', sentryBreadcrumb)` on every request in `index.ts`. All uncaught errors → `errorHandler` → `captureException` via Toucan. Angular `ErrorHandler` → `SentryService` per `error-handler.service.ts`.

**AI Gateway:** bound as `env.AI` — Workers AI calls route through it; OpenAI/Anthropic calls route through `gateway.ai.cloudflare.com` when `AI_GATEWAY_ENABLED=true`.

---

## Scan 6 — Dead Code + Flag Drift

### Removed in commit `910a89d`
- `phone_otps` D1 table — orphaned, column `users.phone` always NULL. Route: none. Safe to prune table after next migration.
- `ConversationHub` Durable Object — exported as a 410-stub to preserve CF migration history; real logic gone. Do not reference.
- Twilio SMS OTP handlers — all removed. No test coverage needed.

### Flag-Without-Implementation Candidates
| Flag Key | Used In Route | Angular UI | Status |
|---|---|---|---|
| `domain_stack_wizard` | `domain_stack.ts` | `domain-stack.component.ts` | Implemented |
| `log_explorer` | `logs.ts` | `logs-explorer.component.ts` | Implemented |
| `unified_inbox` | `inbox.ts` | `inbox.component.ts` | Implemented |
| `multimodal_copilot` | `copilot.ts` | `site-copilot.component.ts` | Implemented but **no E2E fortress spec** |
| `multi_agent_swarm` | `swarm.ts` | `swarm.component.ts` | Implemented |
| `site_dna` | `site_dna.ts` | — (no admin route yet) | **API without UI route** |
| `section_marketplace` | `section_marketplace.ts` | `marketplace.component.ts` | Implemented; adversarial spec pending |
| `content_freshness` | `content.ts` | `content-freshness.component.ts` | Implemented |
| `pseo_matrix` | `pseo.ts` | `pseo.component.ts` | Implemented |
| `public_api_v1` | `public_api.ts` | `api-tokens.component.ts` | Implemented |

### Implementation-Without-Flag Candidates
- `native_editor`: `editor-native` route is gated only by `localStorage['editor.native']`, not a server-side `isFlagOn` check. Risk: cannot killswitch remotely.
- `a/b experiments` (`experiments.ts`): Thompson-sampling endpoints live at `/_ps/*` with no `isFlagOn` guard — always-on.

---

## Risk Register

| Risk | Severity | Feature | Notes |
|---|---|---|---|
| `site_dna` API has no Angular admin route | Medium | Site DNA | `/api/site-dna/:siteId/*` is wired but no `/admin/sites/:id/dna` route. Users cannot access DNA preferences from the UI. |
| `native_editor` not server-flag-gated | Medium | Editor | Remote killswitch impossible; must redeploy to disable. |
| `ConversationHub` DO exported but 410-stub | Low | Inbox | CF will create stale DO class if any old code holds a reference; clean up after 30 days stable. |
| Media specs TDD-RED (14 specs) | High | Media | 14 spec files written but no implementation coverage confirmed against prod. |
| Task Tray seed endpoint missing | Medium | Inbox | `e2e/task-tray.spec.ts` mocks the GET — not true E2E. |
| `@axe-core/playwright` not in package.json | Medium | A11y | All axe assertions commented out across every spec. |
| Marketplace adversarial spec missing | Low | Marketplace | Phase-1 fortress incomplete; fork-of-fork race unverified. |
| Multimodal Copilot fortress specs absent | Medium | Copilot | Only feature in fortress matrix with 0 specs. |
| `phone_otps` table still in D1 | Low | Auth | Orphaned table; wastes space; prune via migration. |

---

## Recommended Migration Order (lowest risk first)

1. **Prune dead code** — migration to drop `phone_otps`; remove `ConversationHub` export after 30-day stability window.
2. **Fix `native_editor` flag** — wrap `editor-native` route behind `isFlagOn(env, 'native_editor', user, anonId)` in `api.ts` or `features.ts`.
3. **Add `site_dna` admin route** — wire `/admin/sites/:id/dna` → new `SiteDnaComponent` consuming the existing API.
4. **Add `@axe-core/playwright`** — uncomment axe assertions across all 144 specs; zero new code needed.
5. **Task Tray seed endpoint** — `POST /api/internal/inbox/seed` guarded by `TEST_SECRET` header → true E2E for `task-tray.spec.ts`.
6. **Media spec GREEN pass** — implement media stub APIs or seed fixtures; flip 14 TDD-RED specs to GREEN.
7. **Copilot fortress pair** — write `_fortress/multimodal-copilot/{happy-path,adversarial}.spec.ts`.
8. **Marketplace adversarial** — finish `_fortress/marketplace/adversarial.spec.ts`.
9. **Observability gaps** — add `addBreadcrumb` + PostHog events in Copilot, Inbox, pSEO, Content Freshness, Branches route handlers.
