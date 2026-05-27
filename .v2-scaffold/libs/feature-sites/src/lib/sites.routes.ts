/**
 * Lazy routes for `/dashboard/sites/*`.
 */
import type { Routes } from '@angular/router';

export const sitesRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./sites-list/sites-list.component').then(
        (m) => m.SitesListComponent,
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./site-detail/site-detail.component').then(
        (m) => m.SiteDetailComponent,
      ),
  },
];
