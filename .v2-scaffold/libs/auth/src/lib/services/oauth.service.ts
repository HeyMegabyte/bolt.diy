/**
 * OAuthService — kicks off the OAuth dance with the control-plane.
 *
 * @remarks
 * The control-plane owns PKCE state in a signed cookie + the `oauth_state`
 * D1 table (see ARCHITECTURE.md §6). The browser only needs to hit
 * `GET /api/auth/oauth/{provider}/start`, follow the 302 to the provider's
 * authorize URL, and let the callback land back at
 * `/api/auth/oauth/{provider}/callback`. This service is the typed shim
 * that exposes that handoff as an Observable.
 *
 * @example
 * ```ts
 * this.oauth.startOauth$('google').subscribe(({ authorize_url }) => {
 *   window.location.assign(authorize_url);
 * });
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

export type OAuthProvider = 'google' | 'github' | 'apple' | 'microsoft' | 'facebook';

export interface OAuthStartResponse {
  authorize_url: string;
}

@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly http = inject(HttpClient);

  /**
   * Resolve the provider's authorize URL. The control-plane mints + signs
   * the PKCE state cookie and returns the URL the browser should redirect
   * to. Caller is expected to `window.location.assign` the result so the
   * provider receives the user-agent's full session context (cookies,
   * referrer policy, etc).
   */
  startOauth$(provider: OAuthProvider): Observable<OAuthStartResponse> {
    return this.http.get<OAuthStartResponse>(
      `/api/auth/oauth/${provider}/start`,
    );
  }
}
