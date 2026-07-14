/**
 * `HoverPreloadingStrategy` — only preloads lazy chunks when the user hovers
 * over a sidebar link, rather than eagerly preloading ALL routes.
 *
 * Replaces `PreloadAllModules` in `app.config.ts`. The admin template calls
 * `preloadRoute(path)` on `mouseenter` of sidebar `<a>` links so the chunk
 * download is triggered by intent — the user gets an instant navigation
 * without the upfront bandwidth cost of loading every section at boot.
 *
 * Falls back to preloading the first two lazy routes after a 2-second idle
 * delay (the routes most likely navigated to next).
 */
import { Injectable } from '@angular/core';
import { type PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class HoverPreloadingStrategy implements PreloadingStrategy {
  /** Routes the user has hovered — preloaded on next idle. */
  private readonly queued = new Set<string>();

  /**
   * Called by the admin template on sidebar link hover.
   * Queues the route for preloading on the next idle tick.
   */
  preloadRoute(path: string): void {
    if (!path || path === '/admin') return;
    // Remove leading slash to match route paths
    const normalized = path.replace(/^\//, '');
    this.queued.add(normalized);
  }

  /**
   * Angular calls this for every lazy route. Only preloads routes that
   * have been explicitly queued via `preloadRoute()`, plus the first two
   * lazy routes after a 2-second idle delay for cold-start coverage.
   */
  preload(route: Route, load: () => Observable<void>): Observable<void> {
    const path = route.path ?? '';
    if (this.queued.has(path)) {
      this.queued.delete(path);
      return load();
    }
    // Idle preload: preload the first 2 non-admin routes after 2s
    if (path && this.queued.size === 0) {
      this.queued.add(path);
      return timer(2000).pipe(mergeMap(() => load()));
    }
    return of(void 0);
  }
}
