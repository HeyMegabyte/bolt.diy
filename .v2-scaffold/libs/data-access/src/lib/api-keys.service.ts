/**
 * ApiKeysService — RxJS-first management for outbound API keys minted by
 * the tenant for their own scripts / CI / external integrations.
 *
 * @remarks
 * Mints, rotates, revokes. The plain-text secret is shown ONCE on create
 * (server returns `secret` only on the create response) — never again.
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

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: readonly string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: string;
}

export interface CreateApiKeyPayload {
  name: string;
  scopes: readonly string[];
  expires_in_days?: number;
}

export interface CreateApiKeyResponse extends ApiKey {
  /** Plain-text secret — shown ONCE. */
  secret: string;
}

@Injectable({ providedIn: 'root' })
export class ApiKeysService {
  private readonly http = inject(HttpClient);

  private readonly refresh$$ = new Subject<void>();

  readonly list$: Observable<readonly ApiKey[]> = merge(
    of<void>(undefined),
    this.refresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<{ keys: ApiKey[] }>('/api/api-keys').pipe(
        map((r) => r.keys),
        catchError(() => of<ApiKey[]>([])),
        repeat({ delay: POLL_MS }),
      ),
    ),
    startWith<ApiKey[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  refresh$(): Observable<void> {
    this.refresh$$.next();
    return this.list$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  create$(payload: CreateApiKeyPayload): Observable<CreateApiKeyResponse> {
    return this.http
      .post<CreateApiKeyResponse>('/api/api-keys', payload)
      .pipe(tap(() => this.refresh$$.next()));
  }

  rotate$(id: string): Observable<CreateApiKeyResponse> {
    return this.http
      .post<CreateApiKeyResponse>(`/api/api-keys/${id}/rotate`, {})
      .pipe(tap(() => this.refresh$$.next()));
  }

  revoke$(id: string): Observable<void> {
    return this.http
      .delete<void>(`/api/api-keys/${id}`)
      .pipe(tap(() => this.refresh$$.next()));
  }
}
