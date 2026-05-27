/**
 * TotpService — RFC 6238 TOTP enrollment + verification.
 *
 * @remarks
 * Server-side validation lives in the control-plane using `otplib`. The
 * browser receives:
 * - The base32 secret (one-shot — never re-fetched after enrollment)
 * - The otpauth URL (for QR rendering via the `qrcode` lib)
 * - A handful of single-use backup codes (shown once, then hashed)
 *
 * Backup codes are surfaced through the
 * {@link TotpEnrollComponent}'s "save these now" panel.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, tap } from 'rxjs';
import { AuthService } from './auth.service.js';

export interface TotpEnrollChallenge {
  /** Base32-encoded secret. Discarded after the user confirms. */
  secret: string;
  /** otpauth://totp/... URL — feed straight into `qrcode`. */
  otpauth_url: string;
  /** Single-use backup codes. Show ONCE, then never again. */
  backup_codes: readonly string[];
}

export interface TotpVerifyResponse {
  totp_enabled: true;
}

@Injectable({ providedIn: 'root' })
export class TotpService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /**
   * Begin TOTP enrollment. Server generates a secret + backup codes; we
   * return them so the UI can render a QR + the backup-codes panel.
   * Nothing is enabled on the account until {@link verifyTotp} succeeds.
   */
  enrollTotp$(): Observable<TotpEnrollChallenge> {
    return this.http.post<TotpEnrollChallenge>(
      '/api/auth/totp/enroll/challenge',
      {},
    );
  }

  /**
   * Verify a 6-digit TOTP code. On success the server flips
   * `users.totp_enabled = 1` and the user's `Me` shape refreshes.
   */
  verifyTotp$(code: string): Observable<TotpVerifyResponse> {
    return this.http
      .post<TotpVerifyResponse>('/api/auth/totp/enroll/verify', { code })
      .pipe(tap(() => this.auth.refresh$().subscribe()));
  }

  /**
   * Submit a TOTP code during sign-in as the 2nd factor. Distinct from
   * {@link verifyTotp} — that's enrollment; this is sign-in flow.
   */
  verifyTotpForSignIn$(code: string): Observable<void> {
    return this.http
      .post<void>('/api/auth/totp/verify', { code })
      .pipe(tap(() => this.auth.refresh$().subscribe()));
  }
}
