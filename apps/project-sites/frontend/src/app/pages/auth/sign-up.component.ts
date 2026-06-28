import { Component, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthApiService } from './auth-api.service';

/**
 * Better Auth sign-up surface — name + email + password registration.
 *
 * @remarks
 * Mirrors {@link SignInComponent}'s UX bar: live validation (name required,
 * valid email, ≥8-char password), busy guard on submit, error + success state.
 * Self-contained — only {@link AuthApiService} + Router. Brand dark theme, AA
 * contrast, 44px targets, reduced-motion safe.
 */
@Component({
  selector: 'app-sign-up',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main
      class="min-h-screen grid place-items-center bg-dark px-4 py-10 text-white"
      data-testid="sign-up-page"
    >
      <section
        class="w-full max-w-md rounded-2xl border border-white/[0.08] bg-dark-card p-7 shadow-2xl max-md:p-5"
        aria-labelledby="sign-up-heading"
      >
        <header class="mb-6">
          <h1 id="sign-up-heading" class="text-2xl font-extrabold tracking-tight m-0">
            Create your account
          </h1>
          <p class="text-[0.85rem] text-text-secondary mt-1.5 mb-0">
            Start building sites in minutes.
          </p>
        </header>

        @if (error()) {
          <div
            class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.82rem] text-red-300"
            role="alert"
            data-testid="sign-up-error"
          >
            {{ error() }}
          </div>
        }

        @if (done()) {
          <div
            class="mb-4 rounded-lg border border-primary/30 bg-primary-dim px-3.5 py-2.5 text-[0.82rem] text-primary"
            role="status"
            data-testid="sign-up-success"
          >
            Account created — taking you to your dashboard…
          </div>
        }

        <form (ngSubmit)="submit()" novalidate class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="signup-name" class="text-[0.8rem] font-semibold text-text-secondary">
              Name
            </label>
            <input
              id="signup-name"
              name="name"
              type="text"
              autocomplete="name"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              (blur)="touched.set(true)"
              [attr.aria-invalid]="showNameError()"
              aria-describedby="signup-name-error"
              placeholder="Jane Doe"
              data-testid="sign-up-name"
              class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-[0.9rem] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            @if (showNameError()) {
              <span id="signup-name-error" class="text-[0.75rem] text-red-300" data-testid="sign-up-name-error">
                Name is required.
              </span>
            }
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="signup-email" class="text-[0.8rem] font-semibold text-text-secondary">
              Email
            </label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autocomplete="email"
              inputmode="email"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              (blur)="touched.set(true)"
              [attr.aria-invalid]="showEmailError()"
              aria-describedby="signup-email-error"
              placeholder="you@example.com"
              data-testid="sign-up-email"
              class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-[0.9rem] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            @if (showEmailError()) {
              <span id="signup-email-error" class="text-[0.75rem] text-red-300" data-testid="sign-up-email-error">
                Enter a valid email address.
              </span>
            }
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="signup-password" class="text-[0.8rem] font-semibold text-text-secondary">
              Password
            </label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autocomplete="new-password"
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
              (blur)="touched.set(true)"
              [attr.aria-invalid]="showPasswordError()"
              aria-describedby="signup-password-error"
              placeholder="At least 8 characters"
              data-testid="sign-up-password"
              class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-[0.9rem] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            @if (showPasswordError()) {
              <span id="signup-password-error" class="text-[0.75rem] text-red-300" data-testid="sign-up-password-error">
                Use at least 8 characters.
              </span>
            }
          </div>

          <button
            type="submit"
            [disabled]="busy() || !canSubmit()"
            data-testid="sign-up-submit"
            class="min-h-[44px] rounded-lg bg-primary px-4 text-[0.9rem] font-bold text-dark transition-colors motion-safe:transition-all hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ busy() ? 'Creating account…' : 'Create account' }}
          </button>
        </form>

        <p class="mt-6 mb-0 text-center text-[0.82rem] text-text-secondary">
          Already have an account?
          <a
            routerLink="/auth/sign-in"
            data-testid="sign-up-to-sign-in"
            class="font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            Sign in
          </a>
        </p>
      </section>
    </main>
  `,
})
export class SignUpComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly router = inject(Router);

  readonly name = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly touched = signal(false);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  readonly nameValid = computed(() => this.name().trim().length > 0);
  readonly emailValid = computed(() => SignUpComponent.EMAIL_RE.test(this.email().trim()));
  readonly passwordValid = computed(() => this.password().length >= 8);
  readonly canSubmit = computed(
    () => this.nameValid() && this.emailValid() && this.passwordValid(),
  );
  readonly showNameError = computed(() => this.touched() && !this.nameValid());
  readonly showEmailError = computed(() => this.touched() && !this.emailValid());
  readonly showPasswordError = computed(() => this.touched() && !this.passwordValid());

  /** Register the account; on success route to the admin dashboard. */
  async submit(): Promise<void> {
    this.touched.set(true);
    this.error.set(null);
    if (this.busy() || !this.canSubmit()) return;

    this.busy.set(true);
    const res = await this.authApi.signUpEmail({
      name: this.name().trim(),
      email: this.email().trim(),
      password: this.password(),
    });

    if (res.ok) {
      this.done.set(true);
      this.busy.set(false);
      this.router.navigateByUrl('/admin');
    } else {
      this.busy.set(false);
      this.error.set(res.error);
    }
  }
}
