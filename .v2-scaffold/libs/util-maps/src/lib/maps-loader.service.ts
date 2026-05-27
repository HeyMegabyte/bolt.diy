/**
 * Single Google Maps JavaScript API loader. Singleton.
 *
 * @remarks
 * Doctrine §18 regression: the quote page used to inject the Maps SDK
 * every time the wizard hit the Location step; the second injection
 * raced the first and exploded into "google is not defined". This
 * service guarantees one `<script>` tag per session and emits the
 * cached `google` global to every subsequent caller through
 * {@link MapsLoaderService.load$}.
 *
 * @example
 * ```ts
 * import { MapsLoaderService } from '@org/util-maps';
 * constructor(private readonly maps: MapsLoaderService) {}
 *
 * ngOnInit() {
 *   this.maps.load$().subscribe((g) => {
 *     this.map = new g.maps.Map(this.host.nativeElement, {
 *       center: { lat: 40.7357, lng: -74.1724 },
 *       zoom: 14,
 *     });
 *   });
 * }
 * ```
 *
 * @throws `Error('GOOGLE_MAPS_API_KEY missing')` when the env binding
 *         is absent. Callers must surface a friendly fallback rather
 *         than crashing the parent route.
 */
import { Injectable, InjectionToken, Optional, inject } from '@angular/core';
import { Observable, defer, from, shareReplay } from 'rxjs';

/**
 * Inject token for the Google Maps API key. The host app provides it
 * at bootstrap via:
 * ```ts
 * { provide: GOOGLE_MAPS_API_KEY, useValue: env.GOOGLE_MAPS_API_KEY }
 * ```
 */
export const GOOGLE_MAPS_API_KEY = new InjectionToken<string>(
  'GOOGLE_MAPS_API_KEY'
);

export interface GoogleMapsLoadOptions {
  /** Comma-separated additional libraries (e.g. 'places,geometry'). */
  libraries?: readonly string[];
  /** SDK version (default 'weekly'). */
  version?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var google: typeof globalThis.google | undefined;
}

@Injectable({ providedIn: 'root' })
export class MapsLoaderService {
  private readonly key = inject(GOOGLE_MAPS_API_KEY, { optional: true });
  private cached$: Observable<typeof google> | null = null;

  /**
   * Returns a shared `Observable<typeof google>` that completes once
   * the SDK is ready. Multiple subscribers reuse the same load. After
   * the first success the observable is replayed synchronously.
   */
  load$(opts: GoogleMapsLoadOptions = {}): Observable<typeof google> {
    if (this.cached$) return this.cached$;
    this.cached$ = defer(() => from(this.loadOnce(opts))).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.cached$;
  }

  /** Promise-flavoured façade for non-Rx callers. */
  load(opts: GoogleMapsLoadOptions = {}): Promise<typeof google> {
    return this.loadOnce(opts);
  }

  private existing?: Promise<typeof google>;

  private loadOnce(opts: GoogleMapsLoadOptions): Promise<typeof google> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('Maps loader is browser-only'));
    }
    if (typeof globalThis.google !== 'undefined') {
      return Promise.resolve(globalThis.google as typeof google);
    }
    if (this.existing) return this.existing;
    if (!this.key) {
      return Promise.reject(new Error('GOOGLE_MAPS_API_KEY missing'));
    }

    const libs = (opts.libraries ?? ['places']).join(',');
    const version = opts.version ?? 'weekly';
    const callbackName = `__mapsLoaderCb_${Date.now().toString(36)}`;

    this.existing = new Promise<typeof google>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-maps-loader="1"]'
      );
      if (existingScript) {
        // Another loader instance already attached; poll the global.
        const wait = (): void => {
          if (typeof globalThis.google !== 'undefined') {
            resolve(globalThis.google as typeof google);
          } else setTimeout(wait, 60);
        };
        wait();
        return;
      }

      (window as unknown as Record<string, unknown>)[callbackName] = () => {
        delete (window as unknown as Record<string, unknown>)[callbackName];
        if (typeof globalThis.google === 'undefined') {
          reject(new Error('Maps SDK loaded but `google` is undefined'));
        } else {
          resolve(globalThis.google as typeof google);
        }
      };

      const s = document.createElement('script');
      s.async = true;
      s.defer = true;
      s.dataset['mapsLoader'] = '1';
      s.src =
        'https://maps.googleapis.com/maps/api/js' +
        `?key=${encodeURIComponent(this.key as string)}` +
        `&v=${encodeURIComponent(version)}` +
        `&libraries=${encodeURIComponent(libs)}` +
        `&callback=${callbackName}`;
      s.onerror = () =>
        reject(new Error('Google Maps SDK failed to load (network)'));
      document.head.appendChild(s);
    });

    return this.existing;
  }
}

/** Test seam — resets the singleton between specs. */
export function __resetMapsLoaderForTests(svc: MapsLoaderService): void {
  type T = MapsLoaderService & { cached$: unknown; existing: unknown };
  (svc as unknown as T).cached$ = null;
  (svc as unknown as T).existing = undefined;
  if (typeof window !== 'undefined') {
    document
      .querySelectorAll('script[data-maps-loader="1"]')
      .forEach((el) => el.remove());
  }
}

// Keep optional-injection lint happy.
export const __OPTIONAL_KEY_TYPE: Optional | undefined = undefined;
