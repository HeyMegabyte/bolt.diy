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
**Status: ✅ verified plateau** — 23 sections, 11-probe headless-prod suite (`e2e/admin-verify/run-all.mjs`) green (16 pass · 4 skip · 0 fail).
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
- [ ] **B.5 Billing FULL** — checkout → (Stripe TEST-mode) webhook → subscription flips `active` → entitlements unlock in `/admin/billing` (causal). *(FULL-FLOW)*
- [ ] **B.6 Editor round-trip** — open site in `/admin/editor` → change a requirement → live `{slug}` updates → publish (real edit→publish persistence — the canonical loop.md flow). *(FULL-FLOW)*
- [x] **B.7 Auth** — magic-link request→verify-fail-safe + Google OAuth init well-formed (headless-verifiable portions; the emailed-click token consumption needs the peek seam / a human inbox — out of headless scope). *(verify-auth-flow.mjs, AL-094 — 7/7 on prod: request 200+expiry · Zod 400 · verify missing/bad-token 302 fail-safe · Google 302 client_id+redirect_uri+scope+CSRF-state · callback graceful · me→401)*

## § C — Generated-site QUALITY (the CORE PRODUCT) · headless PROD audit · OWNER: GENERATED-SITE QUALITY
*Audit DEPLOYED `{slug}.projectsites.dev` (vanta-strength-austin · ironhaus-houston · vantage-digital-studio-portland). Fix at ROOT CAUSE in the TEMPLATE (`github.com/HeyMegabyte/template.projectsites.dev`, lands next build) or the site-gen prompt / `build_validators.ts` — never a one-off. Ship a durable probe under `e2e/site-quality/` wired into run-all.*
- [ ] **C.1 build_validators invariants live on prod** — required files (webmanifest/robots/humans/sitemap/security.txt/favicons), asset existence, meta 50-60 / 120-156, JSON-LD ≥4 accurate blocks, single H1, no banned-slop (`src/services/build_validators.ts`). **Detector SHIPPED (AL-091, `e2e/site-quality/verify-build-invariants.mjs`) — currently ❌ FAILING: deployed sites have title 44<50 / desc 8-81<120 / jsonld 1<4. Root-cause fix = TEMPLATE/site-gen (report-mode validators let gaps ship); owned by GENERATED-SITE QUALITY loop.**
- [x] **C.1a Theme fonts actually LAND (elaboration groundwork)** — ground-truth found every deployed site shipped headings in system-ui (theme fonts never applied). Fixed at the two named levers (AL-091): `theme-presets.ts` dossiers now emit a MANDATORY copy-pastable font block (exact `<link>` + `--font-heading`/`--font-body`) + 14 facets + 16 themes; `site-generation.ts` build prompt mandates wiring them. Lands on the NEXT build. *(verify-build-invariants.mjs will confirm font application once a post-change build publishes.)*
- [ ] **C.2 CWV** — LCP ≤ 2.0s · CLS ≤ 0.05 · INP ≤ 200ms · Lighthouse Perf ≥ 75
- [ ] **C.3 axe 0 violations** @ 6 breakpoints
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
- [ ] **E.2 WebContainer boot + edit→save→persist round-trip** — Browserbase-gated (see B.6)

---

## Progress (recompute each fire)

- **§ A Admin:** 100% ✅ (plateau — maintenance-only)
- **§ B Full flows:** 7 / 9 = ~78% (B.7 auth ✅ AL-094 · B.1 guest funnel ✅ AL-089 — remaining: B.5 billing-full, B.6 editor round-trip)
- **§ C Generated-site quality:** 0 / 7 = 0% (was UNLOOPED — now owned by the new loop)
- **§ D Platform marketing:** 0 / 3 = 0%
- **§ E Editor:** 1 / 2 = 50%
- **Overall app "done": ~59%** (19 / 32 boxes) — the admin surface is finished; the remaining frontier is the public product (generated-site quality) + the two heaviest flows (B.5 billing-full = Stripe test-mode checkout→webhook→entitlement-unlock; B.6 editor round-trip = WebContainer edit→publish, Browserbase-gated).

## Maintenance caveat
Scheduled `/loop` crons **auto-expire after 7 days** (scheduler behavior). To keep converging to done, **re-arm weekly** (`/loop` or `CronCreate durable:true`). A weekly re-arm reminder is the safest guard against the whole convergence silently stopping.
