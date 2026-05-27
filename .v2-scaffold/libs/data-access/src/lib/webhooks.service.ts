/**
 * WebhooksService — outbound-webhook management + delivery-log read API.
 *
 * @remarks
 * Webhooks here are TENANT-OWNED (their own endpoints, not Stripe's).
 * Delivery log is poll-only because deliveries are bursty + low-volume; a
 * WebSocket would be overkill.
 *
 * RxJS-first per `[[rxjs-first-angular]]`.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type Observable,
  Subject,
  catchError,
  map,
  merge,
  of,
  repeat,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';

const POLL_MS = 60_000;
const DELIVERY_POLL_MS = 15_000;

export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  events: readonly string[];
  signing_secret_prefix: string;
  active: boolean;
  created_at: string;
  last_delivery_at: string | null;
}

export interface CreateWebhookPayload {
  url: string;
  events: readonly string[];
  description?: string;
}

export interface CreateWebhookResponse extends Webhook {
  /** Full signing secret — shown ONCE. */
  signing_secret: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status: 'success' | 'failed' | 'pending';
  http_status: number | null;
  duration_ms: number | null;
  attempt: number;
  error: string | null;
  request_body: string;
  response_body: string | null;
  delivered_at: string;
}

@Injectable({ providedIn: 'root' })
export class WebhooksService {
  private readonly http = inject(HttpClient);

  private readonly refresh$$ = new Subject<void>();
  private readonly deliveryRefresh$$ = new Subject<void>();

  readonly list$: Observable<readonly Webhook[]> = merge(
    of<void>(undefined),
    this.refresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<{ webhooks: Webhook[] }>('/api/webhooks').pipe(
        map((r) => r.webhooks),
        catchError(() => of<Webhook[]>([])),
        repeat({ delay: POLL_MS }),
      ),
    ),
    startWith<Webhook[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  refresh$(): Observable<void> {
    this.refresh$$.next();
    return this.list$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  refreshDeliveries$(): Observable<void> {
    this.deliveryRefresh$$.next();
    return of(undefined);
  }

  /**
   * Delivery log for a webhook. Polled every 15s while subscribed.
   */
  listDeliveries$(webhookId: string): Observable<readonly WebhookDelivery[]> {
    return merge(of<void>(undefined), this.deliveryRefresh$$).pipe(
      switchMap(() =>
        this.http
          .get<{ deliveries: WebhookDelivery[] }>(
            `/api/webhooks/${webhookId}/deliveries`,
          )
          .pipe(
            map((r) => r.deliveries),
            catchError(() => of<WebhookDelivery[]>([])),
            repeat({ delay: DELIVERY_POLL_MS }),
          ),
      ),
      startWith<WebhookDelivery[]>([]),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  create$(payload: CreateWebhookPayload): Observable<CreateWebhookResponse> {
    return this.http
      .post<CreateWebhookResponse>('/api/webhooks', payload)
      .pipe(tap(() => this.refresh$$.next()));
  }

  update$(id: string, payload: Partial<CreateWebhookPayload>): Observable<Webhook> {
    return this.http
      .patch<Webhook>(`/api/webhooks/${id}`, payload)
      .pipe(tap(() => this.refresh$$.next()));
  }

  delete$(id: string): Observable<void> {
    return this.http
      .delete<void>(`/api/webhooks/${id}`)
      .pipe(tap(() => this.refresh$$.next()));
  }

  retry$(deliveryId: string): Observable<WebhookDelivery> {
    return this.http
      .post<WebhookDelivery>(`/api/webhooks/deliveries/${deliveryId}/retry`, {})
      .pipe(tap(() => this.deliveryRefresh$$.next()));
  }

  rotateSecret$(id: string): Observable<CreateWebhookResponse> {
    return this.http
      .post<CreateWebhookResponse>(`/api/webhooks/${id}/rotate`, {})
      .pipe(tap(() => this.refresh$$.next()));
  }
}
