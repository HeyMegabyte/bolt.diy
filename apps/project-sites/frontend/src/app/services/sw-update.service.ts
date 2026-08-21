/**
 * @module services/sw-update
 *
 * @description
 * Keeps the Angular service worker from stranding a browser on a stale version.
 *
 * The failure this prevents (Brian, 2026-08-20): a fix was built + deployed, but
 * the OLD service worker on the browser kept serving the OLD app bundle AND its
 * OLD `/api/*` freshness caching — so `/api/analytics/:siteId` was still being
 * intercepted + rejected (`ngsw-worker.js DataGroup.safeFetch → Failed to fetch`)
 * and the `/admin/editor` shell never bound its site, weeks after the fix shipped.
 * Angular's SW downloads a new version but only ACTIVATES it once every tab
 * closes — unless the app explicitly activates it. There was no such handler.
 *
 * This service:
 * - activates a ready update and reloads, so a deployed fix reaches the user on
 *   their next visit instead of never;
 * - reloads on an UNRECOVERABLE service-worker state (a corrupt SW self-heals);
 * - polls for updates once the app is stable, every 60s, and whenever the tab
 *   returns to the foreground — so long-lived admin tabs don't drift stale.
 *
 * @remarks Deploys are infrequent + this is a solo-operator admin, so an
 * occasional activate-and-reload on a fresh deploy is an acceptable trade for
 * never being stranded on a broken/stale worker.
 */
import { ApplicationRef, Injectable, inject } from '@angular/core';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { concat, interval } from 'rxjs';
import { filter, first } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);
  private reloading = false;

  /**
   * Wire the update lifecycle. Safe no-op when the service worker is disabled
   * (dev mode / unsupported browser). Idempotent — call once at bootstrap.
   *
   * @example provideEnvironmentInitializer(() => inject(SwUpdateService).init())
   */
  init(): void {
    if (!this.updates.isEnabled || typeof document === 'undefined') return;

    // A corrupt / unrecoverable worker → hard reload fetches a clean one.
    this.updates.unrecoverable.subscribe(() => this.reload());

    // New version downloaded + ready → activate it and reload so the browser
    // stops running the stale bundle. Fires at most once per real version bump.
    this.updates.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        this.updates.activateUpdate().then(
          () => this.reload(),
          () => {
            /* activation raced another tab — the next check retries */
          },
        );
      });

    // Poll: once the app first stabilizes, then every 60s.
    const appStable$ = this.appRef.isStable.pipe(first((stable) => stable));
    concat(appStable$, interval(60_000)).subscribe(() => this.check());

    // And whenever a backgrounded admin tab returns to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.check();
    });
  }

  private check(): void {
    this.updates.checkForUpdate().catch(() => {
      /* offline / transient — next tick retries */
    });
  }

  private reload(): void {
    if (this.reloading) return;
    this.reloading = true;
    document.location.reload();
  }
}
