import { Component, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthApiService } from './auth-api.service';

/**
 * Better Auth sign-in surface — email + password, plus a one-tap "email me a
 * magic link" passwordless path and a link across to sign-up.
 *
 * @remarks
 * Self-contained: the only collaborators are {@link AuthApiService} (its own
 * isolated HTTP client) and the Router. Live field validation, a busy guard on
 * every submit, and explicit error + success states. Brand dark theme, AA
 * contrast, 44px targets, `prefers-reduced-motion` safe via Tailwind `motion-*`.
 */
@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main
      class="min-h-screen grid place-items-center bg-dark px-4 py-10 text-white"
      data-testid="sign-in-page"
    >
      <section
        class="w-full max-w-md rounded-2xl border border-white/[0.08] bg-dark-card p-7 shadow-2xl max-md:p-5"
        aria-labelledby="sign-in-heading"
      >
        <header class="mb-6">
          <h1 id="sign-in-heading" class="text-2xl font-extrabold tracking-tight m-0">
            Welcome back
          </h1>
          <p class="text-[0.85rem] text-text-secondary mt-1.5 mb-0">
            Sign in to manage your sites.
          </p>
        </header>

        @if (error()) {
          <div
            class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.82rem] text-red-300"
            role="alert"
            data-testid="sign-in-error"
          >
            {{ error() }}
          </div>
        }

        @if (magicSent()) {
          <div
            class="mb-4 rounded-lg border border-primary/30 bg-primary-dim px-3.5 py-2.5 text-[0.82rem] text-primary"
            role="status"
            data-testid="sign-in-magic-sent"
          >
            Check your inbox — we sent a magic link to {{ email().trim() }}.
          </div>
        }

        <form (ngSubmit)="submit()" novalidate class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="signin-email" class="text-[0.8rem] font-semibold text-text-secondary">
              Email
            </label>
            <input
              id="signin-email"
              name="email"
              type="email"
              autocomplete="email"
              inputmode="email"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              (blur)="touched.set(true)"
              [attr.aria-invalid]="showEmailError()"
              aria-describedby="signin-email-error"
              placeholder="you@example.com"
              data-testid="sign-in-email"
              class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-[0.9rem] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            @if (showEmailError()) {
              <span id="signin-email-error" class="text-[0.75rem] text-red-300" data-testid="sign-in-email-error">
                Enter a valid email address.
              </span>
            }
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="signin-password" class="text-[0.8rem] font-semibold text-text-secondary">
              Password
            </label>
            <input
              id="signin-password"
              name="password"
              type="password"
              autocomplete="current-password"
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
              (blur)="touched.set(true)"
              [attr.aria-invalid]="showPasswordError()"
              aria-describedby="signin-password-error"
              placeholder="Your password"
              data-testid="sign-in-password"
              class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-[0.9rem] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            @if (showPasswordError()) {
              <span id="signin-password-error" class="text-[0.75rem] text-red-300" data-testid="sign-in-password-error">
                Password is required.
              </span>
            }
          </div>

          <button
            type="submit"
            [disabled]="busy() || !canSubmit()"
            data-testid="sign-in-submit"
            class="min-h-[44px] rounded-lg bg-primary px-4 text-[0.9rem] font-bold text-dark transition-colors motion-safe:transition-all hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <div class="my-5 flex items-center gap-3 text-[0.72rem] text-white/30" aria-hidden="true">
          <span class="h-px flex-1 bg-white/[0.08]"></span>
          OR
          <span class="h-px flex-1 bg-white/[0.08]"></span>
        </div>

        <button
          type="button"
          (click)="emailMagicLink()"
          [disabled]="magicBusy() || !emailValid()"
          data-testid="sign-in-magic-link"
          class="min-h-[44px] w-full rounded-lg border border-white/[0.12] bg-transparent px-4 text-[0.85rem] font-semibold text-white transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ magicBusy() ? 'Sending…' : 'Email me a magic link' }}
        </button>

        <p class="mt-6 mb-0 text-center text-[0.82rem] text-text-secondary">
          New here?
          <a
            routerLink="/auth/sign-up"
            data-testid="sign-in-to-sign-up"
            class="font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            Create an account
          </a>
        </p>
      </section>
    </main>
  `,
})
export class SignInComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly touched = signal(false);
  readonly busy = signal(false);
  readonly magicBusy = signal(false);
  readonly magicSent = signal(false);
  readonly error = signal<string | null>(null);

  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  readonly emailValid = computed(() => SignInComponent.EMAIL_RE.test(this.email().trim()));
  readonly passwordValid = computed(() => this.password().length > 0);
  readonly canSubmit = computed(() => this.emailValid() && this.passwordValid());
  readonly showEmailError = computed(() => this.touched() && !this.emailValid());
  readonly showPasswordError = computed(() => this.touched() && !this.passwordValid());

  /** Sign in with email + password; on success route to the admin dashboard. */
  async submit(): Promise<void> {
    this.touched.set(true);
    this.error.set(null);
    if (this.busy() || !this.canSubmit()) return;

    this.busy.set(true);
    const res = await this.authApi.signInEmail({
      email: this.email().trim(),
      password: this.password(),
    });
    this.busy.set(false);

    if (res.ok) {
      this.router.navigateByUrl('/admin');
    } else {
      this.error.set(res.error);
    }
  }

  /** Request a passwordless magic link to the entered email. */
  async emailMagicLink(): Promise<void> {
    this.touched.set(true);
    this.error.set(null);
    this.magicSent.set(false);
    if (this.magicBusy() || !this.emailValid()) return;

    this.magicBusy.set(true);
    const res = await this.authApi.sendMagicLink({ email: this.email().trim() });
    this.magicBusy.set(false);

    if (res.ok) {
      this.magicSent.set(true);
    } else {
      this.error.set(res.error);
    }
  }
}
