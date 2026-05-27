/**
 * DispatchService — RxJS-first surge + dispatch data-access (backlog #17).
 *
 * @remarks
 * `surge$(geohash)` polls `/api/dispatch/surge/:geohash` every 30s. Frontend
 * job-detail map overlays the multiplier + demand/supply indices on top of
 * Google Maps / Leaflet heat layer.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type Observable,
  catchError,
  of,
  repeat,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

export interface SurgeSnapshot {
  readonly geohash: string;
  readonly multiplier: number;
  readonly demand_index: number;
  readonly supply_index: number;
  readonly reason: string;
  readonly computed_at: string;
}

const POLL_MS = 30_000;
const DEFAULT_SNAPSHOT: SurgeSnapshot = {
  geohash: '',
  multiplier: 1,
  demand_index: 0,
  supply_index: 0,
  reason: 'Normal pricing',
  computed_at: '',
};

@Injectable({ providedIn: 'root' })
export class DispatchService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<SurgeSnapshot>>();

  /**
   * Live surge multiplier for a geohash tile. Cached per geohash so multiple
   * map overlays share one HTTP poll.
   */
  surge$(geohash: string): Observable<SurgeSnapshot> {
    const existing = this.cache.get(geohash);
    if (existing) return existing;
    const stream = this.http
      .get<SurgeSnapshot>(`/api/dispatch/surge/${encodeURIComponent(geohash)}`)
      .pipe(
        catchError(() => of<SurgeSnapshot>({ ...DEFAULT_SNAPSHOT, geohash })),
        repeat({ delay: POLL_MS }),
        startWith({ ...DEFAULT_SNAPSHOT, geohash }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    this.cache.set(geohash, stream);
    return stream;
  }

  /** Prod the per-tenant dispatch optimizer to run immediately. */
  kick$(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/dispatch/kick', {});
  }

  /**
   * Encode (lat, lng) to a geohash of the requested precision. Default
   * precision 5 ≈ 4.9 km × 4.9 km tile.
   */
  encodeGeohash(lat: number, lng: number, precision = 5): string {
    return encodeGeohash(lat, lng, precision);
  }
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function encodeGeohash(lat: number, lng: number, precision: number): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let bit = 0;
  let ch = 0;
  let isEven = true;
  let out = '';
  while (out.length < precision) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        minLng = mid;
      } else {
        ch = ch << 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        minLat = mid;
      } else {
        ch = ch << 1;
        maxLat = mid;
      }
    }
    isEven = !isEven;
    bit += 1;
    if (bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}
