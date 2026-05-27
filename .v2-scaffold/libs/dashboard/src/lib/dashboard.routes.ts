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
        loadChildren: (): Promise<Routes> =>
          // TODO: lock in once the foundation lands — `@org/feature-bookings`
          // is currently a scaffold stub; replace with its `bookingsRoutes`.
          Promise.resolve<Routes>([]),
      },
      {
        path: 'quotes',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
        // TODO: lock in once the foundation lands — add child route
        // `:id → feature-quotes/QuoteDetailComponent` here.
      },
      {
        path: 'jobs',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
        // TODO: child `:id → feature-jobs/JobDetailComponent`.
      },
      {
        path: 'crew',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
      },
      {
        path: 'sites',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
        // TODO: child `:id → feature-sites/SiteDetailComponent`.
      },
      {
        path: 'billing',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
      },
      {
        path: 'team',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
      },
      {
        path: 'integrations',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
      },
      {
        path: 'settings',
        loadChildren: (): Promise<Routes> => Promise.resolve<Routes>([]),
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
