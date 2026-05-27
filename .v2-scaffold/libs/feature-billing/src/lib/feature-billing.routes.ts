/**
 * Lazy routes for `/dashboard/billing/*`.
 */
import type { Routes } from '@angular/router';

export const FEATURE_BILLING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./billing-page/billing-page.component').then(
        (m) => m.BillingPageComponent,
      ),
  },
  {
    path: 'receipts',
    loadComponent: () =>
      import('./receipts-page/receipts-page.component').then(
        (m) => m.ReceiptsPageComponent,
      ),
  },
  {
    path: 'connect',
    loadComponent: () =>
      import('./connect-onboarding/connect-onboarding.component').then(
        (m) => m.ConnectOnboardingComponent,
      ),
  },
];
