/**
 * Lazy routes for `/dashboard/settings`.
 */
import type { Routes } from '@angular/router';

export const settingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./settings-shell/settings-shell.component').then(
        (m) => m.SettingsShellComponent,
      ),
  },
];
