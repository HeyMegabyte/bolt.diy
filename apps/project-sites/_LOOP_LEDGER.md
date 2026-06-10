# ULTIMATE LOOP — Issue Ledger

> Worklist for `_ULTIMATE_LOOP.prompt.md`. Pick the highest-value `[ ]` item, close it
> end-to-end (RED→GREEN→clean→verify→doc→deploy→self-improve), check it off, commit, next.
> Re-scan and append on every iteration. Legend: `[ ]` open · `[~]` in progress · `[x]` done.

## Iteration log
- **Iter 1 (2026-06-09):** `[x]` worker test-login seam (`authenticateTestLogin` + `POST /api/auth/test-login`, secret-gated by `E2E_TEST_PASSWORD`, 7 Jest tests green, typecheck clean). `[x]` this ledger.
- **Iter 3 (2026-06-09):** `[x]` flag-cache staleness fix (ce6bd17a, P2). `[x]` conversational_edits guard → N/A (route unbuilt). `[x]` dead-code excision scoped + `generatePodcast` name-collision trap documented (next focused session). Local-only (no prod push — Brian gates that).

---

## P0 — Test-harness setup (finish before the feature loop runs hot)
- [x] **Worker test-login seam** — `brian@megabyte.space` + `E2E_TEST_PASSWORD`, idempotent owner upsert, real session. Unit-tested.
- [ ] **Wire `/signin` UI to the seam** — render a password field when `?test=1`/build flag is active; submit to `POST /api/auth/test-login`; store bearer; redirect to `/admin`. (~6h)
- [x] **`scripts/e2e-seed.mjs` + `e2e:seed` npm script** — idempotent seed via the seam (real-UA, 404/401-aware). `node --check` + eslint clean. Verifies end-to-end once the secret is provisioned + worker deployed.
- [ ] **Provision `E2E_TEST_PASSWORD`** — `wrangler secret put` (prod) + `.dev.vars` (local); wire into `playwright.prod.config.ts`. (~1h)
- [ ] **Base journey spec** — `e2e/journey-auth-admin.e2e.ts`: homepage → Sign in → test password → land on `/admin`, axe-clean, console-clean. Then deploy + prod-E2E green. (~5h)

## P1 — Highest-value features (from `_ideas-50.md`, top cluster)
- [ ] **Inject visitor AI concierge into published sites** — `routes/concierge.ts` works server-side but the widget is never auto-injected at serving time. (#6, ~40h)
- [ ] **Visitor analytics beacon + admin surface** — `visitor_events_core`/`site_analytics` built but flag-off, no beacon in published HTML. (#7, ~40h)
- [ ] **Bundled AI voice receptionist provisioned at publish** (#1, ~70h)
- [ ] **Native booking engine** (catalog-confirmed missing) (#3, ~70h)
- [ ] **AI-native GEO layer + citation tracking** (#4, ~50h)
- [ ] **Edge per-visitor personalization (hero/CTA swap)** (#8, ~40h)
- [ ] **Post-publish autonomous growth agent** (#2, ~80h)

## P2 — Known gaps / drift / cleanup (from repo audit + project CLAUDE.md)
- [x] **Email HTML-injection sweep DONE** (2026-06-10) — user-supplied/plain-text fields interpolated into outbound HTML emails without escaping. FIXED: contact-form (ab694ef3 — unauth phishing-the-owner), inbox reply (3fa52f31 — visitor email). VERIFIED-SAFE: contact.ts (already escapes), forms send-reply (owner-authored + human-reviewed HTML — escaping would break it), site_serving (only charset-safe `[a-z0-9-]` slug injected). Class closed.
- [ ] **DRY — consolidate `escapeHtml` into `@project-sites/shared`** — 4 identical local copies now (search.ts, inbox.ts, contact.ts, weekly_digest.ts). Promote one to `packages/shared/src/utils/sanitize.ts` (sibling of sanitizeHtml/stripHtml), export it, replace the 4 locals. Low risk but needs the shared-package build/link verified (worker file:-links shared). (~1h, jscpd-hygiene not a bug)
- [ ] **Unvalidated `as`-cast `req.json()` sweep (LIVE routes — yields real bugs)** — convert SECURITY/RELIABILITY-relevant handlers per-handler w/ a RED test (NOT mass-retrofit). DONE 2026-06-09: mcp_oauth paste-key (6c440ca4), team-invite role enum (00daf359), **container SQL-exec/R2-write auth-BYPASS (d4cff843 — was unauth when ANTHROPIC_API_KEY unset; +constant-time +sql validation)**, **public /api/donate payment boundary (87c35133 — integer amount, https-only redirect URLs, malformed-JSON 400)**. VERIFIED-SAFE (no change needed): `ai_admin.ts:976 {bundle}` (CREDIT_BUNDLES lookup validates), `social_oauth` paste (already zValidator), `mcp_site` bearer (hash-lookup), `search.ts container` auth pattern was the ONLY bypass. REMAINING lower-value: `api.ts` body casts (3439/4826/6700/9732 — authed admin, downstream-guarded; convert opportunistically).
- [ ] **NEEDS DESIGN CALL — /api/donate cross-host redirect** — `successUrl`/`cancelUrl` are now https-validated, but a cross-host `https://evil.com` still passes → after a real donation Stripe redirects the donor off-site (phishing). Safe fix = restrict the redirect host to the site's own domain(s), but that risks breaking legit custom-domain sites → needs Brian's call on the allowed-host policy. (Rec, not autonomous.)
- [x] **N/A — `conversational_edits.ts` cross-tenant write guard** — no such route/service exists in `src` (only migration `0519_conversational_editing.sql`). Feature unbuilt → zero live exposure; re-open WITH the guard when the route lands. (verified 2026-06-09)
- [ ] **`features.ts` Zod-validation drift** — ~33 POST handlers use `as`-cast, no runtime validation; convert per-feature as each flag is promoted (NOT a blind mass-retrofit). (~per-feature) Note: these are flag-gated → 404 in prod, so zero live exposure.
- [x] **`env_vars.ts` Zod-at-boundary DONE** (e833742c/6de7e5e0/6e097ebc, 2026-06-09) — all 3 `as`-cast JSON reads (POST/PATCH/import) replaced with colocated Zod schemas + `safeParse`; zero as-casts remain. Boundary now rejects malformed bodies BEFORE the service (typed-inward, path-qualified VALIDATION_ERROR). 32 route tests preserved + 3 new boundary assertions. Full suite green. (Was style-drift, not a hole — setEnvVar still re-validates per-scope conditionals.)
- [ ] **`big_bets.ts` 30 mock features** — replace mock shapes with real backend per-feature as prioritized. (~varies)
- [x] **`features.ts` dead code DONE** (e91972a8, 2026-06-09) — excised 46 dead exports + private helpers, 817→181 LOC. knip-clean, full 4390-test suite green. (`createSnapshot` was ALSO a name-collision dead export — removed; final live set = recordTokenEvent/getMonthlyBurn + model-rate helpers + getPwaManifest.)
- [x] **Flag-cache staleness** — `routes/features.ts` `POST /api/site-features/:key` override-write now calls `invalidateFlagCache(c.env, key)` → no more 60s stale tenant flag after a toggle. tsc clean, flag-resolution suite 12/12. (ce6bd17a, 2026-06-09)
- [ ] **Wire `*.e2e.ts` prod suite into CI** — frontend a11y/contrast/reflow gates run only manually; add a post-deploy job with `PROD_URL` + `E2E_API_KEY`. (~4h)
- [ ] **Perf wave: ag-grid → TanStack** — both admin log grids ship 782KB eager ag-grid (205KB over budget); migrate per `docs/perf-wave-ag-grid-to-tanstack.md`. (~30h, dedicated session)
- [ ] **LLM eval/regression harness in CI** — no graders/thresholds on prompt/model changes. (#11, ~40h)
- [ ] **Real-time content guardrails (hallucination/PII/injection)** before publish. (#12, ~40h)

## P3 — Per-section E2E + visual coverage (every admin section must reach this)
For each: parallel-safe `*.e2e.ts` that signs in as `brian@megabyte.space`, exercises every clickable/form/empty/loading/error state, axe-clean at 6bp, AI-vision ≥8, console-clean. Track in `e2e/FEATURES.md` + `e2e/COVERAGE.yml`.

- [ ] dashboard · [ ] sites · [ ] site-detail (+ branches/mcp-server/dna/swarm/copilot/deliverability) · [ ] forms · [ ] media · [ ] snapshots · [ ] billing · [ ] audit · [ ] docs · [ ] ai-endpoints · [ ] ai-logs · [ ] analytics · [ ] mcp · [ ] social · [ ] voice · [ ] seo · [ ] domains · [ ] apps · [ ] settings · [ ] user-settings · [ ] editor · [ ] feature-flags · [ ] site-features

---

_Append newly-discovered items here each iteration (TODO/FIXME sweeps, knip, semgrep, drift, Recs)._
