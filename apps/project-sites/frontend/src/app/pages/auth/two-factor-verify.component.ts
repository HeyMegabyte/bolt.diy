import { Component, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthApiService } from './auth-api.service';

/**
 * Login-time two-factor (TOTP) challenge.
 *
 * @remarks
 * Shown after a password sign-in when the account has 2FA enabled. The user
 * enters the 6-digit code from their authenticator app and may opt to
 * **trust this device for 30 days** (idea #34) — that checkbox passes
 * `trustDevice: true` to {@link AuthApiService.verifyTotp} so the challenge is
 * skipped on this device for 30 days. On success it routes to the admin
 * dashboard. Brand dark theme, AA contrast, 44px targets, `focus-visible`
 * rings, busy guard, explicit error + success states.
 */
@Component({
  selector: 'app-two-factor-verify',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main
      class="min-h-screen grid place-items-center bg-dark px-4 py-10 text-white"
      data-testid="two-factor-verify-page"
    >
      <section
        class="w-full max-w-md rounded-2xl border border-white/[0.08] bg-dark-card p-7 shadow-2xl max-md:p-5"
        aria-labelledby="verify-heading"
      >
        <header class="mb-6">
          <h1 id="verify-heading" class="text-2xl font-extrabold tracking-tight m-0">
            Two-factor verification
          </h1>
          <p class="text-[0.85rem] text-text-secondary mt-1.5 mb-0">
            Enter the 6-digit code from your authenticator app.
          </p>
        </header>

        @if (error()) {
          <div
            class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.82rem] text-red-300"
            role="alert"
            data-testid="two-factor-verify-error"
          >
            {{ error() }}
          </div>
        }

        @if (success()) {
          <div
            class="mb-4 rounded-lg border border-primary/30 bg-primary-dim px-3.5 py-2.5 text-[0.82rem] text-primary"
            role="status"
            data-testid="two-factor-verify-success"
          >
            Verified — taking you to your dashboard…
          </div>
        }

        <form (ngSubmit)="submit()" novalidate class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="verify-code" class="text-[0.8rem] font-semibold text-text-secondary">
              Authentication code
            </label>
            <input
              id="verify-code"
              name="code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              [ngModel]="code()"
              (ngModelChange)="code.set($event)"
              (blur)="touched.set(true)"
              [attr.aria-invalid]="showCodeError()"
              aria-describedby="verify-code-error"
              placeholder="123456"
              data-testid="two-factor-verify-code"
              class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-center font-mono text-[1.1rem] tracking-[0.4em] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            @if (showCodeError()) {
              <span
                id="verify-code-error"
                class="text-[0.75rem] text-red-300"
                data-testid="two-factor-verify-code-error"
              >
                Enter the 6-digit code.
              </span>
            }
          </div>

          <label
            class="flex items-center gap-2.5 text-[0.82rem] text-text-secondary cursor-pointer select-none"
          >
            <input
              type="checkbox"
              name="trustDevice"
              [ngModel]="trustDevice()"
              (ngModelChange)="trustDevice.set($event)"
              data-testid="two-factor-verify-trust"
              class="h-[18px] w-[18px] shrink-0 rounded border-white/[0.2] bg-dark-surface accent-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            Trust this device for 30 days
          </label>

          <button
            type="submit"
            [disabled]="busy() || !codeValid()"
            data-testid="two-factor-verify-submit"
            class="min-h-[44px] rounded-lg bg-primary px-4 text-[0.9rem] font-bold text-dark transition-colors motion-safe:transition-all hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ busy() ? 'Verifying…' : 'Verify' }}
          </button>
        </form>

        <p class="mt-6 mb-0 text-center text-[0.82rem] text-text-secondary">
          <a
            routerLink="/auth/sign-in"
            data-testid="two-factor-verify-to-sign-in"
            class="font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            Back to sign in
          </a>
        </p>
      </section>
    </main>
  `,
})
export class TwoFactorVerifyComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly router = inject(Router);

  readonly code = signal('');
  readonly trustDevice = signal(false);
  readonly touched = signal(false);
  readonly busy = signal(false);
  readonly success = signal(false);
  readonly error = signal<string | null>(null);

  private static readonly CODE_RE = /^\d{6}$/;

  readonly codeValid = computed(() => TwoFactorVerifyComponent.CODE_RE.test(this.code().trim()));
  readonly showCodeError = computed(() => this.touched() && !this.codeValid());

  /** Verify the code (passing the trustDevice flag); on success route to admin. */
  async submit(): Promise<void> {
    this.touched.set(true);
    this.error.set(null);
    if (this.busy() || !this.codeValid()) return;

    this.busy.set(true);
    const res = await this.authApi.verifyTotp({
      code: this.code().trim(),
      trustDevice: this.trustDevice(),
    });
    this.busy.set(false);

    if (res.ok) {
      this.success.set(true);
      this.router.navigateByUrl('/admin');
    } else {
      this.error.set(res.error);
    }
  }
}
