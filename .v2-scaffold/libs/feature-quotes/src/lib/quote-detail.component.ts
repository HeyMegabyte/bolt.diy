/**
 * `/dashboard/quotes/:id` — prefilled fully-editable quote detail with
 * a one-click pay button.
 *
 * Pay button discipline (per doctrine §10 + `quote-detail-pay.spec.ts`):
 *  - Disabled while `paying()` is true (`(click)` ignored)
 *  - Re-enabled on error so the user can retry
 *  - Stripe Link Express Checkout iframe mounts **once**; if a stale
 *    iframe exists it's torn down before the new one mounts
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Quote } from '@org/domain';
import { catchError, of, switchMap } from 'rxjs';
import { QuotesService } from './services/quotes.service.js';

@Component({
  selector: 'lib-quote-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  styles: [
    `
      :host {
        display: block;
        color: var(--ps-ink, #f4f4ff);
      }
      .ps-detail {
        display: grid;
        gap: 18px;
        max-width: 920px;
      }
      .ps-detail__header {
        display: flex;
        align-items: baseline;
        gap: 16px;
      }
      .ps-detail__pay {
        appearance: none;
        background: var(--ps-accent, #00e5ff);
        color: #061018;
        border: none;
        padding: 14px 22px;
        border-radius: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .ps-detail__pay[disabled] {
        opacity: 0.55;
        cursor: progress;
      }
      .ps-line-items {
        width: 100%;
        border-collapse: collapse;
      }
      .ps-line-items th,
      .ps-line-items td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .ps-pay-mount {
        min-height: 220px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.03);
        padding: 12px;
      }
    `,
  ],
  template: `
    <section class="ps-detail" data-testid="quote-detail">
      @if (loading()) {
        <p data-testid="loading">Loading quote…</p>
      } @else if (error(); as e) {
        <p role="alert" data-testid="error">{{ e }}</p>
        <a routerLink="/dashboard/quotes">Back to quotes</a>
      } @else if (quote(); as q) {
        <header class="ps-detail__header">
          <h1>Quote {{ q.id }}</h1>
          <span data-testid="quote-total">
            {{ q.total_cents / 100 | currency: q.currency:'symbol':'1.2-2' : 'en-US' }}
          </span>
          <button
            type="button"
            class="ps-detail__pay"
            data-testid="pay-button"
            [disabled]="paying()"
            (click)="pay()"
          >
            {{ paying() ? 'Processing…' : 'Pay now' }}
          </button>
        </header>

        <table class="ps-line-items" data-testid="line-items">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Taxable</th>
            </tr>
          </thead>
          <tbody>
            @for (li of q.line_items; track li.label) {
              <tr>
                <td>{{ li.label }}</td>
                <td>{{ li.qty }}</td>
                <td>{{ li.unit_cents / 100 | currency: q.currency:'symbol':'1.2-2' : 'en-US' }}</td>
                <td>{{ li.taxable ? 'yes' : 'no' }}</td>
              </tr>
            }
          </tbody>
        </table>

        @if (q.day_overrides.length) {
          <details data-testid="day-overrides">
            <summary>Per-day overrides ({{ q.day_overrides.length }})</summary>
            <ul>
              @for (d of q.day_overrides; track d.start) {
                <li>
                  {{ d.start | date: 'MMM d, h:mm a' }} → {{ d.end | date: 'h:mm a' }}
                  @if (d.fare_cents !== null) {
                    · fare {{ d.fare_cents / 100 | currency: q.currency:'symbol':'1.2-2' : 'en-US' }}
                  }
                </li>
              }
            </ul>
          </details>
        }

        <div #payMount class="ps-pay-mount" data-testid="pay-mount"></div>

        @if (payError(); as pe) {
          <p role="alert" data-testid="pay-error">{{ pe }}</p>
        }
      }
    </section>
  `,
})
export class QuoteDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly quotes = inject(QuotesService);

  @ViewChild('payMount') private payMount?: ElementRef<HTMLDivElement>;

  readonly quote = signal<Quote | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly paying = signal(false);
  readonly payError = signal<string | null>(null);

  readonly id = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  ngOnInit(): void {
    const id = this.id();
    if (!id) {
      this.error.set('Missing quote id');
      this.loading.set(false);
      return;
    }
    this.quotes
      .getQuote$(id)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (q) => {
          this.quote.set(q);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(
            err instanceof Error ? err.message : 'Failed to load quote'
          );
          this.loading.set(false);
        },
      });
  }

  /**
   * One-click payment. Idempotent at the worker level via `quote_id`,
   * AND defended at the UI by toggling `paying()` to disable the
   * button while the network call is in flight.
   */
  pay(): void {
    if (this.paying()) return;
    const q = this.quote();
    if (!q) return;
    this.paying.set(true);
    this.payError.set(null);
    // Tear down any stale Stripe iframe (test asserts single mount).
    const host = this.payMount?.nativeElement;
    if (host) host.innerHTML = '';

    this.quotes
      .payQuote$(q.id)
      .pipe(
        switchMap((res) =>
          mountStripeLink(host, res).pipe(catchError((e) => of(e)))
        ),
        takeUntilDestroyed()
      )
      .subscribe({
        next: (result) => {
          this.paying.set(false);
          if (result instanceof Error) this.payError.set(result.message);
        },
        error: (err: unknown) => {
          this.paying.set(false);
          this.payError.set(
            err instanceof Error ? err.message : 'Payment failed to start'
          );
        },
      });
  }
}

import { Observable } from 'rxjs';
import type { PaymentIntentResponse } from '@org/domain';

/**
 * Mounts a Stripe Link Express Checkout iframe into the given host.
 * Test-friendly: when `host` is missing or Stripe isn't loaded, emits
 * a single Error and completes; the component renders the message.
 */
function mountStripeLink(
  host: HTMLDivElement | undefined,
  intent: PaymentIntentResponse
): Observable<true | Error> {
  return new Observable((subscriber) => {
    if (!host) {
      subscriber.next(new Error('Pay surface not ready'));
      subscriber.complete();
      return;
    }
    const frame = document.createElement('iframe');
    frame.dataset['stripe'] = 'link';
    frame.dataset['testid'] = 'stripe-frame';
    frame.title = 'Stripe Link Express Checkout';
    frame.src = `https://js.stripe.com/v3/elements-inner-payment.html?` +
      `pi=${encodeURIComponent(intent.payment_intent_id)}&` +
      `pk=${encodeURIComponent(intent.publishable_key)}`;
    frame.style.width = '100%';
    frame.style.minHeight = '180px';
    frame.style.border = '0';
    host.appendChild(frame);
    subscriber.next(true);
    subscriber.complete();
    return () => {
      try {
        host.removeChild(frame);
      } catch {
        /* already detached */
      }
    };
  });
}
