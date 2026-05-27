/**
 * authGuard — `canActivate` checks the user is signed in.
 *
 * @remarks
 * Reads `AuthService.currentUser()` (signal). If `null`, redirects to
 * `/login?next=<intended-url>`. The `next` param is consumed by
 * {@link LoginPageComponent} on successful sign-in.
 *
 * @example
 * ```ts
 * export const routes: Routes = [
 *   {
 *     path: 'app',
 *     canActivate: [authGuard],
 *     loadChildren: () => import('@org/dashboard').then(m => m.routes),
 *   },
 * ];
 * ```
 */
import { inject } from '@angular/core';
import { type CanActivateFn, Router, type UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service.js';

export const authGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser() !== null) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: { next: state.url },
  });
};
