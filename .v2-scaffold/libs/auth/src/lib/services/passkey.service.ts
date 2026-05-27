/**
 * PasskeyService — WebAuthn enroll + sign-in via @simplewebauthn/browser.
 *
 * @remarks
 * The control-plane mints + verifies challenges (see ARCHITECTURE.md §6,
 * WebAuthn passkey flow). The browser side just shuttles the challenge
 * options into `@simplewebauthn/browser` helpers and posts the result back.
 *
 * Capable browsers (`PublicKeyCredential.isConditionalMediationAvailable`)
 * get the conditional-UI autofill flow; everything else falls back to
 * explicit `signInWithPasskey$()`.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, defer, from, switchMap, tap } from 'rxjs';
import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Me } from '@org/domain';
import { AuthService } from './auth.service.js';

export interface PasskeyEnrollResult {
  credential_id: string;
}

@Injectable({ providedIn: 'root' })
export class PasskeyService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /**
   * Enroll the current browser/device as a passkey for the signed-in
   * user. Requires an existing session (we add a passkey, not replace
   * the primary factor).
   */
  enrollPasskey$(): Observable<PasskeyEnrollResult> {
    return this.http
      .post<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/passkey/register/challenge',
        {},
      )
      .pipe(
        switchMap((options) =>
          from(startRegistration({ optionsJSON: options })).pipe(
            switchMap((attestation: RegistrationResponseJSON) =>
              this.http.post<PasskeyEnrollResult>(
                '/api/auth/passkey/register/verify',
                attestation,
              ),
            ),
          ),
        ),
        tap(() => this.auth.refresh$().subscribe()),
      );
  }

  /**
   * Sign in with an existing passkey. Triggers the OS prompt
   * (Touch ID / Face ID / Windows Hello / security key).
   */
  signInWithPasskey$(): Observable<Me> {
    return this.http
      .post<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkey/challenge',
        {},
      )
      .pipe(
        switchMap((options) =>
          from(startAuthentication({ optionsJSON: options })).pipe(
            switchMap((assertion: AuthenticationResponseJSON) =>
              this.http.post<Me>('/api/auth/passkey/verify', assertion),
            ),
          ),
        ),
        tap(() => this.auth.refresh$().subscribe()),
      );
  }

  /**
   * `true` when the browser supports conditional-UI passkey autofill.
   * Use this to decide whether to show the passkey CTA first on the
   * login page.
   */
  conditionalMediationAvailable$(): Observable<boolean> {
    return defer(() => {
      if (
        typeof PublicKeyCredential === 'undefined' ||
        typeof PublicKeyCredential.isConditionalMediationAvailable !==
          'function'
      ) {
        return Promise.resolve(false);
      }
      return PublicKeyCredential.isConditionalMediationAvailable();
    });
  }
}
