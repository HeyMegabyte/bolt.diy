import { inject } from '@angular/core';
import { type CanActivateFn, Router, type UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isSysAdminEmail } from '../pages/admin/sys-admin';

/**
 * Functional route guard for the **System Administrator** layer
 * (`/admin/feature-flags`).
 *
 * Admits only platform operators (see {@link isSysAdminEmail}); every other
 * signed-in site owner is redirected to their own owner-facing Features layer
 * (`/admin/site-features`) so a direct URL never exposes the platform-ops
 * control plane.
 *
 * @remarks
 * - Runs AFTER {@link authGuard} on the admin route tree, so an active session
 *   is already guaranteed; this guard only narrows to sys-admin identities.
 * - Returns a `UrlTree` (not `false`) so Angular performs the redirect
 *   atomically — no flash-of-protected-content.
 * - This is a UX guard. The worker independently authorizes every
 *   `/api/feature-flags` mutation; never rely on this alone for security.
 *
 * @example
 * { path: 'feature-flags', canActivate: [sysAdminGuard], loadComponent: ... }
 */
export const sysAdminGuard: CanActivateFn = (): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (isSysAdminEmail(auth.email())) return true;
  return router.parseUrl('/admin/site-features');
};
