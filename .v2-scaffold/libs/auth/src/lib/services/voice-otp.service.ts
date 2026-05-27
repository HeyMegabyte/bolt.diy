/**
 * VoiceOtpService — Twilio Verify (channel=call) front-end binding.
 *
 * @remarks
 * Phone-call OTP is the SMS-free fallback path for users with VoIP / WhatsApp
 * numbers Twilio can't SMS to. The control-plane talks to Twilio Verify;
 * we just expose two typed Observables: start (rings the phone) and
 * verify (consumes the code -> session cookie).
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, tap } from 'rxjs';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Me } from '@org/domain';
import { AuthService } from './auth.service.js';

export interface VoiceOtpStartResponse {
  verification_sid: string;
}

@Injectable({ providedIn: 'root' })
export class VoiceOtpService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /**
   * Start the voice-OTP flow. The control-plane calls Twilio Verify with
   * `channel=call`, which causes the user's phone to ring + speak the
   * code. The returned `verification_sid` is opaque from the browser's
   * POV — we just round-trip it on verify.
   */
  requestVoiceOtp$(phone: string): Observable<VoiceOtpStartResponse> {
    return this.http.post<VoiceOtpStartResponse>(
      '/api/auth/voice-otp/start',
      { phone },
    );
  }

  /**
   * Verify a voice OTP code. Server-side this becomes a Twilio Verify
   * `check` plus session cookie issuance. On success the `Me` shape is
   * refreshed via {@link AuthService}.
   */
  verifyOtp$(payload: { phone: string; code: string; verification_sid: string }): Observable<Me> {
    return this.http
      .post<Me>('/api/auth/voice-otp/verify', payload)
      .pipe(tap(() => this.auth.refresh$().subscribe()));
  }
}
