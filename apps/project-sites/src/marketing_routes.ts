/**
 * Known top-level marketing SPA route prefixes — the SSOT the Worker uses to
 * decide 200 (real route) vs a 404-status soft-404 (unknown route = SEO junk).
 *
 * Before this, the base-domain marketing serve returned `200 marketing/index.html`
 * for EVERY non-file path — so `/garbage9999` indexed as a live 200 (a soft-404
 * that pollutes search + AI crawlers). Now an unknown top-level segment is served
 * the SPA shell with a real `404` status + `noindex` (the SPA still renders its
 * own 404 view; belt-and-suspenders for crawlers).
 *
 * ⚠️ MUST stay in lock-step with the Angular router
 * (`frontend/src/app/app.routes.ts` top-level `path:` entries). A route present
 * there but MISSING here would be served a 404 status (breaking a real page).
 * `src/__tests__/marketing_routes.test.ts` parses app.routes.ts and fails the
 * build if the two drift.
 */

/** Valid first path-segment of every public marketing SPA route (`''` = home). */
export const KNOWN_MARKETING_PREFIXES: ReadonlySet<string> = new Set([
  '', // home '/'
  'classic',
  'search',
  'pricing',
  'shared', // shared/analytics/:token
  'signin',
  'auth', // auth/sign-in, auth/2fa/*, …
  'create',
  'details',
  'waiting',
  'admin', // + all authed admin/* children
  'editor', // editor/:slug
  'privacy',
  'terms',
  'content',
  'billing',
  'blog', // blog, blog/:slug
  'changelog',
  'review', // review/:id
  'developers',
  'oauth', // oauth/consent
  'integrations',
  'roadmap',
  'press',
  'checkout',
  'error',
  'offline',
]);

/**
 * True when `pathname` maps to a real marketing SPA route (so serving the shell
 * with a 200 is correct). Unknown → the caller serves the shell with 404 status.
 *
 * @param pathname - URL pathname, e.g. `'/'`, `'/blog/foo'`, `'/garbage9999'`.
 * @returns whether the first path segment is a known marketing route prefix.
 * @example
 * isKnownMarketingRoute('/');            // true  (home)
 * isKnownMarketingRoute('/blog/hello');  // true  (blog/:slug)
 * isKnownMarketingRoute('/garbage9999'); // false → soft-404
 */
export function isKnownMarketingRoute(pathname: string): boolean {
  const first = pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  return KNOWN_MARKETING_PREFIXES.has(first);
}
