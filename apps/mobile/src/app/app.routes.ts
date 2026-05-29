import type { Routes } from '@angular/router';

export const APP_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/launch.page').then((m) => m.LaunchPage),
  },
  {
    path: 'offline',
    loadComponent: () =>
      import('./pages/offline.page').then((m) => m.OfflinePage),
  },
  { path: '**', redirectTo: '' },
];
