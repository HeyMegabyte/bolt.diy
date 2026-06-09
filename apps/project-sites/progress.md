# progress.md — remaining supervised backlog

> The 2026-06 dashboard + feature-flag campaign is **DONE + live** (see git log:
> dashboard rebuild `28fa5a35`, flag removals through `ad9145e3`, drift tidy
> `3309554e`). Everything below is the leftover that needs a **supervised**
> session — NOT safe for an unattended cron. Delete this file once these ship.

## R1 — Perf-wave: ag-grid → TanStack (P1, dedicated session)
Both live admin grids import `ag-grid-community` at module top level → ~782 KB
EAGER in the initial bundle → ~205 KB over the 1.6 MB budget.
- Files: `frontend/src/app/pages/admin/sections/audit.component.ts` +
  `ai-logs.component.ts`.
- Pattern already in prod: `createAngularTable` (api-tokens + content-freshness).
- Full blueprint (+ the documented dead-ends — `@defer`/single-importer do NOT
  work, only removing ag-grid does): `docs/perf-wave-ag-grid-to-tanstack.md`.
- Memory: "perf-wave stalls in autonomous loops — SUPERVISE." All-or-nothing.
- Done = both grids on TanStack, ag-grid removed, budget green, both grids
  re-verified live (needs `E2E_API_KEY`).

## P1 — Durable SSG/prerender of the marketing route
The `<h1>` `<noscript>` stopgap is LIVE (commit `7f2c63ae`), but the marketing
`/` shell is still an empty client-rendered SPA for JS-crawler first-paint/LCP.
- Fix = real SSG/prerender of the marketing route (no SSG configured today).
- Verify: `curl / | grep -c '<h1'` == 1 in the prerendered shell + CWV (LCP).
- Architecture change — focused session + full Core-Web-Vitals verify.

## R3 — Wire the prod E2E suite into CI (needs Brian)
`*.e2e.ts` (marketing + admin a11y/contrast/reflow) runs only manually today.
- Add a post-deploy CI job running `npm run test:e2e:prod` with `PROD_URL` +
  the **`E2E_API_KEY` GitHub secret** (Brian's action — can't be done in-repo).
- Detail: `frontend/CLAUDE.md` § "Two E2E suites + a CI wiring gap".
