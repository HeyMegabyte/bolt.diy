/**
 * `LiveActivityService` — iOS Live Activity / Dynamic Island for in-flight
 * job tracking via `@capacitor-community/live-activity`.
 *
 * @remarks
 * iOS-only. The plugin wraps `ActivityKit` (iOS 16.1+) so the job's ETA
 * and status text appear on the Lock Screen + Dynamic Island while the
 * crew is en route. Android / web paths emit a no-op result so the same
 * stream wire-up runs everywhere.
 *
 * Lifecycle:
 *  - `startJobActivity$()` once when status flips to `enroute`.
 *  - `updateJobActivity$()` on every location/ETA tick.
 *  - `endJobActivity$()` when status flips to `arrived` / `completed`.
 *
 * Activity attributes live in a Swift `ActivityAttributes` struct shipped
 * inside `apps/mobile/ios/App/ProjectSitesWidget/`; the plugin reads them
 * by reverse-DNS bundle id (`space.megabyte.projectsites.JobActivity`).
 *
 * @example
 * ```ts
 * jobsService.locationStream$(id).pipe(
 *   tap(loc => liveActivity.updateJobActivity$({
 *     jobId: id,
 *     patch: { eta: loc.eta_seconds, statusText: 'On the way' },
 *   }).subscribe()),
 * ).subscribe();
 * ```
 *
 * @see ../../../apps/mobile/ios/App/ProjectSitesWidget/
 * @see ./capacitor-plugins.ts § LiveActivityModule
 */
import { Injectable } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { loadLiveActivity } from './capacitor-plugins';

export interface JobActivityStart {
  readonly jobId: string;
  readonly eta: number;
  readonly statusText: string;
}

export interface JobActivityPatch {
  readonly eta?: number;
  readonly statusText?: string;
  readonly lat?: number;
  readonly lng?: number;
}

export interface JobActivityUpdate {
  readonly jobId: string;
  readonly patch: JobActivityPatch;
}

export interface LiveActivityResult {
  readonly ok: boolean;
  readonly source: 'native' | 'unsupported';
}

function detectPlatform(): 'ios' | 'android' | 'web' {
  if (typeof globalThis === 'undefined') return 'web';
  const cap = (globalThis as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }).Capacitor;
  if (!cap?.isNativePlatform?.()) return 'web';
  return (cap.getPlatform?.() as 'ios' | 'android') ?? 'web';
}

@Injectable({ providedIn: 'root' })
export class LiveActivityService {
  /** `'ios' | 'android' | 'web'`. Live Activity only runs on iOS. */
  readonly platform = detectPlatform();

  /** Start a new Live Activity for an enroute job. */
  startJobActivity$(opts: JobActivityStart): Observable<LiveActivityResult> {
    if (this.platform !== 'ios') {
      return of<LiveActivityResult>({ ok: false, source: 'unsupported' });
    }
    return defer(() => from(loadLiveActivity())).pipe(
      switchMap((mod) =>
        from(
          mod.LiveActivity.startActivity({
            activityId: `job-${opts.jobId}`,
            attributes: { jobId: opts.jobId },
            initialState: { eta: opts.eta, statusText: opts.statusText },
          }),
        ),
      ),
      map<unknown, LiveActivityResult>(() => ({ ok: true, source: 'native' })),
      catchError(() => of<LiveActivityResult>({ ok: false, source: 'native' })),
    );
  }

  /** Patch the live state (eta, status text, position). */
  updateJobActivity$(opts: JobActivityUpdate): Observable<LiveActivityResult> {
    if (this.platform !== 'ios') {
      return of<LiveActivityResult>({ ok: false, source: 'unsupported' });
    }
    return defer(() => from(loadLiveActivity())).pipe(
      switchMap((mod) =>
        from(
          mod.LiveActivity.updateActivity({
            activityId: `job-${opts.jobId}`,
            state: { ...opts.patch },
          }),
        ),
      ),
      map<unknown, LiveActivityResult>(() => ({ ok: true, source: 'native' })),
      catchError(() => of<LiveActivityResult>({ ok: false, source: 'native' })),
    );
  }

  /** End the Live Activity once the job arrives / completes. */
  endJobActivity$(jobId: string): Observable<LiveActivityResult> {
    if (this.platform !== 'ios') {
      return of<LiveActivityResult>({ ok: false, source: 'unsupported' });
    }
    return defer(() => from(loadLiveActivity())).pipe(
      switchMap((mod) =>
        from(
          mod.LiveActivity.endActivity({
            activityId: `job-${jobId}`,
            state: { statusText: 'Arrived', eta: 0 },
          }),
        ),
      ),
      map<unknown, LiveActivityResult>(() => ({ ok: true, source: 'native' })),
      catchError(() => of<LiveActivityResult>({ ok: false, source: 'native' })),
    );
  }
}
