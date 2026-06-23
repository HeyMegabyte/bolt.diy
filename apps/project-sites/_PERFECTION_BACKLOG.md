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
- 🔴 **NEXT-WORST = homepage LCP 9.4s on 3G (P0) — ROOT-CAUSED 2026-06-21 (fire 4).** The marketing homepage is a CLIENT-SIDE-RENDERED Angular SPA: `marketing/index.html` line 339 is `<app-root></app-root>` (EMPTY until JS boots). LCP=9.4s = Angular bundle download (3G) + parse/execute (6×CPU) + render + the `.reveal` opacity:0→fade-in animations (lines 323-327). The real hero `<h1>` exists ONLY in `<noscript>` (line 347); with JS on, nothing paints until Angular hydrates. This is the ttfr-north-star "SSR/SSG mandatory" violation (CSR fails FCP/LCP on 3G). NOT a font/image issue (0 imgs, no Lottie/CDN scripts) — fires 1-2's font opts were orthogonal.
  - **FIX PATH A (intermediate, ship-first, ~1 fire):** app-shell — render a STATIC hero (the H1 + tagline + search-box skeleton, styled to match the Angular hero's box so no CLS) directly INSIDE `<app-root>...</app-root>` in `marketing/index.html`. Angular replaces the inner content on bootstrap, so the static hero paints at ~FCP (≈1.8s) → LCP drops from 9.4s to ~FCP. Match the hero's font-size/spacing to avoid layout shift; gate `prefers-reduced-motion`. Deploy to R2 + re-measure with the ttfr spec to PROVE LCP≤2.0s before claiming done.
  - **FIX PATH B (durable, P1, multi-fire):** Angular prerender/SSG of `/` (vite-ssg or `@angular/ssr` build → static HTML for the homepage route, served from R2). Eliminates CSR entirely. Bigger build-pipeline change — do after Path A proves the LCP win.
  - **Measurement tool ready:** `npx playwright test e2e/perf/ttfr.spec.ts --config playwright.prod.config.ts`. Flip it into playwright.prod.config testMatch as a BLOCKING gate once LCP≤2000 holds.
- 🔨 LCP≤2.0s / CLS≤0.05 / INP≤200ms on a published GENERATED site too (measure once homepage LCP is fixed); Lighthouse a11y≥95 perf≥75
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
