/**
 * `offlineInterceptor` — when the browser reports `navigator.onLine === false`,
 * push the mutation onto `OfflineQueueService` and return a synthetic
 * `HTTP 202 Accepted` response so the UI keeps moving.
 *
 * @remarks
 * Read-only requests (GET / HEAD) pass through unchanged — the failure
 * surfaces as the standard network error which the consumer's `retry()`
 * + `catchError()` already handles.
 *
 * Mutations (POST / PUT / PATCH / DELETE) are persisted to IndexedDB via
 * the offline-queue service. The queue auto-flushes on the next
 * `online` event.
 *
 * Synthetic 202 envelope: `{ queued: true, op_id: '<uid>' }`.
 *
 * @see ../../../../util-platform/src/lib/offline-queue.service.ts
 * @see [[rxjs-first-angular]]
 */
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { OfflineQueueService } from '@org/util-platform';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const API_PREFIX = '/api/';

function browserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}

export const offlineInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const queue = inject(OfflineQueueService);

  const isApi = req.url.startsWith(API_PREFIX) || req.url.includes('api.projectsites.dev');
  const isMutation = MUTATION_METHODS.has(req.method.toUpperCase());

  if (!isApi || !isMutation || browserOnline()) {
    return next(req).pipe(
      catchError((err: HttpErrorResponse) => {
        if (isApi && isMutation && err.status === 0 && !browserOnline()) {
          return enqueueAnd202(queue, req);
        }
        throw err;
      }),
    );
  }

  return enqueueAnd202(queue, req);
};

function enqueueAnd202(
  queue: OfflineQueueService,
  req: HttpRequest<unknown>,
): Observable<HttpEvent<unknown>> {
  return from(
    queue.enqueue({
      method: req.method.toUpperCase() as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: req.urlWithParams,
      body: req.body,
      headers: headersToRecord(req),
    }),
  ).pipe(
    switchMap((op) =>
      of<HttpEvent<unknown>>(
        new HttpResponse({
          status: 202,
          statusText: 'Accepted (queued offline)',
          url: req.urlWithParams,
          body: { queued: true, op_id: op.id },
        }),
      ),
    ),
  );
}

function headersToRecord(req: HttpRequest<unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of req.headers.keys()) {
    const v = req.headers.get(key);
    if (v != null) out[key] = v;
  }
  return out;
}
