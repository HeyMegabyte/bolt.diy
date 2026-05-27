import type { Route } from '@angular/router';
import { dashboardRoutes } from '@org/dashboard';

/**
 * Top-level route table for `apps/web`. The dashboard is mounted at
 * `/dashboard`; legacy v1 paths (`/me`, `/work`, `/work/dashboard`)
 * redirect there so existing bookmarks + emails stay live.
 */
export const appRoutes: Route[] = [
  {
    path: 'dashboard',
    children: dashboardRoutes,
  },
  // Legacy redirects — v1 SPA mounted dashboards under /me and /work.
  { path: 'me', pathMatch: 'full', redirectTo: '/dashboard' },
  { path: 'me/:rest', redirectTo: '/dashboard' },
  { path: 'work', pathMatch: 'full', redirectTo: '/dashboard' },
  { path: 'work/dashboard', pathMatch: 'full', redirectTo: '/dashboard' },
  { path: 'work/dashboard/:rest', redirectTo: '/dashboard' },
  { path: 'work/:rest', redirectTo: '/dashboard' },
];
