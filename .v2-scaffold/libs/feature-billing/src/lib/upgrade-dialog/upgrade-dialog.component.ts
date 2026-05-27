/**
 * UpgradeDialogComponent — Stripe Link Embedded Checkout.
 *
 * @remarks
 * MUST use Stripe Link Embedded Checkout, NEVER Payment Element.
 * Lazy-loaded via `@defer (on interaction)` in the parent template.
 * The host caller mounts a `<stripe-buy-button>` or the Embedded Checkout
 * iframe pointing at the `client_secret` we receive from the server.
 *
 * RxJS-first per `[[rxjs-first-angular]]`.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { RadioButtonModule } from 'primeng/radiobutton';
import { FormsModule } from '@angular/forms';
import { catchError, of, take } from 'rxjs';
import { BillingService } from '@org/data-access';

interface Tier {
  id: string;
  name: string;
  description: string;
  monthly_cents: number;
  included: number;
  features: readonly string[];
}

const TIERS: readonly Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: '$50/mo · 100k included requests',
    monthly_cents: 5_000,
    included: 100_000,
    features: [
      'Up to 5 sites',
      '$0.001 / request overage',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    description: '$200/mo · 500k included requests',
    monthly_cents: 20_000,
    included: 500_000,
    features: [
      'Up to 25 sites',
      'Connect Express ready',
      'Priority support',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    description: '$800/mo · 2.5M included requests',
    monthly_cents: 80_000,
    included: 2_500_000,
    features: [
      'Unlimited sites',
      'Custom domains pre-verified',
      'Slack channel support',
    ],
  },
];

@Component({
  selector: 'lib-upgrade-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, RadioButtonModule],
  templateUrl: './upgrade-dialog.component.html',
  styleUrl: './upgrade-dialog.component.css',
})
export class UpgradeDialogComponent {
  private readonly billing = inject(BillingService);

  @Output() readonly closed = new EventEmitter<void>();

  @ViewChild('checkoutMount', { static: false })
  checkoutMount?: ElementRef<HTMLDivElement>;

  readonly tiers = TIERS;
  readonly selectedTier = signal<string>(TIERS[1].id);
  readonly clientSecret = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  startCheckout(): void {
    const tier = this.selectedTier();
    this.busy.set(true);
    this.error.set(null);
    this.billing
      .createCheckoutSession$(tier)
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.error.set(err?.message ?? 'Unable to start checkout');
          this.busy.set(false);
          return of(null);
        }),
      )
      .subscribe((session) => {
        this.busy.set(false);
        if (session?.client_secret) {
          this.clientSecret.set(session.client_secret);
        }
      });
  }

  cancel(): void {
    this.closed.emit();
  }
}
