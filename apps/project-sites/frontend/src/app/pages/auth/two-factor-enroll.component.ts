import { Component, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthApiService } from './auth-api.service';

/**
 * Two-factor (TOTP) enrollment surface.
 *
 * @remarks
 * Two stages, no new deps. Stage 1: confirm the account password → call
 * {@link AuthApiService.enableTwoFactor} → reveal the manual-entry secret
 * (parsed from the `secret=` param of the returned `totpURI`), the raw
 * `otpauth://` link, and the one-time backup codes (copy affordances on both).
 * No external QR image — CSP forbids it; users hand-key the secret into their
 * authenticator app. Stage 2: verify a 6-digit code to confirm enrollment.
 * Brand dark theme, AA contrast, 44px targets, `focus-visible` rings, busy
 * guards on every submit, `prefers-reduced-motion` safe via Tailwind `motion-*`.
 */
@Component({
  selector: 'app-two-factor-enroll',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main
      class="min-h-screen grid place-items-center bg-dark px-4 py-10 text-white"
      data-testid="two-factor-enroll-page"
    >
      <section
        class="w-full max-w-md rounded-2xl border border-white/[0.08] bg-dark-card p-7 shadow-2xl max-md:p-5"
        aria-labelledby="enroll-heading"
      >
        <header class="mb-6">
          <h1 id="enroll-heading" class="text-2xl font-extrabold tracking-tight m-0">
            Set up two-factor auth
          </h1>
          <p class="text-[0.85rem] text-text-secondary mt-1.5 mb-0">
            Add a one-time code from your authenticator app on every sign-in.
          </p>
        </header>

        @if (error()) {
          <div
            class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.82rem] text-red-300"
            role="alert"
            data-testid="two-factor-enroll-error"
          >
            {{ error() }}
          </div>
        }

        @if (!secret()) {
          <!-- Stage 1 — confirm password to enable -->
          <form (ngSubmit)="enable()" novalidate class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label for="enroll-password" class="text-[0.8rem] font-semibold text-text-secondary">
                Confirm your password
              </label>
              <input
                id="enroll-password"
                name="password"
                type="password"
                autocomplete="current-password"
                [ngModel]="password()"
                (ngModelChange)="password.set($event)"
                (blur)="touched.set(true)"
                [attr.aria-invalid]="showPasswordError()"
                aria-describedby="enroll-password-error"
                placeholder="Your password"
                data-testid="two-factor-enroll-password"
                class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-[0.9rem] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              @if (showPasswordError()) {
                <span
                  id="enroll-password-error"
                  class="text-[0.75rem] text-red-300"
                  data-testid="two-factor-enroll-password-error"
                >
                  Password is required.
                </span>
              }
            </div>

            <button
              type="submit"
              [disabled]="enableBusy() || !passwordValid()"
              data-testid="two-factor-enroll-enable"
              class="min-h-[44px] rounded-lg bg-primary px-4 text-[0.9rem] font-bold text-dark transition-colors motion-safe:transition-all hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ enableBusy() ? 'Generating…' : 'Continue' }}
            </button>
          </form>
        } @else {
          <!-- Stage 2 — show secret + backup codes, confirm a TOTP code -->
          <div class="flex flex-col gap-5">
            <div class="flex flex-col gap-2">
              <h2 class="text-[0.8rem] font-semibold text-text-secondary m-0">
                1. Add this secret to your authenticator app
              </h2>
              <div
                class="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary-dim px-3.5 py-2.5"
              >
                <code
                  class="font-mono text-[0.9rem] tracking-wider text-primary break-all"
                  data-testid="two-factor-enroll-secret"
                >
                  {{ secret() }}
                </code>
                <button
                  type="button"
                  (click)="copy(secret(), 'secret')"
                  [attr.aria-label]="'Copy secret key'"
                  data-testid="two-factor-enroll-copy-secret"
                  class="shrink-0 min-h-[44px] min-w-[44px] rounded-lg border border-white/[0.12] px-2 text-[0.75rem] font-semibold text-white transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {{ copied() === 'secret' ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <a
                [href]="totpUri()"
                data-testid="two-factor-enroll-uri"
                class="text-[0.75rem] text-text-secondary underline-offset-2 hover:underline break-all focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
              >
                Open in authenticator app
              </a>
            </div>

            @if (backupCodes().length) {
              <div class="flex flex-col gap-2">
                <h2 class="text-[0.8rem] font-semibold text-text-secondary m-0">
                  2. Save your backup codes
                </h2>
                <p class="text-[0.75rem] text-text-secondary m-0">
                  Stored once. Use one if you lose your authenticator.
                </p>
                <ul
                  class="grid grid-cols-2 gap-1.5 rounded-lg border border-white/[0.08] bg-dark-surface p-3 m-0 list-none"
                  data-testid="two-factor-enroll-backup-codes"
                >
                  @for (code of backupCodes(); track code) {
                    <li class="font-mono text-[0.82rem] text-white">{{ code }}</li>
                  }
                </ul>
                <button
                  type="button"
                  (click)="copy(backupCodesText(), 'codes')"
                  data-testid="two-factor-enroll-copy-codes"
                  class="min-h-[44px] rounded-lg border border-white/[0.12] px-4 text-[0.82rem] font-semibold text-white transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {{ copied() === 'codes' ? 'Codes copied' : 'Copy backup codes' }}
                </button>
              </div>
            }

            @if (confirmed()) {
              <div
                class="rounded-lg border border-primary/30 bg-primary-dim px-3.5 py-2.5 text-[0.82rem] text-primary"
                role="status"
                data-testid="two-factor-enroll-confirmed"
              >
                Two-factor auth is on. You'll be asked for a code next sign-in.
              </div>
            } @else {
              <form (ngSubmit)="confirm()" novalidate class="flex flex-col gap-3">
                <label for="enroll-code" class="text-[0.8rem] font-semibold text-text-secondary">
                  3. Enter the 6-digit code to confirm
                </label>
                <input
                  id="enroll-code"
                  name="code"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  [ngModel]="code()"
                  (ngModelChange)="code.set($event)"
                  [attr.aria-invalid]="!codeValid() && code().length > 0"
                  placeholder="123456"
                  data-testid="two-factor-enroll-code"
                  class="min-h-[44px] rounded-lg border border-white/[0.1] bg-dark-surface px-3.5 text-center font-mono text-[1.1rem] tracking-[0.4em] text-white placeholder:text-white/30 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <button
                  type="submit"
                  [disabled]="confirmBusy() || !codeValid()"
                  data-testid="two-factor-enroll-confirm"
                  class="min-h-[44px] rounded-lg bg-primary px-4 text-[0.9rem] font-bold text-dark transition-colors motion-safe:transition-all hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {{ confirmBusy() ? 'Verifying…' : 'Confirm & finish' }}
                </button>
              </form>
            }
          </div>
        }

        <p class="mt-6 mb-0 text-center text-[0.82rem] text-text-secondary">
          <a
            routerLink="/auth/sessions"
            data-testid="two-factor-enroll-to-sessions"
            class="font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            Back to account security
          </a>
        </p>
      </section>
    </main>
  `,
})
export class TwoFactorEnrollComponent {
  private readonly authApi = inject(AuthApiService);

  readonly password = signal('');
  readonly code = signal('');
  readonly touched = signal(false);
  readonly enableBusy = signal(false);
  readonly confirmBusy = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirmed = signal(false);
  readonly copied = signal<'secret' | 'codes' | null>(null);

  /** Raw `otpauth://` URI returned by enable; empty until stage 1 succeeds. */
  readonly totpUri = signal('');
  readonly backupCodes = signal<string[]>([]);

  /** Backup codes joined by newlines for a single clipboard copy. */
  readonly backupCodesText = computed(() => this.backupCodes().join('\n'));

  private static readonly CODE_RE = /^\d{6}$/;

  /** Manual-entry secret parsed from the `secret=` param of the TOTP URI. */
  readonly secret = computed(() => {
    const uri = this.totpUri();
    if (!uri) return '';
    const match = /[?&]secret=([^&]+)/i.exec(uri);
    return match ? decodeURIComponent(match[1]) : '';
  });

  readonly passwordValid = computed(() => this.password().length > 0);
  readonly showPasswordError = computed(() => this.touched() && !this.passwordValid());
  readonly codeValid = computed(() => TwoFactorEnrollComponent.CODE_RE.test(this.code().trim()));

  /** Stage 1 — confirm password, fetch TOTP URI + backup codes. */
  async enable(): Promise<void> {
    this.touched.set(true);
    this.error.set(null);
    if (this.enableBusy() || !this.passwordValid()) return;

    this.enableBusy.set(true);
    const res = await this.authApi.enableTwoFactor({ password: this.password() });
    this.enableBusy.set(false);

    if (res.ok) {
      this.totpUri.set(res.data.totpURI ?? '');
      this.backupCodes.set(res.data.backupCodes ?? []);
    } else {
      this.error.set(res.error);
    }
  }

  /** Stage 2 — verify the 6-digit code to confirm enrollment. */
  async confirm(): Promise<void> {
    this.error.set(null);
    if (this.confirmBusy() || !this.codeValid()) return;

    this.confirmBusy.set(true);
    const res = await this.authApi.verifyTotp({ code: this.code().trim() });
    this.confirmBusy.set(false);

    if (res.ok) {
      this.confirmed.set(true);
    } else {
      this.error.set(res.error);
    }
  }

  /** Copy text to the clipboard and flash a "Copied" affordance. */
  async copy(text: string, which: 'secret' | 'codes'): Promise<void> {
    try {
      await navigator.clipboard?.writeText(text);
      this.copied.set(which);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      this.error.set('Could not copy — select the text manually.');
    }
  }
}
