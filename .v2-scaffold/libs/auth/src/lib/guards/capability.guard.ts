/**
 * capabilityGuard — `canActivate` factory requiring a capability set.
 *
 * @remarks
 * The server is the security boundary — this guard short-circuits the
 * client navigation to skip a render that would only ever 403. ALL of
 * the listed capabilities must be present (AND semantics).
 *
 * @example
 * ```ts
 * {
 *   path: 'billing',
 *   canActivate: [authGuard, capabilityGuard(['billing:read'])],
 *   loadComponent: () => import('@org/feature-billing').then(m => m.BillingPage),
 * }
 * ```
 */
import { inject } from '@angular/core';
import { type CanActivateFn, Router, type UrlTree } from '@angular/router';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Capability } from '@org/domain';
import { RoleService } from '../services/role.service.js';

export const capabilityGuard = (required: readonly Capability[]): CanActivateFn => {
  return (_route, _state): boolean | UrlTree => {
    const role = inject(RoleService);
    const router = inject(Router);
    const have = role.capabilities();

    const missing = required.filter((cap) => !have.includes(cap));

    if (missing.length === 0) {
      return true;
    }

    return router.createUrlTree(['/forbidden'], {
      queryParams: { missing: missing.join(',') },
    });
  };
};
