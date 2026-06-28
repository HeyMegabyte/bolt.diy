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
- [ ] [auto] **Tenant `org_id` scoping audit** — AUDIT DONE (security-reviewer, 2026-06-28): pattern is route-level ownership gates (`requireOwnedSite`/`gateOwnedSite`/`siteOrgId`); ~20 surfaces clean. Found **7 IDOR gaps, all in flag-DARK experimental modules** (zero live exposure; must gate before any flag promotion). **4 WRITE-severity FIXED this fire** (`assertSiteOwned`/org-compare gate + tests, 47/47 jest, tsc 0): `edge_personalization` (variants upsert/resolve), `aeo_pass` (audit run/get), `search_submit` (IndexNow submit), `wireframe_planning` (plan build/get). **REMAINING (3, read/cost, lower-severity):** `gbp_assist` (GET/POST `/api/sites/:id/gbp/*` — `loadSite` by id only), `site_thumbnail_grid` (`GET /api/sites/:siteId/thumbnail`), `page_audio_summary` (`/api/audio-summary/:siteId` R2 TTS) — same gate, next fire.
- [ ] [auto] **Margin leak** — force AI-Gateway upstream of LiteLLM on every model call + swap GPT-4o vision→Workers-AI where adequate + cache research/brand/assets per business (~15→5 min rebuilds).

## 🔥 Tier 1 — Highest value (the revenue engine + what protects it)

### Conversion & activation (no revenue without these)
- [ ] [auto] Anonymous first-generation before signup — let visitors generate a build before the wall (biggest activation lever).
- [ ] [auto] One-click "Claim this site" → inline Stripe checkout (collapse adopt→pay).
- [ ] [auto] Contextual upgrade prompts at the friction moment (custom domain / remove top-bar / more pages).
- [ ] [auto] Abandoned-build recovery email — build-started-never-claimed → nudge w/ preview link.
- [ ] [auto] Instrument golden-path funnel in PostHog (search→signin→build→preview→claim→pay + drop-off cohorts).
- [ ] [auto] Streaming live-preview during build (render-as-it-generates, not a polling spinner).
- [ ] [auto] Live agentic action trail during site-gen (stream each Workflow step, for trust).

### Money-trust & correctness (don't double-bill / don't lose builds)
- [ ] [auto] General `Idempotency-Key` middleware on all mutations (only Stripe webhooks dedupe today).
- [ ] [auto] Finish event-bus → outbox → DLQ → retry loop for durable money/build events.
- [ ] [auto] Container build retry/DLQ on failure (capture/replay, not a silent error-email).
- [ ] [auto] Sentry on remaining worker critical paths (build-status callback, billing, workflow steps).

### Quality moat (why they pay — protects the generated product)
- [ ] [auto] Eval harness scoring every generated build (GPT-4o vision + Lighthouse + SEO, regression-tracked).
- [ ] [auto] Per-section AI-vision auto-reroll (<8/10 → regenerate).
- [ ] [auto] A11y autofixer + AI alt-text — axe findings fixed pre-publish (ADA legal-risk reducer).
- [ ] [auto] AI competitor-gap scan at build — score 5 peer sites, propose missing sections.

## ⬆ Tier 2 — High value (paid levers, honesty bugs, conversion analytics, security)

### Stop the lying UI (honesty bugs — P0-adjacent)
- [ ] [auto] S1 — real Lighthouse/CWV scores (run in the build container; matrix cells are permanently NULL today).
- [ ] [auto] S2 — real axe-core a11y (replace the fake `img:not([alt])` proxy).
- [ ] [auto] AN54 — operator zero-state honesty (super-admin Tinybird routes silently return empty — surface "no data yet").

### Apps marketplace — paid managed-hosting (Tier A0 trust = why anyone pays vs a VPS)
- [ ] [auto] A1 — per-instance automated backups + 1-click restore (Neon branch-snapshot + R2 versioning).
- [ ] [auto] A4 — pre-provision dry-run + cost preview + confirm gate (never silently provision billable infra).
- [ ] [auto] A2 — true live cost meter per instance (DO compute + Neon + Upstash + R2 egress; replace static estCostMonthly).
- [ ] [auto] A3 — health-driven auto-heal + real status timeline (up/restarting/crashed/hibernated + last-error).
- [ ] [auto] A6 — per-instance custom domain + auto-TLS (CF-for-SaaS custom hostname; the paid lever).
- [ ] [auto] A7 — resource sizing tiers at deploy + live upsizing (the core paid lever).

### Owner analytics that drive action (the phone/form IS the conversion)
- [ ] [auto] AN18 — click-to-call & directions tracking (phone IS the service-biz conversion).
- [ ] [auto] AN17 — form analytics: completion rate + abandonment per form (bridges pageview→lead).
- [ ] [auto] AN3 — unified owner-analytics query service (one API over the six backends; unblocks every widget).
- [ ] [auto] AN27 — section-level attribution query + UI ("Services section drives 40% of calls") — the moat.
- [ ] [auto] AN29 — natural-language analytics query ("visitors from Instagram last week?") — builder-only moat.

### Generated-site quality (remaining)
- [ ] [auto] 1:N sitemap fidelity guard wired into the live pipeline (fail on collapsed page counts).
- [ ] [auto] Flip `build_validators` report→strict (enforce the 13 quality invariants).
- [ ] [auto] Logo/font/color extraction fidelity (the suped-up-clone lever).
- [ ] [auto] Source-site theme-polarity preservation guard — decision logic SHIPPED (`services/theme_polarity.ts`, 13 tests); remaining = stamp `theme`/`preserveSourceDesign` onto container `_brand.json` + post-build `validateThemePolarity` guard.

### Security hardening
- [ ] [auto] CSP L3 strict-dynamic + nonce + Trusted Types on the worker AND generated output sites.
- [ ] [auto] SSRF allowlist on remaining user-URL-fetch routes (og-preview/import-rss/social).
- [ ] [auto] Secret-at-rest audit (MCP_ENCRYPTION_KEY + env-var AES-GCM) + rotation story.
- [ ] [auto] Social (Pulse) LIVE DEFECTS — fix hardcoded media domain in `social-publish.ts prepareMedia` (breaks custom-domain tenants; use primary hostname / signed R2 URL) · bump stale `REAL_UA` 131→149 in `social_publishers/types.ts` · add `social_*` flags · OAuth token-refresh.

### Viral growth surfaces
- [ ] [auto] S22 — immutable stable preview URLs (`{slug}-{snapshot}.projectsites.dev` permanent + shareable).
- [ ] [auto] S23 — "Built with ProjectSites" footer on unauth previews (the link IS the ad).
- [ ] [auto] S24 — "Build your own" CTA for anonymous preview viewers.
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
- [ ] [auto] AN26 — section-level instrumentation (auto-inject stable `data-ps-section`).
- [ ] [auto] AN49 — year-in-review auto report (retention loop).
- [ ] [auto] AN50 — benchmark vs fleet median ("your form converts 1.2% vs 3.4% category avg").

### Admin + infra + compliance
- [ ] [auto] Admin "build health" dashboard (success rate, p95 build time, failure reasons).
- [ ] [auto] R2 Standard→Infrequent-Access lifecycle after 30d (margin).
- [ ] [auto] Enable Cloudflare Queues for async fan-out off the request path (p99).
- [ ] [auto] WCAG 2.2 AA — close the 6 new criteria on admin + generated sites (box-tap-target ≥24px is gated on E2E_TEST_PASSWORD — see NEEDS BRIAN).
- [ ] [auto] Form reply-deliverability guardrails (SPF/DKIM check before reply). *(rate-limit, escape, Zod contract = DONE.)*
- [ ] [auto] Social (Pulse) hardening — rate-limit + quota alert, failed-post retry UX, brand-voice profile, per-platform reformat.
- [ ] [auto] Pulse Inbox AI — wire `summarizeConversation` + `suggestNextActions` into the inbox UI; `repurpose` + `translateContent` (per-account locale); expose auto-reply confidence in settings; backfill `social_analytics_snapshots`.

## ⬇ Tier 4 — Lower value (SEO polish, secondary analytics, tooling, coverage)

- [ ] [auto] FAQPage JSON-LD + answer-first content blocks on generated sites (+AI-citation weight).
- [ ] [auto] AN2 — geo enrichment at ingest (persist CF country/city/region per event).
- [ ] [auto] AN38 — cookieless-by-default + visible "No cookies · GDPR" privacy badge (differentiator).
- [ ] [auto] AN42 — one-click full data export (CSV) + delete for the owner.
- [ ] [auto] GDPR/EU data-residency `jurisdiction="eu"` binding option on D1/R2.
- [ ] [auto] pSEO for projectsites.dev itself (comparison / template / location pages).
- [ ] [auto] Public template/showcase gallery (social proof + pSEO surface).
- [ ] [auto] "Built with projectsites.dev" deploy badge → backlinks. *(served-site backlink already live.)*
- [ ] [auto] 100% unit coverage on remaining untested PURE worker modules (new `src/__tests__/<x>_unit.test.ts`).
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
