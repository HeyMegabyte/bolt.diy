/**
 * Lazy routes for `/dashboard/jobs/*`.
 */
import type { Routes } from '@angular/router';

export const jobsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./jobs-list.component').then((m) => m.JobsListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./job-detail.component').then((m) => m.JobDetailComponent),
  },
];
