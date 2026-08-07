import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// AG Grid module registration moved OUT of this eager bootstrap into the
// lazy-only `app/pages/admin/sections/_ag-grid-setup.ts` (imported solely by the
// lazy audit + ai-logs grid routes) so esbuild no longer hoists ag-grid-community
// (~782 KB) into the INITIAL bundle. See docs/perf-wave-ag-grid-to-tanstack.md.

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
