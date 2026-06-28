# ProjectSites.dev — THE Single TODO

> **⚑ THE ONE running TODO list (consolidated 2026-06-28).** Every backlog/requirement/idea
> file was folded in here + DELETED: `ROADMAP.md`, `TEST-PLAN.md`, `FEATURE_CATALOG.md`,
> `_CONVERGENCE.prompt.md`, `docs/FEATURE-IDEAS.md`, `docs/REQUIREMENTS.md`, `docs/STACK.md`,
> `docs/CURATED-BACKLOG.md`, `.claude/RECS.md`. Low-value / covered-by-something-better items
> were removed (they live on in git history). Sorted by importance — top = do first.
>
> **The finishing-loop cron drains this file.** `scripts/loop-done-check.sh` counts unchecked
> `- [ ] … [auto]` lines = the autonomous work remaining. `[auto]` = loop builds it;
> `[gated]` = needs Brian (in `## ⛔ NEEDS BRIAN`, never blocks DONE); `[dedicated]` = real but
> needs a supervised focused session. Legend: `[ ]` open · `[x]` done. Close one, tick it, commit, next.
> Shipped-work proof = `git log` + prior revisions. `_LOOP_PROGRESS.md` holds only the loop's
> runtime GATE state (not a TODO list).

---

## 🚨 P0 — Urgent (bugs / risk / margin — before features)

- [ ] [auto] **Cross-tenant publish vuln** — `content.ts` `approve`/`publishRewriteDraft` doesn't thread `expectedOrgId`; one org can publish into another. Regression test + fix.
- [ ] [auto] **Tenant `org_id` scoping audit** — sweep the 153 flat services' D1 queries for missing org scoping (cross-tenant read/write surface).
- [ ] [auto] **Margin leak** — force AI-Gateway on every model call + swap GPT-4o vision→Workers-AI where adequate + cache research/brand/assets per business (rebuild skips re-research, ~15→5 min).

## 1. Conversion & activation (highest $)

- [ ] [auto] Anonymous first-generation before signup — let visitors generate a build before the wall (biggest activation lever).
- [ ] [auto] One-click "Claim this site" → inline Stripe checkout (collapse adopt→pay).
- [ ] [auto] Abandoned-build recovery email — build-started-never-claimed → nudge w/ preview link.
- [ ] [auto] Contextual upgrade prompts at the friction moment (custom domain / remove top-bar / more pages).
- [ ] [auto] Instrument golden-path funnel in PostHog (search→signin→build→preview→claim→pay + drop-off cohorts).
- [ ] [auto] Streaming live-preview during build (render-as-it-generates, not a polling spinner).
- [ ] [auto] Live agentic action trail during site-gen (stream each Workflow step, for trust).

## 2. Generated-site quality moat (protects the subscription)

- [ ] [auto] Eval harness scoring every generated build (GPT-4o vision + Lighthouse + SEO, regression-tracked).
- [ ] [auto] Per-section AI-vision auto-reroll (<8/10 → regenerate).
- [ ] [auto] AI competitor-gap scan at build — score 5 peer sites, propose missing sections.
- [ ] [auto] A11y autofixer + AI alt-text — axe findings fixed pre-publish (ADA legal-risk reducer).
- [ ] [auto] 1:N sitemap fidelity guard wired into the live pipeline (fail on collapsed page counts).
- [ ] [auto] Flip `build_validators` report→strict (enforce the 13 quality invariants).
- [ ] [auto] Source-site theme-polarity preservation guard (don't flip a polished light site to dark). — decision logic SHIPPED 2026-06-28 (`services/theme_polarity.ts`: `resolveThemePolarity`/`relativeLuminance`/`contrastRatio` + 13 unit tests green, CI-deployed); remaining = stamp `theme`/`preserveSourceDesign` onto the container-produced `_brand.json` (skill-15 brand step) + post-build `validateThemePolarity` guard — both build-gated.
- [ ] [auto] Logo/font/color extraction fidelity (the suped-up-clone lever).

## 3. Reliability & correctness (trust + don't double-bill)

- [ ] [auto] General `Idempotency-Key` middleware on all mutations (only Stripe webhooks dedupe today).
- [ ] [auto] Finish event-bus → outbox → DLQ → retry loop for durable money/build events.
- [ ] [auto] Container build retry/DLQ on failure (capture/replay, not a silent error-email).
- [ ] [auto] Sentry on remaining worker critical paths (build-status callback, billing, workflow steps).
- [ ] [auto] traceId + tenantId correlation across the pipeline.
- [ ] [auto] Auto-rollback wired to a post-deploy error-rate/LCP watcher.
- [ ] [auto] Admin "build health" dashboard (success rate, p95 build time, failure reasons).

## 4. Apps marketplace — paid managed-hosting (Tier A0 trust first)

- [ ] [auto] A1 — per-instance automated backups + 1-click restore (Neon branch-snapshot + R2 versioning).
- [ ] [auto] A2 — true live cost meter per instance (DO compute + Neon + Upstash + R2 egress; replace static estCostMonthly).
- [ ] [auto] A3 — health-driven auto-heal + real status timeline (up/restarting/crashed/hibernated + last-error).
- [ ] [auto] A4 — pre-provision dry-run + cost preview + confirm gate (never silently provision billable infra).
- [ ] [auto] A6 — per-instance custom domain + auto-TLS (CF-for-SaaS custom hostname).
- [ ] [auto] A7 — resource sizing tiers at deploy + live upsizing (the core paid lever).
- [ ] [auto] A13 — category landing pages + per-category `SoftwareApplication` JSON-LD (organic discovery).
- [ ] [auto] A18 — public app profile pages (indexable `/apps/:slug` + "Deploy to ProjectSites" button).
- [ ] A19 — guest-browsable admin (read-only /admin for guests; gated actions pop login). ⛔ PARKED → NEEDS BRIAN: exposing the whole tenant `/admin` read-only to ANONYMOUS visitors is a data-exposure/privacy posture call — which sections/fields are safe unauthenticated vs must stay gated. (de-tagged from the auto-gate)
- [ ] [auto] A21 — referral / org-to-org "share this stack" deploy link (viral loop).

## 5. Snapshots — viral previews + stop the lying UI

- [ ] [auto] S1 — real Lighthouse/CWV scores (run in the build container; the matrix cells are permanently NULL today = P0 honesty bug).
- [ ] [auto] S2 — real axe-core a11y (replace the fake `img:not([alt])` proxy).
- [ ] [auto] S4 — unify rollback (collapse the two divergent restore paths into the complete one).
- [ ] [auto] S17 — undo-publish window (one-tap revert toast ~5 min after every publish).
- [ ] [auto] S22 — immutable stable preview URLs (`{slug}-{snapshot}.projectsites.dev` permanent + shareable).
- [ ] [auto] S23 — "Built with ProjectSites" footer on unauth previews (the link IS the ad).
- [ ] [auto] S24 — "Build your own" CTA for anonymous preview viewers.
- [ ] [auto] S27 — Client Review Mode (Approve promotes the snapshot live; agency-tier feature).
- [ ] [auto] S39 — scheduled publish + auto-revert-after-48h (Pro upsell).

## 6. Owner analytics — drive action (vs Wix/GA4)

- [ ] [auto] AN3 — unified owner-analytics query service (one API over the six backends; unblocks every widget).
- [ ] [auto] AN12 — conversions/goals: owner-named outcomes + count + rate (rate shipped; naming UI + goals table remain).
- [ ] [auto] AN17 — form analytics: completion rate + abandonment per form (bridges pageview→lead).
- [ ] [auto] AN18 — click-to-call & directions tracking (phone IS the service-biz conversion).
- [ ] [auto] AN19 — per-site funnel (landing → key page → conversion), owner-scoped.
- [ ] [auto] AN23 — weekly email digest (Monday auto-summary via SES+Listmonk).
- [ ] [auto] AN26 — section-level instrumentation (auto-inject stable `data-ps-section`).
- [ ] [auto] AN27 — section-level attribution query + UI ("Services section drives 40% of calls") — the moat.
- [ ] [auto] AN29 — natural-language analytics query ("visitors from Instagram last week?") — builder-only moat.
- [ ] [auto] AN48 — public shareable read-only dashboard URL (token + optional expiry).
- [ ] [auto] AN49 — year-in-review auto report (retention loop).
- [ ] [auto] AN50 — benchmark vs fleet median ("your form converts 1.2% vs 3.4% category avg").
- [ ] [auto] AN2 — geo enrichment at ingest (persist CF country/city/region per event).
- [ ] [auto] AN38 — cookieless-by-default + visible "No cookies · GDPR" privacy badge (differentiator).
- [ ] [auto] AN42 — one-click full data export (CSV) + delete for the owner.
- [ ] [auto] AN54 — operator zero-state honesty (super-admin Tinybird routes silently return empty — surface "no data yet").

## 7. P1 revenue epics (build deliberately, multi-session)

- [ ] [auto] Native booking engine (catalog-confirmed missing) — paid retention.
- [ ] [auto] Inject visitor AI concierge into published sites (retention).
- [ ] [auto] Edge per-visitor personalization (hero/CTA swap).
- [ ] [auto] AI-native GEO layer + citation tracking (AI-search moat; aeo_pass).
- [ ] [auto] Post-publish autonomous growth agent.
- [ ] [auto] `psnotify` — custom notification engine (DO inbox + center + per-channel prefs + multi-channel) wired to build/deploy/domain/billing + Apps lifecycle. NEVER Novu.

## 8. Hardening — forms / social / infra / security

- [ ] [auto] Form reply-deliverability guardrails (run SPF/DKIM check before reply). *(rate-limit, field-escape, Zod contract on the contact form = already DONE.)*
- [ ] [auto] Social (Pulse) LIVE DEFECTS — fix hardcoded media domain in `social-publish.ts prepareMedia` (breaks media for custom-domain tenants; use primary hostname / signed R2 URL) · bump stale `REAL_UA` Chrome 131→149 in `social_publishers/types.ts` · add `social_*` feature flags · OAuth token-refresh lifecycle.
- [ ] [auto] Social (Pulse) hardening — rate-limit + quota alert, failed-post retry UX, brand-voice profile, per-platform reformat.
- [ ] [auto] Pulse Inbox AI — wire `summarizeConversation` + `suggestNextActions` into the inbox UI; `repurpose` + `translateContent` (per-account locale) entry-points; expose auto-reply confidence threshold in settings; backfill `social_analytics_snapshots` at deploy.
- [ ] [auto] R2 Standard→Infrequent-Access lifecycle after 30d (margin).
- [ ] [auto] Enable Cloudflare Queues for async fan-out off the request path (p99).
- [ ] [auto] SSRF allowlist on remaining user-URL-fetch routes (og-preview/import-rss/social).
- [ ] [auto] CSP L3 strict-dynamic + nonce + Trusted Types on the worker AND generated output sites.
- [ ] [auto] Secret-at-rest audit (MCP_ENCRYPTION_KEY + env-var AES-GCM) + rotation story.
- [ ] [auto] GDPR/EU data-residency `jurisdiction="eu"` binding option on D1/R2.
- [ ] [auto] WCAG 2.2 AA — close the 6 new criteria on admin + generated sites (the box-tap-target ≥24px one is gated on E2E_TEST_PASSWORD — see NEEDS BRIAN).

## 9. SEO/GEO + marketing growth

- [ ] [auto] FAQPage JSON-LD + answer-first content blocks on generated sites (+AI-citation weight).
- [ ] [auto] pSEO for projectsites.dev itself (comparison / template / location pages).
- [ ] [auto] Public template/showcase gallery (social proof + pSEO surface).
- [ ] [auto] "Built with projectsites.dev" deploy badge → backlinks. *(served-site backlink already live.)*

## 10. Tooling adoption (only those that earn it)

- [ ] [auto] Migrate worker Jest → **Vitest** (kills the `@swc/jest` module-mock anomalies).
- [ ] [auto] **schema-dts** (typed JSON-LD) + **html-validate** (generated-HTML build gate) + **Pagefind** (client search on >12-route sites) + **workers-og/Satori** (edge OG cards).
- [ ] [auto] **promptfoo** (prompt eval + injection red-team) + **Arcjet** (bot/rate-limit/PII as code).
- [ ] [auto] **DOMPurify** required on all customer/generated/imported HTML.
- [ ] [auto] **Drizzle ORM (RQBv2)** for type-safe D1 + migrations (replaces hand SQL incrementally).
- [ ] [auto] **Knip** cleanup pass (44 known dead exports + unused deps/files).
- [ ] [auto] Replace Firecrawl with **Deepcrawl** as the approved site-context extractor.
- [ ] [dedicated] **Puck** visual page/block builder + **OpenFGA** authz model (orgs/sites/roles/agents) — each a focused session.

## 11. Testing & coverage

- [ ] [auto] 100% unit coverage on remaining untested PURE worker modules (test-writer agents; new `src/__tests__/<x>_unit.test.ts`).
- [ ] [auto] Per-section E2E coverage — every admin section + generated-site surface (see `e2e/FEATURES.md`); wire `*.e2e.ts` prod suite into CI.

## 12. Frontend performance wave (supervised — one dedicated session)

- [ ] [dedicated] Perf wave (all-or-nothing ~30h, supervised): ag-grid→TanStack on both admin grids · zoneless CD · SSR/SSG marketing shell · OnPush on 104 components · `@defer` below-fold · INP <150ms · fix ~30 `.subscribe()` leaks · `@Input()`→signal `input()` · `@ngx-translate`→`@angular/localize` · design-token (hardcoded-hex) drift · bundle-split Monaco/ECharts/Uppy.

---

## ⛔ NEEDS BRIAN (human-gated — NOT `[auto]`, does NOT block DONE)

> The loop cannot finish these alone. Each names the ONE decision/action required. The DONE
> gate ignores these; they're the clean handoff of everything that genuinely needs a human.

- [ ] [gated] **Provision `E2E_TEST_PASSWORD`** — `wrangler secret put` (prod) + `.dev.vars`. ~1h, unlocks authed prod-E2E across the whole money path (sign-in→admin→billing→publish). Smallest unblock, highest leverage.
- [x] **Voice go-live (V0g) — DONE / LIVE 2026-06-28** (executed HEADLESS, NOT browser-gated — [[voice-go-live-is-autonomous]]): agent `CA_dSUDxEC3EiP6` v`fo8t4SrN3djS` **Running** + worker `CAW_sEtM6J6svCqz` registered (LiveKit Cloud US-East-B); Twilio Elastic SIP `TK8a9bd5b4` → LiveKit SIP `ST_KtiKpXJdP96E` + dispatch `SDR_VJa7PFhoztW6`; worker LiteLLM secrets + WAF skip `/internal/voice/*` (signed config 200, Megabyte Labs, model `gpt`); +12626864783 → answers. First build stuck on a stub package-lock (npm-ci fail); clean redeploy fixed it. Remaining carrier polish: STIR/SHAKEN (V28), port-in (V32).
- [ ] [gated] **Case-study pages** — featuring a real named org (njsk.org) needs THEIR consent + approved logo/copy use. Decision: which consenting builds may be published.
- [ ] [gated] **Pricing one-way doors** — free/Pro split (AN52), snapshot retention tiers (S45), AI-insight credits metering (AN53), 3rd-party paid app tier (A22), Lago usage metering. Loop proposes + wires; Brian sets prices.
- [ ] [gated] **Notification vendor** — confirm `psnotify` (the ZERO-Novu rule) so the Novu/Dittofeed drift is deleted and it's built.
- [ ] [gated] **Operator-key activations** — flip built-dark modules once keys/WAF set: observability gateway (Sentry/PostHog ingest + WAF allow-rule), referral loop, lead-scanner outreach (explicitly-enabled), CF WAF + rate-limit on /monitoring/*, Cloudflare Images, GBP OAuth connect, local-rank/review monitoring, EU data-residency.
- [ ] [gated] **Enterprise auth** — self-host Better Auth OSS on CF Containers + SCIM provisioning (verify Better Auth SCIM vs Authentik first).

---

## History

Shipped work + full proof prose = `git log` and prior revisions of this file (the old multi-hundred-line iteration log was archived to git on 2026-06-28). Recently shipped: #20 build-cap, #29 GDPR Art.17 cascade, #36 abuse-takedown, #45 onboarding-copilot, #48 built-with badge, #49 marketing GEO, AN6 owner-analytics route, V0b voice number-resolver, V33 AI disclosure, SSRF + bot-gate hardening, speculation-rules, #44 owner-analytics dashboard.
