import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// ag-grid was fully removed 2026-08-20 (perf-wave ag-grid→TanStack, see
// docs/perf-wave-ag-grid-to-tanstack.md) — the audit + traces grids are
// TanStack Table now, and this eager bootstrap never registered grid modules.

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
