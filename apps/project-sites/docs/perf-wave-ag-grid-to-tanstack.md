# Perf + a11y Wave — ag-grid → TanStack Table migration

> **Status:** BLUEPRINT (not started). Read this whole doc before touching code.
> **Authored 2026-08-07** from a full feature inventory of both grids (the doc
> `frontend/CLAUDE.md` referenced but which did not exist — this fills that gap).

## Why (two hard gates, one migration)

1. **CRITICAL axe** — ag-grid 33.3.2 renders `.ag-root[role="grid"]` with a
   virtualized child structure axe flags as `aria-required-children` ("children
   not allowed: [role=presentation]") on `/admin/audit` + `/admin/ai-logs`.
   Rigorously diagnosed 2026-08-07 ([[ag-grid-critical-axe-known-tracked]], commit
   cc41ccc3): **unpatchable from outside the library** — stripping all 73
   `[role=presentation]` descendants does NOT clear it; the grid role itself is
   flagged. Currently TOLERATED via a narrow `checkA11y` known-tracked filter so
   the brian sweep stays useful; removing ag-grid is the only real fix.
2. **205 KB bundle overage** — `ag-grid-community` is 782 KB, EAGER-hoisted into
   the initial bundle by esbuild even from a single lazy route (frontend/CLAUDE.md
   § Known perf-budget items). TanStack Table is headless (~15 KB) → removing
   ag-grid closes the budget.
3. **Doctrine** — `package-preference-registry`: "ag-grid Community ONLY for 100k+
   row enterprise grids." These are admin LOG tables → ag-grid is over-engineered.

## Documented DEAD ENDS — do NOT re-attempt (from frontend/CLAUDE.md)

- **`@defer` on the grid** — MADE THE BUNDLE WORSE (1.81→2.01 MB). ag-grid-angular
  is shared by two lazy routes, so esbuild hoists it into the initial bundle
  regardless of `@defer`; the added dynamic `import('ag-grid-community')` just
  duplicated it. Reverted round 42.
- **Single-importer / orphan-a-route** — leaving ag-grid with one lazy importer
  (audit only) still left the bundle 205 KB over. esbuild promotes the large lazy
  dep to a `main`-chunk from ONE lazy route. Round 49.
- ⇒ The ONLY fixes are (a) remove ag-grid entirely (this migration) or (b) eject
  from Angular's builder to configure esbuild chunking (huge). Do (a).

### ⚠️ The real eager-hoist driver: `frontend/src/main.ts` (verified 2026-08-07)

`main.ts` has a **static** `import { ModuleRegistry, … } from 'ag-grid-community'`
+ a bootstrap-time `ModuleRegistry.registerModules([…])` (line ~33). This is the
`main`-chunk static import frontend/CLAUDE.md § perf-budget calls out ("main imports
it via a static import-statement") — it is almost certainly WHY `@defer` on the two
route components couldn't de-hoist ag-grid: even with both components lazy, `main.ts`
pulls all of ag-grid-community into the initial bundle at app bootstrap. So there are
**THREE** ag-grid sites, not two: `main.ts` (global registration) + the two grid
components. Removing the dep is not done until `main.ts`'s import + registration are
gone too — and that removal is likely the single biggest bundle win.

## Proven TanStack pattern already in the repo (copy this)

`frontend/src/app/pages/admin/sections/api-tokens.component.ts` — `createAngularTable`
(client-side sort). Key shape:

```ts
private readonly sorting = signal<SortingState>(/* from table-sort-url decode */);
private readonly columns: ColumnDef<Row>[] = [ /* accessorKey/header/cell */ ];
readonly table = createAngularTable<Row>(() => ({
  data: this.rows(),                              // signal — table re-derives on change
  columns: this.columns,
  state: { sorting: this.sorting() },
  onSortingChange: (u) => this.sorting.set(typeof u === 'function' ? u(this.sorting()) : u),
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
}));
```
Template renders MANUALLY: `@for (header of table.getHeaderGroups()[0].headers …)`
+ `@for (row of table.getRowModel().rows; track row.original.id …)`.
Plus `pages/admin/table-sort-url.ts` — URL-synced single-column sort (`?sort=col.dir`).
⚠️ api-tokens is SIMPLE (sort only). The log grids need pagination + filters +
master/detail + CSV + col-state — TanStack has row models for all of these but
you render + wire them yourself. Budget the extra work below.

## Feature inventory (what MUST be preserved)

### `/admin/audit` (audit.component.ts, 968 lines)
- **Data**: `GET /api/audit-logs?limit=500` → `{data: AuditRow[]}`; 15s poll,
  visibility-gated, pause after 3 fails. Empty-state card (role=status) when 0 rows
  — grid renders ONLY with rows (the atomicity boundary).
- **5 columns**: `action` (200px, pill cellRenderer), `message` (flex, fallback
  valueGetter + tooltip), `created_at` (140px, default sort desc, relative-time
  formatter + ISO tooltip + custom date comparator), `site` (140px, null→"—"),
  `expand` (50px, kebab button → toggleExpand).
- **Master/detail (faux)**: synthetic `__detail` rows spliced into `displayRows()`
  computed; `isFullWidthRow` + `fullWidthCellRenderer` build a 360px detail card
  (actor/target/when/site/request_id + syntax-highlighted metadata JSON + copy-JSON
  + copy-request_id buttons via imperative addEventListener).
- **CSV export**: `gridApi.exportDataAsCsv()` — `audit-log-YYYY-MM-DD.csv`, with a
  formula-injection guard (apostrophe-prefix `=+−@\t\r`). MUST reimplement (TanStack
  has no CSV — build from `table.getFilteredRowModel().rows`, keep the guard).
- **Pagination**: 50 default, selector [25,50,100,250].
- **Site filter**: `setFilterModel({site:{type:'equals',filter:slug}})` on gridReady;
  clearable. → TanStack column filter or a pre-filter on `data`.
- **Col-state persistence**: localStorage `ps_audit_grid_v2` (order/width/visible/sort).
- **Theme**: `themeQuartz.withPart(colorSchemeDarkBlue)` dark-cyan (bg #0a0a1a, accent
  #00E5FF …) → becomes plain SCSS using `_polish.scss` tokens.
- **Row id**: `params.data.id`. **Modules**: ClientSideRowModel, CsvExport,
  Pagination, Text/Number/DateFilter, RowSelection, Validation.

### `/admin/ai-logs` (ai-logs.component.ts, 1431 lines) — 80% shared with audit
- **Data**: `GET /api/sites/:id/ai-logs` → `{data: TraceRow[]}`; same 15s poll.
- **8 columns**: Status (badge), When (sort desc, relative+ISO), Endpoint (mono,
  text filter), Tool (mono), Model (prettify), Latency (numeric, fill-bar cellRenderer
  — UNIQUE), Credits (numeric, right-aligned), Actor (mono, text filter).
- **Master/detail (faux, IDENTICAL pattern)**: 480px detail with meta pills + 4-5
  code blocks (system prompt/input/output/error/explanation) + per-block copy chips +
  action buttons (Re-run, Explain-with-AI, Copy-JSON, Open-endpoint). Expand via
  `onRowClicked` (gated on text-selection + actionable children).
- **Quick-filter search**: free-text across endpoint/tool/model/actor/output/error
  (client-side in `displayRows()`).
- **NO CSV**. **Col-state**: localStorage `ps_traces_grid_v1`. **Same theme/polling/
  row-id/master-detail pattern as audit.**

## Migration plan (CONCRETE-FIRST — do not abstract early)

> Phase −1 gate (2) "abstracting too early?" — do NOT build a speculative shared
> `<app-data-table>` before a single grid is migrated. The proven repo precedent
> (`api-tokens.component.ts`) is INLINE `createAngularTable`. Migrate audit inline
> first; only when migrating ai-logs, EXTRACT what actually proved shared. You
> learn the real seam from two concrete impls, not from a guessed interface.

**Step 1 — migrate audit INLINE** (smaller, HAS CSV — proves the hardest path).
In `audit.component.ts`: replace `<ag-grid-angular>` + all ag-grid imports/theme with
inline TanStack (`createAngularTable`, `getCoreRowModel`/`getSortedRowModel`/
`getPaginationRowModel`/`getFilteredRowModel`). Port the 5 columns as `ColumnDef`;
render the header + body manually (`@for` over `table.getRowModel().rows`); render the
master/detail as a real Angular `<ng-template>` toggled by an `expandedIds` signal
(NOT the imperative `fullWidthCellRenderer`/innerHTML); reimplement CSV from
`table.getFilteredRowModel().rows` KEEPING the formula-injection guard; port site-filter
to a column filter + pagination controls + a dark-cyan SCSS block (tokens from
`_polish.scss`, not a JS theme object); persist col visibility/sort in localStorage
`ps_audit_grid_v2`. Delete `ModuleRegistry`/ag-grid from the component. **Verify audit
end-to-end (checklist below) BEFORE touching ai-logs.**

**Step 2 — migrate ai-logs**, REUSING whatever proved genuinely shared in Step 1
(pull it into `pages/admin/data-table/` ONLY now that two real call-sites define the
seam). Add the two ai-logs-only bits: the latency fill-bar cell + the quick-filter
search box; no CSV. Delete ag-grid from the component.

**Step 3 — remove the dep** (the budget-closing step): ag-grid is imported in
SEVEN files (verified 2026-08-07 `grep -rl ag-grid frontend/src` → 2 comps +
`main.ts` + 4 specs):
`main.ts` (global registration — **remove the import + `registerModules` block**),
`audit.component.ts` + `ai-logs.component.ts` (Steps 1-2), and the two
`*.component.spec.ts` (+ `api-tokens`/`logs-dashboard` specs referencing it —
update/delete the ag-grid assertions). Once `grep -rl ag-grid frontend/src` is empty:
`npm rm ag-grid-community ag-grid-angular`. Rebuild → the 205 KB `initial` overage
should vanish (removing the `main.ts` static import is the piece that actually
de-hoists it).

## Verification checklist (live, real browser, as brian — E2E_API_KEY + Browserbase)

Both grids need a POPULATED grid to test (E2E_API_KEY's e2e-test-org is empty — seed
a temp row per [[ag-grid-critical-axe-known-tracked]], or use the brian sweep).
- [ ] Rows render populated (audit: brian's real audit_logs; ai-logs: brian's traces).
- [ ] Sort every sortable column (asc/desc); `?sort=` survives refresh.
- [ ] Pagination: change page + page size [25/50/100/250].
- [ ] Master/detail: expand a row → detail card renders (audit: metadata JSON + copies;
      ai-logs: code blocks + Re-run/Explain/Copy/Open buttons all work).
- [ ] audit CSV export downloads with the formula-injection guard intact.
- [ ] audit site-filter scopes rows; ai-logs quick-search filters.
- [ ] Col-state (order/width/visible) persists across reload.
- [ ] **axe critical = 0** (the whole point — the `aria-required-children` is GONE;
      then REMOVE the `isKnownAgGrid` filter from `e2e/helpers/a11y.ts` + this tracking).
- [ ] 0 console errors, 0 failed requests, dark-cyan theme intact, no layout break.
- [ ] `ng build` — the 205 KB `initial` overage is closed (was a WARNING).

## When done

- Remove the `isKnownAgGrid` known-tracked filter from `e2e/helpers/a11y.ts` (the
  reason it exists is gone) + this doc's tracking note + the board line.
- Add `/admin/audit` + `/admin/ai-logs` to `e2e/admin-verify/admin-a11y-critical.spec.ts`
  (guard, now that they're genuinely clean).
