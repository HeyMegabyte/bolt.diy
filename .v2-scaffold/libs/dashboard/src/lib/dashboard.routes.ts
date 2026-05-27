import type { Routes } from '@angular/router';
import { superAdminGuard } from './guards/super-admin.guard';

/**
 * Single dashboard route table. Mounted at `/dashboard` by `apps/web`.
 *
 * Every feature route is lazy via `loadChildren` / `loadComponent` to
 * keep the initial chunk under the 250KB gz budget.
 *
 * @remarks Feature libs (`feature-bookings`, `feature-quotes`, …) are
 * currently scaffold stubs without `*.routes.ts` exports. The
 * `loadChildren` factories below resolve those once the foundation
 * lands — typed as `Promise<Routes>` so the router is satisfied today.
 */
export const dashboardRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard-shell/dashboard-shell.component').then(
        (m) => m.DashboardShellComponent,
      ),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./home/dashboard-home.component').then((m) => m.DashboardHomeComponent),
      },
      {
        path: 'bookings',
        loadChildren: () =>
          import('@org/feature-bookings').then((m) => m.bookingsRoutes),
      },
      {
        path: 'quotes',
        loadChildren: () =>
          import('@org/feature-quotes').then((m) => m.quotesRoutes),
      },
      {
        path: 'jobs',
        loadChildren: () =>
          import('@org/feature-jobs').then((m) => m.jobsRoutes),
      },
      {
        path: 'crew',
        loadChildren: () =>
          import('@org/feature-crew').then((m) => m.crewRoutes),
      },
      {
        path: 'sites',
        loadChildren: () =>
          import('@org/feature-sites').then((m) => m.sitesRoutes),
      },
      {
        path: 'billing',
        loadChildren: () =>
          import('@org/feature-billing').then((m) => m.FEATURE_BILLING_ROUTES),
      },
      {
        path: 'team',
        loadChildren: () =>
          import('@org/feature-team').then((m) => m.teamRoutes),
      },
      {
        path: 'integrations',
        loadChildren: () =>
          import('@org/feature-integrations').then((m) => m.integrationsRoutes),
      },
      {
        path: 'settings',
        loadChildren: () =>
          import('@org/feature-settings').then((m) => m.settingsRoutes),
      },
      {
        path: 'changelog',
        loadComponent: () =>
          import('./changelog/changelog.component').then((m) => m.ChangelogComponent),
      },
      {
        path: 'admin',
        canActivate: [superAdminGuard],
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
      },
    ],
  },
];
