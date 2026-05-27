/**
 * Lazy routes for `/dashboard/crew`.
 */
import type { Routes } from '@angular/router';

export const crewRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./crew-shell/crew-shell.component').then(
        (m) => m.CrewShellComponent,
      ),
  },
];
