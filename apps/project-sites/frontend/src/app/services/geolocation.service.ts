/**
 * @module services/geolocation
 *
 * @description
 * Thin wrapper around `navigator.geolocation` for the "find nearby businesses"
 * affordance on the create-site flow. Exposes the coords as signals so the
 * search component can re-query Places when the user grants permission.
 *
 * @remarks
 * - Never throws — `requestLocation` resolves `false` on permission denied,
 *   no-geolocation-API, or timeout. The caller decides whether to surface that.
 * - Tuned for "good enough" city-level results: `enableHighAccuracy: false`
 *   (skips GPS warm-up on mobile), 8s timeout, 5min `maximumAge` cache.
 */
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** Latitude in decimal degrees — `null` until {@link requestLocation} resolves. */
  readonly lat = signal<number | null>(null);
  /** Longitude in decimal degrees — `null` until {@link requestLocation} resolves. */
  readonly lng = signal<number | null>(null);
  /** True once both `lat` and `lng` are populated. */
  readonly hasLocation = signal(false);

  /**
   * Prompt the browser for the current position, populate the signals on
   * success, and resolve to `true`. Resolves `false` on denial/timeout/API
   * missing — the caller is expected to fall back to a default location or
   * an IP-derived hint.
   *
   * @returns Promise that resolves `true` on success, `false` on any failure.
   *
   * @example
   * ```ts
   * const ok = await geo.requestLocation();
   * if (!ok) auth.setLocationDeclined();
   * ```
   */
  requestLocation(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.lat.set(pos.coords.latitude);
          this.lng.set(pos.coords.longitude);
          this.hasLocation.set(true);
          resolve(true);
        },
        () => resolve(false),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });
  }

  /**
   * Great-circle distance between two coordinates using the Haversine formula.
   *
   * @param lat1 - Origin latitude (decimal degrees).
   * @param lng1 - Origin longitude (decimal degrees).
   * @param lat2 - Destination latitude (decimal degrees).
   * @param lng2 - Destination longitude (decimal degrees).
   * @returns Distance in statute miles. Always positive.
   *
   * @example
   * ```ts
   * // Manhattan to Newark
   * geo.distanceMiles(40.7831, -73.9712, 40.7357, -74.1724); // → ~9.5
   * ```
   */
  distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8; // Earth radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Format a distance for UI display: `< 0.1 mi` / `0.X mi` / `XX mi` thresholds.
   *
   * @example
   * geo.formatDistance(0.05)  // '< 0.1 mi'
   * geo.formatDistance(2.34)  // '2.3 mi'
   * geo.formatDistance(42.7)  // '43 mi'
   */
  formatDistance(miles: number): string {
    if (miles < 0.1) return '< 0.1 mi';
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }

  /** Convert degrees to radians (internal Haversine helper). */
  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
