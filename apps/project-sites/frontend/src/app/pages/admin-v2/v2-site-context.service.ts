/**
 * @module pages/admin-v2/v2-site-context
 *
 * Shared site-selection state for the v2 cockpit — the v2 analogue of the legacy
 * admin's `AdminStateService` Project/URL switchers. Holds the site list, the
 * selected site (Project dropdown), and that site's URLs (URL dropdown). The
 * per-site editor sections read `selectedSite()` / `selectedUrl()` so switching
 * the Project re-targets the whole editor — mirroring projectsites.dev/admin.
 * `providedIn: 'root'` so selection persists across v2 section navigation.
 *
 * @example
 * private ctx = inject(V2SiteContextService);
 * site = this.ctx.selectedSite; // signal<Site | null>
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { ApiService, type Site, type Hostname } from '../../services/api.service';

@Injectable({ providedIn: 'root' })
export class V2SiteContextService {
  private readonly api = inject(ApiService);

  /** All sites in the org (the Project dropdown options). */
  readonly sites = toSignal(
    this.api.listSites().pipe(
      map((r) => r.data ?? []),
      catchError(() => of([] as Site[])),
    ),
    { initialValue: [] as Site[] },
  );

  readonly selectedSiteId = signal<string | null>(null);

  /** Selected site — falls back to the first site when nothing is pinned. */
  readonly selectedSite = computed<Site | null>(() => {
    const id = this.selectedSiteId();
    const list = this.sites();
    if (id) return list.find((s) => s.id === id) ?? list[0] ?? null;
    return list[0] ?? null;
  });

  /**
   * Hostnames for the selected site (the URL dropdown options), reactive on
   * selection. Uses `getHostnames` (the canonical Domains route) rather than
   * `/urls` — the latter 404s for sites without that admin feature.
   */
  private readonly urlsRaw = toSignal(
    toObservable(this.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getHostnames(site.id).pipe(
              map((r) => r.data ?? []),
              catchError(() => of([] as Hostname[])),
            )
          : of([] as Hostname[]),
      ),
    ),
    { initialValue: [] as Hostname[] },
  );
  readonly urls = computed(() => this.urlsRaw());

  readonly selectedUrlId = signal<string | null>(null);

  /** Selected hostname — falls back to the primary, then the first. */
  readonly selectedUrl = computed<Hostname | null>(() => {
    const id = this.selectedUrlId();
    const list = this.urls();
    if (id) return list.find((u) => u.id === id) ?? null;
    return list.find((u) => u.is_primary) ?? list[0] ?? null;
  });

  selectSite(id: string): void {
    this.selectedSiteId.set(id);
    this.selectedUrlId.set(null); // reset URL pin so it re-defaults to primary
  }

  selectUrl(id: string): void {
    this.selectedUrlId.set(id);
  }
}
