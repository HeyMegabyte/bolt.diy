/**
 * AG Grid v33+ modular registration — shared by the LAZY-loaded admin grids
 * (`audit.component.ts` + `ai-logs.component.ts`).
 *
 * Why this file exists: registration used to live in `main.ts` (the eager
 * bootstrap), which forced esbuild to hoist all of `ag-grid-community` (~782 KB)
 * into the INITIAL bundle — the 205 KB over-budget warning (see
 * `docs/perf-wave-ag-grid-to-tanstack.md`). Both grids are `loadComponent`-lazy,
 * so importing the module set from HERE (referenced only by those lazy
 * components) lets esbuild place ag-grid in the per-route lazy chunks instead of
 * the initial bundle. `main.ts` no longer imports ag-grid at all.
 *
 * The set is the exact superset the two grids use (cell styling, tooltips,
 * runtime event/render API, client-side row model, pagination, filters, CSV,
 * validation). Registering fewer logs AG Grid error #200 for `cellStyle` /
 * `tooltipValueGetter` / `api.addEventListener`. `registerModules` is idempotent
 * and the `registered` guard makes a second call from the second grid a no-op.
 */
import {
  ModuleRegistry,
  ClientSideRowModelModule,
  CellStyleModule,
  TooltipModule,
  EventApiModule,
  RowSelectionModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  CustomFilterModule,
  ValidationModule,
  RenderApiModule,
  ColumnAutoSizeModule,
  ColumnApiModule,
  RowApiModule,
  CsvExportModule,
} from 'ag-grid-community';

let registered = false;

/**
 * Register every AG Grid module the admin grids use. Idempotent — safe to call
 * from every grid component's module-init; the first call registers, the rest
 * short-circuit.
 */
export function registerAgGridModules(): void {
  if (registered) return;
  ModuleRegistry.registerModules([
    ClientSideRowModelModule,
    CellStyleModule,
    TooltipModule,
    EventApiModule,
    RowSelectionModule,
    PaginationModule,
    TextFilterModule,
    NumberFilterModule,
    DateFilterModule,
    CustomFilterModule,
    ValidationModule,
    RenderApiModule,
    ColumnAutoSizeModule,
    ColumnApiModule,
    RowApiModule,
    CsvExportModule,
  ]);
  registered = true;
}
