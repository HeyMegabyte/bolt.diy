/**
 * IntegrationsService — RxJS-first data-access for the integrations marketplace.
 *
 * @remarks
 * One observable per resource, polled or refreshed via Subject triggers.
 * Connection mutations (`connectOAuth$`, `connectPasteKey$`, `disconnect$`,
 * `rotateSecret$`, `revealSecret$`) auto-poke `listConnections$` on success.
 *
 * RxJS-first per `[[rxjs-first-angular]]`.
 *
 * @example
 * ```ts
 * readonly connections = toSignal(this.integrations.listConnections$, {
 *   initialValue: [],
 * });
 * ```
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
import type { IntegrationConfig, IntegrationProvider } from '@org/domain';

const CONNECTIONS_POLL_MS = 60_000;

export interface OAuthStartResponse {
  authorize_url: string;
  /** Some providers (Mailchimp, HubSpot) need a popup window of an exact size. */
  popup_features?: string;
}

export interface PasteKeyPayload {
  /** Provider-specific opaque secret (API key, PAT, signed config blob). */
  secret: string;
  /** Optional human label shown next to the integration card. */
  label?: string;
  /** Optional scope hints (provider-specific). */
  scopes?: readonly string[];
}

export interface RevealSecretResponse {
  /** Plain-text secret — never persisted client-side. Audit-logged server-side. */
  secret: string;
  expires_at: string;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly http = inject(HttpClient);

  private readonly connectionsRefresh$$ = new Subject<void>();

  /**
   * Live connection list per tenant. Polled every 60s + manual refresh on
   * any successful connect/disconnect/rotate.
   */
  readonly listConnections$: Observable<readonly IntegrationConfig[]> = merge(
    of<void>(undefined),
    this.connectionsRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http
        .get<{ connections: IntegrationConfig[] }>('/api/integrations')
        .pipe(
          map((r) => r.connections),
          catchError(() => of<IntegrationConfig[]>([])),
          repeat({ delay: CONNECTIONS_POLL_MS }),
        ),
    ),
    startWith<IntegrationConfig[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  refreshConnections$(): Observable<void> {
    this.connectionsRefresh$$.next();
    return this.listConnections$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  /**
   * Start an OAuth dance for `provider`. Caller is expected to
   * `window.location.assign` or popup the returned authorize URL.
   */
  connectOAuth$(provider: IntegrationProvider): Observable<OAuthStartResponse> {
    return this.http.get<OAuthStartResponse>(
      `/api/integrations/${provider}/oauth/start`,
    );
  }

  /**
   * Connect via paste-in API key when the provider doesn't support OAuth
   * (Resend, Anthropic, OpenAI, Sentry) OR when the worker lacks
   * `{PROVIDER}_OAUTH_CLIENT_ID`.
   */
  connectPasteKey$(
    provider: IntegrationProvider,
    payload: PasteKeyPayload,
  ): Observable<IntegrationConfig> {
    return this.http
      .post<IntegrationConfig>(
        `/api/integrations/${provider}/paste-key`,
        payload,
      )
      .pipe(tap(() => this.connectionsRefresh$$.next()));
  }

  disconnect$(provider: IntegrationProvider, connectionId: string): Observable<void> {
    return this.http
      .delete<void>(`/api/integrations/${provider}/${connectionId}`)
      .pipe(tap(() => this.connectionsRefresh$$.next()));
  }

  /**
   * Rotate the stored secret — server generates a new value, re-encrypts,
   * and logs an audit entry. Used for paste-key integrations primarily.
   */
  rotateSecret$(connectionId: string): Observable<IntegrationConfig> {
    return this.http
      .post<IntegrationConfig>(`/api/integrations/${connectionId}/rotate`, {})
      .pipe(tap(() => this.connectionsRefresh$$.next()));
  }

  /**
   * Reveal the plain-text secret for inspection. Requires recent step-up
   * auth on the server; audit-logged. Caller must NOT persist the result.
   */
  revealSecret$(connectionId: string): Observable<RevealSecretResponse> {
    return this.http.post<RevealSecretResponse>(
      `/api/integrations/${connectionId}/reveal`,
      {},
    );
  }
}
