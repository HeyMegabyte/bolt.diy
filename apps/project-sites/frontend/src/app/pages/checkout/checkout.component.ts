/**
 * @module pages/checkout
 *
 * @description
 * Public-facing inline checkout page. Reads `?amount=&desc=&site_id=`
 * query params, mounts `<app-inline-checkout>` with them, and renders a
 * confirmation screen on success.
 *
 * Default amount is $25 (`2500` cents) when no `amount` param is supplied,
 * so a bare `/checkout` URL still mounts a working 1-click row.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { InlineCheckoutComponent } from '../../components/inline-checkout/inline-checkout.component';

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineCheckoutComponent],
  template: `
    <main class="checkout-page">
      <header class="checkout-page__hero">
        <h1 data-testid="checkout-heading">1-click checkout</h1>
        <p class="checkout-page__subtitle">
          Apple Pay, Google Pay, or Link — no card form required.
        </p>
      </header>

      @if (succeeded()) {
        <section class="checkout-page__success" data-testid="checkout-success">
          <h2>Payment confirmed</h2>
          <p>Receipt: {{ paymentIntentId() }}</p>
        </section>
      } @else {
        <app-inline-checkout
          [amountCents]="amountCents()"
          [description]="description()"
          [siteId]="siteId() || undefined"
          (succeeded)="onSuccess($event)"
        />
      }
    </main>
  `,
  styles: [
    `
      .checkout-page {
        max-width: 640px;
        margin: 0 auto;
        padding: 48px 24px 96px;
        color: var(--ps-ink, #f4f4ff);
      }
      .checkout-page__hero {
        text-align: center;
        margin-bottom: 32px;
      }
      .checkout-page__hero h1 {
        font-family: 'Sora', system-ui, sans-serif;
        font-size: clamp(1.875rem, 3.5vw, 2.5rem);
        font-weight: 700;
        margin: 0 0 6px;
      }
      .checkout-page__subtitle {
        color: color-mix(in oklch, var(--ps-ink) 65%, transparent);
        font-size: 0.9375rem;
        margin: 0;
      }
      .checkout-page__success {
        background: color-mix(in oklch, #34d399 12%, transparent);
        border: 1px solid color-mix(in oklch, #34d399 35%, transparent);
        border-radius: 16px;
        padding: 24px;
        text-align: center;
        color: #34d399;
      }
    `,
  ],
})
export class CheckoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    // Expose a window-level helper so Playwright can simulate the Stripe
    // SDK firing onConfirm without needing a real card. Only attached
    // when ?test_hook=1 is in the URL so production traffic never exposes
    // a payment shortcut. Kept lean — one function, one signal.
    if (typeof window !== 'undefined' && this.route.snapshot.queryParamMap.get('test_hook') === '1') {
      (window as unknown as Record<string, unknown>)['__psCheckoutSuccess'] = (id: string) =>
        this.onSuccess({ paymentIntentId: id });
    }
  }

  private readonly params = toSignal(
    this.route.queryParamMap.pipe(
      map((q) => ({
        amount: q.get('amount'),
        desc: q.get('desc'),
        siteId: q.get('site_id'),
      })),
    ),
    { initialValue: { amount: null, desc: null, siteId: null } },
  );

  readonly amountCents = computed(() => {
    const raw = this.params().amount;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
  });
  readonly description = computed(() => this.params().desc || 'Credit pack');
  readonly siteId = computed(() => this.params().siteId);

  readonly succeeded = signal(false);
  readonly paymentIntentId = signal<string>('');

  onSuccess(evt: { paymentIntentId: string }): void {
    this.paymentIntentId.set(evt.paymentIntentId);
    this.succeeded.set(true);
  }
}
