/**
 * Lazy routes for `/dashboard/team`.
 */
import type { Routes } from '@angular/router';

export const teamRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./team-page/team-page.component').then((m) => m.TeamPageComponent),
  },
];
