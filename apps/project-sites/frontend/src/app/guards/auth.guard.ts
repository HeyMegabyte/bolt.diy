import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Functional route guard — blocks unauthenticated access to admin/billing
 * routes and redirects to `/signin` with a `returnUrl` query param so the
 * post-signin handoff lands the user on the route they originally requested.
 *
 * @remarks
 * - Reads {@link AuthService.isLoggedIn} which derives from the persisted
 *   `ps_session` localStorage entry (TTL-checked at read-time).
 * - On denial, returns a `UrlTree` rather than `false` so Angular performs the
 *   navigation atomically — avoids the flash-of-protected-content that a
 *   boolean-false + `navigate()` two-step would cause.
 *
 * @example
 * ```ts
 * // app.routes.ts
 * { path: 'admin', loadComponent: () => import('./admin'), canActivate: [authGuard] }
 * ```
 *
 * @returns `true` when a non-expired session is present, otherwise a `UrlTree`
 *   pointing at `/signin?returnUrl=<currentUrl>`.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;
  }

  return router.createUrlTree(['/signin'], {
    queryParams: { returnUrl: router.url },
  });
};
