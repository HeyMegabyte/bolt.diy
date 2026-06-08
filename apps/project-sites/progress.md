# progress.md — Supreme-Polish / Visual-Perfection Campaign (handoff)

> **Why this file exists:** the campaign below was requested from a context-SATURATED
> session. Heavyweight specialist sub-agents (visual-qa / a11y / perf / seo /
> completeness) fail to spawn here with **"Prompt is too long"** (`subagent_tokens: 0`)
> — proven twice, even with tight briefs; only a 4-word haiku probe spawned. Per
> `~/.claude/.../rules/parallel-subagent-economy.md` § Fresh context by default
> (saturation hard-stop), the correct move is: **checkpoint → run in a FRESH session.**
>
> **HOW TO RESUME:** open a new Claude Code session in this repo and say:
> *"Execute apps/project-sites/progress.md."* Clean context → the fan-out spawns fine.

## Current production state (verified live 2026-06-08, all deployed)
- **Feature-flag 401 fix** — live (super-admin mutations carry the bearer).
- **Share link feature** — worker live (version `7ad8c0a7`); D1 `0537` applied
  (`review_tokens.password_hash`/`password_salt` present); modal live in admin.
  Reviewer-side password gate UI NOT built yet (see Rec R2).
- **Automation Builder (#11)** — fully removed (frontend + worker), deployed;
  D1 `0538` applied (`automation_recipes` absent). Verified gone from live bundle.
- Flags 32, manifests 22, worker routes 59 — drift validators green.

## THE CAMPAIGN — run as a fresh-session parallel fan-out (tight briefs, small waves)
Spawn specialists in waves of 2-3 (NOT 5 at once — that overflowed). Each gets a
≤90-word self-contained brief, read-only, returns ≤150 words. Assignment table:

| Wave | Agent (type) | Scope | Deliverable |
|---|---|---|---|
| 1 | visual-qa (sonnet) | prod marketing `https://projectsites.dev` @ 375/768/1280/1920 | prioritized visual-perfection defects + fixes |
| 1 | completeness-checker (sonnet) | repo code-level: undone TODO/stub/dead-button/lying-UI/off-brand-hex/missing states | prioritized punch-list |
| 2 | accessibility-auditor (sonnet) | prod marketing + authed admin (seed `E2E_API_KEY`) @ 6bp, axe + WCAG 2.2 manual | violations + fixes |
| 2 | performance-profiler (sonnet) | prod marketing `/` + key admin routes — CWV/Lighthouse | LCP/CLS/INP + fixes |
| 3 | seo-auditor (haiku) | prod routes — title/meta/JSON-LD/OG/sitemap/robots/llms.txt | gaps |
| 3 | visual-qa (sonnet) | **authed admin** shell + top sections (dashboard/sites/feature-flags/settings/media/social) @ 6bp — seed `ps_session` from `E2E_API_KEY` | admin visual defects |

After each wave: fold the ≤150-word findings, implement every ≥7/10 "just-feels-right"
fix on disjoint files, `ng build` + Karma + worker Jest, deploy worker+frontend,
re-verify. Loop until the supreme-polish 100-ideas audit returns zero implementable items.
Auth seed for admin agents: `localStorage.ps_session = {token: E2E_API_KEY, identifier:'test@megabyte.space', createdAt: Date.now()}` (see `e2e/navbar-site-actions.e2e.ts`).

## Outstanding recommendations (implement all)
- **R1 — Perf-wave (P1, dedicated):** both live `ag-grid` admin grids →
  TanStack. `audit.component.ts` + `ai-logs.component.ts` import ag-grid at module
  top-level → ~782KB EAGER in initial bundle → 205KB over the 1.6MB budget. Blueprint:
  `apps/project-sites/docs/perf-wave-ag-grid-to-tanstack.md` (read it; dead-ends are
  documented — `@defer`/single-importer do NOT work, only removing ag-grid does).
  TanStack already in prod (`api-tokens` + `content-freshness` use `createAngularTable`).
- **R2 — Reviewer password-gate UI — ✅ DONE + DEPLOYED (83609dc4, 2026-06-08).**
  `ReviewComponent` (`/review/:id`) now reads `password_required` and shows an
  unlock form → `POST /api/review/:id/unlock` before revealing status/approve/reject
  (401→inline error, 429→rate-limit notice). +4 Karma tests; 1393 green; frontend
  deployed to R2; route serves 200 live. REMAINING for a fresh session: a live
  Playwright E2E of the full password flow (needs `approval_workflow` ON + a created
  protected link via authed admin).
- **R3 — Re-run prod gates:** after today's deploys, re-run `npm run test:e2e:prod`
  (marketing-a11y/responsive, admin-a11y/reflow, contact-form) with `E2E_API_KEY`;
  re-check Lighthouse on `/`. Wire the `*.e2e.ts` prod suite into CI (decision +
  the `E2E_API_KEY` GitHub secret — tracked in `frontend/CLAUDE.md`).
- **R4 — Optional schema tidy:** the `recipes`/automation D1 tables were never in
  prod (no-op); only relevant for local/dev cleanliness. Low priority.

## Verified findings this checkpoint (2026-06-08 prod smoke)
- ✅ Discovery files all 200: robots.txt, sitemap.xml, humans.txt, security.txt,
  llms.txt, site.webmanifest, favicon.ico. JSON-LD = 5 blocks. canonical + og:image present.
  title ~46 chars (ok; could grow toward 50-60). meta description 144 chars (in range).
- ◐ **P1 — homepage static `<h1>` — STOPGAP SHIPPED (7f2c63ae, 2026-06-08).** A
  `<noscript>` SEO/a11y fallback (real hero `<h1>` + description + links) now lives
  in `frontend/src/index.html`; deployed + verified live (`curl /` → exactly 1 real
  `<h1>`, status 200). This closes the immediate gate for no-JS/social crawlers.
  **DURABLE FIX still open:** real SSG/prerender of the marketing route (the SPA shell
  is still empty for JS-rendering crawlers' first paint / LCP) — fresh-session work.

## Known-clean (per prior convergence — do NOT re-churn)
Lying-UI catchError class, redundant-toast, dead class-bindings, error-card
standardization, premature-stat-during-load, icon-button a11y names, flag links,
17 admin routes console-clean. Mass `#00E5FF`→token conversion = explicitly
"not worth the churn" (`admin-brand-token-drift` memory). Brand is CYAN/black
(NOT orange). Don't rebuild admin-v2 (reverted; legacy /admin is live).

## Cost discipline for the fresh session
Orchestrator Opus; specialists Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`);
keep `CLAUDE_CODE_FORK_SUBAGENT` UNSET (fresh subagents); waves of 2-3, tight briefs,
≤150-word returns; build/deploy once per wave at fold-in. Per `parallel-subagent-economy.md`.
