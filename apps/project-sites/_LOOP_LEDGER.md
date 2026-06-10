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
- [x] **N/A — `conversational_edits.ts` cross-tenant write guard** — no such route/service exists in `src` (only migration `0519_conversational_editing.sql`). Feature unbuilt → zero live exposure; re-open WITH the guard when the route lands. (verified 2026-06-09)
- [ ] **`features.ts` Zod-validation drift** — ~33 POST handlers use `as`-cast, no runtime validation; convert per-feature as each flag is promoted (NOT a blind mass-retrofit). (~per-feature) Note: these are flag-gated → 404 in prod, so zero live exposure.
- [ ] **`env_vars.ts` Zod-at-boundary (style only, NOT a hole)** — 3 `as`-cast JSON reads (POST/PATCH/import, lines 151/219/358) on LIVE auth'd routes. ⚠️ Verified 2026-06-09: NOT a validation gap — `setEnvVar`→`validateScopeFields` already throws on bad key/value/scope (key `/^[A-Za-z_]\w*$/` ≤128, value string ≤64KiB, per-scope required id) → caught → 400. So this is pure Zod-at-route style-drift; convert-on-touch (colocate a Zod schema + `safeParse` → field-mapped 400) when next editing that route, NOT a security round. Existing `env_vars_routes.test.ts` locks current behavior — match its error shapes. (~2h, low priority)
- [ ] **`big_bets.ts` 30 mock features** — replace mock shapes with real backend per-feature as prioritized. (~varies)
- [ ] **`features.ts` dead code** — fully de-risked 2026-06-09; now a ~10-min mechanical excision. **KEEP exactly these 10 exports** (externally referenced): `ModelId`, `listModels`, `estimatePromptCost`, `pickModel`, `recordTokenEvent`, `getMonthlyBurn`, `createSnapshot`, `getPwaManifest` + keep helpers `uuid`/`nowIso` + const `MODEL_RATES`. **REMOVE the 44 knip-flagged dead exports + 3 transitively-dead symbols** (`sha256Hex`, `runCwvGate`, `previewVeoCost` — knip didn't flag the latter two as unused *exports* because each is called only by a now-removed dead fn (`computeSpeedScore`/`generateVeoLoop`), so they're dead only AFTER the 44 go). ⚠️ Excise by knip file:line, NOT by name — `generatePodcast` collides with the live media-route fn. Verify: `tsc --noEmit` + full 902 jest + `npx knip --include exports` (features.ts must drop off) + eslint (watch no-unused-vars on `uuid`/`nowIso` — both still used by recordTokenEvent/createSnapshot). Zero runtime impact (tree-shaken) so it's hygiene, not a fix → low priority. (~10min)
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
