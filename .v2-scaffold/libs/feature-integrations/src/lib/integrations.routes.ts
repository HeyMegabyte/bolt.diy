/**
 * Lazy routes for `/dashboard/integrations`.
 */
import type { Routes } from '@angular/router';

export const integrationsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./integrations-marketplace/integrations-marketplace.component').then(
        (m) => m.IntegrationsMarketplaceComponent,
      ),
  },
];
