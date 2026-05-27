import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { MeStore } from '../services/me.store';

/**
 * Blocks non–super-admins from `/dashboard/admin/**`. Redirects to the
 * dashboard home so the URL never lingers in browser history with a
 * deny screen.
 */
export const superAdminGuard: CanActivateFn = () => {
  const me = inject(MeStore);
  const router = inject(Router);
  if (me.isSuperAdmin()) return true;
  void router.navigate(['/dashboard']);
  return false;
};
