# ProjectSites.dev — THE Single TODO

> **⚑ THE ONE running TODO list.** Every backlog/requirement/idea file was folded here + deleted
> (git history holds the rest). **Sorted strictly by importance — top = do first.** Value-tiered
> (P0 → Tier 1 → Tier 4 → Dedicated → Needs-Brian); within each tier, most important first.
>
> **The finishing-loop cron drains this file.** `scripts/loop-done-check.sh` counts unchecked
> `- [ ] … [auto]` lines = autonomous work left. `[auto]` = loop builds it; `[gated]` = needs Brian
> (in `## ⛔ NEEDS BRIAN`, never blocks DONE); `[dedicated]` = real but needs a supervised session.
> Legend: `[ ]` open · `[x]` done. Close one, tick it, commit, next. Shipped proof = `git log`.
> `_LOOP_PROGRESS.md` holds only the loop's runtime GATE state (not a TODO list).

---

## 🚨 P0 — Critical (security / risk / margin — before any feature)

- [x] **Cross-tenant publish vuln — FIXED (loop fire 2026-06-28).** The real surface was `seo_autopilot.approveDraft(env, draftId, approvedBy)` — it fetched+approved+`applyToSite`-published a draft by id with NO org scoping. The route layer already guarded (`owner.org_id !== c.get('orgId')` → 404), but the SERVICE was org-unsafe for any other caller. Added a required `expectedOrgId` param + `if (draft.org_id !== expectedOrgId) return 'Draft not found'` (defense-in-depth, never leaks existence); route now passes `c.get('orgId')`. TDD: new SECURITY test asserts org_B can't approve org_A's draft (no status flip, no R2 publish) + 2 existing tests updated. 39/39 jest green, tsc 0 (worker → CI push). [DONE]
- [x] **Tenant `org_id` scoping audit — DONE (2026-06-28).** Security-reviewer audited all route→tenant-mutation paths: pattern is route-level ownership gates (`requireOwnedSite`/`gateOwnedSite`/`siteOrgId`), ~20 surfaces clean. Found **7 IDOR gaps, all in flag-DARK experimental modules** (zero live exposure) — **ALL 7 NOW GATED** with `assertSiteOwned`/org-compare before the service call, + tests: `edge_personalization`, `aeo_pass`, `search_submit`, `wireframe_planning` (4 WRITE, prior fire) + `gbp_assist` (guard-level, covers 3 routes), `site_thumbnail_grid`, `page_audio_summary` (this fire). Combined 71/71 jest green, tsc 0 across the 7 modules; worker → CI push. **REGRESSION GATE + 2 MORE (2026-06-28 capstone):** built `scripts/check-idor-gates.mjs` (flags any `:siteId`/`:id` feature handler lacking an ownership idiom) — it caught **2 gaps the agent's spot-check MISSED**: `ai_concierge_widget` + `site_semantic_search` (both authed, ungated) → gated via shared guard (10/10 jest, tsc 0). **9 IDOR gaps total now closed.** Gate wired into `npm run check` + feature-architecture CI (0-finding-stable → blocking); FP-tuned to recognize `verifySiteOwnership`/`fetchOwnedSite`. **WHOLE-WORKER coverage (2026-06-28):** extended the detector to ALSO scan legacy `src/routes/*.ts` — manually audited the 6 flagged route files: all clean (super-admin via `isSuperAdmin`, org-scoped via `org_id`, or intentionally PUBLIC visitor routes `concierge`/`i18n`/`page_audio`/`agentic_commerce` exempted). Detector now green across libs/features + src/routes. [DONE + class-gated worker-wide]
- [ ] [auto] **Margin leak** — (a) force AI-Gateway on every model call · (b) swap GPT-4o vision→Workers-AI where adequate · (c) cache research/brand/assets per business. PROGRESS 2026-06-28: AI-Gateway is default-on via `ai_gateway.ts` (`gatewayFetch`, 5xx→direct fallback), but **13 direct `api.openai.com`/`api.anthropic.com` fetches bypassed it** — built `scripts/check-ai-gateway.mjs` detector (report-mode `npm run check:ai-gateway`; audit-arc Detect+Surface) + routed the hottest (`openai_research.ts`, runs every build) → 13→12. Routed 13→12→8→**0 (part (a) DONE, fire 2026-06-28d):** routed the final 8 — `search.ts`×3 (vision-inspect threaded `env` through `inspectImageWithVision`; edit-image describe + dall-e), `external_llm:1181` (files-upload multipart), `image_generation`, `media`(tts), `image-generation.wf`, `site-generation.wf:1334`(vision critique) — all through `gatewayFetch(env,'openai',…)`. Detector `✓ no bypasses`, tsc 0; **flipped `check:ai-gateway --ci` into the blocking `npm run check` chain** (audit-arc Promote) so a regression now fails CI. 2 tests updated for the gateway shape (image_generation headers via `new Headers().get()`, external_llm uploadDoc → `mockGatewayFetch`); 65/65 green. Worker → CI push. **(c) CORE shipped 2026-06-28e:** `services/research_cache.ts` — pure stable `researchCacheKey(identity)` (placeId→domain→normalized name+address precedence, per-part trim so the same business always hits the same key) + `getCachedResearch`/`putCachedResearch` (CACHE_KV, 30-day TTL, never-throw) + `extractDomain`; 10 unit tests green, tsc 0. **(c) WIRED 2026-06-28f:** `researchAndFormulatePrompt` (openai_research.ts) now computes `researchCacheKey({placeId,name,address})`, `getCachedResearch` BEFORE the 5 research LLM calls (hit → return, skip all) + `putCachedResearch` AFTER — gated behind `research_cache` flag (default-off → dark; on the load-bearing build path so dark-launch is the disciplined default). 29 tests green (cache skipped when flag off → existing research behavior unchanged), tsc 0; worker→CI push. Flag-enable = the live ~15→5 min rebuild win (flags-green gate). **ONLY REMAINING for full #19 tick: (b)** swap GPT-4o vision→Workers-AI llama-4-scout where adequate (per-callsite QUALITY judgment — low-stakes calls like image-reachability/description can swap; keep gpt-4o for the high-stakes vision critique; verify output quality before enabling). NOTE: routing flips `init.headers` to a `Headers` object — tests asserting `init.headers.X` must use `new Headers(init.headers).get('X')`.

## 🔥 Tier 1 — Highest value (the revenue engine + what protects it)

### Conversion & activation (no revenue without these)
- [ ] [auto] Anonymous first-generation before signup — let visitors generate a build before the wall (biggest activation lever).
- [ ] [auto] One-click "Claim this site" → inline Stripe checkout (collapse adopt→pay).
- [ ] [auto] Contextual upgrade prompts at the friction moment (custom domain / remove top-bar / more pages).
- [x] Abandoned-build recovery email — DONE 2026-06-28 (dark-launched behind `abandoned_build_nudge`, default-off). Full chain shipped: migration `0581` `sites.nudged_at`+index (APPLIED prod+dev D1) · `'recovery'` email kind (preview CTA) · pure `selectAbandonedBuilds` (finished+unclaimed+age∈[24h,14d]+7d throttle) · `runAbandonedBuildNudges` orchestration (stamp-only-on-ok) · env runner `runAbandonedNudgesForEnv` (D1 scan: finished sites + owner-email join + unclaimed-via-subscriptions + previewUrl) wired into `index.ts scheduled()`. 13 unit tests incl dark-launch-no-op + flag-on scan; tsc 0; worker→CI push. Flag-enablement = separate flags-green gate (enable → cron emails owners of finished-but-unclaimed builds in test/live mode). [DONE] · (history) PROGRESS 2026-06-28: shipped the pure eligibility core `services/abandoned_builds.ts` `selectAbandonedBuilds(rows, nowMs, opts)` (finished + unclaimed + age∈[24h,14d] window + 7d re-nudge throttle) + 8 unit tests green, tsc 0. UPDATE 2026-06-28b: (1) ✅ `nudged_at INTEGER` column + `idx_sites_nudge_scan` shipped (migration `0581`, APPLIED to prod + dev D1); (2) ✅ `'recovery'` kind added to `claim_build_emails.ts buildClaimEmail` (preview-link CTA); (3) ✅ I/O orchestration `runAbandonedBuildNudges(deps, opts)` built — scan→select→send→stamp-only-on-ok (at-least-once, throttle-guarded) + 3 wrapper unit tests (17 total green, tsc 0). ONLY REMAINING = the env-backed cron call in `index.ts scheduled()`: a `runAbandonedNudgesForEnv(env)` providing the confirmed deps — `listCandidates` = finished sites LEFT JOIN active `subscriptions` (unclaimed) JOIN owner email (`SELECT u.email FROM users u JOIN memberships m ON u.id=m.user_id WHERE m.org_id=? ORDER BY u.created_at ASC LIMIT 1`, per notify.ts) + previewUrl `https://{slug}.{SITES_SUFFIX}`; `markNudged` = `UPDATE sites SET nudged_at=?`; `sendRecovery` = `sendClaimBuildEmail('recovery', …)`; gate the cron call behind `isFlagOn(env,'abandoned_build_nudge')` (default-off → dark-launch). Mechanical — all deps/queries confirmed.
- [ ] [auto] Instrument golden-path funnel in PostHog (search→signin→build→preview→claim→pay + drop-off cohorts).
- [ ] [auto] Streaming live-preview during build (render-as-it-generates, not a polling spinner).
- [ ] [auto] Live agentic action trail during site-gen (stream each Workflow step, for trust).

### Money-trust & correctness (don't double-bill / don't lose builds)
- [x] General `Idempotency-Key` middleware — DONE 2026-06-28. `middleware/idempotency.ts` mounted `app.use('/api/*', idempotencyMiddleware)` after auth → dedupes ALL mutating (`POST/PUT/PATCH/DELETE`) `/api/*` requests carrying an `Idempotency-Key` header: first 2xx JSON cached in `CACHE_KV` (24h TTL, org-scoped key), replayed verbatim (`idempotency-replayed: true`) so the handler runs exactly once. Safe-by-default (no-op without the header → existing traffic unchanged; non-2xx never cached → errors retryable; cross-tenant replay impossible). TDD: 5 unit tests (replay / no-op / no-cache-on-error / cross-tenant isolation / key-scoping) green; existing API route suite still 40/40; tsc 0; worker → CI push. [DONE]
- [ ] [auto] Finish event-bus → outbox → DLQ → retry loop for durable money/build events.
- [ ] [auto] Container build retry/DLQ on failure (capture/replay, not a silent error-email).
- [x] Sentry/observability on worker critical paths — DONE (verified 2026-06-28). All three named paths emit structured error visibility flowing to **Workers Tracing OTLP** (the project's observability backbone) + typed notifications: (1) **build-status callback** — structured `console.warn(level:error, service:build_status_finalize)` on finalize failure (#24, `index.ts:646`); (2) **workflow steps** — every helper catch (event-emit/status-update/audit-log) emits structured `console.warn(level:warn, service:workflow)`, and terminal build failures fire `notifyBuildFailed` → typed `build.failed` event + `status:'error'` + per-step exponential-retry (`site-generation.ts`); (3) **billing** — critical errors return TYPED `parseStripeError` envelopes (not swallowed); the `catch{}` blocks are intentional fail-soft graceful parsing per `fail-soft-prod`. No silent blind-spots remain on the critical paths. [DONE]

### Quality moat (why they pay — protects the generated product)
- [ ] [auto] Eval harness scoring every generated build (GPT-4o vision + Lighthouse + SEO, regression-tracked).
- [ ] [auto] Per-section AI-vision auto-reroll (<8/10 → regenerate).
- [ ] [auto] A11y autofixer + AI alt-text — axe findings fixed pre-publish (ADA legal-risk reducer).
- [ ] [auto] AI competitor-gap scan at build — score 5 peer sites, propose missing sections.

## ⬆ Tier 2 — High value (paid levers, honesty bugs, conversion analytics, security)

### Stop the lying UI (honesty bugs — P0-adjacent)
- [ ] [auto] S1 — real Lighthouse/CWV scores (run in the build container; matrix cells are permanently NULL today).
- [ ] [auto] S2 — real axe-core a11y (replace the fake `img:not([alt])` proxy).
- [x] AN54 — operator zero-state honesty — DONE (verified 2026-06-28): `admin_analytics` (events-daily/publishes-by-source/claims-by-source) + `admin_funnel` all return `{rows/stages, degraded, count}` via `fetchPipeRows`/`fetchActivationFunnel` — `degraded:true` flags the Tinybird-unconfigured/down zero-state so the dashboard renders "no data yet" instead of erroring/silent-empty. Not a silent empty return. [DONE]

### Apps marketplace — paid managed-hosting (Tier A0 trust = why anyone pays vs a VPS)
- [ ] [auto] A1 — per-instance automated backups + 1-click restore (Neon branch-snapshot + R2 versioning).
- [x] A4 — pre-provision dry-run + cost preview + confirm gate — DONE (2026-06-28). The catalog-detail page already shows the **dry-run** (`provisioning()` checklist of which Neon/Upstash/R2 will be created) + **cost preview** (`costLines()`/`totalCost()`). Added the missing **confirm gate**: `apps-detail.deploy()` is now async and `await`s `ConfirmService.confirm({ title:'Deploy {app}?', message:'This provisions {managed infra} at ~${total}/mo …', confirmLabel:'Deploy', danger:false })` BEFORE the `POST /apps/instances` — so billable infra is never SILENTLY provisioned; cancel → no POST. TDD: +1 spec (confirm-declined → no POST) + 2 deploy specs made async; 1562 Karma green, ng build clean, tsc 0. Frontend → CI R2 deploy. [DONE]
- [x] A2 — live metered cost per instance — DONE (2026-06-28, end-to-end). **Backend:** new pure `services/app_cost_meter.ts` `estimateInstanceCost(instance)` derives a monthly USD estimate from the instance's ACTUAL state — running-vs-hibernated compute + a line per provisioned aux infra (Neon/Upstash/R2) — `basis:'estimate'` (exact vendor-billing spend = the separate [operator] follow-on). Wired into `sanitizeInstance` so EVERY org-scoped instance API response (list + detail) carries `costEstimate`. 5 unit tests + apps_routes 26 green, tsc 0. **Frontend:** threaded `costEstimate` through `AppInstance` + `adaptInstance` mapper + a live `~$N/mo` chip on each instance row (replaces the static catalog `estCostMonthly` for provisioned instances); ng build clean, 1561 Karma green. Worker → CI push, frontend → CI R2 deploy. [DONE]
- [x] A3 — health surfaced so a crash isn't a silent white screen — DONE (2026-06-28). **Auto-heal already exists** (the `app_runtime` DO auto-restarts ≤3/min + idle-hibernates). The gap was VISIBILITY: the instance row showed the status pill (running/error/stopped) but swallowed `last_error`. Surfaced it — `AppInstance` + `adaptInstance` now carry `last_error` (already in the API response), and the row renders a `⚠ {last_error}` line (with full-text `title`) whenever `status === 'error'`. ng build clean, 1562 Karma green, tsc 0. Frontend → CI R2. (Follow-on if wanted: a historical state event-log + the DO's live `restart_count` via a DO fetch — needs an events table.) [DONE]
- [ ] [auto] A6 — per-instance custom domain + auto-TLS (CF-for-SaaS custom hostname; the paid lever).
- [ ] [auto] A7 — resource sizing tiers at deploy + live upsizing (the core paid lever).

### Owner analytics that drive action (the phone/form IS the conversion)
- [x] AN18 — click-to-call & directions tracking — DONE (2026-06-28). Full chain: (1) the served-site analytics tracker (`buildAnalyticsTracker`) now binds a capture-phase delegated click listener that classifies `tel:`→call, `mailto:`→email, Google/Apple-maps + `/maps/dir`→directions and fires a `conversion` event tagged with `{kind, section, href}` — `section` read from the nearest `data-ps-section` ancestor (AN26 hook), feeding AN27. Fully try/catch-wrapped (never throws into the host page). (2) Added `'conversion'` to `EVENT_TYPES` so the ingest Zod boundary accepts it (was rejected → silently dropped). (3) Persists to `analytics_events` via the existing `/api/events` → `persistAnalyticsEvent` path (payload carries kind/section/href). TDD: +2 tracker tests + 1 ingest-accepts-conversion test (34/34 analytics suites), tsc 0, 0 net-new suite fails. Worker → CI push. [DONE]
- [ ] [auto] AN17 — form analytics: completion rate + abandonment per form (bridges pageview→lead).
- [ ] [auto] AN3 — unified owner-analytics query service (one API over the six backends; unblocks every widget).
- [x] AN27 — section-level attribution query + UI — DONE (2026-06-28, the moat). **Query:** `getConversionsBySection(env, siteId, windowDays)` aggregates the AN18 `conversion` events (tagged with the AN26 `data-ps-section`) from `analytics_events`, GROUP BY section+kind, ranked by count desc with each section's % share + per-kind (call/directions/email) split; null section → `(unattributed)` (never lost); defensive → empty on D1 error. **Route:** `GET /api/sites/:siteId/analytics/sections` (flag `site_analytics`, org-ownership-gated → 404). **UI:** new standalone `SectionAttributionComponent` (ranked rows + % share bars + 📞/🧭/✉️ kind counts + empty + retry-able error states) mounted as a deep-linkable **"By Section"** tab (`?tab=sections`) in the analytics dashboard, sourcing the selected site from `AdminStateService`. TDD: +5 worker query tests (20/20 site_analytics) + 4 widget Karma tests + 1 dashboard tab test (1567/1567 Karma); ng build + tsc both clean; 0 net-new fails. Worker → CI push, frontend → R2. [DONE]
- [ ] [auto] AN29 — natural-language analytics query ("visitors from Instagram last week?") — builder-only moat.

### Generated-site quality (remaining)
- [ ] [auto] 1:N sitemap fidelity guard — validator `validateRouteCount` exists + is in the `validateBuild`/`validateBuildAst` chain; WIRED into the live `validate-build` step 2026-06-28 (site-generation.ts now sources `sourceRouteCount` from `_scraped_content.json` in the build output and passes it to `validateBuild`). REMAINDER: the guard only fires when the container includes `_scraped_content.json` in the upload prefix — confirm/ensure that on the next real build (or source the count from D1 research_data), then flip `validate-build` report→strict so a collapsed page count actually FAILS.
- [ ] [auto] Flip `build_validators` report→strict (enforce the 13 quality invariants).
- [ ] [auto] Logo/font/color extraction fidelity (the suped-up-clone lever).
- [ ] [auto] Source-site theme-polarity preservation guard — decision logic SHIPPED (`services/theme_polarity.ts`, 13 tests); remaining = stamp `theme`/`preserveSourceDesign` onto container `_brand.json` + post-build `validateThemePolarity` guard.

### Security hardening
- [ ] [auto] CSP L3 strict-dynamic + nonce + Trusted Types on the worker AND generated output sites.
- [x] SSRF allowlist on user-URL-fetch routes — DONE (audit 2026-06-28). Guard library `outbound_webhooks.ts` (`isSafeWebhookUrl`/`isSafeCrawlUrl`/`isSafePublicHost` — rejects private/loopback/link-local/IPv4-mapped-IPv6 + cloud-metadata 169.254.169.254) + `search.ts isProxyableImageUrl`. Audited EVERY user-URL fetch sink: import-rss (`isSafeWebhookUrl`), og-preview (`isSafeWebhookUrl`), image-proxy (`isProxyableImageUrl`), SES SNS confirm (`SNS_SUBSCRIBE_HOST` allowlist) — ALL guarded. Added defense-in-depth `isProxyableImageUrl` guard on the image-candidate HEAD-reachability fetch (provider-derived URLs). tsc 0; worker → CI push. [DONE]
- [x] Secret-at-rest audit (MCP_ENCRYPTION_KEY + env-var AES-GCM) + rotation story — DONE (2026-06-28). **Audited** `ai_crypto.ts` (the single encrypt/decrypt seam used by ai_env_vars, MCP OAuth tokens, google_drive, outbound_webhooks, social tokens): ✅ AES-256-GCM authenticated, ✅ fresh 12-byte IV per write (no nonce reuse), ✅ non-extractable key, ✅ 32-byte-validated, ✅ tamper/wrong-key rejection, ✅ decrypt-failure audited, ✅ plaintext never logged/leaked. **Shipped the rotation story as CODE** (not just a doc): added optional `MCP_ENCRYPTION_KEY_OLD` decrypt-fallback → `decrypt` tries primary then old key, enabling ZERO-DOWNTIME rotation (deploy new-primary + old-fallback → lazy re-encrypt on write → drop old). +3 rotation unit tests (9/9 green), tsc 0. Runbook: `docs/security/secret-at-rest-audit.md`. Worker → CI push. [DONE]
- [ ] [auto] Social (Pulse) LIVE DEFECTS — REMAINDER ONLY: add `social_*` flags · OAuth token-refresh. (verified 2026-06-28: `REAL_UA` already `149` in `social_publishers/types.ts`; `prepareMedia` already uses tenant-independent env-overridable `MEDIA_PUBLIC_BASE` → `/assets/r2/*` platform host, NOT a tenant-breaking hardcoded domain — both original sub-defects already fixed.)

### Viral growth surfaces
- [ ] [auto] S22 — immutable stable preview URLs (`{slug}-{snapshot}.projectsites.dev` permanent + shareable).
- [x] S23 — "Built with ProjectSites" footer on unauth previews — DONE (verified 2026-06-28). The fixed bottom conversion bar (`generateConversionFlow`) carries the `ps-bar-brand` backlink to ProjectSites and is injected on every FREE-plan served surface: branch previews (`{branch}--{slug}`, always `plan:'free'` → `site_serving.ts:369`) AND snapshot previews (`{slug}-{snapshot}`, plan inherited from the base site's subscription → free sites get the bar). So an anonymous viewer of any unauth/free preview sees the "Built with" footer + backlink. The link IS the ad. (S24 remains distinct — the bar's CTA is owner-claim "$50/mo", not build-your-own.) [DONE]
- [x] S24 — "Build your own" CTA for anonymous preview viewers — DONE (2026-06-28). The free-tier conversion bar's brand backlink (`ps-bar-brand`, shown on every free/preview surface) now carries a visible **"Build your own"** label + `aria-label`, links to `https://{SITES_BASE}/?ref=preview` (attribution), so an anon viewer who likes the preview has a one-click path to start their own build — distinct from the owner-facing "Claim $50/mo"/"Edit with AI" CTAs. Label hides <600px to avoid mobile crowding; keeps the #80/#134 backlink. +1 unit test (82/82 site_serving), tsc 0. Worker → CI push. [DONE]
- [ ] [auto] S27 — Client Review Mode (Approve promotes the snapshot live; agency-tier feature).
- [ ] [auto] A21 — referral / org-to-org "share this stack" deploy link (viral loop).

### Reliability (remaining) + dev velocity unblocker
- [ ] [auto] traceId + tenantId correlation across the pipeline.
- [ ] [auto] Auto-rollback wired to a post-deploy error-rate/LCP watcher.
- [ ] [auto] Migrate worker Jest → **Vitest** (kills the `@swc/jest` module-mock anomalies that flake every test fire).

## ➡ Tier 3 — Medium value (P1 epics, growth, mid analytics, infra)

### P1 revenue epics (big, multi-session, deliberate)
- [ ] [auto] Native booking engine (catalog-confirmed missing) — paid retention.
- [ ] [auto] Inject visitor AI concierge into published sites (retention).
- [ ] [auto] AI-native GEO layer + citation tracking (AI-search moat; aeo_pass).
- [ ] [auto] Edge per-visitor personalization (hero/CTA swap).
- [ ] [auto] Post-publish autonomous growth agent.
- [ ] [auto] `psnotify` — custom notification engine (DO inbox + center + per-channel prefs + multi-channel) wired to build/deploy/domain/billing + Apps lifecycle. NEVER Novu.

### Snapshots + apps growth (remaining)
- [ ] [auto] S4 — unify rollback (collapse the two divergent restore paths into the complete one).
- [ ] [auto] S17 — undo-publish window (one-tap revert toast ~5 min after every publish).
- [ ] [auto] S39 — scheduled publish + auto-revert-after-48h (Pro upsell).
- [ ] [auto] A13 — category landing pages + per-category `SoftwareApplication` JSON-LD (organic discovery).
- [ ] [auto] A18 — public app profile pages (indexable `/apps/:slug` + "Deploy to ProjectSites" button).

### Analytics (remaining)
- [ ] [auto] AN12 — conversions/goals: owner-named outcomes + count + rate (rate shipped; naming UI + goals table remain).
- [ ] [auto] AN19 — per-site funnel (landing → key page → conversion), owner-scoped.
- [ ] [auto] AN23 — weekly email digest (Monday auto-summary via SES+Listmonk).
- [ ] [auto] AN48 — public shareable read-only dashboard URL (token + optional expiry).
- [x] AN26 — section-level instrumentation (auto-inject stable `data-ps-section`) — DONE (2026-06-28). `injectSectionInstrumentation(html)` stamps a stable `data-ps-section` onto every served-page `<section>`: derived from the section's existing `id` (slug-sanitized to `[a-z0-9_-]` → semantic, e.g. `services`/`pricing`) with a deterministic 1-based `section-N` fallback. Purely additive (idempotent, never rewrites other markup, key sanitized so it can't break the tag). Wired into the serve path gated on analytics-enabled (`ANALYTICS_INGEST_ENABLED`/`EVENT_DISPATCHER`). This is the stable hook AN27 (#63 section attribution) reads. +5 unit tests (82/82), tsc 0. Worker → CI push. [DONE]
- [ ] [auto] AN49 — year-in-review auto report (retention loop).
- [ ] [auto] AN50 — benchmark vs fleet median ("your form converts 1.2% vs 3.4% category avg").

### Admin + infra + compliance
- [ ] [auto] Admin "build health" dashboard (success rate, p95 build time, failure reasons).
- [ ] [auto] R2 Standard→Infrequent-Access lifecycle after 30d (margin).
- [ ] [auto] Enable Cloudflare Queues for async fan-out off the request path (p99).
- [ ] [auto] WCAG 2.2 AA — close the 6 new criteria on admin + generated sites (box-tap-target ≥24px is gated on E2E_TEST_PASSWORD — see NEEDS BRIAN).
- [x] Form reply-deliverability guardrails — DONE (2026-06-28). Two halves: (1) **SPF/DMARC/DKIM** sending-domain analysis already shipped as the flag-gated `email_deliverability` feature (`checkDeliverability` + route + 0-100 score). (2) **NEW reply guardrail:** added `hasDeliverableMx(fetch, domain)` (DoH MX lookup, A/AAAA implicit-MX fallback, NXDOMAIN→false, **fail-OPEN** on lookup error) + wired into `handleContactForm` — the auto-receipt is now SKIPPED when the submitter's domain can't receive mail (fake/typo/NXDOMAIN), so a hard bounce never dents projectsites.dev's sender reputation; the team notification (Email 1) always sends. TDD: +6 `hasDeliverableMx` unit tests + 1 contact skip test; ai_crypto/email_deliverability/contact/api_routes all green (47/47 + integration), tsc 0. (rate-limit, escape, Zod contract were already DONE.) Worker → CI push. [DONE]
- [ ] [auto] Social (Pulse) hardening — rate-limit + quota alert, failed-post retry UX, brand-voice profile, per-platform reformat.
- [ ] [auto] Pulse Inbox AI — wire `summarizeConversation` + `suggestNextActions` into the inbox UI; `repurpose` + `translateContent` (per-account locale); expose auto-reply confidence in settings; backfill `social_analytics_snapshots`.

## ⬇ Tier 4 — Lower value (SEO polish, secondary analytics, tooling, coverage)

- [ ] [auto] FAQPage JSON-LD + answer-first content blocks on generated sites (+AI-citation weight).
- [x] AN2 — geo enrichment at ingest — DONE (2026-06-28). `recordPageviewFromRequest` (`visitor_events_core/service.ts`) now reads `cf.country` + `cf.city` + `cf.region` from the CF edge and persists all three into the event `metadata` JSON (was country-only) — capped to 80 chars, graceful `null` when the edge omits them, no schema migration (matches the existing AN1 metadata pattern). TDD: +2 tests (geo-persisted + null-graceful); 34/34 jest green, tsc 0; worker → CI push. [DONE]
- [x] AN38 — cookieless-by-default + "No cookies · GDPR" privacy badge — DONE (2026-06-28). **Cookieless-by-default verified:** the platform visitor beacon (`buildAnalyticsTracker`) uses a per-pageview in-memory `crypto.randomUUID()` (no cookie/localStorage); PostHog/Sentry are explicitly NOT injected into served sites; only GA4/GTM (opt-in operator env) set cookies. **Built:** `generateNoCookiesBadge()` — a subtle, a11y-labeled, print-hidden, dark-mode-aware fixed bottom-left pill that backlinks to ProjectSites — injected into served HTML **gated on `isServedSiteCookieless(env)` (`!GA4 && !GTM`)** so the claim is never a lie. +3 unit tests (39/39 site_serving green, site_serving_full 37/37), tsc 0. Worker → CI push. [DONE]
- [ ] [auto] AN42 — one-click full data export (CSV) + delete for the owner.
- [ ] [auto] GDPR/EU data-residency `jurisdiction="eu"` binding option on D1/R2.
- [ ] [auto] pSEO for projectsites.dev itself (comparison / template / location pages).
- [ ] [auto] Public template/showcase gallery (social proof + pSEO surface).
- [x] "Built with projectsites.dev" deploy badge → backlinks — DONE (verified 2026-06-28). `site_serving.ts` injects the promo top-bar into every UNPAID served site (`bodyInjection += generateTopBar(site.slug)` at :1067); the bar carries `<a id="ps-bar-brand" href="https://${DOMAINS.SITES_BASE}" target="_blank" rel="noopener">` — a real backlink to ProjectSites on every free/preview site. Live on megabytespace.* (prior fire #48 proof). The link IS the ad. [DONE]
- [x] 100% unit coverage on remaining untested PURE worker modules — DONE 2026-06-28. Drove the untested-pure-module count to **ZERO** across services + feature-modules + lib/prompts/utils/platform/middleware. This fire closed the last pure ones: `dashboard_persona` (3), preceded by `voice_browse_helpers`/`app_runtime_subclasses` (15) and `safe-parse`/`authz-subjects`/`wait-until` (12), with `aws-sigv4`/`resilient-fetch`/platform-routers covered by concurrent sessions. Verified via the untested-module finder: 0 io=0 modules with exports lack a test. REMAINING untested are NON-pure DurableObject/Container classes (`collab_room`, `*_container` ×4, `voice_browse_agent`) — they need a DO test-harness, tracked separately (see "Per-section E2E coverage" / a DO-harness follow-on), NOT in this PURE-module item's scope. [DONE]
- [ ] [auto] Per-section E2E coverage — every admin section + generated-site surface (see `e2e/FEATURES.md`); wire `*.e2e.ts` into CI.
- [ ] [auto] **schema-dts** (typed JSON-LD) + **html-validate** (HTML build gate) + **Pagefind** (client search >12-route) + **workers-og/Satori** (edge OG cards).
- [ ] [auto] **promptfoo** (prompt eval + injection red-team) + **Arcjet** (bot/rate-limit/PII as code).
- [ ] [auto] **DOMPurify** required on all customer/generated/imported HTML.
- [ ] [auto] **Drizzle ORM (RQBv2)** for type-safe D1 + migrations (incremental).
- [ ] [auto] **Knip** cleanup pass (44 known dead exports + unused deps/files).
- [ ] [auto] Replace Firecrawl with **Deepcrawl** as the approved site-context extractor.

## 🛠 Dedicated (real, but needs a supervised focused session)

- [ ] [dedicated] Frontend perf wave (~30h, all-or-nothing): ag-grid→TanStack on both admin grids · zoneless CD · SSR/SSG marketing shell · OnPush on 104 components · `@defer` below-fold · INP <150ms · fix ~30 `.subscribe()` leaks · `@Input()`→signal · `@ngx-translate`→`@angular/localize` · design-token drift · bundle-split Monaco/ECharts/Uppy.
- [ ] [dedicated] **Puck** visual page/block builder + **OpenFGA** authz model (orgs/sites/roles/agents) — each a focused session.

---

## ⛔ NEEDS BRIAN (human-gated — NOT `[auto]`, does NOT block DONE)

> The loop cannot finish these alone. Each names the ONE decision/action required.

- [ ] [gated] **Provision `E2E_TEST_PASSWORD`** — `wrangler secret put` (prod) + `.dev.vars`. ~1h, unlocks authed prod-E2E across the whole money path. Smallest unblock, highest leverage.
- [ ] [gated] **Pricing one-way doors** — free/Pro split (AN52), snapshot retention tiers (S45), AI-insight credits metering (AN53), 3rd-party paid app tier (A22), Lago usage metering. Loop proposes + wires; Brian sets prices.
- [ ] [gated] **A19 guest-browsable admin** — exposing the whole tenant `/admin` read-only to ANONYMOUS visitors is a data-exposure/privacy call: which sections/fields are safe unauthenticated vs must stay gated.
- [ ] [gated] **Notification vendor** — confirm `psnotify` (the ZERO-Novu rule) so the Novu/Dittofeed drift is deleted and it's built.
- [ ] [gated] **Case-study pages** — featuring a real named org (njsk.org) needs THEIR consent + approved logo/copy use. Decision: which consenting builds may be published.
- [ ] [gated] **Operator-key activations** — flip built-dark modules once keys/WAF set: observability gateway (Sentry/PostHog ingest + WAF), referral loop, lead-scanner outreach, CF WAF + rate-limit on /monitoring/*, Cloudflare Images, GBP OAuth connect, local-rank/review monitoring, EU data-residency.
- [ ] [gated] **Voice carrier polish** — STIR/SHAKEN attestation (V28) + port-in for existing business numbers (V32). *(Voice go-live itself is DONE/LIVE — see History.)*
- [ ] [gated] **Enterprise auth** — self-host Better Auth OSS on CF Containers + SCIM provisioning (verify Better Auth SCIM vs Authentik first).

---

## History

Shipped proof = `git log` + prior revisions of this file. Recently shipped: **Voice go-live (V0g) LIVE 2026-06-28** (agent `CA_dSUDxEC3EiP6` Running on LiveKit Cloud + Twilio Elastic SIP→LiveKit SIP trunk + dispatch; +12626864783 answers); #20 build-cap, #29 GDPR Art.17 cascade, #36 abuse-takedown, #45 onboarding-copilot, #48 built-with badge, #49 marketing GEO, AN6 owner-analytics route, V0b voice number-resolver, V33 AI disclosure, theme-polarity decision logic, SSRF + bot-gate hardening, speculation-rules, #44 owner-analytics dashboard.
