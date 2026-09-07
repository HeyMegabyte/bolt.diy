# ProjectSites.dev — App Completion Map (Definition of Done)

The **terminal target** the scheduled `/loop` crons converge on. "Finish the entire application"
= every box below `[x]` AND verified green on **PROD, headless, real-browser** for ≥2 consecutive
fires of its owning loop.

**Every loop fire MUST:** (1) read this map, (2) advance the highest-value UNCHECKED item **in its
lane**, (3) tick it + record the proof (commit sha + probe name), (4) recompute the lane % + overall
% at the bottom. A lane that is all `[x]` + green ⇒ its loop is **maintenance-only** (a healthy
no-op is correct, not a shortcoming — `convergence-loop-never-stops` healthy-iteration). This map is
the whole-app peer of `_LOOP_LEDGER.md` (per-fire log) and loop.md's `refactor-state.md` (element
coverage matrix).

---

## Scheduled loop roster (who owns what)

| Loop | Cadence | Lane it drives to done |
|---|---|---|
| **ADMIN INTEGRITY** | every 30 min | § A render+a11y · truthful-data · truthful-mutations |
| **ADMIN COMPLETENESS** | every 2 h | § A real-journeys · edge-states · contract · controls · editor tabs |
| **ADMIN QUALITY** | daily | § A perf · security · polish/docs |
| **FULL JOURNEY (golden)** | every 8 h | § B.2 create→build→publish→view→analytics + admin propagation + template |
| **FULL-FLOW E2E (headless prod)** ⟵ NEW | every 6 h | § B.1/B.4–B.7 the flows AROUND the golden path (guest funnel, billing-full, editor round-trip, auth) |
| **GENERATED-SITE QUALITY (prod audit)** ⟵ NEW | every 12 h | § C the core product (deployed sites) + § D platform marketing |

---

## § A — Admin dashboard (Angular SPA) · OWNER: INTEGRITY + COMPLETENESS + QUALITY
**Status: ✅ verified plateau** — 23 sections, 35-probe headless-prod suite (`e2e/admin-verify/run-all.mjs`) green (**35 pass · 0 skip · 0 fail**, AL-128 2026-09-07 — all Browserbase creds auto-resolve via get-secret, zero skips).
- [x] Render+a11y — surf @1280+@390 CLEAN · focus-not-obscured (2.4.11) · target-size (2.5.8) · modal-a11y (open dialogs) — 0 violations
- [x] Truthful data — reconcile-counts, 9 surfaces, display==store (exact active-on-live predicate)
- [x] Truthful mutations — 9 causal write→read-back probes persist (no lying-success / dropped write)
- [x] Completeness — 23/23 sections, no stub/dead-control/soft-404 (completeness-stub-scan) + contract
- [x] Editor Functions + Data workbench tabs — real `functions/` + D1 (AL-004/018/038/060), NOT mock
- [x] Perf / security / polish — ADMIN QUALITY loop (maintenance)

## § B — Full user flows · headless PROD E2E · OWNER: FULL JOURNEY + FULL-FLOW
*The explicit "production (preferably headless) testing of full user flows" mandate. Each ⇒ a durable probe under `e2e/admin-verify/` wired into `run-all.mjs`.*
- [x] **B.1 Guest acquisition funnel** — homepage `/` → search a real business → results render → `/create` entry (UNAUTH, real-browser, 0 console errors + operable). *(verify-guest-funnel.mjs, AL-089 — homepage "Skip the agency. Ship in 4 minutes." + search results + create CTA → /create wizard renders)*
- [x] **B.2 Authed create→build→publish** — seed session → `/create` real business → build to `published` → `{slug}.projectsites.dev` loads real H1 + 0 console errors. *(FULL JOURNEY — keep green; the build IS the authorized acceptance test)*
- [x] **B.3 Analytics causal** — visit published site → `/admin` analytics shows the pageview (display==D1). *(verify-analytics-visit-count-causal)*
- [x] **B.3b Contact-form → /admin/forms** — real submit → appears. *(verify-beacon-funnel-causal)*
- [x] **B.3c MCP connect → active** — *(verify-mcp-connect-causal)*
- [x] **B.4 Billing checkout MOUNTS** — embedded Stripe iframe mounts. *(verify-billing-checkout, local Chromium)*
- [x] **B.5 Billing FULL** — money flow LIVE + SECURE over its headless envelope on prod (AL-111, `verify-billing-full-flow.mjs`, wired into run-all): checkout session create → 200 + `cs_live_`/`pk_live_` · webhook UNSIGNED + BAD-SIG → 401 (unspoofable) · subscription STILL free after spoof (rejected ≠ mutated) · entitlements honestly LOCKED at free · portal → live `billing.stripe.com` URL. **Out of headless scope (prod is Stripe LIVE-mode):** the real-card → `checkout.session.completed` → subscription `active` → entitlement unlock leg can't run headless (a test card is rejected in live mode; a real charge is approval-required) — that leg is covered by the webhook-handler unit test (`billing_webhook_activation.test.ts`, 6/6: plan=paid/status=active + downgrade-to-free). Same shape as B.7's emailed-token caveat. **Vision-inspect fixed a lying-UI** (display==store): the Free card promised "1 custom domain" but the resolver locks free to 0 (`domain_entitlement.ts`) → copy corrected to "Free projectsites.dev subdomain", shipped to R2 + real-browser-verified. **Also root-fixed the R2 deploy verify** (was size-only → blind to a same-size stale `index.html`; now content-verifies HTML entries).*
- [x] **B.6 Editor round-trip** — headless envelope proven (AL-127, `verify-editor-roundtrip.mjs`, wired into run-all): READ leg — the editor bootstraps from `GET /api/sites/by-slug/:slug/chat` → 200 + real bolt chat schema (2 msgs) for an owned site · PUBLISH SECURITY — `POST /api/sites/:id/publish-bolt` is auth-gated (unauth→401), org-scoped (foreign id→404, no cross-org publish), body-slug-ignored (uses OWNED slug — guards publish-body-slug IDOR), input-validated (empty files→400); every rejection fires BEFORE any R2 write (non-mutating probe). **Verify-before-implement caught a false-IDOR:** foreign `/chat` returns 200, but that is BY DESIGN — `/chat`, `/build-context`, `/files` are documented PUBLIC-BY-SLUG (`@auth NONE`; slug + R2 obscurity is the token; they reconstruct what `{slug}.projectsites.dev` already serves publicly; the editor reads them cross-origin with `ACAO:*`). Org-scoping them would BREAK the editor bootstrap → NOT a bug, not "fixed". **Out of headless scope:** the full WebContainer UI drive (editor.projectsites.dev iframe, ~30-60s boot) + a real mutating publish (may invoke the functions container) → Browserbase + $-gated, same shape as B.5's real-card leg. *(FULL-FLOW)*
- [x] **B.7 Auth** — magic-link request→verify-fail-safe + Google OAuth init well-formed (headless-verifiable portions; the emailed-click token consumption needs the peek seam / a human inbox — out of headless scope). *(verify-auth-flow.mjs, AL-094 — 7/7 on prod: request 200+expiry · Zod 400 · verify missing/bad-token 302 fail-safe · Google 302 client_id+redirect_uri+scope+CSRF-state · callback graceful · me→401)*

## § C — Generated-site QUALITY (the CORE PRODUCT) · headless PROD audit · OWNER: GENERATED-SITE QUALITY
*Audit DEPLOYED `{slug}.projectsites.dev` (vanta-strength-austin · ironhaus-houston · vantage-digital-studio-portland). Fix at ROOT CAUSE in the TEMPLATE (`github.com/HeyMegabyte/template.projectsites.dev`, lands next build) or the site-gen prompt / `build_validators.ts` — never a one-off. Ship a durable probe under `e2e/site-quality/` wired into run-all.*
- [x] **C.1 build_validators invariants — ROOT FIX SHIPPED (AL-110), lands next build** — required files, asset existence, meta 50-60 / 120-156, JSON-LD ≥4 accurate blocks, single H1, no banned-slop. **Ground truth (2026-09-07): deployed sites ship ZERO real JSON-LD blocks (the template carries the "open-now" CONSUMER widget that reads `script[type=application/ld+json]` but the build never EMITS the data — the probe's marker count reported a false "1"), sub-120 descriptions, and `\'` JS-escapes leaking into meta. Report-mode validators logged it, never blocked → shipped live. Fixed at ROOT: `finalizeSeoInvariants(files, ctx)` in `build_validators.ts` — a deterministic finalizer wired into `site-generation.ts` finalize-build (alongside `repairDoubleDotCanonical`/`repairDanglingEmDash`) that injects WebSite+Organization+WebPage+BreadcrumbList, expands/clamps meta, and unescapes `\'` — all from shell signals + the real name, NO fabrication. Build-prompt mandate strengthened (≥4 blocks, prerendered head, straight quotes) as the quality belt. Proven: 6 unit tests + run against the REAL fetched vanta shell (0→4 blocks, desc 81→146c, escape fixed). Probe `verify-build-invariants.mjs` tightened to count REAL blocks (not the decoy marker) + wired into `e2e/site-quality/run-all.mjs`; it flips GREEN as sites rebuild (root fixes land next build per loop guardrail — NO redeploy of existing sites).**
- [x] **C.1a Theme fonts actually LAND (elaboration groundwork)** — ground-truth found every deployed site shipped headings in system-ui (theme fonts never applied). Fixed at the two named levers (AL-091): `theme-presets.ts` dossiers now emit a MANDATORY copy-pastable font block (exact `<link>` + `--font-heading`/`--font-body`) + 14 facets + 16 themes; `site-generation.ts` build prompt mandates wiring them. Lands on the NEXT build. *(verify-build-invariants.mjs will confirm font application once a post-change build publishes.)*
- [ ] **C.2 CWV** — LCP ≤ 2.0s · CLS ≤ 0.05 · INP ≤ 200ms · Lighthouse Perf ≥ 75
- [x] **C.3 axe 0 violations @ 6 breakpoints — probe SHIPPED + root-cause LOCKED (AL-140), flips green on rebuild** — new `e2e/site-quality/verify-a11y.mjs` (headless Chromium + @axe-core/playwright, WCAG 2.0/2.1/2.2 A+AA @ 375/390/768/1024/1280/1920, auto-joins run-all) audited a deployed site and found the SOLE serious violation: `color-contrast` on `team-role-card` body copy — muted `#64676b` on near-black `#0d0706` = **3.51:1** at mobile 375/390px. Root cause: a PRE-FIX build (vanta shipped before the dark-muted `oklch(0.65)!important` fix). The current template's muted clears AA on any brand surface, and the contrast test's blind spot (only checked `subtle` vs `surface-elevated`, never `muted` vs the darkest/lightest brand bg) is now closed — `template.projectsites.dev/src/design-tokens.contrast.test.ts` asserts dark muted ≥4.5:1 on near-black + light on white, every hue (7/7, template `96d095f`). Flips green as sites rebuild (NO redeploy of existing sites, per loop guardrail).
- [ ] **C.4 SEO + GEO** — canonical (custom hostname), OG 1200×630 ≤100KB, sitemap+lastmod, robots/security.txt/llms.txt, per-route metadata
- [ ] **C.5 JSON-LD per route** — accurate types only, Google Rich-Results valid
- [ ] **C.6 PWA** — manifest + maskable icons + offline.html + service worker
- [ ] **C.7 Beat-the-source** — denser / faster / more-accessible than the original (competitor floor ≥15% per `competitor-research`)

## § D — Platform marketing / SEO (projectsites.dev's OWN public face) · OWNER: GENERATED-SITE QUALITY (extends)
- [ ] **D.1 Homepage `/`** — SEO/CWV/a11y/JSON-LD, 0 console errors
- [ ] **D.2 Public routes** — blog · changelog · status · privacy · terms render + SEO
- [ ] **D.3 404** — real 404 status + branded page (no soft-404)

## § E — Editor (bolt.diy) · OWNER: COMPLETENESS + FULL JOURNEY
- [x] **E.1 Functions + Data workbench tabs** — real, connected (AL-004/018/038/060)
- [x] **E.2 WebContainer boot + edit→save→persist round-trip** — PROVEN live on prod via Browserbase real Chrome (AL-145, `verify-editor-webcontainer-roundtrip.mjs`, wired into run-all): booted the real WebContainer editor → typed a unique marker into CodeMirror → the "Save" affordance APPEARED (file dirty, `unsavedFiles.has`) → clicked Save → affordance CLEARED (workbench `saveFile` awaits the WebContainer FS write BEFORE removing from `unsavedFiles`, so cleared ⟺ persisted) → the marker SURVIVED a file-switch round-trip (re-read from the store/FS, not just the live buffer) → 0 console errors. Fail-open SKIP on boot-timeout (headless flakiness is the boot, not the round-trip); once the editor is interactive a broken round-trip FAILS. Closes the last heavy flow B.6 deferred as "$-gated by nature."

---

## Progress (recompute each fire)

- **§ A Admin:** 100% ✅ (plateau — maintenance-only)
- **§ B Full flows:** 9 / 9 = 100% ✅ (all flows have a headless-prod probe wired into run-all; B.5 billing-full AL-111 · B.6 editor round-trip AL-127 envelope · B.7 auth AL-094 · B.1 guest funnel AL-089. The out-of-headless legs — B.5 real-card charge, B.6 full WebContainer publish — are Browserbase/$-gated by nature + covered by unit tests / the FULL JOURNEY loop; FULL-FLOW is now maintenance-only)
- **§ C Generated-site quality:** 2 / 7 = ~29% (C.1 SEO-invariant finalizer AL-110 + C.3 axe probe/muted-contrast lock AL-140 — both root-fixed, flip green on next rebuild. Remaining: C.2 CWV, C.4 SEO/GEO, C.5 per-route JSON-LD, C.6 PWA, C.7 beat-the-source)
- **§ D Platform marketing:** 0 / 3 = 0%
- **§ E Editor:** 2 / 2 = 100% ✅ (E.1 tabs AL-004/018/038/060 · E.2 WebContainer edit→save→persist round-trip PROVEN live via Browserbase AL-145 — the last heavy flow closed)
- **Overall app "done": ~72%** (23 / 32 boxes) — the admin surface + the editor are finished and the money flow is proven live+secure; the sole remaining frontier is the public product: § C generated-site quality (C.2 CWV, C.4 SEO/GEO, C.5 per-route JSON-LD, C.6 PWA, C.7 beat-the-source) + § D platform marketing face — both owned by the GENERATED-SITE QUALITY cron.

## Maintenance caveat
Scheduled `/loop` crons **auto-expire after 7 days** (scheduler behavior). To keep converging to done, **re-arm weekly** (`/loop` or `CronCreate durable:true`). A weekly re-arm reminder is the safest guard against the whole convergence silently stopping.
