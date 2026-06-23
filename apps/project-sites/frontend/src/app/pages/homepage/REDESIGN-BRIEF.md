# Homepage Redesign Brief — projectsites.dev (customized + CC recommendations)

> The generic redesign prompt, customized to THIS repo's real stack + constraints,
> plus Claude Code's own recommendations. Drives the animated-storytelling homepage.

## Stack reality (do NOT migrate — use what's here)
- **Angular 21 standalone SPA**, signals, zoneless. Homepage = `homepage.component.{ts,html,scss}`.
- **Tailwind v4** + brand tokens: `--primary` #00e5ff (cyan), `--secondary` #7c3aed (purple),
  bg `#060610`/`--bg-primary:#0a0a1a`, `text-light` #f4f4ff, `text-text-secondary`, accent `#64ffda`.
  Font: **Sora** (`font-heading`).
- **Animation (already here — reuse, add ZERO deps):** `appReveal` (RevealDirective, scroll reveal),
  `psRipple` (RippleDirective), `<app-rolling-counter [value]>`, `<app-before-after-slider>`,
  `<app-trust-strip>`, classes `animate-fade-in-up/in/scale`, `animate-glow-pulse`, `animate-float`,
  View Transitions. **CSS transforms/opacity only.** Every animation gates `prefers-reduced-motion`.
- **Live business search already wired:** `heroQuery` + `onHeroSearch()` → `ApiService.searchBusinesses`
  → `results()` dropdown → `selectItem()` navigates to the claim/create flow. The hero "business
  lookup" IS the funnel entry — keep + feature it (this is the `data-cta="midpage-business-lookup"`).
- Methods to reuse: `goGetStarted()` (→ create/claim), `scrollTo(id)`, `goSignin()`, `isAuthed`,
  `toggleFaq()`/`openFaqIndex`, `heroHeadline/Subheadline/Cta()` (PostHog A/B — keep the override hooks).

## CWV / CC constraints (HARD — the 31-fire perf arc earned these; do not regress)
- **LCP 0.45s · FCP 0.46s · CLS 0.002 · INP 56-160ms · a11y 100 · SEO 100**, gated by `e2e/perf/ttfr.spec.ts`
  (blocking + daily CI `cwv-gate.yml`). A regression FAILS CI.
- The hero paints via a **static app-shell** in `frontend/src/index.html` (`<app-root>…</app-root>`) +
  **beasties inlineCritical** (`angular.json optimization.styles.inlineCritical:true`). **If the hero box
  changes, update the app-shell hero in index.html to match** (same Tailwind classes + copy + box height)
  or LCP/CLS regress.
- Below-fold sections: wrap in `appReveal` + lazy where heavy. No `<img>` without width/height (CLS).
  Brand images via the existing `/logo-*` assets; new visuals = CSS/SVG (no heavy raster, no autoplay video).
- a11y: real `<button>`/`<a>` (data-cta on them), `<h1>` once → `<h2>`/`<h3>` order, labels on inputs,
  24px tap targets, `:focus-visible` cyan ring, contrast ≥4.5:1.
- SEO: keep the per-route worker JSON-LD; FAQPage JSON-LD only when the FAQ is really rendered
  (already wired via `lib/json-ld` `faqPage`). Real H1/H2 in the app-shell for no-JS crawlers.

## Positioning (the spec)
"**We don't sell websites. We deliver them.**" — an AI website *delivery* platform (new category):
discover business → research → generate polished preview → owner **claims** → grows. Audiences: local
service, restaurant/nonprofit/community, creator/portfolio/donation.

## Narrative arc (section order)
Nav · **Hero** (animated "already being built/delivered" + mock-browser preview + business lookup) ·
business-lookup CTA strip · **Old way vs ProjectSites** · **Delivery engine** (Discover→Research→Generate→
Publish→Claim→Grow animated pipeline) · **Example previews** (3 verticals) · **What every site includes** ·
**Growth add-ons** · **How claiming works** · **Pricing/value** ($50/mo · $500/yr) · **Trust** (honest,
no fake testimonials) · **FAQ** · **Final cinematic CTA** · Footer.

## Tracking hooks (on the real interactive elements)
`data-cta="hero-claim" | "hero-how-it-works" | "hero-examples" | "midpage-business-lookup" |
"pricing-claim" | "final-claim"` + fire `TelemetryService` on click (already injected).

## Claude Code recommendations (my additions)
1. **Funnel telemetry, not just classes:** wire each `data-cta` to `telemetry.capture('cta_click',{id})`
   so conversion is measurable in PostHog — a homepage you can't measure can't be optimized.
2. **The hero IS the demo:** the live business-search dropdown already returns real businesses → make
   "type your business name → watch it get found → claim it" the hero interaction. Show the product
   working in the first screen instead of a static mock. (Mock-browser card = the *result* state.)
3. **Reduced-motion = full content parity:** every animated reveal must render its final state under
   `prefers-reduced-motion` (no opacity:0 traps — a known god-tier anti-pattern). The page must be 100%
   usable + complete with motion off.
4. **Ship CWV-safe in slices, gated:** rebuild section-by-section, `ng build` + the ttfr gate after each,
   so a regression is caught before deploy. Never ship a hero that drops LCP below the 0.45s baseline.
5. **Honest proof only:** "Built claim-first · Hosted on Cloudflare's edge · SEO/mobile/claim-ready" +
   real example-site previews. NO fabricated testimonials/logos (per copy-writing rules).
6. **i18n:** existing hero uses `| translate` (en/es). New sections ship English-direct now; mirror to
   `es.json` as a fast-follow (TODO) — don't block the redesign on full es translation.
7. **No new deps:** all motion via existing `appReveal`/CSS. If a "conveyor belt" needs more, use a
   CSS `@keyframes` marquee + `scroll-driven animations` (Chrome) with a reduced-motion fallback.
8. **Deploy + prove:** R2 `deploy-r2.mjs` → re-run ttfr gate on prod + Lighthouse a11y/SEO → 0 console
   errors → commit/push. Keep the `cwv-gate.yml` green.

## Execution order (CWV-safe slices)
S1 Hero (+ app-shell sync) → S2 Delivery-engine pipeline → S3 Old-way-vs-new → S4 Example previews →
S5 What's-included + Growth add-ons → S6 How-claiming-works → S7 Pricing → S8 Trust → S9 FAQ → S10 Final CTA.
Each slice: build → ttfr gate → deploy → verify → commit. This brief is the handoff for any slice done
in a fresh session.
