/**
 * authInterceptor — attaches credentials to every outbound API call.
 *
 * @remarks
 * Session cookies are `httpOnly` so we cannot add an `Authorization`
 * header from JS land. What we DO need is `withCredentials: true` so the
 * browser actually sends the cookie cross-origin to `api.projectsites.dev`
 * from the SSR-rendered front-end.
 *
 * If/when we move to bearer tokens (`Authorization: Bearer ...`), this
 * is the canonical place to inject them. For now: cookie semantics only.
 */
import { type HttpHandlerFn, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';

/** Routes whose host should match the API origin; only credential-bearing calls. */
const API_PATH_PREFIX = '/api/';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const isApiCall =
    req.url.startsWith(API_PATH_PREFIX) ||
    req.url.includes('api.projectsites.dev');

  if (!isApiCall) {
    return next(req);
  }

  return next(
    req.clone({
      withCredentials: true,
    }),
  );
};
