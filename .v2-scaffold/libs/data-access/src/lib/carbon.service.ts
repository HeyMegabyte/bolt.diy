/**
 * `CarbonService` — per-job carbon footprint (backlog #42).
 *
 * @remarks
 *  Wraps `POST /api/jobs/:id/carbon` (estimate + persist) and
 *  `GET /api/jobs/:id/carbon` (latest). RxJS-first.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, shareReplay } from 'rxjs';

export type VehicleType =
  | 'gas'
  | 'electric'
  | 'pickup'
  | 'van'
  | 'hybrid';

export interface CarbonEstimate {
  readonly job_id: string;
  readonly co2_kg: number;
  readonly distance_miles?: number;
  readonly vehicle_type?: VehicleType;
  readonly duration_hours?: number;
  readonly equivalent_text: string;
  readonly factors_version: string;
  readonly offset_cents: number;
  readonly offset_url?: string;
}

export interface EstimateCarbonPayload {
  readonly distance_miles: number;
  readonly vehicle_type: VehicleType;
  readonly duration_hours: number;
}

@Injectable({ providedIn: 'root' })
export class CarbonService {
  private readonly http = inject(HttpClient);

  estimate$(
    jobId: string,
    payload: EstimateCarbonPayload,
  ): Observable<CarbonEstimate> {
    return this.http.post<CarbonEstimate>(
      `/api/jobs/${encodeURIComponent(jobId)}/carbon`,
      payload,
    );
  }

  current$(jobId: string): Observable<CarbonEstimate | null> {
    return this.http
      .get<CarbonEstimate | null>(`/api/jobs/${encodeURIComponent(jobId)}/carbon`)
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }
}
