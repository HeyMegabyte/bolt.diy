# ULTIMATE LOOP — projectsites.dev admin: resolve everything, perfect the UI, E2E-TDD all of it

> Run this as a relentless single-session loop. Operate under EVERY rule, skill, and agent in
> `~/.claude` + `~/.agentskills` — that knowledge base IS the spirit of this project. Each
> iteration ships ONE coherent, fully-verified slice and leaves the tree greener, more gorgeous,
> better tested, and better documented than it found it. Do not stop until the ledger is empty
> and every gate is green.

---

## 0 — One-time setup (iteration 1 only)

**A. Test sign-in seam (so `brian@megabyte.space` signs in with a hardcoded test password):**
- Add `POST /api/auth/test-login` to the worker, **enabled ONLY when the `E2E_TEST_PASSWORD` secret is set** — return `404` when it's absent so the path never exists in normal prod (per `feature-flags` + `ai-agent-security`). It accepts `{ email, password }`, asserts `email === "brian@megabyte.space" && password === env.E2E_TEST_PASSWORD` (timing-safe compare), idempotently upserts the D1 `users` + `orgs` + `memberships(owner)` + a paid `subscriptions` row, mints a real session, and returns the bearer.
- Wire the **real** `/signin` UI to drive this path: render a password field only when a build/`?test=1` flag is active, so Playwright signs in through the ACTUAL UI (homepage → click "Sign in" → type `brian@megabyte.space` + password → land on `/admin`). No API-only shortcuts inside journey specs.
- `npm run e2e:seed` performs the idempotent D1 upsert. Set `E2E_TEST_PASSWORD` via `wrangler secret put` (prod) + `.dev.vars` (local). Document it in this app's `CLAUDE.md` and `packages/shared/CLAUDE.md`.

**B. Build the issue ledger — `apps/project-sites/_LOOP_LEDGER.md`:** scan the whole repo and enumerate every open item across:
- `TODO` / `FIXME` / `XXX` in `src/**` (grep), every Rec ever surfaced, `_ideas-50.md`, the audit gaps in recent sessions
- `npm run validate:features` drift · `knip` dead code · `eslint`/`stylelint`/`semgrep` findings · `jscpd` dupes
- Every failing OR missing unit test (Karma frontend, Jest worker+shared) and every admin section lacking an E2E + visual spec
Rank each by **value × user-impact**. This ledger is the loop's worklist.

---

## The loop (repeat until the ledger is empty AND all gates green)

1. **PICK** the single highest-value open item from the ledger.
2. **RED** — write the failing test first: a Playwright E2E that starts at the homepage, signs in as `brian@megabyte.space` via the test password, and navigates by clicks/keyboard only; plus a Karma/Jest unit where logic warrants. Run it; watch it fail. (Skipping TDD = the feature does not exist.)
3. **GREEN** — implement the minimal "super-coded" change: full drop-in files, **zero stubs/placeholders**, god-tier-engineering patterns, **Spartan UI only** + cyan/black tokens (`--ps-*`), `gorgeous-by-default` (enumerables as pills not CSV, `0.333s` transitions, `<app-rolling-counter>` on every stat, `appReveal` on every section, `:focus-within` on wrapped controls), RxJS-first at backend edges, **Zod at every boundary**, feature-flagged (`enabled=0, rollout=0, stage=experimental`) if non-trivial.
4. **REFACTOR + CLEAN** — run the full `~/.agentskills` lint stack in order: `oxlint → eslint --fix → prettier --write → stylelint → knip → jscpd → semgrep`, then `ng build` (AOT catches strict-template errors that `tsc` misses) + worker/shared `tsc --noEmit`. **Delete the dead code knip surfaces** (only when no concurrent worktree touches it).
5. **VERIFY (parallel)** — fan out Playwright across all **6 breakpoints (375/390/768/1024/1280/1920)** for the touched admin section: **visual** (axe-core 0 violations, AI-vision rubric ≥8/10, screenshot every step) AND **technical** (console-error-free, no 4xx/5xx, CSP/Trusted-Types clean). Worker Jest + shared Jest green. 100% of the touched feature has ≥1 E2E asserting it against the running app.
6. **DOCUMENT** — improve intent-level JSDoc on touched exports, update the section README + `e2e/FEATURES.md` + `e2e/COVERAGE.yml` + the project `CLAUDE.md` for any changed surface. Stale docs are bugs.
7. **DEPLOY + PROD-E2E** — build + deploy (worker + R2) with `CLOUDFLARE_API_KEY` + `blzalewski@gmail.com` via the green `container-deploy` path; verify the changed routes live; purge cache.
8. **SELF-IMPROVE** — ask: *"What brilliant addition would make this surface measurably better, and what assumed-required feature is missing here?"* Use best judgment; ship the best per `auto-integrate-recs` (<2h → inline). Append anything bigger to the ledger.
9. **CLOSE** — mark the item done in the ledger; commit (conventional + gitmoji via the lint-doctrine hooks); pick the next item.

---

## Coverage mandate (every admin section must reach "done")

Each of these MUST end with a parallel-safe E2E that signs in as `brian@megabyte.space` and exercises every clickable / form field / nav link / modal / keyboard shortcut / empty / loading / error state — axe-clean at 6bp, AI-vision ≥8, console-error-free:

`dashboard · sites · site-detail (+ branches/mcp-server/dna/swarm/copilot/deliverability) · forms · media · snapshots · billing · audit · docs · ai-endpoints · ai-logs · analytics · mcp · social · voice · seo · domains · apps · settings · user-settings · editor · feature-flags · site-features`

No section is "done" without it. Maintain the inventory in `e2e/FEATURES.md` + `e2e/COVERAGE.yml`; CI fails on any feature without a mapped, passing spec.

---

## Hard gates (per iteration — non-negotiable, build-fail if missed)

Deployed + purged · Playwright E2E green at 6bp · AI-vision ≥8/10 · axe 0 violations · Lighthouse A11y ≥95 / Perf ≥75 · zero errors/stubs/TODOs in shipped output · CSP L3 strict-dynamic + nonce · Trusted Types · all hyperlinks valid · INP ≤200ms · JSON-LD accurate-only · every new feature behind a flag · knip/jscpd/semgrep clean · `validate:features` drift = 0.

---

## Discipline

- **TDD-first, always** — failing test before code; bug fix = failing regression test first.
- **Parallelize** per `parallel-subagent-economy` — fan out 3-4 purpose-built specialists (not generic workers) for independent sections/specs; emit the assignment table + run the Agent Diversity Review gate before declaring DONE.
- **Spirit of `~/.agentskills`** in every decision — `god-tier-engineering`, `gorgeous-by-default`, `cinematic-ui-patterns`, `spartan-ui-design-system`, `verification-loop`, `drift-detection`, `feature-flags`, `zod-everywhere`.
- **Context hygiene** — checkpoint to `progress.md` at 60% context, then continue in a fresh session.
- **Terminate ONLY when**: the ledger is empty, every listed section's E2E + visual is green, `knip`/lint/`validate:features` are clean, and a final `completeness-checker` + `agent-diversity-review` pass with zero recommendations.

---

### Run it

- Direct: paste this file's contents as the prompt, or: *"Execute `apps/project-sites/_ULTIMATE_LOOP.prompt.md` — start at setup, then loop."*
- Scheduled: `/loop 30m Execute apps/project-sites/_ULTIMATE_LOOP.prompt.md — pick the next ledger item, close it end-to-end (RED→GREEN→clean→verify→doc→deploy→self-improve), commit.`
