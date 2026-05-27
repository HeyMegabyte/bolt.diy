/**
 * ConnectOnboardingComponent — `/dashboard/billing/connect`.
 *
 * @remarks
 * Stripe Connect Express onboarding flow for crew payouts + tenant-site
 * payment acceptance. Calls `/api/billing/connect/onboarding-link` and
 * redirects via `window.location.assign(onboarding_url)`. The 1.5% Connect
 * fee per BILLING.md is disclosed inline.
 */
import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { catchError, of, take } from 'rxjs';
import { BillingService } from '@org/data-access';

@Component({
  selector: 'lib-connect-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DatePipe, ButtonModule, CardModule],
  templateUrl: './connect-onboarding.component.html',
  styleUrl: './connect-onboarding.component.css',
})
export class ConnectOnboardingComponent {
  private readonly billing = inject(BillingService);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly expiresAt = signal<string | null>(null);

  startOnboarding(): void {
    this.busy.set(true);
    this.error.set(null);
    this.billing
      .connectOnboardingLink$()
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.error.set(err?.message ?? 'Unable to start onboarding');
          this.busy.set(false);
          return of(null);
        }),
      )
      .subscribe((r) => {
        this.busy.set(false);
        if (r?.onboarding_url) {
          this.expiresAt.set(r.expires_at);
          window.location.assign(r.onboarding_url);
        }
      });
  }
}
