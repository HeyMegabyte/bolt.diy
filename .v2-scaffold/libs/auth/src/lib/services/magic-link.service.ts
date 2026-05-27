/**
 * MagicLinkService — request + consume email magic-links.
 *
 * @remarks
 * The control-plane handles token minting + Resend delivery + cookie
 * issuance on consume. This service only exposes the
 * "request a link" handshake; the consume side is a plain navigation
 * (`/api/auth/magic-link/consume?token=...`) that ends in a `Set-Cookie`
 * 302, which is handled by the browser without JS.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

export interface MagicLinkRequestResponse {
  sent: true;
}

@Injectable({ providedIn: 'root' })
export class MagicLinkService {
  private readonly http = inject(HttpClient);

  /**
   * Request a magic-link email for `email`. Always resolves to `{sent: true}`
   * regardless of whether the email exists, to avoid account enumeration.
   * The server-side rate-limit lives in the control-plane.
   */
  requestMagicLink$(email: string): Observable<MagicLinkRequestResponse> {
    return this.http.post<MagicLinkRequestResponse>(
      '/api/auth/magic-link/request',
      { email },
    );
  }
}
