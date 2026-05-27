/**
 * Lazy routes for `/dashboard/bookings/*`.
 */
import type { Routes } from '@angular/router';

export const bookingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./bookings-list/bookings-list.component').then(
        (m) => m.BookingsListComponent,
      ),
  },
];
