/**
 * Jobs data-access. Streams location + chat over a multiplexed
 * WebSocket via `webSocket()` from RxJS.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  ChatMessage,
  Job,
  JobLocation,
  WSEnvelope,
} from '@org/domain';
import { JobLocationSchema, JobSchema, ChatMessageSchema } from '@org/domain';
import { retryWithBackoff } from '@org/util-rxjs';
import { Observable, filter, map, of, throwError } from 'rxjs';
import { webSocket, type WebSocketSubject } from 'rxjs/webSocket';

export interface JobListFilter {
  readonly role?: 'customer' | 'crew' | 'super_admin';
  readonly status?: Job['status'];
}

export interface JobRating {
  readonly stars: number;
  readonly tags: readonly string[];
  readonly free_text: string;
}

@Injectable({ providedIn: 'root' })
export class JobsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/jobs';

  private socketCache = new Map<string, WebSocketSubject<unknown>>();

  listJobs$(filter: JobListFilter = {}): Observable<readonly Job[]> {
    const params = new URLSearchParams();
    if (filter.role) params.set('role', filter.role);
    if (filter.status) params.set('status', filter.status);
    return this.http
      .get<{ items: unknown[] }>(`${this.base}?${params.toString()}`)
      .pipe(
        retryWithBackoff({ count: 2 }),
        map((r) => r.items.map((it) => JobSchema.parse(it)))
      );
  }

  getJob$(id: string): Observable<Job> {
    return this.http
      .get<unknown>(`${this.base}/${encodeURIComponent(id)}`)
      .pipe(retryWithBackoff({ count: 2 }), map((b) => JobSchema.parse(b)));
  }

  /**
   * Streams `JobLocation` payloads from
   * `wss://…/api/jobs/:id/location/stream`. Reuses the underlying
   * WebSocket if it's already open for this job.
   */
  locationStream$(id: string): Observable<JobLocation> {
    return this.socket$<JobLocation>(id).pipe(
      filter((e) => e.type === 'job_location' && e.topic === id),
      map((e) => JobLocationSchema.parse((e as { payload: unknown }).payload))
    );
  }

  chatStream$(id: string): Observable<ChatMessage> {
    return this.socket$<ChatMessage>(id).pipe(
      filter((e) => e.type === 'chat_message' && e.topic === id),
      map((e) => ChatMessageSchema.parse((e as { payload: unknown }).payload))
    );
  }

  sendChat$(id: string, content: string): Observable<void> {
    return this.http.post<void>(
      `${this.base}/${encodeURIComponent(id)}/chat`,
      { content }
    );
  }

  requestCall$(id: string): Observable<{ masked_number: string }> {
    return this.http.post<{ masked_number: string }>(
      `${this.base}/${encodeURIComponent(id)}/call`,
      {}
    );
  }

  rate$(id: string, rating: JobRating): Observable<void> {
    return this.http.post<void>(
      `${this.base}/${encodeURIComponent(id)}/rate`,
      rating
    );
  }

  tip$(id: string, amount_cents: number): Observable<void> {
    if (amount_cents <= 0) return throwError(() => new Error('Tip must be > 0'));
    return this.http.post<void>(
      `${this.base}/${encodeURIComponent(id)}/tip`,
      { amount_cents }
    );
  }

  safetyAlert$(id: string, payload: unknown): Observable<void> {
    return this.http.post<void>(
      `${this.base}/${encodeURIComponent(id)}/safety`,
      { payload }
    );
  }

  rebook$(jobId: string): Observable<{ booking_id: string }> {
    return this.http.post<{ booking_id: string }>(
      `${this.base}/${encodeURIComponent(jobId)}/rebook`,
      {}
    );
  }

  // ---- internals ---------------------------------------------------------

  private socket$<_T>(jobId: string): Observable<WSEnvelope> {
    if (typeof window === 'undefined') return of();
    const cached = this.socketCache.get(jobId);
    if (cached) return cached.asObservable() as Observable<WSEnvelope>;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/api/jobs/${encodeURIComponent(jobId)}/stream`;
    const ws = webSocket<WSEnvelope>(url);
    this.socketCache.set(jobId, ws as unknown as WebSocketSubject<unknown>);
    return ws.asObservable();
  }
}
