import type { Routes } from '@angular/router';

export const quotesRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./quote-wizard.component.js').then((m) => m.QuoteWizardComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./quote-detail.component.js').then((m) => m.QuoteDetailComponent),
  },
];
