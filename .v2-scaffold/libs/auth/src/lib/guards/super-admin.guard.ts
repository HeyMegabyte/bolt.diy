/**
 * superAdminGuard — gates `/operator/*` routes on `isSuperAdmin`.
 *
 * @remarks
 * Server-verified: `Me.isSuperAdmin` is set by the control-plane based
 * on `user.email === env.SUPER_ADMIN_EMAIL`. The client guard is a UX
 * accelerator only — every super-admin endpoint MUST re-check
 * server-side.
 */
import { inject } from '@angular/core';
import { type CanActivateFn, Router, type UrlTree } from '@angular/router';
import { RoleService } from '../services/role.service.js';

export const superAdminGuard: CanActivateFn = (_route, _state): boolean | UrlTree => {
  const role = inject(RoleService);
  const router = inject(Router);

  if (role.isSuperAdmin()) {
    return true;
  }

  return router.createUrlTree(['/forbidden']);
};
