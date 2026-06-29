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
- [ ] [auto] Contextual upgrade prompts at the friction moment (custom domain / remove top-bar / more pages). **BACKEND DONE 2026-06-28** (dark behind `upgrade_moments`, default-off): new feature module `libs/features/upgrade_moments/` — pure catalog+eligibility core maps 6 friction triggers (`custom_domain`,`remove_branding`,`more_pages`,`ai_credits`,`priority_build`,`analytics_pro`) → honest, value-led, trigger-attributed upsells (`cta_url=/admin/billing?upsell=<trigger>` for funnel attribution); paid plans resolve `eligible:false` (never nag payers); dismissals persist in `CACHE_KV` (90d TTL, no D1 migration). Routes `GET /api/upgrade-moments`, `GET /api/upgrade-moments/:trigger`, `POST …/:trigger/dismiss` (404-when-off). 14/14 unit, tsc 0, validate:features PASS, worker→CI push (commit `2a93e167`). **REMAINING: (1)** FRONTEND — render the moment as a tasteful inline card at each free-plan friction point (slug-cap reached → `more_pages`; custom-domain modal → `custom_domain`; top-bar "remove" hover → `remove_branding`; low AI credits → `ai_credits`); wire dismiss + a Karma spec; **(2)** flip `upgrade_moments` flag beta/100% once a surface renders end-to-end + cta_url billing attribution verified.
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

## 🌟 Brilliant Features Wave — 2026-06-28 (solo-SMB · generous-free + paid power-ups)

> Curated from a brainstorm pass (Brian directive: all 4 axes, primary customer = solo SMB owner,
> pricing = generous-free + paid power-ups, execution = full autonomous wave). Quality over quota —
> each is genuinely novel vs the existing ledger, build-ready, and dark-launched behind its own flag.
> Free tier always sees real value; the upsell is the *power-up*, never a paywall on the basics.
>
> **Round-2 decisions (2026-06-28):** gated-behind-paid = **custom domain · remove branding bar · AI edit credits/month** (page count NOT gated → pages stay free; so `more_pages`/`priority_build` upgrade_moments triggers are de-emphasized until/unless gated). **Pricing = decide-later** → keep neutral `price_hint` ("Paid plan"); Brian sets numbers before any flag-flip (one-way-door). **Owner-facing AI voice = sharp & professional** (concise, confident, results-focused — applies to upgrade_moments, Site Doctor, first-lead celebration, emails). **Next deep flagship = Site Doctor (DONE backend).**

### Conversion & activation
- [x] [auto] **Places autofill before the wall** (`prefill_from_places`) — **CORE DONE 2026-06-28:** `services/places_draft.ts` — pure `placesToDraft(place: PlacesResult): BuildDraft` maps name/address/phone/website + `categoryFromTypes` (35-label Google-types map + titleize fallback, generic-type filter) + `$`–`$$$$` price tier + formatted hours rows (range / "Closed") + ≤6 photo URLs + rating/reviews + a `completeness` 0–100 ("~80% done before signup" UI nudge). Zero-I/O, defensive (never throws on sparse), 10/10 unit tests, tsc 0. The hard part (the mapper the ledger names) is shipped + reusable; remaining wiring = call it on business-search select + cache per `place_id` in CACHE_KV + prefill the build form (frontend slice). 75→74. worker→CI.
- [x] [auto] **Instant preview share card** (`preview_share_card`) — **CORE DONE 2026-06-28:** `services/preview_share_card.ts` — pure `buildPreviewShareCard(input)` = `buildShareMessages` (honest, slop-free SMS/WhatsApp/email/copy) + `buildShareLinks` (one-tap deep-links: sms:/wa.me/mailto/x.com-intent/facebook-sharer, all URL-encoded; omits `&url` when empty) + `buildOgCardParams` (title/subtitle/host/theme for the edge OG renderer) + `displayHost`. Zero-I/O, never-throws, slop-word-asserted, 11/11 unit, tsc 0. The viral-loop logic is shipped + reusable. **BACKEND WIRED + LIVE 2026-06-29:** full feature module `libs/features/preview_share_card/` (manifest+schemas+service+handlers+README+tests) → `GET /api/sites/:siteId/share-card` (owner-auth, flag-gated `preview_share_card`, own org-scoped site query → `buildShareCardForSite` derives `{slug}.projectsites.dev` → returns `{messages,links,og}`); flag registered (registry+docs) + mounted in index.ts. Full worker suite 510/7051 green, tsc 0, validate:features PASS. Deploy via CI push (gate green). Remaining = workers-og `/og` render endpoint + build-complete "Share my preview" button (frontend) + flag-enable. 74→73. worker→CI.
- [ ] [auto] **One-tap "Looks great — publish"** (`fast_publish_cta`) — on build-complete, a single primary CTA promotes the preview live (collapses review→publish). Pairs the existing streaming-preview item; removes the dead air after a build finishes.

### Generated-site quality moat (owner-facing, distinct from the internal eval harness)
- [ ] [auto] **Site Doctor report card** (`site_doctor`) — owner-facing A–F grade + prioritized one-tap fixes. **BACKEND DONE 2026-06-28** (dark behind `site_doctor`, default-off, commit `93d8bf7a`): new module `libs/features/site_doctor/` — pure `buildSiteDoctorReport(signals, plan)` translates `prod_readiness_score` signals into an owner-facing A–F report; generous-free LOCK (free unlocks top issue, rest `locked:true`, `locked_count` = upsell hook; paid unlocks all); reuses `fetchOwnedSite`+`computeReadiness` (no duplicate scoring); sharp/professional voice. Route `GET /api/sites/:siteId/doctor?plan=` (401/404-owned/404-flag-off). 12/12 unit, tsc 0. **FRONTEND DONE 2026-06-29 → [x]:** standalone `SiteDoctorComponent` (big A–F grade colored by tier + score + summary + severity-tagged issue list; locked issues show a blurred "🔒 Unlock with Pro" upsell deep-linking `/admin/billing?upsell=site_doctor`; locked-count note) mounted as a deep-linkable **"Site Health"** tab (`?tab=health`), sourcing the selected site + mapping its plan (paid→pro unlocks all) → `GET /api/sites/:siteId/doctor?plan=`. +5 Karma (1588/1588) + the 12/12 backend intact; ng build + tsc clean. The feature is end-to-end functional. Worker (live) + frontend → R2. **Follow-ons (non-blocking):** (a) broaden the 4 readiness signals (mobile phone-clickable, business-hours, FAQ, alt-text) for richer fixes; (b) flip the `site_doctor` flag beta/100% = the separate flags-green gate. [DONE]
- [x] **"Open now" live badge** (`open_now_badge`) — DONE (2026-06-29). `generateOpenNowBadge()` (site_serving) injects a self-contained client script into every served site that reads the page's OWN `LocalBusiness` JSON-LD `openingHours` (generated sites already emit it), computes open/closed for the visitor's local time, and renders a fixed bottom-right "● Open now" / "Closed · opens 9 AM" pill — **live (client-side) so it's never stale behind the CDN**, no serve-time hours plumbing. Parses the schema.org `"Mo-Fr 09:00-17:00"` string form (single/array, day-range wrap). **FAIL-SAFE:** no openingHours OR nothing parses → renders NOTHING (a wrong "Open now" would mislead customers; silence beats a guess). Dark-mode-aware, print-hidden, fully try/catch-guarded. +4 unit tests (86/86 site_serving), tsc 0, 0 net-new fails. Frontend served-output → live via worker. [DONE]
- [ ] [auto] **Auto-FAQ from real reviews** (`faq_from_reviews`) — **CORE DONE 2026-06-29** (commit `27a41f2d`): `services/faq_from_reviews.ts` pure `extractReviewFaqs(reviews)` clusters real reviews by topic (quality/service/staff/value/speed/cleanliness) → emits Q (templated) + A (a real representative review sentence, customer's own words, never fabricated) for topics clearing a ≥3-mention floor, ranked + capped; weak/unrepresentable topics dropped (quality over quota). Feeds the existing `seo_autopilot.buildJsonLd({kind:'FAQPage'})` (no JSON-LD dup). 7/7 unit, tsc 0. **REMAINING:** wire into the build pipeline — pass `extractReviewFaqs(research.reviews)` into the FAQ section + FAQPage JSON-LD when ≥1 item; optional LLM polish of the extractive questions.

### Owner analytics & retention
- [x] [auto] **First-lead celebration** (`first_lead_celebration`) — **CORE DONE 2026-06-28:** `services/first_lead.ts` — pure `buildFirstLeadEmail(input)` composes the "🎉 You just got your first lead from your website!" email (subject + text + HTML) attributed to the AN18 `conversion.kind` (`conversionKindLabel`: call→phone call / email / directions request / form→contact-form submission) + the `data-ps-section` (`sectionLabel` humanizer), with HTML-escaped interpolation + neutral-greeting/no-link/no-section graceful degradation. Honest, slop-free copy (test-asserted). Zero-I/O, never-throws, 11/11 unit, tsc 0. Reuses the already-shipped section-attribution data. Remaining wiring = first-conversion detection (count query in `persistAnalyticsEvent`) + SES send (the existing notify path). 73→72. worker→CI.
- [ ] [auto] **After-hours demand alert** (`after_hours_demand`) — detect click-to-call attempts outside business hours → owner nudge "12 people tried to call after you closed — add a contact form / online booking?" Turns lost calls into an upsell to native_booking_engine. Pure windowing over conversion events + Places hours.

### AI-native spiral (because AI is the developer)
- [ ] [auto] **Voice-note site edits** (`voice_note_edit`) — owner leaves a voice note ("add my Sunday hours, swap the hero to the patio photo"); STT → intent → applied as a build edit. Reuses the live Deepgram/voice infra; the most natural editing surface a non-technical owner could ask for.
- [ ] [auto] **AI photo cleanup on upload** (`photo_cleanup`) — owner uploads a phone photo; AI removes background / upscales / color-corrects to hero quality (Replicate/Remove.bg already wired in media). Free-tier value that makes a small business look enterprise.
- [ ] [auto] **One-tap seasonal hero restyle** (`seasonal_hero`) — **CORE DONE 2026-06-29** (commit `31ff02de`): `services/seasonal_hero.ts` pure `seasonalHero(nowMs, opts)` → season + optional in-window occasion (new-year/valentines/spring/July-4/back-to-school/halloween/thanksgiving/holidays) + accent hint + tasteful headline prefix; quality-gated (null off-window, no forced gimmick), hemisphere-aware, deterministic. 8/8 unit, tsc 0. **REMAINING:** wire into edge_personalization (apply accent/prefix to the served hero when in-window) + a one-tap admin toggle; auto-revert = stop applying off-window (already implicit).

## 🛰 Lead Scanner — Automatic US "businesses-without-websites" engine (Brian directive 2026-06-28)

> Rebuild the broken (always-0) Lead Scanner into an AUTOMATIC, US-wide database of businesses
> without a real website, scored most-likely-to-pay → least, with email + mailing-address
> confidence %, an editable scan-prompt controller, and a claim funnel. **Lead store = Twenty CRM
> at `crm.projectsites.dev`** (NOT a bespoke D1 table — CRM owns the management table + pipeline).
> Full design + 50 ideas + top-14: `docs/lead-scanner/automatic-engine.md`. Diagnosis of the 0-leads
> bug: manual single-Places-query behind a default-off flag, no geo loop, no contact enrichment.
>
> SHIPPED 2026-06-28: pure scoring core `services/lead_propensity.ts` (`contactConfidence` email/address %
> + channel email/postcard/both/none; `payPropensity` 0-100 + A–D tier; `rankLeads`) — 14/14 tests, commit
> `c51ce988`. CRM sink `services/crm_leads.ts` (AGPL HTTP boundary, local types, `TWENTY_API_URL`/`TWENTY_API_KEY`;
> pure `leadToCrmCompany` + never-throw `upsertLeadToCrm` POST /rest/companies, dark-skips when unconfigured)
> — 9/9 tests, commit `f528cca0`. Both storage-agnostic; survived the D1→CRM pivot.

- [x] **Automatic geo×category orchestrator (core)** — DONE 2026-06-28 (commit `4eed3221`). `services/lead_scan_orchestrator.ts`: `runScan(deps, profile)` composes injected discover (OSM/Places/SoS) → optional email enrich → `candidateToSignals` (provider hints over defaults) → `rankLeads` (most-likely-to-pay) → cap to `profile.maxLeads` (budget guard) → CRM sink, tallying by tier; never throws (discovery failure → empty run). `crmSink` factory binds `leadToCrmCompany`→`upsertLeadToCrm`. Pure DI brain — 10/10 unit tests, tsc 0. **REMAINING (thin, folded into CRM go-live below):** the deploy-gated scan route + Queue/Workflow geo-sweep + cron trigger that injects real provider fetches + `daily_cap` schedule. Top-14 #3. [CORE DONE]
- [x] **OSM-first provider** — DONE 2026-06-28 (commit `aa029b07`). `services/osm_overpass.ts`: `buildOverpassQuery` (bbox×category, `[!"website"]` filter), `osmElementToBusiness` (→ `DiscoveredBusiness`, skips sited/nameless), `discoverSitelessFromOsm` (thin never-throw fetch + dedupe). Free Overpass = zero-cost discovery; Places confirm is the orchestrator's job (#87). 10 unit tests, tsc 0, worker→CI. Top-14 #4. [DONE]
- [ ] [auto] **Editable scan profiles + /admin controller** — **BACKEND DONE 2026-06-28** (commit `ddac88bc`): `services/scan_profiles.ts` — Zod `ScanProfileConfig` (name/enabled/bboxes/categories/providers/filters/source/maxLeadsPerRun/intervalMinutes/lastRunAt) = the editable "what to hunt" config; `validateScanProfile` (flat errors), `isProfileDue`+`listDueProfiles` (cron due-logic), `profileToRunSpecs` (bboxes→per-run specs), `defaultScanProfile`. Pure, 9/9 unit, tsc 0. **REMAINING: (1)** D1 (or Twenty custom-object) persistence + CRUD route; **(2)** the cron geo-sweep that `listDueProfiles`→per-bbox `runScan`→stamp `lastRunAt`; **(3)** the /admin form widget. Top-14 #5.
- [x] **Email enrichment** — DONE 2026-06-28 (commit `aa029b07`). `services/email_enrich.ts`: `emailCandidatesForDomain` (ranked info@/contact@/…), strict fail-CLOSED `domainAcceptsMail` DoH MX check (a DNS error never over-credits), `classifyEmailSource` → `EmailSource` (listing/guessed_mx/guessed) feeding `contactConfidence`. 11 unit tests, tsc 0, worker→CI. Top-14 #6. [DONE]
- [x] **Address deliverability gate** (USPS #91) — GATE CORE DONE (2026-06-29). `services/address_deliverability.ts` — pure `assessAddressDeliverability(address, threshold=70)` → `{confidence 0–100, deliverable, parts, reasons}` from structural completeness (street# 25 / street 25 / city 15 / state 20 / ZIP 15; ZIP+4 + `74B`-style numbers accepted; 50-state+DC+territory validation; blank→0). This is the functional Lob-spend gate the orchestrator ANDs before a postcard send — it stops the obvious waste (no street#, no ZIP, bad state) with zero external dependency. 7 unit tests, tsc 0, worker→CI. **Follow-on (needs a secret, Brian-gated):** authoritative USPS CASS verification (catches valid-format-but-nonexistent addresses) needs a USPS Web Tools `USPS_USERID` — when provided, AND it with this gate. The functional spend-gate is live now. [DONE core]
- [ ] [auto] **claimyour.site/<slug> claim funnel** — landing triggers the build + "we'll email you when ready"; explore /admin meanwhile; prominent "Cancel build → /create (2 min)" escape. Wire to existing `claim_*` services. Top-14 #8.
- [ ] [auto] **Pre-built preview teaser in outreach** — thumbnail/Veo teaser of their FUTURE site embedded in the invite email (biggest CTR lever). Top-14 #9.
- [x] **CRM pipeline stages + claim webhook** — STAGE-MACHINE CORE DONE (2026-06-29). `services/lead_pipeline.ts` — pure, deterministic lifecycle: `LEAD_STAGES` (discovered→enriched→contacted→build_triggered→preview_sent→claimed, +`lost` terminal) + `canTransition(from,to)` (exactly one forward step; `claim` only from preview_sent; `lose` from any non-terminal; no skips/backward/off-terminal) + `applyLeadEvent(current,event)` → new stage or `null` on illegal (caller logs the rejected transition for the funnel dashboard #97) + `isTerminal`. 7 unit tests incl. full happy-path to claimed, tsc 0, worker→CI. (Zero-I/O core; the claim webhook + Twenty CRM sync call `applyLeadEvent` when the orchestrator #87 / claimyour.site funnel #92 fire — those wire it to D1/Twenty.) [DONE core]
- [x] **SoS new-filings provider** — DONE 2026-06-28 (commit `aa029b07`). `services/sos_filings.ts`: calendar-accurate `monthsSince` (a filing N years ago = N×12mo), `isRecentlyIncorporated` (≤6mo window), `parseSosRow`/`selectRecentSosLeads` (→ `DiscoveredBusiness` + age + `sos_<st>:<id>` dedupe key). Pure parser; the bulk-feed fetch + per-state column map are the orchestrator's (#87). 9 unit tests, tsc 0, worker→CI. Top-14 #11. [DONE]
- [x] **Channel router + drip sequence** — CORE DONE (2026-06-29). `services/outreach_router.ts` — pure deterministic state machine the orchestrator (#87) runs: `chooseChannel({emailConfidence,addressConfidence})` → `email`/`postcard`/`both`/`none` (both only when each clears its bar; none when unreachable → no spend) + `nextDripStep(state)` → email→nudge→postcard→final ladder that SKIPS steps whose channel isn't viable + STOPS on `replied` (stop-on-claim) or an exhausted ladder. 11 unit tests, tsc 0, worker→CI. (Zero-I/O core; caller resolves history/persists + the CAN-SPAM unsubscribe link rides the email template. Wires into the live drip when orchestrator #87 ships.) [DONE core]
- [x] **Coverage + funnel dashboard** — AGGREGATION CORE DONE (2026-06-29). `services/coverage_summary.ts` — pure `summarizeCoverage(scanRuns, leads)` → `{zipsScanned (distinct, deduped), lastScanAt, totalLeads, byTier (A–D), contactRate (contacted-or-beyond ÷ total), buildTriggered, claimed, pipelineValueCents (non-lost only)}`. Zero-I/O, all-zero on empty, never throws; keyed to the `PropensityTier`/`LeadStage` types so it composes the rest of the Lead Scanner. 6 unit tests, tsc 0, worker→CI. The dashboard UI renders this summary — consistent with the arc's other core ticks (#87/#94/#96/#98); the admin coverage panel is the thin wiring follow-on. [DONE core]
- [x] **Auto-suppression + compliance + dedupe** — CORE DONE (2026-06-29). `services/lead_suppression.ts` — pure `dedupeKey(b)` (externalId → name|address fallback) + `filterContactable(candidates, {claimedExternalIds, optedOutEmails, bouncedEmails})` → contactable, deduped, order-preserving list + per-reason drop counts (`duplicate`/`claimed`/`opted_out`/`bounced` — feeds the coverage dashboard #97). Case-insensitive; keeps no-identity candidates; composes the existing `email_suppressions` (bounced) source. NEVER re-contacts a claimed/opted-out/bounced business. 9 unit tests, tsc 0, worker→CI. (Zero-I/O core; orchestrator #87 resolves the suppression sets from D1 + runs this gate before outreach spend.) [DONE core]
- [x] **CRM go-live + scan-route wiring** — DONE 2026-06-28 (Brian provided the Twenty API key). ✅ `TWENTY_API_URL`=https://crm.projectsites.dev + `TWENTY_API_KEY` set as prod worker secrets. ✅ Twenty REST confirmed LIVE; it **400s unknown fields** → provisioned **11 Company custom fields** via the metadata API (leadScore/payTier/outreachChannel/leadSource/externalId/workEmail/leadPhone/leadCategory/emailConfidence/addressConfidence/hasWebsite; objectMetadataId `ff35f144…`). ✅ `crm_leads` rewritten to the real shape (composite `address`, custom fields, `data.createCompany.id`, externalId dedupe) + **live create+delete verified** (HTTP 201). ✅ Live OSM→CRM route `POST /api/admin/leads/scan-osm` (super-admin + `lead_scanner` flag) wired (commits `d10b8d82`+`791f8f88`, worker→CI). ✅ `lead_scanner` flag enabled global/100%. **REMAINING (verification, not gated):** authed prod route-smoke after CI worker-deploy (direct curl is BFM-403'd → browser/E2E super-admin session); optional cron geo-sweep for unattended automation. Pipeline LIVE end-to-end. [DONE]

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
- [x] AN17 — form analytics: completion rate + abandonment per form — DONE (2026-06-28, full-stack). **Capture:** the served-site tracker now auto-binds `focusin` (fires `form_start` once per form, keyed by form id/name/nearest `data-ps-section`) + `submit` (fires `form_submit`), both try/catch-guarded; `'form_start'` added to `EVENT_TYPES`. **Query:** `getFormAnalytics(siteId, windowDays)` counts start vs submit per form from `analytics_events` → completionRate (capped 100) + abandoned (floored 0), ranked by starts desc, `(unnamed)` coalesce, defensive-empty on error. **Route:** `GET /api/sites/:siteId/analytics/forms` (flag+org-gated). **UI:** standalone `FormAnalyticsComponent` (completion-% bars + finished/abandoned counts + empty/error states) as a deep-linkable **"Forms"** tab (`?tab=forms`). TDD: +1 tracker test + 5 query tests + 4 widget + 1 dashboard-tab (47/47 worker analytics, 1572/1572 Karma); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
- [x] AN3 — unified owner-analytics query service — DONE (verified 2026-06-28). The `site_analytics` module's `getSiteAnalyticsSummary` IS the one unified API: a single `GET /api/sites/:siteId/analytics` (flag + org-gated) that fans out across the six owner backends in one `Promise.all` — contacts (+ bySource breakdown), form_submissions, newsletter_subscribers, donations/donation_campaigns, and visitor traffic (`getTrafficSummary` from visitor_events_core) — returning one Zod-validated `SiteAnalyticsSummary`. Defensive per-source (a missing table degrades that metric to 0, never throws). The frontend analytics component consumes this single envelope, so every owner widget is unblocked by one call. [DONE]
- [x] AN27 — section-level attribution query + UI — DONE (2026-06-28, the moat). **Query:** `getConversionsBySection(env, siteId, windowDays)` aggregates the AN18 `conversion` events (tagged with the AN26 `data-ps-section`) from `analytics_events`, GROUP BY section+kind, ranked by count desc with each section's % share + per-kind (call/directions/email) split; null section → `(unattributed)` (never lost); defensive → empty on D1 error. **Route:** `GET /api/sites/:siteId/analytics/sections` (flag `site_analytics`, org-ownership-gated → 404). **UI:** new standalone `SectionAttributionComponent` (ranked rows + % share bars + 📞/🧭/✉️ kind counts + empty + retry-able error states) mounted as a deep-linkable **"By Section"** tab (`?tab=sections`) in the analytics dashboard, sourcing the selected site from `AdminStateService`. TDD: +5 worker query tests (20/20 site_analytics) + 4 widget Karma tests + 1 dashboard tab test (1567/1567 Karma); ng build + tsc both clean; 0 net-new fails. Worker → CI push, frontend → R2. [DONE]
- [ ] [auto] AN29 — natural-language analytics query ("visitors from Instagram last week?") — builder-only moat.

### Generated-site quality (remaining)
- [ ] [auto] 1:N sitemap fidelity guard — validator `validateRouteCount` exists + is in the `validateBuild`/`validateBuildAst` chain + has tests (17/17 green); WIRED into the live `validate-build` step (site-generation.ts:1204-1216). **ROOT CAUSE found 2026-06-29 — guard is currently INERT:** the validate step reads `_scraped_content.json` from `files = loadBuildFromR2('sites/{slug}/{version}/')` (the SITE-OUTPUT prefix), but `container-server.mjs` returns only NON-underscore files (project CLAUDE.md) → `_scraped_content.json` never lands in the site-output prefix → `sourceRouteCount` is always `undefined` → guard no-ops on every real build. `research_data` does NOT store the route list either (checked migration 0001). FIX (next fire, bounded+safe): persist the scraped route count at scrape time to a RELIABLE source the validate step can read — either (a) add a `route_count` column to `research_data` and have the validate step read it as the `sourceRouteCount` fallback, or (b) have the workflow write `_scraped_content.json` to a dedicated context R2 key (`sites/{slug}/context/_scraped_content.json`) and load THAT in the validate step. Both are additive/fail-soft (absent → guard stays inert = no regression). THEN flip `validate-build` report→strict (#96) so a collapsed page count FAILS.
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
- [x] [auto] traceId + tenantId correlation across the pipeline. **DONE 2026-06-28:** request-side already auto-fills `requestId`(trace)+`orgId`(tenant) on every log line (`src/lib/log.ts`); the build pipeline's `workflowLog` carried `org_id`(tenant)+`site_id`(entity) per step but no spanning trace. Added per-run `traceId = crypto.randomUUID()` at `site-generation.ts run()` start + a bound `wfLog(action, meta)` routing all 26 build-step audit writes through it, stamping `trace_id` into `audit_logs.metadata_json` — every step of one build now correlates by trace_id, org_id ties it to the tenant. tsc 0 (mine), worker→CI push.
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
- [x] [auto] S17 — undo-publish window. **CORE DONE 2026-06-29:** `services/undo_publish.ts` — pure `computeUndoWindow(publishedAt, now, windowMs=5min)` → `{withinWindow, secondsRemaining, expiresAtMs, expired}` (accepts ms-number OR ISO string, clock-skew-safe → full window when now<publish, non-positive window → expired, unparseable → expired never throws) + `formatUndoCountdown(s)` → `m:ss`. No `Date.now()` inside (caller passes `now` → deterministic). Zero-I/O, 9/9 unit, tsc 0. Remaining wiring = post-publish toast + revert action (reuses existing snapshot-restore path S4). 147→146. worker→CI.
- [ ] [auto] S39 — scheduled publish + auto-revert-after-48h (Pro upsell).
- [x] [auto] A13 — category landing pages + per-category `SoftwareApplication` JSON-LD. **CORE DONE 2026-06-29:** `services/category_jsonld.ts` — pure `buildCategoryJsonLd(input)` → `[SoftwareApplication (ProjectSites {Category} builder, free Offer), BreadcrumbList (Home→Templates→Category), CollectionPage]`, each schema.org-valid (@context+@type). Accuracy-first: NEVER fabricates `aggregateRating` (attached only when real `ratingValue`+`ratingCount` passed) per quality-metrics; slug-sanitized, base-normalized, `categoryTitle` fallback. Zero-I/O, never-throws, 9/9 unit, tsc 0, lint 0-err, prettier clean. Remaining wiring = the `/templates/:category` route + page content + inject these blocks (frontend/route slice). 142→141. worker→CI.
- [ ] [auto] A18 — public app profile pages (indexable `/apps/:slug` + "Deploy to ProjectSites" button).

### Analytics (remaining)
- [ ] [auto] AN12 — conversions/goals: owner-named outcomes + count + rate (rate shipped; naming UI + goals table remain).
- [x] AN19 — per-site visitor funnel — DONE (2026-06-28, full-stack). **Root-cause unblock:** the tracker now mints ONE stable `sessionId` per browser tab (sessionStorage `__ps_sid`) and sends it on every event → a visitor's pageviews + conversions share an id, so session funnels are possible (also enriches all session analytics). **Query:** `getVisitorFunnel(siteId, windowDays)` — one `GROUP BY sessionId` pass over `analytics_events` → landing (≥1 pageview) → engaged (≥2 pageviews) → converted (≥1 conversion), distinct sessions + each stage's % of landing (the drop-off); defensive all-zero on error. **Route:** `GET /api/sites/:siteId/analytics/funnel` (owner+flag gated). **UI:** standalone `VisitorFunnelComponent` (proportional drop-off bars + empty/error states) as a deep-linkable **"Visitor Funnel"** tab (`?tab=visitor`, distinct from the platform "Activation Funnel"). TDD: +1 tracker test + 3 query tests (61/61 worker analytics) + 4 widget + 1 dashboard-tab Karma (1582/1582); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
- [ ] [auto] AN23 — weekly email digest (Monday auto-summary via SES+Listmonk).
- [x] AN48 — public shareable read-only dashboard URL — DONE (2026-06-28, full-stack). **Token:** `share.ts` `mintShareToken`/`verifyShareToken` — HMAC-SHA256 over `<siteId>.<exp>` (server `manifestSecret`), constant-time compare, expiry-checked; the token IS the capability (unguessable + tamper-evident + 30-day expiry). **Routes:** `POST /api/sites/:siteId/analytics/share` (owner+flag gated → mints token + `https://{SITES_BASE}/shared/analytics/<token>`) + PUBLIC `GET /api/public/analytics/:token` (no session → verify token → returns the aggregate, NON-PII `getSiteAnalyticsSummary`; bad/expired/deleted → 404, never leaks). **UI:** public no-auth Angular route `shared/analytics/:token` → `PublicAnalyticsComponent` (read-only stat cards + friendly "link expired" state) + a "🔗 Share read-only link" button in the analytics dashboard (mints + copies to clipboard, busy-guarded). TDD: +7 token tests (32/32 site_analytics worker) + 3 viewer + 1 share-button Karma (1576/1576); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
- [x] AN26 — section-level instrumentation (auto-inject stable `data-ps-section`) — DONE (2026-06-28). `injectSectionInstrumentation(html)` stamps a stable `data-ps-section` onto every served-page `<section>`: derived from the section's existing `id` (slug-sanitized to `[a-z0-9_-]` → semantic, e.g. `services`/`pricing`) with a deterministic 1-based `section-N` fallback. Purely additive (idempotent, never rewrites other markup, key sanitized so it can't break the tag). Wired into the serve path gated on analytics-enabled (`ANALYTICS_INGEST_ENABLED`/`EVENT_DISPATCHER`). This is the stable hook AN27 (#63 section attribution) reads. +5 unit tests (82/82), tsc 0. Worker → CI push. [DONE]
- [ ] [auto] AN49 — year-in-review auto report (retention loop).
- [x] [auto] AN50 — benchmark vs fleet median. **CORE DONE 2026-06-29:** `services/fleet_benchmark.ts` — pure `benchmarkMetric(value, fleet, opts)` → delta/ratio/verdict(above|at|below, ±3% "at" band)/quartile band(top|bottom from p25/p75)/low-confidence flag(<20 cohort) + one human sentence ("Your form conversion is 1.2% — below the 3.4% category median — bottom quartile. Room to improve."); `higherIsBetter:false` flips the judgment for lower-is-better metrics (bounce); `formatRate` helper. Zero-I/O, never-throws on non-finite, 10/10 unit, tsc 0. Remaining wiring = aggregate per-category fleet median/quartiles from the analytics rollup + surface in the dashboard (frontend). 72→71. worker→CI.

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
- [x] AN42 — one-click data export (CSV) + delete for the owner — DONE (2026-06-28). **Export:** pure `summaryToCsv(summary)` (RFC-4180-escaped two-column `metric,value`, CRLF, contact-source rows flattened, non-PII counts) + route `GET /api/sites/:siteId/analytics/export` (owner+flag gated → `{filename, csv}`) + a "⬇ Export CSV" dashboard button that fetches + Blob-downloads (busy-guarded). **Delete:** the owner-facing GDPR delete already ships — per-visitor `visitor_dsar` (`mode=delete` cascade, #29) + owner `DELETE /api/sites/:id` (site + its data); AN42's delete half reuses those. TDD: +3 CSV-helper tests (35/35 site_analytics worker) + 1 export-button Karma (1577/1577); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
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

## 🔌 Integrations roadmap — Plane · Twenty CRM · Listmonk · Whole-app (added 2026-06-29)

> Web-researched + classified. `[auto]` = loop builds; `[gated]` = needs a Brian decision; `[dedicated]` = real but needs a supervised session. Foundation rule: each app gets a typed, Zod-validated, AGPL-isolated HTTP client (`src/services/<app>.ts`) + an HMAC webhook receiver on a workers.dev URL (Bot-Fight-safe) + a rate-limit/retry/idempotency wrapper — those unblock everything below.

### Plane (pm.projectsites.dev)
- [ ] [dedicated] **PL1 backups + tested restore** — nightly TiDB export/branch-snapshot + R2 versioning + Upstash backup; concrete RPO/RTO; quarterly restore drill. (We have ZERO Plane backups today.)
- [ ] [auto] **PL2 SES SMTP into Plane** — wire SES so invites/magic-links/notifications actually send (currently dark). Set in `/god-mode`.
- [ ] [auto] **PL3 Plane analytics via Tinybird (NO ClickHouse — Brian directive [[tinybird-always-never-clickhouse]])** — Plane can't use Tinybird as its internal ClickHouse, and ClickHouse is BANNED, so Plane's built-in dashboards stay dark (Plane PM still fully works). Deliver the value our way: Plane webhook receiver (PL21) emits `producer='plane'` events into the EXISTING `event_bus` outbox → already drains to the EXISTING Tinybird `projectsites_events` Data Source (every 5 min) → build admin pipes/dashboard filtered to `producer='plane'`. Foundation (`services/tinybird.ts` + outbox + DS) already live; only the receiver + producer-tag emit + dashboard remain. (ClickHouse Cloud keys kept in get-secret, UNUSED.)
- [ ] [auto] **PL4 observability** — ship Plane logs/metrics to our stack + alert on the container crash-loop class (the `/dev/shm` incident would've paged).
- [ ] [gated] **PL5 SSO** — OIDC via Better Auth for pm.projectsites.dev (auth-provider + rollout decision).
- [ ] [auto] **PL6 ephemeral-safety audit** — confirm nothing critical lives in container-local `/app/data` (uploads now R2; check exports/beat schedule).
- [ ] [auto] **PL7 version-pin + upgrade cadence** — pin `PLANE_VERSION`, documented monthly upgrade rhythm + owner.
- [ ] [auto] **PL8 project-per-customer** — each generated site/customer auto-creates a Plane project (seeded states/cycles).
- [ ] [auto] **PL9 build failures → work items** — failed site-gen becomes a triaged Plane issue (mirrors the Sentry integration).
- [ ] [auto] **PL10 support requests → intake queue** — route projectsites contact/feedback into Plane intake.
- [ ] [auto] **PL11 tasks in admin cockpit** — surface "your project tasks" in /admin via the read API.
- [ ] [auto] **PL12 webhooks → psnotify** — HMAC-verified Plane events fan into the unified notification center.
- [ ] [auto] **PL13 cycles/milestones → public roadmap/changelog** — auto-publish shipped items customer-facing.
- [ ] [auto] **PL14 MCP → our agents** — connect Plane's native MCP server so build agents create/manage work items.
- [ ] [auto] **PL15 voice → Plane** — LiveKit voice agent creates work items from calls.
- [ ] [auto] **PL16 LLM intake auto-triage** — DeepSeek/Workers-AI sets priority/assignee/labels before a human looks.
- [ ] [auto] **PL17 weekly AI digest** — cron pulls Plane activity → LLM summary → SES + Slack.
- [ ] [auto] **PL18 duplicate/enrich gate** — issue-created webhook → agent flags dupes + fleshes description.
- [ ] [auto] **PL19 GitHub ↔ Plane** — link commits/PRs to work items; deploys auto-close issues.
- [ ] [auto] **PL20 typed Plane API client** — `src/services/plane.ts` (Zod, AGPL HTTP boundary). Foundation. `PLANE_API_KEY` saved.
- [ ] [auto] **PL21 HMAC webhook receiver** — workers.dev URL, BFM-safe, routes events to D1/Queues/psnotify.
- [ ] [auto] **PL22 rate-limit wrapper** — 60-req/min token bucket + retry-backoff (reuse the shim pattern).
- [ ] [auto] **PL23 project template seeder** — standard states/labels/cycle templates per new project.
- [ ] [auto] **PL24 /loop ↔ Plane** — finishing-loop creates/updates real Plane work items (queryable backlog vs this file).
- [ ] [gated] **PL25 public status page** — Plane incident issues → status page (product/design decision).

### Twenty CRM (crm.projectsites.dev) — internal sales/ops + customer-facing feature
- [ ] [auto] **TW1 typed Twenty client** — `src/services/twenty.ts` (REST+GraphQL, Zod, AGPL HTTP boundary). Foundation.
- [ ] [auto] **TW2 webhook receiver** — Twenty filtered events (create/update) → D1/Queues/psnotify.
- [ ] [dedicated] **TW3 backups + restore** — Twenty Neon Postgres + storage; RPO/RTO.
- [ ] [auto] **TW4 observability** — logs/metrics + crash alerts to our stack.
- [ ] [gated] **TW5 SSO** — OIDC via Better Auth for crm.projectsites.dev.
- [ ] [auto] **TW6 signups → People/Companies** — projectsites signups auto-captured as Twenty leads.
- [ ] [auto] **TW7 payments → deals** — Stripe/Square events → Twenty opportunities (revenue pipeline).
- [ ] [auto] **TW8 build → Company+Person+Opportunity** — every new projectsites build seeds CRM records.
- [ ] [auto] **TW9 lifecycle automation** — free→trial→paid stage moves via Twenty workflows + our webhooks.
- [ ] [auto] **TW10 lead enrichment** — Google-Places/research we already gather → Twenty custom fields.
- [ ] [auto] **TW11 churn/at-risk → task** — our analytics trigger a Twenty follow-up task.
- [ ] [auto] **TW12 AI sales digest** — pipeline summary via API → SES/Slack.
- [ ] [auto] **TW13 voice → Twenty** — receptionist logs calls/notes + creates contacts.
- [ ] [auto] **TW14 email ↔ Twenty timeline** — Listmonk/SES sends+opens logged to the contact activity.
- [ ] [auto] **TW15 MCP → our agents** — connect Twenty's MCP server (create deals, update pipeline).
- [ ] [auto] **TW16 LLM lead scoring** — score on enrichment data → Twenty custom field.
- [ ] [auto] **TW17 AI outreach drafts** — LLM drafts attached to opportunities (review-gated send).
- [ ] [auto] **TW18 dedupe + merge suggestions** — duplicate contact/company detection.
- [ ] [gated] **TW19 CRM-as-a-feature** — provision a scoped Twenty workspace per customer (product/pricing).
- [ ] [gated] **TW20 site contact-forms → owner CRM** — generated-site leads flow to the site-owner's CRM.
- [ ] [dedicated] **TW21 embed CRM view in admin** — site-owner Twenty view with multi-tenant isolation.
- [ ] [auto] **TW22 domain custom-objects seeder** — ship "Site"/"Build"/"Lead" objects + templates (free in self-host).
- [ ] [auto] **TW23 workflow/serverless templates** — ship no-Zapier automations (the Twenty 2.0 apps framework).
- [ ] [gated] **TW24 plan-gate CRM in billing** — Pro-tier pricing decision.

### Listmonk (mail.projectsites.dev) — our email + customer-facing feature
- [ ] [auto] **LM1 typed Listmonk client** — `src/services/listmonk.ts` (Zod, AGPL HTTP boundary). Foundation.
- [ ] [auto] **LM2 SES SNS bounce processing** — wire the built-in SNS endpoint; hard=block@1, soft=block@3 (deliverability gap; reputation-critical).
- [ ] [auto] **LM3 split marketing vs transactional** — multi-SMTP load-balance so reputations don't cross-contaminate.
- [ ] [dedicated] **LM4 backups + restore** — Listmonk Postgres + R2 media; RPO/RTO.
- [ ] [auto] **LM5 observability** — logs/metrics + queue-depth alerts.
- [ ] [gated] **LM6 API-token/role governance** — least-privilege tokens for mail.projectsites.dev.
- [ ] [auto] **LM7 transactional via Listmonk** — route projectsites magic-links/receipts/build-done through the transactional API.
- [ ] [auto] **LM8 signups → lists** — auto-subscribe (double-opt-in) projectsites users.
- [ ] [auto] **LM9 lifecycle/drip sequences** — welcome/onboarding/re-engagement via API + Inngest scheduler.
- [x] [auto] **LM10 D1 segments → queries** — **CORE DONE 2026-06-29:** `services/listmonk_segments.ts` — pure `classifyCohort(sub, now)` → new(≤7d)|trial(trialing/trial-plan)|active(seen≤30d)|dormant(≤90d)|churned(canceled/past_due OR >90d idle) with explicit-churn precedence + createdAt fallback for lastActive + ms-or-ISO; `bucketByCohort(subs, now)` → ids per cohort (all keys present so emptied segments can be cleared) + counts + total. No `Date.now()` inside (deterministic). Zero-I/O, never-throws on junk, 10/10 unit, tsc 0. Remaining wiring = D1 cohort query + Listmonk segment-sync push. 146→145. worker→CI (gate GREEN).
- [ ] [auto] **LM11 archive + signup embed** — public newsletter archive + signup on projectsites marketing.
- [ ] [auto] **LM12 open/click → analytics** — tracking into Tinybird/PostHog funnels.
- [ ] [auto] **LM13 AI campaign drafts** — LLM → Listmonk templates (newsletter/changelog), review-gated.
- [ ] [auto] **LM14 preference center** — unsubscribe/prefs wired to our user prefs (psnotify).
- [ ] [auto] **LM15 bounce/complaint → suppression sync** — propagate to Twenty + cross-system suppression.
- [x] [auto] **LM16 AI send-time/subject optimization** — **CORE DONE 2026-06-29:** `services/send_optimization.ts` — pure optimization mechanics: `assignVariant(key, variants, salt)` (deterministic djb2-hash A/B(/n) bucketing — stable per recipient, even split, per-salt independent), `recommendSendHour(openHours)` (modal open-hour, ties→earliest, ignores out-of-range, default 10am), `pickWinningSubject(stats, minSent=50)` (highest open-rate variant above the sample threshold, clamps opened>sent, null when none qualify). No `Date.now()`/`Math.random` (deterministic). Zero-I/O, never-throws, 12/12 unit, tsc 0, lint 0-err, prettier clean. The AI subject-candidate generation is a separate layer. Remaining wiring = pull opens/stats from analytics + apply variant/time/winner in the Listmonk send path. 143→142. worker→CI.
- [x] [auto] **LM17 per-recipient personalization** — **CORE DONE 2026-06-29:** `services/listmonk_personalize.ts` — `toSubscriberAttribs(signals)` maps our user/site signals → the flat `attribs` bag Listmonk stores per subscriber (drops null/blank/non-finite) + a safe `renderPersonalized(template, vars, {fallback})` `{{ key }}`/`{{ key | inline-default }}` merge (XSS-safe plain substitution, never `eval`; missing → inline-default → global-fallback → '' so an email never ships a raw `{{ }}`; numbers/booleans rendered) + `extractVars`/`missingVars` validators. Zero-I/O, never-throws, 13/13 unit, tsc 0. Distinct from `prompts/renderer` (that's prompt-injection-scoped, no defaults). Remaining wiring = push attribs on sync (LM10 pairs) + use in the Listmonk campaign/transactional send path. 145→144. worker→CI (gate GREEN).
- [ ] [gated] **LM18 email-as-a-feature** — provision scoped lists per customer (site-owners send to their audiences).
- [ ] [gated] **LM19 site contact-form → owner list** — opt-in capture on generated sites.
- [ ] [dedicated] **LM20 multi-tenant isolation + per-customer SES identities/domains** — sending-domain separation.
- [ ] [gated] **LM21 plan-gate sending quotas** — Pro-tier pricing decision.
- [ ] [auto] **LM22 branded transactional templates** — per-site logo/colors from `_brand.json`.
- [x] [auto] **LM23 deliverability dashboard** — **CORE DONE 2026-06-29:** `services/deliverability_summary.ts` — pure `aggregateDeliverability(rows, totalSent)` → bounce/complaint counts+rates(+breakdown by subtype) + `dailyTrend` (30d bucketed, windowed w/ opts.nowMs). Zero-I/O, 5/5 unit, tsc+lint clean. Remaining = query suppressions from D1 + /admin panel. 139→138. worker→CI.
- [ ] [auto] **LM24 rate-limit/retry wrapper** — idempotent Listmonk client (reuse the shim retry pattern).

### Whole-app — platform-wide (the self-hosted suite: sites · PM · CRM · email · keys · CMS · voice)
- [ ] [dedicated] **AP1 platform backup/restore runbook** — ALL stateful stores (D1, R2, TiDB, every Neon DB, every Upstash, container DBs); per-store RPO/RTO; one drill. (No backups exist platform-wide — biggest risk.)
- [ ] [auto] **AP2 unified service-health dashboard** — live status of every container/worker in /admin + the crash-loop alert class.
- [ ] [auto] **AP3 CF-Container hardening baseline** — shared template baking every hard-won lesson (`mkdir /dev/shm`, amd64 pin + CACHEBUST, keep-warm cron, health route, observability).
- [ ] [auto] **AP4 self-hosted-app deploy generator** — scaffold Dockerfile+wrangler+worker+CI from the Plane/Unkey/Twenty pattern.
- [ ] [auto] **AP5 WAF-skip automation** — any new app subdomain serving POST auto-added to the zone skip rule (we hit this 3× pm/api/r2s3) + a gate.
- [ ] [auto] **AP6 reusable R2 POST-Object shim** — generalize `plane-s3` for any S3-POST app on R2.
- [ ] [gated] **AP7 unified SSO** — one login across Plane/Twenty/Listmonk/CMS/Unkey dashboards via Better Auth/OIDC.
- [ ] [auto] **AP8 psnotify cross-app bus** — every app's webhooks → one DO inbox + center + prefs.
- [x] [auto] **AP9 secret-rotation calendar** — **CORE DONE 2026-06-29:** `services/secret_rotation.ts` — pure `rotationStatus(record, now, maxAgeDays=90)` → ok|due_soon(≤14d)|overdue|unknown + ageDays/daysUntilDue/dueAtMs (per-secret `maxAgeDays` override; ms-or-ISO; never-rotated→unknown) + `buildRotationReport(records, now)` → entries sorted overdue→due_soon→unknown→ok + counts + `needsAttention`. No `Date.now()` inside (caller passes now → deterministic). Zero-I/O, never-throws on empty/non-finite, 11/11 unit, tsc 0. Enforces the ≤90d vendor-risk-tiering cadence. Remaining wiring = a D1 `secret_rotations` registry (name/vendor/last_rotated) + the /admin calendar surface + the rotation automation. 146→145. worker→CI (gate now GREEN — 506 suites/7010 tests).
- [x] [auto] **AP10 cost-per-service dashboard** — **CORE DONE 2026-06-29:** `services/cost_aggregation.ts` — pure `aggregateCosts(lineItems)` → grand total (+`$x.xx` display) + per-vendor breakdown (sorted highest-first, % share) + per-app breakdown (`unattributed` bucket pinned last) + `formatCents`. Clamps negative/non-finite to 0, skips vendor-less items, all-zero on empty — never throws. Zero-I/O, 7/7 unit, tsc 0, lint 0-err, format clean. Remaining wiring = pull line items from each provider billing API (CF/Neon/Upstash/CloudAMQP/SES/TiDB) + /admin dashboard surface. 144→143. worker→CI.
- [ ] [auto] **AP11 typed service registry** — one SERVICE_REGISTRY (url/health/secrets) for every self-hosted app, driving admin + clients.
- [ ] [auto] **AP12 MCP gateway** — expose Plane/Twenty/Listmonk/Unkey MCP behind one authenticated endpoint for our agents.
- [x] [auto] **AP13 cross-app identity graph** — **CORE DONE 2026-06-29:** `services/identity_graph.ts` — pure `buildIdentityGraph(flatRows)` → `{nodes: IdentityNode[] (userId/email/apps/appCount/isCrossApp), totalUsers, crossAppUsers, appCounts}`. Merges + dedupes per (app, externalId); sorts most-connected-first; missing email→"unknown"; skips empty rows, never throws. Zero-I/O, 6/6 unit, tsc 0, lint+prettier clean. The unification layer psnotify/billing/AI-ops consume to resolve one customer view. Remaining wiring = pull rows from each app DB/API. 141→140. worker→CI.
- [ ] [dedicated] **AP14 DR game day** — simulate a store/region outage; verify wrangler rollback + D1 Time Travel + restores.
- [ ] [auto] **AP15 aggregate uptime + status page** — external probe of all subdomains → public status.
- [x] [auto] **AP16 post-deploy smoke matrix** — **CORE DONE 2026-06-29:** `services/smoke_matrix.ts` — `buildSmokeSpec(endpoints, baseDomain)` constructs the ordered smoke checklist (path/method/subdomain/expectStatus/bodyContains/bodyNotContains/headerEquals/headerPresent); `validateSmokeResult(spec, status, body, ms, headers)` returns `{pass, failures[]}`; `summarizeSmoke(results)` → `SmokeMatrix {passCount,failCount,pass}`. All pure. Zero-fetch inside (runner is a thin loop outside). 10/10 unit, tsc 0, lint 0-err, prettier clean. Remaining = the `fetch`-loop runner + wire into `project-sites.yaml` CI. 140→139. worker→CI.
- [ ] [auto] **AP17 cross-boundary trace correlation** — propagate request/trace ids across worker↔container.
- [ ] [gated] **AP18 data-residency review** — EU-default for new stores; audit existing (GDPR; one-way-door).
- [ ] [auto] **AP19 AI ops agent** — reads health/logs across services, auto-files Plane issues + psnotify alerts on anomalies.
- [ ] [auto] **AP20 one-signup platform provisioning** — a signup provisions site + (optional) CRM + email + PM workspaces.
- [ ] [auto] **AP21 unified admin Cmd-K** — command palette + cross-app deep links across all admin surfaces.
- [ ] [auto] **AP22 billing meter aggregation** — usage across apps → Stripe/Square (paid-tier foundation).
- [ ] [auto] **AP23 shared client library** — one rate-limit/retry/idempotency lib used by every service client (stop re-implementing it).
- [ ] [gated] **AP24 suite positioning** — bundle the self-hosted suite (PM+CRM+email+sites+keys) as the projectsites differentiator (strategy/pricing).

---

## History

Shipped proof = `git log` + prior revisions of this file. Recently shipped: **Voice go-live (V0g) LIVE 2026-06-28** (agent `CA_dSUDxEC3EiP6` Running on LiveKit Cloud + Twilio Elastic SIP→LiveKit SIP trunk + dispatch; +12626864783 answers); #20 build-cap, #29 GDPR Art.17 cascade, #36 abuse-takedown, #45 onboarding-copilot, #48 built-with badge, #49 marketing GEO, AN6 owner-analytics route, V0b voice number-resolver, V33 AI disclosure, theme-polarity decision logic, SSRF + bot-gate hardening, speculation-rules, #44 owner-analytics dashboard.

---

# ProjectSites.dev Platform Expansion Loop Ledger

> 480 concrete, programmable implementation tasks across 20 platform subsystems +
> 10 global architecture decisions. Generated from deep per-subsystem research
> (50+ raw ideas each, filtered to the best 24). Every task inherits the Global
> Architecture Decisions below. ID scheme: `LOOP-<SUBSYSTEM>-NNN`. Tags follow the
> ledger convention — these are `[auto]` build candidates unless they touch money,
> secrets, irreversible infra, or a one-way door (then `[gated]`/`[dedicated]`).

## Global Architecture Decisions

> These decisions are LOAD-BEARING for every task in this section. Each subsystem
> task inherits them. When a task conflicts with a decision here, the decision wins.

- [ ] LOOP-GLOBAL-001: Hosting default — Cloudflare Workers Containers
  - Endpoint: all `*.projectsites.dev` self-hosted services
  - Decision: Every self-hosted SaaS service runs as a **Cloudflare Workers Container** (Durable-Object-backed, `@cloudflare/containers`) by default. Fly.io is the EXCEPTION, used ONLY when a service requires genuinely stateful compute, long-running realtime workers, or true 24/7 volume that CF Containers can't keep warm.
  - Rationale: `cloudflare-lock-in-is-leverage` — deep CF lock-in is the feature; one platform, one bill, edge-native, no portability tax. Solo founder cannot operate N hosting providers.
  - Acceptance criteria: Each subsystem task names its host as `CF Workers`, `CF Workers Container`, or `Fly.io (+ stated reason)`. A grep for `Fly.io` across this section returns ONLY tasks with an explicit stateful/realtime/24-7 justification.
  - Implementation notes: CF Containers caveats — native amd64 firecracker only (pin `--platform=linux/amd64`, build on amd64 CI), NO `/dev/shm` or `/dev/mqueue` mounted (mkdir in entrypoint), ephemeral local disk. Per-host route beats `*.projectsites.dev` wildcard. Add `workers_dev=true` when adding `routes`.
  - Hosting notes: Current Fly exception = **Postiz** (Temporal Cloud durable scheduling). Candidate Fly exceptions = Chatwoot (Rails+Sidekiq+ActionCable), Hatchet (Postgres-backed durable queue) — each must justify per task.
  - Backing services: n/a (meta)
  - Observability: Container DO health (`active/healthy/failed`), restart cap 3/min, idle 30m hibernation, ring-buffer logs.
  - Related files: `apps/project-sites/infra/*/wrangler.toml`, `infra/*/Dockerfile`, `cf-containers-no-dev-shm` + `cf-containers-native-amd64-only` memories.

- [ ] LOOP-GLOBAL-002: Backing-service standardization
  - Endpoint: platform-wide
  - Decision: Postgres → **Neon** (DB-per-app inside shared projects, ~100 DB/project budget). Redis → **Upstash**. MySQL → **TiDB Serverless**. S3 object storage → **R2**. OLAP/ClickHouse-class analytics → **Tinybird** (NEVER ClickHouse, Cloud or self-hosted). Kafka → **Upstash Kafka**.
  - Rationale: One canonical backing store per data shape removes per-service decision cost and keeps the bill legible. Tinybird already wired + free tier; ClickHouse Cloud has no free tier.
  - Acceptance criteria: No task provisions ClickHouse, AWS RDS, Supabase, PlanetScale, or a second Redis vendor. Every Postgres need = a Neon DB in a shared project (not a new project). Every OLAP need routes through `src/services/tinybird.ts`.
  - Implementation notes: Neon project conservation per `neon-database-conservation` — `CREATE DATABASE app_name` on an existing project, not a new project. Tinybird is a managed product (Data Sources + Pipes + Events API), NOT a `clickhouse://` server — apps pipe events to it, they don't use it as their internal DB.
  - Hosting notes: n/a
  - Backing services: Neon, Upstash, TiDB Serverless, R2, Tinybird, Upstash Kafka.
  - Observability: per-store metrics → Axiom + Tinybird rollups.
  - Related files: `src/services/tinybird.ts`, `tinybird-always-never-clickhouse` + `neon-database-conservation` + `tidb-serverless-default-mysql` memories.

- [ ] LOOP-GLOBAL-003: Observability split — Sentry platform-only, Axiom logs, PostHog Cloud, Langfuse AI
  - Endpoint: platform-wide
  - Decision: **Sentry** = the PLATFORM/admin/internal/full-stack-platform-tracing error tracker ONLY — NEVER instrumented on customer/client generated websites. **Axiom** = centralized structured logging. **PostHog Cloud** (US region, never self-hosted) = product analytics + customer-site analytics (lightweight). **Langfuse** = LLM/AI tracing + prompt + eval store.
  - Rationale: Customer sites must stay lightweight + cheap + privacy-clean (PostHog only); the platform itself gets full Sentry depth. Mixing them leaks platform error noise into client sites and inflates cost.
  - Acceptance criteria: No task wires Sentry into a generated-site template, `site_serving`, or any `*.projectsites.dev` customer subdomain output. Every customer-facing site analytics task uses PostHog only. Platform/admin/worker tasks may use Sentry.
  - Implementation notes: Verify PostHog ingestion via the BACKEND (PostHog MCP / trends), never headless browser (bot-filtered → false 0). CSP allows `us.i.posthog.com` + `us-assets.i.posthog.com`. Sentry via `@sentry/cloudflare withSentry`. Axiom via Workers Tracing OTLP (`@opentelemetry/exporter-trace-otlp-http`).
  - Hosting notes: PostHog Cloud + Langfuse Cloud are managed (Langfuse Cloud preferred over self-host because self-host needs ClickHouse — see LOOP-TRACES). Axiom managed.
  - Backing services: Sentry, Axiom, PostHog Cloud, Langfuse.
  - Observability: this IS the observability decision.
  - Related files: `src/lib/sentry.ts`, `src/lib/posthog.ts`, `src/services/sentry.ts`, `src/services/analytics.ts`, `cloudflare-native-provisioning` memory (PostHog Cloud note).

- [ ] LOOP-GLOBAL-004: Webhooks — Hookdeck + Outpost
  - Endpoint: webhooks.projectsites.dev
  - Decision: Inbound webhook ingestion/retry/replay → **Hookdeck**. Outbound webhook delivery to customers → **Outpost**. Do NOT use Svix as the default outbound choice unless an existing repo decision explicitly requires it.
  - Rationale: One pair for the whole webhook plane (in + out) with retries, signing, replay, and DLQ — instead of bespoke per-service webhook code.
  - Acceptance criteria: Every subsystem that emits customer-facing webhooks routes through Outpost; every inbound third-party webhook (Stripe, SES/SNS, OAuth providers) routes through Hookdeck. No new bespoke webhook receiver without a Hookdeck reason.
  - Implementation notes: Bot Fight Mode challenges inbound M2M webhooks → host receivers where BFM is off / add WAF skip. Worker subrequests bypass BFM.
  - Hosting notes: Hookdeck + Outpost managed/self-host on CF Containers per their model.
  - Backing services: Hookdeck, Outpost.
  - Observability: delivery logs → Axiom; delivery metrics → Tinybird.
  - Related files: `bot-fight-mode-blocks-inbound-webhooks` memory, `src/routes/webhooks.ts`.

- [ ] LOOP-GLOBAL-005: Mandatory structured logging + correlation IDs
  - Endpoint: platform-wide
  - Decision: Every log line, span, and event across every subsystem carries a standard correlation-ID set: `tenant_id`, `site_id`, `app_id`, `trace_id`, `job_id`, `api_key_id`, `request_id` (+ `feature_slug` where a feature module is involved, + subsystem-specific IDs like `conversation_id`/`link_id`/`social_account_id`).
  - Rationale: A solo operator debugging 20 subsystems needs to follow one request end-to-end across services in Axiom. Missing correlation IDs make cross-service incidents unsolvable.
  - Acceptance criteria: A shared structured-logger primitive (LOOP-LOGS) enforces the correlation-ID schema at the type level; a log line missing a required ID fails the logger's Zod parse in dev. Trace context propagates across subsystem HTTP hops via headers.
  - Implementation notes: Build once in LOOP-LOGS / LOOP-PLATFORM, import everywhere. Propagate `trace_id` + `request_id` via `X-Request-ID` + W3C `traceparent` headers across the typed internal service client.
  - Hosting notes: n/a
  - Backing services: Axiom (sink), Tinybird (rollups).
  - Observability: this IS the correlation backbone.
  - Related files: `middleware/request_id.ts`, LOOP-LOGS-* + LOOP-PLATFORM-* tasks.

- [ ] LOOP-GLOBAL-006: Subdomain provisioning golden-path (WAF skip + DNS + route)
  - Endpoint: every new `<name>.projectsites.dev`
  - Decision: Every new projectsites.dev subdomain that serves non-GET traffic MUST, in the same change: (1) get a per-host Worker route (beats the `*.projectsites.dev` wildcard), (2) be added to the zone WAF skip-rule host set (managed-challenge 403s programmatic POST), (3) have DNS provisioned via CF API, (4) set `workers_dev=true` while the custom domain stays pending.
  - Rationale: Repeatedly hit incidents (Plane sign-in 403, Unkey, njsk dark deploy) where a new subdomain silently broke because one of these four steps was skipped.
  - Acceptance criteria: A reusable provisioning script/checklist (LOOP-PLATFORM) performs all four steps; a new subsystem subdomain is HTTP-verified live (200 on a real GET + a real POST) before its tasks close.
  - Implementation notes: Ruleset `12b87a1ae6414bc6af7d9c561a0f7ac9` rule `9c8324ffa44545b9950cc04ffa9b1a54`, zone `9ceaa211750dd31899fd5d1bf8d1ec46`. CF-native products are API-provisionable with the global key (`X-Auth-Email` + `X-Auth-Key`).
  - Hosting notes: n/a
  - Backing services: Cloudflare API (zones, rulesets, workers/routes, workers/domains).
  - Observability: provisioning audit → Axiom.
  - Related files: `plane-pm-provisioning-state` + `waf-mcp-skip-rule` + `cloudflare-native-provisioning` memories.

- [ ] LOOP-GLOBAL-007: API-key + usage-metering plane — Unkey + OpenMeter
  - Endpoint: api.projectsites.dev + billing.projectsites.dev
  - Decision: Public/customer API keys → **Unkey** (LIVE at api.projectsites.dev). Usage metering for consumption billing → **OpenMeter**, feeding **Stripe** for invoicing.
  - Rationale: Don't hand-roll key verification, rate limits, or usage aggregation — Unkey + OpenMeter are the standardized primitives; Stripe is the money rail.
  - Acceptance criteria: Every authenticated public-API task verifies via Unkey; every metered feature emits OpenMeter events; billing tasks reconcile OpenMeter → Stripe.
  - Implementation notes: Unkey self-host CLI entrypoint needs `run api` + TOML via `UNKEY_CONFIG`. Square for accept-money default; Stripe for SaaS billing/payouts per `payments-routing`.
  - Hosting notes: Unkey on CF Workers Container (LIVE); OpenMeter on CF Workers Container.
  - Backing services: Unkey, OpenMeter, Stripe, TiDB/Neon as their stores require.
  - Observability: key + usage events → Axiom + Tinybird.
  - Related files: `apps/project-sites/infra/unkey/`, `unkey-live-api-projectsites` memory, `src/services/billing.ts`.

- [ ] LOOP-GLOBAL-008: Auth plane — Better Auth, edge sessions
  - Endpoint: auth.projectsites.dev
  - Decision: **Better Auth** is the consumer + enterprise auth IdP behind the `IdentityProvider` port. Logto/WorkOS are removed. The existing D1-session machinery issues sessions after the IdP verifies identity.
  - Rationale: One auth layer, CF-compatible, single source of identity across all consoles (admin, owner, docs, status).
  - Acceptance criteria: Cross-subsystem SSO uses Better Auth; no subsystem stands up its own auth. `orgId` is server-derived (`c.get('orgId')`), NEVER from a client `x-org-id` header (IDOR class).
  - Implementation notes: Better Auth on D1 needs a STATIC schema migration (runtime auto-migrate fails on D1 introspection) — generate offline + apply before cutover. cookieCache + KV bug #4203, TTL floor, per-request D1.
  - Hosting notes: CF Workers.
  - Backing services: Better Auth, D1, KV.
  - Observability: auth events → Axiom + Sentry (platform).
  - Related files: `apps/project-sites/src/auth/better-auth.ts`, `better-auth-cf-gotchas` + `better-auth-d1-needs-static-schema-migration` + `x-org-id-idor-class` memories.

- [ ] LOOP-GLOBAL-009: Event backbone — event_bus outbox → Tinybird
  - Endpoint: platform-wide
  - Decision: Every subsystem emits domain events into the shared `event_bus` outbox; a drain job ships them to a Tinybird Data Source every 5 min. A governed event taxonomy (one canonical name per event) is the contract.
  - Rationale: One analytics + audit + cross-service-reaction backbone instead of N bespoke pipelines; Tinybird is the OLAP sink for all of it.
  - Acceptance criteria: New analytics/metrics needs add a Tinybird Data Source fed by `event_bus`, never a new ClickHouse/warehouse. Event names follow the taxonomy (LOOP-ANALYTICS / LOOP-PLATFORM).
  - Implementation notes: Build Tinybird Data Sources from REAL payloads (don't guess schema). `outbox_dispatch.ts` drains every 5 min.
  - Hosting notes: CF Workers (drain) + CF Cron.
  - Backing services: D1 (outbox), Tinybird (sink).
  - Observability: drain health → Axiom; events → Tinybird.
  - Related files: `src/services/tinybird.ts`, `outbox_dispatch.ts`.

- [ ] LOOP-GLOBAL-010: Zod-everywhere + typed internal service client
  - Endpoint: platform-wide
  - Decision: Zod validates every runtime boundary (env, request, response, webhook, queue, AI output, tool I/O). A shared typed internal service client (RPC over service bindings where possible) is the ONLY way subsystems call each other — no bespoke fetch + cast.
  - Rationale: Contract-first across 20 services prevents drift and makes cross-service refactors safe; types inferred via `z.infer`, never hand-duplicated.
  - Acceptance criteria: Cross-subsystem calls go through the typed client (LOOP-PLATFORM); no `as`-cast past a boundary. OpenAPI is DERIVED from Zod (`@asteasolutions/zod-to-openapi`), feeding Scalar + Stainless (LOOP-DOCS).
  - Implementation notes: WorkerEntrypoint + service bindings for internal Worker-to-Worker (32 MiB payload, promise pipelining). `features.ts` `as`-cast drift converts per-feature on flag promotion, never mass-retrofit.
  - Hosting notes: CF Workers.
  - Backing services: n/a (discipline).
  - Observability: validation failures → Axiom with taxonomy code.
  - Related files: `packages/shared/src/schemas/`, LOOP-PLATFORM-* + LOOP-DOCS-* tasks.

## api.projectsites.dev — Unkey

### Raw research themes considered

I mined 50+ raw ideas across the Unkey surface: tenant root keys, per-site keys, per-app scoped keys, MCP/agent keys, S2S keys, customer developer portals + self-serve key claim, OpenAPI/Scalar docs, SDK auth snippets, key rotation/expiration/per-env keys, read-only reporting keys, quotas, rate limits, usage-based billing enforcement, AI credit metering, root-key governance/RBAC, immutable audit trails, instant revocation, abuse/anomaly detection, admin override/impersonation, customer-facing usage dashboards, key leak scanning, identity-based ratelimits, and the gateway-middleware that actually verifies keys on every inbound request. Filtering logic: (1) keep primitives that COMPOUND across the platform (a single verify-middleware, a single keys schema, a single usage-meter pipeline) over one-off UIs; (2) prefer tasks that make the existing `src/services/unkey.ts` client the one true gateway rather than scattering verification; (3) drop pure-research and anything Unkey already does for free (e.g. raw key hashing); (4) ensure each task is independently programmable by a later loop with named endpoints/tables/flows. I collapsed overlapping ideas (e.g. "per-site" + "per-app" + "per-env" keys into one scoped-namespace model with separate metering/rotation tasks) and cut speculative enterprise features (BYO-KMS, SCIM key provisioning) as premature for a solo founder. The final 24 sequence the foundation (client, namespaces, verify-middleware, schema) first, then layer governance, metering, billing enforcement, customer portal, and observability.

### Selected 24 implementation tasks

- [ ] LOOP-API-001: Harden the typed `unkey.ts` gateway client (createKey/verifyKey/updateKey/revokeKey/listKeys)
  - Why: Every other LOOP-API task imports this one client; it must be the single chokepoint to Unkey.
  - Acceptance criteria: Zod-validated request/response for all 5 ops; verifyKey returns `{valid, keyId, ownerId, meta, ratelimit, remaining}`; unit tests mock fetch and assert error envelopes on 4xx/5xx.
  - Implementation notes: Wrap `https://api.projectsites.dev/v1/keys.*`; root key from `UNKEY_ROOT_KEY` secret; expose `apiId` per namespace; reuse existing fetch-defaults retry/backoff.
  - Hosting notes: Workers Container default (Unkey Go container already live on CF Workers Containers); client itself runs in the worker.
  - Backing services: TiDB Serverless (Unkey's store) + Upstash Redis (Unkey ratelimit cache) — both behind Unkey, no direct app access.
  - Observability: Axiom structured logs with `tenant_id, api_key_id, request_id, trace_id` on every call; Sentry (platform-internal) on client exceptions.
  - Dependencies: none
  - Related files: src/services/unkey.ts, src/services/api_tokens.ts (migrate callers)

- [ ] LOOP-API-002: Define the canonical API-key data model + D1 mirror table `api_keys`
  - Why: We need a local index of issued keys (Unkey holds the secret; we hold ownership/scoping metadata) for fast list/filter without hammering Unkey.
  - Acceptance criteria: D1 migration creates `api_keys(id, unkey_key_id, tenant_id, site_id, app_id, scope_namespace, name, role, environment, status, created_at, revoked_at, expires_at, last_used_at)`; Zod schema in shared; every create/revoke writes both Unkey + this mirror in one idempotent path.
  - Implementation notes: `scope_namespace ∈ {tenant, site, app, mcp, s2s}`; idempotency via `unkey_key_id` UNIQUE; soft-delete via `status`.
  - Hosting notes: Workers Container default (worker-side D1).
  - Backing services: D1 (mirror index); TiDB behind Unkey (source of truth for secret).
  - Observability: Axiom logs on mirror writes with `api_key_id, tenant_id, site_id, app_id`.
  - Dependencies: LOOP-API-001
  - Related files: packages/shared/src/schemas/api.ts, supabase/migrations/, src/services/unkey.ts

- [ ] LOOP-API-003: Worker `apiKeyAuth` middleware that verifies every inbound `/api/*` external request
  - Why: One middleware turns Unkey into the platform's actual gatekeeper instead of ad-hoc checks.
  - Acceptance criteria: Reads `Authorization: Bearer <key>`; calls `verifyKey`; on invalid returns RFC7807 401 with `correlationId`; on valid sets `c.set('apiKey', {...})` incl. tenant/site/app scope; covered by unit tests for valid/expired/revoked/ratelimited.
  - Implementation notes: Mount only on externally-exposed `/api/v1/*` routes (not admin session routes); short-circuit cache via Unkey's own edge cache.
  - Hosting notes: Workers Container default (runs in worker request path).
  - Backing services: none direct (Unkey verify).
  - Observability: Axiom log per verify with `api_key_id, request_id, trace_id, status, durationMs`.
  - Dependencies: LOOP-API-001
  - Related files: src/middleware/, src/index.ts

- [ ] LOOP-API-004: Tenant root-key issuance + governance flow
  - Why: Each tenant needs a top-level key to mint child keys; governs who can create/revoke.
  - Acceptance criteria: `POST /api/v1/keys/root` (admin/owner role only) creates a tenant root key with `scope_namespace=tenant`; only root keys can call key-management endpoints; RBAC enforced via shared middleware; E2E proves a non-root key is 403→404-safe.
  - Implementation notes: Store `role` in Unkey key meta; gate management endpoints on `meta.role==='root'`; one active root per tenant (rotate, don't duplicate).
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror.
  - Observability: Axiom audit log on every root-key op with `tenant_id, api_key_id`.
  - Dependencies: LOOP-API-002, LOOP-API-003
  - Related files: packages/shared/src/middleware/, src/routes/api.ts

- [ ] LOOP-API-005: Scoped key namespaces — per-site and per-app keys
  - Why: A tenant with many generated sites/apps needs keys scoped to one site/app, not blanket access.
  - Acceptance criteria: `POST /api/v1/keys` accepts `{scope: 'site'|'app', site_id|app_id, permissions[]}`; verifyKey result exposes scope; middleware rejects cross-scope access (key for site A cannot hit site B routes); E2E covers cross-scope denial.
  - Implementation notes: Encode scope in Unkey key meta + `permissions` array (e.g. `site:read`, `app:deploy`); enforce in `apiKeyAuth`.
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror.
  - Observability: Axiom with `site_id, app_id, api_key_id`.
  - Dependencies: LOOP-API-002, LOOP-API-003
  - Related files: src/services/unkey.ts, src/routes/api.ts

- [ ] LOOP-API-006: Per-environment keys (live vs test) with `psk_live_` / `psk_test_` prefixes
  - Why: Customers must separate test traffic from production billing/quotas.
  - Acceptance criteria: Key create takes `environment ∈ {live,test}`; prefix encodes it; test keys never increment billable usage or trigger real side-effects; verifyKey surfaces environment; unit test asserts test key is non-billable.
  - Implementation notes: Use Unkey `prefix` + `environment` field; billing-enforcement (LOOP-API-013) skips `test`; align prefix with existing `psk_test_` convention from E2E_API_KEY.
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror.
  - Observability: Axiom log carries `environment`.
  - Dependencies: LOOP-API-005
  - Related files: src/services/unkey.ts, packages/shared/src/schemas/api.ts

- [ ] LOOP-API-007: Key rotation flow (overlap window, zero-downtime)
  - Why: Customers must rotate a leaked/aging key without an outage.
  - Acceptance criteria: `POST /api/v1/keys/:id/rotate` issues a new key, keeps old valid for a configurable grace (default 24h), then auto-expires old via Unkey expiration; returns new secret once; E2E proves both keys work during overlap then old dies.
  - Implementation notes: Set `expires` on old key = now+grace; link `rotated_from` in meta; Cron Trigger sweeps expired mirror rows.
  - Hosting notes: Workers Container default; rotation sweep via CF Cron Trigger.
  - Backing services: D1 mirror.
  - Observability: Axiom audit `api_key_id (old/new), tenant_id`.
  - Dependencies: LOOP-API-002
  - Related files: src/services/unkey.ts, src/routes/api.ts

- [ ] LOOP-API-008: Key expiration + scheduled auto-revoke
  - Why: Short-lived keys (CI tokens, demos) should expire automatically.
  - Acceptance criteria: Create accepts `expires_at`; Unkey enforces; a Cron Trigger reconciles mirror `status` for expired keys; verifyKey on expired returns invalid; unit test on boundary.
  - Implementation notes: Pass `expires` (ms epoch) to Unkey; daily cron marks mirror rows `status='expired'`.
  - Hosting notes: Workers Container default; CF Cron Trigger.
  - Backing services: D1 mirror.
  - Observability: Axiom on expiry reconcile with `api_key_id`.
  - Dependencies: LOOP-API-002
  - Related files: src/services/unkey.ts, src/workflows/ or cron service

- [ ] LOOP-API-009: Instant revocation + revoked-key denylist propagation
  - Why: A leaked key must die immediately, everywhere.
  - Acceptance criteria: `DELETE /api/v1/keys/:id` revokes in Unkey + mirror in one idempotent call; verifyKey returns invalid within Unkey's cache TTL; E2E: revoke then immediate request is 401.
  - Implementation notes: Unkey delete is authoritative; mirror `revoked_at`; surface in audit feed (LOOP-API-016).
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror.
  - Observability: Axiom audit `api_key_id, tenant_id, actor`.
  - Dependencies: LOOP-API-002, LOOP-API-003
  - Related files: src/services/unkey.ts, src/routes/api.ts

- [ ] LOOP-API-010: Per-key rate limits (fixed + identity-based) via Unkey ratelimits
  - Why: Protect the platform and let customers tier request throughput per key.
  - Acceptance criteria: Create accepts `ratelimit{limit, duration, type:'fast'|'consistent'}`; verifyKey enforces; 429 returns RFC7807 with `Retry-After` + remaining; unit test simulates limit exhaustion.
  - Implementation notes: Use Unkey ratelimit on key meta; identity-based limits keyed by `ownerId` to share a budget across a tenant's keys.
  - Hosting notes: Workers Container default (Unkey + Upstash Redis handle counters).
  - Backing services: Upstash Redis (behind Unkey).
  - Observability: Axiom 429 events with `api_key_id, tenant_id, remaining`.
  - Dependencies: LOOP-API-003
  - Related files: src/services/unkey.ts, src/middleware/

- [ ] LOOP-API-011: API quotas (monthly request/credit caps) with Unkey `remaining`
  - Why: Enforce plan-based monthly ceilings, not just per-second rate.
  - Acceptance criteria: Create accepts `remaining{limit, refill:{interval, amount}}`; verifyKey decrements; at zero returns 402/429 with upgrade CTA; quota resets monthly; E2E drains a small quota and asserts block.
  - Implementation notes: Unkey `remaining` + `refill`; map plan→quota in shared `ENTITLEMENTS`; surface remaining in usage dashboard (LOOP-API-018).
  - Hosting notes: Workers Container default.
  - Backing services: TiDB (behind Unkey).
  - Observability: Axiom quota-hit events `api_key_id, tenant_id, remaining`; PostHog product event `api_quota_exhausted`.
  - Dependencies: LOOP-API-010
  - Related files: packages/shared/src/constants/, src/services/unkey.ts

- [ ] LOOP-API-012: Usage metering pipeline → Tinybird (per-key request analytics)
  - Why: Need queryable usage for dashboards, billing, and abuse detection beyond Unkey's own analytics.
  - Acceptance criteria: Every verified request emits a metering event `{api_key_id, tenant_id, site_id, app_id, route, status, ts, billable, units}` to Tinybird; a Tinybird endpoint aggregates per-key daily; backfill-safe (idempotent event id).
  - Implementation notes: `ctx.waitUntil` POST to Tinybird events datasource; reuse existing Tinybird datasources pattern; dedupe on `request_id`.
  - Hosting notes: Workers Container default; non-blocking via waitUntil.
  - Backing services: Tinybird (analytics), R2 (raw event dead-letter on Tinybird failure).
  - Observability: Axiom on emit failures with `request_id, api_key_id`.
  - Dependencies: LOOP-API-003
  - Related files: src/services/unkey.ts, src/services/analytics_events.ts

- [ ] LOOP-API-013: Usage-based billing enforcement bridge (Unkey usage → Stripe meter)
  - Why: Turn metered API usage into revenue with hard/soft caps. (needs decision on overage pricing tiers)
  - Acceptance criteria: A scheduled job reads Tinybird per-tenant billable units and reports to Stripe metered billing; soft cap warns, hard cap auto-throttles via Unkey quota; idempotent per billing period; test-mode keys excluded.
  - Implementation notes: Cron Trigger nightly; Stripe `billing.meter_events`; throttle by lowering Unkey `remaining` when over hard cap.
  - Hosting notes: Workers Container default; CF Cron Trigger.
  - Backing services: Tinybird (read), Stripe (meter), D1 (period ledger).
  - Observability: Axiom billing-run logs `tenant_id, units, job_id`; PostHog `api_overage_charged`.
  - Dependencies: LOOP-API-012, LOOP-API-011
  - Related files: src/services/billing.ts, src/services/unkey.ts

- [ ] LOOP-API-014: AI credit enforcement on AI-backed API routes
  - Why: AI calls cost real money; per-key AI credits must deplete independently of request quota.
  - Acceptance criteria: AI routes check a separate Unkey credit pool (or D1 credit ledger) keyed by `api_key_id`; insufficient credits returns 402 with top-up link; credits decremented by model-priced units; unit test on depletion.
  - Implementation notes: Reuse `app_cost_meter.ts`/`ai_gateway.ts`; price per model tier; gate before LLM call at llm.projectsites.dev.
  - Hosting notes: Workers Container default.
  - Backing services: D1 (credit ledger), Tinybird (AI usage), Langfuse (AI trace correlation).
  - Observability: Axiom + Langfuse trace with `api_key_id, trace_id`; PostHog `ai_credits_exhausted`.
  - Dependencies: LOOP-API-011, LOOP-API-012
  - Related files: src/services/app_cost_meter.ts, src/services/ai_gateway.ts, src/services/unkey.ts

- [ ] LOOP-API-015: MCP/agent keys — scoped keys for AI agents calling the platform API
  - Why: Agents (and our own MCP servers) need narrow, revocable, auditable credentials distinct from human keys.
  - Acceptance criteria: `scope_namespace=mcp` keys with `permissions[]` restricted to specific tools/routes; verifyKey tags requests as agent traffic; integrates with existing MCP OAuth provider as the issued credential; E2E: an MCP key cannot call non-granted routes.
  - Implementation notes: Issue MCP keys from the OAuth consent flow (`mcp_oauth_provider` flag); meta `actor_type='agent'`.
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror.
  - Observability: Axiom with `actor_type=agent, api_key_id`; PostHog MCP intent if useful.
  - Dependencies: LOOP-API-005, LOOP-API-003
  - Related files: src/routes/ (mcp/oauth), src/services/unkey.ts

- [ ] LOOP-API-016: Immutable audit trail for all key lifecycle events
  - Why: Governance + incident forensics require a tamper-evident record of who created/rotated/revoked keys.
  - Acceptance criteria: Every create/rotate/revoke/scope-change appends to `api_key_audit(id, api_key_id, tenant_id, actor, action, before, after, ts)`; append-only (no UPDATE/DELETE); admin endpoint to read; covered by tests.
  - Implementation criteria: D1 append-only table + hash-chain `prev_hash` for tamper evidence; mirror to Axiom for retention.
  - Hosting notes: Workers Container default.
  - Backing services: D1 (audit), Axiom (long retention).
  - Observability: Axiom dual-write `api_key_id, tenant_id, actor`.
  - Dependencies: LOOP-API-002
  - Related files: src/services/audit.ts, supabase/migrations/

- [ ] LOOP-API-017: Customer developer portal (self-serve key management UI)
  - Why: Customers must create/rotate/revoke their own keys without contacting support.
  - Acceptance criteria: `/admin/api-keys` (tenant-scoped) lists keys, create dialog with scope/env/quota, rotate + revoke with confirm; secret shown once with copy; respects RBAC; E2E from homepage → create → see masked key.
  - Implementation notes: Angular standalone component reusing `DialogShellComponent`; cyan/black tokens; ConfirmService danger on revoke.
  - Hosting notes: Workers Container default (worker serves frontend).
  - Backing services: D1 mirror (list), Unkey (mutations).
  - Observability: PostHog product events `api_key_created/rotated/revoked`; Axiom on mutations.
  - Dependencies: LOOP-API-002, LOOP-API-004
  - Related files: frontend admin section, src/routes/api.ts

- [ ] LOOP-API-018: Customer-facing API usage dashboard (per-key analytics)
  - Why: Customers need to see request volume, error rate, quota remaining, top routes.
  - Acceptance criteria: Dashboard charts pull from Tinybird endpoints (requests/day, error %, remaining quota, p95 latency) filtered by key; empty + load states; deep-linkable `?key=&range=`; E2E asserts charts render.
  - Implementation notes: Reuse rolling-counter + admin chart patterns; Tinybird endpoint per metric; visibility-aware polling.
  - Hosting notes: Workers Container default.
  - Backing services: Tinybird (read).
  - Observability: PostHog `api_usage_dashboard_viewed`; Axiom on query failures.
  - Dependencies: LOOP-API-012, LOOP-API-017
  - Related files: frontend admin section, src/services/analytics_query.ts

- [ ] LOOP-API-019: OpenAPI 3.1 spec + Scalar reference at docs.projectsites.dev/api
  - Why: A public, accurate API reference is table stakes for developer adoption + drives SDK generation.
  - Acceptance criteria: Hand-maintained-but-validated OpenAPI for all `/api/v1/*` routes lints clean via Redocly; Scalar UI served; auth scheme documents Bearer key + scopes; CI fails on spec drift vs routes.
  - Implementation notes: Generate route inventory, diff against spec in CI; serve Scalar static from R2; link from developer portal.
  - Hosting notes: Workers Container default; static Scalar assets from R2.
  - Backing services: R2 (docs assets).
  - Observability: PostHog `api_docs_viewed`.
  - Dependencies: LOOP-API-003
  - Related files: openapi spec file, docs site, .github/workflows/

- [ ] LOOP-API-020: SDK auth quickstarts + copy-paste snippets (curl/TS/Python)
  - Why: Reduce time-to-first-call; show exactly how to send the Bearer key + handle 401/429.
  - Acceptance criteria: Snippet blocks rendered in portal + docs for curl, fetch/TS, Python; include retry-on-429 and rotation guidance; snippets are tested against a live test key in CI smoke.
  - Implementation notes: Generate from OpenAPI examples; embed in Scalar; pull `psk_test_` example key.
  - Hosting notes: Workers Container default.
  - Backing services: none.
  - Observability: PostHog `api_snippet_copied` with language.
  - Dependencies: LOOP-API-019
  - Related files: docs site, frontend portal

- [ ] LOOP-API-021: Read-only / reporting keys (scope = analytics read)
  - Why: Dashboards, BI tools, and partners often need read-only access without mutation power.
  - Acceptance criteria: `permissions=['read:*']` keys rejected on any write route by middleware; verifyKey surfaces read-only flag; create UI offers a "read-only" toggle; E2E: read-only key 403→404-safe on a POST.
  - Implementation notes: Enforce in `apiKeyAuth` by method+permission match; default deny.
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror.
  - Observability: Axiom logs permission denials `api_key_id`.
  - Dependencies: LOOP-API-005, LOOP-API-003
  - Related files: src/middleware/, src/services/unkey.ts

- [ ] LOOP-API-022: Service-to-service keys for internal platform calls (crm/mail/jobs/social)
  - Why: Internal subsystems calling each other should use scoped S2S keys, not the global root key.
  - Acceptance criteria: `scope_namespace=s2s` keys per internal service with least-privilege permissions; rotation automated via secret-provisioning; verifyKey tags `actor_type='service'`; no S2S key grants customer-data write outside its service.
  - Implementation notes: Issue one S2S key per subsystem; store in Worker secrets; rotate on the vendor-rotation calendar.
  - Hosting notes: Workers Container default; internal callers are workers/containers.
  - Backing services: D1 mirror.
  - Observability: Axiom with `actor_type=service, service_name, api_key_id`.
  - Dependencies: LOOP-API-005
  - Related files: src/services/unkey.ts, secret-provisioning manifest

- [ ] LOOP-API-023: Abuse + anomaly detection on key usage (spike/geo/error-rate)
  - Why: Catch leaked or abused keys before they rack up cost or damage.
  - Acceptance criteria: Scheduled job queries Tinybird for per-key anomalies (sudden 10x spike, error-rate >50%, new-geo burst); flags + optionally auto-throttles via Unkey quota; emits actionable notification with remediation; test on synthetic spike.
  - Implementation notes: Reuse `auth_anomaly.ts` patterns; Tinybird anomaly query; notify via psnotify + Hookdeck outbound webhook to customer.
  - Hosting notes: Workers Container default; CF Cron Trigger.
  - Backing services: Tinybird (detection), Upstash (throttle counters via Unkey), Hookdeck+Outpost (alert webhooks).
  - Observability: Axiom anomaly events `api_key_id, tenant_id`; PostHog `api_abuse_flagged`.
  - Dependencies: LOOP-API-012, LOOP-API-011
  - Related files: src/services/auth_anomaly.ts, src/services/unkey.ts

- [ ] LOOP-API-024: Admin override + impersonation-safe key inspection (platform operator)
  - Why: As operator I must inspect, suspend, or emergency-revoke any tenant's keys during incidents, with a full audit trail.
  - Acceptance criteria: `/admin/system/api-keys` (platform-operator only) lists ALL keys across tenants, suspend/revoke with mandatory reason; never reveals raw secret; every action audited as operator action; E2E proves operator-only gating.
  - Implementation notes: Separate operator RBAC tier (not tenant owner); writes to audit with `actor='operator:<email>'`; suspend = Unkey disable, not delete.
  - Hosting notes: Workers Container default.
  - Backing services: D1 mirror + audit.
  - Observability: Sentry (platform) on operator actions; Axiom audit `actor, api_key_id, tenant_id`.
  - Dependencies: LOOP-API-016, LOOP-API-009
  - Related files: frontend system-services admin, src/services/unkey.ts, src/services/audit.ts

## auth.projectsites.dev — Better Auth

### Raw research themes considered

Mined ~55 raw ideas across the prompt's theme list: platform login (magic link, password, OTP), passkeys/WebAuthn (registration, autofill, multi-device, recovery), OAuth/OIDC *provider* mode (so customer sites/apps "Sign in with ProjectSites"), org/team/role models, tenant switching, invites, impersonation, service-to-service auth, MCP/agent auth, session policy (rotation, revocation, device list), enterprise SSO/SCIM handoff, account linking, recovery, audit logs, abuse/bot protection, and the customer-website auth boundary. Filtering logic: dropped anything Better Auth already ships turnkey unless it needed a D1-static-migration wrapper or a platform-specific policy; dropped vague "improve auth" items; collapsed overlapping ideas (e.g. five session-management ideas → one device/session console + one rotation policy); prioritized reusable primitives that compound (OIDC provider, JWKS, audit log, agent-key issuer) over one-off screens. Kept items that are concrete, programmable, Cloudflare-first, and that turn auth into a platform product surface rather than just internal login. Final 24 ordered foundation → orgs → tokens/agents → SSO/enterprise → safety/audit.

### Selected 24 implementation tasks

- [ ] LOOP-AUTH-001: D1 static schema migration + drift-check for Better Auth
  - Why: Better Auth cannot runtime auto-migrate on D1; schema drift silently breaks login.
  - Acceptance criteria: `better-auth` CLI-generated schema committed as a numbered migration; CI step diffs live D1 schema vs generated and fails on drift.
  - Implementation notes: `npx @better-auth/cli generate` → write `migrations/00XX_better_auth.sql`; add `bin/check-auth-schema.mjs` comparing `wrangler d1 execute` introspection.
  - Hosting notes: Workers Container default (auth Worker on CF); no Fly.
  - Backing services: D1 (sessions/users), KV (cookie cache mitigation per bug #4203).
  - Observability: Axiom log on migration apply with correlation IDs (trace_id, request_id); Sentry platform-only.
  - Dependencies: none
  - Related files: apps/project-sites/src/auth/better-auth.ts, apps/project-sites/migrations/

- [ ] LOOP-AUTH-002: Passkey (WebAuthn) registration + conditional-UI autofill login
  - Why: Phishing-resistant primary factor; removes magic-link latency for repeat users.
  - Acceptance criteria: User can register a passkey, log in via autofill ("passkeys" conditional UI), and see it listed; works on iOS/Android/desktop.
  - Implementation notes: Enable Better Auth `passkey` plugin; rpId=`projectsites.dev`; store credentials in D1; expose `/api/auth/passkey/*`.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (credential store), KV (challenge cache, 5-min TTL).
  - Observability: Axiom auth.passkey.register/login events with user_id+request_id; PostHog funnel for passkey adoption.
  - Dependencies: LOOP-AUTH-001
  - Related files: apps/project-sites/src/auth/better-auth.ts, middleware/identity.ts

- [ ] LOOP-AUTH-003: Multi-passkey + recovery-codes fallback flow
  - Why: A single passkey is a lockout risk; need recoverable account access.
  - Acceptance criteria: User can add ≥1 additional passkey and generate 10 one-time recovery codes; using a code logs in and marks it consumed.
  - Implementation notes: Hash recovery codes (Argon2/scrypt via Web Crypto) in D1; rate-limit code attempts; force re-issue on full consumption.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (codes table), Upstash (attempt rate limit counter).
  - Observability: Axiom recovery.code.used + alert when >3 failed attempts (correlation IDs); Sentry platform-only.
  - Dependencies: LOOP-AUTH-002
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-004: Unified session/device console with per-session revocation
  - Why: Users + support need to see and kill active sessions across devices.
  - Acceptance criteria: `/admin/security/sessions` lists active sessions (device, IP-geo, last-seen); revoking one invalidates that session within 60s.
  - Implementation notes: Read Better Auth session table; store device fingerprint + UA-parsed device; revoke writes tombstone + invalidates KV cookie-cache key.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (sessions), KV (cookie cache invalidation).
  - Observability: Axiom session.revoke with session_id+user_id+request_id; PostHog "managed sessions" event.
  - Dependencies: LOOP-AUTH-001
  - Related files: apps/project-sites/src/middleware/identity.ts

- [ ] LOOP-AUTH-005: Session policy engine (idle timeout, absolute TTL, rotation, step-up)
  - Why: One configurable place to enforce session lifetime + re-auth for sensitive actions.
  - Acceptance criteria: Config-driven idle (default 7d) + absolute (default 30d) expiry; sensitive routes require step-up (recent re-auth <15m) or return 401 with `step_up_required`.
  - Implementation notes: Zod `SessionPolicy` schema; middleware checks `auth_time`; rotate session id on privilege change. (needs decision: default idle/absolute values.)
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1, KV.
  - Observability: Axiom session.stepup.required with route+user_id+trace_id.
  - Dependencies: LOOP-AUTH-001, LOOP-AUTH-004
  - Related files: apps/project-sites/src/middleware/identity.ts

- [ ] LOOP-AUTH-006: Organizations + teams + roles model (Better Auth organization plugin)
  - Why: Multi-tenant platform needs org → team → member hierarchy as the auth substrate.
  - Acceptance criteria: Create org, create teams within org, assign roles (owner/admin/member/viewer); membership enforced in `c.get('orgId')` resolution.
  - Implementation notes: Enable `organization` plugin; never trust client `x-org-id` (IDOR class); resolve active org server-side from session.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (org/team/member tables), KV (active-org cache).
  - Observability: Axiom org.created/member.added with org_id+user_id+request_id; PostHog org-creation funnel.
  - Dependencies: LOOP-AUTH-001
  - Related files: apps/project-sites/src/auth/better-auth.ts, middleware/identity.ts

- [ ] LOOP-AUTH-007: Tenant switcher with server-validated active-org cookie
  - Why: Users in multiple orgs need fast, safe context switching without IDOR.
  - Acceptance criteria: Switcher lists only orgs the user belongs to; selecting one sets active org server-side; all subsequent API calls scope to it.
  - Implementation notes: `POST /api/auth/active-org` validates membership then signs active_org into session; UI reads from session, not localStorage.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1, KV (60s active-org cache, invalidated on switch).
  - Observability: Axiom org.switch with from_org_id+to_org_id+user_id+request_id.
  - Dependencies: LOOP-AUTH-006
  - Related files: apps/project-sites/src/middleware/identity.ts

- [ ] LOOP-AUTH-008: Invite flow (email invite, token, accept, role pre-assignment, expiry)
  - Why: Orgs grow by inviting teammates; needs secure, auditable, expiring invites.
  - Acceptance criteria: Owner sends invite with role; invitee receives email link; accepting (signed-in or after signup) joins org with pre-set role; tokens expire in 7d and are single-use.
  - Implementation notes: Signed invite tokens in D1; magic-link-style email via Resend; revoke pending invites; idempotent accept.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (invites), Resend (email), KV (token lookup).
  - Observability: Axiom invite.sent/accepted/expired with org_id+invitee_email_hash+request_id; PostHog invite-acceptance rate.
  - Dependencies: LOOP-AUTH-006
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-009: ProjectSites as OIDC/OAuth2 provider for customer apps ("Sign in with ProjectSites")
  - Why: Foundational platform primitive — generated sites/apps authenticate users against the platform IdP.
  - Acceptance criteria: Discovery doc at `/.well-known/openid-configuration`, `/authorize`, `/token`, `/userinfo` work; a registered client completes auth-code + PKCE and gets a valid ID token.
  - Implementation notes: Enable Better Auth `oidcProvider` plugin; per-client redirect-URI allowlist; consent screen (LOOP-AUTH-010).
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (clients, auth codes), KV (code cache, short TTL).
  - Observability: Axiom oidc.authorize/token with client_id+user_id+trace_id; Sentry platform-only.
  - Dependencies: LOOP-AUTH-001, LOOP-AUTH-006
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-010: OAuth consent screen + scope catalog + per-client grant management
  - Why: OIDC provider needs explicit user consent and revocable grants per scope.
  - Acceptance criteria: First authorize shows scopes + client name; user grants/denies; user can later revoke a client at `/admin/security/connected-apps`.
  - Implementation notes: Zod `Scope` catalog (`openid profile email org:read sites:read`); store grants in D1; skip consent on re-auth if scopes unchanged.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (grants).
  - Observability: Axiom oauth.consent.granted/revoked with client_id+scopes+user_id+request_id.
  - Dependencies: LOOP-AUTH-009
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-011: JWKS endpoint + rotating asymmetric signing keys for issued tokens
  - Why: Customer apps and services must verify platform-issued JWTs against published, rotatable keys.
  - Acceptance criteria: `/.well-known/jwks.json` serves current+next public keys; ID/access tokens signed RS256/EdDSA; key rotation keeps old kid valid until token TTL elapses.
  - Implementation notes: Generate keys via Web Crypto; store private keys as Worker secrets / encrypted in D1; `kid` in JWT header; rotation job via Cron.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1/KV (public key set cache), CF Secrets (private keys).
  - Observability: Axiom jwks.rotated with kid+trace_id; alert if rotation overdue.
  - Dependencies: LOOP-AUTH-009
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-012: API key issuer for service/M2M auth (scoped, hashed, revocable)
  - Why: Programmatic clients (CI, integrations, agents) need non-cookie credentials with least privilege.
  - Acceptance criteria: User mints an API key scoped to org + permissions; key shown once; requests with key resolve to a scoped principal; revoking blocks within 60s.
  - Implementation notes: Store only key hash (SHA-256) + prefix in D1; `psk_*` format; middleware resolves `api_key_id` into principal; per-key rate limits.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (keys), Upstash (per-key rate limit).
  - Observability: Axiom apikey.created/used/revoked with api_key_id+org_id+request_id (never the secret).
  - Dependencies: LOOP-AUTH-006
  - Related files: apps/project-sites/src/middleware/identity.ts

- [ ] LOOP-AUTH-013: OAuth2 client-credentials grant for app-to-app auth
  - Why: Platform services and customer backends need standard M2M token exchange, not just static keys.
  - Acceptance criteria: Registered confidential client exchanges client_id+secret at `/token` for a scoped access token; token verifies via JWKS; expired/over-scope requests rejected.
  - Implementation notes: Extend OIDC provider with `grant_type=client_credentials`; scope clamping to client's allowed scopes; short token TTL (15m).
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (clients), KV.
  - Observability: Axiom oauth.client_credentials with client_id+granted_scopes+trace_id.
  - Dependencies: LOOP-AUTH-009, LOOP-AUTH-011
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-014: Agent identity + delegated (on-behalf-of) tokens
  - Why: AI agents acting for a user/org need scoped, attributable, time-boxed credentials distinct from the user's session.
  - Acceptance criteria: Issue an agent token bound to {actor_user, org, scopes, expiry}; downstream logs show both agent_id and on-behalf-of user; tokens are independently revocable.
  - Implementation notes: JWT with `act` (actor) claim per RFC 8693 token-exchange shape; max-TTL clamp; deny privilege escalation beyond delegating user. (needs decision: max agent-token lifetime + allowed scope ceiling.)
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (agent registry), KV.
  - Observability: Langfuse trace links agent_id; Axiom agent.token.issued/used with agent_id+actor_user_id+trace_id.
  - Dependencies: LOOP-AUTH-011, LOOP-AUTH-013
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-015: MCP OAuth resource-server validation aligned to platform IdP
  - Why: `/api/mcp/*` must accept platform-issued tokens so MCP clients use one auth surface (ties to existing mcp_oauth_provider work).
  - Acceptance criteria: MCP endpoints validate bearer tokens against JWKS, enforce `mcp:*` scopes, and return RFC9728 `WWW-Authenticate` with resource metadata on 401.
  - Implementation notes: Reuse JWKS verifier; publish `/.well-known/oauth-protected-resource`; map MCP tool perms to scopes.
  - Hosting notes: Workers Container default; no Fly. (Existing prod WAF skips challenge for /api/mcp + /oauth/*.)
  - Backing services: D1, KV.
  - Observability: Axiom mcp.auth.ok/denied with client_id+scope+request_id.
  - Dependencies: LOOP-AUTH-009, LOOP-AUTH-011
  - Related files: apps/project-sites/src/routes/, src/auth/better-auth.ts

- [ ] LOOP-AUTH-016: Safe admin impersonation ("login as") with consent + banner + auto-expiry
  - Why: Support needs to reproduce user issues without password sharing, but impersonation is high-risk.
  - Acceptance criteria: Platform admin starts a time-boxed (≤30m) impersonation; UI shows a persistent "Impersonating X" banner; session auto-ends; every action tagged impersonated. (needs decision: require target-user consent vs admin-only policy.)
  - Implementation notes: Mint impersonation session with `impersonator_id` claim; block sensitive ops (password/billing change) while impersonating; force audit log.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (impersonation sessions).
  - Observability: Axiom impersonation.start/end + every action carries impersonator_id+target_user_id+request_id; Sentry platform-only.
  - Dependencies: LOOP-AUTH-006, LOOP-AUTH-022
  - Related files: apps/project-sites/src/middleware/identity.ts

- [ ] LOOP-AUTH-017: Account linking (multiple OAuth providers + email to one identity)
  - Why: Users who sign up with Google then later with email shouldn't fork into two accounts.
  - Acceptance criteria: Linking a second provider with a verified-matching email merges into the existing account; mismatched/unverified emails require explicit confirmation; unlinking leaves ≥1 credential.
  - Implementation notes: Better Auth account-linking config with `trustedProviders`; require email verification before auto-link; guard last-credential removal.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (accounts).
  - Observability: Axiom account.linked/unlinked with user_id+provider+request_id.
  - Dependencies: LOOP-AUTH-001
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-018: Enterprise SSO via SAML/OIDC with WorkOS boundary
  - Why: Enterprise customers demand IdP-initiated SSO; WorkOS abstracts SAML connectors without us hosting SAML infra.
  - Acceptance criteria: An org admin configures an SSO connection (WorkOS) ; users on that org's domain are routed to their IdP and provisioned into the org on first login.
  - Implementation notes: Keep WorkOS strictly at the connection boundary — exchange WorkOS profile → platform session via Better Auth generic OAuth; domain→org mapping table. WorkOS only for enterprise SSO connectors (not core auth).
  - Hosting notes: Workers Container default; WorkOS is external SaaS (SSO connector), no self-host. No Fly.
  - Backing services: D1 (sso_connections, domain map), WorkOS (SSO).
  - Observability: Axiom sso.login with org_id+connection_id+user_id+trace_id; Sentry platform-only.
  - Dependencies: LOOP-AUTH-006, LOOP-AUTH-017
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-019: SCIM 2.0 provisioning + role synchronization from enterprise IdP
  - Why: Enterprises expect user/group lifecycle (deprovision on offboard) and role mapping driven by their IdP.
  - Acceptance criteria: SCIM `/scim/v2/Users` + `/Groups` support create/update/deactivate; IdP group → platform role mapping applies on sync; deprovision revokes sessions within 60s.
  - Implementation notes: Bearer-token-secured SCIM endpoints per connection; idempotent upserts keyed on externalId; group-to-role map config (needs decision: precedence when IdP role conflicts with manual role).
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (scim mappings), KV.
  - Observability: Axiom scim.user.provisioned/deprovisioned with org_id+external_id+request_id.
  - Dependencies: LOOP-AUTH-006, LOOP-AUTH-018
  - Related files: apps/project-sites/src/routes/, src/auth/better-auth.ts

- [ ] LOOP-AUTH-020: Customer-website auth boundary SDK (lightweight drop-in for generated sites)
  - Why: Generated customer sites need simple, lightweight end-user auth without inheriting platform-admin complexity or Sentry.
  - Acceptance criteria: A `<script>`/JS SDK lets a generated site add email/passkey login backed by the platform OIDC provider in <10 lines; sessions scoped to that site_id only.
  - Implementation notes: Thin client wrapping LOOP-AUTH-009 endpoints; per-site OAuth client auto-provisioned at site publish; no cross-site session bleed.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (per-site clients), R2 (SDK asset).
  - Observability: Axiom site.auth.login with site_id+request_id; PostHog for platform metrics only. Sentry NEVER on customer sites.
  - Dependencies: LOOP-AUTH-009, LOOP-AUTH-010
  - Related files: apps/project-sites/src/routes/, public/

- [ ] LOOP-AUTH-021: Bot protection + abuse prevention on all auth entry points (Turnstile + rate limits)
  - Why: Login/signup/magic-link/OTP are credential-stuffing and email-bomb targets.
  - Acceptance criteria: Turnstile gates signup + magic-link request; per-IP + per-account rate limits on login/OTP; lockout with exponential backoff after N failures; abusive patterns blocked without harming legit users.
  - Implementation notes: CF Turnstile (CF-minted keys via API); Upstash sliding-window counters keyed by IP+email_hash; CF managed rate-limiting unreliable on plan → DO/Upstash counter is source of truth.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: Turnstile, Upstash (rate limit), Durable Object (atomic lockout counter).
  - Observability: Axiom auth.ratelimited/lockout/turnstile_fail with ip_hash+email_hash+request_id; PostHog abuse dashboard.
  - Dependencies: LOOP-AUTH-001
  - Related files: apps/project-sites/src/middleware/, src/auth/better-auth.ts

- [ ] LOOP-AUTH-022: Tamper-evident auth audit log (append-only, queryable, exportable)
  - Why: Security + compliance need a complete, immutable record of every auth-relevant event.
  - Acceptance criteria: Every login, logout, role change, invite, token issue/revoke, impersonation, SSO event is recorded with actor, target, IP, result; log is append-only and exportable per org as CSV/JSON.
  - Implementation notes: Write events to D1 append-only table + mirror to Tinybird for analytics queries; hash-chain rows (prev_hash) for tamper evidence.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (audit), Tinybird (queryable analytics), Axiom (raw log stream).
  - Observability: Axiom is the transport; correlation IDs (actor_id, org_id, request_id, trace_id) on every row.
  - Dependencies: LOOP-AUTH-006
  - Related files: apps/project-sites/src/services/audit, src/middleware/identity.ts

- [ ] LOOP-AUTH-023: Account recovery + secure email/password change with re-verification
  - Why: Lost-access and credential-change flows are prime takeover vectors and must be hardened end-to-end.
  - Acceptance criteria: Password/email reset uses single-use, short-TTL signed tokens; changing email requires verifying both old+new addresses; recovery notifies the account and offers "this wasn't me" revoke-all.
  - Implementation notes: Token TTL ≤30m, invalidated on use + on password change; rotate all sessions on credential change; throttle reset requests per account.
  - Hosting notes: Workers Container default; no Fly.
  - Backing services: D1 (reset tokens), Resend (notifications), Upstash (throttle).
  - Observability: Axiom recovery.requested/completed + revoke_all with user_id+request_id; alert on burst resets.
  - Dependencies: LOOP-AUTH-001, LOOP-AUTH-004
  - Related files: apps/project-sites/src/auth/better-auth.ts

- [ ] LOOP-AUTH-024: Auth admin console (`/admin/security`) unifying flags, sessions, clients, keys, SSO, audit
  - Why: Solo founder needs one operator surface to run the whole auth platform without spelunking D1.
  - Acceptance criteria: Single console shows + manages: OAuth clients, API keys, SSO connections, active sessions, audit log search, and per-flag rollout of every auth feature; all actions audited.
  - Implementation notes: Angular admin section reusing DialogShellComponent + ApiService (bearer, never raw HttpClient); every new auth feature behind a typed feature flag in D1 `flag_overrides`.
  - Hosting notes: Workers Container default (admin Worker route); no Fly.
  - Backing services: D1, KV (flag cache).
  - Observability: Axiom admin.auth.action with admin_id+target+request_id; PostHog admin-usage; Sentry platform-only.
  - Dependencies: LOOP-AUTH-009, LOOP-AUTH-012, LOOP-AUTH-018, LOOP-AUTH-022
  - Related files: apps/project-sites/frontend (admin security section), src/services/feature_flags.ts

## billing.projectsites.dev — Stripe + OpenMeter

### Raw research themes considered

Mined 50+ raw ideas across the billing surface: per-tenant subscriptions, multi-product metering (AI tokens, API calls, email sends, CRM seats, Listmonk contacts, social posts, browser-automation runs, site visits), prepaid AI-credit wallets, a unified entitlements engine, quota-enforcement middleware reusable across every subsystem, usage rollups into Tinybird, Stripe metered/graduated/tiered prices, customer portal deep-linking, dunning + grace periods + involuntary-churn recovery, annual plan discounts, coupons/promo codes, agency/reseller multi-seat billing, per-site profitability + margin dashboards, usage anomaly detection, and OpenMeter as the ClickHouse-backed metering aggregator. The compounding primitives are three: (1) a **metering pipeline** (event_bus → OpenMeter/Tinybird → Stripe usage records), (2) an **entitlements engine** (plan → limits → live balances cached in KV/DO), and (3) **quota-enforcement middleware** that every product worker calls before doing expensive work. Everything else is a feature layered on those three. OpenMeter runs as a CF Workers Container by default (stateless aggregation API in front of its store); its ClickHouse dependency means we either point it at Tinybird-style ingestion or use OpenMeter Cloud — noted per-task. Money stays in Stripe TEST mode until launch; all pricing numbers are flagged "(needs decision)".

### Selected 24 implementation tasks

- [ ] LOOP-BILL-001: Deploy OpenMeter as a Cloudflare Workers Container with Tinybird-backed event store
  - Why: Central metering aggregator that turns raw usage events into billable meter values; the foundation every metered feature depends on.
  - Acceptance criteria: `billing.projectsites.dev/openmeter/*` returns 200; a posted `events.ingest` event surfaces in a meter query within 60s; container restart loses no data (store is external).
  - Implementation notes: Run OpenMeter (CloudEvents ingest + meter query API) in a container; OpenMeter is ClickHouse-backed, so configure its sink to Tinybird's ClickHouse-compatible ingestion (or OpenMeter Cloud if container ClickHouse proves infeasible — note feasibility in ADR). Validate ingest payloads with Zod before forwarding.
  - Hosting notes: CF Workers Container (stateless aggregator) — NOT Fly.io; no 24/7 stateful socket needed. State lives in Tinybird, not the container.
  - Backing services: Tinybird (`projectsites_events` style datasource for meter raw events), R2 for meter snapshot exports.
  - Observability: Axiom logs with `trace_id` + `tenant_id`; Sentry (platform only) on aggregator errors; PostHog `meter_ingested` count.
  - Dependencies: existing event_bus, Tinybird account.
  - Related files: `apps/project-sites/src/services/billing.ts`, new `src/services/openmeter.ts`, `wrangler.toml` (container binding).

- [ ] LOOP-BILL-002: Build the canonical metering event schema + producer helper `meterEvent()`
  - Why: One typed shape for every usage event across api/mail/crm/social/browser so the pipeline and entitlements engine stay consistent; eliminates per-subsystem drift.
  - Acceptance criteria: `meterEvent({tenant_id, meter, quantity, ts, dims})` validates via Zod, emits to event_bus, and lands in OpenMeter; unit tests cover all 8 meter types.
  - Implementation notes: CloudEvents-compatible envelope with stable `meter` enum (`ai_tokens`, `api_calls`, `email_sends`, `crm_seats`, `listmonk_contacts`, `social_posts`, `browser_runs`, `site_visits`). Idempotency key per event to dedupe retries.
  - Hosting notes: Runs inside each product worker (no separate host); pure helper.
  - Backing services: Upstash Kafka optional buffer for high-throughput meters (browser_runs, site_visits); event_bus → OpenMeter primary path.
  - Observability: structured log per emit with `meter`, `quantity`, `request_id`; PostHog drop-rate metric.
  - Dependencies: LOOP-BILL-001.
  - Related files: new `packages/shared/src/schemas/metering.ts`, `src/services/metering.ts`.

- [ ] LOOP-BILL-003: Entitlements engine — plan→limits resolver with KV-cached live balances
  - Why: Single source of truth for "what is this tenant allowed to do and how much is left"; reused by quota middleware, admin UI, and upgrade prompts.
  - Acceptance criteria: `getEntitlements(tenant_id)` returns `{meter: {limit, used, remaining, reset_at}}` for every meter; cache TTL 60s; cache invalidates on subscription change webhook.
  - Implementation notes: Plan definitions in D1 `plans` + `plan_entitlements`; usage read from OpenMeter meter query; merged + cached in KV. Per-tenant overrides table for custom deals.
  - Hosting notes: Worker-resident; KV cache. No container.
  - Backing services: D1 (plans/entitlements/overrides), KV (balance cache), OpenMeter (usage).
  - Observability: log `entitlements_resolved` with cache hit/miss + `tenant_id`; Sentry on resolver failure (fail-open vs fail-closed is per-meter, see notes).
  - Dependencies: LOOP-BILL-001, LOOP-BILL-002.
  - Related files: new `src/services/entitlements.ts`, `packages/shared/src/constants/ENTITLEMENTS.ts`.

- [ ] LOOP-BILL-004: Quota-enforcement middleware `enforceQuota(meter, cost)` reusable across all workers
  - Why: The compounding primitive — every expensive operation (AI gen, API call, email blast, browser run) gates through one Hono middleware that checks entitlements and 402s when over.
  - Acceptance criteria: requests over quota return RFC7807 402 with `code: quota_exceeded`, remaining=0, upgrade deep-link; under-quota requests pass and increment usage; integration test per meter.
  - Implementation notes: Hono middleware reads `getEntitlements`, decrements optimistically, emits `meterEvent` on success. Soft-limit (warn) vs hard-limit (block) configurable per meter (needs decision on which meters hard-block at launch).
  - Hosting notes: Worker middleware; DO counter for atomic over-limit races on hot meters.
  - Backing services: Durable Object (atomic counter), KV (entitlement cache), OpenMeter.
  - Observability: log `quota_check` with decision + `meter` + `api_key_id`; PostHog `quota_blocked` funnel event.
  - Dependencies: LOOP-BILL-003.
  - Related files: new `src/middleware/enforce_quota.ts`, `src/types/env.ts`.

- [ ] LOOP-BILL-005: Stripe metered-price sync — map each meter to a Stripe billing meter + usage record push
  - Why: Closes the loop from OpenMeter usage to actual Stripe invoices using Stripe's native usage-based billing meters.
  - Acceptance criteria: nightly + on-demand job pushes OpenMeter period totals to Stripe billing meters via `/v1/billing/meter_events`; reconciliation report shows 0 drift; TEST mode.
  - Implementation notes: Use Stripe Billing Meters (not legacy usage records) keyed by `tenant_id` customer. Cron Trigger nightly + Workflow for backfill. Idempotent meter event names.
  - Hosting notes: CF Cron Trigger + Workflow; no container.
  - Backing services: Stripe (TEST), OpenMeter, D1 (reconciliation ledger).
  - Observability: Axiom log per push with `meter`, count, Stripe meter id; Sentry on drift > threshold.
  - Dependencies: LOOP-BILL-001, LOOP-BILL-005 depends on Stripe customers existing (billing.ts).
  - Related files: `src/services/billing.ts`, new `src/workflows/meter-sync.ts`.

- [ ] LOOP-BILL-006: Prepaid AI-credit wallet — purchase, debit, balance, expiry
  - Why: Lets solo/SMB tenants buy credits up front (lower friction than metered post-pay) and is the prepay model for AI generation.
  - Acceptance criteria: tenant buys credits via Stripe Checkout (TEST), balance shows in admin, AI generation debits credits atomically, balance never goes negative, expired credits sweep on cron.
  - Implementation notes: Wallet ledger in D1 (append-only entries: `credit`, `debit`, `expire`); balance = sum, cached in DO for atomic debit. Credit packs priced (needs decision). Debit hooks into `enforceQuota` for `ai_tokens`.
  - Hosting notes: DO for atomic wallet balance; worker for ledger; cron for expiry.
  - Backing services: D1 (ledger), Durable Object (balance), Stripe (purchase).
  - Observability: log `wallet_debit`/`wallet_credit` with `tenant_id`, balance after; PostHog `credits_purchased`.
  - Dependencies: LOOP-BILL-004.
  - Related files: new `src/services/wallet.ts`, `packages/shared/src/schemas/wallet.ts`.

- [ ] LOOP-BILL-007: Plan catalog + checkout — monthly/annual tiers with entitlement bundles
  - Why: The core subscription surface; annual plans capture commitment and reduce churn.
  - Acceptance criteria: pricing page lists tiers; checkout creates Stripe subscription (TEST); annual toggle applies discount; on success entitlements provision within 5s of webhook.
  - Implementation notes: Tiers (Free/Starter/Pro/Agency — names+prices needs decision) defined in D1 `plans` with monthly+annual Stripe price ids. Annual discount % needs decision. Wire `checkout.session.completed` to entitlements provisioning.
  - Hosting notes: Worker; no container.
  - Backing services: Stripe (TEST), D1 (plans), KV (entitlement invalidation).
  - Observability: PostHog checkout funnel; log `subscription_created` with plan + interval.
  - Dependencies: LOOP-BILL-003, existing billing.ts checkout.
  - Related files: `src/services/billing.ts`, `src/routes/api.ts`, `packages/shared/src/constants/PRICING.ts`.

- [ ] LOOP-BILL-008: Stripe Customer Portal deep-linking with feature-scoped return URLs
  - Why: Self-serve plan changes, payment-method updates, invoice history without building UI; reduces founder support load.
  - Acceptance criteria: `/admin/billing` "Manage" button opens portal session; portal config exposes plan switching + cancel + invoices; return URL lands back on the originating admin tab.
  - Implementation notes: Create portal configuration via Stripe API (allowed products, proration behavior). Pass `return_url` per entry point. Cancel flow triggers grace-period (LOOP-BILL-013).
  - Hosting notes: Worker; no container.
  - Backing services: Stripe (TEST).
  - Observability: log `portal_opened` with `tenant_id`; PostHog `portal_session`.
  - Dependencies: LOOP-BILL-007.
  - Related files: `src/services/billing.ts`, frontend admin billing component.

- [ ] LOOP-BILL-009: Usage rollup endpoints in Tinybird for the admin usage dashboard
  - Why: Fast per-tenant, per-meter time-series for the admin "Usage" screen and customer-facing usage bars without hammering OpenMeter.
  - Acceptance criteria: Tinybird pipe returns daily usage by meter for a tenant in <300ms; powers a stacked-area chart; matches OpenMeter totals within 1%.
  - Implementation notes: Tinybird datasource fed from the same metering events; materialized rollup pipes per meter + per tenant. Reuse the `projectsites_events` ingestion pattern.
  - Hosting notes: Tinybird-hosted pipes; worker proxies with auth.
  - Backing services: Tinybird.
  - Observability: log query latency; PostHog dashboard view event.
  - Dependencies: LOOP-BILL-002.
  - Related files: new `tinybird/usage_by_meter.pipe`, `src/routes/api.ts` usage proxy.

- [ ] LOOP-BILL-010: Per-site profitability ledger — revenue vs cost-of-goods per site
  - Why: Solo founder needs to know which generated sites make money vs burn it (AI, bandwidth, container minutes); drives pricing decisions.
  - Acceptance criteria: per-site row shows MRR allocation, metered usage cost, infra cost estimate, margin %; refreshes nightly; sortable in admin.
  - Implementation notes: Cost model in D1 (unit costs: per AI token, per email, per browser run, per GB R2/egress — needs decision on cost constants). Join usage (Tinybird) with revenue (Stripe) keyed by `site_id`. Margin = revenue − COGS.
  - Hosting notes: Cron Trigger + Workflow; no container.
  - Backing services: Tinybird (usage), Stripe (revenue), D1 (cost constants + ledger).
  - Observability: log `profitability_computed`; flag negative-margin sites to Axiom alert.
  - Dependencies: LOOP-BILL-005, LOOP-BILL-009.
  - Related files: new `src/services/profitability.ts`, `src/workflows/margin-rollup.ts`.

- [ ] LOOP-BILL-011: Admin margin dashboard — platform-wide P&L, gross margin, top cost drivers
  - Why: Single-screen financial health for the founder; surfaces blended margin and the meters eating profit.
  - Acceptance criteria: dashboard shows MRR, COGS, gross margin %, margin trend, top-5 cost-driving tenants/meters; date-range selectable; matches Stripe MRR.
  - Implementation notes: Aggregate LOOP-BILL-010 ledger; Tinybird endpoint for trend. Cyan/black admin styling per repo doctrine, `<app-rolling-counter>` for headline stats.
  - Hosting notes: Worker + Tinybird; no container.
  - Backing services: Tinybird, D1, Stripe.
  - Observability: PostHog dashboard view; log query latency.
  - Dependencies: LOOP-BILL-010.
  - Related files: new admin `sections/margin-dashboard` component, `src/routes/api.ts`.

- [ ] LOOP-BILL-012: Dunning engine — failed-payment retry schedule + email sequence
  - Why: Recover involuntary churn (expired cards) automatically; the highest-ROI billing feature for recurring revenue.
  - Acceptance criteria: on `invoice.payment_failed`, schedule retries (e.g. day 1/3/5/7 — needs decision), send escalating emails via Resend, downgrade to grace on final failure; idempotent.
  - Implementation notes: Use Stripe Smart Retries as primary; layer custom email sequence via Resend + Hookdeck-delivered webhook. State machine in D1 `dunning_runs`.
  - Hosting notes: Cron Trigger for retry checks; worker webhook handler.
  - Backing services: Stripe (TEST), Resend (email), D1 (dunning state), Hookdeck+Outpost (webhook delivery).
  - Observability: log each dunning step with `tenant_id`, attempt; PostHog recovery funnel; Sentry on stuck runs.
  - Dependencies: LOOP-BILL-007, LOOP-BILL-013.
  - Related files: `src/routes/webhooks.ts`, new `src/services/dunning.ts`.

- [ ] LOOP-BILL-013: Grace period + soft-suspend state machine
  - Why: Don't hard-cut paying-then-lapsed customers; degrade gracefully and give a recovery window.
  - Acceptance criteria: lapsed subscription enters `grace` (full access, banner) → `suspended` (read-only, 402 on writes) → `cancelled`; transitions timed + reversible on payment; entitlements reflect each state.
  - Implementation notes: Subscription status column in D1 with `grace_until`; entitlements engine returns degraded limits per state. Grace length needs decision (e.g. 7 days).
  - Hosting notes: Cron Trigger evaluates transitions; worker enforces.
  - Backing services: D1 (subscription state), KV (entitlement invalidation).
  - Observability: log state transitions; PostHog `grace_entered`/`recovered`.
  - Dependencies: LOOP-BILL-003.
  - Related files: new `src/services/subscription-state.ts`, `packages/shared/src/schemas/billing.ts`.

- [ ] LOOP-BILL-014: Coupons + promo codes with Stripe Promotion Codes
  - Why: Launch promos, founder-friend discounts, win-back offers without code changes.
  - Acceptance criteria: admin creates a coupon (percent/amount/duration), generates promo codes, applies at checkout; usage limits + expiry enforced by Stripe; admin sees redemption count.
  - Implementation notes: Thin wrapper over Stripe Coupons + Promotion Codes APIs; mirror redemption metadata to D1 for reporting. Restrict stacking (needs decision).
  - Hosting notes: Worker; no container.
  - Backing services: Stripe (TEST), D1 (redemption mirror).
  - Observability: log `coupon_redeemed` with code + `tenant_id`; PostHog promo attribution.
  - Dependencies: LOOP-BILL-007.
  - Related files: new `src/services/coupons.ts`, admin coupons section.

- [ ] LOOP-BILL-015: Agency / reseller billing — parent account, sub-accounts, rolled-up invoice
  - Why: Agencies managing many client sites want one invoice + seat-based pricing; unlocks the highest-value tier.
  - Acceptance criteria: an agency org owns N sub-orgs; usage aggregates to the parent; one consolidated Stripe invoice; per-sub-account usage breakdown visible.
  - Implementation notes: Org hierarchy in D1 (`parent_org_id`); entitlements resolve at parent for pooled meters, per-sub for seats. Agency pricing model needs decision (seat + pooled usage). Reuse RBAC middleware.
  - Hosting notes: Worker; no container.
  - Backing services: Stripe (TEST, one customer per agency), D1 (org tree), OpenMeter (rollup by parent).
  - Observability: log `agency_invoice_built`; PostHog agency cohort.
  - Dependencies: LOOP-BILL-005, LOOP-BILL-016.
  - Related files: `packages/shared/src/middleware/rbac`, new `src/services/agency-billing.ts`.

- [ ] LOOP-BILL-016: CRM seat + Listmonk contact metering with seat-change proration
  - Why: Twenty CRM seats and Listmonk contact counts are recurring quantity-based charges; need accurate, prorated metering.
  - Acceptance criteria: adding/removing a CRM seat updates Stripe subscription quantity with proration; Listmonk contact count meters daily high-water-mark; both reflected in entitlements.
  - Implementation notes: Seats = Stripe licensed (quantity) price with proration; contacts = metered high-watermark via OpenMeter `MAX` aggregation. Poll Twenty/Listmonk admin APIs daily or subscribe to their events.
  - Hosting notes: Cron Trigger pollers (workers); CRM/Listmonk run in their own containers already.
  - Backing services: Stripe (TEST), OpenMeter, D1, Twenty + Listmonk APIs.
  - Observability: log `seat_changed`/`contacts_metered` with counts; Sentry on poll failure.
  - Dependencies: LOOP-BILL-002, LOOP-BILL-005.
  - Related files: new `src/services/seat-billing.ts`, cron entries.

- [ ] LOOP-BILL-017: Email-send + social-post + browser-run metering wired into product workers
  - Why: Operationalizes metering for the three usage-heavy products by calling `meterEvent` + `enforceQuota` at the real call sites.
  - Acceptance criteria: each Resend send emits `email_sends`, each Postiz post emits `social_posts`, each browser-automation job emits `browser_runs`; over-quota blocks with 402; usage visible in dashboard.
  - Implementation notes: Insert `enforceQuota` before the action and `meterEvent` after success in mail/social/browser services. Free-tier allowances per meter (needs decision). Browser runs metered by run + duration tier.
  - Hosting notes: Worker call sites; browser automation may run in its own container — emit event from the orchestrating worker.
  - Backing services: OpenMeter, Resend, Postiz (HTTP boundary), browser-rendering binding.
  - Observability: log per emit with `meter` + `job_id`; PostHog usage-by-product.
  - Dependencies: LOOP-BILL-004.
  - Related files: `src/services/notifications.ts`, `src/services/postiz.ts` (if present), browser service.

- [ ] LOOP-BILL-018: Usage anomaly detection — spike + cost-runaway alerts
  - Why: Catch a runaway AI loop, abuse, or a buggy site burning credits before it bankrupts margin; protects both tenant and platform.
  - Acceptance criteria: per-tenant per-meter baseline computed; a >Nx spike (needs decision on multiplier) triggers an Axiom alert + optional auto-throttle + tenant email; false-positive rate tracked.
  - Implementation notes: Tinybird pipe computes rolling baseline + z-score; cron evaluates; breach → notification + optional `enforceQuota` tighten. Auto-throttle behind a flag (default off).
  - Hosting notes: Cron Trigger + Tinybird; no container.
  - Backing services: Tinybird (baseline), Axiom (alert), Resend (tenant email), D1 (anomaly log).
  - Observability: log `anomaly_detected` with meter + magnitude; PostHog anomaly cohort.
  - Dependencies: LOOP-BILL-009.
  - Related files: new `tinybird/usage_anomaly.pipe`, `src/services/anomaly.ts`.

- [ ] LOOP-BILL-019: App add-ons marketplace billing — one-time + recurring per-site add-ons
  - Why: Monetize optional capabilities (extra storage, premium templates, voice, custom domain) as à-la-carte add-ons on top of base plans.
  - Acceptance criteria: add-on catalog in admin; tenant purchases per-site add-on via Checkout (TEST); add-on grants an entitlement override; removable with proration.
  - Implementation notes: Add-ons = Stripe prices attached as subscription items or one-time; each maps to an entitlement key in the overrides table. Add-on pricing needs decision.
  - Hosting notes: Worker; no container.
  - Backing services: Stripe (TEST), D1 (add-on catalog + grants), KV (entitlement invalidation).
  - Observability: log `addon_purchased`; PostHog add-on attach-rate.
  - Dependencies: LOOP-BILL-003, LOOP-BILL-007.
  - Related files: new `src/services/addons.ts`, admin add-ons section.

- [ ] LOOP-BILL-020: Plan-limit + quota live UI — usage bars, "X of Y used", upgrade nudges
  - Why: Turns invisible quotas into a conversion surface; users see they're near a limit and self-serve upgrade (Extra-Mile: empty space → upgrade CTA).
  - Acceptance criteria: admin shows per-meter progress bars from entitlements; ≥80% shows amber + upgrade link; 100% shows blocking state with deep-link to checkout; bars update on action.
  - Implementation notes: Read `getEntitlements`; reusable `<usage-meter>` component (cyan/black). Upgrade CTA deep-links to the cheapest plan that lifts the hit limit (computed).
  - Hosting notes: Worker API + Angular frontend.
  - Backing services: entitlements engine, KV cache.
  - Observability: PostHog `limit_warning_shown`/`upgrade_clicked`; log nudge impressions.
  - Dependencies: LOOP-BILL-003, LOOP-BILL-007.
  - Related files: new admin `usage-meter` component, `src/routes/api.ts` entitlements endpoint.

- [ ] LOOP-BILL-021: Idempotent billing webhook handler hardening via Hookdeck + Outpost
  - Why: Stripe webhooks must never double-process (double-grant credits, double-dun); Hookdeck gives reliable inbound delivery + retries past Bot Fight Mode.
  - Acceptance criteria: every Stripe event processed exactly once (D1 idempotency key on `event.id`); replays no-op; signature verified; dead-letter to R2 on handler failure; receiver hosted to bypass Bot Fight Mode.
  - Implementation notes: Route Stripe → Hookdeck → worker (workers.dev receiver per BFM memory). D1 `processed_webhooks` table; Outpost for any outbound billing webhooks to tenants. Verify Stripe signature before Hookdeck-trust.
  - Hosting notes: Worker receiver on workers.dev (BFM bypass); Hookdeck+Outpost managed.
  - Backing services: Stripe, Hookdeck+Outpost, D1 (idempotency), R2 (dead-letter).
  - Observability: log every event with `event.id` + dedupe decision; Sentry on dead-letter; Axiom delivery metrics.
  - Dependencies: existing webhooks.ts.
  - Related files: `src/routes/webhooks.ts`, new `src/services/webhook-idempotency.ts`.

- [ ] LOOP-BILL-022: Invoice + receipt branding + tax/VAT handling (Stripe Tax)
  - Why: Professional invoices with correct tax are table-stakes for SMB/agency customers and reduce compliance risk.
  - Acceptance criteria: invoices carry ProjectSites branding; Stripe Tax computes VAT/sales tax by customer location; tax-exempt agencies supported; PDF accessible in portal.
  - Implementation notes: Enable Stripe Tax (TEST); collect customer tax location at checkout; configure invoice branding via Stripe settings + custom fields. Tax registration scope needs decision (which jurisdictions at launch).
  - Hosting notes: Stripe-managed; worker only configures.
  - Backing services: Stripe Tax (TEST).
  - Observability: log `invoice_finalized` with tax amount; Sentry on tax calc error.
  - Dependencies: LOOP-BILL-007.
  - Related files: `src/services/billing.ts`.

- [ ] LOOP-BILL-023: Billing audit ledger — every money/entitlement mutation as an append-only event
  - Why: Distinguished-engineer requirement; reconstruct any tenant's billing state and debug disputes; feeds reconciliation.
  - Acceptance criteria: every charge, refund, credit grant/debit, entitlement change, plan switch writes an immutable ledger row with `correlation_id`; admin can replay a tenant's full billing timeline.
  - Implementation notes: Append-only D1 `billing_audit` table; reuse existing audit service pattern (`src/services/audit.ts`). Mirror to Tinybird for long-range queries. Never UPDATE/DELETE rows.
  - Hosting notes: Worker; D1 + Tinybird.
  - Backing services: D1 (ledger), Tinybird (archive).
  - Observability: every row IS the observability record; cross-link `correlation_id` to Axiom logs.
  - Dependencies: LOOP-BILL-006, LOOP-BILL-007, LOOP-BILL-013.
  - Related files: `src/services/audit.ts`, new `packages/shared/src/schemas/billing-audit.ts`.

- [ ] LOOP-BILL-024: Billing feature-flag + kill-switch gating for the whole metered-billing rollout
  - Why: Money features must dark-launch and be instantly disable-able; per repo doctrine every feature ships behind a typed flag at `enabled=0, rollout=0, stage=experimental`.
  - Acceptance criteria: flags `metered_billing`, `ai_credit_wallet`, `dunning`, `usage_anomaly`, `agency_billing` exist in D1 + `/admin/feature-flags`; disabled → endpoints 404 + UI null; killswitch instantly halts metering writes without redeploy.
  - Implementation criteria/notes: Each billing module reads `isFlagOn(env, key, ...)`; metering producers no-op when killswitched (usage still logged to Axiom for backfill). Reuse `feature_flags`/`flag_overrides` tables.
  - Hosting notes: Worker; KV-cached flags.
  - Backing services: D1 (flag tables), KV (flag cache).
  - Observability: log flag decision with `featureSlug`; PostHog flag exposure.
  - Dependencies: all prior — this is the rollout gate.
  - Related files: `apps/project-sites/src/services/feature_flags.ts`, each billing service entrypoint.

## webhooks.projectsites.dev — Hookdeck + Outpost

### Raw research themes considered

Mined 50+ raw ideas across inbound ingestion (Hookdeck-fronted receivers behind a Bot-Fight-Mode-safe host), outbound customer delivery (self-hosted Outpost, Go + Postgres/Redis, Container-feasible), retry/backoff policy, event replay, HMAC signing + key rotation, customer endpoint CRUD + verification, tenant-isolated delivery logs, a webhook testing/inspector UI, source-event mapping (app lifecycle / billing / API-key / CRM / Listmonk / Postiz / Chatwoot / domain / provisioning), rate limiting per endpoint, JSONata/JS event transformations, dead-letter handling, fanout, and admin incident tooling. The compounding primitives are: ONE canonical platform event envelope (the SSOT every other subsystem emits into the existing D1 `event_bus` outbox), a shared HMAC signing/verification library, a tenant-scoped delivery-log store, a replay engine, and a DLQ — these recur in every task so each subsystem inherits them for free. Strategic constraints baked in: Workers Containers default (Outpost as a Container-DO; Fly only if 24-7 stateful pressure forces it), Neon/Upstash/R2/Tinybird/Upstash-Kafka backing, Axiom logs, PostHog product analytics, Sentry platform-only, and structured correlation IDs on every hop. The existing 5-min `event_bus` drain to Tinybird is the seam we extend rather than replace.

### Selected 24 implementation tasks

- [ ] LOOP-HOOK-001: Canonical platform event envelope + Zod registry (`PlatformEvent` SSOT)
  - Why: Every subsystem currently emits ad-hoc shapes into `event_bus`; a single typed envelope makes signing, replay, fanout, and customer delivery uniform and is the primitive all other HOOK tasks build on.
  - Acceptance criteria: `PlatformEvent` Zod schema with `id` (UUIDv7), `type` (dot.namespaced enum e.g. `site.published`), `version` (semver), `tenant_id`, `occurred_at`, `idempotency_key`, `correlation` block (trace_id/site_id/app_id/api_key_id/request_id), `data` (per-type discriminated union); a frozen `EVENT_TYPE_REGISTRY` listing every emitted type with its data schema; `parsePlatformEvent()` round-trips and rejects unknown types; published from `packages/shared/src/schemas/events.ts`.
  - Implementation notes: Discriminated union keyed on `type`; version every payload so transformations/replay can target old shapes; export `EventType` literal union for exhaustive switch checks.
  - Hosting notes: Pure library, no host — consumed by Worker + Outpost client.
  - Backing services: None (schema only); persisted into existing D1 `event_bus`.
  - Observability: N/A (schema), but every field doubles as a structured-log correlation field downstream.
  - Dependencies: None — foundational.
  - Related files: `packages/shared/src/schemas/events.ts`, `apps/project-sites/src/services/db.ts` (event_bus writer).

- [ ] LOOP-HOOK-002: `emitEvent()` outbox writer wired to existing D1 `event_bus`
  - Why: Subsystems need one safe, idempotent call to publish a `PlatformEvent`; centralizing it guarantees envelope validation, idempotency, and correlation capture at the single write point.
  - Acceptance criteria: `emitEvent(c, type, data, opts?)` validates via LOOP-HOOK-001, computes `idempotency_key` (default `hash(type+tenant_id+stableData)`), inserts into `event_bus` with `status='pending'`, dedupes on `(tenant_id, idempotency_key)` via `INSERT … ON CONFLICT DO NOTHING WHERE deleted_at IS NULL`; returns the stored row; unit tests cover dedupe + validation failure.
  - Implementation notes: Pull `correlation` from Hono context vars (request_id/trace_id/tenant_id) automatically; never throw into the request path — failures logged + counted, not surfaced to caller.
  - Hosting notes: Runs inline in the project-sites Worker.
  - Backing services: D1 `event_bus`.
  - Observability: Axiom log `event.emitted` with type+tenant_id+event_id; PostHog `event_emitted` counter.
  - Dependencies: LOOP-HOOK-001.
  - Related files: `apps/project-sites/src/services/events.ts`, `apps/project-sites/src/services/db.ts`.

- [ ] LOOP-HOOK-003: Outpost outbound-delivery service on Cloudflare Workers Containers
  - Why: Outpost (open-source, Go) is the chosen outbound delivery engine; standing it up gives customers real webhook delivery with retries/DLQ without building from scratch and without Svix.
  - Acceptance criteria: Outpost runs as a Container-DO reachable at `webhooks.projectsites.dev` (internal admin API on private route); config points at Neon Postgres + Upstash Redis; `/healthz` 200; a smoke publish results in one delivered test event to a mock endpoint; image built on amd64 CI per CF native-arch rule.
  - Implementation notes: Outpost needs Postgres + Redis + a log/stream — use Upstash Kafka for its event log (needs decision: Kafka vs Redis-streams mode). Container default chosen; revisit Fly ONLY if sustained 24-7 delivery load or long-lived consumer connections exceed Container request/duration limits — state that in the ADR.
  - Hosting notes: Workers Containers (Outpost is stateless-compute over external state → Container-feasible). `/dev/shm` mkdir in entrypoint per CF-containers gotcha.
  - Backing services: Neon (`projectsites_outpost`), Upstash Redis, Upstash Kafka, R2 for attachment/large-payload offload.
  - Observability: Axiom log shipping from container stdout; Sentry NOT wired (platform-only) — container errors go to Axiom + platform Sentry via the Worker proxy only.
  - Dependencies: LOOP-HOOK-001.
  - Related files: `apps/project-sites/containers/outpost/Dockerfile`, `apps/project-sites/wrangler.toml`, `docs/decisions/outpost-hosting.md`.

- [ ] LOOP-HOOK-004: Bot-Fight-Mode-safe inbound receiver host
  - Why: Repo memory — CF Bot Fight Mode challenges inbound M2M webhooks; without a safe host every external provider webhook (Stripe/SNS/etc.) silently fails the challenge.
  - Acceptance criteria: Inbound receiver served on a dedicated host that bypasses BFM — either a `*.workers.dev` URL OR a zone WAF skip rule scoped to the receiver host/paths; an automated test posts an unsigned request and asserts 200 (no challenge HTML); decision + rule documented.
  - Implementation notes: Prefer the WAF skip on `webhooks.projectsites.dev/in/*` (mirrors the existing `/api/mcp` + `/oauth/*` skip rule) so the customer-facing host stays branded; fall back to workers.dev if WAF skip can't be scoped tightly (needs decision).
  - Hosting notes: Receiver is a Worker route; WAF skip via CF API (global key).
  - Backing services: None at this layer.
  - Observability: Axiom log `inbound.received` with source + request_id; alert if challenge-HTML detected in self-probe.
  - Dependencies: None (infra), unblocks LOOP-HOOK-005+.
  - Related files: `apps/project-sites/src/routes/webhooks_in.ts`, `apps/project-sites/wrangler.toml` (routes), WAF rule (CF API).

- [ ] LOOP-HOOK-005: Hookdeck inbound gateway integration + connection registry
  - Why: Hookdeck fronts inbound webhooks (ingestion, retries, fan-in) so the Worker only handles verified, deduped events; a registry maps each Hookdeck source to its handler.
  - Acceptance criteria: Hookdeck source → destination connection points at the LOOP-HOOK-004 receiver; a typed `INBOUND_SOURCE_REGISTRY` maps `source_name → {verifier, normalizer→PlatformEvent}`; Hookdeck signature verified on every inbound; one real provider (Stripe) end-to-end produces a normalized `PlatformEvent`.
  - Implementation notes: Verify Hookdeck's own signature first, then the original provider signature (double-verify); normalize into LOOP-HOOK-001 envelope before anything else touches it.
  - Hosting notes: Hookdeck is SaaS gateway; receiver Worker on BFM-safe host.
  - Backing services: D1 for connection registry rows; Hookdeck (external).
  - Observability: Axiom `inbound.normalized` with source+event_type; PostHog funnel `received→verified→normalized`.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-004.
  - Related files: `apps/project-sites/src/services/inbound_registry.ts`, `apps/project-sites/src/routes/webhooks_in.ts`.

- [ ] LOOP-HOOK-006: Shared HMAC signing + verification library (`webhook-sig`)
  - Why: Both inbound verification and outbound customer signing need one constant-time, versioned signature primitive; duplicating crypto per call site is the classic footgun.
  - Acceptance criteria: `signPayload(secret, body, {ts})` → `t=<unix>,v1=<hex>` header; `verifySignature(secret, body, header, {toleranceSec})` constant-time compare with replay-window guard; supports key rotation (accepts multiple active secrets); Web Crypto only (Workers-compatible); 100% branch test coverage incl. tampered body, stale timestamp, rotated key.
  - Implementation notes: Stripe-style `t=,v1=` scheme so customers reuse existing libs; export both Worker (Web Crypto) and a documented parity for Outpost's signer (needs decision: let Outpost sign natively vs Worker pre-signs).
  - Hosting notes: Library — bundled into Worker; mirrored config into Outpost.
  - Backing services: None.
  - Observability: N/A (lib); callers log `sig.verify.fail` reason codes.
  - Dependencies: None.
  - Related files: `packages/shared/src/utils/webhook-sig.ts`.

- [ ] LOOP-HOOK-007: Customer endpoint management (CRUD + per-event-type subscription)
  - Why: Customers must register, edit, and disable their outbound webhook endpoints and choose which event types they receive — core product surface for outbound webhooks.
  - Acceptance criteria: D1 `webhook_endpoints` (tenant_id, url, description, status, subscribed_types[], created_at); REST `POST/GET/PATCH/DELETE /api/webhooks/endpoints`; Zod-validated `url` (https-only, no private IPs — SSRF guard); subscription stored as type globs (`billing.*`); admin UI list + form via `DialogShellComponent`; every mutation tenant-scoped via `c.get('orgId')` (never client header).
  - Implementation notes: Reuse Outpost's destination model where possible — Worker CRUD is the system-of-record, syncs to Outpost via its admin API; SSRF allowlist/denylist per `server-fetched-url-validation` memory.
  - Hosting notes: Worker API + Angular admin; Outpost stores delivery config.
  - Backing services: D1 system-of-record + Outpost (Neon) mirror.
  - Observability: Axiom `endpoint.created/updated/deleted` with endpoint_id+tenant_id; PostHog feature usage.
  - Dependencies: LOOP-HOOK-003.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, `libs/features/customer_webhooks/`, admin component.

- [ ] LOOP-HOOK-008: Per-endpoint signing secret generation + rotation
  - Why: Each customer endpoint needs its own secret so they can verify our deliveries; rotation must be zero-downtime (overlap window) to avoid breaking live receivers.
  - Acceptance criteria: On endpoint create, generate `whsec_<random>`; `POST /api/webhooks/endpoints/:id/rotate-secret` issues a new secret while keeping the old valid for a configurable grace window (default 24h, both signed during overlap); secret shown once, stored hashed-at-rest reference + encrypted material; UI surfaces "rotate" with grace-window copy.
  - Implementation notes: During overlap, sign with BOTH secrets (two `v1=` values) per LOOP-HOOK-006 multi-key support so customers cut over seamlessly.
  - Hosting notes: Worker; secret material in D1 encrypted (or Outpost secret store) — needs decision on at-rest encryption key location.
  - Backing services: D1 / Outpost secret store.
  - Observability: Axiom `endpoint.secret.rotated` (no secret value logged); alert on endpoints never rotated >180d.
  - Dependencies: LOOP-HOOK-006, LOOP-HOOK-007.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, `packages/shared/src/utils/webhook-sig.ts`.

- [ ] LOOP-HOOK-009: Retry policy engine (exponential backoff + jitter, per-endpoint override)
  - Why: Customer endpoints fail transiently; a deterministic, bounded retry schedule with jitter is the difference between resilient delivery and thundering-herd self-DDoS.
  - Acceptance criteria: Default schedule (e.g. 0s,30s,2m,10m,1h,6h,24h then DLQ) configurable per endpoint; jitter ±20%; retries triggered on 5xx/timeout/connection-error, NOT on 4xx (except 429 honoring Retry-After); attempt count + next_attempt_at persisted; unit tests assert schedule + jitter bounds + 4xx-no-retry.
  - Implementation notes: Lean on Outpost's native retry engine where it covers this; expose per-endpoint overrides through Worker config that syncs to Outpost. For Worker-side internal fanout retries, use Upstash QStash schedules as the timer.
  - Hosting notes: Outpost-native delivery retries; QStash for any Worker-orchestrated retries.
  - Backing services: Outpost (Neon/Redis), Upstash QStash.
  - Observability: Axiom `delivery.retry` with attempt+next_delay+endpoint_id; PostHog retry-rate metric.
  - Dependencies: LOOP-HOOK-003, LOOP-HOOK-010.
  - Related files: `apps/project-sites/src/services/delivery_policy.ts`, Outpost config.

- [ ] LOOP-HOOK-010: Tenant-isolated delivery-log store + customer-facing log API
  - Why: Customers need to see every attempt for their endpoints (status, response code, latency, body snippet) to self-debug — and it MUST be strictly tenant-isolated.
  - Acceptance criteria: Delivery attempts persisted (event_id, endpoint_id, tenant_id, attempt_no, http_status, duration_ms, request/response headers+truncated body, error_code, timestamp); `GET /api/webhooks/deliveries?endpoint_id=&status=&since=` returns ONLY the caller's tenant rows (orgId from context); cursor pagination; redaction of secrets/PII in stored bodies; E2E proves tenant A cannot read tenant B's logs.
  - Implementation notes: Write attempts to Tinybird (high-volume, analytics-friendly) as system-of-record for logs, with a hot recent slice in D1/Upstash for fast UI; truncate bodies to a cap, offload full payloads to R2 keyed `deliveries/{tenant_id}/{event_id}/{attempt}.json`.
  - Hosting notes: Worker API reads Tinybird endpoint + R2; Outpost emits attempt records.
  - Backing services: Tinybird (log store), R2 (full bodies), Upstash/D1 (hot cache).
  - Observability: Axiom `delivery.logged`; every row carries the full correlation ID set.
  - Dependencies: LOOP-HOOK-003, LOOP-HOOK-001.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, Tinybird datasource `webhook_deliveries`, `apps/project-sites/src/services/delivery_logs.ts`.

- [ ] LOOP-HOOK-011: Event replay engine (single + bulk, by filter)
  - Why: When an endpoint was down or buggy, customers and admins must replay missed events without duplicating side effects elsewhere — a core reliability primitive.
  - Acceptance criteria: `POST /api/webhooks/deliveries/:id/replay` re-delivers one event; `POST /api/webhooks/replay` with filter (endpoint_id, type, time range, status=failed) bulk-replays; replays carry original `event_id` + a new `delivery_id` + `replayed_from` header so receivers can dedupe; replays respect current endpoint config; bulk replay is rate-capped + previewed (count before confirm).
  - Implementation notes: Replay reads from `event_bus`/Tinybird, re-enqueues through the same delivery path; idempotency_key preserved so well-behaved receivers no-op duplicates.
  - Hosting notes: Worker orchestrates; Outpost delivers.
  - Backing services: event_bus (D1), Tinybird (source selection), Upstash QStash (bulk pacing).
  - Observability: Axiom `delivery.replayed` with origin+count; PostHog admin-action event.
  - Dependencies: LOOP-HOOK-010, LOOP-HOOK-003.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, `apps/project-sites/src/services/replay.ts`.

- [ ] LOOP-HOOK-012: Dead-letter queue + automatic disable of dead endpoints
  - Why: Endpoints that exhaust retries must land in a DLQ (not vanish) and chronically-failing endpoints must auto-disable to stop wasting delivery budget and to alert the customer.
  - Acceptance criteria: After final retry, event lands in DLQ table (tenant-scoped) with last error; endpoint auto-disables after configurable consecutive-failure threshold (default 50 over 24h) → status `disabled_unhealthy` + customer notification; DLQ items are replayable (reuses LOOP-HOOK-011); admin + customer DLQ views.
  - Implementation notes: Mirror Upstash QStash DLQ semantics; store DLQ in R2 (full payload) + index in D1/Tinybird; auto-disable decision evaluated on each terminal failure.
  - Hosting notes: Worker logic; Outpost emits terminal-failure signal.
  - Backing services: R2 (DLQ payloads), D1 (index), Upstash QStash DLQ (if QStash path used).
  - Observability: Axiom `delivery.deadlettered` + `endpoint.auto_disabled`; alert to platform on auto-disable spikes.
  - Dependencies: LOOP-HOOK-009, LOOP-HOOK-011.
  - Related files: `apps/project-sites/src/services/dlq.ts`, admin + customer DLQ components.

- [ ] LOOP-HOOK-013: Webhook testing UI — send test event + live inspector
  - Why: Customers can't trust a webhook they can't test; a "Send test event" button + live request inspector dramatically cuts setup friction and support load.
  - Acceptance criteria: Admin/customer UI to pick an event type, edit a sample payload (pre-filled from registry example), fire to a chosen endpoint, and see the live attempt result (status, latency, response body) inline; a unique inspector URL (ephemeral, like RequestBin) lets customers point a source at us and watch raw requests arrive in real time; gorgeous cyan/black per brand.
  - Implementation notes: Inspector backed by a Durable Object holding the last N captured requests per ephemeral token (TTL'd); SSE/WebSocket stream to the UI; sample payloads sourced from EVENT_TYPE_REGISTRY examples.
  - Hosting notes: Worker + DO (inspector buffer); Angular admin UI.
  - Backing services: Durable Object (ephemeral capture), R2 (optional capture archive).
  - Observability: Axiom `test_event.sent` + `inspector.session.opened`; PostHog activation metric (endpoint verified within first session).
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-007, LOOP-HOOK-010.
  - Related files: `libs/features/customer_webhooks/inspector/`, `apps/project-sites/src/routes/webhooks.ts`, inspector DO.

- [ ] LOOP-HOOK-014: App lifecycle event source (site/app create, deploy, publish, delete)
  - Why: The most-wanted customer webhooks are "my site published / deploy finished"; wiring lifecycle into the envelope makes the platform's core actions observable and automatable.
  - Acceptance criteria: Emit `site.created`, `site.published`, `site.deploy.succeeded/failed`, `site.deleted`, `app.provisioned/deprovisioned` via `emitEvent()` at the real state-transition points; each has a registered Zod data schema + example; an E2E publishing a site asserts `site.published` reaches a subscribed test endpoint.
  - Implementation notes: Hook into existing site-generation workflow + deploy paths; emit AFTER the durable state change commits (outbox pattern) so events never lie.
  - Hosting notes: Inline in Worker / Workflow.
  - Backing services: D1 event_bus.
  - Observability: Axiom per-emit; PostHog product funnel.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-002.
  - Related files: `apps/project-sites/src/workflows/site-generation.ts`, `apps/project-sites/src/services/site_serving.ts`, `events.ts`.

- [ ] LOOP-HOOK-015: Billing event source (Stripe-derived → normalized platform events)
  - Why: Customers want `invoice.paid`, `subscription.updated`, `payment.failed` on THEIR endpoints without integrating Stripe directly; we re-emit normalized, tenant-scoped billing events.
  - Acceptance criteria: Existing Stripe webhook handler maps relevant Stripe events → `billing.*` PlatformEvents scoped to the owning tenant; sensitive fields stripped (no raw card/PII); subscribed customers receive normalized events; E2E with a Stripe test event asserts a `billing.invoice.paid` delivery.
  - Implementation notes: Reuse the existing Stripe webhook receiver; map → envelope → emitEvent; resolve tenant_id from Stripe customer metadata.
  - Hosting notes: Inline in Worker (Stripe receiver on BFM-safe host).
  - Backing services: D1 event_bus, Stripe (source).
  - Observability: Axiom `billing.event.normalized`; correlation includes stripe_event_id.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-002, LOOP-HOOK-004.
  - Related files: `apps/project-sites/src/routes/webhooks.ts` (stripe), `events.ts`.

- [ ] LOOP-HOOK-016: API key lifecycle event source (created, rotated, revoked, used-first-time)
  - Why: Security-conscious customers want notifications on key events; these also feed audit + anomaly detection across the platform.
  - Acceptance criteria: Emit `apikey.created`, `apikey.rotated`, `apikey.revoked`, `apikey.first_use`, `apikey.suspicious_use` at the real key-management code paths; payloads carry `api_key_id` (never the secret); subscribed endpoints receive them; unit test asserts secret never appears in payload.
  - Implementation notes: Hook into the existing API-key service; `first_use`/`suspicious_use` derived from request telemetry (new IP/ASN).
  - Hosting notes: Inline Worker.
  - Backing services: D1 event_bus; Tinybird (usage telemetry for suspicious-use).
  - Observability: Axiom `apikey.event`; ties into platform audit log.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-002.
  - Related files: `apps/project-sites/src/services/auth.ts`, `events.ts`.

- [ ] LOOP-HOOK-017: Provisioning + domain event source (custom domain, DNS, TLS, service provisioning)
  - Why: Long-running provisioning (custom domains, TLS issuance, container app provisioning) is exactly where customers want async notifications instead of polling.
  - Acceptance criteria: Emit `domain.added`, `domain.verified`, `domain.tls.issued`, `domain.failed`, `provisioning.started/succeeded/failed` from the domains + provisioning services; payloads carry domain + status + failure_reason; E2E adding a domain asserts `domain.added` delivery.
  - Implementation notes: Wire into existing `services/domains.ts`; TLS/verification transitions emit on the actual CF API callback/poll resolution.
  - Hosting notes: Inline Worker; provisioning may originate from Container-DOs that call back into emitEvent.
  - Backing services: D1 event_bus; CF API (domain state).
  - Observability: Axiom `provisioning.event` with domain+correlation.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-002.
  - Related files: `apps/project-sites/src/services/domains.ts`, `events.ts`.

- [ ] LOOP-HOOK-018: Integrated-service event ingestion (Listmonk, Postiz, Chatwoot, CRM)
  - Why: The platform's bundled services emit their own webhooks; normalizing them into the envelope lets customers subscribe to `email.*`, `social.*`, `chat.*`, `crm.*` through ONE unified webhook system instead of N vendor integrations.
  - Acceptance criteria: Inbound receivers + normalizers for Listmonk (campaign/bounce/subscriber), Postiz (post published/failed), Chatwoot (conversation/message), and CRM (contact/deal) events; each verifies the source signature, maps to a registered `PlatformEvent` type, resolves tenant_id, and emits; one E2E per source proves normalization.
  - Implementation notes: Register each in `INBOUND_SOURCE_REGISTRY` (LOOP-HOOK-005); Listmonk/Chatwoot/Postiz are self-hosted so signature schemes are ours to set — use HMAC shared secret per LOOP-HOOK-006; CRM is Twenty.
  - Hosting notes: Receivers on BFM-safe host; sources are existing Container/Fly services.
  - Backing services: D1 event_bus; Hookdeck (optional fronting).
  - Observability: Axiom `inbound.normalized` tagged per source.
  - Dependencies: LOOP-HOOK-005, LOOP-HOOK-001.
  - Related files: `apps/project-sites/src/services/inbound_registry.ts`, `apps/project-sites/src/routes/webhooks_in.ts`.

- [ ] LOOP-HOOK-019: Event transformations (per-endpoint payload mapping)
  - Why: Customers' receivers expect their own shapes; per-endpoint transformations let them reshape/filter our payloads without us hardcoding integrations — a high-leverage power feature.
  - Acceptance criteria: Per-endpoint optional transformation (JSONata expression, sandboxed) applied to the envelope before delivery; transform validated + dry-run-tested in the UI against a sample event before save; transform errors fail safe (deliver original + flag) and are logged; CPU/time-bounded execution.
  - Implementation notes: Prefer Outpost-native transformation if available; else a sandboxed JSONata evaluator in the Worker. (needs decision: JSONata vs a constrained JS subset — JSONata is safer/non-Turing-complete.)
  - Hosting notes: Worker (or Outpost) at delivery time.
  - Backing services: D1 (transform config).
  - Observability: Axiom `transform.applied/failed` with endpoint_id; PostHog adoption.
  - Dependencies: LOOP-HOOK-007, LOOP-HOOK-003.
  - Related files: `apps/project-sites/src/services/transform.ts`, customer_webhooks UI.

- [ ] LOOP-HOOK-020: Per-endpoint + per-tenant delivery rate limiting
  - Why: A customer's fragile endpoint or a noisy event spike must not be hammered; rate limiting protects both their infra and our delivery budget.
  - Acceptance criteria: Configurable max deliveries/sec + concurrency per endpoint (default e.g. 50/s, 10 concurrent); excess queued (not dropped) and paced; per-tenant global ceiling; 429 from a customer endpoint with Retry-After is honored; tests assert pacing under burst.
  - Implementation notes: Use Upstash Redis sliding-window counters (per `rate-limiting-plan-gated` memory — CF managed RL doesn't enforce on this plan, so DO/Redis counter is the fix); Outpost concurrency caps where supported.
  - Hosting notes: Worker + Upstash Redis; Outpost concurrency config.
  - Backing services: Upstash Redis.
  - Observability: Axiom `delivery.throttled` with endpoint_id+window; PostHog throttle metric.
  - Dependencies: LOOP-HOOK-003, LOOP-HOOK-007.
  - Related files: `apps/project-sites/src/services/delivery_policy.ts`, `apps/project-sites/src/middleware/`.

- [ ] LOOP-HOOK-021: Webhook fanout + ordering guarantees
  - Why: One platform event often targets many subscribed endpoints; fanout must be efficient, isolated (one slow endpoint can't block others), and offer per-endpoint ordering where it matters.
  - Acceptance criteria: A single `PlatformEvent` fans out to all matching endpoints (type-glob match) as independent delivery jobs; per-endpoint FIFO ordering option (default best-effort, optional strict-ordered via partition key = endpoint_id); slow/failing endpoint does not delay siblings; test asserts isolation + ordered mode preserves sequence.
  - Implementation notes: Use Upstash Kafka partitioned by endpoint_id for strict ordering; default path is independent QStash/Outpost jobs. Matching uses subscribed_types globs from LOOP-HOOK-007.
  - Hosting notes: Worker fanout dispatch; Outpost/Upstash Kafka delivery.
  - Backing services: Upstash Kafka (ordered), Upstash QStash (default), Outpost.
  - Observability: Axiom `event.fanout` with matched_endpoint_count; per-delivery correlation preserves event_id.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-007, LOOP-HOOK-003.
  - Related files: `apps/project-sites/src/services/fanout.ts`, Outpost config.

- [ ] LOOP-HOOK-022: Strict multi-tenant isolation guardrails + tests across the whole webhook plane
  - Why: Customer-facing delivery logs, endpoints, secrets, and replays are prime IDOR targets; isolation must be enforced and continuously proven, not assumed.
  - Acceptance criteria: Every webhook read/write derives tenant_id from `c.get('orgId')` (NEVER a client `x-org-id` header) per x-org-id-IDOR memory; a shared `assertTenantOwns(resource, orgId)` guard wraps endpoint/delivery/DLQ/replay access; a dedicated E2E suite attempts cross-tenant access on every webhook route and asserts 404; storage keys (R2/Tinybird) are tenant-prefixed.
  - Implementation notes: Add a detector grep (per audit-arc memory) for any webhook handler reading orgId from headers/body; run tree-wide in CI.
  - Hosting notes: Worker middleware + tests.
  - Backing services: D1, R2, Tinybird (all tenant-scoped).
  - Observability: Axiom `authz.denied` with attempted_tenant vs owning_tenant; alert on cross-tenant attempts.
  - Dependencies: LOOP-HOOK-007, LOOP-HOOK-010, LOOP-HOOK-011, LOOP-HOOK-012.
  - Related files: `apps/project-sites/src/middleware/`, `apps/project-sites/src/routes/webhooks.ts`, `e2e/webhooks/`.

- [ ] LOOP-HOOK-023: Admin incident console (fleet health, stuck queues, force-disable/replay)
  - Why: As solo operator you need one screen to see delivery health across all tenants and intervene fast during an incident (provider outage, mass failures, a tenant flooding the bus).
  - Acceptance criteria: `/admin/webhooks` cockpit (cyan/black) showing: global delivery success/failure rates, top failing endpoints, DLQ depth, queue backlog/age, per-source inbound volume; admin actions to force-disable an endpoint, bulk-replay a tenant's failed deliveries, pause a noisy source, and drain/requeue the DLQ; all actions audit-logged + confirm-guarded (danger-default).
  - Implementation notes: Metrics from Tinybird endpoints (`mcp__tinybird` style queries); visibility-aware polling (pause on `document.hidden`); reuse ConfirmService danger-default + error-card patterns.
  - Hosting notes: Angular admin + Worker admin API.
  - Backing services: Tinybird (metrics), D1 (actions), Outpost admin API.
  - Observability: Axiom `admin.webhook_action` with actor+action+target; every action correlation-tagged.
  - Dependencies: LOOP-HOOK-010, LOOP-HOOK-011, LOOP-HOOK-012, LOOP-HOOK-005.
  - Related files: `apps/project-sites/src/app/.../admin/sections/webhooks/`, `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-HOOK-024: Outbound webhook docs portal + verification snippets + OpenAPI/AsyncAPI spec
  - Why: A webhook product is only usable if customers can self-serve: signed-request verification code, event-type catalog, and a machine-readable spec so they can codegen receivers — this is the distribution lever.
  - Acceptance criteria: Auto-generated event catalog from EVENT_TYPE_REGISTRY (type, version, schema, example) rendered in customer docs; copy-paste signature-verification snippets in Node/Python/Go/PHP using the LOOP-HOOK-006 scheme; an AsyncAPI spec published + downloadable; docs stay in sync via a generator (registry change → docs rebuild) so drift is impossible.
  - Implementation notes: Generate AsyncAPI from the Zod registry (zod→json-schema); host docs under the customer dashboard; pairs with `forge-webhook-skill` for customers who want a scaffolded receiver.
  - Hosting notes: Static docs from R2 + Worker route; generator runs in CI.
  - Backing services: R2 (spec/docs), build pipeline.
  - Observability: Axiom `docs.webhook.viewed`; PostHog spec-download + snippet-copy events.
  - Dependencies: LOOP-HOOK-001, LOOP-HOOK-006.
  - Related files: `apps/project-sites/scripts/gen-asyncapi.mjs`, `docs/webhooks/`, customer docs route.

## integrations.projectsites.dev — Nango

### Raw research themes considered

Mined ~55 raw ideas across the integrations surface: the Nango control plane (proxy + OAuth broker + sync engine), per-site/per-tenant connection records, credential lifecycle (refresh, rotation, revocation, expiry alerting), provider families (Google, Microsoft 365, Slack, Notion, HubSpot/Salesforce, QuickBooks/Xero, calendar/contact/email/file sync), sync orchestration and observability, conflict resolution, integration health scoring, self-serve reconnect UX, integration templates + marketplace, AI-agent integration actions through llm.projectsites.dev, billing/quota for sync volume, scoped permissions, and admin repair tooling. The hardest architectural fork is sync orchestration: Nango cloud uses Temporal for long-running incremental syncs, which is a poor fit for Workers' CPU/wall-clock limits — so the ledger separates the OAuth/proxy/control plane (clean Workers Container fit) from the sync runtime (CF Workflows/Queues first, Fly.io+Temporal only as a flagged escape hatch). Reusable primitives chosen to compound: a single encrypted `connections` store, a unified credential-refresh engine, a sync-run observability spine on Tinybird, and a provider-agnostic reconnect UX. Everything rides the existing event_bus → Hookdeck/Outpost for outbound and emits correlation-tagged logs to Axiom.

### Selected 24 implementation tasks

- [ ] LOOP-NANGO-001: Stand up Nango control-plane (OAuth broker + proxy) on Cloudflare Workers Containers
  - Why: Nango's API/proxy/OAuth-broker is the foundation every other integration task depends on; without it there is no place to store connections or run flows.
  - Acceptance criteria: Nango server container reachable at `integrations.projectsites.dev`, `/health` returns 200, admin API key minted, a single test OAuth provider (Google) completes the connect→callback→token-store round trip end to end.
  - Implementation notes: Run the Nango Node server image as a CF Workers Container DO; front it with the platform Worker (Hono) which proxies `/api/integrations/*`. Pin image digest, multi-stage Dockerfile, non-root, Hadolint-clean per docker-slim doctrine. Do NOT mount /dev/shm assumptions — mkdir in entrypoint.
  - Hosting notes: Cloudflare Workers Containers (control plane only — no long-running sync here). amd64 native build on CI per CF-containers-native-amd64-only.
  - Backing services: Neon Postgres (`projectsites_nango` database in shared Neon project per neon-database-conservation), Upstash Redis (queue/session/locks), R2 for any large-object staging.
  - Observability: Axiom structured logs with correlation IDs (tenant_id, site_id, connection_id, request_id, trace_id); Sentry platform-only for control-plane exceptions.
  - Dependencies: none (root task).
  - Related files: `apps/project-sites/containers/nango/Dockerfile`, `apps/project-sites/wrangler.toml`, `apps/project-sites/src/services/nango.ts`, `docs/decisions/nango-architecture.md`.

- [ ] LOOP-NANGO-002: Encrypted per-tenant connection store + Zod connection record schema
  - Why: A single canonical, encrypted connection record (tenant→site→provider→credentials+metadata) is the compounding primitive every health/refresh/reconnect/AI-action feature reads from.
  - Acceptance criteria: D1 `integration_connections` table + Zod `ConnectionRecord` schema; secrets encrypted at rest (envelope encryption); CRUD service with tenant-scoped reads; no plaintext token ever leaves the worker; unit tests cover encrypt/decrypt round trip + tenant isolation.
  - Implementation notes: Store Nango's `connectionId` + provider config key + scopes + status; mirror minimal metadata in D1 for fast per-site status queries while Nango/Neon holds the authoritative credential blob. Envelope key from `wrangler secret` + Web Crypto AES-GCM. orgId from `c.get('orgId')` NEVER client header (IDOR per x-org-id rule).
  - Hosting notes: D1 (production `project-sites-db-production`) for the metadata mirror; credential blobs in Nango/Neon.
  - Backing services: D1, Neon (authoritative), Web Crypto.
  - Observability: log every connection mutation with connection_id + api_key_id; emit `connection.created|updated|deleted` to event_bus.
  - Dependencies: LOOP-NANGO-001.
  - Related files: `apps/project-sites/migrations/00xx_integration_connections.sql`, `packages/shared/src/schemas/integration.ts`, `apps/project-sites/src/services/connection_store.ts`.

- [ ] LOOP-NANGO-003: Generic OAuth connect/callback route pair with paste-key fallback
  - Why: Every provider needs a uniform connect flow; reusing one route pair (vs per-provider handlers) prevents the Hono wildcard-shadow bug class and compounds across all integrations.
  - Acceptance criteria: `GET /api/integrations/:provider/connect` initiates Nango OAuth (PKCE where supported); `GET /api/integrations/:provider/callback` finalizes; missing `{PROVIDER}_OAUTH_CLIENT_ID` falls back to a paste-key form + toast (per MCP OAuth-first pattern); specific provider routes registered BEFORE the `:provider` wildcard with `next()` fall-through.
  - Implementation notes: Reuse forge-oauth-callback scaffold shape; state param carries signed tenant_id+site_id; KV (60s) caches in-flight state. Honor Nango's hosted-auth where it simplifies.
  - Hosting notes: Worker route (Hono) → Nango control plane.
  - Backing services: KV (state), Nango.
  - Observability: log connect-initiated / callback-success|fail with provider + connection_id; PostHog funnel event `integration_connected`.
  - Dependencies: LOOP-NANGO-001, LOOP-NANGO-002.
  - Related files: `apps/project-sites/src/routes/integrations.ts`, `apps/project-sites/src/services/nango.ts`.

- [ ] LOOP-NANGO-004: Credential-refresh engine (unified token refresh + expiry scheduler)
  - Why: Expired tokens are the #1 cause of silent integration failure; one refresh engine serving all providers is a core reusable primitive.
  - Acceptance criteria: Cron-triggered scan refreshes tokens nearing expiry; refresh failures mark connection `degraded` and enqueue a reconnect notification; idempotent + retry-with-backoff; throttled `last_refresh_at` write to avoid hot-row churn; unit tests for near-expiry selection + failure path.
  - Implementation notes: Prefer Nango's built-in refresh where available; engine wraps it and owns scheduling + status transitions. CF Cron Trigger every 5–10 min; per-connection lock via Upstash to avoid double refresh.
  - Hosting notes: CF Cron Trigger + Worker (short tasks, no long-running needed).
  - Backing services: Upstash (locks), D1/Neon (status), Nango.
  - Observability: Axiom log per refresh attempt (attempt count, next delay, connection_id); emit `connection.refresh.failed` to event_bus → Hookdeck.
  - Dependencies: LOOP-NANGO-002.
  - Related files: `apps/project-sites/src/services/credential_refresh.ts`, `apps/project-sites/wrangler.toml` (cron), `apps/project-sites/src/__tests__/credential_refresh.test.ts`.

- [ ] LOOP-NANGO-005: Sync runtime decision + orchestration spine (CF Workflows/Queues first; Fly+Temporal escape hatch)
  - Why: Nango cloud relies on Temporal for long-running incremental syncs; Workers cannot host Temporal — this task chooses and builds the orchestration spine the sync providers plug into.
  - Acceptance criteria: A documented decision (needs decision) selecting CF Workflows + Queues as the default sync orchestrator; a `SyncJob` Zod contract + dispatcher that runs a provider sync as a Workflow with checkpointing; explicit written criteria for when a sync MUST move to the Fly.io+Temporal escape hatch (e.g., >30s continuous runtime, stateful cursors requiring durable timers beyond Workflow limits, or high-frequency CDC).
  - Implementation notes: Default path: each sync = one CF Workflow instance, paginated pulls checkpointed between steps, Queue for fan-out. Escape hatch (Fly.io + Temporal) ONLY for providers whose incremental sync genuinely exceeds Workflow step/time limits — justified per neon/Temporal note, never default. Prefer chunked cursor-based pulls to stay inside CF limits.
  - Hosting notes: CF Workflows + Queues (default). Fly.io + Temporal = flagged, per-provider escape hatch with written justification.
  - Backing services: CF Workflows, CF Queues, Upstash (cursor cache), Neon (sync state).
  - Observability: every sync step logs job_id + connection_id + cursor; durations to Tinybird.
  - Dependencies: LOOP-NANGO-001, LOOP-NANGO-002.
  - Related files: `apps/project-sites/src/workflows/integration-sync.ts`, `apps/project-sites/src/services/sync_dispatch.ts`, `docs/decisions/nango-sync-runtime.md`.

- [ ] LOOP-NANGO-006: Sync-run observability spine on Tinybird
  - Why: Sync visibility (records pulled, duration, errors, lag) is required UX and ops; a single observability spine compounds across every provider sync.
  - Acceptance criteria: Tinybird datasource `integration_sync_runs` ingesting one row per run (connection_id, provider, started_at, records, status, error_code, duration_ms, cursor); endpoint `sync_runs_by_connection` powers admin charts; pipe for failure-rate by provider.
  - Implementation notes: Sync dispatcher writes to Tinybird via events API at run start/end; also mirror last-run summary into D1 for instant per-site status without a Tinybird round trip.
  - Hosting notes: Tinybird (analytics); D1 (last-run mirror).
  - Backing services: Tinybird, D1.
  - Observability: this IS the observability primitive; cross-link Axiom logs by job_id.
  - Dependencies: LOOP-NANGO-005.
  - Related files: `tinybird/datasources/integration_sync_runs.datasource`, `tinybird/pipes/sync_runs_by_connection.pipe`, `apps/project-sites/src/services/sync_observability.ts`.

- [ ] LOOP-NANGO-007: Integration health scoring + per-connection status engine
  - Why: A normalized health score (healthy/degraded/broken/expired) turns raw signals into one field the UI, AI agents, and alerts all consume.
  - Acceptance criteria: `computeHealth(connection)` derives status from token expiry, last-refresh result, last-sync result, and error rate; status persisted + recomputed on relevant events; unit tests cover each transition; status exposed via API.
  - Implementation notes: Pure function over signals from refresh engine + sync observability; event-driven recompute (no polling) plus a periodic safety sweep.
  - Hosting notes: Worker (pure compute) + Cron safety sweep.
  - Backing services: D1, Tinybird (error rate query).
  - Observability: emit `connection.health.changed` with old→new status to event_bus.
  - Dependencies: LOOP-NANGO-004, LOOP-NANGO-006.
  - Related files: `apps/project-sites/src/services/integration_health.ts`, `apps/project-sites/src/__tests__/integration_health.test.ts`.

- [ ] LOOP-NANGO-008: Per-site integration status panel (admin UI, Angular)
  - Why: The solo founder and site owners need a single glanceable view of every connection's health per site; this is the primary integrations UX surface.
  - Acceptance criteria: `/admin/sites/:id/integrations` lists connections with health badge, last sync, scopes, and reconnect CTA; loading skeleton + error-card (Retry + request_id); empty state with cyan-halo; behind feature flag `integrations_panel`.
  - Implementation notes: Reads health + last-run from D1 mirror (fast); cyan/black tokens from `_polish.scss`; rolling-counter for connection/synced-record counts; Karma spec with provideRouter.
  - Hosting notes: Angular admin (served via existing app); data from Worker API.
  - Backing services: D1, Worker API.
  - Observability: PostHog `integration_panel_viewed`; Sentry breadcrumbs with featureSlug.
  - Dependencies: LOOP-NANGO-007.
  - Related files: `apps/project-sites/frontend/.../sites/integrations/`, `libs/features/integrations_panel/manifest.ts`, `e2e/integrations_panel/`.

- [ ] LOOP-NANGO-009: Customer self-serve reconnect flow
  - Why: When a connection breaks, the owner must fix it without founder intervention; self-serve reconnect is the highest-leverage solo-founder UX.
  - Acceptance criteria: A degraded/expired connection shows a one-click "Reconnect" that re-runs OAuth, preserves the existing connection_id + sync config, and clears degraded status on success; emails the owner a reconnect link when a refresh fails (deep link to the exact connection); E2E covers expired→reconnect→healthy.
  - Implementation notes: Reuse LOOP-NANGO-003 connect flow with `reconnect=true` to rebind tokens onto the existing record; tokenized magic deep-link via Resend.
  - Hosting notes: Worker + Angular; email via Resend.
  - Backing services: Resend (email), KV (reconnect token), Nango.
  - Observability: funnel `reconnect_initiated→reconnect_succeeded`; log connection_id.
  - Dependencies: LOOP-NANGO-003, LOOP-NANGO-004, LOOP-NANGO-007.
  - Related files: `apps/project-sites/src/routes/integrations.ts`, `apps/project-sites/src/services/notifications.ts`, `e2e/integrations_panel/reconnect.spec.ts`.

- [ ] LOOP-NANGO-010: Google Workspace integration pack (Gmail + Calendar + Contacts + Drive)
  - Why: Google is the highest-demand provider family for SMB sites; one pack delivers email/calendar/contact/file sync that several downstream features reuse.
  - Acceptance criteria: Provider configs for Gmail, Google Calendar, Google Contacts, Google Drive registered in Nango with correct scopes; connect works for each; one read sync (calendar events) proven end to end through the sync spine.
  - Implementation notes: Use Nango provider templates; scope minimization (read-only by default, write opt-in). Google client creds via wrangler secrets.
  - Hosting notes: Sync via CF Workflows (calendar/contacts are paginated, fit Workflow limits).
  - Backing services: Nango, CF Workflows, Neon.
  - Observability: sync runs to Tinybird tagged provider=google_*.
  - Dependencies: LOOP-NANGO-003, LOOP-NANGO-005.
  - Related files: `apps/project-sites/src/integrations/google.ts`, `nango.yaml` (provider configs).

- [ ] LOOP-NANGO-011: Microsoft 365 integration pack (Outlook mail + Calendar + OneDrive + Contacts)
  - Why: Microsoft 365 covers the enterprise/SMB segment Google misses and reuses the same calendar/contact/email/file sync abstractions.
  - Acceptance criteria: Nango configs for Microsoft Graph (mail, calendar, contacts, OneDrive) with delegated scopes; connect + token refresh proven; one read sync (calendar) end to end.
  - Implementation notes: Microsoft Graph delta queries map cleanly to cursor-based incremental sync — use delta tokens as the Workflow cursor.
  - Hosting notes: CF Workflows (delta queries are chunked).
  - Backing services: Nango, CF Workflows, Neon, Upstash (delta cursor).
  - Observability: provider=microsoft_* tags in Tinybird.
  - Dependencies: LOOP-NANGO-003, LOOP-NANGO-005.
  - Related files: `apps/project-sites/src/integrations/microsoft.ts`, `nango.yaml`.

- [ ] LOOP-NANGO-012: Slack integration (notifications + inbound events + actions)
  - Why: Slack is the canonical ops/notification channel; connecting it lets sites push alerts and lets AI agents post/act.
  - Acceptance criteria: Slack OAuth (bot + user scopes) connects; outbound message action works through the AI action layer; inbound Slack events ingested via Hookdeck; reconnect handles scope changes.
  - Implementation notes: Outbound posts via Nango proxy; inbound via webhook gateway (LOOP-NANGO-019) not a direct worker route (Bot Fight Mode blocks inbound webhooks → host receiver on workers.dev or route via Hookdeck).
  - Hosting notes: Worker + Hookdeck for inbound.
  - Backing services: Nango, Hookdeck, Upstash Kafka (event fan-in).
  - Observability: log slack action calls with connection_id; PostHog `slack_action_invoked`.
  - Dependencies: LOOP-NANGO-003, LOOP-NANGO-016, LOOP-NANGO-019.
  - Related files: `apps/project-sites/src/integrations/slack.ts`.

- [ ] LOOP-NANGO-013: Notion integration (pages/databases read + write sync)
  - Why: Notion is a common SMB knowledge/content source; syncing it feeds site content and AI context.
  - Acceptance criteria: Notion OAuth connects; read sync of selected databases into a normalized store; write-back action (create page) available to AI agents; pagination + rate-limit handling.
  - Implementation notes: Notion's cursor pagination fits Workflow checkpointing; respect Notion 3 req/s rate limit via Upstash token bucket.
  - Hosting notes: CF Workflows.
  - Backing services: Nango, CF Workflows, Upstash (rate limit), Neon.
  - Observability: provider=notion sync runs to Tinybird.
  - Dependencies: LOOP-NANGO-005.
  - Related files: `apps/project-sites/src/integrations/notion.ts`.

- [ ] LOOP-NANGO-014: CRM integration pack (HubSpot + Salesforce — contacts/companies/deals)
  - Why: CRM sync is the marquee B2B integration; a shared CRM abstraction (contact/company/deal) lets one UI + one sync model serve both vendors.
  - Acceptance criteria: HubSpot + Salesforce connect; bidirectional contact sync with a unified `CrmContact` Zod model; incremental sync via each vendor's modified-since cursor; conflict handling delegated to LOOP-NANGO-018.
  - Implementation notes: Map both vendors to a common normalized model so downstream features are vendor-agnostic. Salesforce bulk/large orgs may push runtime — flag for the Fly+Temporal escape hatch (needs decision) only if a full initial sync exceeds Workflow limits; default to chunked incremental.
  - Hosting notes: CF Workflows default; Fly+Temporal escape hatch documented for large-org full syncs only.
  - Backing services: Nango, CF Workflows/Queues, Neon, Upstash.
  - Observability: per-vendor sync metrics in Tinybird; conflict counts surfaced.
  - Dependencies: LOOP-NANGO-005, LOOP-NANGO-018.
  - Related files: `apps/project-sites/src/integrations/crm.ts`, `packages/shared/src/schemas/crm.ts`.

- [ ] LOOP-NANGO-015: Accounting integration pack (QuickBooks Online + Xero)
  - Why: Accounting sync (invoices, customers, payments) is high-value for SMB sites doing commerce/invoicing and reuses the sync + conflict primitives.
  - Acceptance criteria: QuickBooks + Xero connect with refresh-token rotation handled (QBO rotates refresh tokens — engine must persist new token each refresh); read sync of invoices + customers; sandbox creds for tests.
  - Implementation notes: QBO refresh-token rotation is a known footgun — the refresh engine MUST atomically store the rotated refresh token or the connection bricks. Add a regression test for rotation persistence.
  - Hosting notes: CF Workflows + Cron refresh.
  - Backing services: Nango, Neon, CF Workflows.
  - Observability: alert on refresh-token-rotation failure (high severity) to event_bus.
  - Dependencies: LOOP-NANGO-004, LOOP-NANGO-005.
  - Related files: `apps/project-sites/src/integrations/accounting.ts`.

- [ ] LOOP-NANGO-016: AI-agent integration action layer (tool contracts for llm.projectsites.dev)
  - Why: The platform's differentiator is AI agents that DO things in connected apps; a typed, permission-checked action layer exposes integrations as LLM tools.
  - Acceptance criteria: Each integration registers actions as Zod-contracted tools (in+out schemas); the LLM gateway can invoke `integration.action(connection_id, action, args)` with tenant + scope enforcement; actions are idempotent + audited; refusal/empty-result handled cleanly.
  - Implementation notes: Tool-design-as-API — narrow, typed, idempotent, no mega-tool. Every action checks the connection's granted scopes (LOOP-NANGO-021) before calling Nango proxy. AI traces to Langfuse.
  - Hosting notes: Worker; calls Nango control plane.
  - Backing services: Nango, Langfuse (traces), D1 (audit).
  - Observability: Langfuse trace per action with connection_id; Axiom log; audit row.
  - Dependencies: LOOP-NANGO-002, LOOP-NANGO-021.
  - Related files: `apps/project-sites/src/services/integration_actions.ts`, `packages/shared/src/schemas/integration_actions.ts`.

- [ ] LOOP-NANGO-017: Outbound integration events → event_bus → Hookdeck/Outpost + Tinybird
  - Why: Integration lifecycle + sync events must flow to the existing outbound webhook + analytics pipeline so customers and internal consumers react to them.
  - Acceptance criteria: `connection.*`, `sync.*`, `health.*` events published to event_bus; Hookdeck/Outpost delivers customer-subscribed webhooks; Tinybird records all events; delivery retries + DLQ; signature on outbound payloads.
  - Implementation notes: Reuse existing event_bus contract; do NOT introduce Svix. Outpost handles per-tenant destination management.
  - Hosting notes: Worker → event_bus → Hookdeck+Outpost.
  - Backing services: Hookdeck, Outpost, Tinybird, Upstash Kafka.
  - Observability: delivery success/fail to Tinybird; DLQ alerts.
  - Dependencies: LOOP-NANGO-002, LOOP-NANGO-006.
  - Related files: `apps/project-sites/src/services/event_bus.ts`, `apps/project-sites/src/integrations/events.ts`.

- [ ] LOOP-NANGO-018: Sync conflict resolution engine
  - Why: Bidirectional syncs (CRM, contacts, calendar) inevitably conflict; a deterministic, auditable resolution engine prevents data corruption and surfaces unresolved conflicts.
  - Acceptance criteria: Configurable strategy per sync (last-write-wins / source-of-truth / manual-queue); conflicts that can't auto-resolve land in a `sync_conflicts` queue with both versions; admin UI to resolve; unit tests for each strategy.
  - Implementation notes: Field-level diff with vector-clock-ish updated_at comparison; manual queue is the safe default for ambiguous fields (needs decision per provider on default strategy).
  - Hosting notes: Worker (resolution logic) + D1 (conflict queue).
  - Backing services: D1, Neon.
  - Observability: conflict counts per connection to Tinybird; emit `sync.conflict.queued`.
  - Dependencies: LOOP-NANGO-005.
  - Related files: `apps/project-sites/src/services/sync_conflicts.ts`, `apps/project-sites/migrations/00xx_sync_conflicts.sql`.

- [ ] LOOP-NANGO-019: Inbound external webhook gateway (provider → platform)
  - Why: Real-time integrations (Slack events, Stripe-like provider webhooks, HubSpot subscriptions) need a hardened inbound receiver that bypasses Bot Fight Mode and verifies signatures.
  - Acceptance criteria: A workers.dev-hosted (BFM-bypassing) receiver verifies each provider's signature, dedups via D1 idempotency, dead-letters to R2, and republishes to the internal event_bus; per-provider signature verifiers; replay-safe.
  - Implementation notes: Per Bot-Fight-Mode memory — inbound M2M webhooks must be hosted on workers.dev or routed via Hookdeck inbound, never behind the WAF-challenged custom domain. Reuse forge-webhook-handler scaffold.
  - Hosting notes: Worker on workers.dev (or Hookdeck inbound source) — explicitly NOT the WAF-protected apex.
  - Backing services: D1 (idempotency), R2 (DLQ), Hookdeck (inbound).
  - Observability: log each inbound event with provider + connection_id; metrics to Tinybird.
  - Dependencies: LOOP-NANGO-002, LOOP-NANGO-017.
  - Related files: `apps/project-sites/src/routes/integration_webhooks.ts`, `apps/project-sites/src/services/webhook.ts`.

- [ ] LOOP-NANGO-020: Integration templates + marketplace catalog
  - Why: A browsable catalog of available integrations (with per-site enable) turns the engine into a self-serve product surface and a growth lever.
  - Acceptance criteria: `integration_catalog` (provider, category, scopes, description, status) seeded from registered Nango configs; `/admin/integrations` marketplace UI with category filter + search + connect CTA; "coming soon" entries for unbuilt providers; behind flag `integration_marketplace`.
  - Implementation notes: Catalog generated from the same Nango provider registry that powers connect — single source of truth, no drift. Filtered-list empty/no-match states per filtered-list rule.
  - Hosting notes: Angular admin + Worker API; catalog in D1.
  - Backing services: D1, Nango registry.
  - Observability: PostHog `integration_catalog_viewed`, `integration_connect_clicked`.
  - Dependencies: LOOP-NANGO-003, LOOP-NANGO-008.
  - Related files: `apps/project-sites/migrations/00xx_integration_catalog.sql`, `apps/project-sites/frontend/.../integrations/marketplace/`, `libs/features/integration_marketplace/manifest.ts`.

- [ ] LOOP-NANGO-021: Granular integration permissions + scope governance
  - Why: AI agents and syncs must operate under least privilege; per-connection granted-scope tracking enforces what each action/sync may do and what to re-request on reconnect.
  - Acceptance criteria: Granted scopes persisted per connection; action layer + sync engine check required-vs-granted scope before each operation; missing scope triggers a guided re-consent (not a silent failure); RBAC gates who can connect/disconnect per role.
  - Implementation notes: Map each AI action and sync to a required-scope set; reconnect flow can request incremental scopes. Server returns 404 (not 403) for flag-gated, but 403-equivalent guided re-consent for scope gaps.
  - Hosting notes: Worker; scopes in D1/Nango.
  - Backing services: D1, Nango, shared RBAC middleware.
  - Observability: log denied-by-scope events with connection_id + action.
  - Dependencies: LOOP-NANGO-002, LOOP-NANGO-016.
  - Related files: `apps/project-sites/src/services/integration_scopes.ts`, `packages/shared/src/middleware/` (RBAC).

- [ ] LOOP-NANGO-022: Integration billing + sync-volume metering
  - Why: Integrations consume real cost (sync compute, API quota); metering usage enables plan gating and a monetizable add-on while protecting margins.
  - Acceptance criteria: Per-tenant counters for active connections + monthly synced records + action invocations, metered to Stripe Billing usage; plan caps enforced (free tier = N connections); over-cap connect attempt shows upgrade moment; metering is idempotent.
  - Implementation notes: Usage events to Tinybird are the source of truth; nightly rollup pushes Stripe usage records. Recurring + usage-metered ⇒ Stripe Billing per payments-routing. Reuse upgrade_moments module for the cap UX.
  - Hosting notes: Worker + Cron rollup; Stripe Billing.
  - Backing services: Tinybird (usage), Stripe Billing, D1 (caps).
  - Observability: usage rollup logs; PostHog `integration_cap_hit`.
  - Dependencies: LOOP-NANGO-006, LOOP-NANGO-020.
  - Related files: `apps/project-sites/src/services/integration_billing.ts`, `apps/project-sites/src/services/billing.ts`.

- [ ] LOOP-NANGO-023: Admin repair toolkit (force-refresh, replay sync, rotate, disconnect, impersonate-read)
  - Why: The solo founder needs first-line repair tools to fix broken connections without SSHing into Nango — turning support load into one-click ops.
  - Acceptance criteria: `/admin/integrations/repair` offers per-connection actions: force token refresh, replay last failed sync, rotate credentials, hard-disconnect, and view (redacted) last error + raw provider response; every action audited; destructive actions use ConfirmService danger default.
  - Implementation notes: Actions call refresh engine / sync dispatcher / connection store. Redact secrets in any displayed payload (redact util). Confirm dialogs RED-destructive by default.
  - Hosting notes: Angular admin + Worker API.
  - Backing services: D1 (audit), Nango, Upstash.
  - Observability: audit row per repair action with operator + connection_id; Axiom log.
  - Dependencies: LOOP-NANGO-004, LOOP-NANGO-005, LOOP-NANGO-007.
  - Related files: `apps/project-sites/frontend/.../integrations/repair/`, `apps/project-sites/src/routes/integrations_admin.ts`.

- [ ] LOOP-NANGO-024: Integration health alerting + AI-summarized incident notifications
  - Why: Owners and the founder must be told the moment an integration breaks, with an AI summary + remediation steps, closing the loop from detection to self-serve fix.
  - Acceptance criteria: Health-changed-to-broken/expired events trigger an actionable notification (what happened, why it matters, deep-link to reconnect/repair) via psnotify + email; an AI summary (via llm gateway) explains the failure + next step; dedup so a flapping connection doesn't spam; quiet hours respected.
  - Implementation notes: Subscribe to `connection.health.changed`; AI summary generated from last error + provider context, traced to Langfuse; notifications via custom psnotify (NO Novu) + Resend email.
  - Hosting notes: Worker (event-driven) + Resend.
  - Backing services: psnotify (DO inbox), Resend, llm.projectsites.dev, Langfuse.
  - Observability: notification sent/opened metrics; log with connection_id + trace_id.
  - Dependencies: LOOP-NANGO-007, LOOP-NANGO-009, LOOP-NANGO-016.
  - Related files: `apps/project-sites/src/services/integration_alerts.ts`, `apps/project-sites/src/services/notifications.ts`.

## mail.projectsites.dev — Listmonk

### Raw research themes considered

Brainstormed 50+ raw ideas across both our own email program and email-as-a-feature for site-owners: per-tenant list namespacing, double opt-in flows, SES-SNS bounce/complaint ingestion, suppression lists, AI subject-line + body generation, local-business campaign templates (HVAC/restaurant/salon), claim-invite drip sequences, abandoned-claim recovery, QR-postcard follow-up tracking, site-form→list autosync, CRM (Twenty)→Listmonk contact sync, per-site send quotas + plan gating, deliverability dashboard (DKIM/SPF/DMARC + reputation), campaign approval/moderation, lifecycle automations, hosted newsletter archive pages, unsubscribe-compliance headers (List-Unsubscribe-Post), GDPR/CAN-SPAM export+erase, segmentation by behavior, A/B subject testing, send-time optimization, warmup ramps, transactional template registry, webhook fan-out via Hookdeck, Tinybird campaign analytics, admin abuse throttles, and reusable Listmonk REST client primitives. Filtered by: (1) compounding reusability — primitives later tasks build on (REST client, tenant namespacing, webhook ingest) ranked first; (2) solo-founder leverage — automation that removes manual work; (3) multi-tenant safety — anything preventing one site-owner from harming platform deliverability; (4) compliance non-negotiables (opt-in, unsubscribe, suppression). Dropped pure-vanity ideas (emoji pickers, theme galleries), anything Listmonk already does natively without our wrapper, and speculative AI features lacking a concrete acceptance test.

### Selected 24 implementation tasks

- [ ] LOOP-MAIL-001: Typed Listmonk REST client primitive (`src/services/listmonk.ts`)
  - Why: Every downstream mail feature needs one hardened HTTP client; without it each task re-implements auth, retries, and error mapping.
  - Acceptance criteria: Exports `listmonkFetch()` wrapping all calls with basic-auth from secret, Zod-validated request/response shapes for `lists`, `subscribers`, `campaigns`, `tx`; 4xx/5xx mapped to taxonomy error envelope; retry w/ backoff+jitter on 5xx/network; correlation IDs (tenant_id, site_id, request_id) injected into every log line; unit tests mock fetch (happy + 422 + network-fail).
  - Implementation notes: Base URL `https://mail.projectsites.dev/api`; admin user/token from `get-secret LISTMONK_API_USER` / `LISTMONK_API_TOKEN`; never bare `fetch`; size-guard request bodies.
  - Hosting notes: Runs in the project-sites Worker (Cloudflare); Listmonk itself stays on Workers Containers.
  - Backing services: Listmonk (Postgres=Neon-adjacent / its own PG), secret store.
  - Observability: Axiom structured logs per call (durationMs, status, endpoint); Sentry platform-only on thrown errors.
  - Dependencies: none (foundation).
  - Related files: `apps/project-sites/src/services/listmonk.ts`, `apps/project-sites/src/types/env.ts`.

- [ ] LOOP-MAIL-002: Per-tenant list namespacing + provisioning service
  - Why: Multi-tenant lists must never collide; each site-owner needs isolated lists provisioned on demand.
  - Acceptance criteria: `provisionTenantLists(siteId)` creates Listmonk lists named `site_{siteId}_{purpose}` (newsletter, leads, transactional-optin); records mapping in D1 `mail_lists` table (id, site_id, listmonk_list_id, purpose, created_at); idempotent (re-call returns existing); RBAC-gated to site owner.
  - Acceptance criteria (cont.): Zod schema for list purposes; returns 404 (not 403) when flag off.
  - Implementation notes: Listmonk list `type=private`, `optin=double` for newsletter; store `uuid` for public subscribe URLs.
  - Hosting notes: D1 (Cloudflare) for the mapping; Listmonk container for lists.
  - Backing services: D1, Listmonk.
  - Observability: log `mail.list.provisioned` with site_id + listmonk_list_id.
  - Dependencies: LOOP-MAIL-001.
  - Related files: `src/services/mail_lists.ts`, D1 migration `mail_lists`.

- [ ] LOOP-MAIL-003: Site-form → mailing-list autosync
  - Why: Lead/contact forms on generated sites should drop subscribers straight into the owner's list with zero manual export.
  - Acceptance criteria: On a generated-site contact/newsletter form submit, enqueue a subscribe job → adds subscriber to `site_{siteId}_newsletter` (pending double opt-in) or `_leads` (no optin, internal); dedupes by email; respects suppression list; honors a `consent` checkbox flag in payload.
  - Implementation notes: Map form field names → subscriber attributes JSON; Turnstile-verify before subscribe to block bot signups.
  - Hosting notes: Worker handler + Upstash QStash (or CF Queue) for async retry.
  - Backing services: Listmonk, Upstash QStash, Turnstile.
  - Observability: Tinybird event `subscribe_attempt {site_id, source:'site_form', status}`.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-002, LOOP-MAIL-009 (suppression).
  - Related files: `src/routes/api.ts` (form handler), `src/services/mail_sync.ts`.

- [ ] LOOP-MAIL-004: Double opt-in flow with branded confirmation page
  - Why: CAN-SPAM/GDPR compliance and deliverability require verified consent for newsletter lists.
  - Acceptance criteria: New newsletter subscribers get a confirmation email (Listmonk double-optin); confirm link lands on a branded `mail.projectsites.dev`-served (or site-domain-proxied) confirmation page; D1 records `confirmed_at`; unconfirmed subscribers auto-expire after 7 days (cron purge job).
  - Implementation notes: Use Listmonk's built-in optin campaign but override template branding per-tenant (LOOP-MAIL-019); confirmation page served by Worker.
  - Hosting notes: Worker for the confirm route; CF Cron Trigger for expiry purge.
  - Backing services: Listmonk, D1, SES (send).
  - Observability: log `mail.optin.confirmed` / `.expired`.
  - Dependencies: LOOP-MAIL-002, LOOP-MAIL-019.
  - Related files: `src/routes/mail.ts` (confirm), cron in `wrangler.toml`.

- [ ] LOOP-MAIL-005: SES-SNS bounce + complaint ingestion → suppression
  - Why: Unprocessed bounces/complaints destroy sender reputation; hard bounces and complaints must auto-suppress.
  - Acceptance criteria: SNS topic delivers SES notifications to a workers.dev receiver (bypass Bot Fight Mode); verify SNS signature; on hard bounce or complaint → add to global suppression (LOOP-MAIL-009) + mark Listmonk subscriber `blocklisted`; soft bounces increment a counter, suppress after 3; idempotent by SES messageId stored in D1.
  - Implementation notes: Host receiver on a dedicated `*.workers.dev` worker per the Bot-Fight-Mode memory; confirm SNS subscription handshake.
  - Hosting notes: Dedicated workers.dev receiver Worker.
  - Backing services: SES, SNS, D1, Listmonk.
  - Observability: Tinybird `bounce {type, site_id}`; Axiom log w/ messageId.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-009.
  - Related files: `src/routes/webhooks.ts` (ses-sns), `workers/ses-receiver/`.

- [ ] LOOP-MAIL-006: AI-generated campaign drafts (subject + body)
  - Why: Solo site-owners won't write good newsletters; AI drafting is the core "AI-native" value-add.
  - Acceptance criteria: `POST /api/mail/draft {site_id, goal, tone, products?}` returns a structured draft (subject, preheader, HTML body, plain-text) Zod-validated; grounded in the site's brand + content; renders to a Listmonk campaign in draft state; never auto-sends.
  - Implementation notes: Use platform LLM (DeepSeek build-tier for body, premium for subject A/B candidates); Langfuse trace; output contract-bound, refuse if missing brand context.
  - Hosting notes: Worker; LLM via existing external_llm service.
  - Backing services: Listmonk, LLM (DeepSeek/Anthropic), Langfuse.
  - Observability: Langfuse trace per draft; PostHog `mail_draft_generated`.
  - Dependencies: LOOP-MAIL-001.
  - Related files: `src/services/mail_ai.ts`, `prompts/mail-campaign.prompt.md`.

- [ ] LOOP-MAIL-007: Local-business campaign template library
  - Why: Reusable industry templates (restaurant specials, HVAC seasonal, salon promo) let owners ship in one click.
  - Acceptance criteria: Versioned catalog of ≥8 responsive MJML/HTML templates by org-type with merge-tag placeholders; `getTemplates(orgType)` returns filtered set; each renders in Listmonk + passes an email-client lint (dark-mode, table layout, <102KB); stored in R2.
  - Implementation notes: Compile MJML at build; store rendered HTML in R2 `mail-templates/{org}/{slug}.html`; merge tags map to subscriber attributes.
  - Hosting notes: R2 (Cloudflare) for assets; Worker serves catalog API.
  - Backing services: R2, Listmonk.
  - Observability: log template usage by org-type.
  - Dependencies: LOOP-MAIL-001.
  - Related files: `src/services/mail_templates.ts`, `mail-templates/` (MJML sources).

- [ ] LOOP-MAIL-008: Mailing-list CSV import with validation + mapping
  - Why: Owners migrating from Mailchimp need to bulk-import existing subscribers safely.
  - Acceptance criteria: Upload CSV → preview column→attribute mapping → validate emails (RFC + MX-cache check) → de-dupe vs existing + suppression → import as Listmonk subscribers with chosen optin status; rejects rows reported back with reasons; progress streamed via DO; import capped per plan (needs decision: free import limit).
  - Implementation notes: Parse in Worker (stream), batch to Listmonk bulk endpoint; store import job state in Durable Object.
  - Hosting notes: Worker + Durable Object for job state; R2 for the uploaded file.
  - Backing services: Listmonk, R2, Durable Objects.
  - Observability: log `mail.import {rows_total, rows_imported, rows_rejected}`.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-009.
  - Related files: `src/services/mail_import.ts`, `src/do/import_job.ts`.

- [ ] LOOP-MAIL-009: Global + per-tenant suppression list service
  - Why: A single source of truth for "never email this address" protects reputation and honors unsubscribes/complaints across all lists.
  - Acceptance criteria: D1 `mail_suppressions` (email_hash, scope:'global'|site_id, reason, created_at); `isSuppressed(email, siteId)` checked before EVERY send/subscribe; add/remove API; complaint/hard-bounce/manual unsubscribe all funnel here; global scope blocks across all tenants.
  - Implementation notes: Store SHA-256 of lowercased email for PII minimization; KV cache hot lookups (60s).
  - Hosting notes: D1 + KV (Cloudflare).
  - Backing services: D1, KV.
  - Observability: log every suppression add with reason.
  - Dependencies: LOOP-MAIL-001.
  - Related files: `src/services/mail_suppression.ts`, D1 migration.

- [ ] LOOP-MAIL-010: Per-site send quotas + plan gating
  - Why: Prevent a single tenant from exhausting SES limits or spamming; tie volume to plan tier.
  - Acceptance criteria: D1-tracked monthly send counters per site_id; `assertSendQuota(siteId, count)` blocks + returns friendly over-quota envelope when exceeded; counters reset monthly via cron; quota by plan from ENTITLEMENTS constant (needs decision: free/pro/business send caps); admin override.
  - Implementation notes: Atomic increment via Upstash Redis counter (high-throughput) with D1 reconciliation; check at campaign-send and tx-send boundaries.
  - Hosting notes: Worker; Upstash Redis for counters; CF Cron for reset.
  - Backing services: Upstash Redis, D1.
  - Observability: Tinybird `send_quota {site_id, used, cap}`; alert at 80%.
  - Dependencies: LOOP-MAIL-001, ENTITLEMENTS constants.
  - Related files: `src/services/mail_quota.ts`, `packages/shared/src/constants`.

- [ ] LOOP-MAIL-011: Transactional template registry + send API
  - Why: Generated sites need branded transactional emails (order confirm, booking, magic link) with versioned templates.
  - Acceptance criteria: Registry maps `tx_template_key` → Listmonk tx template id + Zod payload schema; `sendTransactional(siteId, key, data)` validates data against schema, checks suppression+quota, sends via Listmonk tx API; idempotency key prevents dupes; per-template enable flag.
  - Implementation notes: Seed core keys (magic_link, claim_invite, contact_receipt, booking_confirm); render via Listmonk's tx endpoint.
  - Hosting notes: Worker; Listmonk tx API over SES.
  - Backing services: Listmonk, SES, D1 (idempotency).
  - Observability: log `mail.tx.sent {key, site_id}`; Tinybird funnel.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-009, LOOP-MAIL-010.
  - Related files: `src/services/mail_tx.ts`, `src/prompts`/registry.

- [ ] LOOP-MAIL-012: Claim-invite campaign automation
  - Why: Core growth loop — invite unclaimed business owners to claim their auto-generated site via email.
  - Acceptance criteria: Given a discovered business + email, send a sequence (invite → reminder day 3 → final day 7) via tx templates; stop sequence on claim event; track open/click → claim conversion; respect suppression; one active sequence per business.
  - Implementation notes: Sequence state machine in Durable Object or D1 + cron; claim webhook cancels remaining steps.
  - Hosting notes: Worker + CF Cron (sequence stepper) + DO for per-invite state.
  - Backing services: Listmonk, D1, Durable Objects.
  - Observability: Tinybird `claims_by_source` already exists — emit `claim_invite_sent/clicked/converted`.
  - Dependencies: LOOP-MAIL-011, LOOP-MAIL-009.
  - Related files: `src/services/claim_invites.ts`, `src/do/invite_sequence.ts`.

- [ ] LOOP-MAIL-013: Abandoned-claim recovery sequence
  - Why: Owners who start claiming but don't finish are warm leads worth re-engaging.
  - Acceptance criteria: When a claim starts but `claimed_at` is null after 24h, enqueue a recovery email with a deep link back to the in-progress claim; max 2 recovery touches; cancel on completion or unsubscribe.
  - Implementation notes: Reuse sequence stepper from LOOP-MAIL-012; query D1 for stale in-progress claims hourly.
  - Hosting notes: Worker + CF Cron hourly scan.
  - Backing services: D1, Listmonk.
  - Observability: Tinybird `abandoned_claim_recovery {sent, recovered}`.
  - Dependencies: LOOP-MAIL-012.
  - Related files: `src/services/claim_recovery.ts`.

- [ ] LOOP-MAIL-014: QR-postcard follow-up tracking + email trigger
  - Why: Physical QR postcards drive scans; capturing the scan + following up by email closes the offline→online loop.
  - Acceptance criteria: Unique QR URL `/q/{token}` logs a scan event (token→business mapping in D1), redirects to claim/site, and if an email is known triggers a follow-up tx email; dashboard shows scan→email→claim funnel per postcard batch.
  - Implementation notes: Token = short signed id; dedupe scans by IP+UA within 1h; emit Tinybird scan event.
  - Hosting notes: Worker route + D1; Tinybird analytics.
  - Backing services: D1, Tinybird, Listmonk.
  - Observability: Tinybird `qr_scan {batch_id, business_id}` → funnel.
  - Dependencies: LOOP-MAIL-011.
  - Related files: `src/routes/qr.ts`, `src/services/qr_followup.ts`.

- [ ] LOOP-MAIL-015: Behavioral subscriber segmentation engine
  - Why: Targeted sends outperform blasts; owners need segments like "opened last 30d", "clicked but no purchase".
  - Acceptance criteria: Define segments as Zod-typed rule sets (attribute + engagement predicates); `materializeSegment(siteId, rules)` produces a Listmonk query/list; engagement signals (open/click) synced from webhooks into subscriber attributes; preview count before send.
  - Implementation notes: Map to Listmonk's SQL query expressions; cache materialized counts; store segment definitions in D1.
  - Hosting notes: Worker; Listmonk query API; D1 for definitions.
  - Backing services: Listmonk, D1.
  - Observability: log segment size at materialize time.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-016 (engagement webhooks).
  - Related files: `src/services/mail_segments.ts`.

- [ ] LOOP-MAIL-016: Listmonk engagement webhook → event_bus/Tinybird pipeline
  - Why: Open/click/bounce/unsub events must flow into the existing analytics pipeline for dashboards and segmentation.
  - Acceptance criteria: Listmonk (or SES open/click tracking) events received, signature-verified, normalized to a typed event schema, fanned out via Hookdeck/Outpost, and landed in Tinybird `mail_events` datasource with correlation IDs (site_id, campaign_id, subscriber_hash); idempotent by event id.
  - Implementation notes: Reuse existing event_bus→Tinybird + Hookdeck infra; define `mail_events` Tinybird datasource schema.
  - Hosting notes: workers.dev receiver (BFM bypass) → Hookdeck → Worker → Tinybird.
  - Backing services: Listmonk, Hookdeck/Outpost, Tinybird.
  - Observability: Axiom log per event; Tinybird is the sink.
  - Dependencies: LOOP-MAIL-001.
  - Related files: `src/routes/webhooks.ts`, Tinybird `mail_events.datasource`.

- [ ] LOOP-MAIL-017: Campaign analytics dashboard (per-site + platform)
  - Why: Owners need open/click/bounce/unsub/revenue-per-campaign; platform needs deliverability aggregates.
  - Acceptance criteria: Admin UI section reads Tinybird endpoints for sends, opens, clicks, bounces, unsubs, complaint rate per campaign + rolling 30d trend; rolling-counter stat tiles; per-site scoped via auth; platform view aggregates across tenants.
  - Implementation notes: Add Tinybird pipes (`mail_campaign_stats`, `mail_deliverability_daily`); Angular admin section, cyan/black, `<app-rolling-counter>`.
  - Hosting notes: Worker API proxies Tinybird; Angular admin frontend (R2).
  - Backing services: Tinybird, D1.
  - Observability: this IS the observability surface.
  - Dependencies: LOOP-MAIL-016.
  - Related files: `apps/project-sites` admin `sections/mail-analytics/`, Tinybird pipes.

- [ ] LOOP-MAIL-018: Deliverability health dashboard (DKIM/SPF/DMARC + reputation)
  - Why: Custom sending domains must pass auth; surfacing status + complaint/bounce rate prevents silent reputation collapse.
  - Acceptance criteria: For each tenant sending domain, check DKIM/SPF/DMARC DNS records (live lookup) + show SES verification status; surface 30d bounce-rate + complaint-rate with red thresholds (>5% bounce, >0.1% complaint); actionable "fix" copy per failing record.
  - Implementation notes: SES domain identity records live on the SENDING domain's zone (per memory) — surface mismatch when site domain ≠ sending domain; cache DNS checks 1h in KV.
  - Hosting notes: Worker (DNS over DoH + SES API); KV cache.
  - Backing services: SES, Cloudflare DNS API, KV, Tinybird (rates).
  - Observability: alert when any tenant crosses complaint/bounce threshold.
  - Dependencies: LOOP-MAIL-016, LOOP-MAIL-005.
  - Related files: `src/services/mail_deliverability.ts`, admin section.

- [ ] LOOP-MAIL-019: Per-tenant email branding (logo, colors, footer, from-name)
  - Why: Owner emails must look like the owner's brand, not ProjectSites'.
  - Acceptance criteria: D1 `mail_branding` per site_id (logo R2 url, primary color, from_name, reply_to, physical_address for CAN-SPAM footer); applied to all template renders + optin emails; validates from-domain is verified before allowing custom from; default to platform branding when unset.
  - Implementation notes: Inject branding into MJML render context; enforce physical address presence (legal requirement) before send.
  - Hosting notes: D1 + R2 (logos); Worker render.
  - Backing services: D1, R2, SES.
  - Observability: log branding applied per send.
  - Dependencies: LOOP-MAIL-002, LOOP-MAIL-007.
  - Related files: `src/services/mail_branding.ts`.

- [ ] LOOP-MAIL-020: Hosted newsletter archive pages
  - Why: Public archives boost SEO, give a "view in browser" link, and provide a permanent campaign URL.
  - Acceptance criteria: Each sent campaign gets a public URL `/{site}/newsletter/{slug}` rendering the campaign HTML with canonical + OG tags + JSON-LD; index page lists all archived issues per site; respects unpublished/draft (404); served from cache.
  - Implementation notes: On campaign send, snapshot rendered HTML to R2 `mail-archive/{site}/{slug}.html`; Worker serves with SWR cache.
  - Hosting notes: R2 + Worker (Cloudflare); cache rules.
  - Backing services: R2, D1 (index), Listmonk.
  - Observability: Tinybird pageview events on archive URLs.
  - Dependencies: LOOP-MAIL-001.
  - Related files: `src/routes/newsletter.ts`, `src/services/mail_archive.ts`.

- [ ] LOOP-MAIL-021: Compliant unsubscribe + one-click List-Unsubscribe headers
  - Why: Gmail/Yahoo bulk-sender rules mandate one-click unsubscribe (RFC 8058); non-compliance = spam folder.
  - Acceptance criteria: Every send includes `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers; the POST endpoint suppresses instantly (no confirmation page required); branded unsubscribe landing page with preference downgrade option; unsub funnels to suppression (LOOP-MAIL-009).
  - Implementation notes: Add headers via Listmonk tx/campaign config; implement `POST /u/{token}` one-click handler; signed token.
  - Hosting notes: Worker route; D1 suppression write.
  - Backing services: Listmonk, D1.
  - Observability: log `mail.unsubscribe {method:'one-click'|'page'}`.
  - Dependencies: LOOP-MAIL-009.
  - Related files: `src/routes/mail.ts` (unsubscribe), `src/services/mail_headers.ts`.

- [ ] LOOP-MAIL-022: Twenty CRM ↔ Listmonk bidirectional contact sync
  - Why: Contacts captured in CRM should land in mailing lists and vice versa, keeping one source of truth.
  - Acceptance criteria: On CRM contact create/update (webhook), upsert Listmonk subscriber with mapped attributes + tags→lists; on Listmonk subscribe, create/update CRM contact; conflict resolution last-write-wins by updated_at; sync respects suppression + consent flags; idempotent.
  - Implementation notes: Twenty CRM is live (`crm-twenty`); use its GraphQL/webhook + Listmonk REST; map a `lists`↔`tags` table in D1.
  - Hosting notes: Worker; Hookdeck for inbound CRM webhooks.
  - Backing services: Twenty CRM, Listmonk, D1, Hookdeck.
  - Observability: log `mail.crm_sync {direction, contact_id}`; Tinybird counts.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-009.
  - Related files: `src/services/crm_mail_sync.ts`.

- [ ] LOOP-MAIL-023: Campaign approval / moderation flow + anti-abuse controls
  - Why: A multi-tenant sender must screen new tenants' first campaigns to protect shared IP reputation from spam.
  - Acceptance criteria: New/low-trust tenants' campaigns enter `pending_review` instead of sending; admin approves/rejects in admin UI; content scanned (spam-trigger heuristics + LLM classifier) producing a risk score; auto-approve trusted tenants (≥N clean sends, low complaint rate); reject reasons emailed to owner.
  - Implementation notes: Trust score in D1 per site; LLM classifier via Langfuse-traced call; gate send pipeline on review status.
  - Hosting notes: Worker; LLM via external_llm; admin Angular section.
  - Backing services: D1, LLM, Langfuse, Listmonk.
  - Observability: log `mail.campaign.review {site_id, risk_score, decision}`.
  - Dependencies: LOOP-MAIL-001, LOOP-MAIL-010, LOOP-MAIL-018.
  - Related files: `src/services/mail_moderation.ts`, admin section.

- [ ] LOOP-MAIL-024: Sending-domain warmup ramp scheduler
  - Why: New sending domains/IPs must ramp volume gradually or mailbox providers throttle/block them.
  - Acceptance criteria: Per sending domain, track age + a warmup schedule (e.g. 50→100→500→… daily caps); `assertWarmupCap(domain, todayCount)` blocks sends over the day's ceiling and queues overflow to next day; auto-graduate to full volume after schedule completes with healthy metrics; surfaces ramp progress in deliverability dashboard.
  - Implementation notes: Warmup curve config (needs decision: exact daily steps); reconcile against actual SES send counts; overflow queued via QStash with scheduled delivery.
  - Hosting notes: Worker; Upstash QStash (scheduled), D1 (schedule state), CF Cron daily reset.
  - Backing services: SES, Upstash QStash, D1.
  - Observability: Tinybird `warmup {domain, day, cap, sent}`; alert on cap breach.
  - Dependencies: LOOP-MAIL-010, LOOP-MAIL-018.
  - Related files: `src/services/mail_warmup.ts`.

## crm.projectsites.dev — Twenty CRM

### Raw research themes considered

Brainstormed 50+ raw ideas spanning two distinct surfaces: (1) our internal sales/ops CRM that tracks every ProjectSites lead, trial, paying customer, and site-claim through a pipeline, and (2) a multi-tenant customer-facing CRM that small businesses get provisioned per-org so they can manage their own leads, contacts, and opportunities. Themes clustered around Twenty 2.0 platform primitives (metadata API for custom fields/objects, filtered webhooks, code-defined workflows, serverless functions, native MCP server), sync fabric (Listmonk, Chatwoot, Nango, Stripe, Lead Scanner), AI augmentation (summaries, enrichment, duplicate detection, task generation), and lifecycle/governance (per-site provisioning, deprovisioning, permissions, import/export). Selection prioritized reusable primitives over one-offs: a typed Twenty client wrapper, a metadata-schema bootstrapper, a webhook-ingest pipe, and a per-tenant provisioning DO are the load-bearing foundations everything else builds on. Cut purely cosmetic ideas (theme skins, vanity dashboards) and anything Twenty already does natively without integration value. Hosting decisions baked in: all integration glue runs on Cloudflare Workers/Containers; Twenty itself stays on Fly.io (stateful, 24-7, Neon-backed) since it is a long-running realtime Postgres app.

### Selected 24 implementation tasks

- [ ] LOOP-CRM-001: Typed Twenty REST+GraphQL client wrapper with WAF-bypass + retry
  - Why: Every CRM task needs one safe, typed entry point; direct curl hits Bot-Fight 403 and unknown REST fields 400.
  - Acceptance criteria: `TwentyClient` exposes `createCompany/createPerson/createOpportunity/findByDomain/query(gql)`; all returns Zod-validated; createCompany reads `data.createCompany.id`; address sent as composite field; 429/5xx retried with jitter; integration test against live crm.projectsites.dev passes.
  - Implementation notes: Single module `src/services/twenty/client.ts`; route through the host's existing WAF skip; map composite `address` (`addressStreet1`, `addressCity`, ...); never send unknown fields — validate against fetched metadata first.
  - Hosting notes: Cloudflare Worker (stateless glue); Twenty backend stays on Fly.io.
  - Backing services: Twenty (Neon Postgres), Upstash Redis for token/rate-limit cache.
  - Observability: Axiom structured logs with correlation IDs (tenant_id, request_id, api_key_id); Sentry platform-only on thrown errors.
  - Dependencies: none (foundation).
  - Related files: src/services/twenty/client.ts, src/services/twenty/schemas.ts
- [ ] LOOP-CRM-002: Metadata-schema bootstrapper — idempotent custom-field/object provisioner
  - Why: Twenty REST 400s on unknown fields; custom fields/objects must be created via metadata API before any write.
  - Acceptance criteria: Declarative `schema.ts` describing required custom fields (e.g. `siteSlug`, `claimStatus`, `planTier`, `leadSource`, `confidenceScore`) and custom objects (`Site`, `Claim`); `npm run crm:migrate` creates missing, skips existing, never duplicates; dry-run mode prints diff.
  - Implementation notes: Read current metadata via GraphQL, diff against declared spec, POST only deltas; store applied-version hash in D1 to short-circuit.
  - Hosting notes: Worker-invoked CLI / cron; Twenty metadata API on Fly.io.
  - Backing services: Twenty metadata API, Cloudflare D1 (migration ledger).
  - Observability: Axiom log per field created with schema_version; emit `crm.schema.migrated` event.
  - Dependencies: LOOP-CRM-001.
  - Related files: src/services/twenty/schema.ts, src/services/twenty/migrate.ts
- [ ] LOOP-CRM-003: Twenty filtered-webhook ingest pipe (Hookdeck + Outpost)
  - Why: Reacting to CRM changes (new opportunity, stage move) requires reliable, deduped inbound webhook delivery.
  - Acceptance criteria: Twenty webhook configured to POST to a Hookdeck source; Worker receiver verifies signature, dedupes by event id in D1, routes by event type; replays from Hookdeck DLQ work; handler returns 200 fast and defers work to a queue.
  - Implementation notes: One `/api/crm/webhook` Hono route; idempotency table keyed on Twenty event id; fan-out via Upstash QStash.
  - Hosting notes: Cloudflare Worker receiver; Hookdeck+Outpost as the webhook gateway (per decision).
  - Backing services: Hookdeck, Outpost, D1 (idempotency), Upstash QStash (fan-out).
  - Observability: Axiom log with event_type + trace_id; Sentry on signature failures.
  - Dependencies: LOOP-CRM-001.
  - Related files: src/routes/crm-webhook.ts, src/services/twenty/webhook.ts
- [ ] LOOP-CRM-004: ProjectSites customer pipeline definition + stage automation
  - Why: Internal sales/ops needs a canonical pipeline (Lead → Qualified → Trial → Paying → Churned) to track every account.
  - Acceptance criteria: Pipeline + stages provisioned via metadata bootstrapper; opportunities auto-created on trial start; stage transitions driven by signals (first publish, first payment) via webhook; stage history queryable.
  - Implementation notes: Map ProjectSites lifecycle events to Twenty opportunity stage updates; guard against backward transitions unless forced.
  - Hosting notes: Cloudflare Worker automation; Twenty on Fly.io.
  - Backing services: Twenty, D1 (event source), Upstash QStash.
  - Observability: Axiom log per stage transition with site_id + opportunity id; Tinybird funnel event.
  - Dependencies: LOOP-CRM-002, LOOP-CRM-003.
  - Related files: src/services/crm/pipeline.ts
- [ ] LOOP-CRM-005: Site-claim → CRM record pipeline
  - Why: When a local business claims a generated site, that intent must become a tracked Company+Person+Opportunity.
  - Acceptance criteria: Claim flow creates/links Company by domain (dedupe via findByDomain), creates Person from claimant contact, opens opportunity at "Claimed" stage, sets `siteSlug`/`claimStatus`; idempotent on repeat claim.
  - Implementation notes: Reuse Lead Scanner→Twenty wiring; upsert-by-domain to avoid dup companies.
  - Hosting notes: Cloudflare Worker; Twenty on Fly.io.
  - Backing services: Twenty, D1 (claim records).
  - Observability: Axiom log with site_id + claim_id; PostHog `claim_to_crm` event.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-004, LOOP-CRM-010.
  - Related files: src/services/crm/site-claim.ts
- [ ] LOOP-CRM-006: AI lead enrichment serverless function (Twenty code-defined workflow)
  - Why: Raw leads lack firmographics; enrichment lifts qualification quality with near-zero manual effort.
  - Acceptance criteria: On Company create, a Twenty serverless function (or Worker triggered by webhook) enriches industry, size, socials, and a one-line summary; writes to custom fields; respects a per-tenant budget cap; failures degrade gracefully (record still usable).
  - Implementation notes: Pull from Google Places (already wired) + LLM summarization; cache enrichment by domain in Upstash to avoid re-spend.
  - Hosting notes: Cloudflare Worker (LLM call); could deploy as Twenty serverless function — (needs decision) on where the function runs.
  - Backing services: Twenty, Google Places, Workers AI / external LLM, Upstash Redis cache, Langfuse (AI trace).
  - Observability: Langfuse trace per enrichment; Axiom log with confidence + cost; budget counter in Upstash.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-002, LOOP-CRM-003.
  - Related files: src/services/crm/enrich.ts
- [ ] LOOP-CRM-007: AI duplicate detection + merge suggester
  - Why: Imports and multi-source sync create duplicate Companies/People; dirty data erodes trust.
  - Acceptance criteria: Nightly cron scans recent records, scores pairs (domain/email/name+phone fuzzy + embedding similarity), writes merge candidates to a review queue; admin one-click merge calls Twenty merge; auto-merge only above high-confidence threshold.
  - Implementation notes: Blocking key on normalized domain/email to bound comparisons; cosine similarity on name+address embedding for tie-break.
  - Hosting notes: Cloudflare Worker cron; Twenty on Fly.io.
  - Backing services: Twenty, Workers AI (embeddings), D1 (candidate queue).
  - Observability: Axiom log with pair score; PostHog `dup_merge` event; Tinybird dup-rate metric.
  - Dependencies: LOOP-CRM-001.
  - Related files: src/services/crm/dedupe.ts
- [ ] LOOP-CRM-008: AI account/contact summary on demand + timeline digest
  - Why: Ops wants a one-paragraph "where does this account stand" without reading the whole timeline.
  - Acceptance criteria: `/api/crm/:companyId/summary` returns an LLM summary over the account's opportunities, notes, activities, and synced messages; cached 15 min; includes "next best action"; surfaced in admin CRM panel.
  - Implementation notes: Assemble context from Twenty GraphQL (timeline + opportunities) + Chatwoot conversations; truncate to token budget.
  - Hosting notes: Cloudflare Worker; Twenty on Fly.io.
  - Backing services: Twenty, Chatwoot, external LLM, Upstash (summary cache), Langfuse.
  - Observability: Langfuse trace; Axiom log with company id + token count.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-014.
  - Related files: src/services/crm/summary.ts
- [ ] LOOP-CRM-009: AI task generation from activity + stale-deal nudges
  - Why: Deals stall silently; auto-generated tasks keep the solo founder's pipeline moving.
  - Acceptance criteria: On stage change or inbound message, generate a Twenty Task with due date + suggested action; daily cron flags opportunities idle > N days and creates follow-up tasks; tasks dedupe per opportunity.
  - Implementation notes: Rules engine first (stale > 7d), LLM for the task copy; idempotency key per opportunity+rule per day.
  - Hosting notes: Cloudflare Worker cron + webhook; Twenty on Fly.io.
  - Backing services: Twenty, external LLM, D1 (task idempotency).
  - Observability: Axiom log per task created; PostHog `crm_task_generated`.
  - Dependencies: LOOP-CRM-003, LOOP-CRM-008.
  - Related files: src/services/crm/tasks.ts
- [ ] LOOP-CRM-010: Local-business records ingest from Lead Scanner + Google Places
  - Why: The site-claim funnel starts from discovered local businesses; they must land as clean Company records.
  - Acceptance criteria: Lead Scanner output upserts Companies by domain/place_id; stores `placeId`, category, rating, lead_source; no dup on re-scan; rate-limited writes.
  - Implementation notes: Extend existing Lead Scanner→Twenty wiring; normalize phone/address to composite fields.
  - Hosting notes: Cloudflare Worker; Twenty on Fly.io.
  - Backing services: Twenty, Google Places, Upstash (rate limit).
  - Observability: Axiom log with place_id + lead_source; Tinybird `claims_by_source` feed.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-002.
  - Related files: src/services/crm/local-business.ts
- [ ] LOOP-CRM-011: Listmonk ↔ Twenty bidirectional contact sync
  - Why: Email marketing and CRM must share one contact graph; manual export is error-prone.
  - Acceptance criteria: New/updated People sync to Listmonk lists by segment (plan tier, claim status); Listmonk subscribe/unsubscribe events flow back to Twenty contact fields; conflict resolution last-write-wins with audit; opt-out always wins.
  - Implementation notes: Map Twenty segments → Listmonk lists; webhook both directions; store sync cursor in D1.
  - Hosting notes: Cloudflare Worker; Twenty + Listmonk both Fly.io/Neon-backed.
  - Backing services: Twenty, Listmonk (Neon), D1 (sync cursor), Upstash QStash.
  - Observability: Axiom log with contact id + direction; Sentry on conflict failures.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-003.
  - Related files: src/services/crm/listmonk-sync.ts
- [ ] LOOP-CRM-012: Chatwoot ↔ Twenty contact + conversation link
  - Why: Support and sales need the same customer; conversations should attach to CRM timeline.
  - Acceptance criteria: Chatwoot contact create/update upserts Twenty Person by email; conversation open/resolve writes a CRM activity with deep link; CRM record shows latest support status.
  - Implementation notes: Chatwoot webhook → Worker → Twenty activity; store Chatwoot conversation id as custom field.
  - Hosting notes: Cloudflare Worker; both apps Fly.io.
  - Backing services: Twenty, Chatwoot, D1 (id mapping).
  - Observability: Axiom log with conversation_id + contact id.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-003.
  - Related files: src/services/crm/chatwoot-sync.ts
- [ ] LOOP-CRM-013: Nango-powered third-party contact sync (Google/HubSpot/etc.)
  - Why: Customers want to import contacts from where they already live; Nango unifies the OAuth + sync plumbing.
  - Acceptance criteria: Per-tenant Nango connection enables importing contacts from a chosen provider into that tenant's Twenty workspace; incremental sync via cursor; field mapping configurable; revoke cleanly removes connection.
  - Implementation notes: Nango sync scripts normalize to Twenty People schema; per-tenant connection id scoped by tenant_id.
  - Hosting notes: Cloudflare Worker orchestrator; Nango self-hosted on Fly.io (stateful) — (needs decision) self-host vs Nango Cloud.
  - Backing services: Nango, Twenty, D1 (connection registry).
  - Observability: Axiom log with provider + tenant_id + records synced; Sentry on auth failures.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-020.
  - Related files: src/services/crm/nango-sync.ts
- [ ] LOOP-CRM-014: Unified CRM timeline aggregator (activities across sources)
  - Why: A trustworthy "single timeline" needs CRM notes, emails, support, billing, and site events merged chronologically.
  - Acceptance criteria: `/api/crm/:companyId/timeline` returns a merged, paginated stream from Twenty activities + Listmonk sends + Chatwoot conversations + Stripe events + site publishes, normalized to a typed event shape; respects permissions.
  - Implementation notes: Reusable `TimelineEvent` Zod schema; sources fetched in parallel and merge-sorted; cursor pagination.
  - Hosting notes: Cloudflare Worker; sources across Fly.io + external.
  - Backing services: Twenty, Listmonk, Chatwoot, Stripe, D1.
  - Observability: Axiom log with company id + source counts; Tinybird timeline-render metric.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-011, LOOP-CRM-012, LOOP-CRM-016.
  - Related files: src/services/crm/timeline.ts
- [ ] LOOP-CRM-015: Customer onboarding workflow (trial → activated)
  - Why: New paying customers need a guided, automated onboarding that the CRM tracks to "activated".
  - Acceptance criteria: On first payment, create onboarding opportunity with checklist tasks (connect domain, publish first site, invite teammate); progress auto-checks via product signals; "activated" stage fires when all complete; nudges if stalled.
  - Implementation notes: Reuse task generation + pipeline automation; checklist state in custom object.
  - Hosting notes: Cloudflare Worker; Twenty on Fly.io.
  - Backing services: Twenty, Stripe, D1, Upstash QStash.
  - Observability: Axiom log; Tinybird `activation_funnel` feed; PostHog onboarding cohort.
  - Dependencies: LOOP-CRM-004, LOOP-CRM-009, LOOP-CRM-016.
  - Related files: src/services/crm/onboarding.ts
- [ ] LOOP-CRM-016: Stripe ↔ CRM billing sync (MRR, plan, dunning into records)
  - Why: Sales/ops decisions hinge on billing truth; CRM should reflect plan, MRR, and payment health.
  - Acceptance criteria: Stripe webhooks update Company custom fields (`planTier`, `mrr`, `paymentStatus`); failed-payment fires a dunning task + churn-risk flag; subscription cancel moves opportunity to Churned with reason.
  - Implementation notes: Reuse existing Stripe webhook idempotency; map customer→Company via metadata email/site_id.
  - Hosting notes: Cloudflare Worker; Twenty on Fly.io.
  - Backing services: Stripe (platform-only), Twenty, D1 (idempotency).
  - Observability: Axiom log with stripe event + company id; Sentry on mapping miss.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-003, LOOP-CRM-004.
  - Related files: src/services/crm/stripe-sync.ts
- [ ] LOOP-CRM-017: Support → sales handoff + escalation workflow
  - Why: A support conversation that signals buying intent or churn risk must reach sales with full context.
  - Acceptance criteria: Tagging a Chatwoot conversation "sales"/"at-risk" creates/links a Twenty opportunity, assigns owner, attaches conversation summary; escalation notifies via the platform notify channel; round-trip status visible in CRM.
  - Implementation notes: Reuse Chatwoot sync + AI summary; assignment rules configurable per tenant.
  - Hosting notes: Cloudflare Worker; both apps Fly.io.
  - Backing services: Twenty, Chatwoot, external LLM (summary), Upstash QStash.
  - Observability: Axiom log with conversation_id + opportunity id; PostHog `support_to_sales`.
  - Dependencies: LOOP-CRM-008, LOOP-CRM-012.
  - Related files: src/services/crm/handoff.ts
- [ ] LOOP-CRM-018: Per-tenant CRM provisioning (workspace + schema + seed)
  - Why: A customer-facing multi-tenant CRM needs an isolated, ready-to-use workspace created on signup.
  - Acceptance criteria: `provisionTenantCrm(tenantId)` creates an isolated Twenty workspace (or scoped namespace), applies the metadata schema, seeds default pipeline + sample records, registers connection in D1, returns access URL; idempotent + resumable.
  - Implementation notes: Drive via a Durable Object state machine for resumable multi-step provisioning; isolate by Twenty workspace per tenant — (needs decision) workspace-per-tenant vs row-level scoping at scale.
  - Hosting notes: Provisioning orchestrated by a Cloudflare Durable Object (stateful workflow); Twenty workspaces on Fly.io/Neon.
  - Backing services: Twenty, Neon (per-workspace), D1 (tenant registry), Durable Objects.
  - Observability: Axiom log per step with tenant_id + job_id; Sentry on step failure; emit `crm.tenant.provisioned`.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-002.
  - Related files: src/services/crm/provision.ts, src/durable/crm-provision-do.ts
- [ ] LOOP-CRM-019: CRM deprovisioning / app deletion with data export
  - Why: Customers must be able to leave cleanly; GDPR-grade deletion with a final export is non-negotiable.
  - Acceptance criteria: `deprovisionTenantCrm(tenantId)` produces a final export bundle to R2, revokes all sync connections, deletes the workspace, and tombstones the registry row; reversible within a grace window; audit-logged.
  - Implementation notes: DO-driven saga mirroring provisioning; soft-delete (tombstone + grace) before hard delete; export reuses LOOP-CRM-021.
  - Hosting notes: Cloudflare Durable Object saga; export bundle to R2.
  - Backing services: Twenty, Neon, R2 (export bundle), D1 (registry), Durable Objects.
  - Observability: Axiom log per step; emit `crm.tenant.deprovisioned`; Sentry on partial failure.
  - Dependencies: LOOP-CRM-018, LOOP-CRM-021.
  - Related files: src/services/crm/deprovision.ts
- [ ] LOOP-CRM-020: Per-tenant CRM permissions + RBAC bridge
  - Why: Multi-tenant CRM must enforce that a tenant only ever sees its own workspace, with internal roles for admin/agency modes.
  - Acceptance criteria: Requests carry server-derived tenant_id (never client header — IDOR class); role map (owner/member/viewer/agency) gates CRM API actions; Twenty API key per tenant scoped + rotatable; cross-tenant access returns 404 not 403.
  - Implementation notes: Bridge platform RBAC (packages/shared) to Twenty workspace roles; store per-tenant key id in D1, secret in wrangler.
  - Hosting notes: Cloudflare Worker auth middleware; Twenty on Fly.io.
  - Backing services: Twenty, D1 (key registry), Cloudflare secrets.
  - Observability: Axiom log with tenant_id + api_key_id + role decision; Sentry on cross-tenant attempt.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-018.
  - Related files: src/services/crm/rbac.ts, src/middleware/crm-auth.ts
- [ ] LOOP-CRM-021: CRM data import/export (CSV + JSON) with field mapping
  - Why: Customers arrive with spreadsheets and leave wanting their data; import/export is table-stakes CRM.
  - Acceptance criteria: CSV/JSON upload to R2, async mapping job validates rows against schema, upserts with dedupe, reports per-row errors; export streams all tenant records to a signed R2 URL; both respect tenant scope + permissions.
  - Implementation notes: Streaming parse in a Worker + queue for large files; reuse dedupe (CRM-007) on import; mapping presets per common source.
  - Hosting notes: Cloudflare Worker + Queue; files in R2.
  - Backing services: Twenty, R2 (files), D1 (job state), Upstash QStash.
  - Observability: Axiom log with job_id + rows imported/failed; PostHog `crm_import`/`crm_export`.
  - Dependencies: LOOP-CRM-001, LOOP-CRM-007, LOOP-CRM-020.
  - Related files: src/services/crm/import-export.ts
- [ ] LOOP-CRM-022: Embedded customer-facing CRM panel in /admin (tenant view)
  - Why: A customer-visible CRM needs a polished in-product surface, not a raw Twenty login.
  - Acceptance criteria: Angular `/admin/crm` route renders tenant's contacts/pipeline/timeline via the Worker API (not direct Twenty); create/edit/delete with optimistic UI + ConfirmService; loading/empty/error states; cyan/black brand; E2E from homepage green.
  - Implementation notes: Reuse DialogShellComponent + error-card + rolling-counter; data via ApiService (bearer), never raw HttpClient.
  - Hosting notes: Angular SPA on Cloudflare; API on Worker; Twenty on Fly.io.
  - Backing services: Worker CRM API, Twenty.
  - Observability: PostHog UI events with featureSlug `crm_panel`; Axiom API logs.
  - Dependencies: LOOP-CRM-014, LOOP-CRM-020, behind feature flag `crm_panel`.
  - Related files: apps/project-sites/frontend/.../crm/, libs/features/crm_panel/
- [ ] LOOP-CRM-023: Agency CRM mode — multi-client portfolio view
  - Why: Agencies managing many ProjectSites clients need a cross-client roll-up, not one workspace at a time.
  - Acceptance criteria: An agency org with linked child tenants gets a portfolio dashboard aggregating pipelines/MRR/at-risk across clients; drill-down into any client CRM; strict permission boundary (agency sees only its linked clients).
  - Implementation criteria/notes: Aggregate read-only across child tenant workspaces; cache rollups in Upstash 60s; respect per-client RBAC.
  - Implementation notes: Build on RBAC bridge; portfolio query fans out across child tenant_ids with permission filter.
  - Hosting notes: Cloudflare Worker aggregator; Twenty on Fly.io.
  - Backing services: Twenty, Upstash (rollup cache), D1 (agency↔client links).
  - Observability: Axiom log with agency_id + client count; Tinybird portfolio metric.
  - Dependencies: LOOP-CRM-020, LOOP-CRM-022, behind flag `crm_agency_mode`.
  - Related files: src/services/crm/agency.ts
- [ ] LOOP-CRM-024: CRM analytics pipe — Twenty events → Tinybird (no ClickHouse)
  - Why: Twenty's analytics use ClickHouse; per decision we never deploy ClickHouse and pipe events to Tinybird instead.
  - Acceptance criteria: CRM domain events (record created, stage moved, claim, import) stream to a Tinybird datasource via the webhook pipe; canonical endpoints expose pipeline conversion, MRR trend, lead-source breakdown, dup-rate; admin charts read these endpoints.
  - Implementation notes: Define typed event schema; ingest via Tinybird Events API from the webhook fan-out; build endpoints (`pipeline_conversion`, `mrr_trend`, `crm_leads_by_source`).
  - Hosting notes: Cloudflare Worker emitter; Tinybird hosted; never run ClickHouse.
  - Backing services: Tinybird, Twenty, Upstash Kafka (optional buffer for high volume).
  - Observability: Axiom log on ingest with event_type; Tinybird datasource health check.
  - Dependencies: LOOP-CRM-003, LOOP-CRM-004, LOOP-CRM-016.
  - Related files: src/services/crm/analytics-pipe.ts

## support.projectsites.dev — Chatwoot

### Raw research themes considered

Surveyed Chatwoot's runtime shape (Rails 7 monolith + Sidekiq background workers + ActionCable websocket server, requiring Postgres ≥13 and Redis), its multi-account/multi-inbox model, web-widget SDK, agent-bot + automation/SLA primitives, help-center (portal) module, and webhook surface — alongside our concierge (llm.projectsites.dev), CRM (crm-twenty), and Stripe billing. **Hosting verdict: CF Workers Containers are NOT a good fit for the full Chatwoot stack.** ActionCable holds long-lived websockets and Sidekiq is a 24/7 always-on worker draining Redis queues; CF Containers idle-sleep and are request-scoped, which silently kills both the realtime channel and queued jobs (mailers, attachment processing, automation triggers). **Fly.io is the justified escape hatch** for the Rails web + Sidekiq + ActionCable process groups (persistent machines, internal 6PN networking, scale-to-N). We keep CF as the front door (proxied DNS/TLS, Turnstile, WAF) and push attachments to R2, Postgres to Neon, Redis to Upstash — so only the genuinely-stateful Rails/Sidekiq/Cable tier lives on Fly. CF Container is reserved for any *stateless* edge shim (widget loader, webhook normalizer) we put in front of it.

### Selected 24 implementation tasks

- [ ] LOOP-SUP-001: Deploy Chatwoot Rails web tier to Fly.io (escape-hatch decision of record)
  - Why: Chatwoot is a stateful Rails monolith; we need our own support inbox live at support.projectsites.dev before anything else can be built.
  - Acceptance criteria: `fly deploy` brings up the `chatwoot-web` process group; `/` returns 200; super-admin login works; health endpoint `/api/v1/...` reachable; image pinned to a Chatwoot release tag (no `:latest`).
  - Implementation notes: Use official `chatwoot/chatwoot` image; `fly.toml` with `[processes] web = "bundle exec rails server"`; release command runs `rails db:chatwoot_prepare` for migrations; `SECRET_KEY_BASE`, `FRONTEND_URL=https://support.projectsites.dev`.
  - Hosting notes: **Fly.io, NOT CF Containers** — Rails app server is long-running and shares the same machines as Sidekiq/Cable below; CF Containers' idle-sleep would drop the app between requests. CF Container considered and rejected (state this in `docs/decisions/`).
  - Backing services: Neon (LOOP-SUP-002), Upstash (LOOP-SUP-003), R2 (LOOP-SUP-004).
  - Observability: Ship Rails logs to Axiom via Fly log shipper; tag `service=chatwoot-web`, `request_id`.
  - Dependencies: LOOP-SUP-002, LOOP-SUP-003.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`, `docs/decisions/chatwoot-hosting.md`.

- [ ] LOOP-SUP-002: Provision Neon Postgres database for Chatwoot
  - Why: Chatwoot's system of record (conversations, contacts, messages, accounts) needs durable Postgres.
  - Acceptance criteria: A `projectsites_chatwoot` database exists inside the shared Neon project; pooled connection string stored as Fly secret `DATABASE_URL`; pgvector extension enabled (Chatwoot Captain/embeddings optionally use it); migrations apply clean.
  - Implementation notes: `CREATE DATABASE projectsites_chatwoot;` on existing shared project (do NOT create a new Neon project per `neon-database-conservation`); use pooled endpoint for web, direct endpoint for migration release step.
  - Hosting notes: DB is external/managed — independent of Fly machine lifecycle.
  - Backing services: Neon.
  - Observability: Enable Neon slow-query insights; correlate via `tenant_id` where Chatwoot account maps to a tenant.
  - Dependencies: none.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`, `docs/decisions/chatwoot-hosting.md`.

- [ ] LOOP-SUP-003: Provision Upstash Redis for Sidekiq queues + ActionCable pub/sub
  - Why: Both Sidekiq job queues and ActionCable's broadcast fan-out require Redis; this is the realtime backbone.
  - Acceptance criteria: Upstash Redis DB created; `REDIS_URL` set as Fly secret; TLS (`rediss://`) verified; Sidekiq enqueues + drains a test job; a broadcast on one machine reaches a websocket client on another.
  - Implementation notes: Use Upstash global/regional DB close to Fly region; set `REDIS_OPENSSL_VERIFY_MODE=none` only if cert chain fights TLS; confirm `maxmemory-policy` is `noeviction` (eviction can drop queued jobs).
  - Hosting notes: External managed Redis decouples queue state from ephemeral machine restarts.
  - Backing services: Upstash Redis.
  - Observability: Upstash metrics for queue depth; alert when Sidekiq backlog > threshold.
  - Dependencies: none.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`.

- [ ] LOOP-SUP-004: Route Chatwoot attachments + avatars to R2 (S3-compatible Active Storage)
  - Why: Conversation attachments must not live on ephemeral Fly disk; R2 is our object store and is egress-free.
  - Acceptance criteria: `ACTIVE_STORAGE_SERVICE=s3` with R2 endpoint/keys; uploading a file in a conversation persists to R2 bucket `projectsites-chatwoot`; signed download URLs resolve; restart of a machine does not lose attachments.
  - Implementation notes: Set `STORAGE_BUCKET_NAME`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_ENDPOINT=https://<acct>.r2.cloudflarestorage.com`, `STORAGE_REGION=auto`, `STORAGE_FORCE_PATH_STYLE=true`.
  - Hosting notes: Eliminates need for Fly persistent volumes for uploads (Fly volumes only needed, if at all, for nothing here).
  - Backing services: R2.
  - Observability: Log attachment upload size/result with `conversation_id`.
  - Dependencies: LOOP-SUP-001.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`.

- [ ] LOOP-SUP-005: Run Sidekiq as a dedicated Fly process group
  - Why: Background jobs (emails, automation rules, webhook delivery, report generation) are a 24/7 worker — exactly the workload CF Containers cannot host.
  - Acceptance criteria: `[processes] worker = "bundle exec sidekiq"` deployed; Sidekiq dashboard shows it consuming the `REDIS_URL`; a queued mailer job completes; worker auto-restarts on crash; min 1 machine always running (no scale-to-zero).
  - Implementation notes: Separate scaling from web (`fly scale count worker=1`); set `SIDEKIQ_CONCURRENCY`; ensure `autostop=false` for the worker group.
  - Hosting notes: **Fly.io required** — persistent always-on worker; explicitly NOT CF Containers (idle-sleep would stall the queue silently).
  - Backing services: Upstash Redis, Neon.
  - Observability: Sidekiq metrics → Axiom; alert on retry-set growth; tag `job_id`, `queue`.
  - Dependencies: LOOP-SUP-003, LOOP-SUP-001.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`.

- [ ] LOOP-SUP-006: Enable ActionCable realtime (live chat websockets) on Fly
  - Why: Live chat and agent typing/presence depend on persistent websocket connections; this is the second reason CF Containers are unsuitable.
  - Acceptance criteria: Websocket upgrade to `/cable` succeeds through CF proxy; a customer widget message appears in the agent inbox in <1s without refresh; connection survives across agent navigation.
  - Implementation notes: Standalone `anycable`/Cable is optional; default in-process ActionCable is fine at our scale — ensure Fly `[[services]]` forwards websocket (CF must be set to allow ws upgrade on the proxied hostname); confirm `RAILS_ENV=production` Cable allowed-origins includes support.projectsites.dev and widget host origins.
  - Hosting notes: Long-lived ws connections — Fly machines stay warm; CF in front must not buffer/close the upgrade (verify, not assume).
  - Backing services: Upstash Redis (cable adapter).
  - Observability: Track active cable connection count; log disconnect reasons with `conversation_id`.
  - Dependencies: LOOP-SUP-003, LOOP-SUP-007.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`.

- [ ] LOOP-SUP-007: Wire support.projectsites.dev DNS, CF proxy, TLS to the Fly app
  - Why: Brand domain, edge TLS, WAF, and Turnstile all flow through the CF front door even though origin is Fly.
  - Acceptance criteria: CNAME/`AAAA`+`A` to Fly anycast IPs (proxied=DNS-only OR proxied with ws verified); Fly cert issued for support.projectsites.dev; HTTPS 200; websocket still upgrades end-to-end.
  - Implementation notes: `fly certs add support.projectsites.dev`; add the Fly-provided validation records via CF API (`cloudflare-native-provisioning`); decide proxied-vs-grey-cloud after ws test (CF proxy can interfere with Cable — verify per `cf-containers-no-dev-shm`-style caution).
  - Hosting notes: CF = edge, Fly = origin; no CF Container involved.
  - Backing services: Cloudflare DNS, Fly TLS.
  - Observability: Synthetic uptime check on `/` and `/cable` handshake.
  - Dependencies: LOOP-SUP-001.
  - Related files: `apps/project-sites/wrangler.toml` (none), `docs/decisions/chatwoot-hosting.md`.

- [ ] LOOP-SUP-008: Configure outbound + inbound email channel (SES/Resend SMTP + inbound parse)
  - Why: Email is a first-class support channel — customers reply by email, agents reply from the inbox.
  - Acceptance criteria: Outbound SMTP sends agent replies (test conversation → email delivered); inbound email to support@ creates/updates a conversation; SPF/DKIM/DMARC aligned for the sending domain.
  - Implementation notes: `SMTP_ADDRESS`/`SMTP_USERNAME`/`SMTP_PASSWORD` (SES SMTP creds or Resend); inbound via Chatwoot's email channel + a forwarding/MX or provider inbound-parse webhook; mind `email-deliverability` rule and sending-vs-site-domain mismatch.
  - Hosting notes: SMTP egress from Fly machines; inbound webhook can land on a stateless CF Worker shim that forwards to Chatwoot.
  - Backing services: SES or Resend, R2 (inbound attachments).
  - Observability: Log send/deliver/bounce with `conversation_id`; bounces → Sentry (platform).
  - Dependencies: LOOP-SUP-001.
  - Related files: `apps/project-sites/infra/chatwoot/fly.toml`.

- [ ] LOOP-SUP-009: Per-site embeddable live-chat widget for site-owners (multi-tenant inboxes)
  - Why: Beyond our own support, generated sites can offer their visitors live chat — a paid platform feature mapped to per-tenant Chatwoot inboxes.
  - Acceptance criteria: For a given `site_id`, an inbox + website-channel exists; a one-line `<script>` snippet renders the widget on the site; messages land in the tenant's inbox; widget is feature-flagged (`support_widget`, default off).
  - Implementation notes: Provision inbox via Chatwoot API on plan-upgrade; store `chatwoot_inbox_id` against the site row; serve the loader through a stateless CF Worker (`widget.projectsites.dev`) that injects the tenant's `websiteToken` — **this stateless shim IS a fit for CF Workers/Containers**.
  - Hosting notes: Widget loader = CF (stateless); inbox state = Fly/Chatwoot.
  - Backing services: D1 (site→inbox map), R2 (loader asset).
  - Observability: Tag widget events with `site_id`, `tenant_id`, `conversation_id`.
  - Dependencies: LOOP-SUP-001, LOOP-SUP-016.
  - Related files: `apps/project-sites/src/services/` (new `chatwoot.ts` HTTP client), `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-SUP-010: AI triage agent-bot via llm.projectsites.dev (categorize + priority + first-response)
  - Why: Auto-classifying and drafting the first reply cuts response time and routes correctly before a human touches it.
  - Acceptance criteria: New conversation fires a webhook → triage service classifies (category, urgency, suspected-billing/domain/app-install) and sets Chatwoot labels + priority; optionally posts an AI draft as a private suggestion; all model calls traced.
  - Implementation notes: Chatwoot Agent Bot connected to a CF Worker endpoint; Worker calls llm.projectsites.dev with a structured (Zod) classification schema; idempotent on `conversation_id`.
  - Hosting notes: Triage handler is **stateless → CF Worker** (good fit); it merely calls Chatwoot + LLM over HTTP.
  - Backing services: llm.projectsites.dev, Langfuse (traces).
  - Observability: Langfuse trace per triage with `conversation_id`, `trace_id`; Axiom structured log.
  - Dependencies: LOOP-SUP-001, LOOP-SUP-019.
  - Related files: `apps/project-sites/src/services/chatwoot.ts`, `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-SUP-011: AI concierge → human handoff (escalate llm.projectsites.dev sessions into Chatwoot)
  - Why: When the in-product AI concierge can't resolve an issue, it must seamlessly open a real support conversation with full context.
  - Acceptance criteria: Concierge "talk to a human" creates a Chatwoot conversation pre-loaded with the AI transcript + user identity; the user is dropped into the same widget thread; no context re-entry required.
  - Implementation notes: Map concierge `session_id` → Chatwoot `source_id`; POST transcript as the opening message + private note; reuse the contact-upsert (LOOP-SUP-012).
  - Hosting notes: Handoff orchestration = stateless CF Worker calling Chatwoot API.
  - Backing services: llm.projectsites.dev, Chatwoot API.
  - Observability: Correlate concierge `trace_id` ↔ `conversation_id` in one log line.
  - Dependencies: LOOP-SUP-010, LOOP-SUP-012.
  - Related files: `apps/project-sites/src/services/chatwoot.ts`.

- [ ] LOOP-SUP-012: Two-way contact sync between Chatwoot and Twenty CRM (crm-twenty)
  - Why: Support contacts and CRM people must be one identity so agents see the full relationship.
  - Acceptance criteria: A new Chatwoot contact upserts a Twenty person (by email); CRM company/plan attributes appear in the Chatwoot contact custom-attributes panel; updates flow both directions without loops.
  - Implementation notes: Chatwoot `contact_created`/`contact_updated` webhooks → CF Worker → Twenty GraphQL; dedupe on email; guard recursion with a `synced_at` marker.
  - Hosting notes: Sync worker stateless → CF Worker.
  - Backing services: crm-twenty (Twenty), Hookdeck (webhook ingress).
  - Observability: Log each upsert with `tenant_id`, `conversation_id`, CRM `person_id`.
  - Dependencies: LOOP-SUP-019.
  - Related files: `apps/project-sites/src/services/chatwoot.ts`, `apps/project-sites/src/services/` (twenty client).

- [ ] LOOP-SUP-013: Billing escalation enrichment — inject Stripe context into conversations
  - Why: Billing tickets resolve faster when the agent sees plan, MRR, last invoice, and dunning status inline.
  - Acceptance criteria: When a conversation is labeled `billing` (by triage or agent), a private note auto-populates with Stripe subscription status, last 3 invoices, and a deep link to the Stripe customer; refund action gated behind admin override.
  - Implementation notes: CF Worker reads Stripe by `tenant_id`→`stripe_customer_id`; never expose card data; refunds route through existing platform refund flow (test-mode first).
  - Hosting notes: Stateless CF Worker.
  - Backing services: Stripe, D1 (tenant→customer map).
  - Observability: Log billing-context fetch with `tenant_id`, `conversation_id`, `request_id`.
  - Dependencies: LOOP-SUP-010, LOOP-SUP-014.
  - Related files: `apps/project-sites/src/services/billing.ts`, `apps/project-sites/src/services/chatwoot.ts`.

- [ ] LOOP-SUP-014: Customer timeline / context side-panel (dashboard data in the agent view)
  - Why: Agents need the customer's platform activity — sites created, apps installed, domains, recent errors — without leaving the inbox.
  - Acceptance criteria: Chatwoot contact panel renders a dashboard-app iframe/custom-attributes block showing sites, app installs, domains, plan, and last 5 platform events for the matched `tenant_id`.
  - Implementation notes: Use Chatwoot "Dashboard App" (contact sidebar URL); CF Worker serves the read-only panel auth'd by a signed token; data from D1 + platform event log.
  - Hosting notes: Panel = stateless CF Worker page.
  - Backing services: D1, Tinybird (event timeline).
  - Observability: Tag panel loads with `tenant_id`, `agent_id`.
  - Dependencies: LOOP-SUP-012.
  - Related files: `apps/project-sites/src/routes/api.ts` (panel endpoint).

- [ ] LOOP-SUP-015: Knowledge base / help-center portal at support.projectsites.dev/help
  - Why: Deflect tickets and give the AI triage/concierge a citable source of truth.
  - Acceptance criteria: Chatwoot Help Center portal published with categories for onboarding, domains, apps, billing; articles searchable; portal reachable under the support hostname; sitemap + SEO basics present.
  - Implementation notes: Use Chatwoot's built-in portal; seed first articles from existing `docs/`; expose article corpus to the concierge for RAG citations.
  - Hosting notes: Portal served by the Fly Rails app (same monolith).
  - Backing services: Neon (articles), R2 (article images).
  - Observability: Track article views + search-no-result terms → backlog signal.
  - Dependencies: LOOP-SUP-001.
  - Related files: `docs/` (article sources).

- [ ] LOOP-SUP-016: SLA policies + automation rules engine configuration
  - Why: First-response and resolution targets must be enforced and breaches surfaced.
  - Acceptance criteria: SLA policy (e.g. first response 4h, resolution 24h by plan tier) attached to inboxes; breach raises a label + notification; automation rules (auto-label, auto-assign on keyword) defined as code-managed config, not click-ops.
  - Implementation notes: Provision SLA + automation rules via Chatwoot API from a seed script so they're reproducible/version-controlled; tier values keyed off plan.
  - Hosting notes: Config lives in Chatwoot DB (Neon); seed script runs from CI or Fly release.
  - Backing services: Neon.
  - Observability: Emit SLA-breach events to Tinybird (`tenant_id`, `conversation_id`).
  - Dependencies: LOOP-SUP-001.
  - Related files: `apps/project-sites/infra/chatwoot/seed-sla.mjs`.

- [ ] LOOP-SUP-017: Team routing / auto-assignment (round-robin + skill-based)
  - Why: Tickets must reach the right agent/team (billing vs technical vs onboarding) without manual triage.
  - Acceptance criteria: Teams created (Billing, Technical, Onboarding); auto-assignment distributes within team; triage labels (LOOP-SUP-010) drive team routing; unassigned-queue alert fires after N minutes.
  - Implementation notes: Chatwoot team + auto-assignment config via API seed; routing decision can be enriched by the triage classification.
  - Hosting notes: Routing logic in Chatwoot; optional pre-routing in the stateless triage Worker.
  - Backing services: Neon.
  - Observability: Log assignment decisions with `conversation_id`, `agent_id`, `team_id`.
  - Dependencies: LOOP-SUP-010, LOOP-SUP-016.
  - Related files: `apps/project-sites/infra/chatwoot/seed-sla.mjs`.

- [ ] LOOP-SUP-018: Support metrics pipeline → Tinybird (volume, FRT, CSAT, SLA)
  - Why: We need our own analytics on support health, beyond Chatwoot's built-in reports, joined to platform data.
  - Acceptance criteria: Conversation lifecycle events stream to a Tinybird datasource; published endpoints expose ticket volume, first-response-time, resolution-time, CSAT, SLA-breach rate by tenant/plan; numbers reconcile with Chatwoot's own report for a sample day.
  - Implementation notes: Chatwoot webhooks → CF Worker → Tinybird ingest; one row per state transition with correlation IDs.
  - Hosting notes: Ingest Worker stateless → CF.
  - Backing services: Tinybird, Hookdeck.
  - Observability: Self-monitor ingest lag; dead-letter failed rows to R2.
  - Dependencies: LOOP-SUP-019.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, `apps/project-sites/src/services/analytics.ts`.

- [ ] LOOP-SUP-019: Hardened webhook ingress for Chatwoot events (Hookdeck + Outpost)
  - Why: Triage, CRM sync, metrics, and concierge handoff all consume Chatwoot webhooks; delivery must be reliable, verified, idempotent, and replayable.
  - Acceptance criteria: All Chatwoot webhooks point at a Hookdeck source; signature verified; events fan out to triage/CRM/metrics consumers; D1 idempotency table dedupes; failed deliveries land in DLQ and are replayable.
  - Implementation notes: Use the `forge-webhook-handler` pattern (Hono route + sig verify + D1 idempotency + R2 dead-letter); Outpost for our outbound webhooks to tenants; bypass Bot-Fight-Mode by hosting receiver on a workers.dev/route per memory.
  - Hosting notes: Receiver = stateless CF Worker; **fits CF perfectly**.
  - Backing services: Hookdeck, Outpost, D1, R2.
  - Observability: Per-event log with `conversation_id`, `request_id`; DLQ depth alert.
  - Dependencies: LOOP-SUP-001.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-SUP-020: Abuse / spam prevention on widget + inbound channels
  - Why: A public chat widget and inbound email are spam/abuse magnets; protect agents and queue health.
  - Acceptance criteria: Turnstile gate on pre-chat form for anonymous widgets; per-IP/per-contact rate limit on conversation creation; spam heuristic (link-flood, repeat-content) auto-labels + holds; blocklist for known abusers.
  - Implementation notes: Turnstile widget minted via CF API; rate limit enforced in the stateless widget/webhook Worker (DO counter per `rate-limiting-plan-gated`); spam scoring can reuse the triage LLM call.
  - Hosting notes: Enforcement at CF edge (Turnstile + Worker), before reaching Fly.
  - Backing services: Cloudflare Turnstile, Durable Object (counter).
  - Observability: Log blocked attempts with `site_id`, `request_id`; spam-rate metric to Tinybird.
  - Dependencies: LOOP-SUP-009, LOOP-SUP-019.
  - Related files: `apps/project-sites/src/middleware/`, `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-SUP-021: Internal notes + private agent collaboration surfacing in /admin
  - Why: Agents (and the AI) annotate conversations privately; these must be first-class and never leak to customers.
  - Acceptance criteria: Private notes post via API and render distinctly; AI-generated suggestions land as private notes (never public); a guard test proves notes with `private:true` never appear in customer-visible history (LOOP-SUP-022).
  - Implementation notes: Standardize on Chatwoot's `private` message flag; triage/billing enrichment always writes private; add a regression test asserting privacy.
  - Hosting notes: Chatwoot-native; our writers are stateless Workers.
  - Backing services: Chatwoot API.
  - Observability: Audit-log every AI-authored private note with `trace_id`, `conversation_id`.
  - Dependencies: LOOP-SUP-010, LOOP-SUP-013.
  - Related files: `apps/project-sites/src/services/chatwoot.ts`.

- [ ] LOOP-SUP-022: Customer-visible support history in the platform /admin (read-only)
  - Why: Site owners should see their own past support conversations inside our dashboard, not a separate login.
  - Acceptance criteria: `/admin` support section lists the tenant's conversations (status, last message, resolution) pulled by `tenant_id`; opening one shows only public messages (private notes filtered server-side); pagination + empty state.
  - Implementation notes: ApiService → CF Worker → Chatwoot API scoped to the tenant's contact; strict server-side filter dropping `private` messages; Angular section per `admin-section-add-recipe` (cyan/black).
  - Hosting notes: Read path = stateless CF Worker; UI = existing Angular admin.
  - Backing services: Chatwoot API, D1 (tenant→contact map).
  - Observability: Log history reads with `tenant_id`, `user_id`, `request_id`.
  - Dependencies: LOOP-SUP-012, LOOP-SUP-021.
  - Related files: `apps/project-sites/src/routes/api.ts`, admin frontend `sections/support`.

- [ ] LOOP-SUP-023: Admin override tools (impersonate-safe reassign / merge / close / escalate)
  - Why: Operators need controlled superpowers — reassign, merge duplicate conversations, force-close, escalate to incident — without raw Chatwoot super-admin sprawl.
  - Acceptance criteria: `/admin` operator actions for reassign, merge, close, and "escalate to incident" each call Chatwoot API with audit logging + confirm dialog (danger-default per `confirm-service-danger-default`); destructive actions require platform admin role.
  - Implementation notes: Thin authorized endpoints in the worker; never accept client `x-org-id` (use server `c.get('orgId')` per IDOR memory); each action emits an audit event.
  - Hosting notes: Stateless CF Worker endpoints.
  - Backing services: Chatwoot API, D1 (audit log).
  - Observability: Audit row per override with `agent_id`, `conversation_id`, `request_id`.
  - Dependencies: LOOP-SUP-022.
  - Related files: `apps/project-sites/src/routes/api.ts`, `apps/project-sites/src/services/audit.ts`.

- [ ] LOOP-SUP-024: Incident-support bridge + AI-triage observability (Langfuse) and log shipping (Axiom)
  - Why: During platform incidents, support volume spikes and AI triage quality must be auditable; we also need a way to pin a status-banner to affected conversations.
  - Acceptance criteria: An "incident mode" toggle posts a status note/canned-reply to open conversations matching the affected `site_id`/region; every AI triage + suggestion call is traced in Langfuse with score hooks; all Chatwoot + worker logs ship to Axiom with the full correlation-ID set; Sentry captures platform-side exceptions only.
  - Implementation notes: Incident mode driven by the platform status source; Langfuse scoring rubric for triage accuracy enables regression tracking; standardize log fields: `tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id, conversation_id`.
  - Hosting notes: Incident orchestration = stateless CF Worker; Fly app logs via Fly→Axiom shipper.
  - Backing services: Langfuse, Axiom, Sentry (platform only), Tinybird (incident-volume metric).
  - Observability: This task IS the observability backbone for the subsystem.
  - Dependencies: LOOP-SUP-010, LOOP-SUP-018.
  - Related files: `apps/project-sites/src/lib/sentry.ts`, `apps/project-sites/src/services/chatwoot.ts`, `apps/project-sites/infra/chatwoot/fly.toml`.

## social.projectsites.dev — Postiz

### Raw research themes considered

Postiz is LIVE at social.projectsites.dev (/auth 200), hosted as ONE Fly.io app (accepted escape-hatch) because durable scheduling moved off BullMQ to Temporal Cloud — so all 50+ raw ideas were filtered to keep Postiz on Fly while every new platform glue surface lands on CF Workers behind a typed AGPL-isolating HTTP client. Themes mined: per-site social-account provisioning + reconnect/token-refresh flows, AI brand-voice post generation via llm.projectsites.dev (Langfuse-traced), local-business content calendars, review/event/holiday/launch post automations, agency approval mode, social analytics rollups to Tinybird, CRM/Listmonk audience sync, R2 media-library integration, rate-limit + failure alerting (Hookdeck/Outpost), and admin support tooling. Discarded ideas that violated repo decisions (e.g. "move Postiz to a CF Container", "embed Postiz UI in-process", "import @gitroom packages for shared types") and merged near-duplicates (separate "holiday posts" + "event posts" → one calendar-event engine with seed packs). Selection bias favored reusable primitives: one typed Postiz client, one webhook ingest worker, one campaign-template schema, one correlation-id logging contract spanning tenant/site/app/social_account/job/trace ids. Both axes are covered — our own ProjectSites brand presence AND social-publishing-as-a-feature for site owners.

### Selected 24 implementation tasks

- [ ] LOOP-SOCIAL-001: Typed AGPL-isolated Postiz HTTP client (`src/services/postiz.ts`)
  - Why: AGPL Postiz must never be imported as code; one thin client keeps the license firewall and gives every other task a single call surface.
  - Acceptance criteria: Worker module exposes `createPost`, `schedulePost`, `listAccounts`, `connectAccount`, `getAnalytics`, `deletePost`; all request/response shapes declared locally with Zod; zero `@gitroom/*` deps in package.json; bearer auth via `POSTIZ_API_KEY`; 5xx/4xx mapped to typed `PostizError` taxonomy.
  - Implementation notes: `fetch` to `https://social.projectsites.dev/public/v1/*`; retry-with-jitter on 429/5xx; never log raw token.
  - Hosting notes: Client runs on CF Workers; Postiz stays on Fly + Temporal Cloud (do NOT propose moving it).
  - Backing services: Postiz API (Fly), Upstash (idempotency keys).
  - Observability: Structured log per call with `tenant_id, site_id, social_account_id, request_id, trace_id`, latency, status; Axiom sink; Sentry on PostizError (platform-only).
  - Dependencies: none (foundation).
  - Related files: `src/services/postiz.ts`, `packages/shared/src/schemas/social.ts`, `src/types/env.ts`.

- [ ] LOOP-SOCIAL-002: D1 social schema + Drizzle migration (`social_accounts`, `social_posts`, `social_post_targets`)
  - Why: Platform needs a system-of-record on D1 for per-site accounts, scheduled posts, and per-channel targets independent of Postiz internals.
  - Acceptance criteria: Migration creates 3 tables keyed by `org_id` + `site_id`; `social_accounts` stores `postiz_integration_id`, provider, handle, status, `token_expires_at`; FK-style indexes on `(site_id, status)`; Zod schemas mirror columns; rollback path documented.
  - Implementation notes: Map Postiz integration ids to our rows; never store provider OAuth secrets in D1 (Postiz holds them).
  - Hosting notes: D1 production `ea3e839a-c641-4861-ae30-dfc63bff8032` AND `project-sites-db-production` (apply to both).
  - Backing services: Cloudflare D1.
  - Observability: Migration logs row counts; `featureSlug=social_publishing` on all queries.
  - Dependencies: LOOP-SOCIAL-001.
  - Related files: `apps/project-sites/migrations/*_social.sql`, `packages/shared/src/schemas/social.ts`.

- [ ] LOOP-SOCIAL-003: `social_publishing` feature flag + manifest module (`libs/features/social_publishing/`)
  - Why: Repo law — every post-launch capability ships behind a typed flag with manifest, schemas, tests, observability.
  - Acceptance criteria: `manifest.ts` with all 7 required fields; D1 seed row `enabled=0, rollout_percent=0, stage='experimental'`; server returns 404 (not 403) when off; UI returns null; `npm run validate:features` passes.
  - Implementation notes: `linked_e2e=e2e/social_publishing/`; `risk_notes` covers "posts silently un-publishable when disabled".
  - Hosting notes: Flag service on CF Workers + KV cache (60s).
  - Backing services: D1 `flag_overrides`, KV.
  - Observability: Flag-decision log with `tenant_id, site_id, api_key_id`.
  - Dependencies: LOOP-SOCIAL-002.
  - Related files: `libs/features/social_publishing/manifest.ts`, `apps/project-sites/src/services/feature_flags.ts`.

- [ ] LOOP-SOCIAL-004: Per-site social-account connect endpoint with OAuth-first + paste-key fallback
  - Why: Site owners must link X/Facebook/Instagram/LinkedIn accounts; follows the repo's MCP OAuth-first-with-paste-fallback pattern.
  - Acceptance criteria: `POST /api/social/:siteId/accounts/connect` returns Postiz hosted-auth URL when provider OAuth configured, else a paste-key form contract; on callback, persists `social_accounts` row; toast (never broken popup) on missing client id.
  - Implementation notes: Proxy Postiz `/integrations` connect; store returned integration id; scope account to `site_id`.
  - Hosting notes: Connect handler on CF Workers; provider OAuth dance terminates at Postiz (Fly).
  - Backing services: Postiz API, D1.
  - Observability: Log connect attempt + result with `social_account_id, provider, site_id, request_id`.
  - Dependencies: LOOP-SOCIAL-001, LOOP-SOCIAL-002.
  - Related files: `src/routes/social.ts`, `src/services/postiz.ts`.

- [ ] LOOP-SOCIAL-005: Social-account reconnect + token-expiry watcher (Cron + alert)
  - Why: Provider tokens expire silently and kill scheduled posts; owners need proactive reconnect prompts.
  - Acceptance criteria: Cron Trigger scans `social_accounts` for `status='expired'` or `token_expires_at < now+72h`; marks `needs_reconnect`; emits psnotify + email; admin sees a reconnect CTA; reconnect reuses LOOP-SOCIAL-004 flow.
  - Implementation notes: Poll Postiz integration health; throttle alerts (one per account per 24h).
  - Hosting notes: CF Cron Triggers; Postiz remains source of token state.
  - Backing services: D1, Resend (owner email), psnotify DO.
  - Observability: Alert log with `social_account_id, provider, expires_in`; Axiom.
  - Dependencies: LOOP-SOCIAL-004.
  - Related files: `src/routes/cron.ts`, `src/services/notifications.ts`.

- [ ] LOOP-SOCIAL-006: AI brand-voice profile per site (`site_brand_voice` schema + generator)
  - Why: AI-generated posts must sound like each business; a reusable brand-voice profile is the primitive every AI task consumes.
  - Acceptance criteria: D1 row per site holds tone, audience, banned-words, sample posts, emoji policy; `POST /api/social/:siteId/brand-voice/generate` derives a draft profile from the generated website content; editable + versioned.
  - Implementation notes: Call llm.projectsites.dev with site copy as context; Zod-validate structured output (contract-first).
  - Hosting notes: CF Workers calls llm.projectsites.dev; no model in-process.
  - Backing services: llm.projectsites.dev, D1, Langfuse (AI trace).
  - Observability: Langfuse trace `brand_voice.generate` with `tenant_id, site_id`; prompt version logged.
  - Dependencies: LOOP-SOCIAL-002.
  - Related files: `src/services/social_ai.ts`, `packages/shared/src/schemas/social.ts`.

- [ ] LOOP-SOCIAL-007: AI post generator endpoint (brand-voice-aware, multi-platform variants)
  - Why: Core value — turn a topic/prompt into platform-tailored posts (char limits, hashtags, CTA) using the site's brand voice.
  - Acceptance criteria: `POST /api/social/:siteId/posts/generate` returns N variants per requested platform, each within platform char limits, Zod-validated; honors banned-words; supports image-prompt suggestions; eval cases cover tone adherence.
  - Implementation notes: One prompt template per platform; reuse brand-voice profile; never auto-publish (returns drafts).
  - Hosting notes: CF Workers → llm.projectsites.dev.
  - Backing services: llm.projectsites.dev, Langfuse.
  - Observability: Langfuse trace `post.generate`; log token cost + platform; PostHog `social_post_generated`.
  - Dependencies: LOOP-SOCIAL-006.
  - Related files: `src/services/social_ai.ts`, `tools/evals/cases/social_brand_voice.json`.

- [ ] LOOP-SOCIAL-008: Schedule-post API → Postiz with D1 mirror + idempotency
  - Why: Owners schedule a generated draft to one or more accounts; durable scheduling is Postiz/Temporal's job, but we mirror state for UI + auditing.
  - Acceptance criteria: `POST /api/social/:siteId/posts/schedule` accepts content + targets + ISO datetime; idempotency key prevents double-submit; creates Postiz scheduled post; writes `social_posts` + `social_post_targets` rows with `postiz_post_id`; returns scheduled status.
  - Implementation notes: Validate each target is a connected, non-expired account; reject past datetimes.
  - Hosting notes: CF Workers writes; Temporal Cloud (via Postiz on Fly) executes the publish — do not re-implement scheduling.
  - Backing services: Postiz API, D1, Upstash (idempotency).
  - Observability: Log with `job_id` (postiz post id), `social_account_id[]`; PostHog `social_post_scheduled`.
  - Dependencies: LOOP-SOCIAL-002, LOOP-SOCIAL-004.
  - Related files: `src/routes/social.ts`, `src/services/postiz.ts`.

- [ ] LOOP-SOCIAL-009: Postiz outbound webhook ingest worker (publish success/failure)
  - Why: We need real publish outcomes to update D1, alert on failures, and feed analytics — must arrive via webhook, not polling.
  - Acceptance criteria: `POST /api/webhooks/postiz` verifies HMAC signature; D1 idempotency on event id; updates `social_post_targets` status (`published|failed`) + permalink; dead-letters to R2 on parse failure; 200 fast-ack.
  - Implementation notes: Host on workers.dev path to bypass Bot Fight Mode for inbound M2M; route via Hookdeck+Outpost for retries.
  - Hosting notes: CF Worker receiver; Hookdeck fronts delivery; Postiz emits from Fly.
  - Backing services: Hookdeck+Outpost, D1, R2 (dead-letter).
  - Observability: Log every event with `job_id, social_account_id, status, request_id`; Axiom; Sentry on signature-fail.
  - Dependencies: LOOP-SOCIAL-008.
  - Related files: `src/routes/webhooks.ts`, `src/services/webhook.ts`.

- [ ] LOOP-SOCIAL-010: Local-business content calendar engine (recurring + seasonal cadence)
  - Why: Local SMBs want a "set it and forget it" calendar; a reusable cadence engine generates a month of draft posts from brand voice + site facts.
  - Acceptance criteria: `POST /api/social/:siteId/calendar/plan` produces a 30-day plan (frequency configurable) of AI drafts with suggested datetimes spaced by best-time heuristics; persists as `draft` posts; owner approves to schedule.
  - Implementation notes: Pull site services/hours/specials from site data; avoid clustering same topic.
  - Hosting notes: CF Workers; bulk scheduling still posts through Postiz one-by-one.
  - Backing services: llm.projectsites.dev, D1, Langfuse.
  - Observability: Log plan size + date range; PostHog `social_calendar_planned`.
  - Dependencies: LOOP-SOCIAL-007, LOOP-SOCIAL-008.
  - Related files: `src/services/social_calendar.ts`.

- [ ] LOOP-SOCIAL-011: Calendar-event post engine — holiday + event + observance seed packs
  - Why: Merge holiday/event/seasonal post ideas into one date-driven generator with curated seed packs (US holidays, industry observances).
  - Acceptance criteria: Static seed pack JSON of dated occasions per industry; engine matches site industry + upcoming dates; generates on-brand draft posts N days ahead; owner opt-in per occasion.
  - Implementation notes: Seed packs versioned in repo; locale-aware (needs decision on intl holiday packs beyond US).
  - Hosting notes: CF Workers; packs shipped as Worker assets.
  - Backing services: llm.projectsites.dev, D1.
  - Observability: Log matched occasions; PostHog `social_event_post_suggested`.
  - Dependencies: LOOP-SOCIAL-010.
  - Related files: `src/services/social_calendar.ts`, `assets/social/occasion-packs/*.json`.

- [ ] LOOP-SOCIAL-012: New-website-launch announcement bundle (auto-trigger on site go-live)
  - Why: When a site publishes, owners should get ready-to-post launch announcements across all connected channels — high-conversion moment.
  - Acceptance criteria: On `site.published` event, generate a launch post set (X/FB/IG/LinkedIn) with site URL + key value props; staged as drafts pending approval; flag-gated.
  - Implementation notes: Subscribe to existing site-publish event; reuse multi-variant generator.
  - Hosting notes: CF Workers event handler.
  - Backing services: llm.projectsites.dev, D1, Langfuse.
  - Observability: Log trigger with `site_id, trace_id`; PostHog `social_launch_bundle_created`.
  - Dependencies: LOOP-SOCIAL-007.
  - Related files: `src/services/social_campaigns.ts`, `src/workflows/site-generation.ts`.

- [ ] LOOP-SOCIAL-013: Review-promotion posts (Google Places review → social shareable)
  - Why: Turning fresh 5-star reviews into branded social proof drives local trust; ties social to local-SEO.
  - Acceptance criteria: Pull recent high-rated reviews via existing Google Places service; generate a quote-card post (text + suggested image template) with attribution; owner approves before schedule.
  - Implementation notes: Dedupe already-promoted reviews; never fabricate review text; respect platform UGC rules.
  - Hosting notes: CF Workers; review fetch reuses `services/google_places`.
  - Backing services: Google Places API, llm.projectsites.dev, R2 (card images).
  - Observability: Log review id + post id; PostHog `social_review_promoted`.
  - Dependencies: LOOP-SOCIAL-007, LOOP-SOCIAL-014.
  - Related files: `src/services/social_campaigns.ts`, `src/services/google_places.ts`.

- [ ] LOOP-SOCIAL-014: R2 media-library integration for social assets
  - Why: Posts need images/video; a per-site R2-backed media library is the shared asset primitive Postiz uploads pull from.
  - Acceptance criteria: `POST /api/social/:siteId/media` uploads to R2 path `social/{site_id}/{asset_id}`; returns signed URL; Postiz schedule attaches media by URL; supports image + short video; size/type validated.
  - Implementation notes: Reuse generated site imagery; Postiz fetches the public/signed URL (no double storage).
  - Hosting notes: CF Workers + R2; Postiz (Fly) downloads asset at publish time.
  - Backing services: R2, Postiz API.
  - Observability: Log upload with `asset_id, site_id, bytes, content_type`; Axiom.
  - Dependencies: LOOP-SOCIAL-008.
  - Related files: `src/routes/social.ts`, `src/services/site_serving.ts`.

- [ ] LOOP-SOCIAL-015: AI image generation for posts (Replicate/Workers AI → R2)
  - Why: Many SMBs lack imagery; on-demand branded image generation completes the AI-native post flow.
  - Acceptance criteria: `POST /api/social/:siteId/media/generate` takes a prompt (or auto-prompt from post text), generates an image, stores to R2, returns asset id; brand-color hinting; flag-gated + budget-capped.
  - Implementation notes: Route via image_generation service; cap per-site monthly quota (needs decision on quota tiers).
  - Hosting notes: CF Workers → Replicate/Workers AI; result lands in R2.
  - Backing services: Replicate or Workers AI, R2, Langfuse.
  - Observability: Langfuse trace `image.generate`; log cost + quota remaining.
  - Dependencies: LOOP-SOCIAL-014.
  - Related files: `src/services/image_generation.ts`, `src/services/social_campaigns.ts`.

- [ ] LOOP-SOCIAL-016: Campaign bundle primitive (multi-post, multi-day grouped campaigns)
  - Why: Promotions/launches are multi-post arcs; a campaign entity groups posts for unified approval, analytics, and rollback.
  - Acceptance criteria: `social_campaigns` table groups N `social_posts`; create/approve/pause/cancel a whole campaign atomically; cancel un-schedules all pending Postiz posts; analytics aggregate per campaign.
  - Implementation notes: Reuse calendar + event engines as campaign generators; idempotent cancel.
  - Hosting notes: CF Workers; cancellation calls Postiz delete per post.
  - Backing services: D1, Postiz API.
  - Observability: Log campaign lifecycle transitions with `campaign_id`; PostHog funnel.
  - Dependencies: LOOP-SOCIAL-010, LOOP-SOCIAL-011.
  - Related files: `src/services/social_campaigns.ts`, `packages/shared/src/schemas/social.ts`.

- [ ] LOOP-SOCIAL-017: Customer templates library (reusable post + campaign templates)
  - Why: Owners reuse winning post structures; a template library (system + per-site) speeds creation and standardizes brand.
  - Acceptance criteria: CRUD for templates with placeholders (`{{service}}`, `{{offer}}`); system templates seeded per industry; "apply template" fills via brand voice; templates versioned.
  - Implementation notes: Placeholder resolver validates required vars before generate.
  - Hosting notes: CF Workers + D1.
  - Backing services: D1, llm.projectsites.dev (placeholder fill).
  - Observability: Log template apply with `template_id, site_id`; PostHog `social_template_applied`.
  - Dependencies: LOOP-SOCIAL-007.
  - Related files: `src/services/social_templates.ts`.

- [ ] LOOP-SOCIAL-018: Approval workflow (draft → pending → approved → scheduled)
  - Why: Posts must not auto-publish without owner sign-off; an explicit approval state machine prevents brand mishaps.
  - Acceptance criteria: Status transitions enforced server-side; approver identity recorded; rejected posts return to draft with reason; only `approved` posts can schedule; audit-logged.
  - Implementation notes: Reuse confirm/audit services; transitions idempotent.
  - Hosting notes: CF Workers; D1 audit.
  - Backing services: D1, audit service.
  - Observability: Audit row per transition with `user_id, post_id, from, to`; PostHog `social_post_approved`.
  - Dependencies: LOOP-SOCIAL-008.
  - Related files: `src/services/social_campaigns.ts`, `src/services/audit.ts`.

- [ ] LOOP-SOCIAL-019: Agency approval mode (multi-tenant reviewer role + queue)
  - Why: Agencies managing many sites need a cross-site approval queue with a reviewer role distinct from site owner.
  - Acceptance criteria: RBAC `social_reviewer` role; `/admin/social/approvals` queue lists pending posts across an org's sites; bulk approve/reject; per-site scoping enforced; flag-gated separately from base publishing.
  - Implementation notes: Extend RBAC middleware in shared package; queue paginated + filterable by site.
  - Hosting notes: CF Workers; Angular admin UI.
  - Backing services: D1, RBAC middleware.
  - Observability: Log reviewer actions with `org_id, site_id, post_id`; PostHog.
  - Dependencies: LOOP-SOCIAL-018.
  - Related files: `packages/shared/src/middleware/rbac.ts`, `apps/project-sites/frontend admin social approvals`.

- [ ] LOOP-SOCIAL-020: Social analytics rollup → Tinybird (per-post + per-account metrics)
  - Why: Owners need reach/engagement insight; Postiz metrics fanned into Tinybird power fast dashboards and AEO/local-SEO tie-ins.
  - Acceptance criteria: Scheduled job pulls Postiz analytics, normalizes to a `social_metrics` Tinybird datasource (impressions, likes, clicks, shares per post/account/day); idempotent upsert; Worker endpoint serves chart data.
  - Implementation notes: Ingest via Tinybird Events API; key by `(site_id, social_account_id, postiz_post_id, day)`.
  - Hosting notes: CF Cron Worker → Tinybird; Postiz remains metric origin.
  - Backing services: Postiz API, Tinybird, optionally Upstash Kafka for high-volume buffering.
  - Observability: Log rows ingested + lag; Axiom; PostHog `social_analytics_synced`.
  - Dependencies: LOOP-SOCIAL-009.
  - Related files: `src/services/analytics.ts`, `src/routes/cron.ts`.

- [ ] LOOP-SOCIAL-021: CRM + Listmonk audience sync (post engagers → contacts/segments)
  - Why: Engaged social audiences are leads; syncing them into the CRM (Twenty) and Listmonk segments closes the loop to email.
  - Acceptance criteria: Where provider APIs allow, map post-level engagement signals to CRM contacts/tags + a Listmonk segment per site; respects consent; dedupes against existing contacts.
  - Implementation notes: Provider data is limited (no PII for likers on most platforms) — sync at aggregate/segment level (needs decision on what engager data is permissible).
  - Hosting notes: CF Workers; calls Twenty (crm.) + Listmonk (mail.) over HTTP.
  - Backing services: Twenty CRM, Listmonk, D1.
  - Observability: Log sync counts with `site_id, segment_id`; Axiom.
  - Dependencies: LOOP-SOCIAL-020.
  - Related files: `src/services/social_crm_sync.ts`.

- [ ] LOOP-SOCIAL-022: Rate-limit + provider-throttle handling (queue + backoff)
  - Why: Platforms throttle posting; bulk campaigns must respect per-account rate limits without losing posts.
  - Acceptance criteria: Per-`social_account_id` token-bucket in Upstash; schedule requests exceeding budget are deferred (re-queued) not failed; 429s from Postiz/providers trigger backoff + retry; surfaced as "delayed" not "error".
  - Implementation notes: Reuse DO/Upstash counter pattern; jittered backoff; cap retries then alert.
  - Hosting notes: CF Workers + Upstash; actual publish retry executes in Temporal (Postiz/Fly).
  - Backing services: Upstash Redis, Postiz API.
  - Observability: Log throttle events with `social_account_id, retry_after`; PostHog `social_rate_limited`.
  - Dependencies: LOOP-SOCIAL-008.
  - Related files: `src/services/social_ratelimit.ts`.

- [ ] LOOP-SOCIAL-023: Failure-alerting pipeline (publish-failed → owner + admin)
  - Why: A silently-failed post erodes trust; failures must alert the owner with a clear reconnect/retry action.
  - Acceptance criteria: On webhook `failed` event, classify cause (auth/expired/rate/content-rejected); send psnotify + email with cause-specific next step + deep link; admin sees aggregated failure feed; throttled to avoid spam.
  - Implementation notes: Map provider error codes to human messages; one alert per post per cause.
  - Hosting notes: CF Workers; Hookdeck retries upstream delivery.
  - Backing services: psnotify DO, Resend, D1, Hookdeck+Outpost.
  - Observability: Log alert with `post_id, social_account_id, failure_code, request_id`; Sentry (platform) on unexpected codes.
  - Dependencies: LOOP-SOCIAL-009.
  - Related files: `src/services/notifications.ts`, `src/services/webhook.ts`.

- [ ] LOOP-SOCIAL-024: Admin support tools — Postiz health, account inspector, force-resync
  - Why: Solo founder needs operator tooling to debug a site's social state without SSHing into Fly.
  - Acceptance criteria: `/admin/system-services` adds a Postiz panel showing Fly app reachability, per-site account statuses, last N publish events, and buttons to force token re-check / re-sync analytics / replay a failed webhook; all actions audit-logged + RBAC-gated.
  - Implementation notes: Reuse SERVICE_REGISTRY + DialogShell; replay reads dead-letter from R2.
  - Hosting notes: CF Workers + Angular admin; read-only health ping to social.projectsites.dev/auth.
  - Backing services: Postiz API, D1, R2 (dead-letter replay).
  - Observability: Audit every operator action with `user_id, site_id, action`; Axiom.
  - Dependencies: LOOP-SOCIAL-005, LOOP-SOCIAL-009, LOOP-SOCIAL-020.
  - Related files: `apps/project-sites/frontend admin system-services`, `src/services/postiz.ts`.

## analytics.projectsites.dev — PostHog Cloud

### Raw research themes considered

Surveyed 50+ raw ideas spanning two distinct planes: (1) our own product analytics for the platform (activation, claim-flow, billing-conversion, churn, onboarding funnels, admin dashboards) and (2) customer-visible analytics surfaced inside each generated business website's owner dashboard (per-site pageviews, traffic sources, conversion events). Anchored everything on the live constraints: PostHog Cloud US ONLY (never self-host), posthog-js is build-env-gated client embed, ingestion MUST be verified via the backend (PostHog MCP / trends) and NEVER a headless browser (bot-filter false zeros), CSP must allow `us.i.posthog.com` + `us-assets.i.posthog.com`, server-side capture flows through `lib/posthog.ts` with `ctx.waitUntil`, and high-volume OLAP rollups go to Tinybird (not ClickHouse). Discarded ideas that duplicated existing Tinybird rollup routes, required self-hosted PostHog, or put Sentry on customer client sites (platform-only error tracking). Selected the 24 that build reusable primitives first — governed event taxonomy, server-capture helper, per-site analytics view, activation scoring — then layer experiments, surveys, replay, retention, and lifecycle triggers on top. Bias toward solo-founder-practical: each task is concrete, testable against the backend, and shippable behind a feature flag.

### Selected 24 implementation tasks

- [ ] LOOP-ANALYTICS-001: Governed event taxonomy registry (`event_taxonomy.ts` + Zod)
  - Why: Ungoverned event names ("Clicked button", "click_btn", "ButtonClick") destroy every funnel and make trends unusable; a single typed registry is the foundation every other task imports.
  - Acceptance criteria: A frozen `EVENT_TAXONOMY` const enumerates every emitted event as `domain.object_action` snake_case (e.g. `claim.flow_started`, `billing.checkout_completed`); a Zod enum derives from it; `captureEvent()` rejects any name not in the registry at compile time AND runtime; a markdown table of all events auto-generates from the const.
  - Implementation notes: Single source in `apps/project-sites/src/lib/event_taxonomy.ts`; `export const EVENT_TAXONOMY = {...} as const` → `z.enum(Object.values(...))`; property schemas keyed per event so payload shape is validated too.
  - Hosting notes: Pure TS, no runtime hosting; bundles into the Worker.
  - Backing services: PostHog Cloud (consumer of names); none for the registry itself.
  - Observability: Drift detector grep in CI fails build if a raw string is passed to capture instead of a taxonomy key.
  - Dependencies: none (foundational).
  - Related files: `apps/project-sites/src/lib/event_taxonomy.ts`, `apps/project-sites/src/lib/posthog.ts`.

- [ ] LOOP-ANALYTICS-002: Hardened server-side capture helper in `lib/posthog.ts`
  - Why: Server capture is the only reliable signal (client posthog-js is ad-blocked and bot-filtered); every backend event must flow through one helper with `ctx.waitUntil` so capture never blocks the response.
  - Acceptance criteria: `captureServer(env, ctx, {distinctId, event, properties, groups})` validates `event` against the taxonomy, attaches correlation IDs (tenant_id, site_id, request_id, trace_id), POSTs to `https://us.i.posthog.com/i/v0/e/` via `ctx.waitUntil(fetch(...))`, swallows network errors without throwing, and is unit-tested with a mocked fetch.
  - Implementation notes: Read `VITE`-free server key from `POSTHOG_PROJECT_API_KEY` secret; never import posthog-node SDK (Workers compat) — raw fetch to the batch endpoint.
  - Hosting notes: CF Worker; `ctx.waitUntil` keeps the event in-flight after response returns.
  - Backing services: PostHog Cloud US ingestion.
  - Observability: Axiom structured log line `analytics.capture` with correlation IDs on every call; Sentry (platform-only) on repeated capture failures.
  - Dependencies: LOOP-ANALYTICS-001.
  - Related files: `apps/project-sites/src/lib/posthog.ts`, `apps/project-sites/src/types/env.ts`.

- [ ] LOOP-ANALYTICS-003: Correlated-identity + group-analytics conventions
  - Why: Without a consistent `distinct_id` and PostHog group keys (org, site, app), per-tenant and per-site funnels can't be cut; identity drift fragments one user into many.
  - Acceptance criteria: A documented + enforced mapping — authed users `distinct_id = user_id`, anonymous = stable anon cookie, server events set `groups: {organization: org_id, site: site_id}`; `$groupidentify` calls fire on org/site creation; a unit test asserts every `captureServer` call in routes passes a non-empty distinctId.
  - Implementation notes: Reuse existing `orgId` from `c.get('orgId')` (never client `x-org-id` per IDOR rule); group identify in org/site create handlers.
  - Hosting notes: CF Worker.
  - Backing services: PostHog Cloud (groups feature).
  - Observability: Log `featureSlug=analytics_identity` with resolved distinctId class (user|anon).
  - Dependencies: LOOP-ANALYTICS-002.
  - Related files: `apps/project-sites/src/lib/posthog.ts`, `apps/project-sites/src/services/auth`.

- [ ] LOOP-ANALYTICS-004: Backend ingestion-verification harness (PostHog MCP / trends)
  - Why: The #1 footgun — verifying analytics via a headless browser yields false-zero because posthog-js bot-filters automation; verification MUST query the backend.
  - Acceptance criteria: A `verify-ingestion.mjs` script (and an E2E helper) that, after emitting a known test event, polls the PostHog query API (or MCP `exec`) for that event within N seconds and asserts count ≥1; documentation explicitly forbids headless-browser verification; CI smoke uses this script post-deploy.
  - Implementation notes: Use PostHog MCP `mcp__posthog__exec` / HogQL `SELECT count() FROM events WHERE event = '...' AND timestamp > now() - interval 5 minute`; tag test events with a `ci_run_id` property to isolate.
  - Hosting notes: Runs in CI (Node), not in the Worker.
  - Backing services: PostHog Cloud query API / PostHog MCP.
  - Observability: Emits NDJSON result; failure surfaces in deploy gate.
  - Dependencies: LOOP-ANALYTICS-002.
  - Related files: `apps/project-sites/scripts/verify-ingestion.mjs`, `apps/project-sites/e2e/`.

- [ ] LOOP-ANALYTICS-005: Build-env-gated client posthog-js bootstrap + CSP allowlist
  - Why: Frontend autocapture (pageviews, rage clicks, web vitals) needs posthog-js, but only when the `VITE_POSTHOG_KEY` is present, and CSP must permit the PostHog hosts or every event silently fails.
  - Acceptance criteria: posthog-js initializes only when `import.meta.env.VITE_POSTHOG_KEY` is set (no-op otherwise); CSP `connect-src` + `script-src` include `us.i.posthog.com` and `us-assets.i.posthog.com`; `person_profiles: 'identified_only'` to control MAU cost; an E2E asserts the CSP header contains both hosts (header assertion, not event assertion).
  - Implementation notes: Init in admin frontend bootstrap; set `api_host` to `us.i.posthog.com`; disable `autocapture` of sensitive form fields via `mask_all_text` exemptions.
  - Hosting notes: Client bundle (admin SPA) + Worker CSP middleware.
  - Backing services: PostHog Cloud US.
  - Observability: Verify via backend trends (LOOP-ANALYTICS-004), never browser console.
  - Dependencies: LOOP-ANALYTICS-004; `security_headers` middleware.
  - Related files: `apps/project-sites/src/middleware/security_headers`, admin frontend bootstrap.

- [ ] LOOP-ANALYTICS-006: Reusable per-site analytics view primitive (owner-facing)
  - Why: Every generated customer site needs an in-dashboard analytics view (visitors, top pages, sources, conversions) scoped to ONLY that `site_id` — this is a core product deliverable and must be one reusable component, not bespoke per page.
  - Acceptance criteria: A `<app-site-analytics>` Angular component takes a `siteId`, fetches `/api/sites/:id/analytics?range=` (server-side HogQL scoped to `site_id`), renders visitors/pageviews/top-pages/sources/conversions with cyan/black tokens, loading skeletons, empty state, and error-card with request_id; data is tenant-isolated server-side (never client-filterable).
  - Implementation notes: Server route runs HogQL filtered by the group key `site_id`; cache 60s in KV; reuse `<app-rolling-counter>` for headline stats.
  - Hosting notes: CF Worker route + Angular admin component.
  - Backing services: PostHog Cloud query API (low volume) with Tinybird fallback for high-traffic sites (LOOP-ANALYTICS-018).
  - Observability: Log `analytics.site_view` with site_id, range, source(posthog|tinybird).
  - Dependencies: LOOP-ANALYTICS-002, LOOP-ANALYTICS-003.
  - Related files: `apps/project-sites/src/routes/api.ts`, admin `sites/:id/analytics` component.

- [ ] LOOP-ANALYTICS-007: Claim-flow funnel instrumentation + insight
  - Why: The claim flow (a prospect claiming their generated site) is a top conversion path; without granular events the drop-off between steps is invisible.
  - Acceptance criteria: Events `claim.flow_started`, `claim.identity_verified`, `claim.payment_started`, `claim.completed`, `claim.abandoned` fire server-side with site_id + source; a saved PostHog funnel insight (created via API/MCP) shows step conversion; backend-verified counts match emitted events.
  - Implementation notes: Emit at each claim handler boundary; abandoned = synthesized by a scheduled query, not a client event.
  - Hosting notes: CF Worker handlers.
  - Backing services: PostHog Cloud funnels.
  - Observability: Axiom log per step with correlation IDs; PostHog funnel insight saved + linked in admin.
  - Dependencies: LOOP-ANALYTICS-002, LOOP-ANALYTICS-001.
  - Related files: claim-flow service/routes, `apps/project-sites/src/lib/posthog.ts`.

- [ ] LOOP-ANALYTICS-008: Billing-conversion funnel (checkout → subscription active)
  - Why: Revenue depends on understanding where users fall out between plan-select, Stripe checkout, and active subscription; this is the money funnel.
  - Acceptance criteria: Events `billing.plan_selected`, `billing.checkout_started`, `billing.checkout_completed`, `billing.subscription_active`, `billing.checkout_failed` fire from routes + Stripe webhooks (idempotent, dedup on event id); a saved funnel + a $ value property; backend-verified.
  - Implementation notes: Webhook-sourced events use the Stripe event id as PostHog `$insert_id` for dedup; attach plan, amount, currency.
  - Hosting notes: CF Worker (webhook receiver on workers.dev to bypass Bot Fight Mode per memory).
  - Backing services: PostHog Cloud, Stripe.
  - Observability: Log `billing.event` with api_key_id, request_id, stripe_event_id.
  - Dependencies: LOOP-ANALYTICS-002; existing Stripe webhook handler.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, billing service.

- [ ] LOOP-ANALYTICS-009: Activation scoring primitive (server-computed activation score)
  - Why: A single "is this account activated?" score (created site + published + claimed + invited teammate, etc.) drives onboarding, lifecycle emails, and churn prediction; it must be a reusable computed primitive.
  - Acceptance criteria: A `computeActivationScore(orgId)` function returns 0–100 from weighted milestone events; the score is persisted (D1) + set as a PostHog person/group property via `$set`; unit-tested with milestone fixtures; surfaced in admin per-org.
  - Implementation notes: Milestones sourced from taxonomy events; weights in a config const; recompute on milestone events + nightly cron.
  - Hosting notes: CF Worker + Cron Trigger.
  - Backing services: D1 (persist), PostHog Cloud (group property).
  - Observability: Log `analytics.activation_scored` with org_id, score, milestones-hit.
  - Dependencies: LOOP-ANALYTICS-003, LOOP-ANALYTICS-001.
  - Related files: `apps/project-sites/src/services/analytics`, D1 migration for `activation_scores`.

- [ ] LOOP-ANALYTICS-010: Onboarding/activation funnel insight + admin widget
  - Why: The activation milestones need a visible funnel so the solo founder sees exactly which onboarding step leaks the most users.
  - Acceptance criteria: A saved PostHog funnel over the onboarding milestone events; an admin dashboard widget renders current step conversions + WoW delta; data backend-verified; empty/loading/error states present.
  - Implementation notes: Reuse the per-site analytics fetch pattern but org-scoped; cache 5min KV.
  - Hosting notes: CF Worker route + admin widget.
  - Backing services: PostHog Cloud funnels.
  - Observability: Log `analytics.onboarding_funnel` fetch with range.
  - Dependencies: LOOP-ANALYTICS-009, LOOP-ANALYTICS-007.
  - Related files: admin dashboard widgets, `apps/project-sites/src/services/analytics`.

- [ ] LOOP-ANALYTICS-011: Feature-flag → PostHog bridge (read PostHog flags server-side)
  - Why: The platform already has a D1 feature_flags plane; PostHog flags can complement it for percentage rollouts tied to person/group cohorts — but they must be evaluated server-side and reconciled, not duplicated. (needs decision: PostHog flags as source vs. D1-canonical with PostHog mirror — default D1-canonical.)
  - Acceptance criteria: A `getPostHogFlag(env, key, distinctId, groups)` server helper calls PostHog `/decide` (or local eval), caches in KV 60s; documented precedence: D1 killswitch overrides PostHog rollout; unit-tested with mocked decide response.
  - Implementation notes: Local evaluation payload preferred to avoid per-request `/decide` latency; never let a PostHog flag silently re-enable a D1 killswitch.
  - Hosting notes: CF Worker.
  - Backing services: PostHog Cloud feature flags.
  - Observability: Log flag decisions with key, result, source(d1|posthog).
  - Dependencies: LOOP-ANALYTICS-003; existing `feature_flags.ts`.
  - Related files: `apps/project-sites/src/services/feature_flags.ts`.

- [ ] LOOP-ANALYTICS-012: Experiment (A/B) harness for marketing homepage + claim CTA
  - Why: Conversion lift needs real experiments (hero copy, CTA wording, pricing layout) measured against a primary metric, not taste-based guessing.
  - Acceptance criteria: A `runExperiment(key, distinctId)` returns a variant from a PostHog experiment; exposure event `$feature_flag_called` fires; a saved experiment ties variant → `billing.checkout_completed` as the goal metric; results readable via backend query.
  - Implementation notes: Server-assigns variant for SSR/marketing to avoid flicker; store variant in a signed cookie for consistency.
  - Hosting notes: CF Worker (marketing SSR).
  - Backing services: PostHog Cloud experiments.
  - Observability: Log exposure with experiment key + variant.
  - Dependencies: LOOP-ANALYTICS-011, LOOP-ANALYTICS-008.
  - Related files: marketing route handlers, `apps/project-sites/src/lib/posthog.ts`.

- [ ] LOOP-ANALYTICS-013: Session replay enabled ONLY on platform admin/onboarding (privacy-gated)
  - Why: Replay is gold for debugging onboarding friction but is privacy-sensitive and bandwidth-heavy; it must be scoped to platform surfaces with strict masking — NEVER auto-enabled on customer client sites.
  - Acceptance criteria: Replay enabled on admin + onboarding routes only, behind flag `session_replay_admin`; `maskAllInputs: true`, block payment/PII selectors; sampled (e.g. 20%); a documented note that customer sites get lightweight analytics only (no replay); verify replay sessions appear via backend list.
  - Implementation notes: Configure posthog-js `session_recording` with `maskTextSelector` + blocklist; disable on any route under `sites/:id` customer preview.
  - Hosting notes: Client (admin SPA) only.
  - Backing services: PostHog Cloud session replay.
  - Observability: Log replay-enabled decision per route.
  - Dependencies: LOOP-ANALYTICS-005.
  - Related files: admin frontend posthog config, route guards.

- [ ] LOOP-ANALYTICS-014: In-product surveys primitive (NPS + targeted micro-surveys)
  - Why: Qualitative signal (NPS, "why are you cancelling?", feature-request) complements quant funnels and is cheap with PostHog surveys.
  - Acceptance criteria: PostHog surveys gated by feature flag + cohort (e.g. NPS after activation, cancel-reason on billing.cancel intent); responses queryable via backend; a `<app-survey-host>` respects display rules + suppresses on customer client sites.
  - Implementation notes: Use PostHog survey targeting via flags so display logic stays server-governed; throttle to one survey per user per 30d.
  - Hosting notes: Client (admin) + PostHog survey config.
  - Backing services: PostHog Cloud surveys.
  - Observability: Log survey shown/answered with survey_id.
  - Dependencies: LOOP-ANALYTICS-011, LOOP-ANALYTICS-009.
  - Related files: admin survey host component, PostHog survey definitions.

- [ ] LOOP-ANALYTICS-015: Retention + lifecycle (new/returning/resurrected/dormant) insight
  - Why: Retention curves and lifecycle breakdown tell the solo founder whether the product has real stickiness — the single most important growth signal.
  - Acceptance criteria: Saved PostHog retention insight on a core action (e.g. `site.edited`) + a lifecycle insight; an admin widget renders the retention grid; backend-verified counts; range selector.
  - Implementation notes: Pick the activation-correlated "aha" action as the retention anchor; document the choice.
  - Hosting notes: CF Worker route + admin widget.
  - Backing services: PostHog Cloud (retention/lifecycle).
  - Observability: Log retention fetch.
  - Dependencies: LOOP-ANALYTICS-006, LOOP-ANALYTICS-009.
  - Related files: admin dashboard widgets.

- [ ] LOOP-ANALYTICS-016: Churn-prediction signal (declining activation + dormancy → risk score)
  - Why: Predicting churn lets lifecycle triggers (LOOP-ANALYTICS-017) intervene before a cancel; a simple, explainable risk score beats nothing.
  - Acceptance criteria: A nightly cron computes `churn_risk` (0–100) per org from dormancy (days since last `site.edited`), activation-score trend, and billing signals; persisted in D1 + set as group property; explainable (top 3 contributing factors stored); unit-tested.
  - Implementation notes: Rules-based first (transparent), not ML; (needs decision: graduate to a model later via Langfuse-traced LLM scoring — defer).
  - Hosting notes: CF Worker Cron Trigger.
  - Backing services: D1, PostHog Cloud (group property), Tinybird (dormancy aggregate input).
  - Observability: Log `analytics.churn_scored` with org_id, score, factors.
  - Dependencies: LOOP-ANALYTICS-009, LOOP-ANALYTICS-018.
  - Related files: `apps/project-sites/src/services/analytics`, D1 migration `churn_scores`.

- [ ] LOOP-ANALYTICS-017: Lifecycle trigger engine (analytics events → actions)
  - Why: Analytics is only valuable when it drives action — dormant user → re-engagement email, high churn risk → save offer, activation milestone → celebration; this engine wires signals to outcomes.
  - Acceptance criteria: A rules table maps (cohort/risk/milestone) → action (Resend email via existing email plane, in-app notification via psnotify, or Hookdeck/Outpost webhook); triggers are idempotent (one fire per user per rule per window); dry-run mode; unit-tested with fixture cohorts.
  - Implementation notes: Consume PostHog cohorts via webhook (PostHog action → Hookdeck → Worker) OR nightly cron over D1 scores; dedup in D1 `lifecycle_fires`.
  - Hosting notes: CF Worker + Cron + Hookdeck+Outpost for inbound PostHog webhooks.
  - Backing services: PostHog Cloud (cohorts/actions), Resend, psnotify, Hookdeck+Outpost.
  - Observability: Log `lifecycle.fired` with rule, user, action, dedup_key.
  - Dependencies: LOOP-ANALYTICS-016, LOOP-ANALYTICS-009.
  - Related files: `apps/project-sites/src/services/analytics`, `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-ANALYTICS-018: Tinybird high-volume rollup for customer-site pageviews
  - Why: Querying PostHog per-pageview for high-traffic customer sites is slow + costly; OLAP rollups belong in Tinybird (decision: Tinybird, not ClickHouse), feeding the per-site view's heavy queries.
  - Acceptance criteria: A Tinybird datasource ingests site pageview events (via the existing capture path or a Pipe from PostHog export), endpoints `events_by_tenant_daily` / per-site top-pages; the per-site analytics view (LOOP-ANALYTICS-006) routes high-traffic sites to Tinybird, low-traffic to PostHog; results reconcile within tolerance.
  - Implementation notes: Reuse existing Tinybird endpoints (`mcp__tinybird__events_by_tenant_daily`, `site_publishes_by_source`); dual-write or batch-export ingest (needs decision: dual-write vs. PostHog batch-export → Tinybird — default dual-write for freshness).
  - Hosting notes: CF Worker capture → Tinybird Events API; Tinybird hosts the OLAP.
  - Backing services: Tinybird, PostHog Cloud (low-volume path).
  - Observability: Log source-selection (posthog|tinybird) + query latency.
  - Dependencies: LOOP-ANALYTICS-006, LOOP-ANALYTICS-002.
  - Related files: Tinybird datasources/pipes, per-site analytics route.

- [ ] LOOP-ANALYTICS-019: App-install + app-usage analytics (marketplace apps per site)
  - Why: The platform offers installable apps/integrations per site; install funnel + usage tells which apps drive retention and which are dead weight.
  - Acceptance criteria: Events `app.viewed`, `app.install_started`, `app.installed`, `app.uninstalled`, `app.used` fire with app_id + site_id; a saved insight ranks apps by install→active conversion; backend-verified.
  - Implementation notes: app_id added to correlation context; usage event throttled (last_used_at debounce per memory pattern).
  - Hosting notes: CF Worker app handlers.
  - Backing services: PostHog Cloud.
  - Observability: Log app lifecycle events with app_id.
  - Dependencies: LOOP-ANALYTICS-002, LOOP-ANALYTICS-001.
  - Related files: app/marketplace service + routes.

- [ ] LOOP-ANALYTICS-020: Abuse + bot analytics signal (spam claims, fraud, scrapers)
  - Why: Generous-free + public claim flow invites abuse; analytics must distinguish real activation from bot/fraud so funnels aren't poisoned and abuse is actionable.
  - Acceptance criteria: Events tag suspected abuse (`abuse.suspected_signup`, `abuse.rate_limited`, `abuse.turnstile_failed`) with reason; a dashboard surfaces abuse rate by source; real-user funnels exclude flagged distinct_ids via a cohort; verified via backend.
  - Implementation notes: Source signals from Turnstile failures, DO rate-limiter (per memory: DO counter is the enforcement), and velocity heuristics; exclude bot cohort from activation/billing funnels.
  - Hosting notes: CF Worker + Durable Object rate-limiter.
  - Backing services: PostHog Cloud (cohorts), Turnstile, DO.
  - Observability: Log `abuse.signal` with reason, source, ip-hash (no raw PII).
  - Dependencies: LOOP-ANALYTICS-007, LOOP-ANALYTICS-003.
  - Related files: rate-limit DO, claim-flow handlers, `apps/project-sites/src/lib/posthog.ts`.

- [ ] LOOP-ANALYTICS-021: Privacy controls + per-site consent + opt-out + DNT
  - Why: Customer-visible site analytics must respect end-visitor privacy (consent banner config, Do-Not-Track, opt-out, IP anonymization) or the platform exposes its customers to GDPR/CCPA risk.
  - Acceptance criteria: Per-site analytics config (in site settings) toggles tracking, honors DNT, anonymizes IP, and a consent-mode that holds events until consent; a documented data-retention default; opt-out persists; unit-tested gating logic.
  - Implementation notes: Server-side capture checks the site's consent config before emitting visitor events; PostHog `opt_out_capturing` on client; configurable per site_id.
  - Hosting notes: CF Worker capture + site settings UI.
  - Backing services: PostHog Cloud (with anonymization).
  - Observability: Log consent-gated suppression count per site.
  - Dependencies: LOOP-ANALYTICS-006, LOOP-ANALYTICS-002.
  - Related files: site settings component, capture helper, `apps/project-sites/src/services/site_serving`.

- [ ] LOOP-ANALYTICS-022: Data-governance — PII scrubbing, redaction, retention policy
  - Why: Events must never carry secrets/PII (emails, tokens, card data); a governance layer enforces redaction at the boundary, matching the structured-logging redaction discipline.
  - Acceptance criteria: A `scrubProperties()` runs inside `captureServer` removing/hashing known-PII keys (email, phone, token, address) per an allowlist of safe properties; a CI test feeds a PII-laden payload and asserts it's scrubbed; documented retention windows per event class.
  - Implementation criteria/notes: Reuse `packages/shared/src/utils/redact`; allowlist over denylist for property keys; hash distinct_id-adjacent PII.
  - Hosting notes: CF Worker (in the capture path).
  - Backing services: PostHog Cloud (recipient of scrubbed data).
  - Observability: Log redaction count per capture (metric, not the values).
  - Dependencies: LOOP-ANALYTICS-002.
  - Related files: `packages/shared/src/utils/redact`, `apps/project-sites/src/lib/posthog.ts`.

- [ ] LOOP-ANALYTICS-023: Platform admin analytics cockpit (cross-cutting dashboard)
  - Why: The solo founder needs one black/cyan cockpit page aggregating the key insights (activation funnel, MRR funnel, retention, churn risk, abuse rate, top sites) instead of clicking through PostHog.
  - Acceptance criteria: An `/admin/analytics` route composes existing widgets (LOOP-ANALYTICS-010/015/016/020) + headline rolling-counters; range + tenant filter; visibility-aware polling (pauses on `document.hidden` per memory); loading/empty/error states; authed E2E via E2E_API_KEY.
  - Implementation notes: Reuse `AdminStateService` polling pattern; cyan/black `_polish.scss` tokens; no hard-coded brand colors.
  - Hosting notes: CF Worker route + Angular admin component.
  - Backing services: PostHog Cloud + Tinybird (via existing widget fetches).
  - Observability: Log cockpit load + which panels rendered.
  - Dependencies: LOOP-ANALYTICS-010, 015, 016, 020.
  - Related files: admin `analytics` section component, dashboard widgets.

- [ ] LOOP-ANALYTICS-024: Analytics drift + dead-event detector (CI gate)
  - Why: Over time events get renamed, orphaned, or fired without correlation tags; a CI detector keeps the taxonomy honest and prevents the funnel-rot that creeps into every analytics system.
  - Acceptance criteria: A `detect-analytics-drift.mjs` greps the codebase for: (a) capture calls bypassing `captureServer`/taxonomy, (b) taxonomy events with zero call sites (dead), (c) capture calls missing required correlation tags, (d) any client capture missing the env gate; fails CI on HIGH-confidence findings only (false-negative bias per validator-precision rule).
  - Implementation notes: Use `/usr/bin/grep` (not flaky ugrep per memory); confidence tiers; `// analytics-ignore: <kind>` escape hatch.
  - Hosting notes: CI (Node), not the Worker.
  - Backing services: none (static analysis); optionally cross-checks PostHog event list via MCP for events with zero ingestion in 30d.
  - Observability: Emits NDJSON report; surfaces dead events to prune.
  - Dependencies: LOOP-ANALYTICS-001, LOOP-ANALYTICS-002.
  - Related files: `apps/project-sites/scripts/detect-analytics-drift.mjs`, CI workflow.

## logs.projectsites.dev — Axiom

### Raw research themes considered

Surveyed ~55 raw themes across the platform-wide logging plane: a shared structured-logger primitive with an enforced correlation-id schema, OTLP export from Workers Tracing → Axiom, per-tenant/site/app log views, build-pipeline + container + webhook + LLM-call logs, audit-log mirroring, log-based alerting + anomaly detection, retention tiers, PII redaction at ingest, ruthless cost controls, an in-/admin log search UI, error-rate + SLO dashboards, trace correlation, sampling, dead-letter visibility, lightweight customer-visible logs, and security-event logs. The flagship is one reusable `structuredLogger` that stamps every line with the mandatory correlation set (tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id, feature_slug) and ships to Axiom over a single batched HTTP path. Decisions baked in: Axiom is THE log backend (no self-hosted Loki/ELK); glue on CF Workers; collector sidecars on CF Containers (Fly only if stateful/24-7); Sentry is PLATFORM-ONLY (never customer client sites); high-volume rollups go to Tinybird (never ClickHouse); AI traces to Langfuse; analytics to PostHog Cloud; webhooks via Hookdeck+Outpost. Cut themes that duplicated existing event_bus/Tinybird work or that re-implemented Sentry; kept the 24 that are concrete, programmable, and reusable while staying solo-founder practical and cost-disciplined.

### Selected 24 implementation tasks

- [ ] LOOP-LOGS-001: Shared `structuredLogger` primitive with enforced correlation-id schema (flagship)
  - Why: Every subsystem must emit identically-shaped structured logs; without one enforced primitive, correlation drifts and Axiom queries break.
  - Acceptance criteria: `createLogger(ctx)` returns `{debug,info,warn,error}`; each line is Zod-validated against `LogLineSchema` requiring `service, env, level, ts, msg`; correlation fields `tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id, feature_slug` are auto-merged from a typed `LogContext`; missing-required-correlation in non-dev throws at build/test time; emits to Axiom batch buffer, never `console.log`.
  - Implementation notes: `src/services/logging/logger.ts` + `schemas.ts`; child-logger pattern (`logger.child({site_id})`); flush via `ctx.waitUntil` with safeWaitUntil wrapper; `import.meta.vitest` colocated tests.
  - Hosting notes: Pure CF Worker code, no container.
  - Backing services: Axiom (HTTP ingest); KV for sampling config snapshot.
  - Observability: Self-meters dropped-line count + flush latency to its own `_meta` dataset.
  - Dependencies: none (foundation).
  - Related files: `src/services/logging/logger.ts`, `schemas.ts`, `__tests__/logger.test.ts`.

- [ ] LOOP-LOGS-002: Axiom ingest transport with batching, retry + dead-letter to R2
  - Why: Per-line HTTP to Axiom is cost- and latency-prohibitive; batched ingest with backpressure is mandatory.
  - Acceptance criteria: Buffers up to N lines / T ms then POSTs to Axiom `/v1/datasets/{ds}/ingest`; retries 5xx with jitter; on terminal failure writes NDJSON batch to R2 `log-dead-letter/{ds}/{ts}.ndjson`; never blocks the request path; respects `AXIOM_TOKEN` + `AXIOM_ORG_ID` secrets.
  - Implementation notes: `src/services/logging/axiom_transport.ts`; gzip body; idempotent batch ids; circuit-breaker opens after K consecutive failures.
  - Hosting notes: CF Worker; flush in `waitUntil`.
  - Backing services: Axiom, R2 (dead-letter).
  - Observability: Counter of batches sent/failed/dead-lettered exposed on `/api/logs/health`.
  - Dependencies: LOOP-LOGS-001.
  - Related files: `src/services/logging/axiom_transport.ts`.

- [ ] LOOP-LOGS-003: Workers Tracing → OTLP → Axiom exporter wiring
  - Why: Brian directive — CF Workers Tracing emits OTLP; route spans to Axiom for trace correlation.
  - Acceptance criteria: `@opentelemetry/exporter-trace-otlp-http` configured to Axiom OTLP endpoint with dataset header; root span per request carries `trace_id` that matches log-line `trace_id`; sampled per LOOP-LOGS-018; verified by a live trace appearing in Axiom with linked logs.
  - Implementation notes: `src/services/logging/otel.ts`; init in `index.ts` middleware; resource attrs `service.name=project-sites`, `deployment.environment`.
  - Hosting notes: CF Worker (Tracing beta binding).
  - Backing services: Axiom (OTLP traces dataset).
  - Observability: Span export error count logged via LOOP-LOGS-001.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-002.
  - Related files: `src/services/logging/otel.ts`, `index.ts`.

- [ ] LOOP-LOGS-004: Request-scoped log context middleware (correlation propagation)
  - Why: Correlation ids must be populated once per request and propagated to every downstream log/trace automatically.
  - Acceptance criteria: Hono middleware seeds `LogContext` from `request_id` (existing request_id middleware), resolved `tenant_id`/`site_id` from host + auth, `trace_id` from OTEL, stores logger on `c.set('logger', ...)`; all route handlers use `c.get('logger')`; missing context defaults are explicit not silent.
  - Implementation notes: `src/middleware/log_context.ts`; integrate with existing `request_id` + `auth` middleware ordering.
  - Hosting notes: CF Worker.
  - Backing services: none.
  - Observability: Emits one `request.completed` line with `durationMs`, `status`.
  - Dependencies: LOOP-LOGS-001.
  - Related files: `src/middleware/log_context.ts`, `src/middleware/request_id.ts`.

- [ ] LOOP-LOGS-005: PII redaction at ingest
  - Why: Logs must never persist secrets/PII to Axiom; redaction at the boundary is mandatory and cheaper than post-hoc scrubbing.
  - Acceptance criteria: Pre-ingest pass redacts emails, bearer tokens, API keys (`psk_*`,`sk_*`), Authorization headers, cookies, credit-card-shaped strings; key-name denylist (`password`,`secret`,`token`,`authorization`); redacts to `«redacted:type»`; unit-tested against fixture corpus; reuses `packages/shared/utils/redact`.
  - Implementation notes: `src/services/logging/redact.ts` wrapping shared redact; applied inside transport before batching.
  - Hosting notes: CF Worker.
  - Backing services: none.
  - Observability: Counter of redactions per line type to `_meta`.
  - Dependencies: LOOP-LOGS-002.
  - Related files: `src/services/logging/redact.ts`, `packages/shared/src/utils/redact.ts`.

- [ ] LOOP-LOGS-006: Axiom dataset taxonomy + provisioning script
  - Why: Cost + query speed depend on a deliberate dataset split (app, traces, build, container, webhook, llm, audit, security, customer).
  - Acceptance criteria: `scripts/provision-axiom-datasets.mjs` idempotently creates datasets with documented retention per LOOP-LOGS-014; dataset names + retention in `docs/LOGGING.md` table; script uses `AXIOM_TOKEN`; re-run is no-op.
  - Implementation notes: One canonical `DATASETS` const reused by logger routing; (needs decision) exact dataset count vs. single dataset + `kind` field for cost — default to ~9 datasets.
  - Hosting notes: Node script, run locally / CI.
  - Backing services: Axiom API.
  - Observability: Script prints created/skipped per dataset.
  - Dependencies: LOOP-LOGS-001.
  - Related files: `scripts/provision-axiom-datasets.mjs`, `docs/LOGGING.md`.

- [ ] LOOP-LOGS-007: Build-pipeline (site-generation Workflow) structured logs
  - Why: AI site generation is the core product flow; its steps must be fully traceable with `site_id`/`job_id`.
  - Acceptance criteria: Each `workflows/site-generation.ts` step emits start/finish/error lines with `job_id`, `site_id`, step name, `durationMs`, model + token counts where relevant; failures carry taxonomy code; logs queryable by `job_id` end-to-end.
  - Implementation notes: Inject logger child into workflow step wrapper; reuse LOOP-LOGS-001.
  - Hosting notes: CF Workflow.
  - Backing services: Axiom (`build` dataset).
  - Observability: Feeds LOOP-LOGS-016 build-error dashboard.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-004.
  - Related files: `src/workflows/site-generation.ts`, `src/services/logging/logger.ts`.

- [ ] LOOP-LOGS-008: Container log shipping (CF Containers → Axiom)
  - Why: Platform runs many CF Container DOs (Twenty, Plane, Listmonk, Unkey, voice, etc.) whose stdout/stderr must reach Axiom, not vanish.
  - Acceptance criteria: A lightweight log-forwarder reads container stdout/stderr (Containers logs API or sidecar tail) and POSTs structured lines to Axiom `container` dataset tagged with `app_id`, container name, region; verified for ≥2 live containers.
  - Implementation notes: Prefer a CF Worker pull of Containers logs over a per-container agent; (needs decision) Containers log API coverage vs. sidecar tail — sidecar on CF Container only if pull API insufficient; Fly only if a 24-7 stateful collector is unavoidable (state why in PR).
  - Hosting notes: CF Worker (forwarder); CF Container sidecar fallback.
  - Backing services: Axiom (`container` dataset), CF Containers.
  - Observability: Per-container lines/min gauge.
  - Dependencies: LOOP-LOGS-002, LOOP-LOGS-006.
  - Related files: `src/services/logging/container_forwarder.ts`.

- [ ] LOOP-LOGS-009: Webhook delivery logs (inbound + outbound, Hookdeck/Outpost correlated)
  - Why: Webhook failures are a top support class; every delivery attempt needs visibility with idempotency + status.
  - Acceptance criteria: Every inbound webhook (Stripe, SNS, etc.) and outbound delivery logs attempt with `request_id`, provider, event type, signature-valid bool, status, attempt#, Hookdeck/Outpost delivery id; dead-letters visible (LOOP-LOGS-021); queryable by event id.
  - Implementation notes: Hook into `routes/webhooks.ts` + outbound webhook service; reuse correlation middleware.
  - Hosting notes: CF Worker.
  - Backing services: Axiom (`webhook` dataset), Hookdeck+Outpost.
  - Observability: Webhook success-rate panel in dashboard.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-004.
  - Related files: `src/routes/webhooks.ts`, `src/services/webhook.ts`.

- [ ] LOOP-LOGS-010: LLM call logs (Axiom mirror) + Langfuse trace linkage
  - Why: LLM spend + quality must be observable; Axiom holds operational call logs while Langfuse holds AI traces — they must share ids.
  - Acceptance criteria: Every external/Workers-AI LLM call logs model, provider, prompt-template version, token in/out, cost estimate, latency, `trace_id`, and Langfuse trace id; no prompt/response bodies in Axiom (PII) — only metadata + Langfuse pointer.
  - Implementation notes: Wrap `services/external_llm.ts` + `ai_workflows.ts`; reuse prompt registry version field.
  - Hosting notes: CF Worker.
  - Backing services: Axiom (`llm` dataset), Langfuse, AI Gateway.
  - Observability: Cost-per-feature rollup to Tinybird (LOOP-LOGS-022).
  - Dependencies: LOOP-LOGS-001.
  - Related files: `src/services/external_llm.ts`, `src/services/ai_workflows.ts`, `src/prompts/registry.ts`.

- [ ] LOOP-LOGS-011: Audit-log mirror to Axiom
  - Why: D1 audit log is system-of-record but needs a queryable, long-window mirror for investigations without taxing D1.
  - Acceptance criteria: Every `services/audit.ts` write also emits an immutable structured line to Axiom `audit` dataset with actor, action, resource, `tenant_id`, before/after diff hash; mirror failure never blocks the D1 write; reconciliation test confirms parity.
  - Implementation notes: Tee inside audit service; append-only; no redaction bypass.
  - Hosting notes: CF Worker.
  - Backing services: Axiom (`audit` dataset), D1.
  - Observability: Daily count parity check D1 vs Axiom.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-005.
  - Related files: `src/services/audit.ts`.

- [ ] LOOP-LOGS-012: Security-event logs
  - Why: Auth failures, RBAC denials, rate-limit trips, WAF/Turnstile rejections, IDOR attempts need a dedicated security stream.
  - Acceptance criteria: Dedicated `security` dataset receives lines for failed logins, RBAC 403→404 events, rate-limit blocks, suspicious `x-org-id` mismatches, Turnstile failures; each tagged `tenant_id`, ip-hash, `api_key_id`; feeds anomaly detection (LOOP-LOGS-020).
  - Implementation notes: Emit from auth/RBAC/rate-limit middleware; ip stored hashed (PII).
  - Hosting notes: CF Worker.
  - Backing services: Axiom (`security` dataset).
  - Observability: Security panel + alert rule.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-005.
  - Related files: `src/middleware/auth.ts`, `packages/shared/src/middleware/`.

- [ ] LOOP-LOGS-013: Axiom query service (typed APL client) for /admin
  - Why: The admin log UI and dashboards need one typed, cached, server-side query path — never client-direct to Axiom.
  - Acceptance criteria: `services/logging/axiom_query.ts` runs APL queries via Axiom API with Zod-validated params + results; enforces tenant scoping (operator can see all, tenant-scoped callers filtered by `tenant_id`); 30-60s KV cache for dashboard queries; rate-limited.
  - Implementation notes: Server-side `AXIOM_QUERY_TOKEN`; reject unbounded time ranges; parametrized APL templates.
  - Hosting notes: CF Worker.
  - Backing services: Axiom Query API, KV (cache).
  - Observability: Query latency + cache-hit logged.
  - Dependencies: LOOP-LOGS-006.
  - Related files: `src/services/logging/axiom_query.ts`.

- [ ] LOOP-LOGS-014: Retention tiers + cost-control policy
  - Why: Solo-founder budget — logs must auto-expire by tier; high-volume noise must not balloon Axiom cost.
  - Acceptance criteria: Datasets assigned tiers (security/audit long, build/llm medium, app/container short, debug shortest) documented + applied via provisioning script; ingest-side debug-line dropping when `LOG_LEVEL` raised; monthly cost estimate surfaced in /admin.
  - Implementation notes: Tier table in `docs/LOGGING.md`; (needs decision) exact day counts pending Axiom plan limits.
  - Hosting notes: Config in code + Axiom dataset settings.
  - Backing services: Axiom.
  - Observability: Cost-control panel.
  - Dependencies: LOOP-LOGS-006.
  - Related files: `scripts/provision-axiom-datasets.mjs`, `docs/LOGGING.md`.

- [ ] LOOP-LOGS-015: /admin log search UI (operator + per-tenant/site/app filters)
  - Why: A first-class search surface is the daily driver for debugging; must support correlation pivots.
  - Acceptance criteria: `/admin/logs` Angular section (cyan/black, DialogShell where modal) with dataset selector, time range, full-text + structured filters, and one-click pivot by `trace_id`/`request_id`/`site_id`/`tenant_id`; results paginated; behind feature flag `logs_search`; Karma + authed Playwright E2E.
  - Implementation notes: Frontend calls LOOP-LOGS-013 only; reuse admin section-add recipe; no raw HttpClient (use ApiService).
  - Hosting notes: Angular frontend (R2) + Worker API.
  - Backing services: Axiom (via query service).
  - Observability: UI emits `logs.search.run` with filter shape.
  - Dependencies: LOOP-LOGS-013.
  - Related files: `frontend .../admin/sections/logs/`, `src/routes/api.ts`.

- [ ] LOOP-LOGS-016: Error-rate dashboards (per-tenant / per-site / per-app)
  - Why: Operators need at-a-glance error trends segmented by the correlation dimensions.
  - Acceptance criteria: `/admin/logs/dashboards` renders error-rate, p50/p95 latency, and throughput sparklines grouped by `tenant_id`/`site_id`/`app_id` over selectable windows; sourced from cached Axiom aggregates; flag-gated.
  - Implementation notes: Reuse `<app-rolling-counter>` + cinematic reveal; aggregates via APL templates.
  - Hosting notes: Angular + Worker.
  - Backing services: Axiom.
  - Observability: Dashboard render time logged.
  - Dependencies: LOOP-LOGS-013, LOOP-LOGS-015.
  - Related files: `frontend .../admin/sections/logs/dashboards/`.

- [ ] LOOP-LOGS-017: SLO tracking + error-budget burn
  - Why: Turn raw logs into SLO signal (availability + latency) with budget burn-rate alerts.
  - Acceptance criteria: Define SLOs (e.g. site-serving availability 99.9%, p95 < X ms) in a typed `slo.config.ts`; a scheduled job computes burn rate from Axiom and stores results; fast/slow burn thresholds trigger LOOP-LOGS-019 alerts; /admin shows budget remaining.
  - Implementation notes: Cron Trigger → APL aggregate → D1/KV snapshot; multi-window multi-burn-rate algorithm.
  - Hosting notes: CF Worker Cron.
  - Backing services: Axiom, KV/D1.
  - Observability: SLO panel in dashboard.
  - Dependencies: LOOP-LOGS-013.
  - Related files: `src/services/logging/slo.ts`, `slo.config.ts`.

- [ ] LOOP-LOGS-018: Log + trace sampling controls
  - Why: Full-fidelity logging at scale is unaffordable; sampling must be tunable without redeploy and consistent across logs+traces.
  - Acceptance criteria: KV-backed sampling config (`{dataset: rate}`, tail-sample errors at 100%) read by logger + OTEL exporter; head-sampling for high-volume info, always-keep for warn/error; config editable in /admin; head-sample decision shared via `trace_id` so logs+spans stay coherent.
  - Implementation notes: 60s KV cache + invalidation on admin write (mind the flag-cache stale bug pattern).
  - Hosting notes: CF Worker, KV.
  - Backing services: KV, Axiom.
  - Observability: Effective sample rate emitted to `_meta`.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-003.
  - Related files: `src/services/logging/sampling.ts`.

- [ ] LOOP-LOGS-019: Log-based alerting (Axiom monitors → psnotify + Resend)
  - Why: Logs are useless without proactive alerts; alerts must flow to the platform's own notification plane.
  - Acceptance criteria: APL-based alert rules (error spike, build-failure burst, webhook delivery drop, SLO burn) defined as code and provisioned to Axiom monitors; alert webhooks land on a WAF-skipped workers.dev receiver that fans out to `psnotify` inbox + Resend email; each alert carries AI summary + runbook link + correlation pivot.
  - Implementation notes: Receiver verifies Axiom signature; dedupe via D1 idempotency; reuse psnotify (NO Novu).
  - Hosting notes: CF Worker (workers.dev receiver to dodge Bot Fight Mode).
  - Backing services: Axiom monitors, psnotify, Resend.
  - Observability: Alert fired/suppressed counter.
  - Dependencies: LOOP-LOGS-013, LOOP-LOGS-006.
  - Related files: `src/routes/webhooks.ts` (axiom receiver), `scripts/provision-axiom-monitors.mjs`.

- [ ] LOOP-LOGS-020: Anomaly detection on log streams
  - Why: Threshold alerts miss novel failures; baseline-deviation detection catches the unknown-unknowns cheaply.
  - Acceptance criteria: Scheduled job computes per-dataset baselines (rolling mean/stddev of error rate, new-error-fingerprint appearance, latency drift) and flags z-score outliers; surfaces "new anomaly" cards in /admin and feeds LOOP-LOGS-019; tuned to keep false-positive rate low (validator-precision discipline).
  - Implementation notes: APL summarize over windows; (needs decision) statistical job vs. Axiom-native anomaly features — default to in-Worker stats.
  - Hosting notes: CF Worker Cron.
  - Backing services: Axiom, KV (baselines).
  - Observability: Anomaly count + FP-feedback loop.
  - Dependencies: LOOP-LOGS-012, LOOP-LOGS-013.
  - Related files: `src/services/logging/anomaly.ts`.

- [ ] LOOP-LOGS-021: Dead-letter visibility surface
  - Why: Dropped log batches (LOOP-LOGS-002) and webhook dead-letters must be visible and replayable, not silently lost.
  - Acceptance criteria: `/admin/logs/dead-letter` lists R2 dead-letter batches + webhook DLQ with size, reason, age; one-click replay re-ingests to Axiom / re-delivers webhook; replay is idempotent; empty state is reassuring not alarming.
  - Implementation notes: Reads R2 `log-dead-letter/*` + Outpost/Upstash DLQ; replay guarded by operator role.
  - Hosting notes: Angular + Worker.
  - Backing services: R2, Axiom, Hookdeck/Outpost DLQ.
  - Observability: Replay attempts logged.
  - Dependencies: LOOP-LOGS-002, LOOP-LOGS-009.
  - Related files: `frontend .../admin/sections/logs/dead-letter/`, `src/services/logging/dead_letter.ts`.

- [ ] LOOP-LOGS-022: High-volume log rollups → Tinybird (never ClickHouse)
  - Why: Long-term aggregate analytics (volume by tenant, cost by feature, error trends) belong in Tinybird OLAP, not repeated full Axiom scans.
  - Acceptance criteria: A periodic exporter pushes pre-aggregated log metrics to a `projectsites_logs` Tinybird datasource via the existing event_bus pattern; Tinybird endpoints power monthly cost + volume reports; raw lines stay in Axiom, rollups in Tinybird.
  - Implementation notes: Reuse `services/tinybird.ts`; aggregate in Worker before send; explicitly NOT ClickHouse.
  - Hosting notes: CF Worker Cron.
  - Backing services: Tinybird, Axiom.
  - Observability: Rollup row counts logged.
  - Dependencies: LOOP-LOGS-013.
  - Related files: `src/services/tinybird.ts`, `src/services/logging/rollups.ts`.

- [ ] LOOP-LOGS-023: Customer-visible lightweight logs (per-site activity feed)
  - Why: Site owners want a simple "what happened to my site" feed without Sentry-grade detail and never any platform PII.
  - Acceptance criteria: A reduced, scoped view exposes per-site events (published, deploy ok/fail, form submission, webhook received) filtered to the caller's `site_id`/`tenant_id`; no stack traces, no other tenants, no secrets; behind flag `customer_site_logs`; explicitly no Sentry on customer client sites.
  - Implementation criteria/notes: Curated event allowlist; served via LOOP-LOGS-013 with mandatory tenant filter; friendly human copy (Flesch ≥ 50).
  - Hosting notes: Angular (owner UI) + Worker.
  - Backing services: Axiom (filtered query).
  - Observability: Feed view events to PostHog.
  - Dependencies: LOOP-LOGS-013, LOOP-LOGS-004.
  - Related files: `frontend .../owner/site-activity/`, `src/services/logging/customer_feed.ts`.

- [ ] LOOP-LOGS-024: Logging conformance gate (CI drift detector)
  - Why: Logging standards rot without enforcement — bare `console.log`, missing correlation, raw `fetch` to Axiom, un-redacted bodies must fail CI.
  - Acceptance criteria: `bin/validate-logging.mjs` greps for `console.log`, direct Axiom URLs outside the transport, log calls missing `c.get('logger')` in route handlers, and PII-shaped literals in log args; emits findings with HIGH/MEDIUM/LOW confidence; wired into lefthook + a GitHub Action; exit 1 on HIGH.
  - Implementation notes: Portable-audit + validator-precision discipline (scope regex, accept quote variants, suppression comment escape hatch); fixtures under `bin/__fixtures__/logging/`.
  - Hosting notes: Node script, CI + pre-commit.
  - Backing services: none.
  - Observability: CI annotation per finding.
  - Dependencies: LOOP-LOGS-001, LOOP-LOGS-005.
  - Related files: `bin/validate-logging.mjs`, `.github/workflows/logging-conformance.yml`.

## traces.projectsites.dev — Sentry + Langfuse + Promptfoo

### Raw research themes considered

Surveyed ~50 themes across four pillars: (1) platform error tracking + full-stack distributed tracing with Sentry — and the hard line that **Sentry is PLATFORM/admin/internal ONLY and must NEVER be injected into generated customer sites** (those get lightweight PostHog Cloud only); (2) LLM observability via **Langfuse** (traces, prompt versioning, scores, datasets, evaluators) routed from the `llm.projectsites.dev` gateway, where we **prefer Langfuse Cloud over self-host because self-hosted Langfuse requires ClickHouse internally and our doctrine forbids standing up ClickHouse** (Tinybird is the only OLAP — if self-host is ever forced, it runs on CF Workers Containers and the ClickHouse dependency must be flagged `(needs decision)`); (3) **Promptfoo** as a CI regression gate for golden prompts, model-comparison evals, and hallucination/quality scoring; (4) cross-cutting correlation — every trace, log, error, eval, and AI call carries `tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id, prompt_version, model` so Sentry ↔ Axiom (logs) ↔ Tinybird (OLAP) ↔ PostHog ↔ Langfuse all join on shared IDs. Discarded themes (RUM on client sites, Sentry session replay on customer pages, ClickHouse-backed self-host analytics, duplicate per-vendor SDKs) were cut for violating the Sentry-internal-only or no-ClickHouse rules. The selected 24 favor reusable primitives — a trace-context propagation helper, a unified correlation-ID envelope, and a Promptfoo CI gate — over one-off integrations.

### Selected 24 implementation tasks

- [ ] LOOP-TRACES-001: Trace-context propagation primitive (`@projectsites/trace-context`)
  - Why: Every subsystem (worker routes, workflows, container builds, LLM gateway) must emit and forward W3C `traceparent`/`tracestate` plus our correlation envelope so spans join across Sentry/Axiom/Tinybird/Langfuse.
  - Acceptance criteria: Pure helper exports `newTraceContext()`, `parseTraceparent(header)`, `injectHeaders(ctx)`, `childSpan(ctx, name)`; round-trips a `traceparent` byte-for-byte; Zod-validates the correlation envelope `{tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id, prompt_version?, model?}`; co-located Vitest via `import.meta.vitest`.
  - Implementation notes: `node:crypto` randomUUID for span/trace IDs; no npm deps per template-utility-conventions; accept env via typed param, never `process.env`.
  - Hosting notes: Library only — bundled into the worker; no separate deploy.
  - Backing services: none (pure).
  - Observability: defines the envelope every other task imports.
  - Dependencies: none (foundation task).
  - Related files: `apps/project-sites/src/observability/trace-context.ts`, `packages/shared/src/schemas/correlation.ts`.

- [ ] LOOP-TRACES-002: Sentry platform-only middleware with hard client-site guard
  - Why: Sentry must capture full-stack platform/admin errors but NEVER fire on generated customer sites; the guard makes the rule enforceable in code, not just convention.
  - Acceptance criteria: Hono middleware initializes `@sentry/cloudflare` only when `c.get('surface') === 'platform'`; a unit test asserts that requests with `surface === 'customer-site'` (any `{slug}.projectsites.dev` host) produce ZERO Sentry calls; correlation envelope attached as Sentry tags.
  - Implementation notes: derive `surface` from host resolution (marketing/admin/api = platform; resolved tenant slug = customer-site); fail closed (default customer-site → no Sentry).
  - Hosting notes: runs in `project-sites` worker (platform).
  - Backing services: Sentry (HTTP API / `@sentry/cloudflare`).
  - Observability: this IS the error-tracking entry point.
  - Dependencies: LOOP-TRACES-001.
  - Related files: `apps/project-sites/src/middleware/sentry.ts`, `apps/project-sites/src/lib/sentry.ts`.

- [ ] LOOP-TRACES-003: ESLint/semgrep rule banning Sentry imports in customer-site code paths
  - Why: Defense-in-depth for the Sentry-never-on-client-sites rule — catch a stray `@sentry/*` import in any site-templating/serving module at lint time.
  - Acceptance criteria: A semgrep rule flags `@sentry/*` imports under site-serving/template/site-kit dirs; CI fails on hit; rule has a fixture proving positive + false-positive (admin import allowed).
  - Implementation notes: scope regex to `src/services/site_serving*`, `site-kit/**`, generated-site templates; allow under `middleware/`, `lib/sentry`, `routes/api`.
  - Hosting notes: CI gate only.
  - Backing services: none.
  - Observability: guards the observability boundary itself.
  - Dependencies: LOOP-TRACES-002.
  - Related files: `.semgrep/sentry-platform-only.yml`, `apps/project-sites/eslint.config.mjs`.

- [ ] LOOP-TRACES-004: Source-map upload on platform releases (Sentry releases + dist)
  - Why: Stack traces from the minified worker bundle are useless without source maps; release health needs versioned uploads.
  - Acceptance criteria: Deploy pipeline uploads source maps for each `wrangler deploy` tagged with the git SHA as the Sentry release; a thrown test error resolves to original TS file:line in Sentry.
  - Implementation notes: use Sentry CLI in CI after build; set `release` = git SHA; only for platform worker, never customer artifacts.
  - Hosting notes: GitHub Actions step post-build, pre/post deploy.
  - Backing services: Sentry releases API.
  - Observability: enables symbolicated traces + release health.
  - Dependencies: LOOP-TRACES-002.
  - Related files: `.github/workflows/deploy.yml`, `apps/project-sites/scripts/sentry-release.mjs`.

- [ ] LOOP-TRACES-005: Langfuse LLM-trace client wired to llm.projectsites.dev gateway
  - Why: Every LLM call through the gateway must produce a Langfuse trace with prompt_version + model + cost so we have full LLM observability.
  - Acceptance criteria: Thin HTTP client `traceLlmCall({input, output, model, prompt_version, usage, ...envelope})` posts a Langfuse trace+generation; trace_id matches the platform trace_id; unit test mocks the ingest endpoint.
  - Implementation notes: prefer Langfuse Cloud ingest (`cloud.langfuse.com`); keys via `get-secret LANGFUSE_PUBLIC_KEY`/`SECRET_KEY`; batch + `waitUntil` flush.
  - Hosting notes: **Langfuse Cloud (needs decision: confirm Cloud vs self-host)** — Cloud preferred because self-hosted Langfuse requires ClickHouse, which our no-ClickHouse rule forbids; self-host fallback would run on CF Workers Containers and must flag the ClickHouse dependency.
  - Backing services: Langfuse Cloud, llm.projectsites.dev gateway.
  - Observability: primary LLM-trace sink.
  - Dependencies: LOOP-TRACES-001.
  - Related files: `apps/project-sites/src/services/langfuse.ts`, `apps/project-sites/src/services/external_llm.ts`.

- [ ] LOOP-TRACES-006: Langfuse prompt registry as source of truth for prompt versions
  - Why: `.prompt.md` files + the prompt registry must sync to Langfuse so prompt_version in traces is authoritative and rollback is possible.
  - Acceptance criteria: A sync script upserts each prompt template to Langfuse (text/chat prompt) with a label per git SHA; the worker's prompt renderer reads the active version label; drift between local `.prompt.md` and Langfuse fails a check.
  - Implementation notes: use Langfuse MCP `createTextPrompt`/`updatePromptLabels`; map registry IDs to Langfuse prompt names.
  - Hosting notes: sync runs in CI; runtime reads cached version from KV (60s TTL).
  - Backing services: Langfuse Cloud, KV.
  - Observability: ties prompt_version tag to a real versioned artifact.
  - Dependencies: LOOP-TRACES-005.
  - Related files: `apps/project-sites/src/prompts/registry.ts`, `apps/project-sites/scripts/sync-langfuse-prompts.mjs`.

- [ ] LOOP-TRACES-007: Promptfoo prompt-eval CI gate (golden-prompt regression)
  - Why: Prompt or model changes must not silently regress output quality; a reusable CI gate blocks merges that fail the golden set.
  - Acceptance criteria: `promptfooconfig.yaml` runs golden cases against the gateway; CI job fails if pass rate drops below threshold or any P0 assertion fails; results uploaded as artifact; reusable across all prompts.
  - Implementation notes: assertions mix deterministic (regex/JSON-schema) + LLM-rubric; cases sourced from Langfuse datasets (LOOP-TRACES-008); mock-mode for keyless CI per eval-mock-mode-discipline.
  - Hosting notes: GitHub Actions; `workflow_dispatch` for live-mode, mock-only on push.
  - Backing services: Promptfoo, llm.projectsites.dev, Langfuse (dataset source).
  - Observability: gate results pushed back as Langfuse scores.
  - Dependencies: LOOP-TRACES-006, LOOP-TRACES-008.
  - Related files: `apps/project-sites/evals/promptfooconfig.yaml`, `.github/workflows/prompt-evals.yml`.

- [ ] LOOP-TRACES-008: Langfuse eval datasets seeded from real production traces
  - Why: Golden/eval datasets must reflect real customer-generation inputs, not synthetic guesses, to catch true regressions.
  - Acceptance criteria: A script samples N representative production LLM traces (PII-scrubbed) into a versioned Langfuse dataset; each item carries expected-output + rubric metadata; dataset is referenced by Promptfoo + Langfuse dataset runs.
  - Implementation notes: use Langfuse MCP `upsertDataset`/`upsertDatasetItem`/`listObservations`; scrub via shared `redact` util before upload.
  - Hosting notes: scheduled job (CF Cron) curates dataset weekly.
  - Backing services: Langfuse Cloud.
  - Observability: dataset run scores feed regression tracking.
  - Dependencies: LOOP-TRACES-005.
  - Related files: `apps/project-sites/scripts/seed-eval-dataset.mjs`, `packages/shared/src/utils/redact.ts`.

- [ ] LOOP-TRACES-009: Build-pipeline (site-generation Workflow) distributed tracing
  - Why: The AI site-generation Cloudflare Workflow is multi-step; without per-step spans, slow/failing generations are opaque.
  - Acceptance criteria: Each Workflow step emits a child span (start/end/status/durationMs) under the request's trace_id; spans visible in Sentry performance with `featureSlug=site_generation`; failed steps carry taxonomy code.
  - Implementation notes: wrap step bodies with `childSpan(ctx,...)`; propagate trace context through Workflow event payload (Workflows lose async-local context).
  - Hosting notes: CF Workflows (platform).
  - Backing services: Sentry performance, Langfuse (for LLM steps).
  - Observability: end-to-end generation trace.
  - Dependencies: LOOP-TRACES-001, LOOP-TRACES-002.
  - Related files: `apps/project-sites/src/workflows/site-generation.ts`.

- [ ] LOOP-TRACES-010: Container-build tracing for CF Workers Containers
  - Why: Container builds/deploys (Twenty, Plane, Unkey, etc.) fail opaquely; build spans + status give incident-responder a starting point.
  - Acceptance criteria: A build wrapper emits a span per container build (image, platform, duration, exit status) tagged with app_id; failures captured to Sentry with the build log tail attached; CI surfaces the trace link.
  - Implementation notes: parse `wrangler deploy`/docker build output; record amd64-native build constraint as span attribute (cross-build can exit on CF).
  - Hosting notes: CI runner; emits to platform Sentry only.
  - Backing services: Sentry, Axiom (full log body).
  - Observability: build trace ↔ Axiom log via trace_id.
  - Dependencies: LOOP-TRACES-001, LOOP-TRACES-013.
  - Related files: `apps/project-sites/scripts/trace-container-build.mjs`, `.github/workflows/*-deploy.yml`.

- [ ] LOOP-TRACES-011: AI cost tracing — per-call cost attributed to tenant/site/app
  - Why: Solo-founder economics require knowing LLM spend per tenant/feature; cost must be a first-class traced metric, not a monthly surprise.
  - Acceptance criteria: Every gateway LLM call records `usage` → computed USD cost via a model price table; cost emitted as a Langfuse score + a Tinybird event; an admin endpoint aggregates cost by tenant_id/model/prompt_version.
  - Implementation notes: price table versioned in repo (model → input/output $/1k); Langfuse `createModel` for native cost too; cross-check.
  - Hosting notes: worker compute; aggregation reads Tinybird.
  - Backing services: Langfuse, Tinybird (NEVER ClickHouse).
  - Observability: cost dashboard surface.
  - Dependencies: LOOP-TRACES-005, LOOP-TRACES-014.
  - Related files: `apps/project-sites/src/services/llm_cost.ts`, `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-TRACES-012: Trace ↔ Axiom log correlation (shared trace_id, deep links)
  - Why: Operators need to jump from a Sentry error/trace to the exact structured logs; correlation only works if both carry trace_id.
  - Acceptance criteria: Structured logger injects `trace_id`/`request_id` on every line shipped to Axiom; Sentry events include a deep link to the Axiom query filtered by trace_id; a test asserts the link resolves the correct dataset query.
  - Implementation notes: reuse existing structured-logging schema; build Axiom APL query URL from envelope; never log secrets/PII (redact).
  - Hosting notes: worker + Axiom dataset.
  - Backing services: Axiom (logs), Sentry.
  - Observability: this IS trace-to-log correlation.
  - Dependencies: LOOP-TRACES-001, LOOP-TRACES-002.
  - Related files: `apps/project-sites/src/observability/logger.ts`, `apps/project-sites/src/lib/sentry.ts`.

- [ ] LOOP-TRACES-013: Unified correlation-ID envelope enforced at every boundary
  - Why: Trace/log/analytics/eval joins break if any boundary drops an ID; one Zod-validated envelope, validated everywhere, prevents silent drops.
  - Acceptance criteria: Zod schema covers all IDs; middleware populates `c.var` envelope on ingress; outbound subrequests (LLM gateway, webhooks, containers) inject it as headers; a drift test fails if any new outbound `fetch` omits injection.
  - Implementation notes: detector grep for bare `fetch(` not wrapped by the envelope-injecting client (audit-arc detector pattern).
  - Hosting notes: worker-wide.
  - Backing services: none (cross-cutting).
  - Observability: the join key for all sinks.
  - Dependencies: LOOP-TRACES-001.
  - Related files: `packages/shared/src/schemas/correlation.ts`, `apps/project-sites/src/middleware/request_id.ts`.

- [ ] LOOP-TRACES-014: Trace → Tinybird OLAP pipe for trace/eval/cost analytics
  - Why: High-cardinality trace + eval + cost analytics need OLAP; doctrine mandates Tinybird and explicitly forbids ClickHouse.
  - Acceptance criteria: A `projectsites_traces` Tinybird datasource ingests trace summary events (trace_id, durations, status, model, cost, scores); endpoints expose p50/p95 latency + error rate by feature/tenant; NO ClickHouse anywhere.
  - Implementation notes: route through existing `event_bus` → Tinybird pattern; schema mirrors correlation envelope + metrics.
  - Hosting notes: Tinybird Cloud.
  - Backing services: Tinybird (NEVER ClickHouse).
  - Observability: powers perf/cost dashboards.
  - Dependencies: LOOP-TRACES-001, LOOP-TRACES-013.
  - Related files: `apps/project-sites/src/services/tinybird.ts`, `tinybird/datasources/projectsites_traces.datasource`.

- [ ] LOOP-TRACES-015: Release health + deploy markers (platform only)
  - Why: Correlate error-rate spikes to deploys; release health (crash-free sessions/requests) tells us if a deploy is healthy before wide rollout.
  - Acceptance criteria: Each platform deploy creates a Sentry release + deploy marker (env=production, SHA); release health tracks adopted/healthy requests; an alert fires if a new release's error rate exceeds the prior baseline.
  - Implementation notes: tie to LOOP-TRACES-004 release; deploy marker via Sentry API in CI.
  - Hosting notes: platform worker + CI.
  - Backing services: Sentry releases/health.
  - Observability: release-over-release error comparison.
  - Dependencies: LOOP-TRACES-004.
  - Related files: `.github/workflows/deploy.yml`, `apps/project-sites/scripts/sentry-release.mjs`.

- [ ] LOOP-TRACES-016: incident-responder agent ← Sentry MCP → auto-PR loop
  - Why: Solo founder can't watch Sentry 24/7; the incident-responder agent should read top issues via Sentry MCP and open fix PRs with the failing trace + suspected file:line.
  - Acceptance criteria: A scheduled task surfaces new high-severity Sentry issues; incident-responder agent produces a PR (or draft) containing root-cause hypothesis, trace link, Axiom log link, and a failing-test-first repro; never auto-merges security/payment fixes.
  - Implementation notes: agent reads Sentry MCP + Langfuse MCP; PR body links trace_id across sinks; gated behind approval tier for risky areas.
  - Hosting notes: agent run (background) triggered by CF Cron monitor.
  - Backing services: Sentry MCP, GitHub, Langfuse MCP.
  - Observability: closes the loop error → fix.
  - Dependencies: LOOP-TRACES-002, LOOP-TRACES-012.
  - Related files: `.claude/agents/incident-responder.md`, `.claude/scheduled_tasks.json`.

- [ ] LOOP-TRACES-017: Alerting + on-call runbook links in every alert
  - Why: An alert without "what to do next" wastes the first minutes of an incident; every alert must carry remediation + runbook deep links per CLAUDE.md notification rules.
  - Acceptance criteria: Sentry alert rules (error spike, release-health drop, perf regression) include an AI summary + runbook URL + correlation IDs; runbooks live in `docs/runbooks/`; a test validates each alert template renders required fields.
  - Implementation notes: alert payloads templated; route to notification system (psnotify, NOT Novu) + email (SES).
  - Hosting notes: Sentry alerts → webhook → worker → psnotify.
  - Backing services: Sentry, psnotify, SES.
  - Observability: actionable alerts.
  - Dependencies: LOOP-TRACES-015, LOOP-TRACES-016.
  - Related files: `docs/runbooks/`, `apps/project-sites/src/services/notifications.ts`.

- [ ] LOOP-TRACES-018: AI output quality / hallucination scoring → Langfuse scores
  - Why: Generated-site content quality must be measured continuously; low scores should gate publish and feed regression tracking.
  - Acceptance criteria: An LLM-judge evaluator scores each generation on factuality/coherence/brand-fit (0-1); scores written to Langfuse via `createScore`; generations below threshold flag for review (server returns review state, never silently ships).
  - Implementation notes: evaluator config via Langfuse `upsertEvaluator`/`createEvaluationRule`; rubric versioned; judge model pinned + recorded as model tag.
  - Hosting notes: runs in generation Workflow post-step.
  - Backing services: Langfuse Cloud, llm.projectsites.dev.
  - Observability: quality score time series.
  - Dependencies: LOOP-TRACES-005, LOOP-TRACES-009.
  - Related files: `apps/project-sites/src/services/ai_quality.ts`, `apps/project-sites/src/workflows/site-generation.ts`.

- [ ] LOOP-TRACES-019: Model-comparison eval harness (challenger vs incumbent)
  - Why: Before switching a generation model (e.g., DeepSeek vs Workers AI vs Anthropic), we need head-to-head quality/cost/latency evidence.
  - Acceptance criteria: A Promptfoo + Langfuse-dataset run executes the same golden set across N models; report ranks by quality score, cost, p95 latency; result archived as a Langfuse dataset run + Markdown report; no model swap merges without this report.
  - Implementation notes: reuse LOOP-TRACES-008 dataset; emit Tinybird rows for the comparison; respect provider tiers (DeepSeek=build, Anthropic/OpenAI=premium).
  - Hosting notes: `workflow_dispatch` CI job (live-mode).
  - Backing services: Promptfoo, Langfuse, llm.projectsites.dev, Tinybird.
  - Observability: model decision audit trail.
  - Dependencies: LOOP-TRACES-007, LOOP-TRACES-008, LOOP-TRACES-011.
  - Related files: `apps/project-sites/evals/model-comparison.yaml`, `apps/project-sites/scripts/model-compare-report.mjs`.

- [ ] LOOP-TRACES-020: Breadcrumbs with featureSlug across platform spans + errors
  - Why: Per CLAUDE.md feature-module drift rule, Sentry/PostHog events without `featureSlug` are drift; breadcrumbs make traces navigable by feature.
  - Acceptance criteria: A breadcrumb helper attaches `featureSlug` + correlation envelope to Sentry breadcrumbs at policy decisions, state transitions, and external calls; a drift check fails if a feature module fires events without featureSlug.
  - Implementation notes: thin wrapper over `Sentry.addBreadcrumb`; featureSlug sourced from feature manifest; platform-only (guarded).
  - Hosting notes: platform worker.
  - Backing services: Sentry.
  - Observability: feature-scoped breadcrumb trails.
  - Dependencies: LOOP-TRACES-002.
  - Related files: `apps/project-sites/src/observability/breadcrumbs.ts`, `libs/features/*/manifest.ts`.

- [ ] LOOP-TRACES-021: Customer-impact triage scoring on platform errors
  - Why: Not all errors matter equally; triage should rank issues by how many tenants/sites/revenue are affected so the solo founder fixes the highest-impact first.
  - Acceptance criteria: An enrichment step adds `affected_tenant_count`, `affected_site_count`, and plan tier to each Sentry issue (via tags + a join against D1/Tinybird); admin triage view sorts by impact; a test asserts impact fields populate.
  - Implementation notes: aggregate distinct tenant_id per fingerprint from trace events in Tinybird; attach as Sentry issue context.
  - Hosting notes: enrichment runs in worker on capture; aggregation reads Tinybird.
  - Backing services: Sentry, Tinybird, D1.
  - Observability: impact-ranked issue list.
  - Dependencies: LOOP-TRACES-013, LOOP-TRACES-014.
  - Related files: `apps/project-sites/src/services/triage.ts`, `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-TRACES-022: traces.projectsites.dev admin console (platform observability hub)
  - Why: Operators need one black/cyan admin surface to see traces, errors, LLM costs, eval scores, and release health — joined by correlation IDs, all platform-internal.
  - Acceptance criteria: `/admin/traces` Angular section renders: recent platform errors (Sentry), top LLM traces + cost (Langfuse/Tinybird), latest eval/quality scores, release health; every row deep-links to Sentry/Langfuse/Axiom by trace_id; flag-gated `traces_console` (experimental); NO customer-site error data displayed (platform only).
  - Implementation criteria/notes: reads via worker proxy endpoints (no client-side secrets); cyan/black cockpit tokens; visibility-aware polling.
  - Hosting notes: Angular admin (platform), served by `project-sites` worker.
  - Backing services: Sentry, Langfuse, Tinybird, Axiom.
  - Observability: the human-facing console for all of the above.
  - Dependencies: LOOP-TRACES-005, LOOP-TRACES-011, LOOP-TRACES-014, LOOP-TRACES-015.
  - Related files: `apps/project-sites/frontend/.../admin/sections/traces/`, `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-TRACES-023: Promptfoo golden-prompt regression gate wired into pre-merge CI
  - Why: The prompt-eval gate (LOOP-TRACES-007) must be a required status check so no prompt/model change lands without passing — making it reusable across every prompt-owning feature.
  - Acceptance criteria: A reusable GitHub composite action runs Promptfoo mock-mode on every PR touching `prompts/**` or model config; required status check; live-mode runs on `release/**`; results posted as a PR comment with pass/fail per case + score delta vs baseline.
  - Implementation notes: composite action so other repos/features reuse it; baseline stored as a committed JSON; skip cleanly when no prompt files changed (portable-audit-discipline).
  - Hosting notes: GitHub Actions composite action.
  - Backing services: Promptfoo; Langfuse (baseline scores).
  - Observability: regression deltas surfaced in PR.
  - Dependencies: LOOP-TRACES-007.
  - Related files: `.github/actions/prompt-eval-gate/action.yml`, `apps/project-sites/evals/baseline.json`.

- [ ] LOOP-TRACES-024: Self-host-vs-Cloud Langfuse decision record + CF-Container fallback skeleton
  - Why: Lock the Langfuse hosting decision in writing — Cloud is preferred precisely because self-host needs ClickHouse, which doctrine forbids — and stage a guarded fallback if data-residency ever forces self-host.
  - Acceptance criteria: An ADR documents: Cloud chosen; the ClickHouse-in-self-host conflict with the no-ClickHouse rule; the trigger conditions that would force self-host; **(needs decision)** markers on residency/cost thresholds; a non-deployed CF Workers Containers skeleton + wrangler stub exists but is flag-dark, with the ClickHouse dependency explicitly flagged as unresolved.
  - Implementation notes: ADR in `docs/decisions/`; skeleton mirrors other CF-container deploys (amd64-native, no /dev/shm caveats noted); do NOT stand up ClickHouse — block on decision.
  - Hosting notes: Langfuse Cloud now; CF Workers Containers only if forced (and even then ClickHouse remains a blocker `(needs decision)`).
  - Backing services: Langfuse Cloud (active); CF Workers Containers (staged, dark).
  - Observability: governs where all LLM traces live.
  - Dependencies: LOOP-TRACES-005.
  - Related files: `apps/project-sites/docs/decisions/langfuse-hosting.md`, `apps/project-sites/containers/langfuse/` (staged).

## llm.projectsites.dev — LiteLLM + RouteLLM + Cloudflare AI Gateway

### Raw research themes considered

Surveyed ~50 themes across the unified-LLM-proxy space: OpenAI-compatible passthrough, per-tier routing (instant/mid/premium), RouteLLM cheap-vs-strong classifier routing, CF AI Gateway as the mandatory caching/rate-limit/observability wrapper, semantic + exact prompt caching, fallback chains and provider failover, per-tenant API keys + budgets + spend tracking, per-app quotas, embeddings/vision routing (DeepSeek lacks vision → premium pin), structured outputs and tool-calling passthrough, streaming integrity, eval-gated model swaps via Langfuse, abuse/anomaly prevention, BYO-key, and cost dashboards in /admin. Collapsed duplicates (e.g. "spend tracking" + "cost dashboard" + "budget enforcement" share a ledger primitive) and dropped low-leverage themes (custom fine-tune hosting, on-prem GPU, exotic provider adapters) as off-roadmap for a Cloudflare-first solo platform. Kept the three flagship reusable primitives — tier routing, budget enforcement, semantic cache — as the spine every other task hangs off. Every selected task assumes CF AI Gateway is unconditionally in front of every model call and that `external_llm.chooseProviderForTier` is the in-worker fast path while LiteLLM is the heavy unified proxy. Cost discipline (cheapest tier that meets quality + hard budget caps) is the consistent acceptance lens.

### Selected 24 implementation tasks

- [ ] LOOP-LLM-001: Deploy LiteLLM unified OpenAI-compatible proxy on CF Workers Containers
  - Why: One OpenAI-compatible base URL (`llm.projectsites.dev/v1`) is the single ingress for every AI feature; eliminates per-feature SDK sprawl.
  - Acceptance criteria: `/v1/chat/completions`, `/v1/embeddings`, `/v1/models` return 200 with OpenAI-shaped payloads; `/health` 200; container boots cold <10s; routes for `anthropic`, `openai`, `deepseek`, `workers-ai` resolvable through it.
  - Implementation notes: `litellm-proxy` Docker image, `config.yaml` enumerating model_list per tier; pin `--platform amd64` and build on amd64 CI per [[cf-containers-native-amd64-only]]; `mkdir /dev/shm` in entrypoint per [[cf-containers-no-dev-shm]].
  - Hosting notes: CF Workers Containers (proxy is largely stateless). Fly only if it later needs 24/7 warm pool — not now; state why in PR.
  - Backing services: Neon (`projectsites_litellm` spend/key DB), Upstash Redis (response + routing cache), CF AI Gateway (front), R2 (config snapshots).
  - Observability: Langfuse traces, Axiom logs, Sentry (platform errors only), correlation IDs on every request.
  - Dependencies: none (foundational).
  - Related files: `apps/project-sites/containers/litellm/Dockerfile`, `apps/project-sites/containers/litellm/config.yaml`, `wrangler.toml`.

- [ ] LOOP-LLM-002: FLAGSHIP — tier-routing primitive (`instant|standard|premium`) as reusable library
  - Why: Every AI surface must pick the cheapest tier that meets quality; centralizing this is the platform's core cost lever.
  - Acceptance criteria: `routeForTier(env, tier, request)` returns a concrete `{provider, model, endpoint}`; premium→Anthropic/OpenAI (+ all vision), standard→DeepSeek `deepseek-chat`, instant→Workers AI `@cf/meta/llama-*-fp8-fast`; unit-tested for each tier + vision-forces-premium branch.
  - Implementation notes: extend existing `external_llm.chooseProviderForTier`; wrap LiteLLM model groups; default volume → standard; vision input detected → force premium.
  - Hosting notes: in-worker (no container hop for the routing decision).
  - Backing services: CF AI Gateway slug `projectsites`; provider slug `deepseek`.
  - Observability: emit `model`, `provider`, `tier`, `prompt_version` on every decision to Langfuse + Axiom.
  - Dependencies: LOOP-LLM-001.
  - Related files: `apps/project-sites/src/services/external_llm.ts`, `apps/project-sites/src/services/llm_router.ts` (new).

- [ ] LOOP-LLM-003: FLAGSHIP — per-tenant/app budget-enforcement primitive (hard caps + soft alerts)
  - Why: Cost discipline is paramount; an unbounded tenant can drain spend. Budgets are the safety rail every call passes through.
  - Acceptance criteria: pre-call `assertBudget(tenant_id, app_id, est_cost)` blocks (returns 402-style envelope) when projected spend exceeds cap; soft threshold (80%) fires notification; daily/monthly windows; enforced atomically (no race double-spend).
  - Implementation notes: LiteLLM `max_budget`/`budget_duration` per key + a worker-side Upstash atomic counter mirror for instant pre-check; reconcile against Neon spend ledger.
  - Hosting notes: in-worker pre-check (Upstash atomic) + LiteLLM authoritative ledger.
  - Backing services: Neon (authoritative spend ledger), Upstash (atomic real-time counter).
  - Observability: budget-breach + budget-warning events to PostHog + psnotify; `api_key_id`, `tenant_id` tags.
  - Dependencies: LOOP-LLM-001, LOOP-LLM-013.
  - Related files: `apps/project-sites/src/services/llm_budget.ts` (new), `libs/features/llm_budgets/`.

- [ ] LOOP-LLM-004: FLAGSHIP — semantic cache layer (embedding-similarity) in front of premium tier
  - Why: Repeated near-identical prompts (site-gen, concierge FAQs) should hit cache, not re-bill premium tokens — biggest single cost saver.
  - Acceptance criteria: cache hit when cosine similarity ≥ configurable threshold (default 0.95) on Workers-AI embedding of the normalized prompt; returns cached completion with `x-cache: semantic-hit`; per-tenant namespace; TTL + manual purge; measured hit-rate surfaced.
  - Implementation notes: Workers AI embeddings → Vectorize index per tenant; exact-match fast path via Upstash before semantic lookup; only cache deterministic (temperature≤0.3) calls.
  - Hosting notes: in-worker (Vectorize + Upstash); no container hop on hit.
  - Backing services: CF Vectorize (semantic index), Upstash (exact-match + metadata), R2 (large payload bodies).
  - Observability: hit/miss/savings to Tinybird; `tenant_id`, `model`, `similarity` fields.
  - Dependencies: LOOP-LLM-002.
  - Related files: `apps/project-sites/src/services/llm_semantic_cache.ts` (new).

- [ ] LOOP-LLM-005: RouteLLM cheap-vs-strong classifier wired into the standard tier
  - Why: Many "standard" prompts are answerable by instant tier; RouteLLM's classifier auto-downgrades safe ones, banking free Workers-AI calls.
  - Acceptance criteria: a per-request difficulty score (0–1) routes below-threshold to instant, above to standard/premium; threshold tunable per app; A/B logged; quality regression guardrail (eval-gated, see LOOP-LLM-019).
  - Implementation notes: RouteLLM `mf`/`bert` router or a Workers-AI lightweight classifier as the scorer; integrate as a pre-step inside `routeForTier`; "(needs decision)" — host RouteLLM model in LiteLLM vs. inline Workers-AI classifier.
  - Hosting notes: scorer runs as Workers AI inference (instant tier) to stay edge-cheap.
  - Backing services: Workers AI (classifier), CF AI Gateway.
  - Observability: route-decision + downgrade-rate to Tinybird + Langfuse.
  - Dependencies: LOOP-LLM-002, LOOP-LLM-019.
  - Related files: `apps/project-sites/src/services/llm_router.ts`, `apps/project-sites/src/services/route_llm.ts` (new).

- [ ] LOOP-LLM-006: Mandatory CF AI Gateway enforcement guard (no raw provider calls)
  - Why: AI Gateway is MANDATORY for caching/rate-limit/observability; any bypass is a drift bug and a blind spot.
  - Acceptance criteria: a lint/grep gate fails CI on any `fetch` to `api.anthropic.com`/`api.openai.com`/`api.deepseek.com` not routed through the `gateway.ai.cloudflare.com/.../projectsites/...` base; runtime assertion in `external_llm` rejects non-gateway base URLs.
  - Implementation notes: codify gateway base-URL builder per provider; add `bin/validate-ai-gateway.mjs` detector per [[audit-arc-detector-finds-bugs]].
  - Hosting notes: CI gate + in-worker assertion.
  - Backing services: CF AI Gateway.
  - Observability: violation reported as drift finding.
  - Dependencies: LOOP-LLM-001.
  - Related files: `bin/validate-ai-gateway.mjs` (new), `apps/project-sites/src/services/external_llm.ts`.

- [ ] LOOP-LLM-007: Fallback chain + provider failover with circuit-breaker
  - Why: A provider 5xx/timeout must transparently fail over (premium→alt-premium→standard) so AI features never hard-fail.
  - Acceptance criteria: configurable ordered fallback per model group; circuit-breaker opens after N consecutive failures with backoff+jitter; failover preserves streaming where possible; degraded-tier responses tagged `x-llm-fallback: true`.
  - Implementation notes: LiteLLM `fallbacks` + `cooldown_time`; worker-side circuit state in Upstash; AI Gateway's own fallback as the outer net.
  - Hosting notes: LiteLLM-native fallback + Upstash breaker state.
  - Backing services: Upstash (breaker state), CF AI Gateway (outer fallback).
  - Observability: failover + breaker-open events to Sentry (platform) + Tinybird; `provider`, `attempt` fields.
  - Dependencies: LOOP-LLM-002.
  - Related files: `apps/project-sites/src/services/llm_failover.ts` (new), `config.yaml`.

- [ ] LOOP-LLM-008: Per-tenant virtual API keys with scopes + rotation
  - Why: Each tenant/app needs its own key for isolation, budget attribution, and revocation without touching provider keys.
  - Acceptance criteria: mint/list/revoke/rotate virtual keys via `/api/llm/keys`; key carries allowed models, tier ceiling, budget link, rate limit; revoked key 401s within cache TTL; provider keys never exposed to tenants.
  - Implementation notes: LiteLLM virtual keys (`/key/generate`) backed by Neon; KV cache (60s) of key→policy for edge fast-path.
  - Hosting notes: LiteLLM key store (Neon) + KV cache mirror.
  - Backing services: Neon (key store), KV (policy cache).
  - Observability: key lifecycle events to audit log; `api_key_id` correlation everywhere.
  - Dependencies: LOOP-LLM-001, LOOP-LLM-003.
  - Related files: `libs/features/llm_keys/`, `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-LLM-009: Customer BYO-key passthrough (bring-your-own provider keys)
  - Why: Some tenants want to bill their own Anthropic/OpenAI account; platform routes through their key while still enforcing gateway + observability.
  - Acceptance criteria: tenant stores encrypted provider key; requests flagged `byo` route on that key (no platform spend), still pass AI Gateway + budget-rate-limit + tracing; key encrypted at rest; validation ping on save.
  - Implementation notes: encrypt with Web Crypto, store ciphertext in Neon; inject at LiteLLM call time per-request header; never log plaintext.
  - Hosting notes: in-worker decrypt → LiteLLM passthrough.
  - Backing services: Neon (encrypted keys), CF AI Gateway.
  - Observability: BYO usage tagged `billing_mode: byo`; redact key in all logs.
  - Dependencies: LOOP-LLM-001, LOOP-LLM-008.
  - Related files: `apps/project-sites/src/services/llm_byok.ts` (new).

- [ ] LOOP-LLM-010: Spend ledger + cost-attribution write path (Tinybird OLAP)
  - Why: Every call's cost must be attributable per tenant/app/model/feature for dashboards, budgets, and margin analysis.
  - Acceptance criteria: each completed call writes a `llm_spend` event (input/output tokens, computed USD, tier, cache-status, latency) to Tinybird datasource `projectsites_llm_spend`; Neon holds the authoritative rollup; cost matches provider invoices within tolerance.
  - Implementation notes: token→USD pricing table per model (versioned); emit via existing `event_bus`→Tinybird path; NEVER ClickHouse.
  - Hosting notes: async write (waitUntil) post-response.
  - Backing services: Tinybird (OLAP), Neon (authoritative rollup).
  - Observability: self — this IS the cost telemetry; correlation IDs full set.
  - Dependencies: LOOP-LLM-001.
  - Related files: `apps/project-sites/src/services/tinybird.ts`, `apps/project-sites/src/services/llm_spend.ts` (new).

- [ ] LOOP-LLM-011: /admin LLM cost dashboard (spend by tenant/app/model/tier)
  - Why: Operator needs live visibility into where tokens and dollars go to tune routing and catch runaway spend.
  - Acceptance criteria: `/admin/llm-spend` renders Tinybird-backed charts (daily spend, top tenants, tier mix, cache hit-rate, fallback-rate); cyan/black cockpit styling; date-range filter; CSV export.
  - Implementation notes: Angular standalone section per [[admin-section-add-recipe]]; reads Tinybird endpoints; `<app-rolling-counter>` for headline spend.
  - Hosting notes: frontend (R2) + worker API proxy to Tinybird.
  - Backing services: Tinybird (query endpoints).
  - Observability: PostHog page event; admin a11y sweep.
  - Dependencies: LOOP-LLM-010.
  - Related files: `apps/project-sites/frontend/.../admin/sections/llm-spend/`, `apps/project-sites/src/routes/api.ts`.

- [ ] LOOP-LLM-012: Embeddings routing (instant-tier default, premium fallback)
  - Why: Embeddings power semantic cache, search, RAG — they should default to free Workers-AI and only escalate when quality demands.
  - Acceptance criteria: `/v1/embeddings` routes to Workers AI `@cf/baai/bge-*` by default; per-request override to OpenAI `text-embedding-3-*`; dimension normalization documented; batch support.
  - Implementation notes: register embedding models in LiteLLM model_list; normalize dims when mixing providers (re-embed on model switch).
  - Hosting notes: Workers AI inline; LiteLLM for premium embeddings.
  - Backing services: Workers AI, CF Vectorize (consumer), CF AI Gateway.
  - Observability: embedding calls tagged `kind: embedding`, `model`.
  - Dependencies: LOOP-LLM-002.
  - Related files: `apps/project-sites/src/services/llm_embeddings.ts` (new), `config.yaml`.

- [ ] LOOP-LLM-013: Per-app LLM quotas + rate limiting (DO counter, plan-gated)
  - Why: Free-plan abuse and noisy neighbors must be throttled; CF managed rate-limiting doesn't enforce on this plan per [[rate-limiting-plan-gated]] → DO counter is the fix.
  - Acceptance criteria: per-app RPM/TPM ceilings from plan entitlements; exceed → 429 with friendly envelope + `Retry-After`; sliding window; counters in a Durable Object; AI Gateway rate-limit as outer layer.
  - Implementation notes: DO-based token-bucket keyed by `app_id`; entitlements from shared `ENTITLEMENTS` constants.
  - Hosting notes: Durable Object (per-app) + AI Gateway rate-limit.
  - Backing services: Durable Objects, CF AI Gateway.
  - Observability: throttle events to PostHog; rate-limit UX (LOOP-LLM-014) consumes this.
  - Dependencies: LOOP-LLM-002, LOOP-LLM-008.
  - Related files: `apps/project-sites/src/services/llm_quota_do.ts` (new), `packages/shared/src/constants`.

- [ ] LOOP-LLM-014: Friendly rate-limit + budget-exceeded UX (Problem Details + retry)
  - Why: Limits must read as helpful, not broken — "errors as UX" per CLAUDE.md; users get clear next step.
  - Acceptance criteria: 429/402 responses use RFC7807 envelope with `correlationId`, human reason, "what to do next" (upgrade link / retry-after); admin + concierge surfaces render a calm banner not a stack trace; Flesch ≥50 copy.
  - Implementation notes: extend existing error taxonomy/envelope; map LiteLLM/quota errors to stable codes; UI banner reuses calm-fallback pattern.
  - Hosting notes: worker envelope + frontend banner.
  - Backing services: none new.
  - Observability: surfaced-error events carry `code`, `correlationId`.
  - Dependencies: LOOP-LLM-003, LOOP-LLM-013.
  - Related files: `apps/project-sites/src/middleware/error_handler.ts`, frontend banner component.

- [ ] LOOP-LLM-015: Streaming passthrough integrity (SSE) with mid-stream failover
  - Why: Concierge/chat features need token streaming; broken or non-resumable streams degrade UX and hide failures.
  - Acceptance criteria: `/v1/chat/completions` with `stream:true` proxies SSE end-to-end with no buffering stalls; first-token latency logged; mid-stream provider drop triggers documented recovery (restart on alt provider or clean error frame); stream recovery E2E test green.
  - Implementation notes: Workers streaming `ReadableStream` passthrough; AI Gateway streaming support; record TTFT + token-rate.
  - Hosting notes: in-worker stream proxy.
  - Backing services: CF AI Gateway.
  - Observability: TTFT, tokens/s, stream-abort to Tinybird/Langfuse.
  - Dependencies: LOOP-LLM-001, LOOP-LLM-007.
  - Related files: `apps/project-sites/src/services/llm_stream.ts` (new).

- [ ] LOOP-LLM-016: Structured-output + JSON-schema mode normalization across providers
  - Why: Site-gen and contract-first AI need guaranteed JSON; providers differ (response_format vs tool-forcing) — normalize to one contract.
  - Acceptance criteria: `response_format: json_schema` works uniformly across Anthropic/OpenAI/DeepSeek/Workers-AI (shim where unsupported); Zod-validate the parsed output; retry-with-repair on invalid JSON (max N); typed domain object returned.
  - Implementation notes: per-provider adapter (native schema vs forced tool-call vs grammar); Zod parse → repair loop per contract-first-AI doctrine.
  - Hosting notes: in-worker normalization.
  - Backing services: none new.
  - Observability: schema-violation + repair-attempt counts to Langfuse.
  - Dependencies: LOOP-LLM-002.
  - Related files: `apps/project-sites/src/services/llm_structured.ts` (new), `apps/project-sites/src/prompts/schemas.ts`.

- [ ] LOOP-LLM-017: Tool-calling passthrough normalization (OpenAI tools ⇄ Anthropic tool_use)
  - Why: Agentic features (concierge, support triage) call tools; cross-provider tool-call shape divergence must be hidden behind one API.
  - Acceptance criteria: a single OpenAI-style `tools`/`tool_calls` contract translates to/from Anthropic `tool_use`/`tool_result` and DeepSeek; multi-turn tool loops preserved; parallel tool calls supported where provider allows.
  - Implementation notes: LiteLLM already normalizes much of this — verify + add worker-side adapter gaps; "(needs decision)" — rely on LiteLLM translation vs. own adapter for Workers-AI tool gaps.
  - Hosting notes: LiteLLM-native + thin worker shim.
  - Backing services: CF AI Gateway.
  - Observability: tool-call count + tool latency to Langfuse.
  - Dependencies: LOOP-LLM-001, LOOP-LLM-016.
  - Related files: `apps/project-sites/src/services/llm_tools.ts` (new).

- [ ] LOOP-LLM-018: Vision routing guard (DeepSeek has no vision → force premium)
  - Why: Brian directive — ALL vision is premium; routing image inputs to a vision-less mid-tier model silently fails.
  - Acceptance criteria: any request with image parts is detected and forced to Anthropic/OpenAI vision models regardless of requested tier; non-vision premium models excluded; clear error if BYO-key lacks vision access.
  - Implementation notes: content-part inspection in `routeForTier`; maintain a vision-capable model allowlist.
  - Hosting notes: in-worker routing branch.
  - Backing services: CF AI Gateway.
  - Observability: vision-forced-upgrade tagged `forced_tier: premium, reason: vision`.
  - Dependencies: LOOP-LLM-002.
  - Related files: `apps/project-sites/src/services/llm_router.ts`.

- [ ] LOOP-LLM-019: Eval-gated model swaps (Langfuse datasets + scores in CI)
  - Why: Swapping a model/tier for cost must not silently drop quality; an eval gate makes swaps safe and reversible.
  - Acceptance criteria: candidate model runs against a Langfuse golden dataset per AI feature; aggregate score must meet/exceed incumbent within tolerance to promote; CI blocks a model_list change lacking a passing eval; regression tracked over time.
  - Implementation notes: reuse `/run-evals` harness; per-feature rubrics + schema-validated results; store runs in Langfuse datasets.
  - Hosting notes: CI job + Langfuse.
  - Backing services: Langfuse (datasets/scores), CF AI Gateway.
  - Observability: eval scores + regression deltas in Langfuse.
  - Dependencies: LOOP-LLM-002, LOOP-LLM-020.
  - Related files: `apps/project-sites/tools/evals/cases/`, `.github/workflows/llm-evals.yml` (new).

- [ ] LOOP-LLM-020: Langfuse tracing on every LLM call (full correlation set)
  - Why: AI is the primary maintainer; traces are how we debug routing, cost, and quality — non-optional.
  - Acceptance criteria: every call produces a Langfuse trace+generation with `tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id, model, provider, prompt_version`, token counts, cost, cache-status, tier; sampling configurable; PII redacted.
  - Implementation notes: LiteLLM Langfuse callback + worker-side enrichment for fields LiteLLM can't see; redact via existing `redact` util.
  - Hosting notes: async (waitUntil) trace flush.
  - Backing services: Langfuse, Axiom (mirror structured log), CF AI Gateway (its own logs).
  - Observability: self — defines the tracing contract for all other tasks.
  - Dependencies: LOOP-LLM-001.
  - Related files: `apps/project-sites/src/services/llm_tracing.ts` (new), `config.yaml`.

- [ ] LOOP-LLM-021: Prompt registry version-pinning + hot-patch (KV) integration
  - Why: Prompts are versioned artifacts; the gateway must record which `prompt_version` produced each output for eval + rollback.
  - Acceptance criteria: calls reference a registered prompt id+version; version flows into traces + spend events; KV hot-patch updates a prompt without redeploy; rollback to prior version is one operation.
  - Implementation notes: extend existing `prompts/registry`; KV hot-patch path already exists — wire `prompt_version` through the router into telemetry.
  - Hosting notes: KV-backed registry (existing) + worker.
  - Backing services: KV (hot-patch), Langfuse (prompt management — "(needs decision)" Langfuse prompts vs. in-repo registry as SoT).
  - Observability: `prompt_version` on every trace + spend row.
  - Dependencies: LOOP-LLM-020.
  - Related files: `apps/project-sites/src/prompts/registry.ts`, `apps/project-sites/src/services/llm_router.ts`.

- [ ] LOOP-LLM-022: Abuse / anomaly prevention (Turnstile + spend-spike + jailbreak heuristics)
  - Why: A leaked tenant key or scripted abuse can spike spend and reputation risk; the gateway is the choke point to catch it.
  - Acceptance criteria: anomalous spend velocity per key auto-throttles + alerts; optional Turnstile gate on unauthenticated/public LLM surfaces; basic prompt-injection/jailbreak heuristic flags + logs (non-blocking by default, killswitch to block); repeated abuse auto-suspends key.
  - Implementation notes: Upstash sliding-window velocity check; Workers-AI instant classifier for injection heuristic; flag-gated blocking.
  - Hosting notes: in-worker checks; DO/Upstash state.
  - Backing services: Upstash, Workers AI, Turnstile (CF-minted keys per cloudflare-native-provisioning).
  - Observability: abuse events to PostHog + Sentry (platform) + psnotify.
  - Dependencies: LOOP-LLM-003, LOOP-LLM-013.
  - Related files: `apps/project-sites/src/services/llm_abuse_guard.ts` (new).

- [ ] LOOP-LLM-023: Webhook events for LLM lifecycle (Hookdeck + Outpost)
  - Why: Tenants/apps need to react to budget-exceeded, key-revoked, eval-promoted, anomaly-detected without polling.
  - Acceptance criteria: typed events (`llm.budget.threshold`, `llm.budget.exceeded`, `llm.key.revoked`, `llm.model.promoted`, `llm.abuse.flagged`) delivered via Hookdeck→Outpost with signature + D1 idempotency + R2 dead-letter; subscribable per tenant.
  - Implementation notes: reuse webhook-handler scaffold; route outbound through Hookdeck+Outpost; host receiver on workers.dev to dodge Bot Fight Mode per [[bot-fight-mode-blocks-inbound-webhooks]].
  - Hosting notes: worker emit + Hookdeck/Outpost transport.
  - Backing services: Hookdeck + Outpost (transport), D1 (idempotency), R2 (dead-letter).
  - Observability: delivery success/fail to Tinybird; correlation IDs on payloads.
  - Dependencies: LOOP-LLM-003, LOOP-LLM-008.
  - Related files: `apps/project-sites/src/services/llm_webhooks.ts` (new), `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-LLM-024: Migrate all existing AI features onto the gateway + decommission direct calls
  - Why: The plane only delivers value when site-gen, concierge, content, support-triage, social posts ALL route through it — no shadow paths.
  - Acceptance criteria: every existing AI caller (`ai_workflows`, `chat_synthesis`, `image_generation` text parts, `openai_research`, social) uses `routeForTier`/LiteLLM base URL; LOOP-LLM-006 gate passes repo-wide; per-feature tier mapping documented; E2E proves each feature still works post-migration.
  - Implementation notes: incremental, feature-by-feature behind a `llm_gateway_<feature>` flag; grep full include-list per [[feedback_convergence_overclaim]] to avoid over-claiming "migrated".
  - Hosting notes: in-worker callers → LiteLLM/gateway.
  - Backing services: all of the above.
  - Observability: pre/post tier-mix + cost delta per feature to Tinybird.
  - Dependencies: LOOP-LLM-002, LOOP-LLM-006, LOOP-LLM-020.
  - Related files: `apps/project-sites/src/services/ai_workflows.ts`, `chat_synthesis.ts`, `openai_research.ts`, `image_generation.ts`, `workflows/site-generation.ts`.

## browser.projectsites.dev — Browser Automation

### Raw research themes considered

Surveyed 50+ raw ideas across the browser plane: a unified screenshot/crawl/scrape/snapshot primitive over `src/services/browser_gateway.ts`, source-site crawling for rebuilds, six-breakpoint responsive screenshots, OG-image and PDF rendering, Lighthouse + axe + CWV audits, sitemap/robots discovery, link checking, post-deploy prod E2E, scheduled visual regression, uptime screenshot proof, customer-site monitoring, brand/logo/favicon/color extraction via vision, competitor crawling, and AI agentic browsing (Stagehand) for form-fill and login-flow testing. The hard constraint throughout is the tiering: **CF Browser Rendering (REST API first, then `@cloudflare/playwright` binding) is the default product layer**, Stagehand layers AI-driven steps on top, **Browserbase is a managed fallback only** (sessions/replay/proxy), and **Skyvern stays internal-only behind CF Access** (`skyvern.megabyte.space`) — never the default. Everything orchestrates on CF Workers; a persistent browser pool on Fly is reserved as a rare, justified exception since CF Browser Rendering covers nearly all jobs. Artifacts land in R2, jobs carry full correlation IDs (tenant/site/app/trace/job/request/target_url), and every crawl respects robots.txt with a realistic UA and rate limits. Ideas were pruned to the 24 highest-leverage, programmable tasks that build a coherent platform browser plane rather than one-off scripts.

### Selected 24 implementation tasks

- [ ] LOOP-BROWSER-001: Unified browser primitive over `browser_gateway.ts` (`screenshot` / `content` / `snapshot` / `scrape` / `pdf`)
  - Why: Every downstream consumer (snapshots, monitoring, QA, site-gen) needs one typed entrypoint instead of ad-hoc Playwright calls; flagship of this plane.
  - Acceptance criteria: Single `BrowserGateway` service exposes `capture()` accepting a discriminated-union `BrowserJob` Zod schema; routes screenshot/content/snapshot/scrape to CF Browser Rendering REST first, binding second; returns `{ artifactKey, contentType, bytes, timingMs }`; unit tests cover each mode + fallback path.
  - Implementation notes: Wrap CF REST endpoints `/screenshot`, `/content`, `/snapshot`, `/scrape`; binding (`@cloudflare/playwright` + BROWSER) only for steps REST cannot do (multi-step interaction).
  - Hosting notes: CF Workers; no Docker, no Fly.
  - Backing services: CF Browser Rendering, R2 (artifacts).
  - Observability: Axiom structured logs per job, Sentry (platform) on failure, Tinybird `browser_jobs` event.
  - Dependencies: none (foundation).
  - Related files: `src/services/browser_gateway.ts`, `src/types/env.ts`, `packages/shared/src/schemas/`.

- [ ] LOOP-BROWSER-002: `BrowserJob` Zod contract + tiering policy resolver
  - Why: Codifies CF-first → Browserbase → Skyvern selection so callers never hard-pick a provider.
  - Acceptance criteria: `resolveProvider(job)` returns `cf | browserbase | skyvern` from job needs (session-replay/proxy → Browserbase; internal authed agentic → Skyvern; else CF); Zod schema validates every job at boundary; exhaustive unit tests for tier decisions.
  - Implementation notes: Default always CF; Browserbase requires explicit `needsManagedSession` flag; Skyvern requires `internalOnly: true` + CF Access context.
  - Hosting notes: CF Workers.
  - Backing services: none (pure logic).
  - Observability: log resolved provider + reason on every job.
  - Dependencies: LOOP-BROWSER-001.
  - Related files: `packages/shared/src/schemas/browser.ts`, `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-003: R2 artifact store with content-addressed keys + retention
  - Why: Screenshots/PDFs/HTML need durable, dedup'd, expiring storage keyed by correlation IDs.
  - Acceptance criteria: `putArtifact()` writes `browser/{tenant}/{site}/{job}/{sha256}.{ext}`; returns signed/public URL; TTL-based lifecycle for ephemeral QA shots vs permanent snapshots; idempotent on identical bytes.
  - Implementation notes: SHA-256 over bytes for dedup; metadata holds target_url + trace_id; tag artifacts `ephemeral|durable`.
  - Hosting notes: CF Workers + R2.
  - Backing services: R2.
  - Observability: Axiom log bytes + dedup-hit ratio.
  - Dependencies: LOOP-BROWSER-001.
  - Related files: `src/services/browser_gateway.ts`, `wrangler.toml` (R2 binding).

- [ ] LOOP-BROWSER-004: Responsive screenshot set across 6 breakpoints
  - Why: Visual QA + marketing need 375/390/768/1024/1280/1920 captures in one call.
  - Acceptance criteria: `screenshotResponsive(url)` returns 6 R2 artifacts with breakpoint metadata; full-page + above-fold variants; deterministic (disabled animations, fixed clock).
  - Implementation notes: CF REST `/screenshot` per viewport; inject `prefers-reduced-motion` + freeze `Date.now`; batch via Workers concurrency.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, R2.
  - Observability: Tinybird per-breakpoint timing.
  - Dependencies: LOOP-BROWSER-001, 003.
  - Related files: `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-005: Source-site crawler for rebuilds (sitemap + BFS + robots)
  - Why: Site enhancement pipeline needs a full URL inventory of a source domain to classify keep/merge/301/drop.
  - Acceptance criteria: `crawlSite(domain, {maxPages, maxDepth})` parses `sitemap.xml` + robots, BFS-follows same-origin links, returns `_url_inventory.json` shape with status/title/depth/canonical; honors `Disallow` + crawl-delay; rate-limited.
  - Implementation notes: CF REST `/content` per page; dedup via normalized URL set; realistic UA + concurrency cap; Wayback fallback for dead pages (needs decision on Wayback budget).
  - Hosting notes: CF Workers; long crawls via Workflow (LOOP-BROWSER-018).
  - Backing services: CF Browser Rendering, R2 (inventory).
  - Observability: Axiom per-page log, Tinybird crawl summary.
  - Dependencies: LOOP-BROWSER-001, 006.
  - Related files: `src/services/browser_gateway.ts`, `src/workflows/`.

- [ ] LOOP-BROWSER-006: robots.txt + sitemap discovery & compliance gate
  - Why: All crawling must be polite by default; centralize parsing once.
  - Acceptance criteria: `loadRobots(origin)` returns parsed rules + crawl-delay + sitemap URLs; `isAllowed(url, ua)` enforced inside crawler/scraper before any fetch; cached in KV 1h.
  - Implementation notes: Standard robots parser; sitemap index recursion; KV cache keyed by origin.
  - Hosting notes: CF Workers + KV.
  - Backing services: KV.
  - Observability: log blocked-by-robots count per crawl.
  - Dependencies: none.
  - Related files: `src/services/browser_gateway.ts`, `src/services/`.

- [ ] LOOP-BROWSER-007: Structured content scraper (CF `/scrape` + selector schema)
  - Why: Extract typed fields (headings, contacts, hours, services) from competitor/source pages.
  - Acceptance criteria: `scrape(url, selectors)` maps CSS/AI selectors → typed object validated by caller-supplied Zod schema; returns partial + confidence per field; graceful on missing nodes.
  - Implementation notes: Prefer CF REST `/scrape` with element selectors; escalate to Stagehand extract for semantic fields (LOOP-BROWSER-014).
  - Hosting notes: CF Workers.
  - Backing services: CF Browser Rendering.
  - Observability: log field-fill rate; Tinybird scrape quality.
  - Dependencies: LOOP-BROWSER-001.
  - Related files: `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-008: Snapshot screenshot capture for site versions
  - Why: Site snapshots feature needs proof-of-state thumbnails per published version.
  - Acceptance criteria: On `site.publish`, capture full-page screenshot of `{slug}.projectsites.dev`, store at `browser/{tenant}/{site}/snapshots/{version}.png`, link in snapshot record; viewable in admin.
  - Implementation notes: Triggered by publish event; reuse LOOP-BROWSER-004 (1280 + mobile); attach to existing snapshot D1 row.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, R2, D1.
  - Observability: Tinybird snapshot-capture event, Sentry on miss.
  - Dependencies: LOOP-BROWSER-001, 003, 004.
  - Related files: `src/services/site_serving.ts`, `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-009: OG-image renderer (per-route social cards 1200×630)
  - Why: Every generated site route needs an accurate OG image; render from live DOM or template.
  - Acceptance criteria: `renderOgImage(url|template)` returns 1200×630 PNG/WebP in R2; deterministic fonts; cache-keyed by route+content hash; served via `/og/{slug}/{route}`.
  - Implementation notes: CF REST `/screenshot` with clip 1200×630 over a dedicated OG template route; fallback to template HTML when live route unsuitable.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, R2, KV (cache).
  - Observability: log cache hit ratio.
  - Dependencies: LOOP-BROWSER-001, 003.
  - Related files: `src/routes/`, `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-010: PDF generation (proposals, invoices, site exports)
  - Why: Customers want printable site/section exports and the platform needs PDF receipts.
  - Acceptance criteria: `renderPdf(url|html, {format, margins})` returns PDF in R2; supports header/footer + page numbers; A4/Letter; deterministic output.
  - Implementation notes: CF REST `/pdf` (or binding `page.pdf`); inject print CSS; sign output URL.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, R2.
  - Observability: Axiom log size/timing.
  - Dependencies: LOOP-BROWSER-001, 003.
  - Related files: `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-011: Lighthouse / Core Web Vitals audit runner
  - Why: Post-deploy quality gate (LCP/CLS/INP, Perf/A11y/SEO scores) for generated sites.
  - Acceptance criteria: `auditCwv(url)` returns structured scores + opportunities; fails gate when Perf<75 or A11y<95; results stored + trended.
  - Implementation notes: Run Lighthouse via CF Browser Rendering binding (programmatic) — if not feasible on CF, route to Fly persistent pool with stated reason (needs decision); store JSON in R2, metrics in Tinybird.
  - Hosting notes: CF Workers first; Fly fallback ONLY if Lighthouse can't run on CF Browser Rendering (rare, documented).
  - Backing services: CF Browser Rendering (or Fly), R2, Tinybird.
  - Observability: Tinybird `cwv_runs`, Sentry on threshold breach.
  - Dependencies: LOOP-BROWSER-001.
  - Related files: `src/services/browser_gateway.ts`, `src/workflows/`.

- [ ] LOOP-BROWSER-012: Accessibility audit (axe-core injection) per route + 6bp
  - Why: WCAG 2.2 AA / ADA Title II gate; zero violations across breakpoints.
  - Acceptance criteria: `auditAxe(url, breakpoint)` injects axe-core, returns violations with nodes/impact; aggregates across 6 breakpoints; fails on any serious/critical.
  - Implementation notes: Binding-based (need DOM script injection); inject `axe.min.js`, run `axe.run()`, serialize results.
  - Hosting notes: CF Workers + CF Browser Rendering binding.
  - Backing services: CF Browser Rendering, R2 (reports).
  - Observability: Tinybird violation counts by rule, Sentry on critical.
  - Dependencies: LOOP-BROWSER-001, 004.
  - Related files: `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-013: Broken-link & status checker for live customer sites
  - Why: Detect 4xx/5xx/dead outbound links before customers notice.
  - Acceptance criteria: `checkLinks(url)` crawls internal links + HEAD-checks outbound, returns broken list with source page + anchor; respects robots; rate-limited.
  - Implementation notes: Reuse crawler (005); HEAD with GET fallback; dedup external hosts + per-host throttle.
  - Hosting notes: CF Workers.
  - Backing services: CF Browser Rendering / fetch, D1 (findings).
  - Observability: Tinybird broken-link trend, notification on new breakage.
  - Dependencies: LOOP-BROWSER-005, 006.
  - Related files: `src/services/browser_gateway.ts`, `src/services/notifications.ts`.

- [ ] LOOP-BROWSER-014: Stagehand AI-driven step layer (act / extract / observe)
  - Why: Semantic actions ("click pricing", "extract hours") that brittle selectors can't express.
  - Acceptance criteria: `agentic(url, instructions[])` runs Stagehand `act/extract/observe` over CF Browser Rendering session; returns typed results; every step traced; bounded step budget + timeout.
  - Implementation notes: Stagehand on CF Browser Rendering binding; model routing via existing LLM tiering; cap steps; idempotent re-runs.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, Langfuse (AI traces), LLM provider.
  - Observability: Langfuse trace per step, Axiom step log, Sentry on failure.
  - Dependencies: LOOP-BROWSER-001.
  - Related files: `src/services/browser_gateway.ts`, `src/lib/`.

- [ ] LOOP-BROWSER-015: Form-fill & login-flow automation for E2E auth journeys
  - Why: Prod E2E and customer-site checks must exercise authed flows (magic link, OAuth, forms).
  - Acceptance criteria: `runFlow(steps)` fills forms + submits + asserts post-state via Stagehand/Playwright; mocked accounts only (`MOCK_USER_*`); screenshots each step to R2.
  - Implementation notes: Combine binding Playwright for deterministic steps + Stagehand for semantic steps; never use real credentials.
  - Hosting notes: CF Workers + CF Browser Rendering; Browserbase fallback when proxy/managed session needed.
  - Backing services: CF Browser Rendering, Browserbase (fallback), R2.
  - Observability: Langfuse (agentic steps), Axiom flow log.
  - Dependencies: LOOP-BROWSER-001, 014.
  - Related files: `src/services/browser_gateway.ts`, `e2e/`.

- [ ] LOOP-BROWSER-016: Post-deploy prod E2E harness against real URLs
  - Why: Verification-loop mandate — every deploy fetches changed routes and asserts live content.
  - Acceptance criteria: `verifyDeploy(routes[])` loads each prod route, asserts H1/status/JSON-LD/headers, captures screenshot, console-error-free; emits pass/fail report.
  - Implementation notes: CF Browser Rendering binding for navigation + console capture; assert `crossOriginIsolated`/headers where relevant; integrate into deploy gate.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, R2, Tinybird.
  - Observability: Tinybird deploy-verify results, Sentry on fail.
  - Dependencies: LOOP-BROWSER-001, 004.
  - Related files: `src/services/browser_gateway.ts`, `.github/workflows/`.

- [ ] LOOP-BROWSER-017: Scheduled visual regression (pixel-diff vs baselines)
  - Why: Catch unintended visual drift on generated/customer sites between deploys.
  - Acceptance criteria: Cron captures current screenshots, diffs vs R2 baselines (pixelmatch 0.1%/0.5% area), flags regressions, stores diff image; baseline-approve path in admin.
  - Implementation notes: Reuse responsive capture (004); store baselines durable, candidates ephemeral; pixelmatch in Worker (WASM) or compute step.
  - Hosting notes: CF Workers + Cron Triggers.
  - Backing services: CF Browser Rendering, R2, D1 (baseline registry).
  - Observability: Tinybird regression count, notification on diff.
  - Dependencies: LOOP-BROWSER-004, 003, 020.
  - Related files: `src/services/browser_gateway.ts`, `wrangler.toml` (triggers).

- [ ] LOOP-BROWSER-018: Long-running crawl/audit as a CF Workflow
  - Why: Full-site crawls + audits exceed a single Worker invocation; need durable, resumable orchestration.
  - Acceptance criteria: `BrowserWorkflow` chunks pages into steps, persists progress, retries with backoff, emits `browser.job.*` events; resumable after failure; bounded total budget.
  - Implementation notes: CF Workflows v2; each step = one page capture/scrape; checkpoint inventory to R2 between steps.
  - Hosting notes: CF Workers + Workflows.
  - Backing services: CF Workflows, CF Browser Rendering, R2.
  - Observability: event-sourced progress, Axiom step logs, Sentry on step fail.
  - Dependencies: LOOP-BROWSER-005, 011.
  - Related files: `src/workflows/`, `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-019: Browserbase managed-fallback adapter (session/replay/proxy)
  - Why: Some jobs (geo-proxy, captcha-prone, session replay for debugging) need a managed cloud browser; CF can't always cover.
  - Acceptance criteria: `BrowserbaseAdapter` opens session, runs job, returns replay URL + artifacts; used ONLY when `resolveProvider` picks `browserbase`; never the default path.
  - Implementation notes: HTTP boundary to Browserbase API; declare request/response shapes locally; key via get-secret.
  - Hosting notes: CF Workers orchestrate; Browserbase runs the browser.
  - Backing services: Browserbase, R2.
  - Observability: log fallback reason + session id, Sentry on fail.
  - Dependencies: LOOP-BROWSER-002.
  - Related files: `src/services/browser_gateway.ts`, `src/services/`.

- [ ] LOOP-BROWSER-020: Customer-site uptime + screenshot-proof monitor
  - Why: Prove customer sites are up with a timestamped visual, not just a 200.
  - Acceptance criteria: Cron polls each active site, records status + load time + screenshot; on downtime fires notification with last-good vs current shot; SLA dashboard data.
  - Implementation notes: Visibility-aware scheduling; throttle per site; store latest screenshot durable, history ephemeral.
  - Hosting notes: CF Workers + Cron Triggers.
  - Backing services: CF Browser Rendering, R2, D1, Tinybird.
  - Observability: Tinybird uptime series, notification on state change.
  - Dependencies: LOOP-BROWSER-004, 003.
  - Related files: `src/services/browser_gateway.ts`, `src/services/notifications.ts`.

- [ ] LOOP-BROWSER-021: Brand asset extraction — favicon + logo from source site
  - Why: Rebuild pipeline needs the source brand's favicon and logo to seed the new site.
  - Acceptance criteria: `extractBrandAssets(url)` finds favicon (link rels + `/favicon.ico`), largest header `<img>`/SVG logo, downloads to R2, returns dimensions + format; handles missing gracefully.
  - Implementation notes: Parse DOM via CF `/content`; rank logo candidates by header position + size; SVG preferred.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, R2.
  - Observability: log assets found vs missing.
  - Dependencies: LOOP-BROWSER-001, 007.
  - Related files: `src/services/image_discovery.ts`, `src/services/browser_gateway.ts`.

- [ ] LOOP-BROWSER-022: Brand-color extraction via vision over a rendered screenshot
  - Why: Seed `_brand.json` palette from the actual rendered source site, not guessed CSS.
  - Acceptance criteria: Capture full-page screenshot → vision model returns dominant palette (primary/accent/bg/ink) as OKLCH + hex with confidence; validated by Zod; stored on site brand record.
  - Implementation notes: Reuse screenshot (004); vision via existing LLM tiering; cross-check against extracted CSS custom properties.
  - Hosting notes: CF Workers + CF Browser Rendering.
  - Backing services: CF Browser Rendering, vision LLM, Langfuse, D1.
  - Observability: Langfuse trace, log palette + confidence.
  - Dependencies: LOOP-BROWSER-004.
  - Related files: `src/services/image_discovery.ts`, `src/services/build_context.ts`.

- [ ] LOOP-BROWSER-023: Competitor crawl + 100-pt rubric capture for build floor
  - Why: Competitor-research gate needs screenshots + structured signals from peer sites to set the scoring floor.
  - Acceptance criteria: `crawlCompetitor(url)` captures homepage + key routes screenshots, scrapes copy/IA signals, runs CWV + axe, emits `_competitors/{host}/_score.json` inputs; respects robots + realistic UA.
  - Implementation notes: Compose crawler (005) + screenshot (004) + audits (011/012); aggregate to MAX-per-dim floor.
  - Hosting notes: CF Workers + Workflow for multi-route.
  - Backing services: CF Browser Rendering, R2, Tinybird.
  - Observability: Tinybird competitor-capture events.
  - Dependencies: LOOP-BROWSER-005, 011, 012.
  - Related files: `src/services/browser_gateway.ts`, `src/services/openai_research.ts`.

- [ ] LOOP-BROWSER-024: Skyvern internal-only escalation behind CF Access
  - Why: Hardest agentic jobs (complex multi-page auth, anti-bot) may need Skyvern — but it must never be the product default.
  - Acceptance criteria: `SkyvernAdapter` reachable only when `resolveProvider` returns `skyvern` AND request carries valid CF Access JWT for `skyvern.megabyte.space`; rejects external/tenant-facing callers; returns artifacts to R2.
  - Implementation criteria notes: HTTP boundary to internal Skyvern; service-token (non_identity) auth; verify CF Access assertion; gated by internal feature flag.
  - Hosting notes: CF Workers orchestrate; Skyvern internal host behind CF Access.
  - Backing services: Skyvern (internal), CF Access, R2, Langfuse.
  - Observability: Axiom log with operator id, Sentry on fail, Langfuse trace.
  - Dependencies: LOOP-BROWSER-002, 014.
  - Related files: `src/services/browser_gateway.ts`, `src/middleware/auth.ts`.

## jobs.projectsites.dev — Workflows + Queues + Inngest + Hatchet

### Raw research themes considered

Surveyed ~50 raw themes across four engine classes and folded them to the 24 highest-leverage, programmable wins. Engine selection follows a hard rubric: CF Workflows for multi-step durable sagas that live on the edge (site-generation, snapshots, billing recon); CF Queues for high-throughput fan-out with backpressure (email sends, webhook delivery, media batches) — but Queues are NOT yet enabled on the account, so a typed dispatcher must transparently fall back to Workflows until the binding lands (needs decision: enable Queues on plan); Inngest (LIVE, self-hosted CF Container) for event-driven step functions and human-in-the-loop drip/wait-for-event flows; Hatchet only where a Postgres-backed durable task queue with priority lanes and DAG concurrency is genuinely required (container build orchestration, long report generation) — and because Hatchet must stay warm 24/7 with a Neon Postgres, Fly.io is the justified host. Cross-cutting flagships: a typed job-envelope + idempotency-key + DLQ primitive that every engine routes through, mandatory correlation IDs (tenant_id, site_id, app_id, trace_id, job_id, request_id), and an /admin job-observability cockpit fed by Tinybird/Axiom. Crons stay monitoring-only per doctrine — every recurring business action is a durable workflow triggered by a thin cron, never business logic in the cron itself.

### Selected 24 implementation tasks

- [ ] LOOP-JOBS-001: Typed job-envelope + idempotency-key + DLQ primitive (flagship)
  - Why: Every async task today is engine-specific; no shared contract for retries, dedup, or dead-lettering. This is the foundation all other tasks depend on.
  - Acceptance criteria: `JobEnvelope` Zod schema (`job_id`, `idempotency_key`, `job_class`, `payload`, `attempt`, `max_attempts`, `correlation` block, `created_at`, `not_before`); `enqueue(env, envelope)` dispatcher picks engine by `job_class`; duplicate `idempotency_key` within TTL is a no-op returning the prior `job_id`; exhausted retries land in a `job_dlq` D1 table with last error + full envelope; unit tests cover dedup, retry exhaustion, DLQ write.
  - Implementation notes: `packages/shared/src/schemas/job.ts` for the schema; `apps/project-sites/src/services/jobs/dispatcher.ts` for routing; idempotency ledger in D1 (`job_idempotency` table, key+expires_at) with KV hot-cache (60s).
  - Hosting notes: CF Worker (edge); DLQ in D1.
  - Backing services: D1 (ledger + DLQ), KV (dedup cache).
  - Observability: emit `job.enqueued`/`job.deduped`/`job.dead_lettered` to event_bus → Tinybird; Axiom structured log per dispatch.
  - Dependencies: none (foundation).
  - Related files: `packages/shared/src/schemas/job.ts`, `apps/project-sites/src/services/jobs/dispatcher.ts`, `apps/project-sites/src/services/db.ts`.

- [ ] LOOP-JOBS-002: Engine-selection router with transparent Queues→Workflows fallback
  - Why: Queues binding is optional/not-enabled; code must run identically whether Queues exist, and pick Workflows/Inngest/Hatchet by job class without callers knowing.
  - Acceptance criteria: `selectEngine(jobClass, env)` returns `'queue'|'workflow'|'inngest'|'hatchet'`; when `env.QUEUE` is undefined, queue-class jobs route to a single-step Workflow; matrix table documents class→engine; tests assert fallback path when binding absent.
  - Implementation notes: keep the mapping in one typed const (`JOB_CLASS_ENGINE`); never branch on engine in business code.
  - Hosting notes: CF Worker.
  - Backing services: Workflows, Queues (when enabled).
  - Observability: log chosen engine + reason field.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/services/jobs/engine-select.ts`, `apps/project-sites/wrangler.toml`.

- [ ] LOOP-JOBS-003: Universal retry+backoff+jitter policy with circuit breaker
  - Why: Retries are ad-hoc across existing workflows; need one tested policy (exponential + full jitter) plus per-target circuit breaking to stop hammering a down upstream.
  - Acceptance criteria: `nextDelay(attempt, policy)` returns exponential-with-jitter capped at policy max; per-target breaker (open/half-open/closed) in DO state; breaker-open returns fast-fail without consuming an attempt; unit tests on delay distribution + breaker transitions.
  - Implementation notes: breaker state in a `CircuitBreakerDO` keyed by upstream id; share with media/webhook tasks.
  - Hosting notes: CF Worker + Durable Object.
  - Backing services: Durable Objects.
  - Observability: `job.retry`/`breaker.opened`/`breaker.closed` events with attempt + delay.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/services/jobs/retry.ts`, `apps/project-sites/src/durable/circuit-breaker.ts`.

- [ ] LOOP-JOBS-004: Migrate site-generation to envelope-wrapped durable Workflow
  - Why: `SITE_WORKFLOW` predates the envelope; wrap it so it carries correlation IDs, idempotency, and DLQ on failure like every other job.
  - Acceptance criteria: workflow entry accepts a `JobEnvelope`; each `step.do` is named + idempotent; failure after max attempts writes DLQ + notifies; existing E2E for generation still green; correlation IDs threaded into every step log.
  - Implementation notes: minimal refactor — adapter at the workflow boundary, no rewrite of generation logic.
  - Hosting notes: CF Workflows (edge-native, already bound).
  - Backing services: Workflows, D1, R2.
  - Observability: per-step duration + status to Tinybird; Sentry (platform) on terminal failure.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/workflows/site-generation.ts`.

- [ ] LOOP-JOBS-005: Email send queue with provider failover (Resend→SendGrid)
  - Why: Magic-link/transactional sends are synchronous and fragile; a queue gives retry, rate-limit smoothing, and automatic provider failover.
  - Acceptance criteria: `email.send` job class; consumer tries Resend then SendGrid on 5xx/timeout; idempotency_key = message hash prevents double-send; bounce/complaint feedback recorded; DLQ on dual-provider failure; tests mock both providers incl. failover.
  - Implementation notes: Queues when enabled, else Workflow fallback (LOOP-JOBS-002); reuse `notifications` service sender.
  - Hosting notes: CF Worker consumer.
  - Backing services: Queues/Workflows, Resend, SendGrid, D1 (send ledger).
  - Observability: `email.sent`/`email.failover`/`email.failed` to Tinybird; Axiom log with provider + latency.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-003.
  - Related files: `apps/project-sites/src/services/notifications.ts`, `apps/project-sites/src/services/jobs/consumers/email.ts`.

- [ ] LOOP-JOBS-006: Outbound webhook delivery with retry + HMAC + Hookdeck/Outpost
  - Why: Tenant-facing outbound webhooks need signed payloads, retry ladders, and per-endpoint backoff; Outpost is the durable outbound delivery layer.
  - Acceptance criteria: `webhook.deliver` job; HMAC-SHA256 signature + timestamp header; retry ladder (1m,5m,30m,2h,12h) then DLQ; per-endpoint circuit breaker; redelivery endpoint from DLQ; tests cover signature + retry exhaustion.
  - Implementation notes: route through Outpost where configured (needs decision: Outpost self-host vs SaaS); native fallback consumer otherwise.
  - Hosting notes: CF Worker; Outpost container if adopted.
  - Backing services: Queues/Workflows, R2 (dead-letter bodies), Hookdeck/Outpost.
  - Observability: delivery attempts + response codes to Tinybird; `webhook.delivered`/`webhook.dead`.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-003.
  - Related files: `apps/project-sites/src/services/jobs/consumers/webhook-out.ts`, `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-JOBS-007: Inbound webhook ingest hardening (Stripe/SES/SNS) via Hookdeck
  - Why: Bot Fight Mode challenges inbound M2M webhooks; need a workers.dev/Hookdeck receiver that verifies signatures, dedups, and enqueues an envelope instead of processing inline.
  - Acceptance criteria: receiver verifies provider signature, dedups by event id (idempotency ledger), enqueues `webhook.process` envelope, returns 2xx fast; replay-safe; tests cover Stripe + SES signature paths + duplicate suppression.
  - Implementation notes: host receiver on workers.dev to bypass BFM (per memory); Hookdeck in front for retry visibility.
  - Hosting notes: CF Worker on workers.dev route.
  - Backing services: Hookdeck, D1 (event ledger), Queues/Workflows.
  - Observability: `webhook.received`/`webhook.duplicate` to Tinybird; Sentry on verification failure.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/routes/webhooks.ts`, `apps/project-sites/src/services/webhook.ts`.

- [ ] LOOP-JOBS-008: Async media generation fan-out workflow (images/video/audio)
  - Why: Image/video/audio generation per site is slow and rate-limited; needs fan-out with bounded concurrency and per-asset retry, separate from page generation.
  - Acceptance criteria: parent workflow fans out N `media.generate` child jobs; bounded concurrency (cost-aware, see LOOP-JOBS-009); each asset idempotent on (site_id, asset_key); partial failure does not fail the whole batch; results written to R2 + indexed in D1; tests cover partial-failure + resume.
  - Implementation notes: extend `IMAGE_GENERATION_WORKFLOW`; Replicate/Workers-AI providers behind a typed media client.
  - Hosting notes: CF Workflows (fan-out), Replicate for heavy models.
  - Backing services: Workflows, R2, Replicate, Workers AI.
  - Observability: per-asset latency + cost to Tinybird; Langfuse trace for AI calls.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-009.
  - Related files: `apps/project-sites/src/workflows/image-generation` (existing), `apps/project-sites/src/services/image_generation.ts`.

- [ ] LOOP-JOBS-009: Cost-aware concurrency limiter (per-tenant + per-upstream)
  - Why: Unbounded fan-out blows AI/media budgets and trips upstream rate limits; need a DO-backed token/credit limiter scoped per tenant and per upstream.
  - Acceptance criteria: `acquire(scope, cost)`/`release` against a DO sliding window + monthly budget; over-budget jobs are deferred (`not_before`) not dropped; per-tenant fairness so one tenant can't starve others; tests cover budget exhaustion + fairness.
  - Implementation notes: `ConcurrencyDO` keyed by scope; budgets from entitlements/plan caps.
  - Hosting notes: CF Worker + Durable Object; Upstash for global counters if DO sharding insufficient (needs decision).
  - Backing services: Durable Objects, Upstash Redis (optional global counters).
  - Observability: `job.throttled`/`budget.exceeded` to Tinybird; budget gauge per tenant.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/durable/concurrency.ts`, `packages/shared/src/constants` (CAPS).

- [ ] LOOP-JOBS-010: Billing reconciliation job (Stripe ↔ D1 entitlements)
  - Why: Webhooks can be missed; a periodic durable recon catches drift between Stripe subscription state and D1 entitlements/plan caps.
  - Acceptance criteria: thin cron triggers a `billing.reconcile` workflow (cron = trigger only, logic in workflow); pulls Stripe subscriptions, diffs vs D1, emits a report of corrections, applies idempotent fixes behind a dry-run flag; tests cover added/removed/changed subscription cases.
  - Implementation notes: cron stays monitoring-only — it merely kicks the workflow; all logic in the durable step.
  - Hosting notes: CF Workflows; CF Cron Trigger as kicker.
  - Backing services: Workflows, Stripe, D1.
  - Observability: drift count + corrections to Tinybird; Sentry on apply failure.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/services/billing.ts`, `apps/project-sites/src/workflows/billing-reconcile.ts`.

- [ ] LOOP-JOBS-011: Drip / lifecycle campaign engine (Inngest step functions)
  - Why: Onboarding drips and re-engagement need durable wait-for-duration + wait-for-event semantics — Inngest's native strength, already LIVE.
  - Acceptance criteria: define drip flows as Inngest functions with `step.sleep` + `step.waitForEvent` (cancel on conversion); per-user idempotent enrollment; unsubscribe halts flow; tests via Inngest dev-server cover sleep, wait, and cancel-on-event.
  - Implementation notes: Inngest at events.projectsites.dev; `inngest start` key MUST be pure hex (per memory).
  - Hosting notes: Inngest self-hosted on CF Container DO.
  - Backing services: Inngest, D1 (enrollment), Resend (sends via LOOP-JOBS-005).
  - Observability: step completion to Tinybird; Inngest run history.
  - Dependencies: LOOP-JOBS-005.
  - Related files: `apps/project-sites/src/inngest/drip.ts`.

- [ ] LOOP-JOBS-012: Social-post scheduling jobs (Postiz publish via SOCIAL_PUBLISH_WORKFLOW)
  - Why: Scheduled social posts need durable at-time execution with per-platform retry; existing workflow needs envelope + schedule store.
  - Acceptance criteria: schedule a post at `not_before`; durable wait then publish via Postiz HTTP client; per-platform retry + partial success (one platform fails, others succeed); cancel/edit before send; tests cover schedule, partial failure, cancel.
  - Implementation notes: AGPL Postiz stays behind HTTP boundary (no shared types) per isolation rule.
  - Hosting notes: CF Workflows; Postiz on Fly (existing).
  - Backing services: Workflows, D1 (schedule), Postiz (HTTP).
  - Observability: `social.published`/`social.failed` per platform to Tinybird.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-003.
  - Related files: `apps/project-sites/src/workflows/social-publish` (existing), `apps/project-sites/src/services/postiz.ts`.

- [ ] LOOP-JOBS-013: Scheduled site re-crawl + freshness workflow
  - Why: Generated sites drift from source; a scheduled re-crawl detects changed source content and queues regeneration of affected sections.
  - Acceptance criteria: thin cron kicks `site.recrawl` workflow per site on a freshness cadence; diff vs last snapshot; only changed sections enqueue regeneration; throttled per tenant; tests cover no-change (no-op) vs changed (enqueues).
  - Implementation notes: reuse CF Browser Rendering for crawl (no Docker) per memory.
  - Hosting notes: CF Workflows + Browser Rendering binding.
  - Backing services: Workflows, R2 (snapshots), D1, Browser Rendering.
  - Observability: change-detected ratio to Tinybird.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-009.
  - Related files: `apps/project-sites/src/workflows/site-recrawl.ts`, `apps/project-sites/src/services/site_serving.ts`.

- [ ] LOOP-JOBS-014: Snapshot + quality-gate workflow hardening
  - Why: `SNAPSHOT_QUALITY_WORKFLOW` exists but needs envelope wrapping, idempotency, and DLQ so failed snapshots are recoverable, not silently lost.
  - Acceptance criteria: snapshot job idempotent on (site_id, version); quality gate (Lighthouse/axe via Browser Rendering) runs as a step; failing gate blocks publish + notifies; DLQ on capture failure; tests cover gate pass/fail.
  - Implementation notes: store snapshot artifacts in R2 with version path `sites/{slug}/{version}/`.
  - Hosting notes: CF Workflows + Browser Rendering.
  - Backing services: Workflows, R2, Browser Rendering.
  - Observability: quality scores to Tinybird; Sentry on capture error.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/workflows/snapshot-quality` (existing).

- [ ] LOOP-JOBS-015: Snapshot-revert / rollback job (D1 Time Travel + R2 versioning)
  - Why: Rollback must be a durable, audited operation — restore a prior site version atomically across R2 + D1 pointers.
  - Acceptance criteria: `site.revert` workflow takes (site_id, target_version); flips R2 + D1 current-version pointer atomically; idempotent (re-running to same version is a no-op); audit row written; tests cover revert + double-revert no-op.
  - Implementation notes: no destructive deletes — old versions retained for re-revert.
  - Hosting notes: CF Workflows.
  - Backing services: Workflows, R2 (versioned), D1.
  - Observability: `site.reverted` audit event to Tinybird; admin notification.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-014.
  - Related files: `apps/project-sites/src/workflows/site-revert.ts`, `apps/project-sites/src/services/audit.ts`.

- [ ] LOOP-JOBS-016: Human-in-the-loop task inbox (approval gates in workflows)
  - Why: Some flows (publish approval, refund approval, flagged content) must pause for a human decision before continuing — needs a durable wait-for-approval primitive + inbox UI.
  - Acceptance criteria: workflow `step.waitForEvent('task.approved'|'task.rejected')`; pending tasks surface in an /admin inbox with deep-link + correlation context; timeout auto-escalates or auto-rejects; tests cover approve, reject, timeout.
  - Implementation notes: pairs with psnotify inbox (custom notifications, NO Novu per memory) for the surface.
  - Hosting notes: Inngest (wait-for-event) + CF Worker API.
  - Backing services: Inngest, D1 (task store), psnotify.
  - Observability: `task.created`/`task.resolved` + time-to-decision to Tinybird.
  - Dependencies: LOOP-JOBS-011.
  - Related files: `apps/project-sites/src/inngest/approval.ts`, `apps/project-sites/src/routes/api.ts` (task inbox).

- [ ] LOOP-JOBS-017: Report generation jobs (long-running, Hatchet on Fly)
  - Why: Tenant analytics/PDF reports can run minutes and need priority lanes + DAG steps — beyond Workflows' edge wall-clock comfort; Hatchet's Postgres-backed queue with concurrency lanes fits.
  - Acceptance criteria: `report.generate` submitted to Hatchet; multi-step DAG (gather→render→store→notify); priority lane so interactive reports preempt batch; result PDF to R2 + signed link emailed; tests via Hatchet local against fixtures.
  - Implementation notes: Hatchet needs Postgres=Neon and 24/7 warmth → Fly.io is the justified host (CF Containers can't guarantee always-warm for a queue engine). (needs decision: confirm Hatchet adoption vs deferring to Inngest steps for v1.)
  - Hosting notes: Hatchet engine on Fly.io; Neon Postgres backing.
  - Backing services: Hatchet, Neon, R2, Resend.
  - Observability: stage durations to Tinybird; Sentry on render failure.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/services/jobs/hatchet-client.ts`, infra Hatchet deploy.

- [ ] LOOP-JOBS-018: Long-running container build orchestration (Hatchet)
  - Why: Container/site builds that exceed Worker limits need an external durable orchestrator with cancellation + log streaming — Hatchet's task-queue + worker model.
  - Acceptance criteria: `build.run` Hatchet task spawns/monitors a build, streams logs to R2/Axiom, supports cancel, retries transient failures only (not deterministic compile errors); DLQ on terminal failure; tests cover success, cancel, transient-retry.
  - Implementation notes: distinguish retryable (network/OOM) vs non-retryable (compile) errors in the envelope policy.
  - Hosting notes: Hatchet on Fly.io (justified: long-lived, Postgres-backed); build runners as needed.
  - Backing services: Hatchet, Neon, R2, Axiom.
  - Observability: build status + duration to Tinybird; log stream to Axiom.
  - Dependencies: LOOP-JOBS-017, LOOP-JOBS-003.
  - Related files: `apps/project-sites/src/services/jobs/builds.ts`.

- [ ] LOOP-JOBS-019: Data export jobs (GDPR/account export, R2 + signed URL)
  - Why: Users/tenants need full-data exports; these are large, async, and must be idempotent + expiring-link delivered.
  - Acceptance criteria: `data.export` workflow gathers tenant data across D1/R2, packages to a zip in R2, emits an expiring signed URL via email; idempotent per (tenant_id, request_id); export auto-expires + is purged by cleanup job; tests cover package + expiry.
  - Implementation notes: stream to R2 to avoid memory blowups; redact secrets per shared `redact` util.
  - Hosting notes: CF Workflows (or Hatchet if export size demands long runtime).
  - Backing services: Workflows, R2, D1, Resend.
  - Observability: export size + duration to Tinybird; audit event.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-005.
  - Related files: `apps/project-sites/src/workflows/data-export.ts`, `packages/shared/src/utils/redact.ts`.

- [ ] LOOP-JOBS-020: Cleanup / GC jobs (expired exports, orphaned R2, stale idempotency)
  - Why: DLQ rows, expired exports, orphaned R2 objects, and stale idempotency ledger entries accumulate; periodic GC keeps storage + tables bounded.
  - Acceptance criteria: thin cron kicks `system.cleanup` workflow; deletes expired exports, R2 objects with no D1 referent (after grace window), idempotency rows past TTL, resolved DLQ rows past retention; dry-run flag; tests cover each sweep with a fixture that must NOT be deleted (referenced) and one that must.
  - Implementation notes: cleanup is reversible-safe (grace window + soft-delete first) to avoid nuking live assets.
  - Hosting notes: CF Workflows; Cron Trigger as kicker (monitoring-only doctrine).
  - Backing services: Workflows, R2, D1.
  - Observability: bytes/rows reclaimed to Tinybird.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-019.
  - Related files: `apps/project-sites/src/workflows/system-cleanup.ts`.

- [ ] LOOP-JOBS-021: DLQ management API + admin replay/redrive UI
  - Why: Dead-lettered jobs are useless without inspection + one-click redrive; operators need to see payload, error, attempts, and replay or discard.
  - Acceptance criteria: API to list/filter DLQ by job_class/tenant/date; view full envelope + last error; redrive (re-enqueue with reset attempts) and discard with audit; replayed jobs keep original correlation IDs; tests cover list, redrive (idempotent), discard.
  - Implementation notes: redrive routes back through the LOOP-JOBS-001 dispatcher so dedup still applies.
  - Hosting notes: CF Worker API + Angular /admin section.
  - Backing services: D1 (job_dlq), Queues/Workflows.
  - Observability: `dlq.redriven`/`dlq.discarded` audit to Tinybird.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-022.
  - Related files: `apps/project-sites/src/routes/api.ts` (jobs admin), `apps/project-sites/frontend` admin section.

- [ ] LOOP-JOBS-022: Job-observability cockpit in /admin (Tinybird + Axiom backed)
  - Why: No single pane shows job throughput, failure rate, DLQ depth, retry storms, or per-tenant cost; operators fly blind across four engines.
  - Acceptance criteria: /admin/jobs cockpit (cyan/black) shows per-class throughput, success/fail/retry rates, DLQ depth, p50/p95 latency, in-flight count, cost; data from Tinybird endpoints; auto-refresh pauses when tab hidden (visibility-aware polling per project pattern); E2E from homepage → admin → jobs asserts widgets render.
  - Implementation notes: feed off the `job.*` event stream into Tinybird datasources + endpoints.
  - Hosting notes: CF Worker API + Angular admin.
  - Backing services: Tinybird (OLAP), Axiom (logs), D1.
  - Observability: this IS the observability surface; itself instrumented.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-024.
  - Related files: `apps/project-sites/frontend` admin jobs section, `apps/project-sites/src/services/tinybird.ts`.

- [ ] LOOP-JOBS-023: Scheduled HTTP callbacks via Upstash QStash (timer offload)
  - Why: Some delayed actions are simple HTTP callbacks that don't need a full workflow; QStash gives durable scheduled/delayed HTTP delivery with retries, offloading timer state.
  - Acceptance criteria: `scheduleCallback(url, payload, runAt)` publishes to QStash; receiver verifies QStash signature + dedups via idempotency ledger; QStash DLQ surfaced in admin; tests cover schedule + signature verification + duplicate suppression.
  - Implementation notes: use QStash only for fire-at-time HTTP nudges; multi-step logic stays in Workflows/Inngest. (needs decision: QStash vs Workflow `step.sleep` per cost.)
  - Hosting notes: CF Worker receiver; QStash managed.
  - Backing services: Upstash QStash, D1 (idempotency).
  - Observability: callback delivery to Tinybird; QStash DLQ poll.
  - Dependencies: LOOP-JOBS-001, LOOP-JOBS-007.
  - Related files: `apps/project-sites/src/services/jobs/qstash.ts`, `apps/project-sites/src/routes/webhooks.ts`.

- [ ] LOOP-JOBS-024: Correlation-ID propagation + structured job tracing across engines
  - Why: A job that hops Worker→Workflow→Inngest→Hatchet must carry one trace; mandatory IDs (tenant_id, site_id, app_id, trace_id, job_id, request_id) must survive every boundary or observability is useless.
  - Acceptance criteria: `correlation` block is required in `JobEnvelope` and injected into every log line, Tinybird event, Sentry breadcrumb, and Langfuse trace; cross-engine handoff preserves trace_id (new span, same trace); a lint/test gate fails if a job emits a log/event without the block; tests assert propagation Worker→Workflow→Inngest.
  - Implementation notes: thin tracing helper wraps all engine entry points; feed_bus enrichment adds the block automatically.
  - Hosting notes: CF Worker + all engines.
  - Backing services: Axiom, Sentry (platform only), Tinybird, Langfuse.
  - Observability: this enforces observability — drift gate prevents un-correlated jobs.
  - Dependencies: LOOP-JOBS-001.
  - Related files: `apps/project-sites/src/services/jobs/trace.ts`, `apps/project-sites/src/services/analytics.ts`.

## docs.projectsites.dev — Scalar + Stainless

### Raw research themes considered

Swept ~50 developer-experience themes across the public-API surface: OpenAPI-as-SSOT derived from Zod (`@asteasolutions/zod-to-openapi` + `hono-openapi`), Scalar interactive reference, Stainless multi-language SDK codegen, try-it console scoped to Unkey keys, versioned/dated docs, API changelog, error-code + rate-limit reference, webhook + MCP docs, getting-started + auth guides, embeddable widget, search, dark theme, SDK release automation (npm/PyPI/Go), broken-link + freshness CI gates, ADR/runbook hosting, and docs-page analytics. Discarded as out-of-scope or vendor-violating: ReadMe/Mintlify/Docusaurus migrations (Scalar is decided), GitBook, ClickHouse-backed analytics (Tinybird only), Algolia/self-hosted search where Scalar/Pagefind suffices, and any Fly-hosted docs runtime (CF Workers/R2 only here). The flagship reusable spine is the **Zod → OpenAPI → Scalar (UI) → Stainless (SDKs)** pipeline — every other task hangs off that single derived spec so the docs and SDKs can never drift from the live API. Selection biased toward solo-founder-practical, CI-automatable, CF-native tasks that compound (one spec build feeds reference, SDKs, link-checks, and freshness gates).

### Selected 24 implementation tasks

- [ ] LOOP-DOCS-001: Zod→OpenAPI spec builder as the single source of truth
  - Why: Hand-maintained OpenAPI rots; deriving it from the Zod schemas that already validate `api.projectsites.dev` guarantees docs and SDKs match runtime behavior.
  - Acceptance criteria: `npm run docs:openapi` emits `apps/project-sites/openapi/openapi.json` (3.1) from `@asteasolutions/zod-to-openapi` registry; every public `/api/v1/*` route's Zod request/response is registered; build fails if any public route lacks a registered schema.
  - Implementation notes: Wrap existing `packages/shared/src/schemas/*` in `extendZodWithOpenApi`; add `.openapi()` metadata (descriptions, examples) at the schema level so it flows everywhere downstream.
  - Hosting notes: Spec artifact committed + uploaded to `R2 project-sites-production/docs/openapi/openapi.json`; served at `docs.projectsites.dev/openapi.json` via Worker.
  - Backing services: CF R2 (artifact), CF Workers (serve).
  - Observability: PostHog event `docs_openapi_built` with route_count; Sentry (platform) on build failure.
  - Dependencies: none (spine root).
  - Related files: `packages/shared/src/schemas/api.ts`, `apps/project-sites/openapi/build-openapi.ts`, `apps/project-sites/scripts/docs-openapi.mjs`.

- [ ] LOOP-DOCS-002: Serve live OpenAPI via hono-openapi on the API worker
  - Why: A runtime-served spec (not just a build artifact) lets Scalar, Stainless, and external tools always fetch the current contract for the deployed version.
  - Acceptance criteria: `GET api.projectsites.dev/openapi.json` returns the 3.1 spec with correct `servers`, `info.version` (from package version), and Unkey security scheme; 200 + `application/json`; ETag + 60s cache.
  - Implementation notes: Mount `hono-openapi` describing the same registry from LOOP-DOCS-001; assert the served spec deep-equals the committed artifact in CI (drift gate).
  - Hosting notes: Lives on the existing `api.projectsites.dev` Worker; WAF MCP-skip rule already exempts `/api/*` paths.
  - Backing services: CF Workers.
  - Observability: Axiom log line `openapi_served` with version + tenant_id/request_id; PostHog `docs_openapi_fetched`.
  - Dependencies: LOOP-DOCS-001.
  - Related files: `apps/project-sites/src/routes/openapi.ts`, `apps/project-sites/src/index.ts`.

- [ ] LOOP-DOCS-003: Scalar interactive reference UI hosted on docs.projectsites.dev
  - Why: Scalar is the decided docs UI; it renders the OpenAPI spec as a searchable, dark-themed, try-it reference — the public face of the API.
  - Acceptance criteria: `docs.projectsites.dev` loads Scalar reference bound to `/openapi.json`; all endpoints listed with grouped tags; dark theme default; Lighthouse a11y ≥95; 200 on prod.
  - Implementation notes: Static HTML shell embedding `@scalar/api-reference` CDN/bundled asset, configured `theme: 'default'` dark + brand tokens (`#060610`, `#00E5FF`); build step injects the spec URL.
  - Hosting notes: Static bundle in `R2 project-sites-production/docs/` served by a thin `docs.projectsites.dev` Worker route (CF Workers/R2 — no Fly).
  - Backing services: CF R2 + Workers.
  - Observability: PostHog Cloud autocapture for docs pageviews + endpoint clicks.
  - Dependencies: LOOP-DOCS-001, LOOP-DOCS-002.
  - Related files: `apps/project-sites/docs-site/index.html`, `apps/project-sites/docs-site/scalar.config.ts`, `wrangler.toml` (docs route).

- [ ] LOOP-DOCS-004: docs.projectsites.dev DNS + Worker route + custom domain
  - Why: A first-class docs subdomain needs proxied DNS, TLS, and a route that beats the `*.projectsites.dev/*` wildcard (per Listmonk incident).
  - Acceptance criteria: `docs.projectsites.dev` resolves, TLS valid, explicit `docs.projectsites.dev/*` route in wrangler.toml with `workers_dev = true` fallback; `curl -s -o /dev/null -w '%{http_code}'` returns 200.
  - Implementation notes: Add DNS record + custom_domain route via CF API (global key); explicit host route, not relying on wildcard.
  - Hosting notes: CF Workers custom domain on zone `9ceaa211750dd31899fd5d1bf8d1ec46`.
  - Backing services: CF DNS, CF Workers.
  - Observability: Synthetic uptime check (cron) hitting `/` + `/openapi.json`.
  - Dependencies: LOOP-DOCS-003.
  - Related files: `apps/project-sites/wrangler.toml`.

- [ ] LOOP-DOCS-005: Stainless SDK config + generation pipeline (TS, Python, Go)
  - Why: Stainless is the decided codegen; typed SDKs from the OpenAPI spec are the highest-leverage DX win for API consumers.
  - Acceptance criteria: `stainless.yml` committed; `npm run sdk:gen` produces TS, Python, Go SDK source from the spec; CI artifact uploaded; generation fails the build on spec errors.
  - Implementation notes: Configure Stainless project mapping resources→endpoints, package names (`@projectsites/sdk`, `projectsites`, `projectsites-go`); Unkey bearer auth in client config. (needs decision: Stainless org/project provisioning + API token in get-secret as `STAINLESS_API_KEY`).
  - Hosting notes: Generation runs in GitHub Actions; SDK repos pushed to GitHub (Stainless-managed).
  - Backing services: Stainless (CI), GitHub.
  - Observability: Axiom CI log `sdk_generated` per language; Sentry on gen failure.
  - Dependencies: LOOP-DOCS-001.
  - Related files: `apps/project-sites/stainless.yml`, `.github/workflows/sdk-generate.yml`.

- [ ] LOOP-DOCS-006: SDK release automation → npm + PyPI + Go module publish
  - Why: Generated SDKs only deliver value when published and versioned; automation removes the solo-founder release toil.
  - Acceptance criteria: Tagging `sdk-vX.Y.Z` publishes TS to npm, Python to PyPI, and pushes a Go module tag; release notes auto-generated from the API changelog; idempotent (re-run safe).
  - Implementation notes: Stainless release flow or `semantic-release` per package; version derived from `info.version`; secrets `NPM_TOKEN`/`PYPI_TOKEN` via get-secret.
  - Hosting notes: GitHub Actions publish; packages live on npm/PyPI/proxy.golang.org.
  - Backing services: npm, PyPI, GitHub.
  - Observability: PostHog `sdk_published` with lang+version; Axiom CI logs.
  - Dependencies: LOOP-DOCS-005.
  - Related files: `.github/workflows/sdk-release.yml`.

- [ ] LOOP-DOCS-007: API changelog generated from OpenAPI spec diff
  - Why: Consumers need to know what changed per version; diffing successive specs yields an accurate, automatable changelog.
  - Acceptance criteria: On each spec build, `oasdiff` compares against the last published spec; categorized (breaking/non-breaking/added) entries appended to `docs/CHANGELOG-API.md`; rendered as a Scalar changelog page.
  - Implementation notes: Store prior spec in R2 (`docs/openapi/versions/<version>.json`); run `oasdiff changelog`; breaking changes flag the PR.
  - Hosting notes: Changelog page in the docs bundle on R2/Workers.
  - Backing services: CF R2.
  - Observability: PostHog `api_changelog_viewed`; CI annotation listing breaking changes.
  - Dependencies: LOOP-DOCS-001.
  - Related files: `apps/project-sites/scripts/api-changelog.mjs`, `docs/CHANGELOG-API.md`.

- [ ] LOOP-DOCS-008: Versioned / dated docs snapshots in R2
  - Why: API consumers pin to versions; preserving dated spec + reference snapshots lets them read the docs for the version they integrated against.
  - Acceptance criteria: Each release writes `docs/openapi/versions/<semver>.json` + a routed `docs.projectsites.dev/v/<semver>/` reference; version switcher in Scalar header; old versions remain reachable.
  - Implementation notes: Immutable R2 keys per version; latest aliases to current; sitemap lists all versions.
  - Hosting notes: CF R2 keyed by version, served via Worker path routing.
  - Backing services: CF R2 + Workers.
  - Observability: PostHog `docs_version_selected`.
  - Dependencies: LOOP-DOCS-003, LOOP-DOCS-007.
  - Related files: `apps/project-sites/docs-site/version-switcher.ts`.

- [ ] LOOP-DOCS-009: Try-it console scoped to a user's Unkey key
  - Why: A live console that uses the developer's real (or sandbox) Unkey key turns docs into onboarding; reduces time-to-first-call.
  - Acceptance criteria: Scalar try-it sends requests with the user's pasted key as `Authorization: Bearer`; key never persisted server-side; CORS allows console origin; failed-auth shows the error-code reference inline.
  - Implementation notes: Default `servers` to a sandbox base; warn before live mutations; rate-limit headers surfaced in the response panel.
  - Hosting notes: Pure client-side in the docs bundle; no proxy (direct browser→`api.projectsites.dev`).
  - Backing services: Unkey (key validation at API), CF Workers.
  - Observability: PostHog `tryit_request` with endpoint + status (no key logged).
  - Dependencies: LOOP-DOCS-003, LOOP-DOCS-016.
  - Related files: `apps/project-sites/docs-site/tryit.ts`.

- [ ] LOOP-DOCS-010: Per-endpoint code samples in every SDK language
  - Why: Copy-paste samples in TS/Python/Go/cURL for each endpoint are the single most-used docs feature.
  - Acceptance criteria: Each Scalar operation shows tabs for cURL + 3 SDK languages using the generated SDK method names; samples derive from the spec + Stainless method mapping (no hand-authoring); samples compile in a smoke check.
  - Implementation notes: Pull `x-codeSamples` injected from Stainless output into the OpenAPI spec post-gen; cURL auto-derived by Scalar.
  - Hosting notes: Embedded in the spec served from R2.
  - Backing services: Stainless, CF R2.
  - Observability: PostHog `code_sample_copied` with lang.
  - Dependencies: LOOP-DOCS-005, LOOP-DOCS-001.
  - Related files: `apps/project-sites/scripts/inject-code-samples.mjs`.

- [ ] LOOP-DOCS-011: Getting-started + authentication guide (MDX)
  - Why: New developers need a narrative path (create key → first request → handle errors) beyond the raw reference.
  - Acceptance criteria: `/getting-started` and `/authentication` guide pages render in the docs site, dark-themed; auth guide explains Unkey key creation, bearer usage, rotation; Flesch ≥50; all internal links valid.
  - Implementation notes: Author as MD/MDX compiled to static HTML in the docs bundle; cross-link to try-it.
  - Hosting notes: Static pages in R2 docs bundle.
  - Backing services: CF R2 + Workers.
  - Observability: PostHog `guide_viewed` with slug; scroll-depth.
  - Dependencies: LOOP-DOCS-003, LOOP-DOCS-016.
  - Related files: `apps/project-sites/docs-site/guides/getting-started.md`, `.../authentication.md`.

- [ ] LOOP-DOCS-012: Webhook documentation derived from event Zod schemas
  - Why: The platform emits webhooks (Hookdeck+Outpost); consumers need typed payload docs + signature-verification guidance.
  - Acceptance criteria: Every webhook event type documented from its Zod schema (payload shape, example, headers); signature-verification snippet per SDK language; rendered under a `/webhooks` section; OpenAPI `webhooks` block populated.
  - Implementation notes: Reuse `packages/shared/src/schemas/webhook.ts`; register under OpenAPI 3.1 `webhooks`; document Hookdeck delivery + retry semantics.
  - Hosting notes: Part of the spec + docs bundle.
  - Backing services: Hookdeck + Outpost (delivery), CF R2.
  - Observability: PostHog `webhook_docs_viewed`.
  - Dependencies: LOOP-DOCS-001.
  - Related files: `packages/shared/src/schemas/webhook.ts`, `apps/project-sites/docs-site/guides/webhooks.md`.

- [ ] LOOP-DOCS-013: MCP server documentation page
  - Why: The platform exposes MCP (OAuth provider built; `/api/mcp/*`); developers integrating agents need tool catalog + auth docs.
  - Acceptance criteria: `/mcp` page lists every MCP tool (name, description, Zod input/output), the OAuth 2.1 connect flow, and the paste-key fallback; tool list generated from the server's ListTools manifest (no drift).
  - Implementation notes: Generate the tool table from the live MCP server definition; document `mcp_oauth_provider` flag + WAF skip behavior.
  - Hosting notes: Static page in docs bundle, regenerated on MCP changes.
  - Backing services: CF Workers (MCP), CF R2.
  - Observability: PostHog `mcp_docs_viewed`.
  - Dependencies: LOOP-DOCS-003.
  - Related files: `apps/project-sites/docs-site/guides/mcp.md`, `apps/project-sites/scripts/gen-mcp-doc.mjs`.

- [ ] LOOP-DOCS-014: Error-code reference generated from the error taxonomy
  - Why: The CLAUDE.md mandates a central error taxonomy + RFC7807 envelopes; a reference page lets consumers handle each `code` deterministically.
  - Acceptance criteria: `/errors` page lists every stable `code`, HTTP status, category, retry policy, and user-safe message, generated from the taxonomy module; each try-it/SDK error links to its entry.
  - Implementation notes: Source from the existing error taxonomy/`problem+json` definitions in `packages/shared/src/utils/errors.ts`; emit as a table + JSON for SDKs.
  - Hosting notes: Static page + `errors.json` artifact in R2.
  - Backing services: CF R2.
  - Observability: PostHog `error_ref_viewed` with code.
  - Dependencies: LOOP-DOCS-001.
  - Related files: `packages/shared/src/utils/errors.ts`, `apps/project-sites/scripts/gen-error-ref.mjs`.

- [ ] LOOP-DOCS-015: Rate-limit documentation + live header reference
  - Why: Unkey/DO-based rate limiting is enforced; consumers need to know limits, headers, and backoff to build resilient clients.
  - Acceptance criteria: `/rate-limits` documents per-plan limits, `X-RateLimit-*`/`Retry-After` headers, and recommended backoff; try-it surfaces the live limit headers; SDK retry behavior documented.
  - Implementation notes: Pull limit values from the plan/entitlements constants (SSOT); document DO-counter enforcement (managed RL is plan-gated/no-op).
  - Hosting notes: Static page in docs bundle.
  - Backing services: Unkey + CF DO (enforcement).
  - Observability: PostHog `rate_limit_docs_viewed`.
  - Dependencies: LOOP-DOCS-009, LOOP-DOCS-011.
  - Related files: `packages/shared/src/constants/` (CAPS/ENTITLEMENTS), `apps/project-sites/docs-site/guides/rate-limits.md`.

- [ ] LOOP-DOCS-016: Customer onboarding flow — key creation + first call quickstart
  - Why: The fastest activation is a guided "create key → make a call → see a 200" loop; ties docs to real Unkey provisioning.
  - Acceptance criteria: `/quickstart` walks key creation (links to the admin key UI), shows a one-call cURL/SDK snippet pre-filled, and confirms success; activation event fires on first authenticated call.
  - Implementation notes: Deep-link to the Unkey-backed key issuance in `/admin`; pre-fill snippet with a placeholder key; surface the request_id for support.
  - Hosting notes: Static page in docs bundle; admin key UI in the main app.
  - Backing services: Unkey, CF Workers.
  - Observability: PostHog activation funnel `key_created → first_call_200`; Tinybird event for activation analytics.
  - Dependencies: LOOP-DOCS-009, LOOP-DOCS-011.
  - Related files: `apps/project-sites/docs-site/guides/quickstart.md`.

- [ ] LOOP-DOCS-017: Integration guides (per-platform recipes)
  - Why: Task-oriented guides ("integrate with X", "build a Y") convert better than reference pages and capture long-tail SEO/AEO.
  - Acceptance criteria: ≥3 integration guides (e.g. Workers, Node server, Python script) each with end-to-end runnable code using the published SDK; all snippets smoke-tested in CI; valid internal links.
  - Implementation notes: Reuse generated SDK methods; keep guides in `docs-site/guides/integrations/`; one canonical file per integration (folder hygiene ≤10).
  - Hosting notes: Static pages in R2 docs bundle.
  - Backing services: CF R2; published SDKs.
  - Observability: PostHog `integration_guide_viewed` with slug.
  - Dependencies: LOOP-DOCS-006, LOOP-DOCS-010.
  - Related files: `apps/project-sites/docs-site/guides/integrations/*.md`.

- [ ] LOOP-DOCS-018: Embeddable docs widget (script-tag reference embed)
  - Why: Lets partner sites/admin surfaces embed a scoped API reference or a single-endpoint try-it without leaving their page.
  - Acceptance criteria: `<script src="docs.projectsites.dev/embed.js" data-endpoint="...">` mounts a Scalar mini-reference for the named tag/endpoint; CSP-safe; loads <50KB initial; works cross-origin.
  - Implementation notes: Bundle a lightweight embed that fetches `/openapi.json` and renders a filtered slice; expose `data-tag`/`data-theme` attrs.
  - Hosting notes: `embed.js` served from R2/Workers with long cache + version hash.
  - Backing services: CF R2 + Workers.
  - Observability: PostHog `docs_embed_loaded` with host origin.
  - Dependencies: LOOP-DOCS-003.
  - Related files: `apps/project-sites/docs-site/embed/embed.ts`.

- [ ] LOOP-DOCS-019: Docs search (client-side index over reference + guides)
  - Why: Search is the primary docs navigation; must cover both the OpenAPI reference and the prose guides.
  - Acceptance criteria: `Cmd/Ctrl-K` opens search; indexes endpoints, schemas, guides, error codes; returns ranked results <100ms; keyboard-navigable; a11y-clean.
  - Implementation notes: Build a Pagefind/Scalar-native index at docs-build time over rendered HTML + spec; no external search vendor (no Algolia). (needs decision: Pagefind vs Scalar built-in search if sufficient.)
  - Hosting notes: Static index files in R2 docs bundle.
  - Backing services: CF R2.
  - Observability: PostHog `docs_search` with query + result_count (PII-safe).
  - Dependencies: LOOP-DOCS-003, LOOP-DOCS-011.
  - Related files: `apps/project-sites/docs-site/search/index-build.mjs`.

- [ ] LOOP-DOCS-020: CI gate — OpenAPI spec validation + breaking-change detection
  - Why: An invalid or accidentally-breaking spec corrupts every downstream artifact (reference, SDKs, samples); gate it at the door.
  - Acceptance criteria: CI runs Redocly/Spectral lint on `openapi.json` (0 errors) + `oasdiff breaking` vs the last published spec; breaking changes block merge unless a `breaking-change-approved` label is present.
  - Implementation notes: Wire into `.github/workflows/docs-ci.yml`; Spectral ruleset enforces descriptions/examples/operationIds.
  - Hosting notes: GitHub Actions; no runtime hosting.
  - Backing services: GitHub Actions.
  - Observability: Axiom CI log `spec_lint`; PR annotations for each violation.
  - Dependencies: LOOP-DOCS-001, LOOP-DOCS-007.
  - Related files: `.github/workflows/docs-ci.yml`, `.spectral.yaml`.

- [ ] LOOP-DOCS-021: CI gate — broken-link + dead-anchor checker
  - Why: Broken links are the most common docs-rot symptom and a Hard-Gate item; catch them before deploy.
  - Acceptance criteria: CI crawls the built docs bundle (internal links, anchors, code-sample URLs) with `lychee`; any 4xx/5xx or dead anchor fails the build; external links checked weekly (non-blocking).
  - Implementation notes: Run against the static build output pre-upload; allowlist known-flaky external hosts.
  - Hosting notes: GitHub Actions over the build artifact.
  - Backing services: GitHub Actions.
  - Observability: Axiom CI log `link_check` with broken_count.
  - Dependencies: LOOP-DOCS-003, LOOP-DOCS-011.
  - Related files: `.github/workflows/docs-ci.yml`, `lychee.toml`.

- [ ] LOOP-DOCS-022: Docs freshness check — flag stale guides + undocumented endpoints
  - Why: Guides drift from the API; a freshness gate keeps prose aligned with the spec and surfaces endpoints lacking narrative docs.
  - Acceptance criteria: A check fails (warn-level) when a guide's `last_reviewed` frontmatter is >90 days old or when an OpenAPI operationId has no guide/sample reference; report lists stale + undocumented items.
  - Implementation notes: Parse frontmatter + cross-reference operationIds against guide content; emit a markdown report artifact.
  - Hosting notes: GitHub Actions; report uploaded as CI artifact.
  - Backing services: GitHub Actions.
  - Observability: PostHog `docs_freshness_report` with stale_count; Axiom CI log.
  - Dependencies: LOOP-DOCS-001, LOOP-DOCS-017.
  - Related files: `apps/project-sites/scripts/docs-freshness.mjs`.

- [ ] LOOP-DOCS-023: ADR + runbook hosting under docs (internal/architecture section)
  - Why: Architecture decisions and operational runbooks belong in one canonical, searchable place alongside the API docs for the solo founder + future agents.
  - Acceptance criteria: `docs/decisions/*.md` (ADRs) and runbooks render under a gated `/internal` section (basic-auth or CF Access); indexed by search; one canonical file per ADR; linked from the changelog where relevant.
  - Implementation notes: Reuse existing `docs/decisions/` (e.g. voice-architecture.md); protect with CF Access service policy; never expose secrets.
  - Hosting notes: CF Workers route with CF Access in front of `/internal`.
  - Backing services: CF Access, CF R2 + Workers.
  - Observability: Axiom access logs (cf-access-jwt assertion); PostHog excluded for gated pages.
  - Dependencies: LOOP-DOCS-004, LOOP-DOCS-019.
  - Related files: `docs/decisions/*.md`, `apps/project-sites/docs-site/internal/`.

- [ ] LOOP-DOCS-024: Docs analytics + try-it conversion dashboard (PostHog + Tinybird)
  - Why: Knowing which endpoints, guides, and samples drive activation tells the solo founder where to invest docs effort.
  - Acceptance criteria: PostHog dashboard tracks docs pageviews, search queries, code-sample copies, and try-it→first-call conversion; Tinybird pipe `projectsites_events` ingests docs events for OLAP funnels; activation funnel (`docs_view → key_created → first_call_200`) is queryable.
  - Implementation notes: Emit docs events to the `event_bus` (source `docs`) → Tinybird; PostHog Cloud for page-level; NEVER ClickHouse.
  - Hosting notes: PostHog Cloud (US) + Tinybird; events flow from the docs Worker.
  - Backing services: PostHog Cloud, Tinybird.
  - Observability: This task IS the observability surface; correlation via tenant_id + api_key_id + request_id.
  - Dependencies: LOOP-DOCS-009, LOOP-DOCS-016, LOOP-DOCS-019.
  - Related files: `apps/project-sites/src/services/tinybird.ts`, `apps/project-sites/docs-site/analytics.ts`.

## links.projectsites.dev — Dub

### Raw research themes considered

Surveyed ~50 raw themes across two scopes: (1) **platform attribution** — a reusable end-to-end primitive that stitches every funnel hop (short link → site claim → Twenty CRM lead → Stripe customer) with a stable `click_id` carried through cookies, claim records, and webhook payloads; and (2) a **customer-facing link shortener** so site-owners get branded short links, QR codes, UTM builders, link-in-bio pages, and click analytics on their own vanity domains. Dub (OSS, Next.js + Postgres + Redis + Tinybird + R2) is the engine — its **native Tinybird click pipeline** aligns perfectly with our ALWAYS-Tinybird OLAP rule, so we lean into Dub's `dub_click_events` datasource rather than reinvent ingestion. Self-host on **CF Workers Containers** (Neon Postgres `projectsites_dub`, Upstash Redis, R2 asset/QR storage); Fly only if a 24/7 stateful component emerges. Cross-cutting concerns: outbound link wrapping from Postiz (social) + Listmonk (email) for attribution, click-fraud filtering before clicks count as conversions, geo/device/A-B targeting, expiration + password + cloaking controls, bulk + API creation, and an `/admin` analytics dashboard. Correlation IDs `tenant_id, site_id, app_id, link_id, click_id, request_id` thread through every hop into Axiom (logs), Sentry (platform errors only), PostHog (product analytics), and Hookdeck+Outpost (webhook ingress/egress).

### Selected 24 implementation tasks

- [ ] LOOP-LINKS-001: Self-host Dub on CF Workers Containers (`links.projectsites.dev`)
  - Why: Owning the link engine is the precondition for every attribution + shortener feature; OSS self-host keeps cost flat and data in our stack.
  - Acceptance criteria: `links.projectsites.dev` 200 on `/api/health`; container DO boots Next.js + worker; a test link redirects with 302 and logs a click row in Tinybird; deploy is CI-driven on amd64.
  - Implementation notes: Dub is Next.js — multi-stage Dockerfile, `node:22-bookworm-slim` final stage, mkdir `/dev/shm` in entrypoint (CF Containers have none → silent crash). Pin `--platform=linux/amd64`, build on CI (cross-built arm64 image exits on CF). Per-host route `links.projectsites.dev/*` beats the `*.projectsites.dev/*` wildcard.
  - Hosting notes: CF Workers Container DO (AIO single DO); Fly only if a 24/7 worker (cron/queue consumer) cannot live in the DO — state the reason if so.
  - Backing services: Neon Postgres `projectsites_dub` (new DB in shared project, not new project), Upstash Redis, Tinybird (clicks), R2 (`projectsites-dub-assets` for QR + favicons).
  - Observability: Axiom log drain on the container; Sentry platform DSN (never client-site); container boot + redirect latency traced with `request_id`.
  - Dependencies: none (foundational).
  - Related files: `containers/dub/Dockerfile`, `wrangler.toml` (route + container binding), `apps/project-sites/src/services/dub.ts` (HTTP client).

- [ ] LOOP-LINKS-002: Dub Tinybird click pipeline wired to our workspace
  - Why: Dub natively emits clicks to Tinybird — adopting it directly satisfies the ALWAYS-Tinybird rule and gives us OLAP click analytics for free.
  - Acceptance criteria: Dub's `dub_click_events` datasource lives in OUR Tinybird workspace; a redirect produces a row within 5s; an endpoint `clicks_by_link` returns aggregated counts by `link_id`.
  - Implementation notes: Point Dub's `TINYBIRD_API_KEY` + `TINYBIRD_API_URL` at our workspace; do NOT spin a separate ClickHouse (banned). Mirror enriched fields (`tenant_id`, `site_id`) into the click payload via Dub link `tags`/`externalId`.
  - Hosting notes: Tinybird Cloud (managed); no container.
  - Backing services: Tinybird datasources + pipes; Neon for link metadata join.
  - Observability: Tinybird ingestion lag alarmed in Axiom; PostHog `link_click_ingested` sampled.
  - Dependencies: LOOP-LINKS-001.
  - Related files: `infra/tinybird/dub/*.datasource`, `infra/tinybird/dub/clicks_by_link.pipe`, container env.

- [ ] LOOP-LINKS-003: HTTP-only Dub client in the worker (`services/dub.ts`)
  - Why: AGPL/license + clean-boundary discipline — the worker talks to Dub over HTTP only, never imports Dub packages or shares its Postgres schema.
  - Acceptance criteria: `createLink`, `getLink`, `listLinks`, `getClicks`, `deleteLink` typed methods; all request/response shapes declared locally with Zod; zero `@dub/*` deps in `package.json`.
  - Implementation notes: Bearer `DUB_API_KEY`; re-declare shapes (no shared types). `mcpFetch`-style wrapper: try/catch, gate on `res.ok`, typed error subclasses, size guard.
  - Hosting notes: runs in the main worker (Hono), not the container.
  - Backing services: Dub API over HTTPS.
  - Observability: every call logged with `link_id` + `request_id`; Sentry on non-2xx.
  - Dependencies: LOOP-LINKS-001.
  - Related files: `apps/project-sites/src/services/dub.ts`, `packages/shared/src/schemas/links.ts`.

- [ ] LOOP-LINKS-004: `click_id` attribution cookie + redirect interception
  - Why: The flagship primitive — a stable click identity that survives the hop from short link to the customer's site so every later event can be tied back to its source.
  - Acceptance criteria: Visiting a wrapped link sets a first-party `ps_click` cookie (signed, 90-day) carrying `click_id`; the value is readable on the destination site; tampered cookies are rejected.
  - Implementation notes: Dub's `?dub_id` / `dclid` param → on the destination worker, capture and set signed httpOnly+readable split cookie. HMAC with `LINK_COOKIE_SECRET`. Honor DNT / consent flag.
  - Hosting notes: worker edge (every site response middleware).
  - Backing services: KV for short-lived click→link reverse lookup (60s TTL).
  - Observability: `attribution.cookie_set` event with `click_id`, `site_id`.
  - Dependencies: LOOP-LINKS-002, LOOP-LINKS-003.
  - Related files: `src/middleware/attribution.ts`, `src/services/site_serving.ts`.

- [ ] LOOP-LINKS-005: Link → site-claim attribution join
  - Why: First conversion hop — connect an anonymous click to a known site claim so we can credit the originating campaign.
  - Acceptance criteria: When a visitor claims/generates a site, the `ps_click` cookie's `click_id` is persisted on the claim row; `claims_by_source` Tinybird endpoint attributes claims to `link_id`/UTM.
  - Implementation notes: Reuse existing `claims_by_source` Tinybird endpoint; add `click_id` + `link_id` columns to the claim event. Backfill NULL for organic.
  - Hosting notes: worker.
  - Backing services: D1 (claim record), Tinybird (event), event_bus.
  - Observability: `claim.attributed` with full correlation tuple.
  - Dependencies: LOOP-LINKS-004.
  - Related files: `src/routes/api.ts` (claim handler), `src/services/build_context.ts`.

- [ ] LOOP-LINKS-006: Link → Twenty CRM lead attribution
  - Why: Second conversion hop — the originating link must ride into the CRM so sales sees which campaign produced the lead.
  - Acceptance criteria: A lead created in Twenty carries custom fields `source_link_id`, `source_click_id`, `utm_*`; visible on the Company/Lead record; falls back gracefully when attribution is absent.
  - Implementation notes: Extend existing Lead Scanner→Twenty flow; Twenty REST 400s on unknown fields → create custom fields via metadata API first (known gotcha). Map from claim row's `click_id`.
  - Hosting notes: worker → Twenty container HTTP.
  - Backing services: Twenty (CRM), Neon (Dub) for link lookup.
  - Observability: `lead.attributed`; Sentry on metadata-field mismatch.
  - Dependencies: LOOP-LINKS-005.
  - Related files: `src/services/twenty.ts` (or crm service), `libs/features/lead_attribution/`.

- [ ] LOOP-LINKS-007: Link → Stripe customer attribution close-loop
  - Why: Final hop — closing click→claim→lead→**paying customer** makes ROI-per-link a real, reportable number.
  - Acceptance criteria: On `checkout.session.completed`, the customer's originating `link_id`/`click_id` (from claim/lead lineage) is stamped on the subscription metadata; a `revenue_by_link` Tinybird endpoint returns MRR by source link.
  - Implementation notes: Resolve lineage at checkout via the org's earliest attributed claim; write to Stripe customer + subscription metadata; emit revenue event to Tinybird.
  - Hosting notes: worker (Stripe webhook on workers.dev receiver to bypass Bot Fight Mode).
  - Backing services: Stripe, Tinybird, Neon.
  - Observability: `revenue.attributed`; correlation tuple complete.
  - Dependencies: LOOP-LINKS-006.
  - Related files: `src/routes/webhooks.ts`, `src/services/billing.ts`, `infra/tinybird/dub/revenue_by_link.pipe`.

- [ ] LOOP-LINKS-008: Outbound link wrapping for Postiz (social) + Listmonk (email)
  - Why: Every link we publish through social posts and newsletters must be attributable; auto-wrapping closes the biggest attribution leak.
  - Acceptance criteria: A Postiz post or Listmonk campaign body has its bare URLs rewritten to `links.projectsites.dev/<key>` before send; clicks attribute to the originating channel (`app_id=postiz|listmonk`) and campaign.
  - Implementation notes: Pre-send hook calls `dub.createLink` with `tags=[channel, campaign_id]`; idempotent on (url, campaign). For Listmonk, transform at template-render. Skip already-wrapped + unsubscribe links.
  - Hosting notes: worker hook invoked by Postiz/Listmonk webhooks (Hookdeck ingress).
  - Backing services: Dub, Hookdeck+Outpost, Neon.
  - Observability: `link.wrapped` with `app_id`, `campaign_id`.
  - Dependencies: LOOP-LINKS-003.
  - Related files: `src/services/postiz.ts`, `src/services/link_wrapper.ts`.

- [ ] LOOP-LINKS-009: Customer-facing link shortener feature module (`libs/features/link_shortener`)
  - Why: Turn the engine into a product surface — site-owners create branded short links from `/admin`, behind a flag, as a complete feature module.
  - Acceptance criteria: Module ships `manifest.ts` (7 fields), Zod schemas, API handlers, Angular UI, E2E spec dir, flag `link_shortener` (experimental, 0%); create/list/edit/delete works tenant-scoped.
  - Implementation notes: Org-scoped via `c.get('orgId')` (never client `x-org-id` — IDOR). Calls `services/dub.ts`. UI uses `DialogShellComponent`, cyan/black tokens.
  - Hosting notes: worker + Angular admin.
  - Backing services: Dub, D1 (flag), feature_flags.
  - Observability: Sentry breadcrumbs + logs tagged `featureSlug=link_shortener`.
  - Dependencies: LOOP-LINKS-003.
  - Related files: `libs/features/link_shortener/{manifest,schemas,handlers}.ts`, `e2e/link_shortener/`.

- [ ] LOOP-LINKS-010: QR code generation + R2 storage
  - Why: Branded QR codes turn any short link into a print/physical channel — high-value for local-SMB site owners.
  - Acceptance criteria: `GET /api/links/:id/qr?format=svg|png&logo=1` returns a branded QR; PNG cached in R2 (`qr/<link_id>.png`); regenerates on link edit; CRM/print-ready.
  - Implementation notes: Use Dub's native QR endpoint where available, else generate server-side; embed site logo center; cache + ETag. Click via QR still carries `click_id`.
  - Hosting notes: worker; container only if heavy raster lib needed (decide — prefer worker-side SVG).
  - Backing services: R2, Dub.
  - Observability: `qr.generated`; cache hit ratio to Axiom.
  - Dependencies: LOOP-LINKS-009.
  - Related files: `src/routes/api.ts` (qr handler), `src/services/qr.ts`.

- [ ] LOOP-LINKS-011: UTM builder UI + canonical UTM schema
  - Why: Consistent UTMs are the backbone of attribution reporting; a guided builder prevents the typo-driven fragmentation that breaks campaign rollups.
  - Acceptance criteria: Admin form composes `utm_source/medium/campaign/term/content` with validation + presets; generated link stores UTMs as Dub link metadata; preview shows the final URL.
  - Implementation notes: Zod-validated UTM schema in `packages/shared`; preset library per channel; lowercase-normalize to avoid `Email`/`email` splits.
  - Hosting notes: Angular admin + worker validation.
  - Backing services: Dub (link metadata), D1.
  - Observability: `utm.link_created` with normalized params.
  - Dependencies: LOOP-LINKS-009.
  - Related files: `packages/shared/src/schemas/utm.ts`, `libs/features/link_shortener/utm-builder.component.ts`.

- [ ] LOOP-LINKS-012: Click analytics dashboard in `/admin`
  - Why: Owners and operators need a visual readout of clicks, sources, geo, and devices — the payoff surface for all the ingestion work.
  - Acceptance criteria: `/admin/links` renders clicks-over-time, top links, geo map, device split, referrer table from Tinybird endpoints; respects tenant scope; visibility-aware polling.
  - Implementation notes: Consume `clicks_by_link` + new `clicks_by_geo`/`clicks_by_device` Tinybird endpoints via worker proxy (no client Tinybird token). `<app-rolling-counter>` for totals; `appReveal` sections.
  - Hosting notes: Angular admin + worker proxy.
  - Backing services: Tinybird, D1.
  - Observability: dashboard load traced; PostHog `links_dashboard_viewed`.
  - Dependencies: LOOP-LINKS-002, LOOP-LINKS-009.
  - Related files: `frontend admin/sections/links/`, `src/routes/api.ts` (analytics proxy).

- [ ] LOOP-LINKS-013: Per-customer vanity domains
  - Why: Branded short domains (e.g. `go.acme.com`) materially lift click-through and trust for site owners on paid tiers.
  - Acceptance criteria: Owner adds a custom domain; we provision CF DNS + TLS via API and register it in Dub; links mint on the vanity domain; verification status surfaced in UI.
  - Implementation notes: Use Dub's domain API + CF zone/record API (global key, pre-stage on pending zone). Gate on plan entitlement. Verify CNAME before activation.
  - Hosting notes: worker + Dub container; CF DNS API.
  - Backing services: Dub, Cloudflare DNS/TLS, D1 (domain records).
  - Observability: `vanity_domain.verified`; Sentry on provisioning failure.
  - Dependencies: LOOP-LINKS-009.
  - Related files: `src/services/domains.ts`, `libs/features/link_shortener/domains.component.ts`.

- [ ] LOOP-LINKS-014: Bulk link creation (CSV import + API)
  - Why: Agencies and campaign-heavy owners need to mint hundreds of links at once; manual one-by-one is a non-starter.
  - Acceptance criteria: Upload CSV (url, key?, utm fields, tags) → batched `dub.createLink` with per-row validation report; partial success allowed; downloadable result with short URLs + errors.
  - Implementation notes: Stream-parse CSV in worker; chunk to Dub bulk endpoint; idempotency key per row; cap rows by plan. Dead-letter failures to R2.
  - Hosting notes: worker; long jobs via Queue/Workflow if >subrequest budget (decide based on volume).
  - Backing services: Dub, R2 (result + dead-letter), D1.
  - Observability: `links.bulk_created` with success/fail counts.
  - Dependencies: LOOP-LINKS-003, LOOP-LINKS-011.
  - Related files: `src/routes/api.ts` (bulk handler), `src/services/link_bulk.ts`.

- [ ] LOOP-LINKS-015: Public Links API + scoped API keys
  - Why: Programmatic link creation lets owners integrate shortening into their own tools and our partners build on top — a platform multiplier.
  - Acceptance criteria: `POST/GET/DELETE /api/v1/links` authenticated by tenant-scoped key (Unkey); rate-limited; OpenAPI documented; returns RFC7807 errors.
  - Implementation notes: Issue keys via Unkey (api.projectsites.dev) scoped to org; proxy to `services/dub.ts`. Semantic per-feature paths — no umbrella `/api/allstar/*`.
  - Hosting notes: worker (Hono), Unkey container for verification.
  - Backing services: Unkey, Dub, Tinybird.
  - Observability: per-key usage to Tinybird; Axiom request logs with `tenant_id`.
  - Dependencies: LOOP-LINKS-003.
  - Related files: `src/routes/api/links.ts`, `openapi/links.yaml`.

- [ ] LOOP-LINKS-016: Link-in-bio pages
  - Why: A hosted bio page is a self-contained marketing surface for owners' social profiles and a natural attribution funnel entry.
  - Acceptance criteria: Owner builds a `bio.<vanity>/<handle>` page with ordered links, avatar, theme; each link is a tracked short link; page served fast at edge; SSG-cached.
  - Implementation notes: Use Dub's link-in-bio if present, else our own Angular/SSG page reading Dub links by tag. Every outbound link carries `click_id`. Brand-token themes.
  - Hosting notes: worker SSG + R2; Dub for link resolution.
  - Backing services: Dub, R2, KV (host resolution).
  - Observability: `bio_page.viewed`, per-link clicks.
  - Dependencies: LOOP-LINKS-009, LOOP-LINKS-013.
  - Related files: `libs/features/link_in_bio/`, `src/services/site_serving.ts`.

- [ ] LOOP-LINKS-017: A/B link splits (rotator)
  - Why: Split-testing destinations from one short link lets owners optimize landing pages without re-sharing — a measurable conversion lever.
  - Acceptance criteria: A link can hold N weighted destinations; clicks distribute per weight; per-variant clicks + downstream conversions reported; sticky per `click_id`.
  - Implementation notes: Dub link with variant config (or our rotator in worker if Dub lacks it — decide). Persist variant choice keyed to `click_id` so a returning visitor stays consistent.
  - Hosting notes: worker redirect logic.
  - Backing services: Dub, KV (sticky), Tinybird (variant metrics).
  - Observability: `link.variant_served` with variant id.
  - Dependencies: LOOP-LINKS-004.
  - Related files: `src/middleware/link_redirect.ts`, `src/services/ab_split.ts`.

- [ ] LOOP-LINKS-018: Geo + device targeting rules
  - Why: Routing a single link to locale/device-appropriate destinations (App Store vs Play, region landing pages) raises relevance and conversion.
  - Acceptance criteria: A link can define rules (country/region/OS/device → URL); CF geo + UA drive selection; default fallback; rules editable in UI; targeted hits still attribute.
  - Implementation notes: Use `request.cf.country` + UA parse; Dub geo-targeting if available else worker rule engine. Rules validated with Zod; max N rules per plan.
  - Hosting notes: worker edge.
  - Backing services: Dub, D1 (rules), Tinybird.
  - Observability: `link.geo_routed` with matched rule id.
  - Dependencies: LOOP-LINKS-004.
  - Related files: `src/services/link_targeting.ts`, `libs/features/link_shortener/targeting.component.ts`.

- [ ] LOOP-LINKS-019: Link expiration + scheduled activation
  - Why: Time-boxed campaign links (sales, events) must auto-expire to a fallback to avoid dead or stale destinations.
  - Acceptance criteria: Link has `expiresAt` and optional `activatesAt`; expired links 410/redirect to fallback URL; activation gates pre-launch links; surfaced in UI with countdown.
  - Implementation notes: Dub native expiration where available; worker enforces at redirect. Cron sweep marks expired for analytics segmentation.
  - Hosting notes: worker + Cron Trigger.
  - Backing services: Dub, D1, Cron.
  - Observability: `link.expired_hit`; counts to Tinybird.
  - Dependencies: LOOP-LINKS-003.
  - Related files: `src/middleware/link_redirect.ts`, `src/cron/link_expiry.ts`.

- [ ] LOOP-LINKS-020: Password-protected + cloaked links
  - Why: Owners sharing gated content or affiliate links need access control and URL masking — table-stakes shortener features.
  - Acceptance criteria: A link can require a password (interstitial form) and/or cloak the destination (iframe/proxy mask) per Dub capability; settings toggled in UI; attribution preserved through the gate.
  - Implementation notes: Dub password + cloaking; password hashed, never logged. Cloaking respects target's frame headers (fail open to redirect if X-Frame-Options denies). Document cloaking caveats.
  - Hosting notes: worker interstitial + Dub.
  - Backing services: Dub, Upstash (rate-limit password attempts).
  - Observability: `link.password_attempt` (no secret), lockout after N fails.
  - Dependencies: LOOP-LINKS-009.
  - Related files: `src/routes/link_gate.ts`, `libs/features/link_shortener/protect.component.ts`.

- [ ] LOOP-LINKS-021: Click-fraud / bot detection before conversion counting
  - Why: Bot and self-clicks pollute attribution and inflate conversion numbers — fraud filtering protects every downstream ROI metric.
  - Acceptance criteria: Clicks are scored (UA, ASN/datacenter IP, velocity, CF bot score) and tagged `is_bot`; conversion attribution (claims/leads/revenue) excludes bot clicks; dashboard shows human vs bot split.
  - Implementation notes: Use `request.cf.botManagement.score` + Upstash velocity counters; mark in Tinybird click row. Never block the redirect — only exclude from conversion + flag.
  - Hosting notes: worker edge.
  - Backing services: CF Bot Management, Upstash, Tinybird.
  - Observability: `click.bot_flagged` with reason; fraud-rate alarm to Axiom.
  - Dependencies: LOOP-LINKS-002, LOOP-LINKS-004.
  - Related files: `src/services/click_fraud.ts`, `infra/tinybird/dub/human_clicks.pipe`.

- [ ] LOOP-LINKS-022: Partner / referral links + payouts hook
  - Why: A referral program turns customers into a distribution channel; tracked partner links + commission accounting is a growth flywheel.
  - Acceptance criteria: A partner gets a unique referral link; referred signups/customers attribute to the partner via the click→customer lineage; a `referrals_by_partner` report drives commission; export to Stripe Connect for payout.
  - Implementation notes: Reuse Dub's partner program features if usable, else tag links `partner_id`. Commission = attributed revenue × rate; payout via Stripe Connect Express (per payments-routing). Anti-self-referral check.
  - Hosting notes: worker + Stripe Connect.
  - Backing services: Dub, Stripe Connect, Tinybird, Neon.
  - Observability: `referral.converted`, `payout.queued`.
  - Dependencies: LOOP-LINKS-007.
  - Related files: `libs/features/referral_program/`, `src/services/billing.ts`.

- [ ] LOOP-LINKS-023: Deep links (mobile app routing) + smart fallback
  - Why: For owners with mobile apps, a single link that opens the app when installed and falls back to web/store maximizes engagement.
  - Acceptance criteria: A link configured with app scheme + iOS/Android store URLs opens the app via universal/app links, else routes to store, else web; `apple-app-site-association` + `assetlinks.json` served for the vanity domain.
  - Implementation notes: Serve AASA/assetlinks from the vanity domain root; interstitial JS fallback for non-supporting browsers. Attribution carried via deferred-deep-link param.
  - Hosting notes: worker (well-known files + redirect).
  - Backing services: Dub, R2/KV (AASA config), CF DNS.
  - Observability: `deeplink.routed` with target (app|store|web).
  - Dependencies: LOOP-LINKS-013, LOOP-LINKS-018.
  - Related files: `src/routes/well_known.ts`, `src/services/deeplink.ts`.

- [ ] LOOP-LINKS-024: Attribution lineage explorer + webhook fan-out (Hookdeck+Outpost)
  - Why: A single view of the full click→claim→lead→customer chain — plus emitting each hop as a webhook — makes attribution debuggable and lets owners pipe events into their own tools.
  - Acceptance criteria: `/admin/links/:id/lineage` shows the ordered chain for a `click_id` with all correlation IDs; each hop emits a typed webhook through Outpost; idempotent + signed; replay supported via Hookdeck.
  - Implementation criteria/notes: Single Tinybird/Neon join keyed on `click_id`; webhook events `click.recorded`, `claim.attributed`, `lead.attributed`, `revenue.attributed` with stable schema + HMAC. Dead-letter to R2.
  - Hosting notes: worker; Hookdeck (ingress dedupe) + Outpost (egress to owner endpoints).
  - Backing services: Hookdeck+Outpost, Tinybird, Neon, R2 (dead-letter).
  - Observability: full correlation tuple on every hop; Sentry on webhook delivery failure; Axiom lineage trace.
  - Dependencies: LOOP-LINKS-005, LOOP-LINKS-006, LOOP-LINKS-007.
  - Related files: `src/services/attribution_lineage.ts`, `src/routes/webhooks.ts`, `libs/features/lead_attribution/lineage.component.ts`.

## status.projectsites.dev — Status Page + Uptime Monitoring

### Raw research themes considered

Surveyed ~50 themes spanning the public-facing status page (component grid, 90-day uptime bars, incident timeline, scheduled-maintenance banners, RSS/Atom feeds, embed widget, subscriber notifications), the prober plane (synthetic HTTP/TCP/DNS/TLS checks, multi-region probes, latency percentiles, degraded-performance thresholds, dead-man/heartbeat checks for crons, dependency DAG), and the aggregation plane (consume every subsystem's `/health`, roll component states up to overall status, SLA/uptime % math, historical rollups, auto-incident from Sentry/alerts). Build-vs-buy was weighed for Openstatus/Gatus/Upptime self-host versus CF-native: the verdict is **CF-native (Workers + Durable Objects + Cron Triggers + D1/R2/Tinybird)** because every probe is a fan-out HTTP GET that Cron+Workers do natively, the monitoring-only cron doctrine fits perfectly, and a self-hosted prober would duplicate state we already own — no 24/7 stateful prober is unavoidable, so **no Fly app is used**. Openstatus is studied only as a UX reference (component-grid + bar semantics), never deployed. The flagship primitive is a **health-aggregator** that pulls the 19 sibling subsystems' `/health` endpoints (doctrine-guaranteed) plus per-tenant customer-site checks, normalizes them into a typed `ComponentState`, and drives the page, the SLA math, and auto-incident creation from one source of truth. Storage splits cleanly: D1 = live state + incidents + subscribers, R2 = raw check-result archive + status-snapshot HTML, Tinybird = uptime/latency OLAP rollups (never ClickHouse), Axiom = prober logs, Sentry = PLATFORM errors only, PostHog Cloud = page analytics, Hookdeck+Outpost = subscriber webhooks, Listmonk/SES = email notices.

### Selected 24 implementation tasks

- [ ] LOOP-STATUS-001: Health-aggregator core — pull every subsystem `/health` into normalized ComponentState
  - Why: This is the flagship primitive; every other feature (page, SLA, incidents, alerts) reads from one normalized health snapshot rather than re-probing.
  - Acceptance criteria: A `HealthAggregator` service fetches all 19 sibling `/health` endpoints + platform `/health` concurrently, parses each into a Zod-validated `ComponentState {slug, status: operational|degraded|partial_outage|major_outage|maintenance, latency_ms, checked_at, detail}`, tolerates non-200/timeouts (→ major_outage, not throw), and writes a single `status_snapshot` row to D1 per cycle. Unit tests cover all-up, one-down, timeout, and malformed-JSON cases.
  - Implementation notes: A `SUBSYSTEM_REGISTRY` const maps slug→health URL→expected JSON shape→dependency parents. `Promise.allSettled` with per-check `AbortSignal.timeout(5000)`. Reuse the `/health` doctrine contract (`{status, version, checks[]}`).
  - Hosting notes: CF Worker route `status.projectsites.dev/*`; aggregation logic invoked by Cron (LOOP-STATUS-002) and on-demand for the page.
  - Backing services: D1 (`status_snapshot`, `components`), KV (60s hot-cache of latest snapshot for page reads).
  - Observability: Axiom log per aggregation cycle with `subsystem`, `check_id`, `request_id`, per-component latency; Sentry only if the aggregator itself throws.
  - Dependencies: none (foundation).
  - Related files: `apps/project-sites/src/services/status/health_aggregator.ts`, `apps/project-sites/src/services/status/registry.ts`, `packages/shared/src/schemas/status.ts`

- [ ] LOOP-STATUS-002: Cron-driven synthetic prober (monitoring-only doctrine)
  - Why: Crons are monitoring-only by doctrine, which is exactly what a prober is — scheduled fan-out checks with zero mutation of business state.
  - Acceptance criteria: A CF Cron Trigger (`*/1 * * * *`) invokes the aggregator + per-component synthetic checks; results persist to D1; a missed-run guard flags stale snapshots (>3 min old) on the page. Idempotent — re-running the same minute does not double-count uptime.
  - Implementation notes: `scheduled()` handler dispatches to `runProbeCycle()`. Each check carries `check_id` (stable per component+type) for correlation. Stagger heavy checks across minutes via a modulo schedule to stay under CPU limits.
  - Hosting notes: CF Cron Triggers in `wrangler.toml` `[triggers] crons`; pure Worker, no container, no Fly.
  - Backing services: D1 (`check_results`), KV (last-run timestamp), R2 (raw result archive batched hourly).
  - Observability: Axiom structured log per cycle (`cron_run_id`, count_ok, count_fail, duration_ms).
  - Dependencies: LOOP-STATUS-001.
  - Related files: `apps/project-sites/src/workflows/status_probe.ts`, `apps/project-sites/wrangler.toml`

- [ ] LOOP-STATUS-003: Durable Object check scheduler for sub-minute + regional probes
  - Why: Cron's floor is 1 minute and single-region; a DO with alarms enables tighter intervals and per-region scheduling for critical components (api/auth/billing).
  - Acceptance criteria: A `ProbeSchedulerDO` schedules alarms per high-priority component (configurable 15–60s), records jitter-corrected intervals, and survives restarts. Falls back to Cron cadence for low-priority components. (needs decision: which components warrant sub-minute — default api/auth/billing/mail.)
  - Implementation notes: One DO per region tag; `alarm()` runs the check and re-arms. Use `state.storage` for the schedule and last-result. Keep DO logic thin — delegate probe execution to the shared prober.
  - Hosting notes: CF Durable Objects (`new_sqlite_classes` migration); regional placement hints where available.
  - Backing services: DO SQLite storage, D1 (`check_results`), Tinybird (latency events).
  - Observability: Axiom log per alarm with `region`, `check_id`, `interval_ms`.
  - Dependencies: LOOP-STATUS-002.
  - Related files: `apps/project-sites/src/durable_objects/probe_scheduler.ts`

- [ ] LOOP-STATUS-004: Public status page — component grid + overall banner
  - Why: The primary user-facing artifact; one glance must answer "is the platform up?"
  - Acceptance criteria: `GET status.projectsites.dev/` renders an overall status banner (worst-of components), a grouped component grid (Core / Comms / Data / AI / Customer Sites), and a "last updated" timestamp; SSR/SSG from the KV-cached snapshot; degrades to a static R2 snapshot if the Worker errors. Axe-clean, 6 breakpoints.
  - Implementation notes: Dark-first brand tokens; status colors meet WCAG AA + carry text/icon (not color-only). Overall = max severity across non-maintenance components. Render from KV first, D1 fallback.
  - Hosting notes: CF Worker SSR; static fallback snapshot in R2 (`status/snapshot.html`) refreshed each cycle.
  - Backing services: KV (snapshot), R2 (static fallback), D1 (source).
  - Observability: PostHog `$pageview` + `status_overall` property; Axiom request log.
  - Dependencies: LOOP-STATUS-001.
  - Related files: `apps/project-sites/src/routes/status_page.ts`, `apps/project-sites/public/status/`

- [ ] LOOP-STATUS-005: 90-day uptime bars per component (Tinybird-backed)
  - Why: Historical uptime is the trust signal that distinguishes a real status page from a green light.
  - Acceptance criteria: Each component shows a 90-bar strip (one bar/day) colored by that day's worst observed state, with hover detail (uptime %, incident count); data served from a Tinybird endpoint over rolled-up check results.
  - Implementation notes: Daily rollup pipe aggregates `check_results` → `uptime_daily {component, day, pct, worst_state, incidents}`. Page calls the Tinybird endpoint with a short edge cache. Backfill from R2 archive on first build.
  - Hosting notes: Tinybird OLAP (never ClickHouse); CF Worker proxies the endpoint with a signed token.
  - Backing services: Tinybird (`uptime_daily` pipe + endpoint), R2 (backfill source).
  - Observability: Axiom log on endpoint latency; Tinybird query stats.
  - Dependencies: LOOP-STATUS-002, LOOP-STATUS-013.
  - Related files: `apps/project-sites/src/services/status/uptime_rollup.ts`, `tinybird/pipes/uptime_daily.pipe`

- [ ] LOOP-STATUS-006: Incident model + lifecycle (investigating→identified→monitoring→resolved)
  - Why: Status pages live or die on clear, time-stamped incident communication.
  - Acceptance criteria: D1 `incidents` + `incident_updates` tables; a typed lifecycle with append-only updates; an incident pins affected components and impact level; resolved incidents drop off the active banner but persist in history. Zod schemas for create/update; idempotent updates via client token.
  - Implementation notes: `incident_id` is the correlation key threaded everywhere. Updates are immutable rows (audit trail). Impact derives affected-component severity on the page.
  - Hosting notes: CF Worker handlers under `/api/status/incidents`.
  - Backing services: D1 (`incidents`, `incident_updates`).
  - Observability: Axiom log per transition (`incident_id`, from_state→to_state, actor); PostHog `incident_opened`/`incident_resolved`.
  - Dependencies: LOOP-STATUS-001.
  - Related files: `apps/project-sites/src/services/status/incidents.ts`, `packages/shared/src/schemas/status_incident.ts`

- [ ] LOOP-STATUS-007: Incident timeline UI + per-incident permalink page
  - Why: Subscribers and customers need a linkable, chronological record of what happened and when.
  - Acceptance criteria: `/incidents` lists past incidents (paginated); `/incidents/:id` renders the full update thread with timestamps, affected components, and duration; both SSR, axe-clean, and exposed in the RSS feed (LOOP-STATUS-010).
  - Implementation notes: Render Markdown update bodies through a scheme-validated sanitizer (per markdown link-safety memory). Show computed downtime duration. Stable anchor per update.
  - Hosting notes: CF Worker SSR; pages cacheable with short TTL, purged on new update.
  - Backing services: D1 (incidents), KV (rendered cache).
  - Observability: PostHog `$pageview` with `incident_id`.
  - Dependencies: LOOP-STATUS-006.
  - Related files: `apps/project-sites/src/routes/status_incidents.ts`

- [ ] LOOP-STATUS-008: Auto-incident creation from probe failures + Sentry/alert ingestion
  - Why: A solo founder cannot hand-open incidents; sustained failures and platform Sentry alerts should declare incidents automatically.
  - Acceptance criteria: N consecutive failed cycles (default 3) for a component auto-opens an incident (investigating) and auto-resolves after M consecutive recoveries; a Sentry webhook + internal alert webhook can also open/correlate incidents; dedup prevents flapping (debounce + open-incident check). Confirmable false-positive suppression window.
  - Implementation notes: State machine keyed by component; persist failure streak in DO/D1. Sentry payload maps `issue` → affected component via tag. Hysteresis thresholds configurable per component.
  - Hosting notes: CF Worker webhook receiver on workers.dev origin (BFM bypass per inbound-webhook memory) → forwards to status Worker.
  - Backing services: D1 (`incidents`, streak state), Sentry (PLATFORM webhook source).
  - Observability: Axiom log with `check_id`, `incident_id`, streak counts; Sentry NOT used to report status's own auto-incidents (avoid loop).
  - Dependencies: LOOP-STATUS-006, LOOP-STATUS-002.
  - Related files: `apps/project-sites/src/services/status/auto_incident.ts`, `apps/project-sites/src/routes/webhooks.ts`

- [ ] LOOP-STATUS-009: Subscriber registry + email notifications (Listmonk/SES double opt-in)
  - Why: Users want to be told about incidents/maintenance without watching the page.
  - Acceptance criteria: A subscribe form captures email + optional component scope, sends a double-opt-in confirmation, and on incident open/update/resolve + maintenance start/end fans out templated emails; unsubscribe link in every message; per-component subscriptions honored.
  - Implementation notes: Listmonk list per "status-subscribers" with SES transport; or direct SES for transactional incident mails (needs decision: Listmonk-broadcast vs direct-SES — default Listmonk for list mgmt, SES for instant incident blasts). Idempotent send keyed by `incident_update_id+subscriber_id`.
  - Hosting notes: CF Worker triggers; Listmonk on mail.projectsites.dev; SES for delivery.
  - Backing services: D1 (`status_subscribers`), Listmonk, SES.
  - Observability: Axiom log per send batch; PostHog `status_subscribed`; bounce handling via SES SNS → workers.dev receiver.
  - Dependencies: LOOP-STATUS-006.
  - Related files: `apps/project-sites/src/services/status/subscribers.ts`

- [ ] LOOP-STATUS-010: RSS/Atom + JSON feeds for incidents and maintenance
  - Why: Feeds are the zero-friction, no-PII subscription path and feed status aggregators/Slack.
  - Acceptance criteria: `/feed.rss`, `/feed.atom`, and `/api/status/feed.json` emit the latest incidents + scheduled maintenance with stable GUIDs, valid per W3C feed validation, cached with purge-on-update.
  - Implementation notes: GUID = `incident_id` (+ update seq for granular feeds). Conform to the Atom spec used by common status aggregators. Set correct content-type + `Last-Modified`.
  - Hosting notes: CF Worker routes; KV-cached, purged on incident/maintenance change.
  - Backing services: D1 (source), KV (cache).
  - Observability: Axiom log with feed type + cache hit/miss.
  - Dependencies: LOOP-STATUS-006, LOOP-STATUS-011.
  - Related files: `apps/project-sites/src/routes/status_feeds.ts`

- [ ] LOOP-STATUS-011: Scheduled-maintenance notices (banner + auto-suppress alerts)
  - Why: Planned work must show as maintenance, not red outage, and must suppress auto-incidents during the window.
  - Acceptance criteria: Create a maintenance window (components, start, end, body); page shows an upcoming/active maintenance banner; during the window affected components render `maintenance` (blue) and auto-incident creation is suppressed for them; notifications fire on schedule + start + end.
  - Implementation notes: Window stored in D1; aggregator checks active windows to override component color and gate LOOP-STATUS-008. Pre-notify at T-24h/T-1h (configurable).
  - Hosting notes: CF Worker + Cron for pre-notify timing.
  - Backing services: D1 (`maintenance_windows`), Listmonk/SES, Hookdeck (webhook subs).
  - Observability: Axiom log per window lifecycle; PostHog `maintenance_scheduled`.
  - Dependencies: LOOP-STATUS-001, LOOP-STATUS-009.
  - Related files: `apps/project-sites/src/services/status/maintenance.ts`

- [ ] LOOP-STATUS-012: SLA / uptime % computation + display (rolling windows)
  - Why: Uptime percentages (24h/7d/30d/90d) are the headline metric users and contracts care about.
  - Acceptance criteria: Per component + overall, compute uptime % over rolling windows excluding maintenance windows by default (toggleable), display with the bar strips, and expose via API; math is deterministic and unit-tested against fixtures including partial-degradation weighting.
  - Implementation notes: Degraded counts as fractional downtime (configurable weight, e.g. 0.5). Source from Tinybird daily rollups for long windows, D1 raw for 24h. Document the SLA formula in the page footer.
  - Hosting notes: CF Worker compute; Tinybird for ≥7d windows.
  - Backing services: Tinybird (`uptime_daily`), D1 (recent raw).
  - Observability: Axiom log on compute latency.
  - Dependencies: LOOP-STATUS-005, LOOP-STATUS-011.
  - Related files: `apps/project-sites/src/services/status/sla.ts`

- [ ] LOOP-STATUS-013: Check-result archival to R2 + retention policy
  - Why: D1 is the hot store; raw high-frequency check results must age out to cheap durable storage for backfill and audits.
  - Acceptance criteria: An hourly Cron batches raw `check_results` older than 7 days into compressed R2 objects (`status/archive/YYYY/MM/DD/component.ndjson.gz`), then prunes D1; Tinybird ingestion reads from R2 for long-window rollups; restore path documented.
  - Implementation notes: NDJSON + gzip; partition by day+component for cheap range reads. Keep D1 to a rolling 7-day window. Idempotent archive keyed by hour.
  - Hosting notes: CF Cron + Worker; R2 lifecycle for ultra-cold (>1yr) tiering.
  - Backing services: R2 (archive), D1 (hot), Tinybird (ingest).
  - Observability: Axiom log per archive run (rows moved, bytes written).
  - Dependencies: LOOP-STATUS-002.
  - Related files: `apps/project-sites/src/workflows/status_archive.ts`

- [ ] LOOP-STATUS-014: Component dependency map + cascade rendering
  - Why: When a shared dependency (db/auth) fails, dependent components should reflect impact instead of confusing independent reds.
  - Acceptance criteria: The registry declares a dependency DAG (e.g. billing→db, crm→auth); the page renders a dependency view and annotates "degraded due to <upstream>"; cascade is advisory (does not fake green/red), and cycle detection guards the DAG at build time.
  - Implementation notes: DAG in `SUBSYSTEM_REGISTRY`; topological annotation in the aggregator. Render a compact map (SVG) plus inline "depends on" badges.
  - Hosting notes: CF Worker SSR; DAG validated in CI.
  - Backing services: D1 (snapshot), static registry.
  - Observability: Axiom log when a cascade annotation is applied (`component`, `upstream`).
  - Dependencies: LOOP-STATUS-001.
  - Related files: `apps/project-sites/src/services/status/dependency_graph.ts`

- [ ] LOOP-STATUS-015: Per-tenant customer-site uptime (status-as-a-feature)
  - Why: ProjectSites hosts customer sites; per-tenant uptime is a sellable product surface, not just internal ops.
  - Acceptance criteria: Each published customer site gets synthetic checks (homepage 200 + optional keyword assertion); a tenant-scoped status view shows their site's uptime + response time; org-scoped (orgId from `c.get('orgId')`, never client header) and behind a feature flag.
  - Implementation notes: Reuse the prober with per-tenant targets pulled from the sites table. Cap check frequency by plan tier. Tenant view at `/status/:tenant` (slug-scoped) or in admin.
  - Hosting notes: CF Cron fan-out; DO scheduler for premium tenants.
  - Backing services: D1 (`tenant_checks`), Tinybird (per-tenant rollups), R2 (archive).
  - Observability: Axiom log with `tenant_id`, `check_id`; PostHog `tenant_status_viewed`.
  - Dependencies: LOOP-STATUS-002, LOOP-STATUS-024.
  - Related files: `apps/project-sites/src/services/status/tenant_checks.ts`

- [ ] LOOP-STATUS-016: Response-time / latency graphs with percentiles
  - Why: "Up" is not enough; degraded latency is the most common real-world failure mode and needs visualization.
  - Acceptance criteria: Per component, render p50/p90/p99 response-time charts over selectable windows from Tinybird; degraded-performance threshold lines overlaid; data downsampled for long windows.
  - Implementation notes: Latency events stream to Tinybird per check; percentile pipes per window. Chart with brand-locked, accessible series (labels not color-only).
  - Hosting notes: CF Worker proxies Tinybird endpoint; edge-cached.
  - Backing services: Tinybird (`latency_events`, percentile pipes).
  - Observability: Tinybird query stats; Axiom endpoint log.
  - Dependencies: LOOP-STATUS-005.
  - Related files: `tinybird/pipes/latency_percentiles.pipe`, `apps/project-sites/src/routes/status_metrics.ts`

- [ ] LOOP-STATUS-017: Degraded-performance detection (threshold + anomaly)
  - Why: Auto-detecting "slow but up" prevents silent SLA erosion that binary up/down checks miss.
  - Acceptance criteria: Per component, configurable latency thresholds (warn/critical) plus a rolling-baseline anomaly check flip the component to `degraded` and can feed auto-incident; thresholds tunable per component; false-positive damping via consecutive-breach requirement.
  - Implementation notes: Baseline = trailing p90 over 7d from Tinybird; breach = current p90 > k×baseline for N cycles. Keep thresholds in D1 config, editable in admin.
  - Hosting notes: CF Worker compute inside the probe cycle.
  - Backing services: Tinybird (baseline), D1 (thresholds).
  - Observability: Axiom log on each degraded flip (`component`, observed_p90, baseline).
  - Dependencies: LOOP-STATUS-016, LOOP-STATUS-008.
  - Related files: `apps/project-sites/src/services/status/degradation.ts`

- [ ] LOOP-STATUS-018: Heartbeat / dead-man checks for crons & background jobs
  - Why: Crons fail silently; a heartbeat that expects a ping and alerts on absence catches missed monitoring/jobs.
  - Acceptance criteria: A `POST /api/status/heartbeat/:check_id` endpoint records pings; each heartbeat has an expected interval + grace; a sweep Cron opens an incident / fires alert when a heartbeat is overdue; bootstrap-tokened so only real jobs can ping.
  - Implementation notes: Store `last_ping_at` + `expected_interval_s` per heartbeat in D1/DO; sweep compares `now - last_ping > interval + grace`. Wire existing platform crons (probe, archive, rollup) to ping themselves.
  - Hosting notes: CF Worker endpoint + Cron sweep; receiver on workers.dev for BFM bypass.
  - Backing services: D1 (`heartbeats`), DO (optional precise expiry alarm).
  - Observability: Axiom log per ping + per overdue detection (`check_id`, overdue_by_s).
  - Dependencies: LOOP-STATUS-002, LOOP-STATUS-008.
  - Related files: `apps/project-sites/src/services/status/heartbeat.ts`

- [ ] LOOP-STATUS-019: Embeddable status widget (badge + mini-panel)
  - Why: Customers and the marketing site want a live "all systems operational" badge without iframing the whole page.
  - Acceptance criteria: `/embed/badge.svg` (dynamic SVG reflecting overall status), `/embed/badge.json` (Shields-compatible), and a `/embed.js` snippet that injects a mini status panel; all CORS-enabled, cached short, color + label (not color-only).
  - Implementation notes: SVG generated server-side from the cached snapshot; `embed.js` is a tiny script that fetches `badge.json` and renders. Provide copy-paste snippet in admin.
  - Hosting notes: CF Worker routes with permissive CORS + short KV cache.
  - Backing services: KV (snapshot), D1 (source).
  - Observability: PostHog `status_embed_loaded` with referrer host.
  - Dependencies: LOOP-STATUS-004.
  - Related files: `apps/project-sites/src/routes/status_embed.ts`

- [ ] LOOP-STATUS-020: Public status API (typed, rate-limited, documented)
  - Why: A machine-readable status API lets dashboards, bots, and customers integrate programmatically — table stakes for a platform.
  - Acceptance criteria: `GET /api/status/v1/summary`, `/components`, `/incidents`, `/uptime` return Zod-validated JSON with stable shapes; DO-backed rate limiting; OpenAPI spec published; RFC7807 error envelopes with `correlationId`.
  - Implementation notes: Versioned under `/v1`. Reuse the snapshot + D1 sources. Rate-limit per IP via DO counter (managed RL doesn't enforce on plan, per memory). Lint spec with Redocly.
  - Hosting notes: CF Worker; DO rate-limit counter.
  - Backing services: D1, KV, DO (rate limit).
  - Observability: Axiom log per call with `request_id`, endpoint, status; PostHog `status_api_called`.
  - Dependencies: LOOP-STATUS-001, LOOP-STATUS-006.
  - Related files: `apps/project-sites/src/routes/status_api.ts`, `apps/project-sites/openapi/status.yaml`

- [ ] LOOP-STATUS-021: Regional status — multi-PoP probe + regional breakdown
  - Why: A component up in one region but down in another is invisible to single-region checks; regional truth matters for global customers.
  - Acceptance criteria: Checks run from ≥2 CF regions (via DO regional hints / Cron in multiple colos where feasible); the page shows a per-region matrix for selected components; overall reflects worst region with a regional drill-down. (needs decision: CF region coverage limits — document achievable regions; external prober is explicitly out of scope unless a region can't be reached.)
  - Implementation notes: Tag each `check_result` with `region`. Aggregate per region then roll up. Start with the region set CF placement actually grants.
  - Hosting notes: CF DO regional scheduling (LOOP-STATUS-003); no Fly — if a region is genuinely unreachable from CF, surface "unknown" rather than stand up external infra.
  - Backing services: D1 (`check_results.region`), Tinybird (regional rollups).
  - Observability: Axiom log with `region`, `check_id`.
  - Dependencies: LOOP-STATUS-003.
  - Related files: `apps/project-sites/src/services/status/regions.ts`

- [ ] LOOP-STATUS-022: Webhook subscriptions via Hookdeck + Outpost
  - Why: Teams want incident events pushed to Slack/PagerDuty/their own systems with delivery guarantees we don't have to build.
  - Acceptance criteria: Subscribers register a webhook URL + secret; incident/maintenance/component-state events publish through Hookdeck+Outpost with HMAC signatures, retries, and a DLQ; delivery status visible in admin; per-event-type filtering.
  - Implementation notes: Emit a typed `StatusEvent` to Outpost on each lifecycle transition; Hookdeck handles fan-out + retry. Sign payloads; document verification. Idempotency key = `event_id`.
  - Hosting notes: CF Worker publishes; Hookdeck+Outpost handle delivery.
  - Backing services: Hookdeck, Outpost, D1 (`webhook_subscriptions`).
  - Observability: Axiom log per publish (`event_id`, type); Hookdeck delivery dashboard.
  - Dependencies: LOOP-STATUS-006, LOOP-STATUS-011.
  - Related files: `apps/project-sites/src/services/status/webhooks_out.ts`

- [ ] LOOP-STATUS-023: Admin console — incidents, maintenance, components, thresholds
  - Why: A solo founder needs one fast cyan/black panel to declare incidents, post updates, schedule maintenance, and tune checks.
  - Acceptance criteria: `/admin/status` provides CRUD for incidents (with update composer), maintenance windows, component registry overrides, and per-component thresholds; all mutations authed + audit-logged; templated quick-incidents ("API degraded"); flag-gated; matches admin cyan/black cockpit tokens.
  - Implementation criteria/notes: Reuse `DialogShellComponent` + `ConfirmService` (destructive=red default). orgId/operator scope from server context, never client header. Markdown preview for update bodies (sanitized).
  - Implementation notes: Mirror the admin section-add recipe (child route + nav `<a>` + sections/ component). Optimistic UI with rollback on error envelope.
  - Hosting notes: Angular admin frontend (R2) + Worker API; flag `status_admin`.
  - Backing services: D1 (incidents/maintenance/components), audit service.
  - Observability: Audit log + Sentry breadcrumbs with `featureSlug: status_admin`.
  - Dependencies: LOOP-STATUS-006, LOOP-STATUS-011, LOOP-STATUS-017.
  - Related files: `apps/project-sites/frontend/src/app/admin/sections/status/`, `apps/project-sites/src/routes/status_admin.ts`

- [ ] LOOP-STATUS-024: Feature-module wrapper + flag + E2E + on-call escalation hook
  - Why: Per SUPREME feature-module doctrine the whole status plane must be a colocated module with a typed flag, and incidents need an escalation path beyond email.
  - Acceptance criteria: `libs/features/status_plane/` with `manifest.ts` (7 required fields), Zod `schemas.ts`, typed flag `status_plane` (enabled=0, rollout=0, experimental) wired to D1 + KV cache; Playwright `e2e/status_plane/` covers page render, incident lifecycle, subscribe flow, badge, and API; an on-call escalation step pages the founder (SES + webhook + optional Twilio — needs decision: Twilio vs webhook-only) when a major-outage incident stays open past a threshold.
  - Implementation notes: `validate:features` passes; disabled flag → page returns a minimal static "operational" snapshot (404 on admin/API). Escalation ladder configurable (T+5m warn → T+15m page). All events tagged `featureSlug: status_plane`.
  - Hosting notes: CF Worker + Angular admin; flag in `/admin/feature-flags`.
  - Backing services: D1 (flag + escalation config), SES/Hookdeck (notify), optional Twilio.
  - Observability: Sentry breadcrumbs + structured logs carrying `featureSlug`, `incident_id`; PostHog funnel.
  - Dependencies: LOOP-STATUS-001 through LOOP-STATUS-023.
  - Related files: `libs/features/status_plane/manifest.ts`, `libs/features/status_plane/schemas.ts`, `apps/project-sites/e2e/status_plane/`

## admin.projectsites.dev — Super-Admin / Operator Console

### Raw research themes considered

Surveyed 50+ operator-console patterns across PaaS control planes (Vercel/Render dashboards), tenant SaaS admin (Stripe Dashboard, Supabase org admin), and incident tooling (PagerDuty, Statuspage) — distilling to what a solo founder operating 19 live subsystems actually needs daily. The flagship is a single cross-subsystem control plane (one cockpit driving every subsystem) layered on the existing black+cyan Angular admin, never a second app. Hard constraints shaped every pick: this OPERATOR layer is distinct from the customer/owner `/admin` (two-layer model — System Admin operator + Features owner); orgId always comes from `c.get('orgId')` server-side (IDOR class); every sensitive action (impersonate, refund, secret, deploy, broadcast, export) is approval-tier, confirmed, and writes an immutable audit row with correlation IDs. Observability is split deliberately: Sentry (platform errors — admin IS platform), Axiom (logs), PostHog Cloud (analytics), Tinybird (OLAP, never ClickHouse), Langfuse (AI traces), Hookdeck+Outpost (webhooks). Discarded ideas that duplicated owner-console features or required non-CF infra; kept only programmable, CF-Workers/Pages-hostable, audit-anchored operator controls.

### Selected 24 implementation tasks

- [ ] LOOP-ADMIN-001: Unified Operator Cockpit — single pane of glass over all 19 subsystems
  - Why: Flagship. A solo founder cannot tab between 19 dashboards; one cockpit driving every subsystem from `SERVICE_REGISTRY` is the core value of this whole layer.
  - Acceptance criteria: New `/admin/operator` route (operator-RBAC gated, 404 for non-operators); renders a live grid of all 19 subsystems from `SERVICE_REGISTRY` with health badge, last-deploy, error rate, cost-today, and 2-3 quick actions per card; clicking a card deep-links into that subsystem's operator detail; visibility-aware polling refreshes every 30s, pauses on `document.hidden`.
  - Implementation notes: Extend existing Angular admin; new `operator-cockpit/` feature dir reusing `DialogShellComponent` + `_polish.scss` tokens; aggregate endpoint `GET /api/operator/cockpit` fans out to per-subsystem status with `Promise.allSettled`, caches 30s in KV. Cards are config-driven off `SERVICE_REGISTRY` so adding a 20th subsystem requires zero cockpit code.
  - Hosting notes: Frontend on CF Pages/R2 (no Docker); backend Hono on CF Workers.
  - Backing services: D1 (subsystem registry + health snapshots), KV (30s cache), Tinybird (cost/error rollups), PostHog (operator engagement).
  - Observability: Sentry on aggregate handler; Axiom structured log per fan-out with `request_id`; every card action audited.
  - Dependencies: LOOP-ADMIN-002 (RBAC), LOOP-ADMIN-005 (audit log), existing `/admin/system-services` SERVICE_REGISTRY.
  - Related files: `src/app/features/operator-cockpit/`, `apps/project-sites/src/routes/operator.ts`, `src/services/system_services.ts`.

- [ ] LOOP-ADMIN-002: Operator RBAC + role model (super-admin / support / read-only)
  - Why: Impersonation, refunds, secrets, and deploys cannot share one permission level; operator actions need graded authority distinct from owner roles.
  - Acceptance criteria: `operator_roles` D1 table (`user_id`, `role`, `granted_by`, `granted_at`); roles `super_admin | support | read_only`; server middleware `requireOperator(role)` gates every operator route; UI hides controls the role lacks; non-operator hitting any `/admin/operator/*` API gets 404 (never 403).
  - Implementation notes: Build on Better Auth session; operator check is a server-side claim lookup, never a client header. Reuse RBAC middleware pattern from `packages/shared/src/middleware`.
  - Hosting notes: CF Workers middleware; frontend route guards on CF Pages.
  - Backing services: D1 (`operator_roles`), KV (60s role cache, invalidated on grant/revoke).
  - Observability: Audit every grant/revoke; Sentry on auth failures; Axiom log of every operator authz decision.
  - Dependencies: Better Auth; LOOP-ADMIN-005 (audit log).
  - Related files: `packages/shared/src/middleware/operator-rbac.ts`, `apps/project-sites/src/routes/operator.ts`, migration `00xx_operator_roles.sql`.

- [ ] LOOP-ADMIN-003: Tenant (org) management console — search, detail, CRUD
  - Why: Operators need to find any tenant, see full state, and correct data — the spine every other operator action hangs off.
  - Acceptance criteria: `/admin/operator/tenants` lists orgs with search by slug/email/id, plan, status, MRR, created; tenant detail shows users, sites, subscription, usage, flags, recent audit; edit org name/plan/status with confirm + audit; soft-delete with reason.
  - Implementation notes: Server-side pagination + search; orgId resolved server-side. Detail view composes read-only widgets from billing/usage/sites subsystems.
  - Hosting notes: CF Pages frontend; Hono Workers API.
  - Backing services: D1 (orgs/users/sites), Tinybird (usage/MRR rollups).
  - Observability: Every mutation audited with `tenant_id`; Sentry; PostHog tenant-view events.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005.
  - Related files: `src/app/features/operator-tenants/`, `apps/project-sites/src/routes/operator/tenants.ts`.

- [ ] LOOP-ADMIN-004: Support impersonation (scoped, time-boxed, banner + audit)
  - Why: Support cannot debug owner issues blind; safe impersonation is the most-used support tool and the most dangerous — must be tightly controlled.
  - Acceptance criteria: Operator picks a tenant user → confirm dialog with reason → mints a short-lived (≤30 min) impersonation session scoped to that org; persistent red "Impersonating {user} — exit" banner; all impersonated actions tagged `impersonated_by` in audit; auto-expires; one-click exit.
  - Implementation notes: Approval-tier sensitive — `super_admin` or `support` only; impersonation token is server-minted, read-only by default with explicit write-enable toggle (separately audited). orgId still from server claim, scoped to impersonation grant. (needs decision) whether write-mode impersonation requires second-operator approval.
  - Hosting notes: CF Workers session mint; CF Pages banner component.
  - Backing services: D1 (`impersonation_grants`), KV (active-session TTL).
  - Observability: Dedicated Sentry breadcrumb + Axiom log per impersonated request; full audit trail with `operator_id` + `tenant_id` + reason.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005, Better Auth.
  - Related files: `apps/project-sites/src/services/impersonation.ts`, `src/app/features/operator-impersonation/`.

- [ ] LOOP-ADMIN-005: Immutable operator audit log + viewer
  - Why: Every sensitive operator action must be reconstructable; the audit log is the foundation every other task writes to.
  - Acceptance criteria: `operator_audit` D1 table (`id`, `operator_id`, `tenant_id`, `site_id`, `app_id`, `request_id`, `action`, `before`, `after`, `reason`, `created_at`) — append-only (no UPDATE/DELETE in code path); `/admin/operator/audit` viewer with filters by operator/tenant/action/date, detail drawer, CSV export; correlation `request_id` links to Axiom/Sentry.
  - Implementation notes: A single `auditOperatorAction(ctx, {...})` helper called by every sensitive handler — make it impossible to mutate without auditing (lint/grep gate). Mirror critical rows to Tinybird for long-term query.
  - Hosting notes: CF Workers writer; CF Pages viewer.
  - Backing services: D1 (`operator_audit`), Tinybird (`operator_audit_events` mirror), R2 (CSV export artifacts).
  - Observability: Self — it IS the observability anchor; also Axiom log on every write.
  - Dependencies: LOOP-ADMIN-002.
  - Related files: `apps/project-sites/src/services/operator_audit.ts`, `src/app/features/operator-audit/`, migration `00xx_operator_audit.sql`.

- [ ] LOOP-ADMIN-006: Platform feature-flag operator surface (cross-tenant)
  - Why: The existing `/admin/feature-flags` is owner-scoped; operators need cross-tenant flag control, rollout %, kill-switch, and per-tenant overrides from one screen.
  - Acceptance criteria: `/admin/operator/flags` lists all platform flags with `enabled`, `rollout_percent`, `stage`, sentinel-protection; operator can flip global, set rollout, killswitch, and add/remove per-tenant overrides; sentinel `core_*` flags keep Disable/Killswitch disabled; every change audited; flag cache invalidated on write (the override-write cache bug is fixed here).
  - Implementation notes: Reuse `flag_overrides` (canonical global table) + per-tenant override path; call `invalidateFlagCache` on every mutation. Honor `feature-flags-sentinel-protection`.
  - Hosting notes: CF Pages + Workers.
  - Backing services: D1 (`flag_overrides`), KV (flag cache, 60s).
  - Observability: Audit per flip; Sentry; PostHog flag-change events with `featureSlug`.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005, existing flag service.
  - Related files: `src/app/features/operator-flags/`, `apps/project-sites/src/services/feature_flags.ts`.

- [ ] LOOP-ADMIN-007: Billing & subscription operator console
  - Why: Operators must inspect any tenant's Stripe subscription, change plan, apply credits, and resolve billing disputes without leaving the cockpit.
  - Acceptance criteria: Tenant billing detail shows subscription status, plan, MRR, invoices, payment method, dunning state (read from Stripe via MCP/API); operator can change plan, apply account credit, pause/resume subscription — each confirmed + audited; failed-payment list with retry action.
  - Implementation notes: Stripe writes via server only; idempotency keys on every mutation. Plan change syncs entitlements (LOOP-ADMIN-009).
  - Hosting notes: CF Workers (Stripe SDK server-side); CF Pages UI.
  - Backing services: Stripe (via MCP), D1 (subscription mirror), Tinybird (MRR).
  - Observability: Audit every billing mutation; Sentry on Stripe errors; Axiom.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005, LOOP-ADMIN-009.
  - Related files: `apps/project-sites/src/routes/operator/billing.ts`, `src/services/billing.ts`, `src/app/features/operator-billing/`.

- [ ] LOOP-ADMIN-008: Refund control (approval-tier, partial/full, audited)
  - Why: Refunds are money-moving and dispute-sensitive; they need a deliberate, confirmed, fully-audited operator path — not a raw Stripe dashboard click.
  - Acceptance criteria: From an invoice/charge, operator initiates full or partial refund with required reason + confirm; `super_admin` only; refund issued via Stripe with idempotency key; audit row captures amount, reason, charge id, operator; test-mode money in non-prod; refund status reflected back on the charge.
  - Implementation notes: Use Stripe `create_refund`; block double-refund via idempotency + state check. (needs decision) refund ceiling above which a second confirm/approval is required.
  - Hosting notes: CF Workers.
  - Backing services: Stripe (refunds), D1 (refund ledger).
  - Observability: Audit mandatory; Sentry; Axiom log with `request_id`.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005, LOOP-ADMIN-007.
  - Related files: `apps/project-sites/src/routes/operator/refunds.ts`, `src/services/billing.ts`.

- [ ] LOOP-ADMIN-009: Plan & entitlement management
  - Why: Operators need to inspect and override what any tenant is entitled to (caps, features, seats) independent of their plan — for custom deals and support remediation.
  - Acceptance criteria: Tenant entitlement view shows effective caps/features from plan + overrides; operator can grant a temporary or permanent override (e.g. raise site cap, unlock feature) with expiry + reason + confirm + audit; override revocation; effective-entitlement is computed server-side.
  - Implementation notes: Layer over existing `ENTITLEMENTS`/`CAPS` constants; overrides live in D1, merged at read. Server enforces — UI is display only.
  - Hosting notes: CF Workers + Pages.
  - Backing services: D1 (`entitlement_overrides`), KV (effective-entitlement cache).
  - Observability: Audit every override; Sentry; PostHog.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005.
  - Related files: `packages/shared/src/constants/entitlements.ts`, `apps/project-sites/src/routes/operator/entitlements.ts`.

- [ ] LOOP-ADMIN-010: Usage & cost dashboard (per-tenant + platform)
  - Why: A solo founder must see where money and compute go — per tenant and platform-wide — to price, cap abusers, and stay solvent.
  - Acceptance criteria: `/admin/operator/usage` shows platform totals (requests, AI tokens, R2, D1, container hours, $ cost) and per-tenant breakdown, time-range selectable, sortable by cost; trends sparklines; top-10 cost tenants surfaced; CSV export.
  - Implementation notes: All rollups from Tinybird (never ClickHouse) off the event bus; cost model is config-driven per CF resource pricing.
  - Hosting notes: CF Pages + Workers; queries hit Tinybird endpoints.
  - Backing services: Tinybird (`projectsites_events` rollups), D1 (cost-model config), R2 (exports).
  - Observability: Sentry on query failures; Axiom; audit on export (data leaves platform).
  - Dependencies: LOOP-ADMIN-001, event bus → Tinybird.
  - Related files: `src/app/features/operator-usage/`, `apps/project-sites/src/services/tinybird.ts`.

- [ ] LOOP-ADMIN-011: LLM spend admin (Langfuse-backed)
  - Why: AI is the largest variable cost and the easiest to run away; operators need per-tenant/per-model LLM spend, token volume, and the ability to throttle.
  - Acceptance criteria: `/admin/operator/llm-spend` shows spend by tenant/model/feature over time (sourced from Langfuse traces + event bus), top spenders, anomaly highlights; operator can set a per-tenant daily token budget that the worker enforces; budget change audited.
  - Implementation notes: Pull trace aggregates via Langfuse MCP; budgets stored in D1, enforced at the LLM-call boundary with a kill on exceed.
  - Hosting notes: CF Workers (budget enforcement at call site); CF Pages UI.
  - Backing services: Langfuse (AI traces), Tinybird (spend rollups), D1 (budgets).
  - Observability: AI traces in Langfuse; Sentry on enforcement errors; audit budget changes.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005, LOOP-ADMIN-010.
  - Related files: `src/app/features/operator-llm-spend/`, `apps/project-sites/src/services/external_llm.ts`.

- [ ] LOOP-ADMIN-012: Container / Durable-Object health board
  - Why: Many subsystems run on CF Workers Containers + DOs that fail silently (no /dev/shm crash-loops, cold boots); operators need at-a-glance container health.
  - Acceptance criteria: `/admin/operator/infra` lists every container/DO with status, last-restart, CPU/mem proxy, recent error count, and a restart/redeploy action (confirmed); surfaces known failure patterns (exit-without-traceback, port-up-but-502) with diagnostics.
  - Implementation notes: Health pulled from each container's `/health` + CF API; restart triggers a controlled redeploy. Reuse container patterns from existing subsystem deploys.
  - Hosting notes: CF Workers polls health; CF Pages board.
  - Backing services: D1 (health snapshots), CF API (container/DO status), Axiom (container logs).
  - Observability: Sentry on health-check failures; audit on restart/redeploy; Axiom.
  - Dependencies: LOOP-ADMIN-001, LOOP-ADMIN-005.
  - Related files: `src/app/features/operator-infra/`, `apps/project-sites/src/routes/operator/infra.ts`.

- [ ] LOOP-ADMIN-013: Deploy & rollback control plane
  - Why: Operators need to see deploy state across subsystems and trigger a rollback in seconds during an incident — without shelling into CI.
  - Acceptance criteria: `/admin/operator/deploys` lists recent deploys per subsystem (version, time, status, actor); one-click rollback to previous version (confirmed, `super_admin` only, audited) via `wrangler rollback`/CF API; shows whether workers.dev + custom domain are both live (200) post-action.
  - Implementation notes: Rollback calls CF API per subsystem; HTTP-verify the live URL after (not just the API success), per the workers.dev 404 incident. Approval-tier.
  - Hosting notes: CF Workers orchestrates; CF Pages UI.
  - Backing services: CF API (versions/rollback), D1 (deploy ledger).
  - Observability: Audit every deploy/rollback; Sentry; Axiom; post-action live-URL probe logged.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005, LOOP-ADMIN-012.
  - Related files: `apps/project-sites/src/routes/operator/deploys.ts`, `src/app/features/operator-deploys/`.

- [ ] LOOP-ADMIN-014: Secret management UI (names/rotation status, never plaintext)
  - Why: A solo founder manages secrets across 19 subsystems; an operator view of what exists, where, and when last rotated prevents stale-secret outages — without ever exposing values.
  - Acceptance criteria: `/admin/operator/secrets` lists secret NAMES per subsystem with set/unset status, last-rotated, and a "rotate-due" badge; trigger-rotation action queues a rotation runbook link (no value ever displayed or logged); set-new-secret flow uses `wrangler secret put` server-side, value never round-tripped to the browser.
  - Implementation notes: Values are write-only and never read back. Detect set/unset via `wrangler secret list`. (needs decision) whether rotation is automated per-vendor or runbook-guided only.
  - Hosting notes: CF Workers (secret ops); CF Pages UI shows metadata only.
  - Backing services: CF API (secret list), D1 (rotation metadata), Bitwarden (source of truth — referenced, not displayed).
  - Observability: Audit every set/rotate (name only, never value); Sentry; Axiom redacted.
  - Dependencies: LOOP-ADMIN-002 (super_admin only), LOOP-ADMIN-005.
  - Related files: `apps/project-sites/src/routes/operator/secrets.ts`, `src/app/features/operator-secrets/`.

- [ ] LOOP-ADMIN-015: Incident console
  - Why: When something breaks across 19 subsystems, the operator needs one screen to declare, track, and resolve an incident with timeline + linked errors.
  - Acceptance criteria: `/admin/operator/incidents` lists open/resolved incidents; declare incident (title, severity, affected subsystems); auto-attaches recent Sentry issues + Axiom error spikes; append timeline notes; resolve with postmortem-link field; affected-subsystem badges show on the cockpit.
  - Implementation notes: Incident state in D1; pulls live error context from Sentry on open. Solo-practical — no heavy on-call rotation, just declare/track/resolve.
  - Hosting notes: CF Workers + Pages.
  - Backing services: D1 (`incidents`), Sentry (linked issues), Axiom (error context).
  - Observability: Audit declare/resolve; Sentry cross-link; Axiom.
  - Dependencies: LOOP-ADMIN-001, LOOP-ADMIN-005.
  - Related files: `src/app/features/operator-incidents/`, `apps/project-sites/src/routes/operator/incidents.ts`.

- [ ] LOOP-ADMIN-016: Abuse / fraud review queue
  - Why: Generous-free SaaS attracts abuse; operators need a triage queue of flagged tenants (spammy sites, payment fraud signals, AI-spend spikes) with suspend/ban actions.
  - Acceptance criteria: `/admin/operator/abuse` shows flagged tenants with signal (chargeback, AI-spend anomaly, content-policy hit, rapid-site-spam), evidence links, and actions: warn, throttle, suspend, ban — each confirmed + audited; suspended tenant's sites return a controlled state, not a 500.
  - Implementation notes: Signals fed by Tinybird anomaly queries + Stripe dispute webhooks; suspension is a server-enforced tenant-status flag. (needs decision) auto-suspend thresholds vs. always-manual.
  - Hosting notes: CF Workers + Pages.
  - Backing services: D1 (`abuse_flags`, tenant status), Tinybird (anomaly signals), Stripe (disputes), Hookdeck (dispute webhooks).
  - Observability: Audit every action; Sentry; PostHog abuse-action funnel.
  - Dependencies: LOOP-ADMIN-003, LOOP-ADMIN-005, LOOP-ADMIN-010.
  - Related files: `src/app/features/operator-abuse/`, `apps/project-sites/src/routes/operator/abuse.ts`.

- [ ] LOOP-ADMIN-017: User CRUD & account remediation
  - Why: Operators must reset a stuck user — verify email, force password reset, unlock, merge duplicate accounts, transfer ownership — without DB surgery.
  - Acceptance criteria: User detail (within tenant) supports: resend/force-verify email, trigger password reset, unlock locked account, change role within org, transfer org ownership, hard-delete (GDPR) — each confirmed + audited; actions use Better Auth server APIs.
  - Implementation notes: All via Better Auth admin paths server-side; ownership transfer is two-step confirmed. orgId scoped server-side.
  - Hosting notes: CF Workers + Pages.
  - Backing services: Better Auth (D1), D1 (users/orgs).
  - Observability: Audit every remediation with `tenant_id`; Sentry; Axiom.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-003, LOOP-ADMIN-005.
  - Related files: `apps/project-sites/src/routes/operator/users.ts`, `src/app/features/operator-users/`, `src/auth/better-auth.ts`.

- [ ] LOOP-ADMIN-018: Broadcast / announcement tool
  - Why: A solo founder needs to push maintenance notices, feature announcements, or incident updates to all/segment of tenants from one place.
  - Acceptance criteria: `/admin/operator/broadcast` composes an announcement (title, body, severity, audience: all / plan / specific tenants / segment), preview, and publish; renders as an in-app banner in owner consoles and optionally emails via Resend; schedule + expiry; publish is confirmed + audited.
  - Implementation notes: In-app banners served from D1 + KV, fetched by owner console; email path via Resend. Audience targeting reuses tenant query. Behind a flag at launch.
  - Hosting notes: CF Workers + Pages.
  - Backing services: D1 (`announcements`), KV (active-banner cache), Resend (email), PostHog (engagement).
  - Observability: Audit every publish (audience + reach); Sentry; PostHog open/dismiss.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005.
  - Related files: `src/app/features/operator-broadcast/`, `apps/project-sites/src/routes/operator/broadcast.ts`.

- [ ] LOOP-ADMIN-019: Data-export & GDPR tools
  - Why: Compliance and support both require exporting or erasing a tenant's data; operators need a controlled, audited path with artifacts.
  - Acceptance criteria: Per tenant, operator can request a full data export (JSON/CSV bundle to R2 with signed expiring link) or a GDPR erasure (anonymize PII, retain financial records); both `super_admin`, confirmed, reason-required, audited; export job runs async with status; erasure produces a certificate record.
  - Implementation notes: Export assembles across subsystems into an R2 bundle; signed URL expires. Erasure is a documented multi-table anonymization, not raw delete (retain billing for tax).
  - Hosting notes: CF Workers (async job), R2 (export artifacts), CF Pages UI.
  - Backing services: D1 (job + certificate records), R2 (bundles), Queues/Workflows (async assembly).
  - Observability: Audit export + erasure (data leaves/erased = high-sensitivity); Sentry; Axiom.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-003, LOOP-ADMIN-005.
  - Related files: `apps/project-sites/src/routes/operator/data-export.ts`, `src/app/features/operator-gdpr/`.

- [ ] LOOP-ADMIN-020: Job-queue & workflow operator admin
  - Why: AI site-generation and async jobs run on Workflows/Queues; operators need to see stuck jobs, retry, and dead-letter without guessing.
  - Acceptance criteria: `/admin/operator/jobs` lists running/failed/dead-lettered jobs across Workflows + QStash with status, attempts, last-error; actions: retry, cancel, requeue-from-DLQ (confirmed + audited); per-job correlation links to Axiom/Sentry.
  - Implementation notes: Pull from CF Workflows status + Upstash QStash DLQ; retry is idempotent. Surface the most common stuck patterns inline.
  - Hosting notes: CF Workers + Pages.
  - Backing services: CF Workflows, Upstash QStash (DLQ), D1 (job mirror).
  - Observability: Audit retry/cancel/requeue; Sentry; Axiom with `request_id`.
  - Dependencies: LOOP-ADMIN-001, LOOP-ADMIN-005.
  - Related files: `src/app/features/operator-jobs/`, `apps/project-sites/src/routes/operator/jobs.ts`, `src/workflows/site-generation.ts`.

- [ ] LOOP-ADMIN-021: Webhook delivery admin (Hookdeck + Outpost)
  - Why: Inbound (Stripe/SNS) and outbound webhooks fail and need replay; operators need a delivery board with retry — especially given Bot-Fight-Mode inbound quirks.
  - Acceptance criteria: `/admin/operator/webhooks` shows inbound + outbound deliveries with status, attempts, payload (redacted), last-error; replay a failed delivery (confirmed + audited); filter by source/tenant/event; surfaces BFM-blocked inbound pattern with the workers.dev-receiver hint.
  - Implementation notes: Source delivery state from Hookdeck (inbound) + Outpost (outbound); replay via their APIs. Redact secrets in payload view.
  - Hosting notes: CF Workers + Pages.
  - Backing services: Hookdeck (inbound), Outpost (outbound), D1 (delivery mirror).
  - Observability: Audit every replay; Sentry; Axiom.
  - Dependencies: LOOP-ADMIN-002, LOOP-ADMIN-005.
  - Related files: `src/app/features/operator-webhooks/`, `apps/project-sites/src/routes/operator/webhooks.ts`, `src/routes/webhooks.ts`.

- [ ] LOOP-ADMIN-022: Cross-subsystem global search (command palette for operators)
  - Why: With 19 subsystems an operator wastes time navigating; a single search box that resolves a tenant, user, site, invoice, job, or incident to its operator detail is a force multiplier.
  - Acceptance criteria: Cmd-K palette searches across tenants, users, sites, invoices, jobs, incidents, audit entries; typed results grouped by entity; selecting jumps to that operator detail; permission-aware (read_only sees fewer entity types); sub-300ms typical.
  - Implementation notes: Server search endpoint fans out with `Promise.allSettled`, KV-cached hot terms; results carry entity-type + deep-link. AI-native: natural-language query → structured filter is a fast-follow.
  - Hosting notes: CF Workers search; CF Pages palette (reuse DialogShell).
  - Backing services: D1 (entity search), KV (hot-term cache), PostHog (search usage).
  - Observability: Sentry on search errors; Axiom; audit only on result-actions, not searches.
  - Dependencies: LOOP-ADMIN-001, LOOP-ADMIN-002.
  - Related files: `src/app/features/operator-search/`, `apps/project-sites/src/routes/operator/search.ts`.

- [ ] LOOP-ADMIN-023: CRM / support quick-links + context bridge
  - Why: Operators bounce between the cockpit and Twenty CRM / support; deep-linking a tenant into its CRM company and pulling recent support context closes the loop.
  - Acceptance criteria: Tenant detail shows a "CRM" panel deep-linking to the Twenty company record and a recent-activity summary (last contact, open items) pulled read-only; "open in CRM" + "create follow-up" actions; missing-CRM-record falls back to a calm "link account" prompt, never an error.
  - Implementation notes: Twenty via metadata API custom fields (REST 400s on unknown fields — use the metadata path); map tenant → company by stored id. Read-only context; writes are explicit + audited.
  - Hosting notes: CF Workers (Twenty API client); CF Pages panel.
  - Backing services: Twenty CRM (HTTP), D1 (tenant↔company mapping).
  - Observability: Audit any CRM write; Sentry on Twenty API errors; Axiom.
  - Dependencies: LOOP-ADMIN-003, LOOP-ADMIN-005, Twenty CRM live.
  - Related files: `apps/project-sites/src/services/twenty.ts`, `src/app/features/operator-crm/`.

- [ ] LOOP-ADMIN-024: Operator E2E-TDD coverage + feature-flag wiring for the whole console
  - Why: This operator layer touches money, secrets, and impersonation — it must be the best-tested surface in the repo and fully flag-gated, per the platform's TDD + feature-module mandates.
  - Acceptance criteria: Each operator feature ships a `libs/features/operator_<slug>/` manifest + typed flag (`enabled=0, rollout=0, stage=experimental`) + colocated Zod schemas + Jest units + `e2e/operator-<slug>/` Playwright specs starting from homepage, run against authed admin (`E2E_API_KEY`); `validate:features` passes; every sensitive action has a regression test asserting the audit row was written; disabled flag → server 404, UI null.
  - Implementation notes: Use `gen:feature` to scaffold; authed E2E via `playwright.prod.config.ts` + `E2E_API_KEY`. The audit-row-written assertion is the key invariant for every sensitive handler.
  - Hosting notes: Tests run in CI (frontend-unit + e2e gates); console ships on CF Pages/Workers behind flags.
  - Backing services: D1 (`feature_flags`/`flag_overrides`), test-mode Stripe/Resend, Tinybird test datasource.
  - Observability: CI gate on coverage; Sentry breadcrumbs carry `featureSlug`; audit-assertion tests.
  - Dependencies: ALL LOOP-ADMIN-001..023.
  - Related files: `libs/features/operator_*/`, `e2e/operator-*/`, `playwright.prod.config.ts`, `.github/workflows/feature-architecture.yml`.

## whole-app platform — Cross-Cutting Platform Capabilities

### Raw research themes considered

Surveyed ~55 raw ideas spanning the spine that turns 19 independent `<name>.projectsites.dev` subsystems into one coherent platform: shared multi-tenant identity (Better Auth) + org/RBAC model, mandatory correlation-ID propagation (tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id) across every hop, the event_bus outbox → Tinybird OLAP backbone, a typed internal service-client SDK, a shared health/heartbeat contract, the WAF-skip + DNS provisioning automation every new non-GET subdomain demands, per-tenant entitlements gating all subsystems, unified usage metering (OpenMeter) + cost attribution, a platform event taxonomy, end-to-end onboarding that lights up multiple subsystems, GDPR export/erasure spanning all stores, DR/backups, a platform design system, an internal developer platform with a golden-path subsystem template, a unified notification fabric, and platform-wide rate limiting via Unkey. The flagship primitives are the reusable spine — correlation-ID propagation, the typed internal SDK, the health contract, the event taxonomy, the entitlements gate, and the new-subsystem golden path — because they make ALL 19 subsystems cheaper to build and operate. Selection favored Cloudflare-first, solo-founder-practical primitives over one-off endpoints. Cut ~31 ideas that were single-subsystem features, premature (multi-region active-active, enterprise SSO/SAML), or duplicative of existing wiring.

### Selected 24 implementation tasks

- [ ] LOOP-PLATFORM-001: Correlation-ID propagation middleware (shared spine)
  - Why: AI is the primary maintainer; without an unbroken `trace_id` + tenant lineage across all 19 subsystems, debugging a cross-service failure is impossible.
  - Acceptance criteria: A `@projectsites/correlation` shared package injects/reads the 7 IDs (tenant_id, site_id, app_id, trace_id, job_id, api_key_id, request_id) from inbound headers (`x-ps-trace-id` etc.), generates missing ones, stamps them on `c.set()`, and re-emits them on every outbound fetch + queue message + event_bus row. A request entering any subsystem and fanning to 2 others shows ONE `trace_id` end-to-end in Axiom.
  - Implementation notes: Hono middleware + `AsyncLocalStorage`-style context; W3C `traceparent` compatible; never trust client-supplied `tenant_id` (derive from auth, mirror x-org-id IDOR fix).
  - Hosting notes: Lives in every CF Worker; zero extra host.
  - Backing services: Axiom (log correlation), Tinybird (event correlation).
  - Observability: Every structured log line carries all 7 fields; Axiom dashboard "trace waterfall by trace_id".
  - Dependencies: none (foundational — most others build on it).
  - Related files: `packages/shared/src/correlation/`, `apps/project-sites/src/middleware/request_id.ts`.

- [ ] LOOP-PLATFORM-002: Typed internal service-client SDK
  - Why: 19 subsystems calling each other with raw `fetch` + ad-hoc shapes is the #1 source of integration drift; a Zod-typed client is the highest-leverage reusable primitive.
  - Acceptance criteria: `@projectsites/service-client` exposes `client.crm.createLead(input)`-style typed methods generated per subsystem; every request/response is Zod-validated in+out; correlation IDs auto-injected (depends on -001); internal auth (Unkey service key or signed JWT) attached automatically; bad response shape throws a typed `ServiceContractError`.
  - Implementation notes: One module per subsystem under `clients/<name>.ts`; shapes declared locally (no AGPL/cross-repo type imports per AGPL-isolation rule); retry+backoff+circuit-breaker baked in.
  - Hosting notes: Library only; runs inside callers' Workers.
  - Backing services: Unkey (service-to-service keys).
  - Observability: Each call logs `service`, `method`, `durationMs`, `status`, all correlation IDs.
  - Dependencies: -001, -004 (health), -021 (rate limit honored).
  - Related files: `packages/shared/src/service-client/`.

- [ ] LOOP-PLATFORM-003: Platform event taxonomy + event_bus contract (flagship)
  - Why: The event_bus → Tinybird backbone is only useful if every subsystem emits events with a shared, versioned shape; a taxonomy is the contract that makes OLAP queries cross-subsystem.
  - Acceptance criteria: A canonical `PlatformEvent` Zod schema (`event_name` from a frozen enum `<subsystem>.<entity>.<verb>`, `event_version`, all 7 correlation IDs, `occurred_at`, `payload`) is published; a registry doc lists every legal event_name; `emitEvent()` helper rejects unknown names; Tinybird `projectsites_events` datasource columns match.
  - Implementation notes: Enum lives in shared package; CI gate fails build if a subsystem emits an event_name absent from the registry (drift-detection).
  - Hosting notes: Helper in shared lib; outbox table per DB.
  - Backing services: event_bus outbox (D1/Neon per app), Tinybird.
  - Observability: Tinybird `events_by_tenant_daily` + dead-event counter for rejected names.
  - Dependencies: -001.
  - Related files: `packages/shared/src/events/taxonomy.ts`, `apps/project-sites/src/services/event_bus.ts`, `services/tinybird.ts`.

- [ ] LOOP-PLATFORM-004: Shared health/heartbeat contract (flagship)
  - Why: An operator needs one pane to know all 19 subsystems are alive; a uniform `/health` contract is what makes a platform status board possible.
  - Acceptance criteria: Every subsystem exposes `GET /health` returning the canonical `{ status: 'ok'|'degraded'|'down', version, commit_sha, uptime_s, checks: [{name,status,latency_ms}], correlation }` Zod shape. A platform poller aggregates all 19 into `/admin/system-services` health column with last-seen + latency.
  - Implementation notes: Shared `healthHandler(checks[])` factory; checks cover backing stores (Neon/Upstash/TiDB/R2 reachability); 200 even when degraded, status in body (mirror CF-Access body-not-status gotcha).
  - Hosting notes: Handler in each Worker/Container; poller is a CF Cron Worker.
  - Backing services: per-subsystem stores; KV for last-seen cache.
  - Observability: PostHog heartbeat event + Axiom; alert on `down` via notification fabric (-018).
  - Dependencies: -001, -018.
  - Related files: `packages/shared/src/health/`, `apps/project-sites/src/routes/health.ts`, `src/services/SERVICE_REGISTRY`.

- [ ] LOOP-PLATFORM-005: New-subsystem golden-path template (flagship)
  - Why: Solo founder adds subsystems constantly; a scaffold that bakes in every cross-cutting primitive makes each new subsystem cheap and drift-free from minute one.
  - Acceptance criteria: `npm run gen:subsystem -- --slug <name>` produces a CF Worker/Container skeleton wired with: correlation middleware (-001), `/health` (-004), event emitter (-003), entitlements gate (-008), service-client registration (-002), Zod env schema, WAF-skip+DNS provisioning call (-006), Sentry (platform-only), Axiom logger, a `manifest.ts`, E2E spec dir, and a wrangler.toml with `workers_dev=true`.
  - Implementation notes: Plop/Hygen generator; copies from a maintained `template-subsystem/`; refuses to scaffold without a unique subdomain.
  - Hosting notes: Generated default = CF Workers Container; Fly only flagged for stateful/realtime.
  - Backing services: chosen by flag (Neon DB-per-app default).
  - Observability: scaffolds structured logging + heartbeat by default.
  - Dependencies: -001,-002,-003,-004,-006,-008.
  - Related files: `tools/gen/subsystem/`, `template-subsystem/`.

- [ ] LOOP-PLATFORM-006: WAF-skip + DNS provisioning automation
  - Why: Doctrine mandates every non-GET subdomain be added to the WAF skip rule + DNS provisioned via CF API; doing it by hand is the most repeated error-prone step (njsk.org wildcard incident).
  - Acceptance criteria: `provisionSubdomain(slug, {nonGet:true})` script: (a) creates the proxied DNS record via CF API, (b) appends `<slug>.projectsites.dev` to the named WAF skip ruleset, (c) ensures an explicit per-host Worker route beats the `*.projectsites.dev/*` wildcard, (d) sets `workers_dev=true`, (e) HTTP-verifies the live URL returns 200. Idempotent + re-runnable.
  - Implementation notes: Uses global CF key (`X-Auth-Key`+`X-Auth-Email`) per cloudflare-native-provisioning rule; reads existing skip rule, merges, PUTs.
  - Hosting notes: One-shot CLI / CI step; no host.
  - Backing services: Cloudflare API (DNS, WAF rulesets, Workers routes).
  - Observability: logs each CF API call + final curl status code.
  - Dependencies: none.
  - Related files: `tools/provision/subdomain.mjs`, `apps/project-sites/wrangler.toml`.

- [ ] LOOP-PLATFORM-007: Unified multi-tenant data model (tenant↔site↔app↔customer)
  - Why: Every subsystem references tenants, sites, apps, and customers differently; a canonical relational model + ID convention is the shared backbone all correlation + entitlements + billing depend on.
  - Acceptance criteria: A documented canonical schema defines `tenant`, `org`, `site`, `app`, `customer` with stable UUID v7 PKs and FK conventions; a shared `@projectsites/ids` package provides typed branded IDs (`TenantId`, `SiteId`…) + validators; a `resolveTenantContext(req)` returns the full lineage from any subsystem.
  - Implementation notes: System-of-record in D1 (`project-sites-db-production`); per-app DBs reference by ID only, never duplicate the row (neon-database-conservation). UUID v7 per uuid-version-discipline.
  - Hosting notes: SoR in CF D1; replicated read via KV cache (60s).
  - Backing services: D1 (SoR), KV (resolution cache).
  - Observability: cache hit/miss; resolution latency.
  - Dependencies: -001.
  - Related files: `packages/shared/src/ids/`, `packages/shared/src/schemas/`, `supabase/migrations/`.

- [ ] LOOP-PLATFORM-008: Per-tenant entitlements gate spanning all subsystems (flagship)
  - Why: One authoritative entitlements service that every subsystem checks before serving is what makes plan tiers real platform-wide instead of per-app guesswork.
  - Acceptance criteria: `checkEntitlement(tenantId, capability)` returns `{allowed, limit, used, reason}` from a central entitlements store; shared middleware `requireEntitlement('crm.leads.create')` returns 404 (never 403) when disabled; a capability registry enumerates every gated capability across all 19 subsystems; admin UI shows per-tenant grid.
  - Implementation notes: Entitlements derived from plan + overrides in D1; KV-cached 60s with explicit invalidation on mutation (mirror flag-cache stale bug). Server-enforced, never client.
  - Hosting notes: Central Worker + shared middleware lib.
  - Backing services: D1 (entitlements), KV (cache).
  - Observability: every gate decision logged with `capability`, `allowed`, tenant; PostHog `entitlement_denied`.
  - Dependencies: -001, -007.
  - Related files: `packages/shared/src/entitlements/`, `apps/project-sites/src/middleware/auth.ts`.

- [ ] LOOP-PLATFORM-009: Single sign-on across all consoles (Better Auth)
  - Why: 19 admin consoles each with their own login is unusable; one Better Auth session shared across all `*.projectsites.dev` consoles is table stakes.
  - Acceptance criteria: A user signs in once at `auth.projectsites.dev` and is authenticated at every subsystem console via a shared session cookie (domain `.projectsites.dev`) + central session verification; sign-out propagates everywhere; RBAC role resolved centrally.
  - Implementation notes: Better Auth ONLY (Logto/WorkOS deleted); per-request D1 session check (better-auth-cf-gotchas: cookieCache bug #4203, TTL floor); static schema migration applied before cutover.
  - Hosting notes: Auth Worker at auth.projectsites.dev; KV session cache.
  - Backing services: D1 (sessions/users), KV (cache).
  - Observability: login/logout events with correlation; failed-auth rate.
  - Dependencies: -001, -007.
  - Related files: `apps/project-sites/src/auth/better-auth.ts`, `src/services/auth`.

- [ ] LOOP-PLATFORM-010: Unified org/RBAC model + shared permission middleware
  - Why: Authorization fragmented per subsystem leaks permissions; one role/permission matrix enforced by shared middleware is the only way to reason about access platform-wide.
  - Acceptance criteria: Canonical roles (owner/admin/member/viewer) + a permission matrix per capability live in shared config; `requirePermission('billing.write')` middleware enforces; orgId always derived server-side from session (`c.get('orgId')`, never client `x-org-id` — IDOR class); denial returns human-readable Problem Details envelope.
  - Implementation notes: Reuse `packages/shared/src/middleware/` RBAC; matrix versioned; AI search is permission-aware via this layer.
  - Hosting notes: Shared lib in every Worker.
  - Backing services: D1 (memberships).
  - Observability: RBAC decision logs (policy-decision boundary).
  - Dependencies: -007, -009.
  - Related files: `packages/shared/src/middleware/`, `packages/shared/src/constants/ROLES`.

- [ ] LOOP-PLATFORM-011: Unified usage metering across services (OpenMeter)
  - Why: Billing + entitlements need a single source of metered usage; piping every subsystem's usage events into OpenMeter is the platform's metering spine.
  - Acceptance criteria: A `meter(tenantId, meter_slug, value)` helper emits CloudEvents to OpenMeter; every billable action across subsystems (AI tokens, site publishes, API calls, storage) reports through it; OpenMeter aggregates per tenant per meter; usage queryable for billing + entitlement `used` counts.
  - Implementation notes: Events also mirror to event_bus → Tinybird for analytics; idempotent via dedup key (request_id).
  - Hosting notes: OpenMeter (self-host or cloud — needs decision); helper in shared lib.
  - Backing services: OpenMeter, event_bus, Tinybird.
  - Observability: metering lag; per-meter volume in Tinybird.
  - Dependencies: -001, -003, -007.
  - Related files: `packages/shared/src/metering/`, `services/tinybird.ts`.

- [ ] LOOP-PLATFORM-012: Unified billing — plan↔entitlement↔meter wiring (Stripe)
  - Why: A platform charges once across 19 subsystems; one billing service mapping Stripe subscriptions → entitlements → metered overage is the commercial backbone.
  - Acceptance criteria: Stripe subscription/usage webhooks update central entitlements (-008); plan change re-derives capabilities platform-wide within 60s; metered overage from OpenMeter (-011) reported to Stripe; single billing portal at `billing.projectsites.dev`.
  - Implementation notes: Stripe per payments-routing (SaaS recurring = Stripe Billing); webhook idempotency via D1; test-mode for loop verification.
  - Hosting notes: Billing Worker; webhook receiver on workers.dev (Bot-Fight-Mode blocks inbound on apex).
  - Backing services: Stripe, D1, OpenMeter.
  - Observability: webhook processing logs; subscription state transitions as events.
  - Dependencies: -008, -011.
  - Related files: `apps/project-sites/src/services/billing`, `src/routes/webhooks.ts`.

- [ ] LOOP-PLATFORM-013: Cost-attribution per tenant across services
  - Why: Solo founder must know which tenants are profitable; attributing infra cost (CF, Neon, Tinybird, AI tokens) per tenant turns usage data into margin data.
  - Acceptance criteria: A nightly job joins OpenMeter usage (-011) + per-vendor cost rates → a `tenant_cost_daily` Tinybird datasource showing cost-per-tenant per service; `/admin/cost-attribution` shows margin (revenue − cost) per tenant.
  - Implementation notes: Cost rates in config (CF/Neon/Tinybird/Workers AI unit prices); AI token cost from metering; correlation IDs make per-tenant attribution possible.
  - Hosting notes: CF Cron Worker writes to Tinybird.
  - Backing services: Tinybird, OpenMeter, D1.
  - Observability: cost dashboard; alert on negative-margin tenant.
  - Dependencies: -011, -003.
  - Related files: `tools/cron/cost-attribution.mjs`, `services/tinybird.ts`.

- [ ] LOOP-PLATFORM-014: End-to-end onboarding flow lighting up multiple subsystems
  - Why: First value requires several subsystems (auth, site gen, CRM, billing) to activate in sequence; a single orchestrated onboarding is the platform's front door.
  - Acceptance criteria: A new tenant signup triggers a workflow that: creates org (-007), provisions a default site, seeds CRM, sets free-tier entitlements (-008), emits `platform.tenant.onboarded`, and surfaces a guided checklist at `/admin` (Getting Started hub). Each step idempotent + resumable.
  - Implementation notes: CF Workflow orchestrates cross-subsystem calls via service-client (-002); each step a compensating saga step.
  - Hosting notes: Cloudflare Workflows.
  - Backing services: D1, event_bus, service-client targets.
  - Observability: per-step events with shared trace_id; funnel in Tinybird `activation_funnel`.
  - Dependencies: -002, -003, -007, -008.
  - Related files: `apps/project-sites/src/workflows/`, dashboard Getting Started hub.

- [ ] LOOP-PLATFORM-015: Platform-wide GDPR data export + erasure across all stores
  - Why: A subject-access/erasure request must span D1, Neon, TiDB, R2, Tinybird, and every subsystem; a fan-out orchestrator is the only compliant approach.
  - Acceptance criteria: `POST /privacy/export` and `/privacy/erase` for a tenant/customer fan out to a registered handler per subsystem (each implements a `dataExport(subjectId)` / `dataErase(subjectId)` contract); results assembled into a signed R2 bundle (export) or verified-deletion report (erase) within SLA.
  - Implementation notes: Subsystems self-register their handlers in a privacy registry; correlation IDs scope the subject; Tinybird erasure via mutation/TTL (needs decision: append-only OLAP retention policy).
  - Hosting notes: CF Workflow orchestrator + per-subsystem handler endpoints.
  - Backing services: all stores; R2 (export bundles).
  - Observability: per-store completion events; compliance audit log.
  - Dependencies: -002, -007.
  - Related files: `packages/shared/src/privacy/`, `tools/privacy/`.

- [ ] LOOP-PLATFORM-016: Disaster recovery + backups across all stores
  - Why: One platform needs one DR posture; per-store backups with a documented restore runbook is the safety net.
  - Acceptance criteria: Automated backups verified for D1 (Time Travel), Neon (PITR/branch), TiDB (snapshot), R2 (versioning), Upstash (daily backup); a `tools/dr/restore-runbook.md` with tested restore steps per store; a weekly DR-check Cron asserts backup freshness + alerts on staleness.
  - Implementation notes: Reuse mcp__upstash daily-backup + mcp__neon branch + R2 versioning; restore drills logged.
  - Hosting notes: DR-check is a CF Cron Worker.
  - Backing services: D1, Neon, TiDB, R2, Upstash.
  - Observability: backup-age metric per store; alert via -018.
  - Dependencies: -004, -018.
  - Related files: `tools/dr/`, `docs/DEPLOYMENT.md`.

- [ ] LOOP-PLATFORM-017: Platform-wide design system + shared console shell
  - Why: 19 consoles must look like one product; a shared black+cyan design-token package + console shell makes every subsystem UI consistent and cheaper to build.
  - Acceptance criteria: `@projectsites/ui` ships the cyan/black tokens (`--ps-bg`,`--ps-ink`,`--ps-accent`, z-layers, radii, shadows), the `DialogShellComponent` primitive, nav shell, and Storybook docs at storybook.projectsites.dev; every console imports the shell; hard-coded brand colors fail an audit.
  - Implementation notes: Tokens in `_polish.scss`/`_cockpit.scss`; one dialog primitive (custom modals = drift); Storybook hosts only generated-site + console blocks.
  - Hosting notes: Storybook on CF Pages; lib consumed at build time.
  - Backing services: none.
  - Observability: audit gate counts hard-coded colors / custom modals.
  - Dependencies: none.
  - Related files: `_polish.scss`, `_cockpit.scss`, design-system package, Storybook.

- [ ] LOOP-PLATFORM-018: Unified notification fabric (psnotify)
  - Why: Operational + tenant notifications must flow through one fabric, not 19 ad-hoc channels; psnotify is Brian's mandated custom build (ZERO Novu).
  - Acceptance criteria: A `notify({audience, severity, event, deep_link, correlation})` API routes to channels (in-app inbox DO, web-push, SES email) with per-tenant + per-user preferences; every notification carries what-happened / why-it-matters / what-to-do-next + correlation metadata; a notification center UI + preferences page.
  - Implementation notes: psnotify = DO inbox + center + prefs + SES/web-push (feedback_no_novu); subscribes to event_bus taxonomy events.
  - Hosting notes: CF Durable Object (inbox) + Worker; SES for email.
  - Backing services: DO storage, SES, web-push (VAPID), event_bus.
  - Observability: delivery success per channel; unread counts.
  - Dependencies: -001, -003.
  - Related files: `apps/project-sites/src/services/notifications`, psnotify module.

- [ ] LOOP-PLATFORM-019: Platform status board + incident timeline
  - Why: Operator + tenants need one live view of platform health; the health contract (-004) plus events (-003) make a real status page possible.
  - Acceptance criteria: `status.projectsites.dev` shows per-subsystem status (from -004 poller), open incidents, and a 90-day uptime history; an internal `/admin/incidents` lets the operator post/resolve incidents that fan to the notification fabric (-018); uptime computed from heartbeat events.
  - Implementation notes: Public read-only page (cacheable); incident state in D1; uptime from Tinybird heartbeat aggregation.
  - Hosting notes: CF Worker + Pages; KV-cached status snapshot.
  - Backing services: D1, Tinybird, KV.
  - Observability: it IS observability — status snapshot freshness alarm.
  - Dependencies: -004, -003, -018.
  - Related files: `apps/project-sites/src/routes/status`, status page.

- [ ] LOOP-PLATFORM-020: Secret provisioning automation across subsystems
  - Why: Each new subsystem needs the same secret-wiring dance; automating chezmoi→manifest→Env+Zod→`wrangler secret put` removes the most tedious per-subsystem chore.
  - Acceptance criteria: `provisionSecrets(subsystem)` reads a per-subsystem secret manifest, pulls values via `get-secret` (chezmoi/COMMON_SECRETS), validates against the subsystem's Zod `EnvSchema`, and runs `wrangler secret put` for each (global CF key, no Docker needed); reports missing secrets before deploy.
  - Implementation notes: Follows secret-provisioning-recipe; never echoes secret values; CF-native secrets (Turnstile etc.) retrieved via CF API not asked of user.
  - Hosting notes: CLI/CI step.
  - Backing services: chezmoi/get-secret, Cloudflare secrets, Bitwarden (optional source).
  - Observability: logs which secrets set/missing (names only).
  - Dependencies: -005.
  - Related files: `tools/provision/secrets.mjs`, per-subsystem `EnvSchema`.

- [ ] LOOP-PLATFORM-021: Platform-wide rate limiting (Unkey + DO counter)
  - Why: A coherent platform enforces consistent abuse limits per tenant/api-key across all subsystems, not per-app guesses; CF managed rate-limiting doesn't enforce on this plan, so a shared limiter is required.
  - Acceptance criteria: `rateLimit(key={tenantId|apiKeyId}, bucket, limit, window)` shared helper backed by a Durable Object counter (rate-limiting-plan-gated); Unkey API keys carry per-key limits honored platform-wide; over-limit returns a friendly Problem Details + `Retry-After`; limits configurable per entitlement tier.
  - Implementation notes: DO sliding-window counter; api_key_id from Unkey verification flows into correlation IDs.
  - Hosting notes: Shared limiter Durable Object.
  - Backing services: Unkey (key limits), DO (counter), Upstash Redis (optional global counter).
  - Observability: rate-limit-hit events per tenant/key; PostHog `rate_limited`.
  - Dependencies: -001, -008.
  - Related files: `packages/shared/src/ratelimit/`, Unkey integration.

- [ ] LOOP-PLATFORM-022: Service mesh + subdomain routing conventions registry
  - Why: With 19 subsystems on subdomains, a single source of truth for "which host, which route, which auth, which host-type" prevents the wildcard-shadow + workers_dev incidents.
  - Acceptance criteria: A `SERVICE_REGISTRY` typed config lists every subsystem: subdomain, host type (Worker/Container/Fly), explicit route pattern (must beat `*.projectsites.dev/*`), `workers_dev` flag, WAF-skip status, health URL, auth requirement; a validator asserts each registry entry has a matching DNS record + WAF skip entry + live 200.
  - Implementation notes: Registry drives -004 poller, -006 provisioning, -017 nav, and `/admin/system-services`; Fly minimized (stateful/realtime/24-7 only).
  - Hosting notes: Config + validator Cron.
  - Backing services: Cloudflare API (verify DNS/routes/WAF).
  - Observability: drift alarm when registry ≠ live CF state.
  - Dependencies: -004, -006.
  - Related files: `apps/project-sites/src/services/SERVICE_REGISTRY`, `tools/validate/mesh.mjs`.

- [ ] LOOP-PLATFORM-023: Cross-subsystem audit log (append-only, tamper-evident)
  - Why: Compliance + debugging need one immutable record of who-did-what across all 19 subsystems; a shared audit emitter unifies it.
  - Acceptance criteria: `audit({actor, action, target, tenantId, correlation})` writes to an append-only audit store from any subsystem; entries hash-chained (each row includes prev-hash) for tamper-evidence; `/admin/audit` is filterable by tenant/actor/action with all correlation IDs; exported into GDPR bundle (-015).
  - Implementation notes: Reuse existing `services/audit`; mirror to event_bus → Tinybird for queryability; never store secrets/PII raw (redact).
  - Hosting notes: D1 append-only table + Tinybird mirror.
  - Backing services: D1, Tinybird.
  - Observability: audit volume per subsystem; gap detection in hash chain.
  - Dependencies: -001, -003.
  - Related files: `apps/project-sites/src/services/audit`, `packages/shared/src/audit/`.

- [ ] LOOP-PLATFORM-024: Feature-architecture validator + drift CI gate (platform-wide)
  - Why: 19 subsystems × the feature-module rule = constant drift risk; one validator enforcing the spine (flag, manifest, schemas, E2E, correlation, health, event taxonomy) keeps the whole platform honest.
  - Acceptance criteria: `npm run validate:platform` checks across all subsystems: every capability has a feature flag + `manifest.ts` (7 fields), Zod schemas not duplicated, E2E dir present, every emitted event_name in the taxonomy (-003), every subsystem has `/health` (-004) + correlation middleware (-001) + a SERVICE_REGISTRY entry (-022) + WAF-skip if non-GET (-006); CI blocks merge on any violation.
  - Implementation notes: Extends existing `validate:features`; portable-audit fallbacks so partial subsystems still scan; HIGH/MEDIUM/LOW confidence per validator-precision-discipline.
  - Hosting notes: CI + lefthook pre-push.
  - Backing services: none (static analysis).
  - Observability: drift report artifact per CI run.
  - Dependencies: -001, -003, -004, -006, -022.
  - Related files: `tools/validate/platform.mjs`, `.github/workflows/feature-architecture.yml`.




---

# ⚡ AI Business Platform — Strategic Connections (2026-06-29)

> **Why this section exists:** The 480 tasks above are the *how* — implementation details a loop agent can program.
> These 280 strategic connections are the *why* — how each subsystem specifically enables ProjectSites.dev
> to be the ultimate automated AI business platform. Every idea ties a service to the platform's core mission:
> zero-touch provisioning, AI-native experiences, compounding cross-subsystem value, and autonomous operations.
>
> Generated via parallel research agents mining the existing 480 tasks + web research + codebase inspection.
> 14 ideas per subsystem × 20 subsystems = 280 strategic connections.

## api.projectsites.dev — Unkey: AI Business Platform Connections

- **Auto-Provisioned API Keys for Every AI-Generated Site**: When the AI build pipeline creates a customer site, it simultaneously provisions a scoped Unkey API key with site-limited permissions, enabling automated content updates, analytics queries, and third-party integrations without any manual credential setup.
- **MCP/Agent Keys with AI-Delegated Scope**: AI agents operating on behalf of a tenant autonomously request and receive narrow, revocable Unkey credentials scoped to specific tools and routes, eliminating human-in-the-loop key issuance for the platform's own agent fleet.
- **AI-Driven Abuse Detection Across Tenant Keys**: A scheduled job queries Tinybird for per-key anomalies (sudden 10x spike, geo-shift, error-rate burst) and auto-throttles suspicious keys via Unkey quota adjustments, preventing platform abuse without human operator intervention.
- **Self-Healing Key Rotation on Leak Signals**: The abuse-detection pipeline integrates with public-leak scanning; when an exposed key is detected, the system automatically revokes the old key and issues a replacement within the overlap window, maintaining zero downtime during the rotation.
- **AI Credit Enforcement on Generated-Site API Calls**: Every API call from an AI-generated site deducts from a per-key AI credit pool managed by Unkey; insufficient credits return a 402 with an auto-generated upgrade link, monetizing API usage without any billing configuration by the tenant.
- **Zero-Touch Key Provisioning at Tenant Signup**: When a business owner signs up and their site is generated, the pipeline automatically creates a tenant root key, a per-site scoped key, and a read-only analytics key — all with appropriate rate limits and quotas — completing in under 2 seconds.
- **Natural Language Key Permissions in Developer Portal**: Customers describe access needs in plain English ("read analytics for my site, no write access"), and an AI layer translates the intent into Unkey scope/permission metadata, lowering the barrier for non-developer site owners.
- **Automated API Cost Metering per Route**: The metering pipeline classifies each API route by compute cost (AI generation vs simple CRUD) and attributes per-route spending to the tenant's Unkey usage record, enabling transparent cost breakdowns and AI-informed pricing recommendations.
- **Dynamic Quota Rebalancing Based on Tenant Tier**: When a tenant upgrades or downgrades their plan, the entitlements engine recalculates Unkey `remaining` and `refill` values in real time, eliminating any provisioning window or manual adjustment.
- **API Usage Dashboard with AI-Generated Insights**: The Tinybird-powered per-key analytics feed an admin dashboard that surfaces natural-language observations ("Your key saw a 40% error rate spike at 3am — review your webhook receiver") without the tenant ever querying raw logs.
- **Cross-Tenant S2S Key Mesh Auto-Provisioned**: When a new internal microservice (mail, CRM, social publisher, billing) is deployed, the system automatically issues a scoped S2S Unkey key and distributes it to the service's Workers secret store, eliminating any manual credential management for platform operators.
- **Read-Only Reporting Keys Auto-Generated per Site Publish**: Every time an AI-generated site moves to `published`, the platform creates a read-only Unkey key scoped to that site's analytics endpoints, ready for embedding in dashboards or sharing with agency clients.
- **AI Cost-Optimized Model Selection at Gateway Level**: The `apiKeyAuth` middleware enriches each request with the key's usage history, enabling an AI router to select the cheapest model tier or fastest cache strategy per call based on the key's remaining quota and historical SLA adherence.
- **Administrative Override Console with Natural Language Actions**: The platform operator can type "suspend all keys for tenant ABC that were used in the last hour" into the admin console, and the AI translates that into batched Unkey revocation calls with full audit trail.

## auth.projectsites.dev — Better Auth: AI Business Platform Connections

- **Auto-Provisioned OAuth Client for Every Generated Site**: When the AI build pipeline publishes a customer site, it simultaneously registers an OAuth 2.0 client in the platform's OIDC provider, enabling "Sign in with ProjectSites" on the generated site with zero configuration by the site owner.
- **Zero-Touch Enterprise SSO from Domain Detection**: When a tenant adds a corporate email domain, the platform's AI automatically detects the domain's SSO provider (Okta, Azure AD, Google Workspace) and configures a WorkOS SAML/OIDC connection behind the scenes, eliminating the enterprise onboarding delay.
- **AI-Guided Passkey Enrollment at Scale**: After a user's second login, the platform proactively recommends passkey registration with device-specific guidance ("Your iPhone supports passkeys — enable for instant login"), driving phishing-resistant adoption without a manual security settings hunt.
- **Agent Identity with Self-Service Delegated Tokens**: AI agents (MCP servers, scheduled workflows, background jobs) dynamically request on-behalf-of tokens scoped to the originating user's permissions, enabling autonomous operation with full audit attribution and independent revocation.
- **Automatic Account Linking Across Provider Logins**: When a user signs in with Google then later with email on the same platform, the AI correlates verified email addresses and merges identities transparently, eliminating duplicate accounts without forcing the user to manually unify profiles.
- **Session Risk Scoring with AI-Driven Step-Up**: The session policy engine evaluates device fingerprint, IP reputation, geo-velocity, and behavior patterns in real time; anomalous requests trigger a step-up challenge (passkey or OTP) before granting access to sensitive billing or site-management operations.
- **Customer-Site Auth SDK Tailored Per Build**: Each generated site's build includes a minified, pre-configured JS SDK drop-in that connects to the platform OIDC provider with the site's auto-provisioned client ID already baked in, rendering auth setup to a single `<script>` tag.
- **Org Auto-Provisioning from Business Research Data**: During the AI research phase of site generation, the system extracts business hierarchy, team roles, and member emails, then auto-creates the org structure in Better Auth's organization plugin, provisioning owner/admin/member roles without manual entry.
- **AI-Recommended Role Assignment on Invite**: When a tenant sends an invite, the AI analyzes the invitee's email domain and past platform interactions to suggest the optimal role (member vs admin vs viewer) and pre-approve access scopes, reducing the role-selection decision to one click.
- **Cross-Tenant SSO Trust Mesh for Agencies**: When an agency org creates sub-orgs for client sites, the platform auto-propagates SSO trust relationships, so a single identity provider session authenticates the user across all managed client projects without repeated logins.
- **Continuous Auth Audit with AI Anomaly Correlation**: The tamper-evident audit log feeds an AI correlation engine that links failed login attempts on one tenant with successful token misuse on another, surfacing credential-stuffing campaigns that no single-tenant view would reveal.
- **JWKS Rotation AI-Scheduled at Low Traffic**: The signing key rotation cron uses historical token issuance patterns to execute rotated-key publication during the platform's global low-traffic window, minimizing cache-miss storms from client-side JWK refreshes.
- **AI-Guided Account Recovery with Fraud Prediction**: When a user initiates account recovery, the system evaluates login velocity, device history, and notification-read receipts to compute a fraud probability score; high-risk recoveries require video verification or admin approval before the reset link is sent.
- **Bot Prevention with Adaptive Turnstile Challenge Tiers**: The auth abuse layer uses ML-classified traffic patterns to dynamically escalate challenges — low-risk automation gets a silent Turnstile pass, moderate-risk gets a checkbox challenge, and credential-stuffing bursts get a full proof-of-work challenge before login is even attempted.

## billing.projectsites.dev — Stripe + OpenMeter: AI Business Platform Connections

- **Zero-Touch Subscription Provisioning on Site Creation**: Every AI-generated customer site automatically provisions a Free Tier Stripe subscription with locally cached OpenMeter entitlements before the site's first visitor arrives, eliminating any billing setup delay in the signup-to-site flow.
- **AI-Predicted Plan Upgrade with One-Click Checkout**: The entitlements engine determines that a tenant is approaching their API call or AI credit limit and generates a personalized checkout link to the optimal plan tier, pre-filled with the tenant's actual usage data and an estimated monthly savings comparison.
- **AI Credit Wallet Auto-Top-Up at Configurable Threshold**: The prepaid wallet monitors consumption velocity against the remaining balance; when the wallet drops below an AI-computed safety threshold (based on the user's peak-hour spend patterns), the system auto-charges the saved payment method for a refill.
- **Per-Site Profitability LEDGER with AI Cost Attribution**: The margin dashboard uses AI to classify each metered event (AI token, email send, browser run) by source site, then computes negative-margin sites and auto-generates optimization suggestions delivered to the site owner's inbox.
- **Dunning Sequence with AI-Optimized Dispatch Time**: The dunning engine uses tenant-specific payment-open and email-open patterns to select the optimal retry time for each failed invoice, increasing recovery rates without platform operator involvement.
- **Runaway Cost Auto-Suspension via AI Anomaly Detection**: The usage anomaly pipeline computes a rolling z-score per meter per tenant; when AI credit burn exceeds 3-sigma, it auto-tightens the quota ceiling and sends an explanatory notification, preventing surprise invoices without manual monitoring.
- **Agency Billing Pool with AI-Consolidated Invoices**: For agency reseller accounts, the system aggregates usage from all sub-orgs into a single parent-meter in OpenMeter, generating one consolidated Stripe invoice with per-client line items, all without the agency admin manually running reports.
- **Quota Enforcement as Real-Time AI Planning Signal**: Before executing an expensive AI generation, the build pipeline checks `enforceQuota`; the remaining budget is passed into the AI's prompt as a constraint, enabling the model to make cost-quality tradeoffs autonomously without hard blocking.
- **Add-On Marketplace with AI Cross-Sell at Checkout**: When a tenant lands on the pricing page, the platform's AI analyzes their usage patterns across all meters and surfaces the most relevant add-ons (more storage, premium templates, custom domain) with personalized copy and estimated value.
- **Grace Period State Machine with AI Recovery Prediction**: The grace-to-suspend transition evaluates tenant engagement, past recovery, and support ticket sentiment to predict which accounts will recover; high-recovery-probability accounts get extended grace, while dormant accounts transition efficiently.
- **Usage Dashboard with AI-Generated Natural Language Briefing**: The Tinybird rollup endpoint feeds a weekly AI-generated billing summary for each tenant ("Your site served 12,000 visitors, consuming 85% of your API quota. Upgrading to Pro would save you $5/month at this volume.").
- **Metered AI Model Cost Correlation for Margin Precision**: The metering pipeline logs the specific model used (GPT-4o, Claude Sonnet, Llama 3.3) per AI request; the profitability ledger then attributes the exact inference cost to each tenant site, enabling model-level margin analysis without approximation.
- **Coupon Offer Optimization via ML Segment Selection**: When creating a promo campaign, the admin console suggests optimal coupon configurations (percent off vs amount off, duration) and target tenant segments based on historical redemption and retention data, auto-generated by the platform's ML layer.
- **Billing Audit Ledger as Foundation for AI Fraud Detection**: The immutable `billing_audit` table provides a clean, append-only training signal; the platform's AI analyzes cross-tenant billing event streams to detect refund abuse, coupon stacking, and suspicious usage patterns before they reach human attention.

## webhooks.projectsites.dev — Hookdeck + Outpost: AI Business Platform Connections

- **AI-Generated Sites Auto-Emit Lifecycle Events**: Every site publish, deploy failure, domain verification, and provisioning milestone emits a canonical `PlatformEvent`, enabling customers to build webhook-driven automation (auto-rebuild on source change, Slack notifications on deploy) without writing any integration code.
- **AI-Auto-Tuned Endpoint Configuration at Registration**: When a customer registers a webhook endpoint, the platform probes the endpoint's response times, error patterns, and rate-limit headers, then auto-configures the per-endpoint retry schedule, concurrency cap, and signing secret rotation cadence without manual tuning.
- **Self-Healing Delivery with AI Failover Routing**: When an endpoint enters `disabled_unhealthy`, the AI analyzes alternative endpoints registered by the same tenant and auto-selects a backup delivery target, maintaining event delivery without customer intervention.
- **Event-Driven AI Re-Generation Pipeline**: A `site.content_updated` webhook from an external CMS triggers the AI build workflow, which re-runs the research and generation pipeline on the updated content, then deploys the refreshed site — closing the loop from third-party content change to live site.
- **Natural Language Event Inspector for Customer Debugging**: Customers type "show me all failed deliveries for billing events yesterday" into the platform admin, and the AI translates this into a filtered Tinybird query against tenant-isolated delivery logs, returning a human-readable debugging summary.
- **AI-Generated Payload Transformations from Receiver Schema**: When a customer endpoint responds to a test event, the platform's AI analyzes the 400/422 response and suggests a JSONata transformation that reshapes the platform envelope to match the receiver's expected schema, generated in one click.
- **Predictive Endpoint Health Scoring with Preemptive Disable**: The delivery-log analytics train a model that predicts endpoint failure (based on latency trends, error-rate velocity, and TLS certificate age); endpoints predicted to fail within 12 hours are preemptively paused and the customer is notified before delivery interruption.
- **Automated HMAC Secret Rotation at Low-Volume Hours**: The per-endpoint signing secret rotation cron uses each endpoint's historical delivery volume to pick the rotation window that minimizes overlap-confusion for receivers, executing the zero-downtime key swap without operator scheduling.
- **Cross-Tenant Event Correlation for Platform AI Insights**: Aggregated, anonymized `PlatformEvent` streams across all tenants feed AI models that detect platform-wide incidents (a CDN latency spike visible across 30% of endpoints) before any single tenant would notice.
- **Event Volume Anomaly Detection with Auto-Scale Signal**: The Hookdeck inbound gateway monitors per-source event velocity; an anomalous spike in `billing.invoice.paid` events triggers an auto-scaling signal to the fanout worker and alerts the platform operator with the likely root cause.
- **One-Sentence Event Subscription from Natural Language**: Customers write "let me know when my site publishes" and the AI registers the appropriate `site.published` subscription on their primary endpoint with the right glob pattern, removing the need to navigate event-type catalogs.
- **AI-Generated AsyncAPI Consumer Docs from Event Registry**: Every time a new `PlatformEvent` type is registered, the system auto-generates the corresponding AsyncAPI spec entry, consumer code snippets in Node/Python/Go, and a verification endpoint that customers can test against — all published before the first event fires.
- **Cross-Subsystem Event Correlation for AI Root-Cause Analysis**: The fanout event bus links `apikey.suspicious_use` events with `billing.anomaly_detected` and `delivery.throttled` events sharing the same `trace_id`, enabling the platform's AI to reconstruct multi-subsystem incident timelines autonomously.
- **Webhook Testing UI with AI-Generated Sample Payloads**: The inspector and testing UI pre-fills sample `PlatformEvent` payloads with realistic tenant-scoped data drawn from the event registry, letting customers send test events with one click against their endpoint without manually crafting JSON.

## integrations.projectsites.dev — Nango: AI Business Platform Connections

- **AI-Triggered Reconnect Funnel**: When integration health drops to "broken," the AI concierge auto-generates an email via mail.projectsites.dev with a one-click reconnect link, then creates a Chatwoot ticket if the token can't be refreshed automatically — closing the detection-to-resolution loop without human intervention.
- **Zero-Touch OAuth Provisioning for New Sites**: When a new site is generated, the platform auto-provisions default integrations (Google My Business, Google Analytics, Search Console) using the site owner's existing Google session, so every site launches with analytics and local-SEO wiring already connected.
- **AI Action Cross-Subsystem Compounding**: The AI concierge can create a HubSpot contact (via Nango CRM pack), sync it to Twenty CRM, and enroll it in a Listmonk drip campaign — all from a single natural-language request, turning integrations into an agent-execution fabric.
- **CRM-Triggered Integration Sync Activation**: When Twenty CRM detects a new deal at "Closed Won" stage, Nango auto-connects the customer's QuickBooks or Xero account for invoicing and syncs billing contacts into the platform's email lists without any setup.
- **Sync Health Dashboard with AI Remediation**: The Tinybird sync-observability spine powers an admin dashboard that shows sync lag per provider; the AI agent analyzes failure patterns (e.g., recurring rate limits) and auto-suggests staggered schedules or batch-size adjustments.
- **Integration Marketplace with AI Recommendations**: The marketplace catalog is surfaced inside the AI concierge chat — a site owner says "I need email marketing" and the concierge recommends Mailchimp, checks if OAuth creds exist, and walks the owner through the one-click connect flow.
- **Automated Compliance Sync for Regulated Industries**: For medical/legal site owners, the AI detects the industry from site content and auto-provisions HIPAA-compliant integrations (secure document sync via Google Drive with restricted sharing, encrypted CRM sync) without the owner knowing the compliance rules.
- **Cross-Platform Social Posting via Integrations Edge**: When social.projectsites.dev schedules a post, the Nango action layer simultaneously pushes the same content to Google Business Profile posts and WordPress via the integration fabric, creating true cross-channel publishing.
- **Integration Billing Metering as a Growth Lever**: The sync-volume metering engine (Tinybird + Stripe) drives a freemium integration tier (3 connections free) with an AI-generated upgrade email when the owner hits their cap, containing a personalized ROI summary of what they'd gain from paid sync.
- **AI-Powered Credential Rotation for Security Compliance**: For sensitive providers (QuickBooks, Stripe), the credential-refresh engine proactively rotates API keys quarterly; the AI concierge notifies the owner via Mail with a one-click re-consent link, turning a security requirement into an automated trust signal.
- **Event-Driven Campaign Attribution via Integration Webhooks**: The Hookdeck webhook gateway fans integration sync events into Dub's attribution pipeline — when a new subscriber syncs from HubSpot, Dub attributes the source UTM campaign, and the analytics dashboard shows which marketing channel produced which integration activation.
- **Conflict Resolution as a Zero-Touch Service**: The sync conflict engine auto-resolves 90% of bidirectional sync conflicts using last-write-wins with field-level diffs; the AI concierge presents the remaining 10% as a digest in Twenty CRM with suggested merge decisions the owner approves in one click.
- **Deferred Sync for Unpaid Sites as an Upgrade Funnel**: Unpaid sites get delayed sync (4-hour lag) while paid sites get sub-5-minute sync; the AI analyzes which site would benefit most from real-time sync and sends a targeted upgrade offer with examples of what they're missing.
- **Nango as the Platform's Integration Fabric for Customer Apps**: The same Nango control plane that powers ProjectSites' own integrations is packaged as a resold capability — site owners building custom apps on the platform get a self-serve integration marketplace with the same OAuth connect flow, credential management, and health scoring.

## mail.projectsites.dev — Listmonk: AI Business Platform Connections

- **AI-Generated Local Business Content Calendar**: From the site's brand voice (extracted during site generation) and seasonal industry triggers, Listmonk auto-generates a 12-month campaign calendar with AI-written newsletter drafts — a restaurant gets a "Summer Specials" series, an HVAC company gets "Seasonal Maintenance Tips," all scheduled, reviewed, and ready-to-send.
- **Abandoned Claim to Activated Owner Funnel**: When a site claim is started but not completed, Listmonk fires a 3-email recovery sequence (invite, day-3 reminder, day-7 offer) with personalized content drawn from the claimed business's Google Places data; completion triggers a transition into the onboarding campaign.
- **Subscription-Based Newsletters as a Monetizable Feature**: Site owners can offer paid newsletter subscriptions via Stripe Connect; Listmonk manages subscriber tiers, List-Unsubscribe compliance automatically, and the billing sync ensures a cancelled subscription moves the reader to a "lapsed" segment for win-back campaigns.
- **Cross-System Behavioral Segmentation**: Open/click signals from Listmonk are piped via Tinybird back to Twenty CRM as activity timeline entries; a lead who opens 3+ emails gets auto-assigned a higher lead score, triggering a sales task in Twenty CRM and a warm-transfer note in Chatwoot.
- **AI Weekly Performance Briefing for Site Owners**: Every Monday, the AI concierge generates a plain-language deliverability report (open rate, bounce rate, list growth compared to industry benchmarks) and sends it via the platform notification system, with a "Generate This Week's Campaign" one-click CTA.
- **CRM-Triggered Drip Campaigns for Lifecycle Stages**: When Twenty CRM moves an opportunity to "Trial Active," Listmonk auto-enrolls the contact in a 5-email onboarding sequence; when it moves to "Churned," a re-engagement campaign triggers — all without the owner configuring a single automation rule.
- **Intelligent Sending-Domain Warmup for New Customers**: For site owners who bring a custom sending domain, the warmup scheduler auto-ramps volume over 30 days, and the AI concierge monitors reputation metrics, pausing deployment only when bounce rates threaten deliverability across all tenants.
- **AI Compliance Audit for Outbound Campaigns**: Before every campaign send, an LLM scan checks for CAN-SPAM compliance (physical address present, unsubscribe link working, no deceptive subject lines), flagging violations with suggested fixes; the campaign auto-holds until compliance is confirmed.
- **Zero-Touch Transactional Email Provisioning**: Every new generated site gets an auto-provisioned transactional email pipeline (order confirmations, booking receipts, magic links, contact form auto-replies) using per-tenant branding, with no site owner configuration beyond verifying their sending domain.
- **Post-Chat Support Follow-up Automation**: After a Chatwoot conversation closes, Listmonk sends a personalized follow-up email with a CSAT survey; if the CSAT is low, triggers a support escalation in Twenty CRM and enrolls the contact in a "recovery" sequence.
- **Geo-Targeted Send Optimization for Local Businesses**: For businesses with physical locations, the platform uses the site's Google Maps data to schedule sends at optimal local times (e.g., a breakfast spot gets emails at 7 AM local, not 9 AM Pacific) and segments by service radius.
- **List Growth Engine via QR Postcard Attribution**: QR codes on physical postcards (generated via links.projectsites.dev) are tracked through scan → email follow-up → claim completion; the AI analyzes which postcard designs produce the best email capture rate and suggests design improvements.
- **AI Subject Line A/B Testing as a Self-Serve Feature**: Every campaign draft automatically generates subject line variants (labeled by approach: "urgency," "curiosity," "benefit") and sends the winner to the rest of the list after 4 hours; results update the brand voice profile for future campaigns.
- **Multi-Tenant Abuse Detection with Auto-Suppression**: A platform-wide LLM classifier scans every tenant's campaigns for spam triggers before send; if flagged, the campaign is held, the site owner is notified with specific suggested edits, and repeated violations auto-escalate the account for admin review.

## crm.projectsites.dev — Twenty CRM: AI Business Platform Connections

- **Self-Driving Sales Pipeline from Discovery to Paying Customer**: When Lead Scanner discovers a new local business, Twenty CRM auto-creates a Company+Person+Opportunity at "Discovered" stage; Nango enriches the record with firmographics; the AI churn-classifier scores it; and a personalized Listmonk sequence begins — the entire prospecting workflow is zero-touch.
- **AI Account Executive Assistant**: The concierge can respond to "What's on my pipeline today?" with an AI-generated briefing that summarizes every open opportunity, flags stalled deals, identifies the top revenue-risk account, and drafts a personalized follow-up email — all from Twenty CRM data, surfaced in natural language.
- **Support-to-Sales Handoff with Full Context**: When Chatwoot detects buying-intent keywords ("upgrade," "how much for more sites"), the AI triage agent creates a Twenty CRM opportunity, attaches the full support transcript, assigns the deal the right owner, and enrolls the contact in a nurture campaign — all in seconds.
- **Automated Onboarding Playbook per Plan Tier**: When Stripe fires `checkout.session.completed`, Twenty CRM creates an onboarding opportunity with a checklist derived from the plan tier (Free: connect domain, publish first site. Pro: + invite team, + set up integrations); each checklist item auto-advances when the platform detects completion.
- **AI-Powered Duplicate Detection and CRM Hygiene**: A nightly Twenty CRM scan runs embedding similarity on new Companies and People, flags potential duplicates with confidence scores, and auto-merges above 95% confidence; the concierge presents the remaining 5% as a one-click "review and merge" digest.
- **Unified Customer Timeline Across Every Subsystem**: The Twenty CRM timeline aggregates events from Listmonk (email opens), Chatwoot (support conversations), Stripe (payment history), site publishes, and social.projectsites.dev (post engagements) into a single chronological feed — giving every agent a complete picture without switching tools.
- **Agency Portfolio View as a Multi-Account Hub**: For agencies managing multiple client sites, the custom cross-client dashboard aggregates MRR, at-risk deals, and activation status across all child tenants, with drill-down into each client's Twenty CRM workspace — making the platform a viable agency management OS.
- **AI Lead Enrichment at Ingestion Time**: Every incoming lead (via contact form, Chatwoot, or Nango import) gets auto-enriched with industry classification, company size estimate, and a one-sentence business summary generated by the LLM — stored as Twenty CRM custom fields so agents never meet a blank record.
- **Churn Prediction with Proactive Intervention**: The analytics pipe streams Twenty CRM opportunity stage changes into Tinybird, where a ML model scores churn probability; high-risk accounts trigger a Chatwoot priority alert, a Listmonk re-engagement email, and a Twenty CRM task for the account owner — all automated.
- **Billing-to-CRM Feedback Loop for Dunning**: When a Stripe payment fails, Twenty CRM auto-creates a dunning task, updates the Company `payment_status` to "past_due," and the AI concierge drafts a personalized "we're here to help" email that goes through Listmonk; payment recovery becomes a guided workflow, not a passive loss.
- **Self-Serve CRM Provisioning for Site Owners**: Every site owner on the Business plan gets a fully-provisioned Twenty CRM workspace with a pre-seeded pipeline (Lead → Quote → Won), default custom fields (site slug, plan tier), and a connected Chatwoot inbox — zero provisioning clicks for the owner.
- **Review-to-CRM Pipeline for Local Businesses**: Google Places reviews are ingested into Twenty CRM as activity records tied to the Company; a 5-star review auto-triggers a social post draft (via social.projectsites.dev) and a Listmonk "thank you" email, while a 1-star review triggers a support escalation.
- **GDPR-Compliant Data Export as a One-Click Feature**: The deprovisioning workflow produces a machine-readable export (Companies, People, Opportunities, Activities, synced notes) to R2, with a signed one-time download URL emailed to the owner — meeting GDPR Article 20 data portability requirements automatically.
- **Cross-System Task Generation from Platform Events**: When a site publish fails (error status), a Twenty CRM task is auto-created for the site owner; when a social post gets a negative reply (detected via AI), a Twenty CRM task is created with the full context — every platform signal becomes a trackable action item in the CRM.

## support.projectsites.dev — Chatwoot: AI Business Platform Connections

- **AI Triage to Resolution Pipeline**: When a Chatwoot conversation starts, the AI triage agent classifies the issue (billing/technical/onboarding), sets priority, drafts an initial suggested response as a private note, and routes to the correct team — first-touch resolution without human intervention for Tier 0 issues.
- **Concierge-to-Human Warm Handoff**: When the AI concierge (llm.projectsites.dev) cannot resolve a request, it creates a Chatwoot conversation pre-populated with the full AI transcript, user identity, and suggested next steps; the agent picks up with zero context loss and the user never re-explains their problem.
- **Billing Context Injection for Every Support Ticket**: Any Chatwoot conversation labeled "billing" auto-populates a private note with Stripe subscription status, MRR, last 4 invoices, and next payment date; the AI also suggests the most likely billing resolution (prorated credit, plan downgrade, invoice retry).
- **Site Activity Side-Panel in Support View**: The Chatwoot contact sidebar renders live data from across the platform — sites published, domains connected, integration health, recent social posts, last Listmonk campaign, and platform error count — giving agents a real-time customer health dashboard without switching contexts.
- **Proactive Support from Platform Event Detection**: When a site build fails or an expired domain goes unrenewed for 7 days, the platform auto-opens a Chatwoot conversation with the affected customer, proactively offering help — support initiates itself before the customer knows there's a problem.
- **AI-Generated Knowledge Base from Support Resolutions**: Every successfully resolved Chatwoot conversation is summarized by the AI concierge and submitted as a draft help-center article; after admin approval, it's published to the knowledge base and linked to future similar conversations for deflection.
- **SLA-Breach Alerting with Escalation Workflows**: When SLA is breached, Chatwoot triggers a Tinybird event that alerts the admin via email, creates a Twenty CRM escalation opportunity, and posts the incident-to-status-page update — the entire notification chain runs without manual intervention.
- **Widget-Based Support as a Monetizable Feature for Site Owners**: Generated site owners on paid plans get an embeddable Chatwoot widget with AI auto-reply for their own visitors — turning support into a resellable product where small businesses get enterprise-grade ticketing embedded in their AI-generated site.
- **Spam-to-CRM Blocklist Automation**: Inbound spam (detected via Turnstile + LLM heuristic) on the public widget adds the offending email/IP to Chatwoot's blocklist AND updates the Twenty CRM Company's `blocklist` field — a single abuse signal propagates across both systems.
- **Incident Mode with Multi-Channel Broadcasting**: During platform incidents, the incident bridge posts a status note to every open Chatwoot conversation matching the affected tenant group, sends a mass-email via Listmonk, and updates the status page — all from a single "incident start" event.
- **CSAT-Driven Renewal Risk Scoring**: Post-conversation CSAT scores stream into Tinybird, where a 30-day rolling average per tenant feeds a churn-risk flag in Twenty CRM; a one-star CSAT auto-creates a "Retention Risk" opportunity with the AI's suggested remediation actions.
- **Zero-Touch Help Center SEO for Each Local Business**: The Chatwoot knowledge base generates separate help-center sections scoped to each site owner's industry (e.g., restaurant owner sees "how to update your menu," plumber sees "how to add service areas"), with SEO-optimized titles and descriptions for each portal category.
- **Automated Agent Quality Assurance**: Every AI triage call is traced in Langfuse with scoring hooks; the AI concierge reviews a random 5% sample of resolved conversations weekly, flags quality gaps, and updates the triage prompt — the support system self-improves.
- **Cross-Tenant Support Pattern Analysis**: The Tinybird support metrics pipe identifies patterns across tenants — "this week 40% of tickets are about domain expiry" — and generates a platform-wide announcement (via Listmonk) or a knowledge base update (via help center) that addresses the root cause at scale.

## social.projectsites.dev — Postiz: AI Business Platform Connections

- **AI Brand Voice Creation from Generated Site Content**: When a new site is published, the platform auto-derives a brand voice profile from the site copy (tone, audience, banned words, emoji policy) and seeds a social content calendar — the first 30-day posting plan is ready before the owner signs in to the admin panel.
- **Zero-Touch Launch Announcement Across All Connected Channels**: On site go-live, the AI generates a campaign bundle (X post, Facebook update, LinkedIn announcement, Instagram story suggestion) with the site URL, value proposition, and brand-appropriate imagery — a multi-channel launch in one click.
- **Review-to-Social Proof Engine**: Google Places reviews (5-star and above) are auto-formatted into quote-card social posts with brand-aligned imagery, scheduled across connected accounts, and attributed back to the original review — turning every positive review into free promotion.
- **CRM-Listmonk-Social Triangulation for Warm Lead Nurturing**: When a Listmonk subscriber engages with 3+ emails AND the Twenty CRM lead has been idle for 7 days, social.projectsites.dev schedules a retargeting post visible to that lead, creating a cross-system lead-nurture chain.
- **AI Content Calendar with Industry-Specific Occasion Packs**: A restaurant owner gets seeded with "National Pizza Day," "Mother's Day Brunch," "Local Food Festival" posts; a law firm gets "Tax Deadline Reminder," "New State Regulation" updates; each post is fully written, on-brand, and scheduled — the calendar manages itself.
- **Campaign Bundles as Automated Revenue Drivers**: Every month, the AI generates a "specials" campaign: 3 posts (announcement, behind-the-scenes, testimonial) across 4 platforms, with one-click approval — turning social content creation from a weekly chore into a monthly review session.
- **Social Post Failure Auto-Escalation to Support**: When a scheduled post fails (expired token, rate limit, content rejection), the failure-alerting pipeline opens a Chatwoot ticket with the error code, suggested fix, and a deep-link to reconnect the account — closing the loop between social publishing and support.
- **Cross-Platform Analytics that Feed CRM Lead Scoring**: Engagement signals (likes, shares, comments) from Postiz flow into Tinybird, which updates a Twenty CRM custom field per Company — a social post going viral auto-bumps the associated Company's lead score and triggers a follow-up task.
- **Media Library with AI Image Generation on Demand**: The R2 media library generates brand-on-brand images from post text: a restaurant's "Tuesday Taco Special" post auto-creates a branded image card with the logo, offer text, and brand colors using Replicate/Workers AI — no design skills needed.
- **Agency White-Label Social Publishing**: For agencies managing multiple client sites, the approval mode creates a consolidated queue across all client social accounts; the agency approves once, and posts fan out across every client's connected channels with correct per-client branding — turning the platform into a multi-tenant social agency.
- **Seasonal Post Archive with Auto-Reactivation**: Holiday posts from last year are automatically adapted for the current year (updated dates, refreshed imagery, current promotions) and added to the calendar as drafts — the platform's institutional memory makes content evergreen.
- **Direct Social-to-Conversion Attribution**: Every social post link is wrapped through links.projectsites.dev (Dub), so engagement → click → claim → paying customer is a single traceable lineage; the social analytics dashboard shows which Instagram post drove $1,200 in MRR — not just likes.
- **Tinybird-Powered Best-Time-to-Post Heuristics**: Per-account posting time is optimized by analyzing past engagement data in Tinybird and adjusting the content calendar's suggested times for each platform — the system learns when each audience is most responsive.
- **Automated Brand Safety Review Before Every Post**: Each AI-generated post is scanned against the site's brand voice profile, banned words list, and industry compliance rules (e.g., no "guaranteed results" for legal services) before it can be marked as approved — brand safety is built into the publish workflow, not bolted on afterward.

## analytics.projectsites.dev — PostHog Cloud: AI Business Platform Connections

- **Tiered-Tenant Revenue Attribution Funnel**: Automatically attribute every AI-generated site claim, upgrade, and subscription event back to the acquisition channel (organic search, referral, paid, AI concierge), so the platform knows which customer-acquisition lever generates the most MRR per tenant cohort.
- **AI Concierge Conversion Scorecard**: Instrument every concierge interaction with a PostHog score that tracks whether the AI-assisted claim/onboarding flow converts at higher rates than self-service, and surfaces the exact dialogue step where drop-off occurs — closing the loop between LLM quality and business outcomes.
- **Automated Plan-Promotion Trigger Engine**: When the activation score (computed from taxonomy events) crosses configurable thresholds, automatically fire lifecycle triggers that offer an upgrade prompt, schedule a re-engagement email, or unlock a premium feature — turning raw analytics events into autonomous upsell motions.
- **Multi-Site Portfolio Benchmarks Dashboard**: Aggregate anonymized analytics across all generated customer sites into a benchmarking view that lets each site owner see their pageviews, conversion rate, and engagement percentile against similar businesses — turning siloed per-site data into a platform-wide competitive intelligence asset.
- **Bot-Filtered Lead Scoring Pipeline**: Combine abuse/bot analytics signals with real visitor behavior to assign a lead-quality score per unique visitor across all customer sites, then pipe high-scoring leads into a platform-wide lead-inbox that site owners can claim — making the analytics plane a revenue source, not a cost center.
- **AI Feature Adoption Heatmap**: Track every platform AI feature (concierge, site rebuild, content generation, SEO audit) as PostHog events and render a per-tenant heatmap showing which AI capabilities drive retention vs. which are dead weight — directly informing the LLM routing and budget-enforcement tiers.
- **Autonomous Anomaly-to-Incident Pipeline**: When the churn-prediction signal or abuse-detection heuristic fires above threshold, auto-create a Sentry issue, post a structured alert to psnotify, and enqueue a lifecycle workflow that attempts a save-offer or account-review — closing the gap between analytics detection and autonomous response.
- **Usage-Based Billing Data Feed**: Feed PostHog event counts (API calls, site visitors, AI generations) into the billing system's entitlement computation so usage-based pricing tiers are enforced and reported in real time, with the analytics layer serving as the authoritative usage ledger.
- **Cross-Tenant Funnel Optimization Loop**: Maintain a PostHog funnel comparing activation milestones across all tenants; when any step's conversion rate drops below a rolling baseline, generate a platform-wide admin alert and queue a workflow to A/B-test the onboarding flow — turning analytics drift detection into autonomous product optimization.
- **AI Content Performance Ranking**: Tag every generated page variant with a PostHog property recording which AI model and prompt version produced it, then rank variants by actual visitor engagement (time on page, scroll depth, CTA click) to continuously feed the LLM tier-routing model selection — analytics as the feedback loop for content quality.
- **Scheduled Campaign Performance Retro**: Every lifecycle email campaign (drip, re-engagement, save-offer) gets a PostHog retention insight that automatically compares the campaign cohort's 7/30/90-day retention against the control group, surfacing campaign ROI directly in the admin analytics cockpit without manual query building.
- **Real-Time Platform Health SLA Dashboard**: Aggregate platform-wide PostHog trends (checkout success rate, site publish latency, AI generation error rate) into a single SLA cockpit widget that auto-rolls back a gradual deploy when any metric crosses its error budget threshold — analytics as the production safety net.
- **Autonomous Feature Flag Promotion Gate**: When an experimental feature's PostHog experiment shows statistically significant improvement on the primary metric with no regression on secondary metrics, auto-promote the flag from experimental to beta and post a changelog entry — closing the analytics-to-deployment loop without human intervention.
- **White-Label Analytics Embed**: Package the per-site analytics view as an embeddable iframe with HMAC-signed tokens so customer site owners can drop it into their own dashboards outside projectsites.dev, turning the platform's analytics investment into a differentiated partner integration.

## logs.projectsites.dev — Axiom: AI Business Platform Connections

- **LLM Call Cost & Latency Correlation Dashboard**: Join the Axiom `llm` dataset against Langfuse traces to render per-model cost, p50/p95 latency, and error rate by tenant/site/app — giving the platform operator at-a-glance visibility into whether the tier-routing policy is actually saving money at the quality threshold.
- **Autonomous Root-Cause Analysis from Log Spikes**: When error-rate anomaly detection fires in the `build` or `webhook` dataset, auto-spawn an incident-responder agent that reads the correlated Axiom log lines, surfaces the failing request_id and trace_id, and opens a draft PR with the suspected root cause — log observability driving autonomous incident response.
- **AI Generation Quality Gate via Build Log Scoring**: Parse site-generation Workflow log lines for model, prompt_version, duration, and failure codes at build time; compute a per-generation quality score from the log metadata and write it as a Langfuse score, creating a closed loop between build observability and eval-driven quality measurement.
- **Tenant SLA Compliance Audit Trail**: Mirror every platform-level SLO event (site serving latency, build duration, uptime) to the Axiom `audit` dataset with tenant_id, so each tenant gets an immutable, queryable SLA compliance record that satisfies enterprise vendor-review requirements without manual reporting.
- **Cross-Dataset Incident Correlation in /admin/traces**: When the /admin observability hub surfaces a Sentry error, automatically resolve and link the corresponding Axiom log lines (by trace_id), the Langfuse trace (by trace_id), and the PostHog funnel step where the affected user dropped off — one-click pivot from error to business impact.
- **Autonomous Sampling Tuning via Spend Threshold**: When the effective monthly Axiom ingest cost exceeds a configurable budget threshold, autonomously lower the sample rate for debug-level and info-level datasets (while preserving 100% sampling for security and audit) and log the policy change — cost-aware observability that self-adjusts.
- **Scheduled Build-Pipeline Regression Report**: Aggregate structured log metrics from every site-generation Workflow run into a weekly Tinybird report showing step-level duration trends, model latency drift, and failure-code frequencies, posted automatically to the admin dashboard and to a platform-internal Slack webhook.
- **Platform-Wide Job Failure Fingerprinting**: Cluster log fingerprints from dead-lettered jobs (similar stack traces, error codes, or upstream timeouts) across all four job engines, auto-create a Sentry issue for each novel failure class, and block the affected job class from dispatching until the fingerprint is resolved — log intelligence as job reliability infrastructure.
- **Real-Time Webhook Delivery Health SLO**: Render the webhook delivery success rate from Axiom on a per-tenant gauge in the admin cockpit; when any tenant's delivery rate drops below 99.5%, auto-escalate by re-routing that tenant's webhooks through a fallback path and posting an alert with the deteriorating endpoint URL.
- **Container Log Anomaly Auto-Response**: Monitor the `container` dataset for restart bursts (restart count exceeding 3/min across any container DO); when detected, auto-capture a Sentry event with the last 50 ring-buffer log lines and enqueue a workflow that pauses the container and schedules a health check before restarting.
- **AI Budget Policy Conformance Logs**: Every LLM spend event logged to Axiom carries the budget-enforcement decision (granted, soft-warning, hard-blocked, BYO-key-used); render per-tenant budget burn-down charts in the /admin llm-spend dashboard, sourced from Axiom rather than from Tinybird, so the raw decision log is always queryable independently.
- **Customer-Visible Platform Status Feed**: Surface the filtered Axiom event stream (site published, deploy ok/fail, form submission) to the customer site owner dashboard as a reverse-chronological activity feed, giving non-technical users transparent visibility into their site's operational history without any Sentry exposure.
- **Retention-Constrained Security Log Forensics**: Keep the Axiom `security` dataset on a 90-day retention tier with a guaranteed query path from the admin log search UI; when a security event fires, auto-create a PostHog alert and snapshot the preceding 5 minutes of correlated log lines to R2 for forensic preservation beyond the retention window.
- **Self-Healing Log Transport with Redrive**: When the dead-letter visibility surface detects a batch older than 1 hour, auto-attempt a redrive with exponential backoff; if the third redrive attempt also fails, open a Sentry issue with the batch metadata and correlation IDs, ensuring no log line is silently lost without human escalation.

## traces.projectsites.dev — Sentry + Langfuse + Promptfoo: AI Business Platform Connections

- **End-to-End AI Generation Trace with Quality Gate**: Capture every site-generation Workflow step as a child span under one trace_id, attach the Langfuse quality score as a Sentry tag, and block the publish step if any generation step fails its quality threshold — making the trace plane the autonomous quality gate for every AI output shipped to a customer.
- **Multi-Model Cost-Per-Quality Comparison Dashboard**: Use the model-comparison eval harness to run golden datasets across DeepSeek, Anthropic, and Workers AI; render a Tinybird-powered dashboard comparing per-model quality score vs. per-call cost vs. p95 latency, so every model-swap decision is backed by traceable evidence across all three observability sinks.
- **Autonomous Incident-Responder with Cross-Sink Evidence**: When the Sentry MCP surfaces a new high-severity error, the incident-responder agent autonomously reads the corresponding Axiom log lines and Langfuse trace for the same trace_id, synthesizes a root-cause hypothesis with deep links to each sink, and opens a draft fix PR with a failing test — error tracking becoming autonomous engineering.
- **Tenant-Impact Triage for Platform Errors**: Every Sentry issue is automatically enriched with affected_tenant_count, affected_site_count, and plan tier via a Tinybird join; the /admin/traces console sorts errors by blast radius, so the solo founder always fixes the highest-business-impact issue first, not the noisiest one.
- **Prompt Version Rollback Safety Net**: When the Promptfoo CI gate detects a prompt regression and blocks the merge, the agent autonomously runs the prior prompt version against the same Langfuse dataset, confirms the prior version scores above threshold, and creates a KV hot-patch that restores the prior version in production — eval-gated rollback in under 60 seconds.
- **Cross-Trace Cost Attribution to Tenant/Feature/Prompt**: Every Langfuse trace is joined with the Tinybird spend ledger and the Axiom cost log to produce a single per-call row showing tenant_id, feature_slug, prompt_version, model, provider, tier, quality_score, and USD cost, queryable from the /admin cockpit for instantaneous margin analysis per customer.
- **LLM Hallucination Scoring as Deploy Gate**: The AI output quality evaluator writes a Langfuse score for every generated site section; the build pipeline reads this score and, if below threshold, flips the site to `error` with a stored analysis and blocks publish — making LLM quality observability a hard deploy gate, not a passive metric.
- **Production Evals Dataset Continuously Seeded from Live Traces**: A weekly cron samples the last 7 days of production LLM traces (PII-scrubbed), upserts them into the Langfuse eval dataset, and auto-runs the new cases through the Promptfoo CI gate — ensuring the golden set never drifts from real-world inputs.
- **Release Health as Autonomous Rollback Trigger**: When a new platform deploy's Sentry release health shows an error rate above 2x the prior release baseline, auto-trigger a `wrangler rollback` to the prior version, post a notification to psnotify with the release comparison, and create a GitHub issue linking the trace evidence — deploy observability driving autonomous rollback.
- **Feature-Scoped Breadcrumb Trails for Onboarding Debug**: Every onboarding step emits a Sentry breadcrumb tagged with `featureSlug: onboarding` and the activation milestone event; the /admin/traces console groups onboarding traces by dropout step, so the solo founder can replay exactly where each user got stuck without any session replay on customer sites.
- **Langfuse Dataset Run as CI Quality Baseline**: Every nightly CI run executes the golden Promptfoo suite against production-version prompts and upserts the results as a Langfuse dataset run; the admin dashboard renders a 7-day trend of quality scores per feature, flagging any score that drops below the baseline's 95th-percentile confidence interval.
- **Sentry-Langfuse-Axiom Deep Link Triplet**: Every error in /admin/traces carries three deep links — Sentry event (stack trace + breadcrumbs), Langfuse trace (LLM call context + scores), Axiom APL query (structured logs for trace_id) — so a single click pivots from the error to the AI call to the raw logs without any manual ID copying.
- **Model-Promotion Eval Gate in CI Pipeline**: Before a model swap PR (e.g., promoting a challenger model to production) can merge, the CI pipeline auto-runs the model-comparison harness, compares the challenger's Langfuse score against the incumbent's baseline, and blocks the merge if quality drops by more than the configurable tolerance — trace-driven CI governance over AI model changes.
- **Self-Host-vs-Cloud Langfuse Cost/Availability Monitor**: A scheduled Langfuse health check pings both the Cloud and (staged) self-host endpoints, logs the latency and availability to Axiom, and writes a Langfuse score on the check itself; when Cloud availability drops below the staged fallback for two consecutive windows, auto-open a decision PR to switch — trace-backend observability governing its own hosting decision.

## llm.projectsites.dev — LiteLLM + RouteLLM + Cloudflare AI Gateway: AI Business Platform Connections

- **Autonomous Tier-Downgrade for Budget-Constrained Tenants**: When a tenant's spend approaches 80% of their monthly budget cap, the budget-enforcement agent automatically re-routes non-premium calls from standard tier to Workers AI instant tier (via RouteLLM classifier), preserving function while reducing per-call cost by 10-20x without human intervention.
- **Semantic Cache Hit-Rate Optimization Loop**: Monitor semantic cache hit-rate per tenant and per prompt family; when hit-rate falls below 30% over a 24-hour window, auto-adjust the cosine-similarity threshold downward by 0.02 and log the change to Axiom, creating a self-tuning cache that maximizes savings without manual tuning.
- **Provider Failover Preserving Streaming UX**: When a premium provider returns a 5xx or times out mid-stream, the failover chain auto-reconnects the SSE stream to the next provider in the tier's fallback list, sends a `x-llm-fallback: true` header to the client, and logs the failover event with provider and latency — enabling uninterrupted AI streaming despite upstream outages.
- **Per-Feature Cost-Budget Compliance Report**: The Tinybird spend ledger aggregates per-feature LLM spend daily and compares it against the feature's budget allocation; any feature exceeding its budget triggers a PostHog alert, a psnotify notification, and an automatic throttle on that feature's tier ceiling for the remainder of the billing window.
- **Vision-Forced Upgrade with Cost Dashboarding**: Every call with image content is autonomously detected and forced to premium tier, with the forced-upgrade reason, original tier, and incremental cost delta tagged on the Langfuse trace; the /admin llm-spend dashboard renders a vision-cost breakdown so the operator sees exactly how much tier-forcing vision adds to the monthly bill.
- **Eval-Gated Model Rollout with Gradual Traffic Shift**: When a challenger model passes the Langfuse eval dataset, it gets 5% of production traffic via the tier router; if quality scores hold above baseline for 24 hours and cost-per-call is lower, traffic auto-shifts to 25%, then 100% — cost-optimized model rollout without manual percentage dialing.
- **BYO-Key Tenant Isolation with Platform Observability**: Tenants using their own provider keys get a full Langfuse trace, Axiom log line, and Tinybird spend row tagged `billing_mode: byo` with zero cost attributed to the platform, but the AI Gateway still enforces rate limits and caches responses — the platform maintains full observability even on tenant-billed calls.
- **Spend-Spike Auto-Throttle with Tenant Notification**: When an anomalous spend velocity (e.g., 10x normal hourly rate) is detected per tenant key, the abuse prevention guard auto-throttles the key to minimum tier, sends a `llm.budget.threshold` webhook to the tenant's Outpost endpoint, and logs the event to the security dataset — autonomous cost containment without an operator at the console.
- **Prompt Version Hot-Patch with A/B Rollback**: A KV hot-patch updates a prompt version in under 5 seconds without redeploy; the A/B harness splits traffic 50/50 between old and new versions, writes Langfuse scores for both, and auto-rolls back the patch if the new version scores below baseline for 10 consecutive calls.
- **Streaming First-Token Latency SLO Enforcement**: Every streamed response logs TTFT to Tinybird; if p95 TTFT exceeds 2000ms for a given provider tier over a 5-minute window, the fallback chain routes subsequent calls for that tier to the next-fastest provider, with the switch logged and rendered in the /admin llm-spend dashboard as a latency-driven failover.
- **Tenant-Level Quota Enforcement with Friendly 429 Retry**: When a per-app DO counter fires a throttle event, the response carries an RFC 7807 Problem Details envelope with a human-readable reason (e.g., "You've used 95% of your monthly generation budget"), a suggested upgrade link, and a `Retry-After` header — making rate limits a conversion opportunity rather than a hard wall.
- **Cross-Provider Structured Output Normalization**: The structured-output shim normalizes JSON-schema compliance across Anthropic, OpenAI, DeepSeek, and Workers AI, with a Zod-parse validation after every call; schema-violation counts per provider are tracked in Langfuse and inform the tier router when a provider's structured-output quality degrades below threshold.
- **Tool-Calling Passthrough with Cross-Provider Latency Tracking**: The LiteLLM tool-call normalization layer logs per-provider tool-call latency, parallel tool-call support, and multi-turn loop fidelity to Langfuse; the /admin llm-spend dashboard includes a tool-call quality comparison, so model-swap decisions account for agentic capability, not just text generation cost.
- **AI Gateway Log Eval Score Injection**: After every LLM call, the Langfuse quality score is written back to the AI Gateway as a patch log entry via `env.AI.gateway().patchLog(id, {score})`, closing the eval loop inside the gateway's own observability layer and making the gateway the unified log-and-score source of truth for every AI interaction.

## browser.projectsites.dev — Browser Automation: AI Business Platform Connections

- **Autonomous Competitor Intelligence Feed**: The competitor crawl workflow runs weekly for every tenant's market vertical, captures screenshots and rubrics from peer sites, and auto-publishes a structured intelligence report to the tenant dashboard — turning browser automation into a recurring lead-generation and competitive-analysis SaaS feature.
- **Post-Deploy Visual Regression as Quality Gate**: Every site publish triggers a responsive screenshot capture across 6 breakpoints, pixel-diffs against the prior baseline, and blocks the publish if any breakpoint exceeds the 0.5% area change threshold — making visual QA an automated deploy gate, not a manual review step.
- **AI Vision Brand Extraction for Automated Onboarding**: When a tenant claims a site during onboarding, the brand asset extraction pipeline runs autonomously: crawl the existing source site, extract logo/favicon/colors via vision LLM, and pre-populate the brand settings — eliminating the most tedious step of site setup and reducing time-to-live by minutes.
- **CWV Audit as Autonomous SEO-Improvement Driver**: The Lighthouse/CWV audit runs on every published site, and when the Performance score drops below 75 or A11y below 95, an autonomous workflow generates an improvement PR with the specific Lighthouse opportunity recommendations applied to the site template — browser QA driving continuous site optimization.
- **Scheduled Lead-Generation Site Monitoring**: The uptime monitor polls every active customer site and, when a site returns a non-200 for 2 consecutive checks, auto-creates an admin task, captures a "before" screenshot, and triggers the site rebuild workflow — turning uptime checking into a proactive lead-retention service.
- **Stagehand AI Agent for Automated Form and CTA Testing**: The post-deploy E2E harness uses Stagehand AI to semantically find and fill every form on the site, submit it, and assert the success state — ensuring that every CTA and contact form actually submits end-to-end without brittle CSS selector maintenance.
- **Source-Site Sitemap Discovery for Zero-Friction Migration**: When a user opts to rebuild an existing site, the crawler autonomously discovers the full sitemap (including WordPress, Squarespace, and Wayback Machine fallbacks), crawls every page, and produces a complete URL inventory ready for the site-generation Workflow — reducing migration friction to a single click.
- **Automated OG Image Generation for Every Published Route**: After a site publish, the OG-image renderer autonomously screenshots each route at 1200×630, uploads to R2, and updates the site metadata so every shared link has a branded social card — a zero-touch marketing asset pipeline for every customer.
- **Visual Regression-Based Contract Enforcement with Customer**: When a tenant requests a site change, the visual regression suite captures the current baseline before changes, renders a redline diff after changes, and includes the diff image in the confirmation message — providing visual proof of what changed as a natural artifact of the browser automation layer.
- **Abandoned-Cart-Style Re-engagement via Screenshot Proof**: When the uptime monitor detects a site has not been modified in 90 days, it captures a current screenshot and schedules a re-engagement email with the screenshot and a one-click "refresh your site" link — converting passive monitoring into an active retention workflow.
- **Crawl-Scrape-Snapshot-Store as Service-to-Service API**: The browser gateway exposes each capture mode (screenshot, content, snapshot, scrape, PDF) as a typed API endpoint with Zod schema, so every internal service (site-gen, monitoring, E2E, brand extraction) calls one HTTP contract instead of embedding Playwright — making browser automation a reusable platform primitive rather than a set of one-off scripts.
- **Zero-Retry Post-Deploy Asset Verification**: The post-deploy harness loads every generated page in CF Browser Rendering, captures console errors, asserts no 404 asset loads, and fails the deploy gate if any route has unresolved asset references — catching broken image links, missing fonts, and unloaded scripts before any customer sees them.
- **Accessibility Compliance Registry Automated Per Deploy**: The axe-core audit runs across all 6 breakpoints for every published site; violations are stored in Tinybird, and any new violation type triggers an admin alert with the specific WCAG criterion, affected element selector, and suggested fix from the axe output — creating a living accessibility compliance registry without manual auditing.
- **Lead Generation via Competitor Gap Analysis**: The competitor crawl captures not just screenshots but structured signals (missing schema, missing OG tags, poor Lighthouse scores on peer sites); the analysis workflow produces a "competitor gaps" report for the tenant that frames platform features as solutions to competitor weaknesses — turning browser automation into a direct sales enablement tool.

## jobs.projectsites.dev — Workflows + Queues + Inngest: AI Business Platform Connections

- **Autonomous Job Failure Remediation Loop**: When a job exhausts its retries and lands in the DLQ, an incident-responder agent reads the full envelope and last error, analyzes the failure class, and autonomously either re-enqueues with corrected parameters or opens a fix PR for the underlying cause — closed-loop job recovery without operator attendance.
- **Cost-Aware AI Generation Fan-Out**: The media generation workflow respects per-tenant AI budget tokens; when fanning out N image generations, the concurrency limiter defers jobs that would exceed the tenant's remaining monthly AI spend, ensuring the platform never over-serves a paying tenant's committed budget.
- **Billing Reconciliation as Autonomous Drift Correction**: The billing reconciliation workflow runs nightly, diffs Stripe subscription state against D1 entitlements, and auto-applies corrections (seat count changes, plan downgrades) behind a dry-run flag that only escalates to the operator when the drift amount exceeds a configurable dollar threshold.
- **Human-in-the-Loop Approval Inbox for Publish Gates**: The task inbox surfaces approval-required items (flagged content, publish gates, refund requests) with full correlation context and a one-click approve/reject action; the workflow waits durably for the human decision and resumes automatically, so no approval step becomes a manual tracking nightmare.
- **Autonomous Site Freshness Pipeline**: The scheduled recrawl workflow diffs current site content against the prior snapshot, and when significant drift is detected, autonomously enqueues a site regeneration workflow for the affected sections — keeping customer sites current without manual rebuild requests.
- **Drip Campaign Engine with Conversion-Based Cancellation**: The Inngest lifecycle engine enrolls every new user in a 7-day onboarding drip; if the user completes the activation funnel before day 5, the conversion event automatically cancels remaining drip steps, preventing redundant messaging while the autonomous enrollment fires on every signup.
- **Cross-Engine Job Observable Trace**: The correlation-id propagation mandate ensures every job that hops from Worker to Workflow to Inngest to Hatchet carries one trace_id; the /admin/jobs cockpit renders the entire journey as a single trace, showing each engine hop, latency, and cost alongside the Axiom log lines for each step.
- **Social Post Scheduling with Platform-Specific Retry**: The social publish workflow posts to each platform independently, and when one platform (e.g., LinkedIn) fails but others succeed, it retries only the failed platform without re-publishing to the successful ones — multi-platform resilience without redundant posting.
- **Snapshot Revert as Customer Self-Service**: The snapshot revert/rollback workflow is exposed through the customer dashboard as a one-click "restore version" button; the workflow atomically flips R2 and D1 pointers and logs the audit event, giving non-technical site owners the power to undo changes without contacting support.
- **Data Export with Autonomous Expiry and Cleanup**: The GDPR data export workflow packages all tenant data, uploads to R2 with a signed expiring URL emailed to the tenant, and automatically enqueues a cleanup job that deletes the export after the configurable retention window — full compliance autonomy from request to deletion.
- **Cost-Aware Job Throttle During AI Spend Spikes**: The concurrency limiter reads the per-tenant AI budget burn rate from Tinybird; when a tenant's hourly spend rate exceeds 3x their daily average, new AI-generation jobs for that tenant are deferred with a `not_before` timestamp, smoothing spend spikes without dropping workloads.
- **DLQ Auto-Rediscovery and Pattern Clustering**: A scheduled cleanup job scans the DLQ for error fingerprints shared across multiple tenants; when a recurring pattern is identified (e.g., same Stripe API version error across 5 tenants), it auto-creates a PR with the fix and re-enqueues the affected jobs — turning the dead-letter backlog into a prioritized fix queue.
- **One-Click Reroute Around Dead Provider**: When the circuit breaker for a specific upstream target (e.g., SendGrid) trips open, the email queue consumer transparently routes all pending email jobs to the fallback provider (Resend) for that target, with the switch logged on every subsequent delivery attempt and a Sentry issue opened for the original provider's failure.
- **Scheduled HTTP Callback as Webhook Failover Path**: When a tenant's primary Outpost-hosted webhook endpoint fails to acknowledge delivery for 3 consecutive attempts, the QStash scheduled callback paths are activated as a parallel delivery path, ensuring critical webhook events (payment confirmed, site published, plan changed) reach the tenant without a single retry exhaustion.

## docs.projectsites.dev — Scalar + Stainless: AI Business Platform Connections

- **AI-Generated OpenAPI Spec as Platform Contract**: The Zod-to-OpenAPI pipeline automatically documents every API endpoint the platform exposes, making the entire AI business platform introspectable by agent tools. Any AI agent can fetch the live spec to discover capabilities, parameter schemas, and auth requirements without human-authored docs.
- **Stainless SDKs as Zero-Touch API Consumption On-Ramp**: Multi-language SDKs auto-generated from the spec turn every platform API into a typed, importable library in the developer's language of choice. This eliminates the "how do I call this?" friction that kills platform adoption — the AI platform delivers its own consumable client.
- **Try-It Console as Onboarding Activator**: The live console scoped to the user's Unkey key creates a zero-friction "authenticate, paste, get a 200" loop that converts docs visitors into paying API consumers within minutes, with no developer relations team required.
- **API Changelog as Automated Release Notes for Platform Consumers**: OAS-diff-driven changelog keeps every API consumer automatically informed of breaking changes, additions, and deprecations. The AI platform communicates its own evolution — no manual changelog writing, no missed migration windows.
- **Versioned Docs Snapshotting as Backward-Compatibility Contract**: Immutable versioned specs in R2 let pinned consumers always access the docs that match their SDK version. This makes the platform's backward-compatibility promise provable and auditable without human effort.
- **Code Samples in Every SDK Language as Self-Service Integration**: Per-endpoint code snippets auto-derived from the spec and Stainless output mean every platform feature ships with ready-to-paste integration code in JS, Python, Go, and cURL — the AI platform teaches itself to be integrated.
- **Webhook + MCP Documentation as Agent-Native Surface**: Auto-generated webhook payload docs from Zod schemas + the MCP tool catalog page document the two most important surfaces for AI agent integration: event-driven callbacks and tool-call interfaces. The platform documents its own agent contract.
- **Error-Code Reference as Self-Healing Developer Experience**: A generated error taxonomy page linked from every API error response means every failure is self-diagnosable. The platform's error contract is its own documentation — developers never need to guess what a code means.
- **Quickstart Key Tied to Unkey Provisioning as Automated Activation Funnel**: The "create key → make first call" guided quickstart ties docs directly to the platform's API key infrastructure. Activation events (`key_created → first_call_200`) are tracked in PostHog + Tinybird, making the funnel measurable and optimizable without manual sales follow-up.
- **Embeddable Docs Widget as Cross-Product Surface**: The script-tag embed lets partner sites and admin panels embed a scoped API reference without leaving their product. This turns docs into a distribution channel — every embed is an advertisement for the AI platform's self-service capability.
- **CI Gates as Automated Quality Enforcement**: Spec linting + breaking-change detection + link checking ensure every platform API contract is valid, non-breaking, and correctly linked before reaching consumers. The AI platform enforces its own documentation quality autonomously.
- **Freshness Check as Platform Drift Prevention**: Automated stale-guide and undocumented-endpoint detection ensures the platform never accumulates rot where code and docs diverge. The AI platform audits its own documentation completeness.
- **Docs Analytics + Conversion Dashboard as Platform Feedback Loop**: PostHog + Tinybird track which endpoints, guides, and samples drive key creation and first calls. The platform measures its own developer onboarding funnel and surfaces where to invest docs effort next.
- **Scalar Reference as the Public Face of AI Platform Capabilities**: A single, auto-generated Scalar reference page renders every platform endpoint with search, dark theme, and live try-it. It is the definitive, always-up-to-date catalog of everything the AI business platform can do — and it costs zero human effort to maintain.

## links.projectsites.dev — Dub: AI Business Platform Connections

- **Full-Funnel Attribution from First Click to MRR**: Every link generated for a marketing campaign carries a stable `click_id` that survives through site claim → CRM lead creation → Stripe subscription; the Tinybird dashboards report ROI-per-campaign from click to recurring revenue — the platform closes the attribution loop autonomously.
- **AI-Optimized Multi-Path Link Routing**: Site owners can set a campaign goal (e.g., "drive signups"), and Dub's A/B rotator automatically tests destinations against the goal metric, routing future traffic to the highest-converting variant without the owner analyzing the data.
- **Self-Serve Partner Referral Program as a Growth Engine**: Site owners generate tracked referral links via the public API; Dub's click-to-customer lineage credits each referral, and the billing system auto-calculates commissions and triggers Stripe Connect payouts — turning every customer into a distribution channel.
- **Social Post Auto-Link Wrapping for Full Attribution**: Every URL published through Postiz or Listmonk is automatically rewritten as a Dub short link tagged with the campaign and channel; the social analytics dashboard shows which Instagram Reel drove $800 in site subscriptions — attribution that would otherwise require a separate UTM manager.
- **Geo-Device Smart Links for Local Businesses**: A single link directs desktop users to the full site, mobile users to the tap-to-call action, and out-of-region visitors to the "about us" page — all configured from the admin UI with zero code, powered by CF geo data and Dub targeting rules.
- **QR Code Offline-to-Online Funnel with Email Follow-Up**: Print QR codes (generated on menus, flyers, postcards) are tracked through scan → claim → Listmonk email sequence; the postcard scan that leads to a paying customer is attributed back to the physical batch, closing the offline-to-online measurement gap.
- **Automated Link Expiry and Seasonal Campaign Management**: Time-boxed campaign links auto-expire to graceful fallback pages, and the AI concierge sends a "campaign ended" summary with click counts and conversion metrics — owners never serve a stale link or miss the post-campaign recap.
- **Link-in-Bio as a Mobile-First Storefront**: Every site owner gets a hosted bio page (`go.{vanity}/{handle}`) that aggregates their tracked links, services menu, and contact CTA; every outbound click is attributed, turning a social profile link into a measurable conversion surface.
- **Bot-Filtered Attribution for Cleaner Analytics**: Before any click counts toward conversion, the click-fraud scorer (CF Bot Management + velocity checks) tags bot clicks; campaign ROI reports exclude non-human traffic, so owners optimize against real conversion data, not inflated metrics.
- **Click-to-Chat-to-Close Funnel**: A Dub click on a "Chat with Us" short link carries `click_id` into the Chatwoot widget; the support agent sees the originating campaign, and if the conversation converts, the full click→conversation→revenue lineage is documented in a single Tinybird query.
- **AI-Generated UTM Naming Convention Enforcement**: The UTM builder normalizes campaign names (lowercase, no spaces, consistent source/medium/tags) across all links created by an owner; the Tinybird pipeline filters on these normalized values, preventing the "Email vs email" fragmentation that kills campaign rollups.
- **Deep Links as a Mobile App On-Ramp**: For site owners with mobile apps (via the platform), links.projectsites.dev serves `apple-app-site-association` and `assetlinks.json` on their vanity domain, enabling universal links that open the app when installed and fall back to the generated site when not — app/web parity in one link.
- **Subscription-Gated Link Features as Monetization**: Free-tier links get basic analytics and a `links.projectsites.dev` domain; Pro-tier links get vanity domains, custom QR branding, A/B testing, and geo-targeting — the upgrade moment surfaces the moment a free user's clicks cross the threshold where advanced features would deliver measurable ROI.
- **Cross-Platform Webhook Fan-Out for Every Attribution Hop**: Each attribution milestone (click recorded, claim attributed, lead attributed, revenue attributed) emits a signed webhook through Hookdeck/Outpost to the owner's endpoint — every platform metric is also a real-time data stream for the customer's own analytics stack.

## status.projectsites.dev — Status Page + Uptime: AI Business Platform Connections

- **Health Aggregator as AI Platform Nervous System**: The centralized HealthAggregator polls all 19+ subsystem `/health` endpoints into a normalized ComponentState. Every AI platform operation — billing, site generation, CRM, auth — is monitored from one source of truth, enabling automated incident detection and data-driven reliability improvements.
- **Automated Incident Creation from Probe Failures as Zero-Touch Reliability**: Consecutive failed checks auto-open incidents with Sentry context correlation and auto-resolve on recovery. The AI platform manages its own incident lifecycle without human triage — the solo founder is paged only when escalation thresholds are crossed.
- **Per-Tenant Customer-Site Uptime as Revenue-Generating Feature**: Synthetic checks against each published customer site with tenant-scoped status views turn uptime monitoring into a sellable product feature. The AI platform monetizes its own reliability as a value-add for paying tenants.
- **SLA/Uptime Computation as Automated Compliance**: Rolling-window uptime percentages computed from Tinybird rollups and displayed alongside the status page give every tenant provable SLA data. The AI platform generates its own compliance reports without manual calculation.
- **Degraded-Performance Detection as AI-Driven Cost Optimization**: Latency threshold breaches and rolling-baseline anomaly detection catch "slow but up" failure modes before they become outages. The platform proactively optimizes its own performance, preventing silent SLA erosion that would trigger support tickets.
- **Heartbeat/Dead-Man Checks as Cron Reliability Assurance**: Every cron and background job must ping its heartbeat, with automatic incident creation on missed pings. The AI platform validates its own scheduled operations are running — a monitoring job that fails to monitor itself is detected autonomously.
- **Embeddable Status Badge as Trust Signal Distribution**: Dynamic SVG badges and embeddable JS panels let customer sites and the marketing page display "all systems operational" without iframing. The AI platform broadcasts its own reliability as a trust signal across every touchpoint.
- **Component Dependency Map + Cascade Rendering as Intelligent Impact Analysis**: When a shared dependency fails (db, auth), dependent components automatically annotate "degraded due to upstream." The AI platform understands its own dependency graph and communicates failure impact intelligently, not as isolated red lights.
- **Public Status API as Programmatic Integration Point**: The versioned, rate-limited, OpenAPI-documented status API lets any external tool, dashboard, or AI agent query platform health programmatically. The platform exposes its own health as a consumable service — not just a web page.
- **Webhook Subscriptions as Automated Incident Distribution**: Incident events fan out through Hookdeck+Outpost to subscriber webhooks. The AI platform distributes its own incident notifications to Slack, PagerDuty, or any endpoint, with HMAC signatures and retry guarantees.
- **Regional Status Breakdown as Multi-PoP Visibility**: Checks from multiple CF regions with per-region component grids give global tenants visibility into their specific region. The AI platform reports its own geo-distributed health, not just a single-region perspective.
- **Scheduled Maintenance as Auto-Suppression of False Alerts**: Planned maintenance windows automatically suppress auto-incident creation and display blue "maintenance" banners. The AI platform distinguishes planned work from failures without human intervention.
- **Subscriber Registry + Email Blasts as Automated Customer Communication**: Double-opt-in subscriber list with per-component scope and automated incident email broadcasts. The AI platform communicates its own incidents to the right audience at the right time.
- **RSS/Atom/JSON Feeds as No-Friction Subscription**: Every incident and maintenance event is available as valid RSS, Atom, and JSON feeds. The AI platform publishes its own operational history in universally-consumable formats — the ultimate zero-effort status subscription.

## admin.projectsites.dev — Super-Admin / Operator Console: AI Business Platform Connections

- **Unified Operator Cockpit as AI Platform Command Center**: The single pane of glass over all 19 subsystems from SERVICE_REGISTRY lets the operator see health, deploy state, cost, and error rate of every platform component from one screen. The AI platform's operational state is aggregated, not scattered across 19 dashboards.
- **Operator RBAC as Zero-Trust Access Control**: Graded operator roles (super-admin, support, read-only) with server-enforced middleware and 404-on-unauth ensure that every sensitive platform action is scoped to the right authority level. The AI platform enforces its own access control without shared credentials.
- **LLM Spend Admin as AI Cost Optimization Control**: Per-tenant, per-model, per-feature LLM spend from Langfuse traces with enforceable daily token budgets. The AI platform manages its own largest variable cost — AI tokens — with real-time tracking and automated throttle enforcement.
- **Platform Feature-Flag Surface as Cross-Tenant Kill-Switch**: Global feature-flip, rollout %, sentinel-protected kill-switch, and per-tenant overrides from one screen. The AI platform controls its own feature deployment across all tenants with surgical precision — roll out to 5% of tenants, kill a bad feature globally in one click.
- **Usage + Cost Dashboard as Margin Intelligence**: Tenant-level and platform-wide usage rollups from Tinybird with cost-attribution math, trend sparklines, and CSV export. The AI platform computes its own profitability per tenant and identifies cost abusers automatically.
- **Deploy + Rollback Control Plane as Instant Incident Recovery**: One-click rollback to any previous version across subsystems with post-action live URL verification. The platform heals its own deployment state within seconds of detecting a bad deploy.
- **Auto-Incident Console with Linked Sentry Context**: Every operator incident auto-attaches recent Sentry issues and Axiom error spikes, with timeline management and postmortem linking. The AI platform assembles its own incident context across observability tools.
- **Support Impersonation as Safe Tenant Debugging**: Time-boxed, audited, banner-visible impersonation sessions let support debug tenant issues without credentials or DB access. The AI platform provides safe, trackable tenant access — every impersonated action is tagged with the operator's identity.
- **Abuse/Fraud Review Queue as Automated Abuse Detection**: Anomaly signals from Tinybird (AI-spend spikes, chargebacks, content-policy hits) populate a triage queue with suspend/ban actions. The AI platform detects its own abusers and provides one-click remediation.
- **Cross-Subsystem Global Search as AI-Powered Operator Discovery**: Cmd-K palette searches tenants, users, sites, invoices, jobs, incidents, and audits with AI-native natural-language-to-structural-filter as a fast-follow. The AI platform makes its own operational data instantly navigable.
- **Job-Queue + DLQ Admin as Self-Service Retry**: Failed Workflows and QStash jobs are surfaced with status, attempt count, last error, and one-click retry/requeue. The AI platform manages its own async failures without requiring infrastructure access.
- **Webhook Delivery Board as Delivery Assurance**: Inbound and outbound webhook deliveries with replay, filtering, and BFM-bypass guidance. The AI platform validates its own event delivery pipeline end-to-end.
- **Immutable Audit Log + Viewer as Forensic Foundation**: Every sensitive operator action writes an append-only, correlation-ID-linked audit row with a filterable viewer and CSV export. The AI platform records its own operational history permanently — every action is reconstructable.
- **Secret Management UI as Rotation Governance**: Secret names with set/unset status, last-rotated badges, and trigger-rotation action — values never displayed. The AI platform manages its own secret lifecycle without exposing secrets to the browser, preventing the most common platform-wide outage root cause.

## whole-app platform — Cross-Cutting: AI Business Platform Connections

- **Correlation-ID Propagation as End-to-End AI Debugging**: Mandatory `trace_id` + 7 tenant/site/app IDs across every hop lets AI agents trace a single cross-subsystem request from edge to data store. The platform instruments its own call graph — debugging a multi-Worker failure becomes a single trace query.
- **Typed Internal Service-Client SDK as Self-Healing Mesh**: Zod-typed, auto-correlation-ID-injected, retry+circuit-breaker client per subsystem eliminates integration drift between platform components. The AI platform's subsystems communicate through validated contracts, not ad-hoc `fetch` calls.
- **Platform Event Taxonomy + Event Bus as AI-Readable Activity Stream**: A canonical event taxonomy with Zod-enforced shapes flowing through every subsystem creates a unified, queryable event stream in Tinybird. The AI platform emits its own activity as typed events that can be consumed by analytics, billing, and agent-trigger workflows.
- **New-Subsystem Golden Path as Zero-Touch Platform Expansion**: A scaffold generator that bakes in correlation, health, events, entitlements, WAF-skip, and logging with one command. Expanding the AI platform with a new capability is a single command, not a multi-week integration project.
- **Per-Tenant Entitlements Gate as Universal Plan Enforcement**: A central entitlements service checked by every subsystem with KV-cached, server-enforced capability gating. The AI platform monetizes its own features per tenant without per-subsystem payment logic.
- **Unified Usage Metering via OpenMeter as Revenue Spine**: A `meter()` helper called by every billable action (AI tokens, publishes, API calls, storage) funneled into OpenMeter. The AI platform meters its own consumption and turns usage data directly into invoices — no manual meter reading.
- **Cost Attribution per Tenant as Profitability Compass**: A nightly job joining metered usage with vendor cost rates produces per-tenant margin data. The AI platform computes its own per-tenant P&L, surfacing unprofitable accounts before they become silent money drains.
- **End-to-End Onboarding as AI-Powered Tenant Activation**: A CF Workflow orchestrating org creation, site provisioning, CRM seeding, and entitlement setup lights up multiple subsystems in sequence. The AI platform activates new tenants across its entire feature surface with one signup action.
- **Unified Notification Fabric (psnotify) as Platform-Wide Alert Spine**: A single `notify()` API routing to in-app inbox, web-push, and email with per-tenant preferences. The AI platform communicates its own events (build complete, billing issue, incident resolved) through one fabric with zero per-feature notification code.
- **Platform-Wide Rate Limiting as Automated Abuse Prevention**: A shared DO-based rate limiter reading from Unkey API key limits enforces consistent throttling across every subsystem. The AI platform protects itself from abuse with a single global configuration, not per-Worker guesswork.
- **Cross-Subsystem Audit Log as Compliance Foundation**: Hash-chained, append-only audit events from every subsystem with a unified viewer and GDPR export. The AI platform records every cross-subsystem action in a tamper-evident log, making SOC2 and GDPR compliance a byproduct of architecture.
- **Platform-Wide GDPR Export/Erasure as Automated Privacy Compliance**: A fan-out orchestrator calling per-subsystem data handlers to assemble or erase a tenant's data across all stores. The AI platform executes its own privacy obligations across every subsystem with a single request.
- **Feature-Architecture Validator + Drift CI Gate as Self-Enforcing Standards**: A validator checking every subsystem against the platform spine (flags, manifests, health, correlation, events, E2E) with CI blocking on violations. The AI platform enforces its own architectural standards without manual code reviews.
- **Service Mesh Registry as Platform Topology SSOT**: A typed SERVICE_REGISTRY driving health polling, WAF-skip validation, subdomain provisioning, console navigation, and drift detection. The AI platform knows and verifies its own topology — what runs where, how to reach it, and whether it's live — in one configuration file.
