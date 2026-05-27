/**
 * CrewVerificationService — RxJS-first wrapper for crew background-check pills
 * (backlog item #20).
 *
 * `verification$(crewUserId)` polls the 4-pill status every 30s. `startVerification$()`
 * mints a Persona inquiry URL the crew member opens in a new tab.
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

export type PillStatus = 'pending' | 'verified' | 'failed' | 'in_review';

export interface CrewVerificationSnapshot {
  readonly id_status: PillStatus;
  readonly background_status: PillStatus;
  readonly insurance_status: PillStatus;
  readonly bonded_status: PillStatus;
  readonly verified_at: string | null;
}

const DEFAULT_SNAPSHOT: CrewVerificationSnapshot = {
  id_status: 'pending',
  background_status: 'pending',
  insurance_status: 'pending',
  bonded_status: 'pending',
  verified_at: null,
};

const POLL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class CrewVerificationService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<CrewVerificationSnapshot>>();

  verification$(crewUserId: string): Observable<CrewVerificationSnapshot> {
    const existing = this.cache.get(crewUserId);
    if (existing) return existing;
    const stream = this.http
      .get<CrewVerificationSnapshot>(
        `/api/crew/${encodeURIComponent(crewUserId)}/verification`,
      )
      .pipe(
        catchError(() => of(DEFAULT_SNAPSHOT)),
        repeat({ delay: POLL_MS }),
        startWith(DEFAULT_SNAPSHOT),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    this.cache.set(crewUserId, stream);
    return stream;
  }

  startVerification$(
    crewUserId: string,
    templateId?: string,
  ): Observable<{ inquiry_id: string; inquiry_url: string }> {
    return this.http.post<{ inquiry_id: string; inquiry_url: string }>(
      `/api/crew/${encodeURIComponent(crewUserId)}/verify-start`,
      { template_id: templateId },
    );
  }
}

// `switchMap` is exposed so tests can stub the pipeline cleanly.
void switchMap;
