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

  /** Test-only — invalidate the cache after an admin toggles a flag. */
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
 * @example
 *   {
 *     path: 'editor-native',
 *     canActivate: [featureFlagGuard('native_editor')],
 *     loadComponent: () => import('./editor-native/...').then(m => m.X),
 *   }
 */
export function featureFlagGuard(key: string): CanActivateFn {
  return () => {
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
