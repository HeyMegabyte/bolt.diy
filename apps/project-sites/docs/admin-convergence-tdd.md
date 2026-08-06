# Admin Convergence — Contract-Driven TDD

The system that makes **every admin section come out working** mechanically, instead
of by hope. One machine-readable contract is the single source of truth; the drift
gate proves coverage is complete; the prod sweep proves each section actually works;
the loop's DONE gate reads both.

## Why the old loop never converged

The truth about "what admin sections exist + what each must satisfy" was scattered
across **five drifting places** — `app.routes.ts` (routes/guards/flags),
`admin-section-labels.ts` (labels), inline `SECTIONS[]` arrays in 3+ browserbase
specs, `FEATURES_TO_TEST.md` (730 hand-ticked checkboxes), and the hand-curated nav.
Nothing derived from one source, so:

1. **Sections silently drifted out of coverage** — a new `/admin/*` route shipped with
   zero sweep coverage (the "routed+mounted ≠ reachable" / "advertised-route orphan"
   classes). `/admin/apps/:id` was live and in *no* sweep list when this landed.
2. **The DONE gate lied.** `convergence-loop.sh` counted unchecked `[ ]` boxes — a
   number decoupled from reality. A box could be ticked while the section was broken,
   or unticked forever while it worked. The loop *could not* converge because its
   terminal condition wasn't tied to prod.
3. **Per-section assertions were too weak** to catch the recurring bug classes (lying
   empty, response-key mismatch, swallowed-SQL→404, dark-flag sections). They asserted
   "≥150 chars + loose regex + 0 console errors" — which those classes sail past.

## The three pieces

| File | Role |
|---|---|
| `e2e/admin-verify/admin-contract.mjs` | **SSOT.** Every admin section: route, guard, flag, api[], real-data signal, shell testid, severity. Add a section → add a row. |
| `scripts/validate-admin-contract.mjs` | **Drift gate.** Cross-checks contract ⇄ `app.routes.ts` ⇄ labels. Exit 1 if any live route lacks a row (UNCOVERED) or a row points at a dead route (STALE). |
| `e2e/admin-verify/contract-sweep.mjs` | **Prod DONE gate.** Drives every section on PROD (authed as brian, Browserbase), runs the 6-point contract, emits `_ADMIN_CONTRACT_REPORT.json` with `done: true/false` + the exact failing sections. |

## The per-section contract (the TDD spec)

Each section must pass on PROD, authed:

1. **RENDER** — main text ≥ `minLen` (not blank / not a stuck spinner)
2. **REAL DATA** — the section-specific `signal` regex matches the DOM (loose "content
   exists" is *not* enough)
3. **NOT-CRASHED** — no error-boundary fallback ("ran into a problem")
4. **NOT-LYING** — no false-success / dead copy ("something went wrong", "failed to load")
5. **NOT-SWALLOWED** — every endpoint in `api[]` returns 2xx on load (catches
   swallowed-SQL→404 + response-key-mismatch)
6. **FLAG-AWARE** — a DARK flag-gated section shows a calm gate-notice, never a crash/404

Aliases assert their **redirect resolves**, never the admin not-found shell.

`severity: 'hard'` failures flip the DONE gate red. `'soft'` are reported, non-blocking
— use while a section's testids/endpoints are still being wired, then promote to `hard`
once green (the audit-arc maturity ladder).

## How the loop leverages it

`bin/convergence-loop.sh` `check_done()` now returns DONE only when **both** halves are
green:

```
drift clean   (validate-admin-contract.mjs exit 0)   — every live route has a row
sweep done    (_ADMIN_CONTRACT_REPORT.json .done)     — every HARD section passed on prod
```

Each fire: run the drift gate (fast, deterministic) + the prod sweep. The sweep's
`hardFailures[]` **is the next work queue** — the loop fixes exactly those sections,
re-sweeps, and self-terminates when the report goes green (per `loop-driven-development`).

## Commands

```bash
cd apps/project-sites

# Drift gate — every live admin route has a contract row (wire into CI + lefthook)
node scripts/validate-admin-contract.mjs            # exit 1 on drift
node scripts/validate-admin-contract.mjs --json

# Prod sweep — the real DONE gate (needs BROWSERBASE_API_KEY / _PROJECT_ID / E2E_TEST_PASSWORD)
node e2e/admin-verify/contract-sweep.mjs            # all sections → _ADMIN_CONTRACT_REPORT.json
node e2e/admin-verify/contract-sweep.mjs analytics  # one slug (debug)
```

Both **SKIP clean (exit 0)** without creds — CI/forks stay green.

## Add a section (the whole ritual)

1. Add the route to `app.routes.ts` (with its guard + flag).
2. Add a row to `admin-contract.mjs` (slug, route, guard, flag, `api[]`, `signal`, `shell`).
3. Add a label to `admin-section-labels.ts` (or the drift gate warns MISSING_LABEL).
4. Give the section root a `data-testid="<slug>-shell"` (advisory now, promote to hard later).
5. `node scripts/validate-admin-contract.mjs` → must be green before merge.

Skip step 2 and the drift gate fails the build (UNCOVERED) — that's the point: no
section can ship untested.

## Wiring TODO (next fire)

- Add `validate-admin-contract.mjs` to `.github/workflows/feature-architecture.yml` +
  `lefthook.yml` alongside `validate-feature-drift.mjs` (hard gate).
- Run `contract-sweep.mjs` in the prod-E2E workflow; upload `_ADMIN_CONTRACT_REPORT.json`.
- Promote soft sections to hard as their testids/endpoints land.
