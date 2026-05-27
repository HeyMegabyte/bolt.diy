/**
 * Mobile route table — mounts the shared dashboard at `/dashboard` and
 * preserves the legacy v1 paths so existing magic links + saved bookmarks
 * still land users in the right place.
 */
import type { Route } from '@angular/router';
import { dashboardRoutes } from '@org/dashboard';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: '/dashboard' },
  {
    path: 'dashboard',
    children: dashboardRoutes,
  },
  // Legacy v1 redirects — magic-link emails, push notifications, share-target.
  { path: 'me', pathMatch: 'full', redirectTo: '/dashboard' },
  { path: 'me/:rest', redirectTo: '/dashboard' },
  { path: 'work', pathMatch: 'full', redirectTo: '/dashboard' },
  { path: 'work/dashboard', pathMatch: 'full', redirectTo: '/dashboard' },
  { path: 'work/dashboard/:rest', redirectTo: '/dashboard' },
];
