/**
 * Pure decision for where the homepage "start a website" funnel navigates after a
 * user picks a business (real or custom). Extracted from `HomepageComponent` so the
 * redundant-entry logic is deterministically unit-testable (mirrors the `claim-prefill`
 * pure-mapper pattern).
 *
 * WCAG 3.3.7 (Redundant Entry): the typed business name is carried forward so the owner
 * never re-types it — into `/create?name=` when signed in, and THROUGH sign-in via a
 * `returnUrl=/create?name=` when signed out (post-auth they land on /create and the
 * prefill fires). Without the signed-out branch the name was dropped at a bare `/signin`.
 */
export interface CreateFunnelNav {
  /** Router path to navigate to. */
  readonly path: string;
  /** Query params for the navigation (omitted when there are none). */
  readonly queryParams?: Readonly<Record<string, string>>;
}

/**
 * Resolve the funnel navigation target.
 *
 * @param name - the business name the user typed (custom path); undefined/blank for a
 *   selected real business (which rides `AuthService.setSelectedBusiness`).
 * @param isLoggedIn - whether the caller is authenticated.
 * @returns the `{ path, queryParams? }` to hand to `Router.navigate`.
 * @example
 * createFunnelNav('Acme', true);   // { path: '/create', queryParams: { name: 'Acme' } }
 * createFunnelNav('Acme', false);  // { path: '/signin', queryParams: { returnUrl: '/create?name=Acme' } }
 * createFunnelNav(undefined, false); // { path: '/signin' }
 */
export function createFunnelNav(name: string | undefined, isLoggedIn: boolean): CreateFunnelNav {
  const trimmed = (name ?? '').trim();
  if (isLoggedIn) {
    return trimmed ? { path: '/create', queryParams: { name: trimmed } } : { path: '/create' };
  }
  return trimmed
    ? { path: '/signin', queryParams: { returnUrl: `/create?name=${encodeURIComponent(trimmed)}` } }
    : { path: '/signin' };
}
