# Perf Wave — ag-grid → TanStack Table (the 205 KB initial-bundle close)

**Status:** planned · needs a dedicated focused session (NOT a convergence-loop round).
**Why a session:** a faithful rewrite of two master/detail grids on a compliance
view (`/admin/audit`) needs live grid-interaction QA + a feature-trade-off call —
[[autonomous-engineering]] approval-required tier. This doc is the executable plan
so the session is fast + safe.

## The problem (re-verified 2026-06-03)
`ag-grid-community` (~782 KB, the 800 KB `chunk-*.js`) is **eager-hoisted into the
initial bundle** → ~181 KB transfer on **every** visitor (marketing + admin),
205 KB over the 1.6 MB `initial` budget (a build WARNING, not a failure — site
works today). Root cause: `audit.component.ts` + `ai-logs.component.ts` both
`import { AgGridAngular } from 'ag-grid-angular'` at module top level; esbuild
hoists the shared heavy dep into `main` regardless of lazy routes.

**Dead ends (do NOT re-attempt — tried + reverted):**
- `@defer` on the grid component → still hoisted (ag-grid-angular is a static import).
- Orphaning one of the two importers → still 205 KB over (esbuild promotes the
  large dep to a main chunk from even ONE lazy importer).
- Lazy child component wrapping `<ag-grid-angular>` → still hoisted.
**Only two real fixes:** (a) remove ag-grid → TanStack Table (this plan), or
(b) eject Angular's esbuild builder to hand-configure chunking (huge, rejected).

**ALL-OR-NOTHING:** the budget only closes when BOTH grids drop ag-grid. A
one-grid migration is valid de-risking progress but yields no budget win until
the second lands.

## Feature inventory — MUST mirror (ports MIRROR legacy, never summarize)
Both `audit.component.ts` (900 lines) and `ai-logs.component.ts` (1405 lines):
1. **Columns** — `ColDef[]` + `defaultColDef`; string-returning `cellRenderer`s +
   one `HTMLElement` renderer (status/badge cells).
2. **Master/detail** — synthetic full-width detail rows spliced into `rowData`
   via `isFullWidthRow` + `fullWidthCellRenderer` + `getRowHeight`; click a row to
   expand an HTML detail panel. (`refreshCells`/`redrawRows` on toggle.)
3. **Pagination** — `pagination=true`, `paginationPageSize=50`,
   `paginationPageSizeSelector=[25,50,100,250]`.
4. **Column-state persistence** — `getColumnState()` → `localStorage`
   (`ps_audit_grid_v2` / `ps_traces_grid_v1`).
5. **`onGridReady`** — captures `gridApi`.

audit-only: **CSV export** (`gridApi.exportDataAsCsv`), **site filter**
(`gridApi.setFilterModel`).

## TanStack equivalents (`@tanstack/angular-table ^8` — already installed)
- Columns → `ColumnDef<Row>[]`; render rows manually from
  `table.getRowModel().rows` (skip FlexRender for text/badge cells — see
  `package-preference-registry` recipe).
- Master/detail → `getExpandedRowModel()` + `row.getIsExpanded()`; render a
  full-width detail `<tr>` after an expanded row (replaces the synthetic-row +
  `fullWidthCellRenderer` model — cleaner, no row splicing).
- Pagination → `getPaginationRowModel()` + `pageSize`/`pageIndex` state + a
  `<select hlmSelect>` page-size control (Spartan, cyan/black).
- Column persistence → persist `columnOrder`/`columnVisibility` to localStorage.
  **DECISION FOR BRIAN:** admins rarely reorder log columns — consider dropping
  persistence to cut scope (would be a deliberate, documented simplification, not
  silent summarizing). Default: keep, to honor "mirror legacy".
- CSV (audit) → small helper over `table.getRowModel().rows` → Blob download
  (no ag-grid dep).
- Site filter (audit) → `columnFilters` state on the `site` column.
- Theme → CSS on the rendered `<table>` using `--ps-*` tokens (dark `#03070a`
  canvas, cyan `#00e5ff` accents, `tabular-nums`); `:focus-visible` cyan ring;
  reduced-motion safe.

## Safety net — the data logic is ALREADY characterized (re-verified 2026-06-07)
This is a **rendering-layer swap, not a logic rewrite** — the risk is narrower than it looks.
Both components' grid-feeding logic is **grid-agnostic** (it produces row models /
splices detail rows / computes KPIs / escapes CSV — none of it touches ag-grid's DOM)
and is **already covered by Karma specs that carry over to TanStack unchanged**:
- `audit.component.spec.ts` — **27 tests**: master/detail splicing (`displayRows` splices
  the synthetic `__detail` row; KPI computeds EXCLUDE it; `toggleExpand` no-op on a detail
  row; collapse removes it; two-expanded interleave), KPI computeds (`uniqueActions`/
  `uniqueActors`/`last24h`), load/error/`{silent}`/retry, **CSV formula-injection guard**
  (`csvFormulaGuard` prefixes `=`/`+`/`-`/`@`), `canExport` (no headers-only CSV), a11y
  (rolling-counter, role=status, keyboard, cyan-not-orange, reduced-motion).
- `ai-logs.component.spec.ts` — **19 tests**: master/detail contract (`displayRows`
  splice/expand), KPI-over-error gating (`showKpis`), rows, filter contract.

**Implication for the session:** keep these specs GREEN throughout the migration — they
already lock the data behaviour TanStack must reproduce. The ONLY thing they DON'T cover
(because the specs grid-strip the ag-grid template) is the **rendered DOM** — so the
live-QA in step 7 is the focused remaining risk: does the TanStack `<table>` visually
render the rows, expand the detail `<tr>`, paginate, sort, and theme correctly. Write the
new DOM-level assertions (rows render, expand toggles a visible detail row) as the migration's
RED-first tests; the 46 existing logic tests are the regression backstop.

## Migration steps (per grid; do audit-companion `ai-logs` FIRST — lower stakes)
1. Build a `<th>`-sortable, paginated TanStack `<table>` rendering the existing
   `columnDefs` cells; keep the same `data-testid`s the e2e specs assert.
2. Add expandable detail rows (port `fullWidthCellRenderer`'s HTML into an Angular
   detail template).
3. Add page-size `hlmSelect`, CSV (audit), site filter (audit), column persistence.
4. Remove ALL `ag-grid-*` imports + `ModuleRegistry` from the component.
5. Update the component's Karma spec (rows render, expand toggles, paginate, CSV,
   filter) — RED-first where practical.
6. `ng build --configuration=production` — confirm the component compiles + the
   `ag-grid` chunk SHRINKS (fully gone only after BOTH grids migrate).
7. **Live QA (E2E_API_KEY + Playwright):** load the route, expand ≥2 detail rows,
   paginate forward/back, change page size, filter (audit), export CSV (audit),
   reload + confirm column state (if kept), 6-breakpoint reflow + axe-clean.

## Done / budget-close verification (after BOTH grids)
- `grep -r "ag-grid" apps/project-sites/frontend/src/app` → ZERO (then remove
  `ag-grid-community` + `ag-grid-angular` from `package.json`).
- `ng build --configuration=production` → initial bundle UNDER the 1.6 MB budget
  (no `initial exceeded` warning).
- `admin-a11y` (desktop + mobile) + `admin-functional` + `admin-routing` authed
  prod suites GREEN against the deployed build.
- Both grids' Karma specs green; full suite green.

## Risk notes
- `/admin/audit` is a compliance/audit-log view — verify row counts, ordering,
  and the detail panel match the legacy grid exactly before promoting to prod.
- main → prod: commit only when BOTH grids are migrated + fully QA'd (a partial
  commit ships to prod on the next deploy).
