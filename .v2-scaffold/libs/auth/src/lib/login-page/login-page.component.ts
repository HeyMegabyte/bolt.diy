/**
 * LoginPageComponent — the single `/login` surface.
 *
 * @remarks
 * Layout:
 * - Desktop ≥ 1024px: 50/50 split-pane. Brand panel left (dark, with logo +
 *   reassurance copy), auth panel right (white card, PrimeNG-themed).
 * - Mobile < 1024px: single column, auth-first, brand panel folded into a
 *   minimal header.
 *
 * Order of CTAs (top-to-bottom):
 * 1. **Passkey first** when `PublicKeyCredential.isConditionalMediationAvailable()`
 *    resolves true. Single button: "Sign in with passkey".
 * 2. OAuth providers — 5-button grid (Google / GitHub / Apple / Microsoft /
 *    Facebook). Tile-style buttons with the provider's logo + name.
 * 3. Email-or-phone input — auto-detects format (`@` => magic-link,
 *    `+`/digits => voice OTP) and routes to the matching service. No
 *    radio buttons, no tabs. One field, one CTA.
 * 4. Inline 2FA prompt — after first factor returns `requires_2fa: true`,
 *    we surface a TOTP code field below the primary CTA. No separate
 *    `/2fa` URL.
 *
 * Sign-in button regression test lives at `__tests__/sign-in-button.spec.ts`.
 */
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DividerModule } from 'primeng/divider';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { catchError, of } from 'rxjs';
import { AuthService } from '../services/auth.service.js';
import { OAuthService, type OAuthProvider } from '../services/oauth.service.js';
import { PasskeyService } from '../services/passkey.service.js';
import { MagicLinkService } from '../services/magic-link.service.js';
import { VoiceOtpService } from '../services/voice-otp.service.js';
import { TotpService } from '../services/totp.service.js';

type Identifier = 'email' | 'phone' | 'unknown';

interface ProviderTile {
  readonly id: OAuthProvider;
  readonly label: string;
  readonly testId: string;
}

const PROVIDERS: readonly ProviderTile[] = [
  { id: 'google', label: 'Google', testId: 'oauth-google' },
  { id: 'github', label: 'GitHub', testId: 'oauth-github' },
  { id: 'apple', label: 'Apple', testId: 'oauth-apple' },
  { id: 'microsoft', label: 'Microsoft', testId: 'oauth-microsoft' },
  { id: 'facebook', label: 'Facebook', testId: 'oauth-facebook' },
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[\d][\d\s\-().]{6,}$/;

@Component({
  selector: 'lib-login-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    DividerModule,
    MessageModule,
    ProgressSpinnerModule,
  ],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly oauth = inject(OAuthService);
  private readonly passkey = inject(PasskeyService);
  private readonly magicLink = inject(MagicLinkService);
  private readonly voiceOtp = inject(VoiceOtpService);
  private readonly totp = inject(TotpService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly providers = PROVIDERS;

  readonly identifier = signal('');
  readonly otpCode = signal('');
  readonly twoFactorCode = signal('');
  readonly verificationSid = signal<string | null>(null);
  readonly requires2fa = signal(false);
  readonly magicLinkSent = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** Passkey CTA visible only when the browser supports conditional UI. */
  readonly passkeySupported = toSignal(
    this.passkey.conditionalMediationAvailable$(),
    { initialValue: false },
  );

  readonly identifierKind = computed<Identifier>(() => {
    const v = this.identifier().trim();
    if (!v) return 'unknown';
    if (EMAIL_REGEX.test(v)) return 'email';
    if (PHONE_REGEX.test(v)) return 'phone';
    return 'unknown';
  });

  readonly primaryCtaLabel = computed<string>(() => {
    if (this.verificationSid()) return 'Verify code';
    switch (this.identifierKind()) {
      case 'email':
        return 'Email me a magic link';
      case 'phone':
        return 'Call me with a code';
      default:
        return 'Continue';
    }
  });

  readonly primaryCtaDisabled = computed<boolean>(
    () => this.busy() || this.identifierKind() === 'unknown',
  );

  ngOnInit(): void {
    // If the user is already signed in (cookie survived), bounce them.
    const me = this.auth.currentUser();
    if (me) {
      void this.router.navigateByUrl(this.nextUrl());
    }
  }

  startOAuth(provider: OAuthProvider): void {
    this.busy.set(true);
    this.errorMessage.set(null);
    this.oauth
      .startOauth$(provider)
      .pipe(catchError((e) => of(this.toError(e))))
      .subscribe((res) => {
        if ('authorize_url' in res) {
          window.location.assign(res.authorize_url);
        } else {
          this.busy.set(false);
        }
      });
  }

  signInWithPasskey(): void {
    this.busy.set(true);
    this.errorMessage.set(null);
    this.passkey
      .signInWithPasskey$()
      .pipe(catchError((e) => of(this.toError(e))))
      .subscribe((res) => {
        this.busy.set(false);
        if (res && 'user' in res) {
          void this.router.navigateByUrl(this.nextUrl());
        }
      });
  }

  submitPrimary(): void {
    if (this.verificationSid()) {
      this.verifyVoiceOtp();
      return;
    }

    const kind = this.identifierKind();
    if (kind === 'email') {
      this.requestMagicLink();
    } else if (kind === 'phone') {
      this.requestVoiceOtp();
    }
  }

  private requestMagicLink(): void {
    this.busy.set(true);
    this.errorMessage.set(null);
    this.magicLink
      .requestMagicLink$(this.identifier().trim())
      .pipe(catchError((e) => of(this.toError(e))))
      .subscribe((res) => {
        this.busy.set(false);
        if (res && 'sent' in res) {
          this.magicLinkSent.set(true);
        }
      });
  }

  private requestVoiceOtp(): void {
    this.busy.set(true);
    this.errorMessage.set(null);
    this.voiceOtp
      .requestVoiceOtp$(this.identifier().trim())
      .pipe(catchError((e) => of(this.toError(e))))
      .subscribe((res) => {
        this.busy.set(false);
        if (res && 'verification_sid' in res) {
          this.verificationSid.set(res.verification_sid);
        }
      });
  }

  private verifyVoiceOtp(): void {
    const sid = this.verificationSid();
    const code = this.otpCode().trim();
    if (!sid || !code) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    this.voiceOtp
      .verifyOtp$({
        phone: this.identifier().trim(),
        code,
        verification_sid: sid,
      })
      .pipe(catchError((e) => of(this.toError(e))))
      .subscribe((res) => {
        this.busy.set(false);
        if (res && 'user' in res) {
          void this.router.navigateByUrl(this.nextUrl());
        }
      });
  }

  submitTwoFactor(): void {
    const code = this.twoFactorCode().trim();
    if (!code) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    this.totp
      .verifyTotpForSignIn$(code)
      .pipe(catchError((e) => of(this.toError(e))))
      .subscribe(() => {
        this.busy.set(false);
        this.requires2fa.set(false);
        void this.router.navigateByUrl(this.nextUrl());
      });
  }

  private nextUrl(): string {
    const next = this.route.snapshot.queryParamMap.get('next');
    return next && next.startsWith('/') ? next : '/';
  }

  private toError(e: unknown): { error: true } {
    if (e instanceof HttpErrorResponse && e.status === 428) {
      // Server signals "requires 2FA" via 428 Precondition Required.
      this.requires2fa.set(true);
    } else {
      this.errorMessage.set(
        e instanceof HttpErrorResponse
          ? e.error?.message ?? 'Something went wrong. Try again.'
          : 'Something went wrong. Try again.',
      );
    }
    return { error: true };
  }
}
