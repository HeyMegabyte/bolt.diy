/**
 * `ScheduleService` — crew schedule heatmap (backlog #41).
 *
 * @remarks
 *  Reads from `GET /api/crew/:id/schedule-heatmap`. RxJS-first per
 *  `[[rxjs-first-angular]]`. Multicasts via `shareReplay` so the grid + the
 *  busy-hours summary share one HTTP cycle.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map, shareReplay } from 'rxjs';

export interface ScheduleHeatmapCell {
  readonly day: number;     // 0..6
  readonly hour: number;    // 0..23
  readonly intensity: number; // 0..1
  readonly count: number;
}

export interface ScheduleHeatmap {
  readonly crew_id: string;
  readonly window_days: number;
  readonly cells: ReadonlyArray<ScheduleHeatmapCell>;
  readonly max_count: number;
  readonly total_bookings: number;
}

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http = inject(HttpClient);

  heatmap$(crewId: string, weeks = 12): Observable<ScheduleHeatmap> {
    return this.http
      .get<ScheduleHeatmap>(
        `/api/crew/${encodeURIComponent(crewId)}/schedule-heatmap`,
        { params: { weeks: String(weeks) } },
      )
      .pipe(
        map((r) => r),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }
}
