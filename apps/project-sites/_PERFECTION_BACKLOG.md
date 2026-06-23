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
- ✅ 2026-06-23 (fire 6) **measured BOTH surfaces w/ LCP-element capture.** Homepage HELD: **LCP=1281ms ✅, CLS=0.002 ✅, FCP=1281ms** (fire-5 fixes durable). The **generated site `megabytespace.projectsites.dev` is now the single worst metric: LCP=4820ms ❌, FCP=2812ms ❌, CLS=0.003 ✅** — LCP element = the React hero `<h1>.text-5xl.md:text-7xl.lg:text-8xl` ("Where Makers Build the Future"), `<div id="root">` EMPTY = CSR. **ROOT-CAUSED the FCP:** the worker injects an anti-FOUC `<style>` (`generateAntiFoucSnippet`) that sets `body{opacity:0}` until `.ps-fonts-ready`; that class is added by an inline script that is BLOCKED by the preceding render-blocking 7-weight Google-Fonts CSS — so the body stays hidden ~2.8s. **SHIPPED FIX (commit 8a5c3829):** worker `asyncifyRenderBlockingFonts()` in the serve path rewrites every Google-Fonts `<link rel="stylesheet">` → `media="print" onload="this.media='all'"` async (CSP-safe — served-site CSP has `'unsafe-inline'`). Helps EVERY generated site's FCP at serve time, no rebuild. Gated: tsc ✓ · 64 jest (6 new) ✓ · check:fitness ✓. Deployed via **CF CI** (local Docker daemon would not start; worker container-DO image build needs Docker → CF Workers Builds has it) + verified live (transform present on megabytespace). **PROD RE-MEASURE (3 runs, after deploy): FCP 2812 → ~2540ms (run1 outlier 3568), LCP ~4500-5700ms, CLS 0.003 ✅ (held), 0 console errors ✅.** ⚠️ HONEST RESULT: the async-font win was MARGINAL (~270ms FCP), NOT the big win expected. **Refined diagnosis:** the dominant FCP factor is the anti-FOUC `body{opacity:0}` gate's **1.5s safety-net** itself — the inline gate-lift script is *still* blocked by the render-blocking Vite CSS bundle (`/assets/index-*.css`), so the body reveals at ≈(CSS-bundle-ready ~1s) + 1.5s net ≈ 2.5s. Async-ing fonts removed one blocker but the CSS bundle + 1.5s net still set the floor. The fix was correct (a render-blocking request IS gone) but addressed a secondary lever.
- ⛔ 2026-06-23 (fire 7) **DEFINITIVE: generated-site CWV is fully BLOCKED on the template phase — worker serve-transforms are structurally powerless.** Shipped + deployed (CF CI, commit b939303a) the anti-FOUC body-reveal net cut 1500ms→300ms (CLS-safe; regression-guard test). **Prod re-measure: NO FCP movement** (FCP ~2620-2808ms, LCP ~4644-4912ms, CLS 0.002-0.003 ✅, 0 errors). **Root cause nailed via bundle sizing:** the render-blocking CSS is only **17KB br (~90ms)** — NOT the floor; the JS is **119KB br** (`type="module"`, deferred). `#root` is EMPTY → the site is pure CSR → **nothing contentful paints until React boots** (FCP≈2.6s = React's first render, LCP≈4.6s = hero `<h1>`). The anti-FOUC body reveals at ~700ms into an EMPTY body, so neither the fire-6 async-fonts nor the fire-7 net cut can move FCP/LCP — there is no static content to paint early. **CONCLUSION: stop worker-side micro-fixes for generated-site CWV; the ONLY lever is the template (app-shell static hero in `#root`, or SSG/prerender) so something paints before React.** The 300ms net is KEPT — it's harmless, removes a 1.5s body-hide anti-pattern, and is a PREREQUISITE so the future template app-shell actually paints fast (a 1.5s gate would re-hide it).
- 🟡 **generated-site LCP=4820ms = React CSR (hero `<h1>` paints only after the JS bundle boots).** The async-font fix above lowers FCP but NOT this LCP — the bottleneck is bundle download+parse. Durable fix = template-level **app-shell static hero** (mirror fire-5a inside the React `<div id="root">`, hero text injected at BUILD time) OR **SSG/prerender** of the homepage route. This is a credit-gated PHASE (template repo `github.com/HeyMegabyte/template.projectsites.dev` is cross-repo + a container rebuild costs API credits per CLAUDE's credit discipline) → SURFACE, never auto-run. Real hero captured for the app-shell: h1 `text-5xl md:text-7xl lg:text-8xl font-bold font-heading leading-[0.95] tracking-tight`, subtitle `text-lg md:text-xl text-white/55 max-w-2xl mx-auto`.
- 🔨 **NEXT (generated-site FCP) = fix the anti-FOUC `body{opacity:0}` 1.5s gate in `generateAntiFoucSnippet()` (`src/services/site_serving.ts:779`).** It hides the body until `.ps-fonts-ready`, added by an inline script that waits for the render-blocking Vite CSS bundle, THEN a `setTimeout(r,1500)` net → body reveals ≈2.5s = the FCP floor. ttfr-north-star says NEVER hide body for FOUC. Options (measure CLS each — currently 0.003 with huge headroom): (a) drop the `setTimeout` net from 1500→~0/100ms so reveal fires on first rAF after CSS (not +1.5s); (b) remove `body{opacity:0}` entirely and rely on `font-display:swap` (the swap CLS is negligible per the 0.003 reading) — but watch the `animation:none` freeze leaving opacity:0-entrance elements invisible; (c) inject metric-adjusted fallback `@font-face` (size-adjust) like the homepage so the swap is invisible without hiding. ⚠️ CUSTOMER-FACING (applies to every served site) → land behind a quick prod re-measure on megabytespace + 1-2 other live sites; revert via `wrangler rollback` if CLS regresses >0.05. This is the dominant FCP lever; the async-font change (fire 6) was secondary.
- ✅ 2026-06-23 (fire 8) **homepage FCP FIXED — the last homepage gap closed.** Root: production build had `optimization.styles.inlineCritical=false` (`angular.json:106`, set in a generic docs commit, not a perf decision) → the 189KB Angular `styles-*.css` bundle was render-blocking, pinning FCP at ~1349ms. Flipped to `true`: Angular's **beasties** (already a dep) inlines the above-the-fold critical CSS into `<head>` (~24KB — verified ALL app-shell hero classes present: text-4xl..7xl / bg-primary / rounded-2xl / font-heading / max-w-4xl / border-primary) and defers the bundle via `media="print" onload`. **Measured prod (3G/6×CPU, 4 runs): FCP 1349→443-492ms ✅, LCP 1349→443-570ms ✅, CLS 0.002 held ✅, 0 console errors.** Deferred-bundle `<link media="print">` confirmed live. (commit d9168abf) ⚠️ admin (`/admin/*`) shares this index.html → its styles now load via the deferred bundle (brief async style-apply on first authed load) — acceptable for an internal surface; verify on the next authed admin pass.
- ✅ 2026-06-23 (fire 9) **HOMEPAGE CWV TRACK COMPLETE — gate re-enabled.** Re-measured: homepage HELD all-green a 2nd fire (FCP 405-458ms · LCP 405-458ms · CLS 0.002 · 0 errors). Ran `ttfr.spec.ts` → PASS (LCP=456ms). **Wired `perf/ttfr.spec.ts` into `playwright.prod.config.ts` testMatch as a BLOCKING CWV gate** (commit 70f05e59) — a homepage regression (LCP>2000 / CLS>0.05 / FCP>1200) now fails the prod suite. Journey: LCP=9.4s (fire 3) → app-shell hero (fire 5) → async fonts (fire 5b) → critical-CSS inline (fire 8) → green gate (fire 9). The in-repo homepage track is DONE; remaining Dim-I work is the gated generated-site template phase + the optional admin/bundle items below. ✅ Verified the fire-8 `inlineCritical` change is SAFE on non-homepage routes: `/admin`→`/signin` (which loads via the now-deferred bundle) renders fully styled (body bg #060610, Sora font, 13 stylesheets applied, app-root 14KB content) with 0 console errors — no FOUC breakage, the deferred bundle applies cleanly.
- ✅ 2026-06-23 (fire 10) **whole marketing surface measured GREEN + CWV gate broadened.** Measured /developers /blog /pricing /contact /press: all **FCP ~406-497ms ✅, CLS 0.002 ✅, 0 errors** (the fire-8 critical-CSS inlining benefits the entire SPA shell, not just `/`). Transient gotcha diagnosed: a first /developers read showed FCP=4844ms / no-`media=print` / 25KB — a **stale 60s edge-cache** serve of a pre-fire-8 response (bare path; a `?query` cache-bust + warm fetch returned the correct 47KB inlineCritical HTML). `deploy-r2.mjs` already does `purge_everything:true`, so the purge is maximal — the stale was a bare-vs-query cache-key quirk, not a deploy bug; warming the routes resolved it. **Extended `ttfr.spec.ts` from homepage-only to also gate /developers /pricing /blog** (commit 3c6b6994) — verified 4 passed via the real prod config (homepage 654 · /developers 670 · /pricing 417 · /blog 571 ms). A route regression OR a stale-cache serve referencing deleted hashed assets now fails the prod suite. **The in-repo marketing CWV surface is fully green + gated; only the gated generated-site template phase remains.**
  - **THEN: generated-site templates** (the gated phase) — generated-site CWV is CSR-bound (fire 7 ⛔), only fixable by template app-shell/SSG (credit-gated rebuild + cross-repo `github.com/HeyMegabyte/template.projectsites.dev`). Surface for approval; the in-repo homepage track is now complete.
  - **Secondary homepage polish (optional, low-ROI now that FCP is ~460ms):** trim marketing fonts to Sora-only (Space Grotesk + JetBrains verified unused, fire-2) in the REAL `frontend/src/index.html`; ag-grid→TanStack perf-wave still shrinks the (now-deferred) bundle for admin.
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
