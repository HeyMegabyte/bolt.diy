/**
 * @module services/feature-flag
 * @description Client-side feature-flag resolver.
 *
 * Mirrors the worker's KV-cached `/api/feature-flags/:key` endpoint and
 * exposes:
 *   - `FeatureFlagService.isOn(key)` — Observable<boolean>
 *   - `featureFlagGuard(key)` — Angular `CanActivateFn` that redirects to
 *     `/admin/feature-flags?disabled=<key>` when the flag is off.
 *
 * RxJS-first per `[[rxjs-first-angular]]` — every flag check is an
 * Observable composed via `shareReplay({ bufferSize: 1, refCount: true })`
 * so concurrent guard checks dedup to one HTTP call per (flag, session).
 *
 * Cross-link: `apps/project-sites/src/modules/feature_flags/registry.ts`
 */
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';

interface FlagResolution {
  resolved: {
    enabled: boolean;
    rollout_percent: number;
    stage: string;
    source: 'override' | 'registry' | 'default';
  };
}

@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<boolean>>();

  /**
   * Cached observable per flag key. First call fires the HTTP request;
   * subsequent calls share the cached result for the session.
   *
   * Closed = flag off. Open = flag on. Network errors resolve to `false`
   * (fail-safe — never open a gated feature on transport failure).
   */
  isOn(key: string): Observable<boolean> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const obs = this.http
      .get<FlagResolution>(`/api/feature-flags/${encodeURIComponent(key)}`)
      .pipe(
        map((res) => res.resolved?.enabled ?? false),
        catchError(() => of(false)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    this.cache.set(key, obs);
    return obs;
  }

  /** Invalidate the cache after an admin toggles a flag (wired in the
   *  /admin/feature-flags toggle) so guards + isOn() re-fetch fresh state. */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}

/**
 * Route guard factory. Returns a `CanActivateFn` that admits the user when
 * the flag is on; redirects to `/admin/feature-flags?disabled=<key>` when
 * off. Fail-safe on network error (treats as off).
 *
 * Optional `opts` enable a **developer local opt-in** so a dark feature stays
 * previewable by URL without flipping the server flag (and without exposing it
 * to anyone who doesn't opt in). When `opts.queryParam` is present in the URL
 * (`?<param>=1`) OR `opts.localOptInKey` is `'true'` in `localStorage`, the
 * guard admits immediately, bypassing the server flag. The `queryParam` match
 * persists the `localOptInKey` (done inside the target component) so later
 * visits without the param still resolve.
 *
 * @example
 *   {
 *     path: 'editor-native',
 *     canActivate: [featureFlagGuard('native_editor', {
 *       localOptInKey: 'editor.native', queryParam: 'native',
 *     })],
 *     loadComponent: () => import('./editor-native/...').then(m => m.X),
 *   }
 */
export function featureFlagGuard(
  key: string,
  opts?: { localOptInKey?: string; queryParam?: string },
): CanActivateFn {
  return (route) => {
    // Developer/local opt-in bypass: a declared opt-in that's active admits
    // WITHOUT the server flag so the dark feature stays previewable by URL.
    // Everyone who doesn't opt in still hits the flag gate below. The target
    // component is expected to re-honor the same opt-in for its own rendering.
    if (opts?.queryParam || opts?.localOptInKey) {
      const qp = opts.queryParam ? route.queryParamMap.get(opts.queryParam) : null;
      const queryOptIn = qp === '1' || qp === 'true';
      let storedOptIn = false;
      if (opts.localOptInKey) {
        try {
          storedOptIn = localStorage.getItem(opts.localOptInKey) === 'true';
        } catch {
          // Private mode / SSR — no local opt-in available.
        }
      }
      if (queryOptIn || storedOptIn) return of(true);
    }

    const svc = inject(FeatureFlagService);
    const router = inject(Router);
    return svc.isOn(key).pipe(
      map((on) => {
        if (on) return true;
        return router.createUrlTree(['/admin/feature-flags'], {
          queryParams: { disabled: key },
        });
      }),
    );
  };
}
