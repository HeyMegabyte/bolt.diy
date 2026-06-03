import { inject } from '@angular/core';
import { type CanActivateFn, type RouterStateSnapshot, Router } from '@angular/router';
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
 *   pointing at `/signin?returnUrl=<requestedUrl>`.
 */
export const authGuard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;
  }

  // Use the TARGET url (state.url) being navigated to — NOT router.url, which is
  // still the previous/current route mid-navigation. Reading router.url here
  // captured the wrong page (e.g. '/' instead of '/admin'), bouncing the user to
  // the homepage after signin instead of back to the route they requested.
  return router.createUrlTree(['/signin'], {
    queryParams: { returnUrl: state.url },
  });
};
