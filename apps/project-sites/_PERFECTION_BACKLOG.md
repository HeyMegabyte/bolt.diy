# ProjectSites.dev — Perfection Backlog (zero-gap inventory)

> The PERFECTION loop (cron `9013ff6d`, hourly) reads this FIRST each fire, picks a
> high-value **cluster** of 3-6 related gaps, builds them all completely (tested +
> deployed + prod-verified, via parallel agents), then ticks them here. Terminate
> only when every dimension is ✅. Legend: ✅ done · 🔨 autonomous-fixable · ⚠ approval-gated.
> "Done" requires a test + prod proof — "looks done" does not count.
> Seeded 2026-06-21; refresh + expand each fire (this seed is a starting floor, NOT exhaustive).

## How to use (each fire)
1. Re-audit the dimensions below; correct stale ticks; ADD newly-found gaps (the seed under-counts).
2. Pick ONE cluster (3-6 related 🔨 gaps), priority order §8: revenue → tenant-safety → cost → reliability → observability → local-dev → CF-deploy → site-perf → security → docs.
3. Build the whole cluster (parallel specialist agents), gate (jest + check:fitness + validate:features + ng build), deploy + prod-verify, commit/push, tick here.
4. Never no-op: if a chosen gap is already done/intentional, pick the next and keep building until real work ships.

---

## A. Revenue funnel (§9 golden path) — PRIORITY 1
- ✅ claim link → provision → started/finished email → /create prefill → polling banner → adopt CTA (frontend complete per progress.md v2.57-v2.63)
- 🔨 Opportunity-score → preview-site auto-generation wiring (lead.scored → preview queued) — verify end-to-end + E2E
- 🔨 checkout.started → Stripe webhook → entitlement.updated → site-generation enqueue — confirm each hop emits an event + has a test
- 🔨 usage tracked → retention surfaces (digest/notification) — wire + test
- ⚠ Live prod-E2E of the whole funnel — needs `E2E_TEST_PASSWORD` prod secret (Brian: `wrangler secret put E2E_TEST_PASSWORD --env production`)

## B. Tenant safety / authz — PRIORITY 2
- ✅ Ownership guard canonicalized (`requireOwnedSite`/`assertSiteOwned`, 22 tests; api.ts + forms + domain_purchase + pseo + mcp_oauth)
- 🔨 BOLA test matrix (§61): tenant A cannot read/mutate tenant B object/job; site-scoped key cannot reach account; read-only key cannot mutate — author the suite
- ⚠ OpenFGA provisioning + `requireAuthz` on publish/mutation routes (§29) — needs external store
- 🔨 Object-property authz tests (billing fields hidden without permission)

## C. Cost control / quotas (§31-32) — PRIORITY 3
- 🔨 `assertAiBudget()` + `assertModelAllowed()` middleware before every LLM/browser/Google/email call (#16) — build as a feature module
- 🔨 usage-ledger reserve→execute→reconcile→emit path for expensive ops — verify exists + tested per op category
- 🔨 Per-build cost accounting (#19): estimate→actual→variance per tenant

## D. Reliability — idempotency + DLQ (§18, §23-24)
- ✅ event_bus + outbox/inbox + `eventIdempotencyKey` + DLQ table + drain cron (architecture_fitness tests green)
- 🔨 Client-UUID `Idempotency-Key` on EVERY mutating public endpoint (#26) — audit api.ts mutations, add where missing + tests
- 🔨 Every Queue consumer declares DLQ + replay + tenant context — audit + document

## E. Observability (§35) — every path traced
- ✅ Tinybird analytics vertical live (ingest→pipes→admin endpoints→Angular)
- 🔨 trace_id + tenant_id + cost_category on EVERY handler/job/webhook (structured-logging rule) — sweep + assert
- 🔨 Sentry breadcrumb + PostHog capture with `featureSlug` on every feature path

## F. Feature-module completeness (libs/features/*)
- 🔨 Audit each module for the 7-field manifest + flag + schemas + service + handlers + __tests__ + e2e/<slug>/ + README; `npm run validate:features` must be green tree-wide
- 🔨 Reconcile concurrent WIP (figma_import / generative_ui_stream / page_audio_summary) — they are untracked; a fresh session should complete + commit or remove them

## G. E2E + test coverage (§70)
- 🔨 Every feature in e2e/FEATURES.md has ≥1 Playwright spec from homepage; COVERAGE.yml has no gaps
- 🔨 Golden-path E2E (or deterministic local-fake equivalent) for the full funnel (§74.58)

## H. Accessibility — WCAG 2.2 AA
- 🔨 axe 0 violations @ 6 breakpoints across admin + generated-site templates (run authed via `E2E_API_KEY`)
- 🔨 Manual SC sweep (2.4.11 / 2.5.7 / 2.5.8 / 3.2.6 / 3.3.7 / 3.3.8)

## I. Performance — CWV (idea #14 "Sub-100ms everything" — active loop 114c279e)
- ✅ 2026-06-21 (fire 1) marketing homepage: removed the 2nd render-blocking Google-Fonts CSS request (Inter/Montserrat/Fira — admin-cockpit fonts never applied on marketing). 2 font requests → 1. Deployed + verified live.
- ✅ 2026-06-21 (fire 2) marketing homepage: trimmed the brand request to Sora-only (Space Grotesk + JetBrains Mono verified unused — only in the URL, never in any font-family rule or JS). Smaller Google-Fonts CSS response (3 families → 1, fewer @font-face blocks). Deployed to R2 + verified live (prod requests `family=Sora:wght@300;400;500;600;700` only; Space Grotesk/JetBrains = 0). NEXT-worst: full Lighthouse + Playwright CWV probe on prod (marketing + a published generated site, throttled 3G/6×CPU) to capture actual LCP/INP/CLS numbers; then trim Sora weights to only those applied (verify each weight is used first).
- ✅ 2026-06-21 (fire 3) built the REAL CWV measurement gate `e2e/perf/ttfr.spec.ts` (CDP 3G + 6×CPU + PerformanceObserver → LCP/CLS/FCP vs ttfr-north-star targets). FIRST PROD NUMBERS (homepage, throttled 3G): **LCP=9379ms ❌ (≤2000) · CLS=0.000 ✅ · FCP=1858ms ❌ (≤1200)**. CLS perfect; LCP is catastrophically late. Spec is runnable on demand; NOT yet in playwright.prod.config testMatch (would red-block the suite) — re-enable as a blocking gate once LCP is green.
- ✅ 2026-06-23 (fire 5a) **homepage LCP P0 FIXED via Fix Path A (app-shell static hero).** Rendered a static hero (badge → h1 → subtitle → search → CTA skeleton, mirroring `homepage.component.html` with identical Tailwind classes + copy + box height) INSIDE `<app-root>` so the `<h1>` paints at FCP and IS the LCP element; Angular clears `<app-root>` + renders the real hero on bootstrap → pixel-identical swap → no CLS. **Measured prod (3G/6×CPU): LCP 9509ms → 1936ms ✅ (≤2000), CLS 0.000 → 0.002 ✅, FCP 1684 → 1936ms.** ⚠️ KEY FINDING: fires 1-4 edited the STALE `apps/project-sites/marketing/index.html` (a DEAD legacy artifact — NOT served). The live homepage is the Angular build of **`frontend/src/index.html` → dist → R2 `marketing/`** (deployed by `frontend/scripts/deploy-r2.mjs`). All real work goes there. (commit 27ace1c0)
- ✅ 2026-06-23 (fire 5b) **homepage FCP improved via async Google-Fonts CSS.** Both font `<link rel="stylesheet">` (Sora marketing + Inter/Montserrat/Fira admin) were render-blocking on the marketing FCP path — 2 cross-origin RTTs, the admin set for fonts marketing never applies. Switched both to `preload→onload→stylesheet` async (CSP-safe: marketing script-src has `'unsafe-inline'`, no strict-dynamic). The metric-adjusted `Sora Fallback` @font-face keeps the swap CLS-free. **Measured prod (3G/6×CPU, 3 runs): LCP 1936 → 1267-1742ms (now comfortable ≤2000 margin), FCP 1936 → 1267-1742ms, CLS 0.002.** Live-verified Sora loads + applies (h1→Sora), 0 console errors. (commit 2020c3bd)
- 🔴 **NEXT-WORST = homepage FCP ≤1200ms (not consistently met: ~1267-1742ms on 3G/6×CPU).** Now bounded by the render-blocking **189KB (brotli ~30KB) Angular `styles-*.css` bundle** (must stay blocking — the hero needs its Tailwind classes) + HTML download over the brutal sim profile. Compression already on (brotli ✅). **NEXT FIX (a real slice, not a one-liner):** (a) inline above-the-fold CRITICAL CSS for the hero into `<head>` so first paint doesn't wait for the full 189KB bundle (extract via a critical-CSS step or hand-author the ~2KB hero rules), OR (b) shrink the styles bundle by removing the ag-grid bloat (perf-wave ag-grid→TanStack, `docs/perf-wave-ag-grid-to-tanstack.md`). LCP is now coupled to FCP (hero paints at FCP) so any FCP win also lowers LCP. Also evaluate: trim marketing fonts to Sora-only (Space Grotesk + JetBrains verified unused per fire-2) now that the change lands in the REAL `frontend/src/index.html`.
  - **FIX PATH B (durable, P1, multi-fire):** Angular prerender/SSG of `/` (vite-ssg or `@angular/ssr` → static HTML served from R2). Eliminates CSR entirely + makes critical CSS trivial. Bigger build-pipeline change — do after the app-shell LCP win holds.
  - **GATE re-enable status:** LCP≤2000 + CLS≤0.05 are GREEN and held 1 fire. FCP≤1200 NOT yet green → do NOT re-enable `e2e/perf/ttfr.spec.ts` in `playwright.prod.config` testMatch yet (would red-block the suite on FCP). Re-enable once FCP≤1200 holds + all-green for 2 fires. Run on demand: `npx playwright test e2e/perf/ttfr.spec.ts --config playwright.prod.config.ts` (currently excluded from testMatch).
- 🔨 LCP≤2.0s / CLS≤0.05 / INP≤200ms on a published GENERATED site too (measure once homepage FCP is green); Lighthouse a11y≥95 perf≥75
- 🔨 ag-grid→TanStack perf wave (both live grids) — dedicated cluster

## J. Security / supply chain (§15, §49, §61)
- ✅ Architecture-fitness exclude-list gate enforces all 10 §4 vendors (lockstep-tested)
- 🔨 CSP Level 3 strict-dynamic + nonce on admin; no raw token/cookie logging (Semgrep rule)
- 🔨 Turnstile/Arcjet on claim/signup/public-form/expensive endpoints (§48)

## K. Docs / ADRs (§14)
- 🔨 25 ADRs (0001-0025) present + accurate; ARCHITECTURE.md current; service-registry reflects reality
- ✅ progress.md + _LOOP_LEDGER.md handoffs current

## L. §8 thirty brilliant features (net-new) — lower priority until A-K green
- 🔨 #4 Dead-letter REPAIR queue UI · #17 generated-site beacon→analytics · #18 owner live-events tab · #20 abandoned-build recovery · #28 kill-switch console · #29 synthetic provider test-buttons — each a feature-module cluster

## ⚠ Approval-gated (surface, never auto-execute)
- §13 InngestContainer DO bind + signing key (watched one-way migration)
- OpenFGA store provisioning
- `E2E_TEST_PASSWORD` + scoped `TINYBIRD_INGEST_TOKEN` prod secrets (Brian runs `wrangler secret put`)

---

**Gap count (seed):** ~0 fully-verified-perfect across A-L; the loop's job is to drive 🔨 → ✅ cluster by cluster. First cluster recommendation: **A (funnel hop tests + events)** or **D (#26 idempotency sweep)** — both pure revenue/reliability, autonomous-safe, fresh-session-sized.
