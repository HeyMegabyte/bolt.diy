# Project Sites — Ideas & Roadmap Catalog

Consolidated from 11 scratch files (2026-06-08). Each idea: title · value · rough effort.
Drop anything already shipped. See FEATURE_CATALOG.md for module statuses.

---

## Feature ideas

### AI product (Tier S — transformational, ≥30h each)

- **AI voice receptionist** — provisioned at publish; answers calls, routes to site owner · $1k+ MRR unlock · L
- **Post-publish autonomous growth agent** — monitors traffic+rankings, queues content updates, re-publishes · competes with agencies · L
- **Native booking engine** — first-class calendar/availability with AI scheduling suggestions · eliminates 3rd-party dep · L
- **AI-native GEO layer** — structures site content for AI search (Perplexity/ChatGPT citations) · next-gen SEO moat · L
- **Live operational data baked into pages** — menu prices, hours, inventory pulled at render, not hardcoded · freshness diff · L
- **Visitor-facing AI concierge** — injected widget powered by site's own content; actual tool calls not a chatbot placeholder · highest engagement feature · L
- **Embedded visitor analytics beacon** — privacy-first, no cookie banner needed, real-time dashboard in /admin · replaces GA · L
- **Edge per-visitor personalization** — geo+device+referrer signals, no PII, hero/CTA swap at edge · 20–40% CVR lift · L
- **Visual canvas editing** — WYSIWYG drag-drop over live site; no-token site editing · biggest UX unlock · L
- **AI multilingual locale mirrors** — at publish, auto-generates `/{locale}/*` routes from ACS demographics · i18n parity · L

### AI product (Tier A — strong value, ≥20h each)

- **LLM eval + regression harness** — structured evals per prompt template; prevents silent regressions · quality gate · M
- **Real-time content guardrails** — flags hallucinations/outdated facts pre-publish · trust/accuracy · M
- **Unified payments rail** — Square (in-person) + Stripe (SaaS) behind a single abstraction · reduces churn · L
- **URL-to-site cloning** — crawl competitor URL, generate rival site in 60s · top acquisition hook · L
- **AI Code Components** — AI generates custom React components injected into generated sites · extensibility · L
- **Real-time multi-user collab editing** — CRDT-based concurrent editing of site content · team plans unlock · L
- **Computer-use QA agent** — browses published site, flags broken links/contrast/layout regressions · continuous QA · L
- **Hyper-local SEO autopilot** — auto-generates neighborhood landing pages from Google Places data · local SEO moat · L
- **Missed-call → content loop** — Twilio missed-call triggers AI FAQ content addition to site · "phone SEO" novelty · M
- **AI trust content from real third-party data** — pulls G2/Yelp/Trustpilot citations automatically · authority signal · M

### AI product (Tier B — solid, 10–20h each)

- **Veo 3.1 hero reel** — 7×8s clips assembled into 60s narrative; auto-deployed to site hero · cinematic diff · L
- **A/B testing engine** — CF Worker traffic splits + PostHog for winner detection · conversion science · M
- **Per-tenant knowledge agent** — ingests site content+FAQ; answers owner's internal questions · support deflection · M
- **Auto GBP+directory submission** — submits to Google Business Profile + top 20 directories at publish · local SEO · M
- **NL site-editing agent** — "make the hero darker" chat → patches + redeploys in 30s · zero-code editing · L
- **Figma-to-site import** — Figma file → generated site matching design tokens · designer onboarding · L
- **AI pricing optimizer** — suggests pricing page copy changes based on competitor + conversion data · revenue · M
- **Native email service** — branded Resend-backed campaigns from /admin without external tool · retention · M
- **Generative design system** — per-site color/type/spacing system generated from brand kit · consistency · L
- **Continuous a11y remediation** — axe scans published site nightly, auto-PRs fixes · compliance safety net · M

### Platform modules (from FEATURE_CATALOG.md — unshipped, Brian-prioritized first)

- **#4 review_approval_links** — multi-step email review flow; extends approval_workflow+review_tokens · client workflow · M (IN PROGRESS)
- **#8 team_seats_rbac** — seat caps + role matrix; extends existing infra · team plan unlock · M (IN PROGRESS)
- **#10 outbound_webhooks** — Svix-powered event delivery; self-healing retry + HMAC signing · integrations · M (IN PROGRESS)
- **#11 automation_builder** — visual trigger→action builder; Inngest-backed · no-code workflows · L (IN PROGRESS)
- **#12 email_deliverability_wizard** — DKIM/SPF/DMARC setup wizard; SMTP persistence · trust signal · M (IN PROGRESS)
- **#17 bulk_site_ops** — bulk publish/unpublish/clone/delete across portfolio · agency efficiency · M (IN PROGRESS)
- **Authorized capstone: Workflow dispatcher** — orchestrates Cloudflare Workflows for multi-site generation; requires #8 seat caps first · platform scalability · L
- **aeo_autopilot** — Answer Engine Optimization; structures FAQ/HowTo JSON-LD per page from AI · GEO moat · M
- **self_healing_site** — monitors 404s/broken images, auto-patches + redeploys · reliability · M
- **uptime_status_page** — public status.{slug} with incident history · trust/transparency · S
- **brand_kit_manager** — logo/color/font vault; source of truth for generation · consistency · S
- **onboarding_checklist** — step-by-step post-signup checklist with completion tracking · activation · S
- **product_tour** — in-app guided tour via Shepherd/Driver.js · onboarding · S
- **customer_activity_log** — per-org action stream with actor+resource+timestamp · compliance · S
- **content_calendar** — editorial calendar; extends content_freshness · publishing rhythm · M
- **spend_budget_caps** — per-org AI token + generation budget with alerts · cost control · S
- **consent_compliance** — GDPR/CCPA cookie banner generator + data-deletion API · legal safety · M
- **dashboard_copilot** — agentic AI assistant in /admin with read-only tools + HITL · power-user UX · L
- **sla_incident_credits** — automated uptime SLA credits via billing API · enterprise trust · M
- **creator_payouts** — Stripe Connect Express for agency/freelancer payout splits · marketplace model · L
- **staging_slots** — per-site draft/staging slot before publish · client approval workflow · M
- **scheduled_publish** — datetime-local publish queue with worker cron · content workflow · S
- **competitor_beat_report** — weekly email showing how site compares on Lighthouse+SEO vs 3 rivals · retention · M
- **campaign_links_qr** — UTM builder + QR code generator with scan analytics · marketing · S
- **nps_feedback_loop** — in-app NPS survey + PostHog cohort analysis · product intelligence · S

### Client-site-level modules (injected into generated sites)

- **announcement_bar** — dismissible top bar for promos/alerts · conversion · S
- **lead_capture_popups** — exit-intent + scroll-triggered lead forms · top-of-funnel · S
- **social_proof_notifications** — "Jane in Denver just booked" toast · FOMO/CVR · S
- **urgency_timers** — countdown to offer expiry · conversion · S
- **coupon_engine** — promo code generation + redemption tracking · e-commerce · M
- **gift_cards** — Square gift card issuance + balance tracking · retail · M
- **abandoned_cart_recovery** — email sequence for incomplete checkouts (Ship-first) · revenue recovery · M
- **multi_currency_geo_pricing** — price display by visitor geo; Stripe multi-currency backend · international · M
- **tax_vat_calc** — TaxJar/Avalara integration at checkout · compliance · M
- **digital_downloads** — R2-backed file delivery with purchase gate · e-commerce · S
- **event_ticketing** — Square Tickets + QR check-in · events vertical · M
- **store_locator** — MapLibre multi-location map + directions · multi-location SMBs · S
- **online_ordering** — Square Orders API + kitchen display webhook · restaurant vertical · L
- **job_board** — employer post + applicant apply flow · staffing vertical · M
- **testimonial_collection** — post-purchase review request email + display widget · social proof · S
- **help_center** — AI-powered FAQ search over site content · support deflection · M
- **site_search** — Cloudflare Workers AI semantic search over site content · UX · S
- **heatmaps_replay** — PostHog session replay + heatmap embedded in /admin · optimization · M
- **content_personalization** — geo/time/device-aware content variants at edge · CVR · L
- **fundraising_campaigns** — progress bar + donor wall; extends donations_engine · nonprofit · M
- **volunteer_signup** — availability calendar + skills matching · nonprofit · S
- **waitlist_prelaunch** — email capture + referral loop before site launch · growth · S
- **webinar_registration** — Calendly/Cal.com embed + attendee management · B2B · S
- **visitor_accounts** — passwordless login for returning visitors · personalization · L
- **quote_calculator** — multi-step form → instant estimate PDF · services vertical · M

---

## Admin/UI upgrades

### Performance + architecture (not yet shipped)

- **Zoneless Angular 21** — remove Zone.js; signals-only change detection; 40–60% INP improvement · M
- **`@defer` below-fold sections** — lazy-load heavy admin sections on viewport entry · bundle reduction · S
- **Bundle budgets in CI** — fail build if any route chunk exceeds threshold · perf regression gate · S
- **Prefetch-on-hover** — `[routerLink]` with `prefetchStrategy: hover`; instant nav feel · INP · S
- **outputMode static prerender** — prerender /admin shell; Workers Assets SPA handling + `run_worker_first` · TTFB · M
- **Critical-CSS inline** — extract above-fold CSS at build time; eliminate render-blocking stylesheet · LCP · M

### A11y + accessibility

- **APCA+WCAG dual contrast validation** — CI gate: both standards pass (APCA Lc≥60 for body) · compliance · S
- **Angular Aria headless primitives** — replace custom ARIA with CDK or Spartan brain semantics · reliability · M
- **Focus rings ≥3:1** — audit all interactive elements; missing focus-visible = build fail · WCAG 2.2 new · S
- **`role="status"` skeletons** — skeleton loaders announce "Loading…" to screen readers · a11y · S
- **`prefers-reduced-motion` audit** — disable shimmer/View Transitions for motion-sensitive users · WCAG · S
- **axe 0-violations gate in CI** — no new axe violations block merge; run against authed /admin · compliance · S

### Agentic AI copilot (large, focused session)

- **AG-UI/CopilotKit drive layer** — event streaming protocol; tools registered per admin section · architecture · L
- **Anthropic strict tool schemas** — typed Zod tool in/out for every copilot action · safety · M
- **Streaming tool-use panel** — show tool plan + progress before committing mutations · HITL · M
- **Shadow/dry-run mode** — every copilot mutation previews diff before executing · safety · M
- **Tamper-evident audit chain** — copilot actions logged to audit table with hash chain · compliance · M
- **Approval-fatigue detection** — suppress low-risk confirmations after N consecutive approvals · UX · S

### Command palette + navigation

- **Unified Cmd+K palette** — CDK Overlay + signals; full keymap; recent + suggested commands; works inside /admin · power-user UX · S
- **Density toggle wired** — compact/comfortable/spacious preference persisted to localStorage · UX · S
- **"Explain this screen" button** — per-section AI contextual help overlay · onboarding · S
- **Global top loading-bar** — ngx-progressbar or CSS `@keyframes`; fires on every navigation · polish · S
- **System-health tiles** — live Worker status, D1 latency, R2 quota on /admin dashboard · ops visibility · S

### Data tables + grids

- **Sticky table headers** — `position:sticky` on all `<th>`; no horizontal overflow · UX · S
- **Saved filter views** — persist column visibility + sort + filter state to localStorage/DB · power-user · M
- **Row actions behind hover** — show edit/delete only on row hover to reduce visual noise · density · S
- **TanStack Table for all grids** — migrate remaining ag-grid instances; `createAngularTable` pattern already in use · consistency · M

### Data visualization

- **visx sparklines** — per-metric trend lines in overview tiles; tiny + accessible · insight · S
- **ECharts for heavy charts** — analytics/billing charts using ECharts dark theme tokens · consistency · S
- **Real-time overview tiles** — 30s polling with visibility-pause (already in AdminStateService) wired to dashboard stat cards · ops · S
- **Bento priority layout** — asymmetric dashboard grid; hero metric large, supporting metrics small · visual hierarchy · M
- **Anomaly callouts** — AI-detected traffic/revenue anomalies surfaced inline on charts · signal-to-noise · M

### Forms + UX polish

- **Unsaved-changes guard** — `CanDeactivate` guard on all forms; "You have unsaved changes" dialog · data safety · S
- **Breadcrumb trail** — hierarchical breadcrumb synced to router state; deep-link friendly · navigation · S
- **Copy-correlationId** — one-click copy of request ID on every error state · support · S
- **`?` shortcuts legend** — keyboard shortcut reference modal (common pattern: `?` key) · discoverability · S
- **Toast undo** — 5s undo window on destructive actions (delete, bulk-ops) · safety · S
- **Tabular-nums** — `font-variant-numeric: tabular-nums` on all numeric columns · readability · S
- **Last-updated chip** — "Updated 3m ago" chip on data panels; helps ops know freshness · trust · S
- **Offline banner** — detect `navigator.onLine` false; show cyan "You're offline" notice · resilience · S
- **Empty → first-action state** — all empty states have a primary CTA (not just "No data found") · activation · S
- **Status-pill standardization** — unified `<app-status-pill>` with semantic color tokens; no hand-rolled badges · consistency · S

### i18n

- **ngx-translate/Transloco wired** — extract all admin strings; language switch without reload · international · L
- **RTL-safe layout** — audit all flex/grid for `start`/`end` instead of `left`/`right` · RTL markets · M
- **AI-assisted translation** — on locale file save, auto-translate missing keys via Workers AI · maintenance · M
- **Intl number/date formatting** — replace hardcoded en-US formats with `Intl.NumberFormat` · correctness · S

### Nx + monorepo hygiene

- **`nx init` in place** — add Nx to existing Angular workspace; enable `nx affected` CI · DX · M
- **One feature lib per domain** — move admin sections to `libs/features/<slug>/`; enforce boundary lint · architecture · M
- **TypeDoc** — generate API docs from JSDoc on all exported symbols; wire to CI · docs · S

---

## Convergence/completion doctrine (terse)

**Two pillars:** (A) Feature-module completeness — every capability in `libs/features/<slug>/` with typed manifest + flag + colocated tests. (B) E2E-TDD total coverage — every feature in `e2e/FEATURES.md` with passing Playwright spec.

**Priority ladder:**
- P0 — #4 review_approval_links, #8 team_seats_rbac (team plans unlock)
- P1 — #10 outbound_webhooks, #11 automation_builder (integrations layer)
- P2 — #12 email_deliverability_wizard, #17 bulk_site_ops (agency efficiency)
- P3 — Authorized capstone: Workflow dispatcher (requires #8 seat caps live first)

**Definition of Done (6 criteria):** manifest.ts with all 7 fields · feature flag in D1 (`enabled=0, rollout=0, stage='experimental'`) · Zod schemas at every boundary · unit tests green · `e2e/<slug>/` spec with homepage-first Playwright · PostHog event + Sentry breadcrumb with `featureSlug`.

**Hard resolved facts:** brand=CYAN/BLACK only · no duplicates (backup_restore→SNAPSHOTS, fundraising→donations_engine) · worker deploys need Docker daemon running · worktree agents must `git reset --hard origin/main` before working · `grep` aliased to ugrep may return zero silently — use `/usr/bin/grep`.

**Per-round protocol:** run prod gates first → inspect NEW sections → pick ONE module from P0→P3 ladder → write failing test → implement → deploy → E2E 6bp → mark done → ask "what else?"

---

## Dashboard quick-wins

### Ship-first (S = <2h each)

- **Cmd+K palette** — see Admin/UI upgrades; highest-leverage single addition · S
- **Density toggle** — compact/comfortable/spacious wired to localStorage · S
- **"Explain this screen"** — per-section AI help button with streaming response · S
- **Global top loading-bar** — fires on every navigation; 3-line addition · S
- **System-health tiles** — Worker/D1/R2 live status on dashboard overview · S
- **Rolling-counter audit** — verify ALL numeric stats on dashboard use `<app-rolling-counter>`; fix any static counts · S
- **Sticky table headers** — `position:sticky` on all `<th>` · S
- **Status-pill standardization** — replace hand-rolled badges with `<app-status-pill>` · S
- **Skeleton loaders everywhere** — any section without a skeleton gets one · S
- **Empty → first-action states** — replace "No data" with CTAs · S
- **Unsaved-changes guard** — `CanDeactivate` on all forms · S
- **Breadcrumb trail** — synced to router state · S
- **Copy correlationId** — one-click on every error banner · S
- **`?` shortcuts legend** — modal on `?` keypress · S
- **Toast undo** — 5s window on destructive actions · S
- **Tabular-nums** — `font-variant-numeric` on all numeric columns · S
- **Last-updated chip** — "Updated Xm ago" on data panels · S
- **Offline banner** — `navigator.onLine` detection · S
- **`prefers-reduced-motion` audit** — disable shimmer under reduced-motion · S
- **Focus-ring pass** — audit all interactive elements for ≥3:1 focus-visible · S

### Medium wins (M = 2–8h each)

- **Agentic copilot read-only tools** — read-only tool palette (fetch-site-stats, list-flags, list-sites) for copilot v1 · M
- **NL command palette** — natural-language intent→admin action via Workers AI · M
- **Generative per-section summary** — "Summarize this section" AI strip above each data panel · M
- **Saved table views** — persist column vis + filter state · M
- **Export CSV/JSON** — all tables export with disabled-when-empty guard (pattern: already in analytics/forms/audit) · M
- **Voice input** — Web Speech API on search/command fields · M
- **Real-time overview tiles** — 30s polling + visibility-pause on dashboard stat cards · M
- **Bento overview** — asymmetric grid layout for dashboard hero area · M
- **Anomaly callouts** — AI-detected anomalies on charts · M
- **PWA update banner** — "New version available — reload" prompt via service worker · M

### Large wins (L = 8–30h — dedicated session)

- **Full agentic copilot with HITL** — streaming tool-use + shadow mode + approval chain · L
- **TanStack migration** — all remaining ag-grid grids to `createAngularTable` (already installed, pattern exists) · L
- **i18n completion** — Transloco wired + AI-assisted translation for all admin strings · L
- **Deep-link hardening + full-reload detector** — audit all internal nav for full-reload; fix any `window.location.href` usages · L
- **Section-by-section cockpit component pass** — systematic review of each /admin section for brand-token drift + cinematic motion + rolling-counter compliance · L
