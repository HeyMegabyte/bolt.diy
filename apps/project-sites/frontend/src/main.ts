import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

/**
 * AG Grid v33+ moved from a single all-modules bundle to a modular
 * registration model. Register the modules our grids actually use
 * (cell styling, tooltips, runtime event API, client-side row model)
 * once at bootstrap so individual grid components don't each have to
 * repeat the registration. Without this every grid logs error #200 for
 * `cellClass`, `cellStyle`, `tooltipValueGetter`, and `api.addEventListener`.
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
  RowApiModule,
  CsvExportModule,
} from 'ag-grid-community';

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
  RowApiModule,
  CsvExportModule,
]);

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
