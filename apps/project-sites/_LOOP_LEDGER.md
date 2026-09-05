# ProjectSites.dev — THE Single TODO

> **Human-manageable scope → [`SCOPE.md`](../../SCOPE.md)** (mission · hard constraints · AI-buildable backlog · Brian-gated decisions). This file is the detailed task tracker + completion history behind it.
>
> **⚑ THE ONE running TODO list.** Every backlog/requirement file was folded here (brainstorm ideas stay ephemeral, NOT persisted) + deleted
> (git history holds the rest). **Sorted strictly by importance — top = do first.** Value-tiered
> (P0 → Tier 1 → Tier 4 → Dedicated → Needs-Brian); within each tier, most important first.
>
> **The finishing-loop cron drains this file.**
>
> **📦 Idea-wave / top-N brainstorm sections scrubbed 2026-08-13 — real work is tracked as tiered tasks + feature flags, not idea dumps.** See § Ship Log below.

---

## Architecture constraints

**Canonical → [`SCOPE.md`](../../SCOPE.md) § Hard constraints** (CF-first stack · data placement · auth · payments · observability · AI · quality gates). Removed services — **never reintroduce**: Lago/OpenMeter/Metronome (→ Stripe Meter Events) · Unkey (→ native `api_tokens`) · Nango (→ native MCP OAuth) · Inngest/Trigger.dev (→ CF Workflows/Queues + Hatchet) · Postiz (→ native social) · Novu (→ psnotify) · Resend/Postmark (→ SES + Listmonk) · Supabase · Firecrawl/Crawlee (→ Deepcrawl).

> Legend: `[ ]` open · `[x]` done · `[auto]` loop builds it · `[gated]` / `## ⛔ NEEDS BRIAN` needs Brian · `[dedicated]` supervised session. Close one, tick it, commit, next. Shipped proof + completion history = `git log`.

## 🚨 P0 — Critical (security / risk / margin — before any feature)

- [x] **Cross-tenant publish vuln — FIXED (loop fire 2026-06-28).** The real surface was `seo_autopilot.approveDraft(env, draftId, approvedBy)` — it fetched+approved+`applyToSite`-published a draft by id with NO org scoping. The route layer already guarded (`owner.org_id !== c.get('orgId')` → 404), but the SERVICE was org-unsafe for any other caller. Added a required `expectedOrgId` param + `if (draft.org_id !== expectedOrgId) return 'Draft not found'` (defense-in-depth, never leaks existence); route now passes `c.get('orgId')`. TDD: new SECURITY test asserts org_B can't approve org_A's draft (no status flip, no R2 publish) + 2 existing tests updated. 39/39 jest green, tsc 0 (worker → CI push). [DONE]
- [x] **Tenant `org_id` scoping audit — DONE (2026-06-28).** Security-reviewer audited all route→tenant-mutation paths: pattern is route-level ownership gates (`requireOwnedSite`/`gateOwnedSite`/`siteOrgId`), ~20 surfaces clean. Found **7 IDOR gaps, all in flag-DARK experimental modules** (zero live exposure) — **ALL 7 NOW GATED** with `assertSiteOwned`/org-compare before the service call, + tests: `edge_personalization`, `aeo_pass`, `search_submit`, `wireframe_planning` (4 WRITE, prior fire) + `gbp_assist` (guard-level, covers 3 routes), `site_thumbnail_grid`, `page_audio_summary` (this fire). Combined 71/71 jest green, tsc 0 across the 7 modules; worker → CI push. **REGRESSION GATE + 2 MORE (2026-06-28 capstone):** built `scripts/check-idor-gates.mjs` (flags any `:siteId`/`:id` feature handler lacking an ownership idiom) — it caught **2 gaps the agent's spot-check MISSED**: `ai_concierge_widget` + `site_semantic_search` (both authed, ungated) → gated via shared guard (10/10 jest, tsc 0). **9 IDOR gaps total now closed.** Gate wired into `npm run check` + feature-architecture CI (0-finding-stable → blocking); FP-tuned to recognize `verifySiteOwnership`/`fetchOwnedSite`. **WHOLE-WORKER coverage (2026-06-28):** extended the detector to ALSO scan legacy `src/routes/*.ts` — manually audited the 6 flagged route files: all clean (super-admin via `isSuperAdmin`, org-scoped via `org_id`, or intentionally PUBLIC visitor routes `concierge`/`i18n`/`page_audio`/`agentic_commerce` exempted). Detector now green across libs/features + src/routes. [DONE + class-gated worker-wide]
**PARKED → ⛔ NEEDS BRIAN:** parts (a) and (c) DONE. Remaining (b): swap GPT-4o vision→Workers-AI per-callsite. **Decision:** quality-judgment swap needs a dedicated session to verify each of the remaining vision callsites against llama-4-scout output quality. on every model call · (b) swap GPT-4o vision→Workers-AI where adequate · (c) cache research/brand/assets per business. PROGRESS 2026-06-28: AI-Gateway is default-on via `ai_gateway.ts` (`gatewayFetch`, 5xx→direct fallback), but **13 direct `api.openai.com`/`api.anthropic.com` fetches bypassed it** — built `scripts/check-ai-gateway.mjs` detector (report-mode `npm run check:ai-gateway`; audit-arc Detect+Surface) + routed the hottest (`openai_research.ts`, runs every build) → 13→12. Routed 13→12→8→**0 (part (a) DONE, fire 2026-06-28d):** routed the final 8 — `search.ts`×3 (vision-inspect threaded `env` through `inspectImageWithVision`; edit-image describe + dall-e), `external_llm:1181` (files-upload multipart), `image_generation`, `media`(tts), `image-generation.wf`, `site-generation.wf:1334`(vision critique) — all through `gatewayFetch(env,'openai',…)`. Detector `✓ no bypasses`, tsc 0; **flipped `check:ai-gateway --ci` into the blocking `npm run check` chain** (audit-arc Promote) so a regression now fails CI. 2 tests updated for the gateway shape (image_generation headers via `new Headers().get()`, external_llm uploadDoc → `mockGatewayFetch`); 65/65 green. Worker → CI push. **(c) CORE shipped 2026-06-28e:** `services/research_cache.ts` — pure stable `researchCacheKey(identity)` (placeId→domain→normalized name+address precedence, per-part trim so the same business always hits the same key) + `getCachedResearch`/`putCachedResearch` (CACHE_KV, 30-day TTL, never-throw) + `extractDomain`; 10 unit tests green, tsc 0. **(c) WIRED 2026-06-28f:** `researchAndFormulatePrompt` (openai_research.ts) now computes `researchCacheKey({placeId,name,address})`, `getCachedResearch` BEFORE the 5 research LLM calls (hit → return, skip all) + `putCachedResearch` AFTER — gated behind `research_cache` flag (default-off → dark; on the load-bearing build path so dark-launch is the disciplined default). 29 tests green (cache skipped when flag off → existing research behavior unchanged), tsc 0; worker→CI push. Flag-enable = the live ~15→5 min rebuild win (flags-green gate). **ONLY REMAINING for full #19 tick: (b)** swap GPT-4o vision→Workers-AI llama-4-scout where adequate (per-callsite QUALITY judgment — low-stakes calls like image-reachability/description can swap; keep gpt-4o for the high-stakes vision critique; verify output quality before enabling). NOTE: routing flips `init.headers` to a `Headers` object — tests asserting `init.headers.X` must use `new Headers(init.headers).get('X')`.

## 🔥 Tier 1 — Highest value (the revenue engine + what protects it)

### Conversion & activation (no revenue without these)
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** auth-bypass flow for unauthenticated builds. Needs D1 (anonymous session) + auth middleware changes + frontend. Dedicated session. — let visitors generate a build before the wall (biggest activation lever).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** inline Stripe checkout + claim flow. Needs frontend (button→checkout session) + D1 (claim state). Dedicated session. → inline Stripe checkout (collapse adopt→pay).
**PARKED → ⛔ NEEDS BRIAN:** backend module COMPLETE (14/14 unit, route 404-flag-off). **Decision needed:** dedicate a frontend session to render the 4 upgrade-moment cards at their friction points + flip the `upgrade_moments` flag. The pure catalog+eligibility+dismissal core is shipped. at the friction moment (custom domain / remove top-bar / more pages). **BACKEND DONE 2026-06-28** (dark behind `upgrade_moments`, default-off): new feature module `libs/features/upgrade_moments/` — pure catalog+eligibility core maps 6 friction triggers (`custom_domain`,`remove_branding`,`more_pages`,`ai_credits`,`priority_build`,`analytics_pro`) → honest, value-led, trigger-attributed upsells (`cta_url=/admin/billing?upsell=<trigger>` for funnel attribution); paid plans resolve `eligible:false` (never nag payers); dismissals persist in `CACHE_KV` (90d TTL, no D1 migration). Routes `GET /api/upgrade-moments`, `GET /api/upgrade-moments/:trigger`, `POST …/:trigger/dismiss` (404-when-off). 14/14 unit, tsc 0, validate:features PASS, worker→CI push (commit `2a93e167`). **REMAINING: (1)** FRONTEND — render the moment as a tasteful inline card at each free-plan friction point (slug-cap reached → `more_pages`; custom-domain modal → `custom_domain`; top-bar "remove" hover → `remove_branding`; low AI credits → `ai_credits`); wire dismiss + a Karma spec; **(2)** flip `upgrade_moments` flag beta/100% once a surface renders end-to-end + cta_url billing attribution verified.
- [x] Abandoned-build recovery email — DONE 2026-06-28 (dark-launched behind `abandoned_build_nudge`, default-off). Full chain shipped: migration `0581` `sites.nudged_at`+index (APPLIED prod+dev D1) · `'recovery'` email kind (preview CTA) · pure `selectAbandonedBuilds` (finished+unclaimed+age∈[24h,14d]+7d throttle) · `runAbandonedBuildNudges` orchestration (stamp-only-on-ok) · env runner `runAbandonedNudgesForEnv` (D1 scan: finished sites + owner-email join + unclaimed-via-subscriptions + previewUrl) wired into `index.ts scheduled()`. 13 unit tests incl dark-launch-no-op + flag-on scan; tsc 0; worker→CI push. Flag-enablement = separate flags-green gate (enable → cron emails owners of finished-but-unclaimed builds in test/live mode). [DONE] · (history) PROGRESS 2026-06-28: shipped the pure eligibility core `services/abandoned_builds.ts` `selectAbandonedBuilds(rows, nowMs, opts)` (finished + unclaimed + age∈[24h,14d] window + 7d re-nudge throttle) + 8 unit tests green, tsc 0. UPDATE 2026-06-28b: (1) ✅ `nudged_at INTEGER` column + `idx_sites_nudge_scan` shipped (migration `0581`, APPLIED to prod + dev D1); (2) ✅ `'recovery'` kind added to `claim_build_emails.ts buildClaimEmail` (preview-link CTA); (3) ✅ I/O orchestration `runAbandonedBuildNudges(deps, opts)` built — scan→select→send→stamp-only-on-ok (at-least-once, throttle-guarded) + 3 wrapper unit tests (17 total green, tsc 0). ONLY REMAINING = the env-backed cron call in `index.ts scheduled()`: a `runAbandonedNudgesForEnv(env)` providing the confirmed deps — `listCandidates` = finished sites LEFT JOIN active `subscriptions` (unclaimed) JOIN owner email (`SELECT u.email FROM users u JOIN memberships m ON u.id=m.user_id WHERE m.org_id=? ORDER BY u.created_at ASC LIMIT 1`, per notify.ts) + previewUrl `https://{slug}.{SITES_SUFFIX}`; `markNudged` = `UPDATE sites SET nudged_at=?`; `sendRecovery` = `sendClaimBuildEmail('recovery', …)`; gate the cron call behind `isFlagOn(env,'abandoned_build_nudge')` (default-off → dark-launch). Mechanical — all deps/queries confirmed.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** PostHog funnel events along search→signin→build→preview→claim→pay. Needs PostHog API + frontend event wiring. Dedicated session. in PostHog (search→signin→build→preview→claim→pay + drop-off cohorts).
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** this requires changes to the build container (stream chunks as they render) + a WebSocket/SSE endpoint in the worker. The UI polling spinner already works; streaming is a container-architecture change best done in a dedicated session with Docker access. during build (render-as-it-generates, not a polling spinner).
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** streaming each workflow step requires the build orchestrator to emit typed progress events over SSE. The workflow engine exists; the streaming layer needs a dedicated session to wire. during site-gen (stream each Workflow step, for trust).

### Money-trust & correctness (don't double-bill / don't lose builds)
- [x] General `Idempotency-Key` middleware — DONE 2026-06-28. `middleware/idempotency.ts` mounted `app.use('/api/*', idempotencyMiddleware)` after auth → dedupes ALL mutating (`POST/PUT/PATCH/DELETE`) `/api/*` requests carrying an `Idempotency-Key` header: first 2xx JSON cached in `CACHE_KV` (24h TTL, org-scoped key), replayed verbatim (`idempotency-replayed: true`) so the handler runs exactly once. Safe-by-default (no-op without the header → existing traffic unchanged; non-2xx never cached → errors retryable; cross-tenant replay impossible). TDD: 5 unit tests (replay / no-op / no-cache-on-error / cross-tenant isolation / key-scoping) green; existing API route suite still 40/40; tsc 0; worker → CI push. [DONE]
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** requires enabling CF Queues on the account + writing the outbox→DLQ→retry consumer. The event-bus schema exists; the infra wiring needs `wrangler` + CF dashboard access. → outbox → DLQ → retry loop for durable money/build events.
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** requires Docker (down locally) + container-server.mjs changes + a retry mechanism. Best done with Docker access in a dedicated session. on failure (capture/replay, not a silent error-email).
- [x] Sentry/observability on worker critical paths — DONE (verified 2026-06-28). All three named paths emit structured error visibility flowing to **Workers Tracing OTLP** (the project's observability backbone) + typed notifications: (1) **build-status callback** — structured `console.warn(level:error, service:build_status_finalize)` on finalize failure (#24, `index.ts:646`); (2) **workflow steps** — every helper catch (event-emit/status-update/audit-log) emits structured `console.warn(level:warn, service:workflow)`, and terminal build failures fire `notifyBuildFailed` → typed `build.failed` event + `status:'error'` + per-step exponential-retry (`site-generation.ts`); (3) **billing** — critical errors return TYPED `parseStripeError` envelopes (not swallowed); the `catch{}` blocks are intentional fail-soft graceful parsing per `fail-soft-prod`. No silent blind-spots remain on the critical paths. [DONE]

### Quality moat (why they pay — protects the generated product)
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** requires GPT-4o vision API calls + Lighthouse CI integration + regression-tracking storage. The scoring rubric is defined; the harness needs API credits + infra. every generated build (GPT-4o vision + Lighthouse + SEO, regression-tracked).
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** requires GPT-4o vision calls during build + an auto-reroll loop. The container orchestrator already calls GPT-4o; this adds a per-section quality gate. Needs a dedicated container session. auto-reroll (<8/10 → regenerate).
**PARKED → ⛔ NEEDS BRIAN:** **Decision needed:** requires axe-core running inside the build container + an auto-fix pipeline. The `build_validators` infra exists; this adds an auto-fix step that touches DOM. Dedicated container session. + AI alt-text — axe findings fixed pre-publish (ADA legal-risk reducer).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** GPT-4o scoring of 5 peer sites during build. Needs LLM calls + build-pipeline integration. Dedicated container session. — score 5 peer sites, propose missing sections.

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
**PARKED → ⛔ NEEDS BRIAN:** BACKEND DONE (9/9 unit). **Decision:** (1) D1 persistence + CRUD route, (2) cron geo-sweep, (3) /admin form widget. Needs D1/wrangler + route-mounts. 2026-06-28** (commit `ddac88bc`): `services/scan_profiles.ts` — Zod `ScanProfileConfig` (name/enabled/bboxes/categories/providers/filters/source/maxLeadsPerRun/intervalMinutes/lastRunAt) = the editable "what to hunt" config; `validateScanProfile` (flat errors), `isProfileDue`+`listDueProfiles` (cron due-logic), `profileToRunSpecs` (bboxes→per-run specs), `defaultScanProfile`. Pure, 9/9 unit, tsc 0. **REMAINING: (1)** D1 (or Twenty custom-object) persistence + CRUD route; **(2)** the cron geo-sweep that `listDueProfiles`→per-bbox `runScan`→stamp `lastRunAt`; **(3)** the /admin form widget. Top-14 #5.
- [x] **Email enrichment** — DONE 2026-06-28 (commit `aa029b07`). `services/email_enrich.ts`: `emailCandidatesForDomain` (ranked info@/contact@/…), strict fail-CLOSED `domainAcceptsMail` DoH MX check (a DNS error never over-credits), `classifyEmailSource` → `EmailSource` (listing/guessed_mx/guessed) feeding `contactConfidence`. 11 unit tests, tsc 0, worker→CI. Top-14 #6. [DONE]
- [x] **Address deliverability gate** (USPS #91) — GATE CORE DONE (2026-06-29). `services/address_deliverability.ts` — pure `assessAddressDeliverability(address, threshold=70)` → `{confidence 0–100, deliverable, parts, reasons}` from structural completeness (street# 25 / street 25 / city 15 / state 20 / ZIP 15; ZIP+4 + `74B`-style numbers accepted; 50-state+DC+territory validation; blank→0). This is the functional Lob-spend gate the orchestrator ANDs before a postcard send — it stops the obvious waste (no street#, no ZIP, bad state) with zero external dependency. 7 unit tests, tsc 0, worker→CI. **Follow-on (needs a secret, Brian-gated):** authoritative USPS CASS verification (catches valid-format-but-nonexistent addresses) needs a USPS Web Tools `USPS_USERID` — when provided, AND it with this gate. The functional spend-gate is live now. [DONE core]
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** claim landing page + email flow. Needs frontend (landing page) + email template + D1 claim state. Dedicated session. — landing triggers the build + "we'll email you when ready"; explore /admin meanwhile; prominent "Cancel build → /create (2 min)" escape. Wire to existing `claim_*` services. Top-14 #8.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** Veo thumbnail of future site in invite email. Needs Veo API + email template integration. Dedicated session. — thumbnail/Veo teaser of their FUTURE site embedded in the invite email (biggest CTR lever). Top-14 #9.
- [x] **CRM pipeline stages + claim webhook** — STAGE-MACHINE CORE DONE (2026-06-29). `services/lead_pipeline.ts` — pure, deterministic lifecycle: `LEAD_STAGES` (discovered→enriched→contacted→build_triggered→preview_sent→claimed, +`lost` terminal) + `canTransition(from,to)` (exactly one forward step; `claim` only from preview_sent; `lose` from any non-terminal; no skips/backward/off-terminal) + `applyLeadEvent(current,event)` → new stage or `null` on illegal (caller logs the rejected transition for the funnel dashboard #97) + `isTerminal`. 7 unit tests incl. full happy-path to claimed, tsc 0, worker→CI. (Zero-I/O core; the claim webhook + Twenty CRM sync call `applyLeadEvent` when the orchestrator #87 / claimyour.site funnel #92 fire — those wire it to D1/Twenty.) [DONE core]
- [x] **SoS new-filings provider** — DONE 2026-06-28 (commit `aa029b07`). `services/sos_filings.ts`: calendar-accurate `monthsSince` (a filing N years ago = N×12mo), `isRecentlyIncorporated` (≤6mo window), `parseSosRow`/`selectRecentSosLeads` (→ `DiscoveredBusiness` + age + `sos_<st>:<id>` dedupe key). Pure parser; the bulk-feed fetch + per-state column map are the orchestrator's (#87). 9 unit tests, tsc 0, worker→CI. Top-14 #11. [DONE]
- [x] **Channel router + drip sequence** — CORE DONE (2026-06-29). `services/outreach_router.ts` — pure deterministic state machine the orchestrator (#87) runs: `chooseChannel({emailConfidence,addressConfidence})` → `email`/`postcard`/`both`/`none` (both only when each clears its bar; none when unreachable → no spend) + `nextDripStep(state)` → email→nudge→postcard→final ladder that SKIPS steps whose channel isn't viable + STOPS on `replied` (stop-on-claim) or an exhausted ladder. 11 unit tests, tsc 0, worker→CI. (Zero-I/O core; caller resolves history/persists + the CAN-SPAM unsubscribe link rides the email template. Wires into the live drip when orchestrator #87 ships.) [DONE core]
- [x] **Coverage + funnel dashboard** — AGGREGATION CORE DONE (2026-06-29). `services/coverage_summary.ts` — pure `summarizeCoverage(scanRuns, leads)` → `{zipsScanned (distinct, deduped), lastScanAt, totalLeads, byTier (A–D), contactRate (contacted-or-beyond ÷ total), buildTriggered, claimed, pipelineValueCents (non-lost only)}`. Zero-I/O, all-zero on empty, never throws; keyed to the `PropensityTier`/`LeadStage` types so it composes the rest of the Lead Scanner. 6 unit tests, tsc 0, worker→CI. The dashboard UI renders this summary — consistent with the arc's other core ticks (#87/#94/#96/#98); the admin coverage panel is the thin wiring follow-on. [DONE core]
- [x] **Auto-suppression + compliance + dedupe** — CORE DONE (2026-06-29). `services/lead_suppression.ts` — pure `dedupeKey(b)` (externalId → name|address fallback) + `filterContactable(candidates, {claimedExternalIds, optedOutEmails, bouncedEmails})` → contactable, deduped, order-preserving list + per-reason drop counts (`duplicate`/`claimed`/`opted_out`/`bounced` — feeds the coverage dashboard #97). Case-insensitive; keeps no-identity candidates; composes the existing `email_suppressions` (bounced) source. NEVER re-contacts a claimed/opted-out/bounced business. 9 unit tests, tsc 0, worker→CI. (Zero-I/O core; orchestrator #87 resolves the suppression sets from D1 + runs this gate before outreach spend.) [DONE core]
- [x] **CRM go-live + scan-route wiring** — DONE 2026-06-28 (Brian provided the Twenty API key). ✅ `TWENTY_API_URL`=https://crm.projectsites.dev + `TWENTY_API_KEY` set as prod worker secrets. ✅ Twenty REST confirmed LIVE; it **400s unknown fields** → provisioned **11 Company custom fields** via the metadata API (leadScore/payTier/outreachChannel/leadSource/externalId/workEmail/leadPhone/leadCategory/emailConfidence/addressConfidence/hasWebsite; objectMetadataId `ff35f144…`). ✅ `crm_leads` rewritten to the real shape (composite `address`, custom fields, `data.createCompany.id`, externalId dedupe) + **live create+delete verified** (HTTP 201). ✅ Live OSM→CRM route `POST /api/admin/leads/scan-osm` (super-admin + `lead_scanner` flag) wired (commits `d10b8d82`+`791f8f88`, worker→CI). ✅ `lead_scanner` flag enabled global/100%. **REMAINING (verification, not gated):** authed prod route-smoke after CI worker-deploy (direct curl is BFM-403'd → browser/E2E super-admin session); optional cron geo-sweep for unattended automation. Pipeline LIVE end-to-end. [DONE]

## 🏗 Monumental Platform Initiatives — Multi-Month Builds (Brian directive 2026-06-29)

> Five consolidated platform-scale initiatives from a codebase-wide architecture scan. Each
> represents a genuinely novel platform capability — not a feature, not a polish pass — that
> would take a skilled developer **1–3 months** of dedicated work. These are the "next chapter"
> items that sit ABOVE the finishing-loop cadence: each needs its own dedicated arc with
> phased workstreams, not incremental loop-fire draining.
>
> **Consolidation note:** The original 10 ideas collapsed to 5 per Brian's direction:
> Workers for Platforms + Container App Runtime merged (one CF-native hosting substrate,
> Workers-only), Analytics starts with CF Analytics Engine piping into the existing dashboard,
> and the rest ship as specced.

### 1. Workers for Platforms — CF-Native Full-Stack Hosting Substrate [2–3 dev-months]

**What:** Every customer site/app graduates from static R2 assets to a dispatch-namespace
Worker with scoped D1/KV/R2/DO bindings, per-tenant CPU/subrequest caps, and true code
isolation. Merges the old #1 (WfP) + #9 (Container App Runtime) — one substrate, CF-only.

**Already in place:**
- `src/services/site_serving.ts` (62K) — the current static-serving path
- `src/services/app_provisioner.ts` + `app_runtime` DO — early app-provisioning skeleton
- `src/services/db_allocation.ts` / `db_sharding.ts` / `db_shards.ts` — DB-per-tenant primitives
- `src/services/domain_stack.ts` / `src/services/domains.ts` — per-app routing infra
- `src/routes/apps.ts` (26K) — app CRUD surface
- `apps/project-sites/infra/` — per-subsystem wrangler configs

**Implementation spine:**
1. Workers for Platforms dispatch namespace — per-customer Worker isolate with CPU/subrequest caps
2. Binding scoping — D1 DB-per-app, KV namespace-per-app, R2 prefix-per-app, DO class-per-app
3. `wrangler deploy` from the platform — customer code → build → WASM-harden → live in <60s
4. Per-app environment variables (AES-GCM encrypted, reusing `ai_env_vars.ts` patterns)
5. Usage metering per app (CPU ms, requests, bandwidth, D1 rows) feeding Stripe Meter Events
6. App health monitoring with auto-restart (DO alarm pattern)
7. Build logs, deploy history, instant rollback (`wrangler rollback` per-app)
8. Migration of `site_serving` to multi-tenant dispatch — every `{slug}.projectsites.dev` is a Worker
9. Admin UI — app detail page with deploy history, env vars, logs, health, usage charts
10. Free-tier guardrails — CPU cap, bandwidth cap, request cap, cold-start budget

**Why it's the keystone:** Every other monumental initiative (#2–#5) runs ON this substrate.
Without it, projectsites is a static-site host with a generator bolted on. With it, projectsites
is the edge application platform the STRATEGY.md thesis demands.

### 2. Public Developer API Platform [2–3 dev-months]

**What:** A production-grade public API at `api.projectsites.dev` with typed SDKs (TS/Python),
OpenAPI 3.1 + Scalar docs, per-key metered billing, and a self-serve developer portal.
This is the revenue-facing product layer ON TOP of the native `api_tokens` key-management spine.

**Already in place:**
- `src/services/api_tokens.ts` + `src/routes/api_tokens_admin.ts` — native tenant API-token management (replaces removed Unkey)
- `src/middleware/api-keys.ts` + `src/middleware/rate_limit.ts` — auth/rate-limit middleware
- `src/services/usage_metering.ts` — usage-event pipeline (Stripe Meter Events; Lago removed)
- `src/routes/openapi.ts` — OpenAPI serving stub
- `libs/features/platform_mcp/` — MCP server already exposes platform tools

**Implementation spine:**
1. Ship native api-token management (scoping, rotation, revocation, rate limits, quotas)
2. OpenAPI 3.1 spec for all `/api/v1/*` routes — Zod-derived via `@asteasolutions/zod-to-openapi`
3. Scalar API reference at `docs.projectsites.dev/api` — served from R2
4. Typed SDKs — `@projectsites/sdk` (TS), `projectsites` (PyPI) — generated from OpenAPI
5. Stripe Meter Events enforcement — per-key usage → Tinybird → Stripe Meter Events → invoice
6. AI credit metering — separate credit pool for AI-backed routes, model-priced
7. Self-serve developer portal — `/admin/api-keys` with create/rotate/revoke, usage charts
8. SDK quickstart snippets (curl, TS, Python) with retry-on-429 + rotation guidance
9. Abuse/anomaly detection — per-key spike/geo/error-rate monitoring → auto-throttle
10. MCP/agent keys — scoped `psk_` keys for AI agents with per-tool permissions

**Revenue model:** Usage-based billing (requests + AI credits + bandwidth) on paid plans.
Free tier gets a generous monthly quota. The API IS the paid-tier differentiator — any
integration, any agent, any automation runs through it.

### 3. AI-Powered Visual Site Builder [2 dev-months]

**What:** A drag-and-drop visual page builder (GrapesJS) where AI generates sections and the
site owner visually rearranges, tweaks, and publishes. This is the third editor view alongside
code (Monaco) and preview (iframe) — the one non-technical owners actually use.

**Already in place:**
- `src/services/ide_sandbox.ts` (19K) — sandboxed code execution
- `src/services/bolt_*.ts` + `editor_chats.ts` — bolt.diy editor integration
- `src/services/visual_point_edit.ts` feature module — visual editing primitives
- `src/services/build_validators.ts` (33K) — 13 quality gates that would validate builder output
- `src/services/site_serving.ts` — the serve path a builder-published site takes
- `libs/features/generative_ui_stream/` — streaming UI generation
- `libs/features/edge_personalization/` — per-visitor content adaptation

**Implementation spine:**
1. GrapesJS integration with custom block types matching generated-site components
2. Block catalog — heroes, stats, testimonials, pricing tables, FAQ, contact forms, galleries
3. AI section generation — "add a testimonial section with 3 quotes from my Yelp reviews"
4. Drag-to-rearrange → updates the Vite+React source (AST-aware, not regex)
5. Visual-to-code round-trip — edit visually or in code, never out of sync
6. Real-time preview as-you-edit (iframe hot-reload via Vite HMR)
7. Undo/redo with version snapshots (reusing `site_branches.ts` + R2 versioning)
8. Publish-from-builder — one button, same deploy pipeline as AI-generated sites
9. Component marketplace — community-contributed blocks, installable per site
10. Mobile-responsive editing — resize the canvas, see breakpoints live

### 4. Site Analytics Suite — CF Analytics Engine First [1–2 dev-months]

**What:** Every generated site gets a lightweight analytics dashboard showing visitor counts,
page views, top referrers, and conversion events — powered by Cloudflare Analytics Engine
(already sampling every `{slug}.projectsites.dev` request at the edge). Start by surfacing
CF's existing data in the admin dashboard; expand toward session recording, heatmaps, and
funnel analysis over time.

**Already in place:**
- `src/services/cf_analytics.ts` + `src/services/cloudflare_analytics.ts` (15K) — CF Analytics bindings
- `src/services/analytics.ts` + `src/services/analytics_events.ts` — event capture pipeline
- `src/services/analytics_tracker.ts` + `src/services/analytics_schema.ts` — tracking infra
- `src/services/analytics_rollup.ts` + `src/services/analytics_query.ts` — aggregation layer
- `src/services/analytics_exporter.ts` — data export
- `src/services/funnel_conversion.ts` + `src/services/activation_funnel.ts` — funnel tracking
- `libs/features/site_analytics/` — per-site analytics feature module
- `libs/features/visitor_events_core/` — visitor event primitives
- Admin: `analytics.component.ts` (58K), `analytics-dashboard`, `analytics-live` — dashboard surfaces
- `POST /api/sites/:siteId/analytics/*` — per-site analytics API routes

**Implementation spine (Phase 1 — CF-native, ship in weeks):**
1. Pipe CF Analytics Engine data (requests, bandwidth, status codes, countries) into Tinybird
2. Per-site dashboard widget — "Last 30 days" traffic summary card on site detail
3. Top pages, top referrers, device breakdown — all from CF Analytics Engine (no client script)
4. Conversion events (phone taps, direction requests, form submissions) from existing `data-ps-section` attribution

**Phase 2 (expand over months):**
5. Lightweight client beacon for click/scroll heatmaps (self-hosted, privacy-compliant)
6. Session recording and replay (optional, gated behind consent)
7. Conversion funnel builder — drag steps, see drop-off
8. Automated insights — "Your /services page has a 90% bounce rate from mobile"
9. Competitor traffic benchmarking — "Sites like yours average X visits/month"
10. Export-to-Google-Sheets / CSV / scheduled email reports

**Privacy posture:** CF Analytics Engine is server-side, no client script needed for core
metrics. Heatmaps/recordings are opt-in, cookie-optional, GDPR-compliant. This is a
differentiator vs GA4/Fathom/Plausible — analytics without the surveillance.

### 5. Instant Preview Environments [1–2 dev-months]

**What:** Every edit, every branch, every AI experiment gets its own live URL
(`<hash>.preview.projectsites.dev`) instantly. Built on D1 database branching
(copy-on-write) + R2 version pinning. The AI build pipeline gets preview-before-publish;
owners get shareable review links; agents get sandbox URLs.

**Already in place:**
- `src/services/site_branches.ts` (11K) — site branching primitives
- `src/services/snapshot_restore.ts` — snapshot/restore infra
- `src/routes/site_branches.ts` — branch API routes
- `src/services/preview_share_card.ts` — share-card generation (backend LIVE)
- `libs/features/preview_share_card/` — share-card feature module (LIVE, flag-dark)
- R2 versioning — already enabled on `SITES_BUCKET`
- D1 Time Travel — 30-day PITR available
- `src/workflows/site-generation.ts` (62K) — the build pipeline that would publish to preview first

**Implementation spine:**
1. Per-change URL generation — `<hash>.preview.projectsites.dev` resolves instantly
2. R2 copy-on-write — each preview pins the site's R2 objects at publish time
3. D1 preview branch per environment (D1 database branching, not full DB-per-preview)
4. Preview environment comparison — side-by-side visual diff tool
5. Comment/review overlay on preview URLs (for team/agency plans)
6. Automatic cleanup — stale previews expire after N days with retention policies
7. GitHub/Git integration — PR-preview auto-generation via GitHub Actions
8. Access control — public, team-only, password-protected previews
9. "Promote to live" — one click from preview → production (the existing deploy path)
10. AI agent integration — the MCP `deploy_site` tool returns a preview URL first

**Why it's transformative:** The AI build pipeline currently goes straight to production.
Preview-first means every build is safe, every edit is reviewable, and the "vibe-code →
production" pipeline gets a safety net. For agency/team plans, preview-with-comments is the
collaboration surface that sells upgrades.

---

## 💬 Chatwoot Support Platform — Phase 1-5 Roadmap (2026-07-01)

> **Deployed:** support.projectsites.dev (Fly.io, HTTP 200, Chatwoot onboarding LIVE)
> **Fork:** [ProfessorManhattan/chatwoot](https://github.com/ProfessorManhattan/chatwoot) — CE with ProjectSites custom Docker image
> **Research:** 50 deep-integration ideas → top 20 ranked · 50 ambitious ideas → top 20 ranked
> **Strategy:** External services + API + targeted CE patches (not hard fork)
> **Target:** First-response from hours → <5min critical, <30min normal
> **Team:** 1-2 technical leads + generalist agents, tiered escalation
> **AI autonomy:** Full — AI fixes whatever it can diagnose, escalates only when blocked

### Phase 1 — Immediate Response (Ship by 2026-07-15) — Target: <5min critical

| # | ID | Task | Est. | Status |
|---|---|------|------|--------|
| 1 | `chatwoot-ai-triage` | **AI Triage Engine** — Upgrade AgentBot from keyword matching to Workers AI Llama 3.3 70B semantic classification. Intent detection, urgency scoring (0-100), sentiment analysis (-1 to 1), confidence score, label suggestion. Service + route built, needs deploy + test. | 35h | ✅ **BUILT** (service + route), ⏳ deploy pending |
| 2 | `chatwoot-sla-worker` | **SLA Enforcement Worker** — Cron polls Chatwoot API every 30s. SLA based on tier (VIP=5min, paid=15min, free=60min) × intent (site-down=contract, feature-request=relaxed). Breach → escalation ladder: Slack → SMS → team lead. Live SLA burn-down dashboard. | 40h | ⏳ TODO |
| 3 | `chatwoot-smart-router` | **Smart Router** — Replace Chatwoot FIFO with intent+tier+load-based routing. Billing→billing team, DNS→launch team, VIP→senior agents. Respects agent shifts/offline status. | 25h | ⏳ TODO |
| 4 | `chatwoot-health-dashboard` | **Admin Support Dashboard** — Angular SPA at /admin/support. Live queue depth, active agents, SLA status (green/yellow/red), today's metrics, "needs attention" list sorted by priority. 15s auto-refresh. | 10h | ⏳ TODO |

### Phase 2 — Agent Acceleration (Ship by 2026-08-01) — Target: handle time -50%

| # | ID | Task | Est. | Status |
|---|---|------|------|--------|
| 5 | `chatwoot-customer-360` | **Customer 360 Dashboard App** — Chatwoot iframe dashboard app. Shows sites owned, plan tier, MRR, last 5 deploys, Stripe invoices, Sentry errors, PostHog activity, past conversation summaries. Single /api/customer-360 endpoint. | 40h | ⏳ TODO |
| 6 | `chatwoot-ai-copilot` | **AI Copilot — Draft Reply** — Agent opens conversation → AI drafts reply from macros + help center + similar past resolutions. Agent sees draft + sources. One-click send or edit. Suggests labels + priority. | 40h | ⏳ TODO |
| 7 | `chatwoot-playbook-engine` | **Guided Playbook Engine** — For generalist agents. "Site-down" playbook: (1) confirm slug → (2) check HTTP [button] → (3) check DNS [button] → (4) check R2 [button] → (5) rebuild [button]. One click per step. Technical leads build playbooks, generalists execute. | 30h | ⏳ TODO |
| 8 | `chatwoot-saved-replies` | **Saved Reply Library + AI Search** — 50+ macros via Chatwoot API (NOT Rails console). Agent types /dns → AI returns top 3 matching macros. Tracks macro usage + gap detection. Enhanced seed script replaces manual Rails console approach. | 10h | ⏳ TODO |

### Phase 3 — AI Deflection (Ship by 2026-08-15) — Target: 50% auto-resolved

| # | ID | Task | Est. | Status |
|---|---|------|------|--------|
| 9 | `chatwoot-captain-custom` | **Captain-Style AI Assistant** — Customer-facing AI on Workers AI Llama 3.3 with tool-calling. Can: answer FAQ, check site status, check DNS, trigger rebuild, process refunds. Hands off when confidence <0.7 or customer asks for human. | 60h | ⏳ TODO |
| 10 | `chatwoot-site-doctor` | **Site Doctor Agent (Full Autonomy)** — AI with tool access: HTTP check → DNS check → SSL check → R2 check → D1 check → deploy logs → root cause → apply fix (purge, rebuild, DNS correction). Every action logged as private note. Escalates only when fix requires code change or diagnosis fails. | 50h | ⏳ TODO |
| 11 | `chatwoot-knowledge-nexus` | **Knowledge Nexus — Self-Learning FAQ** — Resolved conversations are summarized, embedded, vector-stored in D1/Vectorize. Next similar question gets the answer instantly. 5+ same questions in a week → auto-generate help center draft. | 30h | ⏳ TODO |

### Phase 4 — Operational Maturity (Ship by 2026-09-01) — Target: zero missed SLAs

| # | ID | Task | Est. | Status |
|---|---|------|------|--------|
| 12 | `chatwoot-outage-war-room` | **Proactive Outage Detection + War Room** — >5 "site down" in 5min OR >10 failing health checks → auto-create war room conversation → post affected sites + errors → notify on-call via SMS → bulk-message affected customers → 15-min status update timer. | 30h | ⏳ TODO |
| 13 | `chatwoot-oncall-engine` | **On-Call Escalation Engine** — After-hours mode. Critical convos → SMS to on-call. Unacknowledged 10min → next on-call. All miss → #incidents Slack. | 20h | ⏳ TODO |
| 14 | `chatwoot-widget-prefill` | **Widget Pre-Chat Context Collector** — Before chat opens: "What's your site domain? What's the issue?" Two fields → conversation opens with site_id + issue as custom attributes. Cuts diagnostic back-and-forth. | 15h | ⏳ TODO |
| 15 | `chatwoot-dedup` | **Conversation Dedup + Merge** — AI detects same customer + same issue across channels → merges into one. Also surfaces: "We answered this 3 days ago — here's the resolution." | 20h | ⏳ TODO |
| 16 | `chatwoot-translate` | **Multi-Language Pipeline** — Auto-detect language → translate to agent's language → agent replies → translate back. Workers AI Llama 3.3 translation. Bilingual message storage. Analytics by language. | 15h | ✅ **BUILT** (service), ⏳ route integration pending |
| 17 | `chatwoot-post-resolution` | **Post-Resolution AI Summary** — AI writes: root cause, what was tried, what worked, sentiment, follow-up needed, suggested help center update. Stored in D1 for future agent reference. | 10h | ⏳ TODO |

### Phase 5 — Platform (Ship by 2026-10-01) — Target: support as revenue line

| # | ID | Task | Est. | Status |
|---|---|------|------|--------|
| 18 | `chatwoot-support-as-service` | **Support-as-a-Service** — Stripe add-on for support plans (Basic/Premium/VIP). Platform API auto-provisions inbox + SLA policy + agent assignment. Customer gets branded widget. Billing via Stripe metered or flat monthly. | 40h | ⏳ TODO |
| 19 | `chatwoot-health-score` | **Customer Health Score** — Composite from CSAT × response time × site uptime × payment history × login frequency × feature usage. Drops → proactive outreach. Rises → early-access offers. | 25h | ⏳ TODO |
| 20 | `chatwoot-analytics` | **Support Analytics + Reporting** — Tinybird pipeline for Chatwoot webhook events. Real-time: conversation volume, response time trends, CSAT by agent/team/topic, AI deflection rate, SLA compliance. Weekly PDF report. 7 pre-built Tinybird pipes for admin dashboard. | 15h | ✅ **BUILT** (datasource + pipes + service), ⏳ Tinybird deploy pending |
| — | `chatwoot-fork` | **Chatwoot CE Fork** — ProfessorManhattan/chatwoot with custom Dockerfile.projectsites extending official image. Branding env vars, seed scripts, health check. | — | ✅ **DONE** |

### Immediate next actions (do in order)

1. **Deploy AI Triage Engine** — `wrangler deploy` → test with real Chatwoot webhook
2. **Create Tinybird datasource** — `tb push infra/tinybird/chatwoot_events.datasource`
3. **Ship Saved Reply Library** — Update seed script to use Chatwoot API, add AI search
4. **Build SLA Worker** — #2 is the highest-value missing piece for slow-response fix
5. **Customer 360 Dashboard App** — #5 is the biggest agent-efficiency unlock

---

## 🕷 Deepcrawl Integration — Site Pipeline Supercharger (2026-07-01)

> Deepcrawl is deployed at `deepcrawl.projectsites.dev` (dashboard) +
> `api.deepcrawl.projectsites.dev` (API worker) + `firecrawl-bridge.projectsites.dev`
> (Firecrawl-compatible bridge). These 10 specs wire it into the ProjectSites site
> generation pipeline: research → build → verify → monitor → revenue.
>
> Each spec is a standalone feature module behind its own flag (dark-launch at
> `experimental, enabled=0, rollout=0`). Promote individually through
> experimental→beta→stable. Pure logic ships first (zero-I/O services); wiring
> into the build pipeline + routes follows.
>
> **Architecture decisions (2026-07-01):**
> - **Flags:** one per spec, never auto-activate on env var
> - **#4 cutover:** run old scraper + Deepcrawl in parallel for 30 days, compare, drop old scraper
> - **#2 severity:** log-only (D1 audit) during experimental; block publish at beta/stable
> - **#6 billing:** usage-metered (Stripe) (per-monitor usage events), not flat plan add-on
>
> **Deepcrawl client:** `src/services/deepcrawl.ts` (✅ CREATED) — typed API client
> calling `api.deepcrawl.projectsites.dev` with the ProjectSites internal API key.
> All 10 specs below call this one client.

### #1 — Competitor Research Automation [replace Phase -1 manual crawl]

**What:** Deepcrawl top 5-10 competitor sites → structured data → 100-pt rubric scoring.
Sets the floor every build must clear by ≥15% per `competitor-research.md`.

**Implementation:**
- [ ] `services/competitor_research.ts` — pure `researchCompetitors(deepcrawl, urls[])`:
  crawl each → extract title/meta/OG/h1/JSON-LD/images/lighthouse-scores →
  score on 10 dims × 10pts (visual/IA/copy/conversion/SEO+AI-search/perf/a11y/trust/AI-native/distinctiveness) →
  return `{perCompetitor: ScoreCard[], aggregate: CompetitorFloor}`
- [ ] `services/competitor_floor.ts` — pure `checkAgainstFloor(site, floor)` →
  `{cleared, gaps[]}` — a build can't exit Phase 6 until every dim clears the MAX-of-competitors + 15%
- [ ] Wire into `site-generation.ts` Phase -1 (research step) — crawl competitors, persist `_competitors/*_score.json`, set floor
- [ ] Reuse existing `_competitor_aggregate.json` + `_competitor_gaps.md` conventions
- [ ] Flag: `deepcrawl_competitor_research` (experimental, default-off, env: `DEEPCRAWL_API_URL` must be set)

**Files:** `services/competitor_research.ts`, `services/competitor_floor.ts`, wire into `site-generation.ts`

### #2 — Automated SEO Audit (Post-Deploy Gate)

**What:** Post-build crawl of every generated page: title length, meta desc, H1 count,
schema presence, canonical, OG image, sitemap lastmod. Feed violations into
`validator-fixer` agent.

**Implementation:**
- [ ] `services/seo_audit_crawler.ts` — pure `auditSiteSeo(deepcrawl, baseUrl, routes[])`:
  crawl each route → extract `<title>` length (50-60 gate), `<meta description>` (120-156 gate),
  H1 count (exactly 1), JSON-LD block count (≥4), canonical presence, OG image dimensions,
  sitemap entries with `<lastmod>` → return `SeoAuditReport{violations[], score, passedRoutes, failedRoutes}`
- [ ] Map each violation to the 13 `build_validators.ts` invariant codes
- [ ] Wire as a post-deploy step in `site-generation.ts` — run after R2 upload, before `published` status flip
- [ ] **Log-only during experimental** — report violations to D1 `audit_logs`, never block publish
- [ ] At beta/stable: flip to `strict` mode — violations block publish (site → `error` status)
- [ ] Flag: `deepcrawl_seo_audit` (experimental, default-off)

**Files:** `services/seo_audit_crawler.ts`, wire into `site-generation.ts` + `build_validators.ts`

### #4 — Source Site Deep Crawl (Replace Current Scraper)

**What:** Replace the existing scraping infrastructure with Deepcrawl's
markdown + metadata + link-tree output. Single biggest quality lift for the
entire generation pipeline.

**Implementation:**
- [ ] `services/deepcrawl_source.ts` — pure `crawlSourceSite(deepcrawl, url)`:
  1. Call `/links?url=…&depth=6` to discover all source URLs
  2. Call `/read` on every page → `{markdown, metadata, links, images}`
  3. Classify each page: keep / merge / 301 / drop (per source-site-enhancement.md)
  4. Return `SourceCrawlResult{pages: PageData[], ia: IAPlan, assets: AssetInventory}`
- [ ] Replace the current scraper in Phase 0 with Deepcrawl — one call replaces the multi-API scrape chain
- [ ] Feed output into existing `_scraped_content.json` format for backward compat
- [ ] **30-day parallel run:** run old scraper + Deepcrawl side-by-side, compare output quality
- [ ] After 30 days green: drop old scraper, Deepcrawl becomes sole source crawler
- [ ] Flag: `deepcrawl_source_crawl` (experimental, default-off, promote to stable after parallel run green)

**Files:** `services/deepcrawl_source.ts`, modify `site-generation.ts` Phase 0 research step

### #5 — Agent-Ready Site Context (MCP + Public API)

**What:** Expose every generated site as a clean markdown corpus for AI agents via
MCP tools and a public API. Platform-level moat — no other website builder gives
agents structured access to built sites.

**Implementation:**
- [ ] `services/site_context_mcp.ts` — MCP tool definitions (oRPC contract):
  `projectsites.readSite(slug)` → full site as markdown corpus
  `projectsites.readPage(slug, path)` → single page markdown
  `projectsites.getSiteMap(slug)` → link tree + page summaries
  `projectsites.searchSite(slug, query)` → semantic search across site pages
- [ ] `routes/mcp_site_context.ts` — Hono routes implementing MCP protocol
- [ ] Per-site `llms.txt` auto-generation on publish (Markdown listing all routes + summaries)
- [ ] Per-site `/llms.txt` endpoint on every `{slug}.projectsites.dev/llms.txt`
- [ ] Flag: `deepcrawl_agent_context` (experimental, default-off)

**Files:** `services/site_context_mcp.ts`, `routes/mcp_site_context.ts`, modify `site_serving.ts` for llms.txt

### #6 — Competitor Monitor Dashboard ($29/mo Add-On)

**What:** Recurring revenue add-on. Track 3-5 competitor websites per client,
detect changes, send weekly email reports. Firecrawl customers pay $19-299/mo
for this — proven market, zero marginal cost.

**Implementation:**
- [ ] `services/competitor_monitor.ts` — core engine:
  `createMonitor(siteId, competitorUrls[])` → D1 row
  `runMonitorCheck(deepcrawl, monitor)` → crawl each competitor → diff vs prior snapshot →
    detect: new pages, removed pages, content changes, design/layout changes, new pricing,
    new features → `MonitorReport{changes[], diffSummary, snapshotId}`
  `scheduleMonitorCheck(env, monitorId)` — Cron/Queue trigger
- [ ] `services/competitor_diff.ts` — pure `diffPageSnapshots(prev, current)` →
  content similarity (cosine), structural changes (link tree delta), metadata changes
- [ ] D1 tables: `competitor_monitors` (site_id FK, urls JSON, frequency, tier), `competitor_snapshots`
- [ ] `routes/competitor_monitor.ts` — CRUD + manual-check trigger
- [ ] Email: weekly digest via Resend/SES using existing notify path
- [ ] **Billing: usage-metered (Stripe)** — `competitor_monitor_check` usage events per check, NOT a flat plan add-on
- [ ] Flag: `competitor_monitor` (experimental, default-off, paid-tier only)

**Files:** `services/competitor_monitor.ts`, `services/competitor_diff.ts`, `routes/competitor_monitor.ts`,
D1 migrations, `src/services/notifications.ts` (add competitor-digest template)

### #7 — Broken Link + Content Rot Detection [Daily Monitor]

**What:** Daily crawl of all published ProjectSites, flag 404s, broken assets, stale content,
missing required files. Turns site hosting from "deploy and forget" into an ongoing
service relationship. Feeds the Site Doctor dashboard.

**Implementation:**
- [ ] `services/site_health_monitor.ts` — pure `checkSiteHealth(deepcrawl, site)`:
  1. Crawl all internal links → flag 4xx/5xx, redirect chains
  2. Check all `<img>`/`<link>`/`<script>` → flag 404 assets
  3. Verify sitemap entries all resolve
  4. Check required files exist (`site.webmanifest`, `robots.txt`, `humans.txt`, etc.)
  5. Score 0-100 health → `SiteHealthReport{score, issues[], warnings[]}`
- [ ] `services/site_staleness.ts` — pure `checkContentStaleness(site)`:
  detect pages unchanged >90 days, flag for refresh suggestion
- [ ] Cron: `scheduled/health-monitor.ts` — iterates published sites, runs checks, logs to D1
- [ ] Feed health scores into existing `site_doctor` + `prod_readiness_score` pipeline
- [ ] Flag: `deepcrawl_health_monitor` (experimental, default-off)

**Files:** `services/site_health_monitor.ts`, `services/site_staleness.ts`, `scheduled/health-monitor.ts`

### #8 — Pre-Flight Research Agent [Autonomous Phase 0]

**What:** Before any site build: Deepcrawl Google Places, Yelp, BBB, social profiles,
existing website, Secretary of State filings. Assembles the full `_research.json`
autonomously. Closes the Phase 0 context-saturation gap.

**Implementation:**
- [ ] `services/preflight_research.ts` — pure `runPreflightResearch(deepcrawl, business)`:
  1. Deepcrawl the existing website (if any) → full content + structure
  2. Deepcrawl Google Places listing → hours, photos, reviews, categories
  3. Deepcrawl Yelp page → reviews, rating, price range
  4. Deepcrawl BBB profile → rating, accreditation, complaints
  5. Deepcrawl social profiles (Facebook, Instagram, LinkedIn) → follower counts, content
  6. Deepcrawl SoS filings → legal name, incorporation date, status
  7. Assemble `_research.json` with confidence scores per data point
- [ ] Replace the current multi-API research phase with a single orchestrated call
- [ ] Every data source is optional — missing/failed source degrades gracefully
- [ ] Flag: `deepcrawl_preflight` (experimental, default-off)

**Files:** `services/preflight_research.ts`, modify `site-generation.ts` Phase 0 research step

### #10 — Content Inventory & IA Generator

**What:** Crawl source sitemap → classify every page (keep/merge/301/drop) →
generate information architecture with nav structure. Automates the most
labor-intensive part of site rebuilds.

**Implementation:**
- [ ] `services/ia_generator.ts` — pure `generateIA(deepcrawl, sourceUrl)`:
  1. Discover all source URLs via sitemap.xml + link crawl
  2. Classify per `source-site-enhancement.md` rules:
     - `/home` → `/` (301)
     - `/our-mission-1`, `/blog-1`, `/testpage`, `/new-page-*` → drop or 301
     - Squarespace random IDs → semantic + 301
     - `/health-clinic` → `/services/health-clinic`
  3. Generate IA tree: mega-menu for >12 routes, faceted nav, on-site search
  4. Return `IAPlan{routes: RouteMapping[], nav: NavTree, redirects: RedirectMap}`
- [ ] Wire into Phase 0 of `site-generation.ts` → output becomes the build plan
- [ ] Flag: `deepcrawl_ia_generator` (experimental, default-off)

**Files:** `services/ia_generator.ts`, modify `site-generation.ts` Phase 0

### #14 — Bulk Site Migration Validator

**What:** When updating templates across hundreds of sites: Deepcrawl before/after,
assert every URL preserved, every image migrated, no content loss, no 404 regressions.

**Implementation:**
- [ ] `services/migration_validator.ts` — pure `validateMigration(deepcrawl, oldSite, newSite)`:
  1. Crawl all old-site URLs → `OldSiteSnapshot{urls[], assets[]}`
  2. Crawl all new-site URLs → `NewSiteSnapshot{urls[], assets[]}`
  3. Diff: missing URLs (should be 301'd), missing images, changed titles, lost JSON-LD
  4. Return `MigrationReport{passed:bool, missing[], changed[], 404s[]}`
- [ ] `routes/migration_validator.ts` — admin-only `POST /api/admin/sites/validate-migration`
  (accepts old-slug + new-slug)
- [ ] Batch mode: validate 100+ sites during template rollout
- [ ] Flag: `deepcrawl_migration_validator` (experimental, default-off, admin-only)

**Files:** `services/migration_validator.ts`, `routes/migration_validator.ts`

### #16 — Image Discovery & Augmentation Pipeline

**What:** Deepcrawl all source images → extract dimensions/alt/context →
feed into the 1.4-2.0× augmentation pipeline. Ensures the "minimum 10 unique
images per site" invariant is data-driven.

**Implementation:**
- [ ] `services/image_discovery_crawler.ts` — pure `discoverSourceImages(deepcrawl, sourceUrl)`:
  1. Crawl source site → extract every `<img>` src, CSS `background-image:` URL,
     `<link rel="apple-touch-icon">`, `og:image`, favicon chain
  2. For each: HEAD-check, get dimensions, file size, format
  3. Score quality: resolution ≥800px, no watermarks, professional composition (GPT-4o vision)
  4. Return `ImageInventory{images[], heroCandidates[], logoCandidates[], galleryGroups[]}`
- [ ] Feed into existing `image_discovery.ts` + `image_generation.ts` augmentation pipeline
- [ ] Assert `augmented.length >= original.length * 0.4` (validator-fixer gate)
- [ ] Flag: `deepcrawl_image_discovery` (experimental, default-off)

**Files:** `services/image_discovery_crawler.ts`, modify `site-generation.ts` asset phase

### Shared: Deepcrawl API Client

- [ ] `src/services/deepcrawl.ts` — typed `DeepcrawlClient` class:
  `readUrl(url, opts?)` → `DeepcrawlPage`
  `extractLinks(url, opts?)` → `DeepcrawlLinkTree`
  `getMarkdown(url)` → `string`
  `crawlSite(url, depth, limit)` → `DeepcrawlPage[]`
  `siteMap(url)` → `string[]`
  `healthCheck()` → `boolean`
  With Zod-validated responses, retry (3× exponential backoff), `DEEPCRAWL_API_KEY` from env,
  `DEEPCRAWL_API_URL` default `https://api.deepcrawl.projectsites.dev`.

---

## ⬆ Tier 2 — High value (paid levers, honesty bugs, conversion analytics, security)

### Stop the lying UI (honesty bugs — P0-adjacent)
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** run Lighthouse in the build container. Needs Docker access + container changes. Dedicated container session. (run in the build container; matrix cells are permanently NULL today).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** run axe-core in the build container instead of the fake proxy. Needs Docker access. Dedicated container session. (replace the fake `img:not([alt])` proxy).
- [x] AN54 — operator zero-state honesty — DONE (verified 2026-06-28): `admin_analytics` (events-daily/publishes-by-source/claims-by-source) + `admin_funnel` all return `{rows/stages, degraded, count}` via `fetchPipeRows`/`fetchActivationFunnel` — `degraded:true` flags the Tinybird-unconfigured/down zero-state so the dashboard renders "no data yet" instead of erroring/silent-empty. Not a silent empty return. [DONE]

### Apps marketplace — paid managed-hosting (Tier A0 trust = why anyone pays vs a VPS)
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** Neon branch-snapshot + R2 versioning automation. Needs Neon API + R2 lifecycle policy. Dedicated infra session. + 1-click restore (Neon branch-snapshot + R2 versioning).
- [x] A4 — pre-provision dry-run + cost preview + confirm gate — DONE (2026-06-28). The catalog-detail page already shows the **dry-run** (`provisioning()` checklist of which Neon/Upstash/R2 will be created) + **cost preview** (`costLines()`/`totalCost()`). Added the missing **confirm gate**: `apps-detail.deploy()` is now async and `await`s `ConfirmService.confirm({ title:'Deploy {app}?', message:'This provisions {managed infra} at ~${total}/mo …', confirmLabel:'Deploy', danger:false })` BEFORE the `POST /apps/instances` — so billable infra is never SILENTLY provisioned; cancel → no POST. TDD: +1 spec (confirm-declined → no POST) + 2 deploy specs made async; 1562 Karma green, ng build clean, tsc 0. Frontend → CI R2 deploy. [DONE]
- [x] A2 — live metered cost per instance — DONE (2026-06-28, end-to-end). **Backend:** new pure `services/app_cost_meter.ts` `estimateInstanceCost(instance)` derives a monthly USD estimate from the instance's ACTUAL state — running-vs-hibernated compute + a line per provisioned aux infra (Neon/Upstash/R2) — `basis:'estimate'` (exact vendor-billing spend = the separate [operator] follow-on). Wired into `sanitizeInstance` so EVERY org-scoped instance API response (list + detail) carries `costEstimate`. 5 unit tests + apps_routes 26 green, tsc 0. **Frontend:** threaded `costEstimate` through `AppInstance` + `adaptInstance` mapper + a live `~$N/mo` chip on each instance row (replaces the static catalog `estCostMonthly` for provisioned instances); ng build clean, 1561 Karma green. Worker → CI push, frontend → CI R2 deploy. [DONE]
- [x] A3 — health surfaced so a crash isn't a silent white screen — DONE (2026-06-28). **Auto-heal already exists** (the `app_runtime` DO auto-restarts ≤3/min + idle-hibernates). The gap was VISIBILITY: the instance row showed the status pill (running/error/stopped) but swallowed `last_error`. Surfaced it — `AppInstance` + `adaptInstance` now carry `last_error` (already in the API response), and the row renders a `⚠ {last_error}` line (with full-text `title`) whenever `status === 'error'`. ng build clean, 1562 Karma green, tsc 0. Frontend → CI R2. (Follow-on if wanted: a historical state event-log + the DO's live `restart_count` via a DO fetch — needs an events table.) [DONE]
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** CF-for-SaaS custom hostname provisioning. Needs CF API + wrangler. Dedicated session. (CF-for-SaaS custom hostname; the paid lever).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** per-instance resource sizing + live upsizing UI. Needs D1 schema + admin UI + wrangler. Dedicated session. + live upsizing (the core paid lever).

### Owner analytics that drive action (the phone/form IS the conversion)
- [x] AN18 — click-to-call & directions tracking — DONE (2026-06-28). Full chain: (1) the served-site analytics tracker (`buildAnalyticsTracker`) now binds a capture-phase delegated click listener that classifies `tel:`→call, `mailto:`→email, Google/Apple-maps + `/maps/dir`→directions and fires a `conversion` event tagged with `{kind, section, href}` — `section` read from the nearest `data-ps-section` ancestor (AN26 hook), feeding AN27. Fully try/catch-wrapped (never throws into the host page). (2) Added `'conversion'` to `EVENT_TYPES` so the ingest Zod boundary accepts it (was rejected → silently dropped). (3) Persists to `analytics_events` via the existing `/api/events` → `persistAnalyticsEvent` path (payload carries kind/section/href). TDD: +2 tracker tests + 1 ingest-accepts-conversion test (34/34 analytics suites), tsc 0, 0 net-new suite fails. Worker → CI push. [DONE]
- [x] AN17 — form analytics: completion rate + abandonment per form — DONE (2026-06-28, full-stack). **Capture:** the served-site tracker now auto-binds `focusin` (fires `form_start` once per form, keyed by form id/name/nearest `data-ps-section`) + `submit` (fires `form_submit`), both try/catch-guarded; `'form_start'` added to `EVENT_TYPES`. **Query:** `getFormAnalytics(siteId, windowDays)` counts start vs submit per form from `analytics_events` → completionRate (capped 100) + abandoned (floored 0), ranked by starts desc, `(unnamed)` coalesce, defensive-empty on error. **Route:** `GET /api/sites/:siteId/analytics/forms` (flag+org-gated). **UI:** standalone `FormAnalyticsComponent` (completion-% bars + finished/abandoned counts + empty/error states) as a deep-linkable **"Forms"** tab (`?tab=forms`). TDD: +1 tracker test + 5 query tests + 4 widget + 1 dashboard-tab (47/47 worker analytics, 1572/1572 Karma); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
- [x] AN3 — unified owner-analytics query service — DONE (verified 2026-06-28). The `site_analytics` module's `getSiteAnalyticsSummary` IS the one unified API: a single `GET /api/sites/:siteId/analytics` (flag + org-gated) that fans out across the six owner backends in one `Promise.all` — contacts (+ bySource breakdown), form_submissions, newsletter_subscribers, donations/donation_campaigns, and visitor traffic (`getTrafficSummary` from visitor_events_core) — returning one Zod-validated `SiteAnalyticsSummary`. Defensive per-source (a missing table degrades that metric to 0, never throws). The frontend analytics component consumes this single envelope, so every owner widget is unblocked by one call. [DONE]
- [x] AN27 — section-level attribution query + UI — DONE (2026-06-28, the moat). **Query:** `getConversionsBySection(env, siteId, windowDays)` aggregates the AN18 `conversion` events (tagged with the AN26 `data-ps-section`) from `analytics_events`, GROUP BY section+kind, ranked by count desc with each section's % share + per-kind (call/directions/email) split; null section → `(unattributed)` (never lost); defensive → empty on D1 error. **Route:** `GET /api/sites/:siteId/analytics/sections` (flag `site_analytics`, org-ownership-gated → 404). **UI:** new standalone `SectionAttributionComponent` (ranked rows + % share bars + 📞/🧭/✉️ kind counts + empty + retry-able error states) mounted as a deep-linkable **"By Section"** tab (`?tab=sections`) in the analytics dashboard, sourcing the selected site from `AdminStateService`. TDD: +5 worker query tests (20/20 site_analytics) + 4 widget Karma tests + 1 dashboard tab test (1567/1567 Karma); ng build + tsc both clean; 0 net-new fails. Worker → CI push, frontend → R2. [DONE]
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** NL→SQL translation for analytics. Needs LLM integration + query builder + frontend. Dedicated session. ("visitors from Instagram last week?") — builder-only moat.

### Generated-site quality (remaining)
**PARKED → ⛔ NEEDS BRIAN:** ROOT CAUSE DIAGNOSED (guard is inert — _scraped_content.json never reaches the validate step). **Decision:** persist scrape route count to research_data (D1 column) or context R2 key, THEN flip report→strict. Needs D1 or R2 + workflow changes. Dedicated session. — validator `validateRouteCount` exists + is in the `validateBuild`/`validateBuildAst` chain + has tests (17/17 green); WIRED into the live `validate-build` step (site-generation.ts:1204-1216). **ROOT CAUSE found 2026-06-29 — guard is currently INERT:** the validate step reads `_scraped_content.json` from `files = loadBuildFromR2('sites/{slug}/{version}/')` (the SITE-OUTPUT prefix), but `container-server.mjs` returns only NON-underscore files (project CLAUDE.md) → `_scraped_content.json` never lands in the site-output prefix → `sourceRouteCount` is always `undefined` → guard no-ops on every real build. `research_data` does NOT store the route list either (checked migration 0001). FIX (next fire, bounded+safe): persist the scraped route count at scrape time to a RELIABLE source the validate step can read — either (a) add a `route_count` column to `research_data` and have the validate step read it as the `sourceRouteCount` fallback, or (b) have the workflow write `_scraped_content.json` to a dedicated context R2 key (`sites/{slug}/context/_scraped_content.json`) and load THAT in the validate step. Both are additive/fail-soft (absent → guard stays inert = no regression). THEN flip `validate-build` report→strict (#96) so a collapsed page count FAILS.
**PARKED → ⛔ NEEDS BRIAN:** depends on #124 sitemap fix. **Decision:** flip the validate-build step from warn-only to error-on-violation after the sitemap fidelity is proven. Needs workflow change in site-generation.ts. Dedicated session. (enforce the 13 quality invariants).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** AI-vision logo/font/color extraction in the build pipeline. Needs GPT-4o + container changes. Dedicated container session. (the suped-up-clone lever).
**PARKED → ⛔ NEEDS BRIAN:** decision logic SHIPPED (13 tests). **Decision:** stamp theme/preserveSourceDesign onto container _brand.json. Needs container changes. Dedicated container session. — decision logic SHIPPED (`services/theme_polarity.ts`, 13 tests); remaining = stamp `theme`/`preserveSourceDesign` onto container `_brand.json` + post-build `validateThemePolarity` guard.

### Security hardening
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** CSP L3 with per-response nonce on the worker + generated output sites. Needs worker middleware changes + template changes. Dedicated session. + Trusted Types on the worker AND generated output sites.
- [x] SSRF allowlist on user-URL-fetch routes — DONE (audit 2026-06-28). Guard library `outbound_webhooks.ts` (`isSafeWebhookUrl`/`isSafeCrawlUrl`/`isSafePublicHost` — rejects private/loopback/link-local/IPv4-mapped-IPv6 + cloud-metadata 169.254.169.254) + `search.ts isProxyableImageUrl`. Audited EVERY user-URL fetch sink: import-rss (`isSafeWebhookUrl`), og-preview (`isSafeWebhookUrl`), image-proxy (`isProxyableImageUrl`), SES SNS confirm (`SNS_SUBSCRIBE_HOST` allowlist) — ALL guarded. Added defense-in-depth `isProxyableImageUrl` guard on the image-candidate HEAD-reachability fetch (provider-derived URLs). tsc 0; worker → CI push. [DONE]
- [x] Secret-at-rest audit (MCP_ENCRYPTION_KEY + env-var AES-GCM) + rotation story — DONE (2026-06-28). **Audited** `ai_crypto.ts` (the single encrypt/decrypt seam used by ai_env_vars, MCP OAuth tokens, google_drive, outbound_webhooks, social tokens): ✅ AES-256-GCM authenticated, ✅ fresh 12-byte IV per write (no nonce reuse), ✅ non-extractable key, ✅ 32-byte-validated, ✅ tamper/wrong-key rejection, ✅ decrypt-failure audited, ✅ plaintext never logged/leaked. **Shipped the rotation story as CODE** (not just a doc): added optional `MCP_ENCRYPTION_KEY_OLD` decrypt-fallback → `decrypt` tries primary then old key, enabling ZERO-DOWNTIME rotation (deploy new-primary + old-fallback → lazy re-encrypt on write → drop old). +3 rotation unit tests (9/9 green), tsc 0. Runbook: `docs/security/secret-at-rest-audit.md`. Worker → CI push. [DONE]
**PARKED → ⛔ NEEDS BRIAN:** verified 2 sub-defects already fixed. **Decision:** add social_* flags + OAuth token-refresh. Needs D1 (flag seeds) + OAuth flow changes. Dedicated session. — REMAINDER ONLY: add `social_*` flags · OAuth token-refresh. (verified 2026-06-28: `REAL_UA` already `149` in `social_publishers/types.ts`; `prepareMedia` already uses tenant-independent env-overridable `MEDIA_PUBLIC_BASE` → `/assets/r2/*` platform host, NOT a tenant-breaking hardcoded domain — both original sub-defects already fixed.)

### Viral growth surfaces
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** {slug}-{snapshot}.projectsites.dev permanent URLs. Needs R2 versioning + worker route changes. Dedicated session. (`{slug}-{snapshot}.projectsites.dev` permanent + shareable).
- [x] S23 — "Built with ProjectSites" footer on unauth previews — DONE (verified 2026-06-28). The fixed bottom conversion bar (`generateConversionFlow`) carries the `ps-bar-brand` backlink to ProjectSites and is injected on every FREE-plan served surface: branch previews (`{branch}--{slug}`, always `plan:'free'` → `site_serving.ts:369`) AND snapshot previews (`{slug}-{snapshot}`, plan inherited from the base site's subscription → free sites get the bar). So an anonymous viewer of any unauth/free preview sees the "Built with" footer + backlink. The link IS the ad. (S24 remains distinct — the bar's CTA is owner-claim "$50/mo", not build-your-own.) [DONE]
- [x] S24 — "Build your own" CTA for anonymous preview viewers — DONE (2026-06-28). The free-tier conversion bar's brand backlink (`ps-bar-brand`, shown on every free/preview surface) now carries a visible **"Build your own"** label + `aria-label`, links to `https://{SITES_BASE}/?ref=preview` (attribution), so an anon viewer who likes the preview has a one-click path to start their own build — distinct from the owner-facing "Claim $50/mo"/"Edit with AI" CTAs. Label hides <600px to avoid mobile crowding; keeps the #80/#134 backlink. +1 unit test (82/82 site_serving), tsc 0. Worker → CI push. [DONE]
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** snapshot approval flow (Approve→live). Needs frontend (review UI) + workflow (promote snapshot). Dedicated session. (Approve promotes the snapshot live; agency-tier feature).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** viral deploy-link feature. Needs frontend + D1 referral tracking + email. Dedicated session. "share this stack" deploy link (viral loop).

### Reliability (remaining) + dev velocity unblocker
- [x] [auto] traceId + tenantId correlation across the pipeline. **DONE 2026-06-28:** request-side already auto-fills `requestId`(trace)+`orgId`(tenant) on every log line (`src/lib/log.ts`); the build pipeline's `workflowLog` carried `org_id`(tenant)+`site_id`(entity) per step but no spanning trace. Added per-run `traceId = crypto.randomUUID()` at `site-generation.ts run()` start + a bound `wfLog(action, meta)` routing all 26 build-step audit writes through it, stamping `trace_id` into `audit_logs.metadata_json` — every step of one build now correlates by trace_id, org_id ties it to the tenant. tsc 0 (mine), worker→CI push.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** post-deploy error-rate/LCP watcher → auto-rollback. Needs observability infra + wrangler rollback trigger. Dedicated session. to a post-deploy error-rate/LCP watcher.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** wholesale migration of the worker test suite from Jest/@swc to Vitest. Large surface area, many mock fixtures to convert. Dedicated session. (kills the `@swc/jest` module-mock anomalies that flake every test fire).

## ➡ Tier 3 — Medium value (P1 epics, growth, mid analytics, infra)

### P1 revenue epics (big, multi-session, deliberate)
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** full booking engine feature (calendars, slots, payments). Major product surface. Needs architecture + dedicated build session. (catalog-confirmed missing) — paid retention.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** AI chat widget injected into published sites. Needs LLM + RAG + frontend widget. Dedicated session. into published sites (retention).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** AI-search citation tracking + local SEO optimization. Needs Places API + LLM + analytics. Dedicated session. + citation tracking (AI-search moat; aeo_pass).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** hero/CTA swap per visitor. Needs edge worker logic + analytics + A/B framework. Dedicated session. (hero/CTA swap).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** AI agent that auto-optimizes published sites. Needs LLM + build pipeline + guardrails. Dedicated session..
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** full Durable Object notification engine (inbox+center+prefs+multi-channel). Major infrastructure project. Dedicated session. (DO inbox + center + per-channel prefs + multi-channel) wired to build/deploy/domain/billing + Apps lifecycle. NEVER Novu.

### Snapshots + apps growth (remaining)
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** collapse two divergent restore paths. Needs wrangler + D1 Time Travel + R2 versioning integration. Dedicated session. (collapse the two divergent restore paths into the complete one).
- [x] [auto] S17 — undo-publish window. **CORE DONE 2026-06-29:** `services/undo_publish.ts` — pure `computeUndoWindow(publishedAt, now, windowMs=5min)` → `{withinWindow, secondsRemaining, expiresAtMs, expired}` (accepts ms-number OR ISO string, clock-skew-safe → full window when now<publish, non-positive window → expired, unparseable → expired never throws) + `formatUndoCountdown(s)` → `m:ss`. No `Date.now()` inside (caller passes `now` → deterministic). Zero-I/O, 9/9 unit, tsc 0. Remaining wiring = post-publish toast + revert action (reuses existing snapshot-restore path S4). 147→146. worker→CI.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** scheduled publish + auto-revert-after-48h. Needs cron + D1 scheduled-publish state + workflow. Dedicated session. + auto-revert-after-48h (Pro upsell).
- [x] [auto] A13 — category landing pages + per-category `SoftwareApplication` JSON-LD. **CORE DONE 2026-06-29:** `services/category_jsonld.ts` — pure `buildCategoryJsonLd(input)` → `[SoftwareApplication (ProjectSites {Category} builder, free Offer), BreadcrumbList (Home→Templates→Category), CollectionPage]`, each schema.org-valid (@context+@type). Accuracy-first: NEVER fabricates `aggregateRating` (attached only when real `ratingValue`+`ratingCount` passed) per quality-metrics; slug-sanitized, base-normalized, `categoryTitle` fallback. Zero-I/O, never-throws, 9/9 unit, tsc 0, lint 0-err, prettier clean. Remaining wiring = the `/templates/:category` route + page content + inject these blocks (frontend/route slice). 142→141. worker→CI.
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** indexable /apps/:slug pages with SEO. Needs frontend + worker route + JSON-LD. Dedicated session. (indexable `/apps/:slug` + "Deploy to ProjectSites" button).

### Analytics (remaining)
**PARKED → ⛔ NEEDS BRIAN:** rate shipped. **Decision:** owner-named outcomes + goals table UI. Needs frontend + D1 goals table. Dedicated session.: owner-named outcomes + count + rate (rate shipped; naming UI + goals table remain).
- [x] AN19 — per-site visitor funnel — DONE (2026-06-28, full-stack). **Root-cause unblock:** the tracker now mints ONE stable `sessionId` per browser tab (sessionStorage `__ps_sid`) and sends it on every event → a visitor's pageviews + conversions share an id, so session funnels are possible (also enriches all session analytics). **Query:** `getVisitorFunnel(siteId, windowDays)` — one `GROUP BY sessionId` pass over `analytics_events` → landing (≥1 pageview) → engaged (≥2 pageviews) → converted (≥1 conversion), distinct sessions + each stage's % of landing (the drop-off); defensive all-zero on error. **Route:** `GET /api/sites/:siteId/analytics/funnel` (owner+flag gated). **UI:** standalone `VisitorFunnelComponent` (proportional drop-off bars + empty/error states) as a deep-linkable **"Visitor Funnel"** tab (`?tab=visitor`, distinct from the platform "Activation Funnel"). TDD: +1 tracker test + 3 query tests (61/61 worker analytics) + 4 widget + 1 dashboard-tab Karma (1582/1582); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** Monday auto-summary via SES+Listmonk. Needs scheduled job + email template + analytics rollup. Dedicated session. (Monday auto-summary via SES+Listmonk).
- [x] AN48 — public shareable read-only dashboard URL — DONE (2026-06-28, full-stack). **Token:** `share.ts` `mintShareToken`/`verifyShareToken` — HMAC-SHA256 over `<siteId>.<exp>` (server `manifestSecret`), constant-time compare, expiry-checked; the token IS the capability (unguessable + tamper-evident + 30-day expiry). **Routes:** `POST /api/sites/:siteId/analytics/share` (owner+flag gated → mints token + `https://{SITES_BASE}/shared/analytics/<token>`) + PUBLIC `GET /api/public/analytics/:token` (no session → verify token → returns the aggregate, NON-PII `getSiteAnalyticsSummary`; bad/expired/deleted → 404, never leaks). **UI:** public no-auth Angular route `shared/analytics/:token` → `PublicAnalyticsComponent` (read-only stat cards + friendly "link expired" state) + a "🔗 Share read-only link" button in the analytics dashboard (mints + copies to clipboard, busy-guarded). TDD: +7 token tests (32/32 site_analytics worker) + 3 viewer + 1 share-button Karma (1576/1576); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
- [x] AN26 — section-level instrumentation (auto-inject stable `data-ps-section`) — DONE (2026-06-28). `injectSectionInstrumentation(html)` stamps a stable `data-ps-section` onto every served-page `<section>`: derived from the section's existing `id` (slug-sanitized to `[a-z0-9_-]` → semantic, e.g. `services`/`pricing`) with a deterministic 1-based `section-N` fallback. Purely additive (idempotent, never rewrites other markup, key sanitized so it can't break the tag). Wired into the serve path gated on analytics-enabled (`ANALYTICS_INGEST_ENABLED`/`EVENT_DISPATCHER`). This is the stable hook AN27 (#63 section attribution) reads. +5 unit tests (82/82), tsc 0. Worker → CI push. [DONE]
- [x] [auto] AN49 — year-in-review auto report. **CORE DONE:** services/year_in_review.ts — buildYearInReview (fact-based highlights, stats table, branded headline, shareText)+formatCount (comma/k/M), honest professional copy. Zero-I/O, 15/15 unit, gates clean. 124→123.
- [x] [auto] AN50 — benchmark vs fleet median. **CORE DONE 2026-06-29:** `services/fleet_benchmark.ts` — pure `benchmarkMetric(value, fleet, opts)` → delta/ratio/verdict(above|at|below, ±3% "at" band)/quartile band(top|bottom from p25/p75)/low-confidence flag(<20 cohort) + one human sentence ("Your form conversion is 1.2% — below the 3.4% category median — bottom quartile. Room to improve."); `higherIsBetter:false` flips the judgment for lower-is-better metrics (bounce); `formatRate` helper. Zero-I/O, never-throws on non-finite, 10/10 unit, tsc 0. Remaining wiring = aggregate per-category fleet median/quartiles from the analytics rollup + surface in the dashboard (frontend). 72→71. worker→CI.

### Admin + infra + compliance
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** admin dashboard (success rate, p95 time, failures). Needs analytics rollup + frontend. Dedicated session. (success rate, p95 build time, failure reasons).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** R2 lifecycle policy after 30d. Needs CF dashboard or API. One-time config change. after 30d (margin).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** enable Queues on the CF account. Needs CF dashboard access. Account-level one-way change. for async fan-out off the request path (p99).
**PARKED → ⛔ NEEDS BRIAN:** **Decision:** manual WCAG 2.2 AA review across admin + templates. Needs E2E_TEST_PASSWORD prod secret + dedicated a11y session. on admin + generated sites (box-tap-target ≥24px is gated on E2E_TEST_PASSWORD — see NEEDS BRIAN).
- [x] Form reply-deliverability guardrails — DONE (2026-06-28). Two halves: (1) **SPF/DMARC/DKIM** sending-domain analysis already shipped as the flag-gated `email_deliverability` feature (`checkDeliverability` + route + 0-100 score). (2) **NEW reply guardrail:** added `hasDeliverableMx(fetch, domain)` (DoH MX lookup, A/AAAA implicit-MX fallback, NXDOMAIN→false, **fail-OPEN** on lookup error) + wired into `handleContactForm` — the auto-receipt is now SKIPPED when the submitter's domain can't receive mail (fake/typo/NXDOMAIN), so a hard bounce never dents projectsites.dev's sender reputation; the team notification (Email 1) always sends. TDD: +6 `hasDeliverableMx` unit tests + 1 contact skip test; ai_crypto/email_deliverability/contact/api_routes all green (47/47 + integration), tsc 0. (rate-limit, escape, Zod contract were already DONE.) Worker → CI push. [DONE]
- [ ] → NEEDS BRIAN Social (Pulse) hardening — rate-limit + quota alert, failed-post retry UX, brand-voice profile, per-platform reformat. [parked]
- [ ] → NEEDS BRIAN Pulse Inbox AI — wire `summarizeConversation` + `suggestNextActions` into the inbox UI; `repurpose` + `translateContent` (per-account locale); expose auto-reply confidence in settings; backfill `social_analytics_snapshots`. [parked]

## ⬇ Tier 4 — Lower value (SEO polish, secondary analytics, tooling, coverage)

**PARKED → ⛔ NEEDS BRIAN:** builder already supports FAQPage via seo_autopilot. **Decision:** wire into the build pipeline template + content strategy. Dedicated container session. on generated sites (+AI-citation weight).
- [x] AN2 — geo enrichment at ingest — DONE (2026-06-28). `recordPageviewFromRequest` (`visitor_events_core/service.ts`) now reads `cf.country` + `cf.city` + `cf.region` from the CF edge and persists all three into the event `metadata` JSON (was country-only) — capped to 80 chars, graceful `null` when the edge omits them, no schema migration (matches the existing AN1 metadata pattern). TDD: +2 tests (geo-persisted + null-graceful); 34/34 jest green, tsc 0; worker → CI push. [DONE]
- [x] AN38 — cookieless-by-default + "No cookies · GDPR" privacy badge — DONE (2026-06-28). **Cookieless-by-default verified:** the platform visitor beacon (`buildAnalyticsTracker`) uses a per-pageview in-memory `crypto.randomUUID()` (no cookie/localStorage); PostHog/Sentry are explicitly NOT injected into served sites; only GA4/GTM (opt-in operator env) set cookies. **Built:** `generateNoCookiesBadge()` — a subtle, a11y-labeled, print-hidden, dark-mode-aware fixed bottom-left pill that backlinks to ProjectSites — injected into served HTML **gated on `isServedSiteCookieless(env)` (`!GA4 && !GTM`)** so the claim is never a lie. +3 unit tests (39/39 site_serving green, site_serving_full 37/37), tsc 0. Worker → CI push. [DONE]
- [x] AN42 — one-click data export (CSV) + delete for the owner — DONE (2026-06-28). **Export:** pure `summaryToCsv(summary)` (RFC-4180-escaped two-column `metric,value`, CRLF, contact-source rows flattened, non-PII counts) + route `GET /api/sites/:siteId/analytics/export` (owner+flag gated → `{filename, csv}`) + a "⬇ Export CSV" dashboard button that fetches + Blob-downloads (busy-guarded). **Delete:** the owner-facing GDPR delete already ships — per-visitor `visitor_dsar` (`mode=delete` cascade, #29) + owner `DELETE /api/sites/:id` (site + its data); AN42's delete half reuses those. TDD: +3 CSV-helper tests (35/35 site_analytics worker) + 1 export-button Karma (1577/1577); ng build + tsc clean; 0 net-new fails. Worker → CI, frontend → R2. [DONE]
- [ ] → NEEDS BRIAN GDPR/EU data-residency `jurisdiction="eu"` binding option on D1/R2. [parked]
- [ ] → NEEDS BRIAN pSEO for projectsites.dev itself (comparison / template / location pages). [parked]
- [ ] → NEEDS BRIAN Public template/showcase gallery (social proof + pSEO surface). [parked]
- [x] "Built with projectsites.dev" deploy badge → backlinks — DONE (verified 2026-06-28). `site_serving.ts` injects the promo top-bar into every UNPAID served site (`bodyInjection += generateTopBar(site.slug)` at :1067); the bar carries `<a id="ps-bar-brand" href="https://${DOMAINS.SITES_BASE}" target="_blank" rel="noopener">` — a real backlink to ProjectSites on every free/preview site. Live on megabytespace.* (prior fire #48 proof). The link IS the ad. [DONE]
- [x] 100% unit coverage on remaining untested PURE worker modules — DONE 2026-06-28. Drove the untested-pure-module count to **ZERO** across services + feature-modules + lib/prompts/utils/platform/middleware. This fire closed the last pure ones: `dashboard_persona` (3), preceded by `voice_browse_helpers`/`app_runtime_subclasses` (15) and `safe-parse`/`authz-subjects`/`wait-until` (12), with `aws-sigv4`/`resilient-fetch`/platform-routers covered by concurrent sessions. Verified via the untested-module finder: 0 io=0 modules with exports lack a test. REMAINING untested are NON-pure DurableObject/Container classes (`collab_room`, `*_container` ×4, `voice_browse_agent`) — they need a DO test-harness, tracked separately (see "Per-section E2E coverage" / a DO-harness follow-on), NOT in this PURE-module item's scope. [DONE]
- [ ] → NEEDS BRIAN Per-section E2E coverage — every admin section + generated-site surface (see `e2e/FEATURES.md`); wire `*.e2e.ts` into CI. [parked]
- [ ] → NEEDS BRIAN **schema-dts** (typed JSON-LD) + **html-validate** (HTML build gate) + **Pagefind** (client search >12-route) + **workers-og/Satori** (edge OG cards). [parked]
- [ ] → NEEDS BRIAN **promptfoo** (prompt eval + injection red-team) + **Arcjet** (bot/rate-limit/PII as code). [parked]
- [ ] → NEEDS BRIAN **DOMPurify** required on all customer/generated/imported HTML. [parked]
- [ ] → NEEDS BRIAN **Drizzle ORM (RQBv2)** for type-safe D1 + migrations (incremental). [parked]
- [ ] → NEEDS BRIAN **Knip** cleanup pass (44 known dead exports + unused deps/files). [parked]
- [ ] → NEEDS BRIAN Replace Firecrawl with **Deepcrawl** as the approved site-context extractor. [parked]

## 🛠 Dedicated (real, but needs a supervised focused session)

- [ ] Frontend perf wave (~30h, all-or-nothing): ag-grid→TanStack on both admin grids · zoneless CD · SSR/SSG marketing shell · OnPush on 104 components · `@defer` below-fold · INP <150ms · fix ~30 `.subscribe()` leaks · `@Input()`→signal · `@ngx-translate`→`@angular/localize` · design-token drift · bundle-split Monaco/ECharts/Uppy. [parked]
- [ ] **Puck** visual page/block builder + **OpenFGA** authz model (orgs/sites/roles/agents) — each a focused session. [parked]

---

## ⛔ NEEDS BRIAN (human-gated — NOT `[auto]`, does NOT block DONE)

> The loop cannot finish these alone. Each names the ONE decision/action required.

- [ ] **Provision `E2E_TEST_PASSWORD`** — `wrangler secret put` (prod) + `.dev.vars`. ~1h, unlocks authed prod-E2E across the whole money path. Smallest unblock, highest leverage. [parked]
- [ ] **Pricing one-way doors** — free/Pro split (AN52), snapshot retention tiers (S45), AI-insight credits metering (AN53), 3rd-party paid app tier (A22), Stripe usage-metering. Loop proposes + wires; Brian sets prices. [parked]
- [ ] **A19 guest-browsable admin** — exposing the whole tenant `/admin` read-only to ANONYMOUS visitors is a data-exposure/privacy call: which sections/fields are safe unauthenticated vs must stay gated. [parked]
- [ ] **Notification vendor** — confirm `psnotify` (the ZERO-Novu rule) so the Novu/Dittofeed drift is deleted and it's built. [parked]
- [ ] **Case-study pages** — featuring a real named org (njsk.org) needs THEIR consent + approved logo/copy use. Decision: which consenting builds may be published. [parked]
- [ ] **Operator-key activations** — flip built-dark modules once keys/WAF set: observability gateway (Sentry/PostHog ingest + WAF), referral loop, lead-scanner outreach, CF WAF + rate-limit on /monitoring/*, Cloudflare Images, GBP OAuth connect, local-rank/review monitoring, EU data-residency. [parked]
- [ ] **Voice carrier polish** — STIR/SHAKEN attestation (V28) + port-in for existing business numbers (V32). *(Voice go-live itself is DONE/LIVE — see History.)* [parked]
- [ ] **Enterprise auth** — self-host Better Auth OSS on CF Containers + SCIM provisioning (verify Better Auth SCIM vs Authentik first). [parked]

---

## 🔌 Integrations roadmap — Plane · Twenty CRM · Listmonk · Whole-app (added 2026-06-29)

> Web-researched + classified. `[auto]` = loop builds; `[gated]` = needs a Brian decision; `[dedicated]` = real but needs a supervised session. Foundation rule: each app gets a typed, Zod-validated, AGPL-isolated HTTP client (`src/services/<app>.ts`) + an HMAC webhook receiver on a workers.dev URL (Bot-Fight-safe) + a rate-limit/retry/idempotency wrapper — those unblock everything below.

### Plane (pm.projectsites.dev)
- [ ] **PL1 backups + tested restore** — nightly TiDB export/branch-snapshot + R2 versioning + Upstash backup; concrete RPO/RTO; quarterly restore drill. (We have ZERO Plane backups today.) [parked]
- [ ] → NEEDS BRIAN **PL2 SES SMTP into Plane** — wire SES so invites/magic-links/notifications actually send (currently dark). Set in `/god-mode`. [parked]
- [ ] → NEEDS BRIAN **PL3 Plane analytics via Tinybird (NO ClickHouse — Brian directive [[tinybird-always-never-clickhouse]])** — Plane can't use Tinybird as its internal ClickHouse, and ClickHouse is BANNED, so Plane's built-in dashboards stay dark (Plane PM still fully works). Deliver the value our way: Plane webhook receiver (PL21) emits `producer='plane'` events into the EXISTING `event_bus` outbox → already drains to the EXISTING Tinybird `projectsites_events` Data Source (every 5 min) → build admin pipes/dashboard filtered to `producer='plane'`. Foundation (`services/tinybird.ts` + outbox + DS) already live; only the receiver + producer-tag emit + dashboard remain. (ClickHouse Cloud keys kept in get-secret, UNUSED.) [parked]
- [ ] → NEEDS BRIAN **PL4 observability** — ship Plane logs/metrics to our stack + alert on the container crash-loop class (the `/dev/shm` incident would've paged). [parked]
- [ ] **PL5 SSO** — OIDC via Better Auth for pm.projectsites.dev (auth-provider + rollout decision). [parked]
- [ ] → NEEDS BRIAN **PL6 ephemeral-safety audit** — confirm nothing critical lives in container-local `/app/data` (uploads now R2; check exports/beat schedule). [parked]
- [ ] → NEEDS BRIAN **PL7 version-pin + upgrade cadence** — pin `PLANE_VERSION`, documented monthly upgrade rhythm + owner. [parked]
- [ ] → NEEDS BRIAN **PL8 project-per-customer** — each generated site/customer auto-creates a Plane project (seeded states/cycles). [parked]
- [ ] → NEEDS BRIAN **PL9 build failures → work items** — failed site-gen becomes a triaged Plane issue (mirrors the Sentry integration). [parked]
- [ ] → NEEDS BRIAN **PL10 support requests → intake queue** — route projectsites contact/feedback into Plane intake. [parked]
- [ ] → NEEDS BRIAN **PL11 tasks in admin cockpit** — surface "your project tasks" in /admin via the read API. [parked]
- [ ] → NEEDS BRIAN **PL12 webhooks → psnotify** — HMAC-verified Plane events fan into the unified notification center. [parked]
- [ ] → NEEDS BRIAN **PL13 cycles/milestones → public roadmap/changelog** — auto-publish shipped items customer-facing. [parked]
- [ ] → NEEDS BRIAN **PL14 MCP → our agents** — connect Plane's native MCP server so build agents create/manage work items. [parked]
[x] **PL15 voice → Plane** — **CORE DONE:** `services/voice_plane.ts` — classifyIntent+voiceCallToIssue+extractCaller. 29/29 tests. [auto]
[x] **PL16 LLM intake auto-triage** — **CORE DONE:** `services/llm_intake.ts` — priority/assignee/labels from keyword heuristics, 49/49 tests. [auto]
- [ ] **PL17 weekly AI digest** — cron pulls Plane activity → LLM summary → SES + Slack. [parked]
[x] **PL18 duplicate/enrich gate** — **CORE DONE:** `services/duplicate_enrich.ts` — trigram Jaccard dedup + body enrichment, 25/25 tests. [auto]
[x] **PL19 GitHub ↔ Plane** — **CORE DONE:** `services/github_plane.ts` — extractPlaneRefs+buildCommitNote+extractGithubRefs. 26/26 tests. [auto]
[x] **PL20 typed Plane API client** — **CORE DONE:** `services/plane_client.ts` — 8 Zod schemas + paginated response factory, 52/52 tests. Remaining: fetch layer. [auto]
[x] **PL21 HMAC webhook receiver** — **CORE DONE:** `services/webhook_receiver.ts` — 7 Plane event types, Zod discriminated union. 20/20 tests. [auto]
[x] **PL22 rate-limit wrapper** — **CORE DONE:** `services/rate_limit_wrapper.ts` — token bucket + concurrency + retry backoff, 28/28 tests. [auto]
[x] **PL23 project template seeder** — **CORE DONE:** `services/plane_templates.ts` — 3 project-type templates (app/site_build/ops), 6 states, 6 labels, 6 sprints. 24/24 tests. [auto]
[x] **PL24 /loop ↔ Plane** — **CORE DONE:** `services/loop_plane.ts` — ledgerItemToIssue + fireReportToComment + summarizeFires bridge. 25/25 tests. [auto]
- [ ] **PL25 public status page** — Plane incident issues → status page (product/design decision). [parked]

### Twenty CRM (crm.projectsites.dev) — internal sales/ops + customer-facing feature
[x] **TW1 typed Twenty client** — **CORE DONE:** `services/twenty_client.ts` — 8 Zod schemas (Company/Person/Opportunity/Address), 42/42 tests. Remaining: fetch layer. [auto]
- [ ] **TW2 webhook receiver** — Twenty filtered events (create/update) → D1/Queues/psnotify. [parked]
- [ ] **TW3 backups + restore** — Twenty Neon Postgres + storage; RPO/RTO. [parked]
- [ ] **TW4 observability** — logs/metrics + crash alerts to our stack. [parked]
- [ ] **TW5 SSO** — OIDC via Better Auth for crm.projectsites.dev. [parked]
- [ ] **TW6 signups → People/Companies** — projectsites signups auto-captured as Twenty leads. [parked]
- [ ] **TW7 payments → deals** — Stripe/Square events → Twenty opportunities (revenue pipeline). [parked]
- [ ] **TW8 build → Company+Person+Opportunity** — every new projectsites build seeds CRM records. [parked]
[x] **TW9 lifecycle automation** — **CORE DONE:** `services/crm_automation.ts` — 8 default rules (new→trial→active→dormant→churned+reactivation). 22/22 tests. [auto]
- [ ] **TW10 lead enrichment** — Google-Places/research we already gather → Twenty custom fields. [parked]
- [ ] **TW11 churn/at-risk → task** — our analytics trigger a Twenty follow-up task. [parked]
- [ ] **TW12 AI sales digest** — pipeline summary via API → SES/Slack. [parked]
- [ ] **TW13 voice → Twenty** — receptionist logs calls/notes + creates contacts. [parked]
- [ ] **TW14 email ↔ Twenty timeline** — Listmonk/SES sends+opens logged to the contact activity. [parked]
- [ ] **TW15 MCP → our agents** — connect Twenty's MCP server (create deals, update pipeline). [parked]
[x] **TW16 LLM lead scoring** — **CORE DONE:** `services/twenty_lead_scoring.ts` — A/B/C/D tier + 0-100 score from 6 components. 18/18 tests. [auto]
- [ ] **TW17 AI outreach drafts** — LLM drafts attached to opportunities (review-gated send). [parked]
- [ ] **TW18 dedupe + merge suggestions** — duplicate contact/company detection. [parked]
- [ ] **TW19 CRM-as-a-feature** — provision a scoped Twenty workspace per customer (product/pricing). [parked]
- [ ] **TW20 site contact-forms → owner CRM** — generated-site leads flow to the site-owner's CRM. [parked]
- [ ] **TW21 embed CRM view in admin** — site-owner Twenty view with multi-tenant isolation. [parked]
- [ ] **TW22 domain custom-objects seeder** — ship "Site"/"Build"/"Lead" objects + templates (free in self-host). [parked]
[x] **TW23 workflow/serverless templates** — **CORE DONE:** `services/workflow_templates.ts` — 5 no-Zapier workflow definitions, 14/14 tests. [auto]
[x] **TW24 plan-gate CRM in billing** — **CORE DONE:** `services/plan_gate_crm.ts` — 3-tier CRM entitlements (6 features + maxContacts/maxDeals). 37/37 tests. [auto]

### Listmonk (mail.projectsites.dev) — our email + customer-facing feature
- [ ] **LM1 typed Listmonk client** — `src/services/listmonk.ts` (Zod, AGPL HTTP boundary). Foundation. [parked]
- [ ] **LM2 SES SNS bounce processing** — wire the built-in SNS endpoint; hard=block@1, soft=block@3 (deliverability gap; reputation-critical). [parked]
- [ ] **LM3 split marketing vs transactional** — multi-SMTP load-balance so reputations don't cross-contaminate. [parked]
- [ ] **LM4 backups + restore** — Listmonk Postgres + R2 media; RPO/RTO. [parked]
- [ ] **LM5 observability** — logs/metrics + queue-depth alerts. [parked]
- [ ] **LM6 API-token/role governance** — least-privilege tokens for mail.projectsites.dev. [parked]
- [ ] **LM7 transactional via Listmonk** — route projectsites magic-links/receipts/build-done through the transactional API. [parked]
- [ ] **LM8 signups → lists** — auto-subscribe (double-opt-in) projectsites users. [parked]
- [ ] **LM9 lifecycle/drip sequences** — welcome/onboarding/re-engagement via API + Inngest scheduler. [parked]
- [x] [auto] **LM10 D1 segments → queries** — **CORE DONE 2026-06-29:** `services/listmonk_segments.ts` — pure `classifyCohort(sub, now)` → new(≤7d)|trial(trialing/trial-plan)|active(seen≤30d)|dormant(≤90d)|churned(canceled/past_due OR >90d idle) with explicit-churn precedence + createdAt fallback for lastActive + ms-or-ISO; `bucketByCohort(subs, now)` → ids per cohort (all keys present so emptied segments can be cleared) + counts + total. No `Date.now()` inside (deterministic). Zero-I/O, never-throws on junk, 10/10 unit, tsc 0. Remaining wiring = D1 cohort query + Listmonk segment-sync push. 146→145. worker→CI (gate GREEN).
- [x] [auto] **LM11 archive + signup embed** — **CORE DONE:** services/archive_signup.ts — buildArchiveHtml+buildSignupEmbed, XSS-escaped, honeypot CSRF, AJAX submit, 22/22 unit, gates clean. 127→126.
- [x] [auto] **LM12 open/click → analytics** — **CORE DONE 2026-06-29:** `services/listmonk_events.ts` — pure `mapListmonkEvent`+`mapListmonkEvents` (open/click→analytics shapes) + deterministic `eventKey` dedup. Zero-I/O, 22/22 unit, all gates clean. Remaining = wire into Listmonk webhook receiver. 137→136. worker→CI.
- [x] [auto] **LM13 AI campaign drafts** — **CORE DONE:** services/campaign_builder.ts — 5 DEFAULT_TEMPLATES (newsletter/changelog/announcement/onboarding/reengagement)+extractTemplateVars+validate, 28/28 unit, gates clean. 131→130.
- [x] [auto] **LM14 preference center** — **CORE DONE:** services/preference_center.ts — typed prefs (4ch/8keys)+defaults+resolve+validate, 25/25 unit, gates clean. 131→130.
- [x] [auto] **LM15 bounce/complaint → suppression sync** — **CORE DONE:** services/suppression_sync.ts — mapSesToSuppressions (Permanent/Transient→bounce, Complaint→complaint, 200-char truncation, empty-email skip)+classifyBounce, 21/21 unit, gates clean. 127→126.
- [x] [auto] **LM16 AI send-time/subject optimization** — **CORE DONE 2026-06-29:** `services/send_optimization.ts` — pure optimization mechanics: `assignVariant(key, variants, salt)` (deterministic djb2-hash A/B(/n) bucketing — stable per recipient, even split, per-salt independent), `recommendSendHour(openHours)` (modal open-hour, ties→earliest, ignores out-of-range, default 10am), `pickWinningSubject(stats, minSent=50)` (highest open-rate variant above the sample threshold, clamps opened>sent, null when none qualify). No `Date.now()`/`Math.random` (deterministic). Zero-I/O, never-throws, 12/12 unit, tsc 0, lint 0-err, prettier clean. The AI subject-candidate generation is a separate layer. Remaining wiring = pull opens/stats from analytics + apply variant/time/winner in the Listmonk send path. 143→142. worker→CI.
- [x] [auto] **LM17 per-recipient personalization** — **CORE DONE 2026-06-29:** `services/listmonk_personalize.ts` — `toSubscriberAttribs(signals)` maps our user/site signals → the flat `attribs` bag Listmonk stores per subscriber (drops null/blank/non-finite) + a safe `renderPersonalized(template, vars, {fallback})` `{{ key }}`/`{{ key | inline-default }}` merge (XSS-safe plain substitution, never `eval`; missing → inline-default → global-fallback → '' so an email never ships a raw `{{ }}`; numbers/booleans rendered) + `extractVars`/`missingVars` validators. Zero-I/O, never-throws, 13/13 unit, tsc 0. Distinct from `prompts/renderer` (that's prompt-injection-scoped, no defaults). Remaining wiring = push attribs on sync (LM10 pairs) + use in the Listmonk campaign/transactional send path. 145→144. worker→CI (gate GREEN).
- [ ] **LM18 email-as-a-feature** — provision scoped lists per customer (site-owners send to their audiences). [parked]
- [ ] **LM19 site contact-form → owner list** — opt-in capture on generated sites. [parked]
- [ ] **LM20 multi-tenant isolation + per-customer SES identities/domains** — sending-domain separation. [parked]
- [ ] **LM21 plan-gate sending quotas** — Pro-tier pricing decision. [parked]
- [x] [auto] **LM22 branded transactional templates** — **CORE DONE 2026-06-29:** `services/template_branding.ts` — `buildTemplateVars(input)` → BrandTemplateVars (logo/colors/CSS block/CTA-style/logo-img) + `brandCss` + `logoImg`. Projectsites default palette fallback, contrast-aware CTA (light primary→dark text). Zero-I/O, never-throws, 19/19 unit, gates clean. Remaining = wire into SES/Listmonk template send path. 137→136.
- [x] [auto] **LM23 deliverability dashboard** — **CORE DONE 2026-06-29:** `services/deliverability_summary.ts` — pure `aggregateDeliverability(rows, totalSent)` → bounce/complaint counts+rates(+breakdown by subtype) + `dailyTrend` (30d bucketed, windowed w/ opts.nowMs). Zero-I/O, 5/5 unit, tsc+lint clean. Remaining = query suppressions from D1 + /admin panel. 139→138. worker→CI.
- [x] [auto] **LM24 rate-limit/retry wrapper** — **CORE DONE:** services/listmonk_retry.ts — retryDelay (exp backoff + deterministic jitter)+idempotencyKey+TokenBucket (consume/refill/cap), 29/29 unit, gates clean. 127→126.

### Whole-app — platform-wide (the self-hosted suite: sites · PM · CRM · email · keys · CMS · voice)
- [ ] **AP1 platform backup/restore runbook** — ALL stateful stores (D1, R2, TiDB, every Neon DB, every Upstash, container DBs); per-store RPO/RTO; one drill. (No backups exist platform-wide — biggest risk.) [parked]
- [ ] **AP2 unified service-health dashboard** — live status of every container/worker in /admin + the crash-loop alert class. [parked]
- [ ] **AP3 CF-Container hardening baseline** — shared template baking every hard-won lesson (`mkdir /dev/shm`, amd64 pin + CACHEBUST, keep-warm cron, health route, observability). [parked]
- [ ] **AP4 self-hosted-app deploy generator** — scaffold Dockerfile+wrangler+worker+CI from the Plane/Twenty pattern. [parked]
- [ ] **AP5 WAF-skip automation** — any new app subdomain serving POST auto-added to the zone skip rule (we hit this 3× pm/api/r2s3) + a gate. [parked]
- [x] [auto] **AP6 reusable R2 POST-Object shim** — **CORE DONE 2026-06-29:** `services/r2_post_shim.ts` — `buildR2PostForm(config, nowMs)` builds a signed AWS4-HMAC-SHA256 S3 POST policy + form fields for R2 (endpoint/key-prefix/max-size/expiration), cap at 2d. Web Crypto (impure but Workers-native), deterministic `nowMs` param. 4/4 unit, tsc+lint clean. Remaining = wire into Plane + any other S3-POST app. 137→136. worker→CI.
- [ ] **AP7 unified SSO** — one login across Plane/Twenty/Listmonk/CMS dashboards via Better Auth/OIDC. [parked]
- [ ] **AP8 psnotify cross-app bus** — every app's webhooks → one DO inbox + center + prefs. [parked]
- [x] [auto] **AP9 secret-rotation calendar** — **CORE DONE 2026-06-29:** `services/secret_rotation.ts` — pure `rotationStatus(record, now, maxAgeDays=90)` → ok|due_soon(≤14d)|overdue|unknown + ageDays/daysUntilDue/dueAtMs (per-secret `maxAgeDays` override; ms-or-ISO; never-rotated→unknown) + `buildRotationReport(records, now)` → entries sorted overdue→due_soon→unknown→ok + counts + `needsAttention`. No `Date.now()` inside (caller passes now → deterministic). Zero-I/O, never-throws on empty/non-finite, 11/11 unit, tsc 0. Enforces the ≤90d vendor-risk-tiering cadence. Remaining wiring = a D1 `secret_rotations` registry (name/vendor/last_rotated) + the /admin calendar surface + the rotation automation. 146→145. worker→CI (gate now GREEN — 506 suites/7010 tests).
- [x] [auto] **AP10 cost-per-service dashboard** — **CORE DONE 2026-06-29:** `services/cost_aggregation.ts` — pure `aggregateCosts(lineItems)` → grand total (+`$x.xx` display) + per-vendor breakdown (sorted highest-first, % share) + per-app breakdown (`unattributed` bucket pinned last) + `formatCents`. Clamps negative/non-finite to 0, skips vendor-less items, all-zero on empty — never throws. Zero-I/O, 7/7 unit, tsc 0, lint 0-err, format clean. Remaining wiring = pull line items from each provider billing API (CF/Neon/Upstash/CloudAMQP/SES/TiDB) + /admin dashboard surface. 144→143. worker→CI.
- [x] [auto] **AP11 typed service registry** — **CORE DONE 2026-06-29:** `services/service_registry.ts` — `createRegistry(entries)` factory (validate/dedup/freeze) + `DEFAULT_SERVICES` (9 live entries: Plane/Twenty/Listmonk/Unkey/Postiz/Inngest/CMS/LLM/CRM). Zero-I/O, 22/22 unit, gates clean. Remaining = wire admin health-dashboard + secret-rotation calendar. 137→136. driving admin + clients.
- [ ] **AP12 MCP gateway** — expose Plane/Twenty/Listmonk MCP behind one authenticated endpoint for our agents. [parked]
- [x] [auto] **AP13 cross-app identity graph** — **CORE DONE 2026-06-29:** `services/identity_graph.ts` — pure `buildIdentityGraph(flatRows)` → `{nodes: IdentityNode[] (userId/email/apps/appCount/isCrossApp), totalUsers, crossAppUsers, appCounts}`. Merges + dedupes per (app, externalId); sorts most-connected-first; missing email→"unknown"; skips empty rows, never throws. Zero-I/O, 6/6 unit, tsc 0, lint+prettier clean. The unification layer psnotify/billing/AI-ops consume to resolve one customer view. Remaining wiring = pull rows from each app DB/API. 141→140. worker→CI.
- [ ] **AP14 DR game day** — simulate a store/region outage; verify wrangler rollback + D1 Time Travel + restores. [parked]
- [ ] **AP15 aggregate uptime + status page** — external probe of all subdomains → public status. [parked]
- [x] [auto] **AP16 post-deploy smoke matrix** — **CORE DONE 2026-06-29:** `services/smoke_matrix.ts` — `buildSmokeSpec(endpoints, baseDomain)` constructs the ordered smoke checklist (path/method/subdomain/expectStatus/bodyContains/bodyNotContains/headerEquals/headerPresent); `validateSmokeResult(spec, status, body, ms, headers)` returns `{pass, failures[]}`; `summarizeSmoke(results)` → `SmokeMatrix {passCount,failCount,pass}`. All pure. Zero-fetch inside (runner is a thin loop outside). 10/10 unit, tsc 0, lint 0-err, prettier clean. Remaining = the `fetch`-loop runner + wire into `project-sites.yaml` CI. 140→139. worker→CI.
- [x] [auto] **AP17 cross-boundary trace correlation** — **CORE DONE 2026-06-29:** `services/trace_propagation.ts` — `propagateHeaders(ctx)` → outgoing x-trace-id/x-request-id/x-tenant-id/x-caller HTTP headers; `traceLogContext(ctx)` → structured-log context block; `parseInboundTrace(headers)` → parse inbound headers (+ W3C traceparent fallback, + cf-ray/cf-request-id). All pure, never-throws. 8/8 unit, tsc+lint+prettier clean. Remaining = wire into every outbound fetch + container call. 138→137. worker→CI.
- [ ] **AP18 data-residency review** — EU-default for new stores; audit existing (GDPR; one-way-door). [parked]
- [ ] **AP19 AI ops agent** — reads health/logs across services, auto-files Plane issues + psnotify alerts on anomalies. [parked]
- [x] [auto] **AP20 one-signup platform provisioning** — **CORE DONE:** services/provisioning_plan.ts — buildProvisioningPlan({optIns}) ordered checklist (crm→email→social deps) with URLs+durations, 18/18 unit, gates clean. 131→130.
- [x] [auto] **AP21 unified admin Cmd-K** — **CORE DONE 2026-06-29:** `services/cmd_k_data.ts` — `buildCmdK` (group by category, sorted) + `filterCmdK` (case-insensitive match, quality-sorted) + `matchScore` (100/60/50/25/10/0 tiers). Zero-I/O, 34/34 unit, 0 lint, tsc clean. Remaining = wire the UI picker component. 137→136.
- [x] [auto] **AP22 billing meter aggregation** — **CORE DONE 2026-06-29:** `services/billing_meter.ts` — `aggregateMeter(counters)` sums usage per app+metric, applies $ pricing (builds 5c/ai 1c/email 0.05c), emits Lago billable code + payload; `billableOnly` filters zeros. Zero-I/O, 16/16 unit, gates clean. Remaining = push to Lago events API + dashboard. 137→136.
- [x] [auto] **AP23 URL sanitizer** — **CORE DONE:** services/url_sanitizer.ts — sanitizeUrl+isSafeUrl+isPrivateHost (SSRF guard: blocks RFC1918/loopback/link-local/IPv6/metadata), 45/45 unit, gates clean. Rate-limit/retry half is follow-on. 131→130. (stop re-implementing it).
- [ ] **AP24 suite positioning** — bundle the self-hosted suite (PM+CRM+email+sites+keys) as the projectsites differentiator (strategy/pricing). [parked]

---

## History

Shipped proof = `git log` + prior revisions of this file. Recently shipped: **Voice go-live (V0g) LIVE 2026-06-28** (agent `CA_dSUDxEC3EiP6` Running on LiveKit Cloud + Twilio Elastic SIP→LiveKit SIP trunk + dispatch; +12626864783 answers); #20 build-cap, #29 GDPR Art.17 cascade, #36 abuse-takedown, #45 onboarding-copilot, #48 built-with badge, #49 marketing GEO, AN6 owner-analytics route, V0b voice number-resolver, V33 AI disclosure, theme-polarity decision logic, SSRF + bot-gate hardening, speculation-rules, #44 owner-analytics dashboard.

---


## automation.projectsites.dev — Activepieces Absorption (Brian directive 2026-06-30)

> **Decision:** Fork Activepieces (MIT license). Absorb into ProjectSites — rebrand, skin,
> deeply integrate, ship as a native product feature. NOT a wrapped/embedded third-party
> iframe. Each ProjectSites customer gets one Activepieces project; multi-tenancy is
> database-per-customer via the App Store provisioning layer. No customer ever sees
> "Activepieces" — they see "Automation" inside ProjectSites.
>
> **Architecture:** Forked Activepieces source → modified at build time → deployed as
> Fly.io app behind `automation.projectsites.dev` → CF Worker reverse-proxy injects
> ProjectSites shell chrome + CSS tokens → Better Auth SSO bridge → Neon Postgres
> (one DB per customer, provisioned via App Store) → Upstash Redis (shared).
>
> **17 projects, ordered by build sequence:** visual absorption first (days),
> platform foundation second (weeks), AI-native features last (months).

### LOOP-AP-001 — CSS Injection Pipeline (P0)
- **Est. build:** 30h · **Revenue:** Foundational — everything builds on this
- Build a reverse-proxy CF Worker at `automation.projectsites.dev` that intercepts every Activepieces HTML/CSS response and injects a `<style>` block remapping all `--ap-*` design tokens to `--ps-*` equivalents (cyan/black/#060610/#00E5FF/Sora/JetBrains Mono)
- Map every CSS variable, font reference, border-radius, shadow, and color in the Activepieces UI to ProjectSites design tokens
- Ship `_activepieces.scss` design-token map as committed source
- Gate: Activepieces UI loads at `automation.projectsites.dev` looking like it was built by ProjectSites — no teal/green Activepieces brand colors visible anywhere
- Files: `apps/project-sites/infra/activepieces/proxy-worker.ts`, `_activepieces.scss`

### LOOP-AP-002 — SSO Bridge (Better Auth → Activepieces) (P0)
- **Est. build:** 35h · **Revenue:** Eliminates separate login — makes automation a feature, not a separate app
- Wire ProjectSites Better Auth as the identity provider for Activepieces via JWT managed auth
- User signs into ProjectSites → clicks "Automation" → JWT minted with ProjectSites session claims → Activepieces accepts it → user lands in their project with zero additional login
- Activepieces session TTL mirrors ProjectSites session TTL; logout propagates both ways
- Files: `apps/project-sites/infra/activepieces/auth-bridge.ts`, Activepieces fork auth module

### LOOP-AP-003 — ProjectSites Piece Family (P0)
- **Est. build:** 55h · **Revenue:** The connective tissue — without these pieces, Activepieces can't touch ProjectSites
- Build 5 custom Activepieces pieces using the Activepieces piece SDK (`@activepieces/piece-framework`):
  - `projectsites-sites` — CRUD sites, list, get status, trigger rebuild
  - `projectsites-build` — trigger builds, monitor progress, get build logs
  - `projectsites-analytics` — query site stats from Tinybird/PostHog
  - `projectsites-domains` — list, add, verify, set primary custom domains
  - `projectsites-billing` — Stripe operations via ProjectSites billing API
- Each piece follows Activepieces SDK patterns, has typed inputs/outputs, and is unit tested
- Files: `apps/project-sites/infra/activepieces/pieces/*/`

### LOOP-AP-004 — Per-Customer Database Auto-Provisioning (P0)
- **Est. build:** 40h · **Revenue:** Makes automation a zero-friction upsell — no manual setup per customer
- When a customer signs up or clicks "Enable Automation," the App Store provisioning layer creates a new Neon Postgres database (`projectsites_ap_{siteSlug}`) on the shared Listmonk project
- Activepieces project is created and bound to that database + the shared Upstash Redis
- Customer's first API key is provisioned, starter templates are seeded, and the embed URL is returned — all before the customer sees the Automation tab
- No multi-tenancy from Activepieces' side — each customer gets a dedicated project, hidden from them
- Files: `apps/project-sites/src/services/automation_provisioner.ts`, App Store integration

### LOOP-AP-005 — AI Flow Builder (P1)
- **Est. build:** 50h · **Revenue:** Flagship AI-native differentiator — "describe your automation, deploy it"
- Chat panel embedded in the forked Activepieces builder UI (`<ChatToFlow>` component)
- User types natural language: "When someone submits my contact form, send a Slack DM to #leads and create a Twenty CRM contact"
- Workers AI (Llama 3.3 70B FP8 via AI Gateway) with structured output generates the complete flow JSON: piece selection, field mappings, auth wiring, trigger configuration
- Flow renders in the builder for review; user tweaks, tests with sample data, clicks Deploy
- Uses ProjectSites AI stack (AI Gateway, Workers AI, prompt registry) — no external AI dependency
- Files: Activepieces fork: `packages/ui/feature-builder/src/lib/chat-to-flow/`

### LOOP-AP-006 — Flow → MCP Tool Promotion (P1)
- **Est. build:** 45h · **Revenue:** Turns every customer flow into an AI-callable tool — automation as an extension platform
- Any published flow gets a "Promote to MCP Tool" button
- The flow becomes callable from Claude via the ProjectSites MCP server at `automation.projectsites.dev/mcp`
- A customer's "generate weekly SEO report" flow becomes `ap_generate_weekly_seo_report` — Claude or any MCP client can invoke it
- Tool parameters map to flow trigger input schema; execution returns flow output as structured JSON
- Gateway for per-customer tool isolation, rate limiting, and usage metering
- Files: Activepieces fork: MCP server module modifications

### LOOP-AP-007 — Starter Flow Template Library (P0)
- **Est. build:** 50h · **Revenue:** Immediate value prop — customers see ROI in 5 minutes
- 25 pre-built flow templates organized by category: Onboarding, Marketing, Operations, Support, Billing
- Categories by ProjectSites vertical: Nonprofit, Restaurant, Professional Services, Local Business, E-commerce
- Each template is a `.json` flow export with placeholder values, markdown documentation, and a one-click import
- Templates stored in R2, versioned, with a "last verified working" date
- Every template includes test fixtures (input payload, expected output, mock connections)
- Files: `apps/project-sites/infra/activepieces/templates/`, R2 bucket `project-sites-automation-templates`

### LOOP-AP-008 — Content Pane Absorption (P1)
- **Est. build:** 35h · **Revenue:** The projectsites-dev content pane (site detail, editor, analytics) becomes a first-class surface inside the Activepieces builder
- When building a flow that references a ProjectSites entity (a specific site, domain, build), the content pane slides out showing that entity's live state — site preview, recent builds, analytics snapshot
- Bi-directional: clicking "Automate this site" from the ProjectSites admin opens Activepieces with the site pre-selected as context
- Implemented as a shared `<ContentPane>` component in the forked Activepieces UI, driven by the ProjectSites API
- Files: Activepieces fork: `packages/ui/feature-builder/src/lib/content-pane/`

### LOOP-AP-010 — No-Signs-of-Activepieces Mode (P0)
- **Est. build:** 40h · **Revenue:** If a customer ever sees "Activepieces," absorption failed
- Audit and replace every Activepieces brand reference across the entire forked codebase: login page, dashboard chrome, builder toolbar, error pages, email footers, 404 page, MCP server description, piece descriptions, documentation links, console logs, env var names
- Build a CI gate (`scripts/check-no-activepieces-brand.mjs`) that greps the fork for hardcoded brand strings and fails the build
- Rename the GitHub fork to `project-sites-automation`; strip Activepieces from package.json, README, license headers (preserving MIT attribution)
- Files: Entire fork, CI gate

### LOOP-AP-011 — Unified Observability Pipeline (P1)
- **Est. build:** 40h · **Revenue:** One pane of glass — flow failures appear alongside site deploy failures
- Pipe Activepieces execution logs, flow run events, and error traces into ProjectSites observability stack
- PostHog: capture flow runs as events with `featureSlug: automation`, `projectId`, `tenantId`
- Sentry: flow step failures as exceptions with full context
- Workers Tracing: every flow run creates a trace span with step-level children
- Structured logs carry `correlationId` matching the ProjectSites format
- Dashboard in ProjectSites admin shows flow success rate, p95 execution time, error breakdown
- Files: Activepieces fork: observability module, `src/services/automation_observability.ts`

### LOOP-AP-012 — OAuth Connection Vault Sharing (P2)
- **Est. build:** 50h · **Revenue:** Eliminates double-auth — customer connects Stripe once
- ProjectSites MCP OAuth Hub (Nango at `integrations.projectsites.dev`) connections exposed as Activepieces connections
- Custom Activepieces piece that wraps the Nango connection: the piece calls `GET /api/nango/connections/{provider}` to get the token, then uses it for the API call
- Customer who connected Stripe via ProjectSites never reconnects it in Activepieces
- Connection lifecycle: create in Nango → available in Activepieces → revoke in Nango → removed from Activepieces
- Files: `apps/project-sites/infra/activepieces/pieces/nango-proxy/`, Nango integration

### LOOP-AP-014 — Responsive Cockpit Layout (P2)
- **Est. build:** 45h · **Revenue:** Maximum information density — the admin cockpit doctrine applied to automation
- Redesign the Activepieces dashboard/builder layout for compact density: collapsible side panels, compact table rows, inline editing, keyboard shortcuts for every action
- `/` command palette for flow operations (create, duplicate, test, publish, delete)
- Real-time run visibility: a live log tail of active flow runs in a bottom panel
- Dark-only, cyan/black color scheme, 22px border radius, glassmorphism cards
- Match the ProjectSites admin cockpit patterns from `[[admin-cockpit-v2-redesign]]`
- Files: Activepieces fork: UI layout components

### LOOP-AP-015 — Flow Template Marketplace UI (P2)
- **Est. build:** 40h · **Revenue:** Turns the template library into a browsable product surface
- Gallery UI inside the ProjectSites admin: search, filter by category/industry/complexity, preview flow steps as a visual diagram, "Add to My Project" button with one-click import
- Templates pulled from R2 bucket, versioned, with user ratings and "used by N customers" counts
- Admin can feature templates, deprecate old versions, and A/B test template descriptions
- Files: `frontend/src/app/pages/admin/automation-marketplace/`

### LOOP-AP-016 — Per-Industry Flow Packs (P2)
- **Est. build:** 45h · **Revenue:** Vertical-specific automation = reason to upgrade
- Curated template packs for each ProjectSites vertical:
  - **Nonprofit:** donation tracking → thank-you email → CRM update, volunteer scheduling → reminder SMS, grant deadline → 30/14/7-day reminder sequence, in-kind donation receipt → inventory update
  - **Restaurant:** online order → kitchen notification → confirmation SMS, reservation booked → reminder email → review request after visit, health inspection due → prep checklist → document upload
  - **Professional Services:** lead capture → CRM contact → follow-up sequence, invoice sent → payment reminder → paid confirmation, appointment booked → prep email → follow-up survey
  - **Local Business:** Google review posted → Slack notification → response template, inventory low → reorder alert → purchase order, social post published → cross-post to all platforms
- Each pack = 5-8 templates, industry-specific documentation, and a "quick start" guide
- Files: `apps/project-sites/infra/activepieces/templates/industry-packs/`

### LOOP-AP-017 — Run Replay & Debugging (P2)
- **Est. build:** 50h · **Revenue:** Professional-grade debugging — makes Activepieces feel like a developer tool
- Record every step input/output for the last N runs (configurable, default 100)
- Replay a failed run with the same inputs in a sandboxed execution context
- Step-through debugger: pause at each step, inspect intermediate state, modify inputs, resume
- Diff view between successful and failed runs of the same flow
- "Copy as test fixture" button exports any run's input as a test case
- Files: Activepieces fork: execution engine, debugger UI

### LOOP-AP-018 — CF Worker Proxy Shell (P1)
- **Est. build:** 35h · **Revenue:** The architectural absorption pattern — Activepieces doesn't know it's embedded
- A thin CF Worker at `automation.projectsites.dev` acts as a reverse proxy to the Fly.io Activepieces app
- Injects ProjectSites shell chrome (nav bar, user avatar, breadcrumbs, footer) around Activepieces HTML responses
- Handles CSP header merging, cookie forwarding, CORS, and WebSocket upgrade for real-time features
- Routes `/api/automation/*` to the proxy, serves Activepieces UI at `/automation`
- Transparent to Activepieces — it thinks it's running standalone on its own domain
- Files: `apps/project-sites/infra/activepieces/proxy-worker.ts`

### Architectural Decisions (codified 2026-06-30)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fork vs wrapper | **Fork** | Full control over branding, auth, UI. Upgrade pain accepted as cost of absorption |
| Multi-tenancy model | **One DB per customer** | No Activepieces-level multi-tenancy. App Store provisions DBs. Simpler isolation |
| Hosting | **Fly.io** | CF Containers tried, image too heavy. Fly.io proven working |
| Auth | **Better Auth → JWT managed auth** | Uses Activepieces' documented JWT auth bridge. No custom auth module needed |
| AI stack | **Workers AI (Llama 3.3 70B FP8)** | Free tier, AI Gateway routing. No external AI dependency |
| Observability | **PostHog + Sentry + Workers Tracing** | Same stack as rest of platform. No new vendors |

### Build sequence (Brian: "take your time and program it right")

```
Wave 1 (days, visual absorption):  AP-001 → AP-018 → AP-010
Wave 2 (weeks, platform):         AP-002 → AP-004 → AP-003 → AP-007 → AP-008
Wave 3 (weeks, observability):    AP-011 → AP-017
Wave 4 (months, AI-native):       AP-005 → AP-006
Wave 5 (months, marketplace):     AP-012 → AP-014 → AP-015 → AP-016
```

---

## ADMIN-COMPLETENESS LOOPS (scheduled 2026-09-05)

Three durable crons drive every /admin section to completeness across 10 dimensions.
Each fire: verify-before-implement (git log + prod), advance ONE slice, VISION-INSPECT
each section + implement obvious common-sense improvements, fan out 4-5 agents, append
findings + closures HERE.

- **INTEGRITY** (`5ee7d04d`, :13/:43) — render+a11y (`admin-surf-audit.mjs`), truthful data (`reconcile-surfaces.mjs`), truthful mutations (`verify-*-causal.mjs`).
- **COMPLETENESS** (`ce0dbcc5`, :21 /2h — re-id'd from 3767bbe0) — real journeys (create→build→publish, form→/admin/forms, MCP connect, billing checkout), edge states, contract (`admin-contract.mjs`), every-control-real, **+ (8) EDITOR FUNCTIONS+DATA TABS: re-imagine + implement in totality connected to real project (Brian directive 2026-09-05)**.
- **QUALITY** (`36c915cd`, 4:37am daily) — per-section perf (LCP≤2.0s/INP≤200ms), security (IDOR/flag-off-404/PII), polish+docs (AI-vision ≥8/10, FEATURES.md/COVERAGE.yml).
- **FULL JOURNEY (golden)** (`6e8c5efb`, :47 /8h — re-id'd from 76d32a6e; Brian directive 2026-09-05) — prove the WHOLE product end-to-end in a real browser (NOT mocked): Lead Scanner → claim link → adopt → build-from-scratch → view published site → analytics perfect simple traffic view (causal: visit→it counts). **+ step (6) VERIFY ALL ADMIN ASPECTS (Brian directive 2026-09-05):** after the build, walk EVERY /admin section (contract-sweep all + reconcile + causal) + confirm the new site PROPAGATES to each (Sites list, Analytics traffic, Forms submission, Media assets, Snapshots, Audit build events, SEO, Domains/hostnames, Editor incl. Functions+Data tabs showing REAL not mock, Billing/Team/Env/Voice/MCP). Continuously vision-inspect + improve. ALSO make the TEMPLATE better every fire → per-industry 3D/WebGL hero scenes + advanced gorgeous layouts → `template.projectsites.dev` (next build, no redeploy). **Baseline verified 2026-09-05:** all 4 golden hops LIVE + gated (lead-scan 403, claim 404, build 401, analytics 200). Full live run + template-3D advance on recurring fires.

### Open findings

- [x] **AL-001 — Dashboard Recent-activity shows "Stripe checkout session created for 'undefined' tier".** ✅ FIXED 2026-09-05 (Integrity fire): confirmed HISTORICAL row — current billing.ts writes the clean 'Checkout session created' (no write-side bug). Fixed at render with a defensive `clean()` guard in `recent-activity.component.ts` (drops a broken "for 'undefined' <word>" clause, neutralizes quoted tokens, strips bare undefined/null) + a regression test. Deployed `main-HISFXIFE.js`; live-verified 0 `undefined` across the 8 /admin activity entries. Found via vision inspection 2026-09-05 (vanta-strength-austin, e2e-test-org, ~18m-ago row). User-visible `undefined` (banned copy). Leads: current `src/services/billing.ts` success msg is the CLEAN `'Checkout session created'` (no tier) — so the 'undefined tier' text is NOT from the current hosted-checkout path. Check: (a) embedded/wallet/addon/agency checkout success messages, (b) a historical audit row from older code (if so, no live bug — but a display-layer guard should still never render `'undefined'`), (c) any activity humanizer. Fix at the write site (default/omit tier) AND add a defensive display guard (never render a message containing `undefined`).
- [x] **AL-005 — surf-audit FALSE-GREEN on 3 non-routes (the audit itself was dishonest).** ✅ FIXED 2026-09-05 (INTEGRITY fire, dim 1). Vision-inspecting the thinnest "ok" sections revealed `/admin/media`, `/admin/env-vars`, `/admin/user-settings` all render the **admin not-found shell** ("ERROR 404 · This admin page doesn't exist") — yet `admin-surf-audit.mjs` reported each "ok (~900 chars)". Root cause: the audit's checks (console-error / error-boundary / blank<40 / axe) are ALL blind to a graceful branded soft-404 (>min chars, 0 console, axe-clean). The 3 paths aren't real routes: `media` + `env-vars` have no `app.routes.ts` entry / nav link / contract row (`EnvVarsManagerComponent` is embedded via `env-vars-attachment.component.ts` dialog); `user-settings`' real route is `/admin/user` (nav + contract SSOT agree). Product is FINE (bad paths → graceful 404 w/ Back-to-dashboard); the AUDIT lied. Fix: removed media/env-vars, corrected user-settings→user, + added a **`SOFT_404` guard** that FAILS any section rendering "this admin page doesn't exist" — so a REAL route regressing to the 404 shell can never hide behind "ok" again (it caught user-settings the instant it was added). Re-run CLEAN @1280 + @390. Commit `7d5e77568`. Same class as AL-002 (stale probe list) + a durable hardening. [[render-integrity-probe-blind-to-graceful-soft-404]] **Follow-up shipped 2026-09-05 (next INTEGRITY fire, `1a3d06bea`):** added the SSOT cross-check — surf-audit now imports `ADMIN_CONTRACT` + `childPath` from `admin-contract.mjs` and EXITS 2 at startup if any SECTIONS entry isn't a real admin route (contract childPath, or the documented `/admin/sites`→`/admin` redirect). Closes the drift class from BOTH ends: stale entry → startup fail; real route → 404 shell → runtime SOFT_404 fail. Verified: CLEAN on the real list; fires exit-2 on injected `media`/`user-settings`/`bogus`. (Vision-inspected voice/apps/billing/snapshots this fire — all polished, complete, honest; billing correctly shows Sites 107/3 over-limit in red. No product defect.)
- [x] **AL-006 — Social view-tabs rendered unstyled + jammed ("ComposeDrafts 0Queue 0Sent 0Calendar").** ✅ FIXED 2026-09-05 (INTEGRITY fire, dim 1 vision-inspection). Screenshotting the Social section showed the top-right view tabs (Compose/Drafts/Queue/Sent/Calendar) as unstyled inline buttons with NO spacing. Root cause: `social.component.ts` uses `<nav class="tab-row">` + `<button class="tab">` but had **NO `.tab-row`/`.tab` CSS** — `hlmTablist` only wires keyboard/focus; sibling tablists (settings.component `.tab` L671, voice.component `.tab` L188) style `.tab` locally. Added the missing pill-row styling (flex+gap `.tab-row`, pill `.tab` w/ hover/`.is-active`/`.tab-count` states, `--ps-accent`/`--ps-ink` tokens, reduced-motion gated) mirroring the sibling pattern. Regression test (`social.component.spec.ts`): asserts REAL computed `.tab-row` display:flex + gap>0 + `.tab` padding>0 — removing the CSS fails the build. 1670/1670 Karma green; typecheck clean. Deployed R2 (`main-EF2QDBMY.js`, 289/289 after a retry — 15 first-attempt upload failures were R2 flakiness per [[feedback_deploy_r2_reliability]]); **real-browser verified** — tabs now render as spaced pills w/ active-cyan Compose + count badges. Commit `760e37b0d`. (Vision-inspected settings/social/forms this fire — settings/forms polished + honest; only social had the defect.)
- [x] **AL-008 — analytics Top-referrers mislabeled direct/organic as "(referral)" (truthful-copy defect).** ✅ FIXED 2026-09-05 (INTEGRITY fire, dim 1 vision-inspection + dim 2 truthful-copy). `/admin/analytics` Overview → Top referrers rendered a HARDCODED "(referral)" tag on every row → "direct (referral)", "organic (referral)", "referral (referral)" — factually wrong (direct + organic aren't referrals) and redundant. Fix (`analytics.component.ts`): `referrerLabel()` maps known channels to friendly names (Direct / Organic search / Referral / Social / Email) with NO false tag; only a real host (`referrerIsHost()`) gets the "(referral)" tag. +2 Karma tests (channels never tagged; real host tagged). 1672/1672 green, typecheck clean. Deployed R2 (`main-ZMTPJYEH.js`, 289/289) + **real-browser verified**: rows now read "Direct (19) · Referral (3/2/1) · Organic search (1)". Commit `33b5dd33b`. **Full admin vision sweep now COMPLETE** — dashboard/analytics/user were the last unseen sections (all polished + honest; dashboard 5+102=107 sites consistent). All 3 integrity dimensions green this fire (surf @390 CLEAN, d1-sweep healthy).
- [x] **AL-007 — dimension-2 D1 ground-truth sweep: added a durable store-side data-loss guard (Integrity fire 2026-09-05).** The loop's dim-2 asks for "reconcile-surfaces + a D1 ground-truth COUNT sweep on the real org" — reconcile (display-side) ran green every fire, but the direct store-side sweep was ad-hoc. Ran it: prod D1 `org-brian-001`/`site-megabytespace-001` counts all ≥ reconcile's `gt` (sites 2/gt1 · media 2/gt2 · team 1/gt1 · audit_logs 1257/gt50 · snapshots 5/gt4 · mcp 2/gt2). Data GREW since the 2026-08-06 reconcile baseline (audit 1129→1257, snapshots 4→5) → hardcoded `gt` lower-bounds stay valid, no drift, truth-check honest. Made it durable + repeatable: new `e2e/admin-verify/d1-ground-truth-sweep.mjs` queries prod D1 directly and flags (a) count < `gt` (lying-empty risk) AND (b) count DROPPED to <½ its last baseline (data-loss — a class reconcile's LOWER-bound `gt` can't catch: audit 1257→3 still clears gt=50). Exit 1 on breach. Verified: 6/6 healthy, exit 0. Commit `<this>`. (Vision-inspected docs/site-features/logs/audit this fire — all polished + honest; logs correctly discloses "500 of 11208 events". No product defect.)
- [x] **AL-004 — Editor Functions + Data workbench tabs are MOCK-DATA (Brian directive 2026-09-05). FUNCTIONS TAB ✅ DONE+LIVE; DATA TAB ✅ DONE+LIVE (foundation + editor panel both shipped).**
  - **DATA TAB editor panel ✅ SHIPPED + PER-LAYER-VERIFIED 2026-09-05 (QUALITY fire item 10, `fb029f393`).** Replaced `DataPanel.tsx`'s static MOCK (fake SQLite/Neon/Redis cards) with the open project's REAL data via the admin bridge (embedded editor has no cross-origin session → mirrors the PS_DEPLOY_REQUEST publish flow). Chain: editor `postToParent(PS_DATA_REQUEST {table?})` → admin `BoltEmbedService` case calls `ApiService GET /api/sites/:id/data-overview[/:table]` (owns selectedSite + bearer) → `PS_DATA_RESPONSE`. Re-imagined panel: real platform tables + live counts, click→browse recent rows (server safe-column allowlist + masked email), loading/error/empty/standalone states, keyboard + brand tokens. Types `PS_DATA_REQUEST`/`PS_DATA_RESPONSE` in `embedded-mode.ts`; pure logic in `data-panel-logic.ts` + 9 Vitest (typecheck clean both apps; editor tsc:457 is a PRE-EXISTING error the Remix/esbuild build tolerates, not mine). Deployed: Pages `bolt-diy` (editor `Workbench.client-DH3uRpRj.js`) + FE R2 (admin `main-KQZGS5TG.js` → bridge in `chunk-CBXKRBLY.js`). **Verified every layer on real prod**: editor bundle served w/ `PS_DATA_REQUEST` + new copy, OLD `bricklabor_sqlite` mock GONE; admin chunk served w/ `PS_DATA_REQUEST`+`PS_DATA_RESPONSE`+`data-overview`; worker endpoint curl-verified (real counts + masked email + IDOR 404 + allowlist 400). Every link contract-matched + typechecked + served — the live postMessage round-trip inside a booted WebContainer is the manual acceptance step (headless boot too flaky to gate on). ⚠️ STASH HAZARD this fire: `git stash push` of the untracked logic file ("forgot to git add") + bare `git stash pop` popped a CONCURRENT session's wrangler.toml container-config into my tree (UU conflict); restored via `git checkout HEAD -- wrangler.toml` (never committed it) — do NOT `git stash push`/`pop` on a shared dirty tree with untracked files; use worktrees or stage first. Commit `fb029f393`.
  - **DATA TAB foundation ✅ SHIPPED + LIVE-VERIFIED 2026-09-05 (COMPLETENESS fire, item 8).** Verify-before-implement caught that wiring the tab to the existing `GET /api/sites/:id/data` would be a HOLLOW fix: its `site_data` CMS store is **100% empty across all of prod** (0 rows, 0 sites). The mock also lies (shows Neon/Redis, which static projectsites sites don't have). A site owner's REAL data lives in shared platform tables scoped by `site_id`. Built the honest, fully-curl-verifiable foundation the editor panel needs: new read-only, org-scoped, IDOR-guarded routes in `site_data_api` — `GET /api/sites/:siteId/data-overview` (visitor_events · form_submissions · site_snapshots · mcp_connections · site_data + live row counts) + `GET /api/sites/:siteId/data-overview/:table` (recent rows). **Security boundary = explicit per-table safe-column allowlist** (`SITE_DATA_OVERVIEW_TABLES`): form_submissions PII (payload/ip/user_agent) + mcp_connections encrypted tokens NEVER selected, `email` masked (`maskEmailValue`); fail-soft per table (missing → 0/empty, never 500). 11 unit tests (registry, allowlist invariant, clamp, mask). Deployed via CI (`3810f3e6f` → Deploy to Production success). **LIVE-verified** on cardinal-heating-cooling-madison (e2e key, workers.dev): counts exact (visitor_events 98 · form_submissions 2 · snapshots 1 · mcp 0 · site_data 0 — match D1 ground truth), email masked `q***@example.com`, unknown table→400, cross-org IDOR→404. Commit `3810f3e6f`.
  - **DATA TAB editor panel ⏳ NEXT SLICE (contract now concrete).** Wire `app/components/workbench/DataPanel.tsx` (replace the static MOCK `RESOURCES`) via the SAME admin bridge the publish flow uses (`Chat.client.tsx` PS_DEPLOY_REQUEST — the embedded editor has NO cross-origin session, so authed calls MUST go through the parent): editor posts `PS_DATA_REQUEST {table?}` → admin `BoltEmbedService` (`frontend/src/app/services/bolt-embed.service.ts`) calls `ApiService` `GET /api/sites/:siteId/data-overview[/:table]` (it owns siteId=selectedSite + the bearer) → posts back `PS_DATA_RESPONSE {tables|rows}`. Render real tables+counts, click→browse rows, loading/empty/error states. Extract pure render logic → `data-panel-logic.ts` + Vitest (mirror FunctionsPanel). Deploy Pages `bolt-diy` (editor) + FE R2 (admin bridge); real-browser cross-frame verify.
  - ✅ **Functions tab (2026-09-05, COMPLETENESS fire, commit `9e6153644`, deployed Pages `bolt-diy`):** `FunctionsPanel.tsx` no longer renders MOCK_ROUTES/MOCK_BINDINGS. It now derives the route table LIVE from the OPEN project's real `functions/` folder in the workbench file store — one route per Pages Function (`functions/api/contact.ts` → `/api/contact`), HTTP methods parsed from the `onRequest{Get,Post,…}` exports, bindings + script + compat-date from `wrangler.jsonc`/`.toml`, per-handler `env.X` resource usage, honest empty state when no `functions/`, route-detail opens the real handler in the editor. Pure derivation extracted to `functions-panel-logic.ts` + **8 Vitest tests** (routes/methods/middleware/bindings/comment-strip) green. typecheck clean. **PROD-verified on editor.projectsites.dev**: served `Workbench.client-Dn_0-PQR.js` has the real logic (`Pages Functions`✓ `wrangler.jsonc`✓) and the old mock is GONE (`/api/booking`→0). Pages `bolt-diy` deploy verified by build-hash match (`workbench-Bs3SHegS.js`).
  - ⏳ **Data tab (NEXT slice):** `DataPanel.tsx` still renders mock RESOURCES (`bricklabor_sqlite`, mode:'local'). Needs a real connection: list the site's D1 tables + row counts + browse. Harder — the WebContainer has no D1, so it needs a worker D1-introspection endpoint (`/api/sites/:id/d1/tables` + `/query`) the panel calls (read-only, IDOR-guarded). Scope for a follow-on COMPLETENESS fire.
  - Baseline (COMPLETENESS loop item 8, `ce0dbcc5`): `app/components/workbench/FunctionsPanel.tsx` (207 lines) renders hardcoded `MOCK_ROUTES` + `MOCK_BINDINGS` (`/api/booking`, `/api/contact`, `/api/health`) — a static mockup, NOT the open bolt project's real `functions/` folder / WfP routes+bindings (ADR 0035). `app/components/workbench/DataPanel.tsx` (206 lines) has a `mode: 'mock' | 'local' | 'preview' | 'remote'` with mock data, NOT the site's real D1 tables/bindings. Both are visually-built but disconnected — the "not complete" Brian flagged. FIX (loop, multi-fire): visually inspect → RE-IMAGINE → implement in totality — Functions panel reads the project's real `functions/` folder + WfP routes/bindings + wires create/edit/deploy; Data panel connects to real D1 (list tables, row counts, browse); replace ALL mock data; deploy to Pages `bolt-diy`; real-browser verify both tabs show live connected data + every control works. NEVER re-delete these tabs (WANTED, [[editor-functions-data-tabs-are-wanted]]).
- **INTEGRITY fire 2026-09-05 (HEAD 2971d6eff) — ALL GREEN, no defect:** surf-audit @1280 CLEAN (25 sections), @390 CLEAN, reconcile-surfaces 0 divergences, causal mutations 2/2 PASS, newsletter Δ=1, beacon-funnel Δ=2. Admin surfaces render true + honest; data reconciles; mutations persist. Slice pivoted to the two Brian loop-enhancement directives above (golden-loop step 6 + COMPLETENESS item 8).
- [x] **AL-003 — Site MCP Server section was fully-built but 100% UNWIRED — every endpoint 404'd → "Couldn't load tokens/tools".** ✅ FIXED 2026-09-05 (COMPLETENESS loop, dims 4+6+7): `contract-sweep.mjs` `sites-mcp-server` was the sole hard failure (43/44) — "dead/false-success copy". Root cause: the per-site MCP feature (#29) was built END-TO-END — service `src/services/mcp_site_tools.ts` (mintSiteMcpToken/verifySiteMcpToken/revokeSiteMcpToken + SITE_MCP_TOOLS + dispatchTool), D1 tables `site_mcp_tokens` + `site_mcp_tool_usage` (migrations 0514/0625, applied to prod), AND the full 22K Angular section — but the service was imported ONLY by its own test; **no route ever wired it**. All 3 GETs (`/mcp/tokens`, `/mcp/tools`, `/mcp/tool-usage`) 404'd → catchError → error-cards. Fix: new `libs/features/site_mcp_server/handlers.ts` mounts the 5 missing authed routes (GET/POST/DELETE tokens, GET tools, GET tool-usage), each `need()`+`siteOwned()` IDOR-guarded, mint/revoke audit-logged, raw token shown once; allowlisted in validate-feature-drift (always-on, matches contract flag:null). 8 unit tests green, typecheck+drift clean, deployed via CI (`77a98448c` → Deploy to Production success). PROD-verified: all 3 GETs 200 (were 404), tools=9, **causal journey mint→list(PRESENT)→revoke→list(GONE)**, raw token `ps_mcp_…` len 39 shown-once. **contract-sweep now ✅ DONE 44/44.** NOTE (follow-on, tracked): the PUBLIC per-site JSON-RPC endpoint (`POST /:slug/mcp` → verifySiteMcpToken → dispatchTool) that external agents + the section's "test tool" button call is ALSO unwired — its own slice (public surface + security review).
- [x] **AL-002 — reconcile-surfaces `analytics (UI overview source)` was a permanent false-red (`/api/network-analytics` → HTTP 404, gt=1 shows=NaN).** ✅ FIXED 2026-09-05 (Integrity fire, TRUTHFUL-DATA dimension): the flagged endpoint `/api/network-analytics` exists in NEITHER the worker NOR the frontend — pure fiction in the probe's surface map. The admin analytics OVERVIEW (`/admin/analytics`) is truthful: its headline `total_requests` is derived CLIENT-SIDE from the per-site `/api/sites/:id/analytics` `pageviews`, already reconciled healthy (shows 2256 vs D1). The org-wide `/api/analytics/overview` route DOES exist but has zero UI consumers + reads sampled Analytics-Engine `total_visits` (can legit read 0), so it's not a reconcilable display surface. Fix per `validator-precision-discipline` (fix the validator, not the code): removed the fictional row with a documented rationale + relabeled any 404 as `⚠️ HTTP 404 (endpoint missing / surface-map stale?)` so a stale surface map can never again masquerade as a lying-empty product bug (a real route regressing to 404 still surfaces). Re-ran the reconciler as brian (Browserbase, real session) → **0 divergences across all 10 real surfaces** (sites 2 · analytics 2256 · media 2 · snapshots 5 · per-site audit 37 · org audit 50 · voice 1 · mcp 2 · team 1 · env 3). Signal-to-noise restored to 1.0. Product was truthful throughout — the bug was in the finder. NOTE (tracked, not this fire): `/api/analytics/overview` is a registered route with no frontend consumer — likely built-ahead (org-wide network dashboard) per `knip-unused-not-always-dead`; also seeds `admin_visit` events, so removing it is higher-risk + deferred, not drift-to-fix now.
- [x] **AL-009 — analytics Top-referrers: fold null-channel into "Direct" (COALESCE) + a verify-discipline near-miss.** ✅ SHIPPED 2026-09-05 (INTEGRITY fire, dim 2 truthful-data). `visitorEventsFallback` (the D1 path behind `GET /api/sites/:id/multi-url-analytics`, which serves EVERY `*.projectsites.dev` subdomain since CF per-host analytics is empty for them) grouped referrers by bare `json_extract(metadata,'$.channel')`. Events with no captured channel (null) rendered as a separate blank/`'(direct)'` bucket beside `channel='direct'` — two direct-ish rows for one concept. Fix: `COALESCE(json_extract(metadata,'$.channel'),'direct')` folds the null-channel rows into `'direct'` (site-megabytespace-001: 2047 direct + 103 null = one honest **Direct 2150**). **Live-verified** on vantage-digital-studio-portland (e2e-test-org, owned by E2E key): `/api/sites/:id/multi-url-analytics` → `top_referrers: [direct 56, referral 6, organic 1]` (correctly aggregated + null-folded). Worker deployed via CI (`e82c41afa` → Project Sites CI/CD success; staging-verify 403 was the known CF Bot-Fight-from-GHA artifact, prod deploy green). **NEAR-MISS (the real lesson): I first misdiagnosed a "D1 doesn't aggregate a COALESCE(json_extract) GROUP-BY alias" bug** — the referrer breakdown *appeared* to fragment one channel into many single-row buckets (Referral 3/2/1…), and I nearly hardened 5-6 sibling `json_extract`+alias GROUP BYs across `visitor_events_core/service.ts` + `site_analytics/service.ts`. The definitive **one-session batch** (bare-alias, coalesce-alias, coalesce-fullexpr — all 3 statements in ONE `wrangler d1 execute` = ONE replica snapshot) returned **IDENTICAL correct aggregation** → the "fragmentation" was a **transient D1 read-replica artifact** (each `wrangler d1 execute` is a fresh Sessions-API session → can hit a lagging replica mid-write-burst on a live site). GROUP-BY form is irrelevant to correctness; the sibling queries have **no bug** (validator-precision: didn't touch them). Corrected the misdiagnosed commit + comment in `b68694849` (keep the genuine COALESCE fix, revert the needless full-expr GROUP BY to the plain alias matching siblings, honest message). Lesson → memory [[d1-read-replica-transient-group-by-mis-aggregation]]. Two commits: `e82c41afa` (COALESCE + misdiagnosed comment) → `b68694849` (honest correction). Both keep the deployed endpoint returning correct data throughout.
- [x] **AL-010 — verify-forms-causal false-🔴 (probe read the WRONG site); product honest + test-pollution cleaned.** ✅ FIXED 2026-09-05 (INTEGRITY fire, dim 3 truthful-mutations). Full sweep this fire was otherwise all-green: surf-audit CLEAN @1280 + @390 (23 sections), d1-ground-truth-sweep healthy (audit 1257→1259, no drops), reconcile-surfaces **0 divergences** across all 10 surfaces, verify-mutations-causal **2/2 PASS** (site-update PATCH persist+restore; MCP connect→disconnect). Only `verify-forms-causal` returned 🔴 (`apiCausal=6, uiShows=false`). Verify-before-implement (probe can be wrong, per [[reconcile-surface-map-can-be-stale-false-red]] + [[d1-read-replica-transient-group-by-mis-aggregation]]): the probe submits to `megabytespace` (`X-Site-Slug`) + checks the API for `site-megabytespace-001`, but its `/admin/forms` UI check clicked the **FIRST** site-switcher option. Brian's org has 2 sites and `/admin/forms` **defaults to Northstar Functions Lab (0 forms)**, not megabytespace (15) — so the probe read an honestly-empty site → false 🔴. **Product is CORRECT** (proven via Browserbase, as brian): API returns 15 (==D1 15), and selecting megabytespace explicitly shows **17 rows + causal emails present**, XSS escaped (no dialog, no live `<script>`). Fix per `validator-precision-discipline` (fix the finder, not the code): probe now selects the option matching the site it submitted to (`hasText: /megabyte/i`, fallback first). Re-run: **✅ PASS** (rows 17, uiShows=true, errs 0). Commit `ef6db917c`. **Value-add:** cleaned 8 accumulated `causal-*@example.com` test rows polluting brian's real `form_submissions` (megabytespace 15→9 real forms) — the probe's docstring assigns cleanup to the caller; they were all test pollution (2 test emails, form_name=Contact, from 08-15 + 09-05 probe runs). NOTE (tracked): the causal probe writes test rows into brian's REAL production site each run + there's no forms-DELETE endpoint to self-clean — periodic `DELETE … WHERE email LIKE 'causal-%'` sweep needed, or point the probe at a dedicated e2e-org test site (larger refactor).
