import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { emailError } from '../../utils/validators/email';

@Component({
  selector: 'app-signin',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './signin.component.html',
  styleUrl: './signin.component.scss',
})
export class SigninComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  panel = signal<'main' | 'email'>('main');
  email = '';
  sending = signal(false);
  sent = signal(false);
  emailError = signal<string | null>(null);
  inlineError = signal<string | null>(null);
  attempted = signal(false);

  showEmailPanel(): void {
    this.panel.set('email');
    this.inlineError.set(null);
    this.emailError.set(null);
    this.attempted.set(false);
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
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
