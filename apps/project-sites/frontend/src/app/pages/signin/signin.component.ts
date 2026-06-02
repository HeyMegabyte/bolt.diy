import { Component, type OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { TelemetryService } from '../../services/telemetry.service';
import { emailError } from '../../utils/validators/email';

@Component({
  selector: 'app-signin',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './signin.component.html',
  styleUrl: './signin.component.scss',
})
export class SigninComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private telemetry = inject(TelemetryService);

  panel = signal<'main' | 'email'>('main');
  email = '';
  sending = signal(false);
  sent = signal(false);
  emailError = signal<string | null>(null);
  inlineError = signal<string | null>(null);
  attempted = signal(false);

  /**
   * Where to land after a successful sign-in. Sourced from the `returnUrl`
   * query param the {@link authGuard} appends when it bounces an unauthed user
   * here, falling back to the dashboard. Sanitized to same-origin app paths so
   * a crafted `?returnUrl=https://evil.com` can't turn the post-login redirect
   * into an open redirect.
   */
  private returnUrl = '/admin';

  /**
   * Already-signed-in short-circuit. Landing on `/signin` with a live session
   * used to render the full login form ("it's already signed in" — the user's
   * exact complaint). Now we bounce straight to `returnUrl` (or the dashboard)
   * so a signed-in user never sees a login screen they don't need.
   */
  ngOnInit(): void {
    this.returnUrl = this.sanitizeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl(this.returnUrl);
    }
  }

  /** Only allow same-origin, app-relative paths (`/admin`, `/create`, …). */
  private sanitizeReturnUrl(raw: string | null): string {
    if (!raw) return '/admin';
    // Reject absolute URLs, protocol-relative (`//host`), and non-path values.
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/admin';
    return raw;
  }

  showEmailPanel(): void {
    this.panel.set('email');
    this.inlineError.set(null);
    this.emailError.set(null);
    this.attempted.set(false);
    this.telemetry.track('auth.signin.email_clicked');
  }

  backToMain(): void {
    this.panel.set('main');
    this.sent.set(false);
    this.inlineError.set(null);
    this.emailError.set(null);
    this.attempted.set(false);
  }

  /** Magic-link-flavored email validator. Delegates to the shared utility so
   *  every email field in the app uses the same regex + length cap. */
  private validateEmail(value: string): string | null {
    const v = value.trim();
    if (!v) return 'Email is required to send the magic link.';
    return emailError(v);
  }

  onEmailInput(): void {
    if (this.attempted()) this.emailError.set(this.validateEmail(this.email));
  }

  signInWithGoogle(): void {
    const redirectUrl = this.buildRedirectUrl('google');
    window.location.href = `/api/auth/google?redirect_url=${encodeURIComponent(redirectUrl)}`;
  }

  signInWithGitHub(): void {
    const redirectUrl = this.buildRedirectUrl('github');
    window.location.href = `/api/auth/github?redirect_url=${encodeURIComponent(redirectUrl)}`;
  }

  private buildRedirectUrl(provider: string): string {
    const business = this.auth.getSelectedBusiness();
    const mode = this.auth.getMode();
    let redirectUrl = window.location.origin + `/?auth_callback=${provider}`;
    if (business) {
      redirectUrl += `&biz_name=${encodeURIComponent(business.name)}&biz_address=${encodeURIComponent(business.address)}`;
      if (business.place_id) redirectUrl += `&biz_place_id=${encodeURIComponent(business.place_id)}`;
      redirectUrl += `&mode=${mode}`;
    }
    return redirectUrl;
  }

  sendMagicLink(): void {
    if (this.sending()) return;
    this.attempted.set(true);
    this.inlineError.set(null);

    const fieldError = this.validateEmail(this.email);
    this.emailError.set(fieldError);
    if (fieldError) return;

    this.sending.set(true);
    const business = this.auth.getSelectedBusiness();
    const mode = this.auth.getMode();
    let redirectUrl = window.location.origin + '/?auth_callback=email';
    if (business) {
      redirectUrl += `&biz_name=${encodeURIComponent(business.name)}&biz_address=${encodeURIComponent(business.address)}`;
      if (business.place_id) redirectUrl += `&biz_place_id=${encodeURIComponent(business.place_id)}`;
      redirectUrl += `&mode=${mode}`;
    }

    this.telemetry.track('auth.signin.magic_link_requested', { has_business: !!business });
    this.api.sendMagicLink(this.email, redirectUrl).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.sent.set(true);
        if (res.data?.token) {
          this.auth.setSession(res.data.token, this.email);
        }
        // No toast on success — the inline "Check your email" panel is the primary cue.
      },
      error: (err) => {
        this.sending.set(false);
        const human = err?.error?.error?.message
          || err?.error?.message
          || "Couldn't send the magic link — check the address and try again.";
        // Surface inline AND via toast (api.service already toasted, but only on transport errors).
        this.inlineError.set(human);
        this.toast.error(human);
        this.telemetry.track('auth.signin.failed', {
          status: err?.status,
          provider: 'email',
        });
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
