/**
 * BillingService — RxJS-first data-access for the billing surface.
 *
 * @remarks
 * RxJS-first per `[[rxjs-first-angular]]`. Surfaces:
 *
 * - `subscription$` — long-lived `Observable<Entitlements>` polled every 60s
 *   via `repeat({ delay })` and multicast via `shareReplay({ bufferSize: 1,
 *   refCount: false })`. Transient errors collapse to `null` then heal.
 * - `usageStream$` — WebSocket stream from `/api/billing/usage/stream`.
 *   Emits `BillingUsageFrame` frames; `scan()` accumulates into a running
 *   `BillingUsageState` (period total, projected overage, pct of quota).
 * - `invoices$`, `paymentMethods$`, `receipts$` — paged GETs with manual
 *   refresh triggers.
 * - `createCheckoutSession$()`, `openCustomerPortal$()`,
 *   `requestRefund$()`, `connectOnboardingLink$()` — Observable mutations.
 *
 * Pricing (per BILLING.md): $50/mo base + 100k included reqs + $0.001/req
 * overage, 12% platform take-rate, 1.5% Stripe Connect fee.
 *
 * @example
 * ```ts
 * // Live usage meter in a component.
 * readonly usage = toSignal(this.billing.usageStream$, {
 *   initialValue: { period_requests: 0, included: 100_000, overage_cents: 0, pct: 0 },
 * });
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { webSocket, type WebSocketSubject } from 'rxjs/webSocket';
import {
  type Observable,
  Subject,
  catchError,
  map,
  merge,
  of,
  repeat,
  retry,
  scan,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
  timer,
} from 'rxjs';
import type { Entitlements } from '@org/domain';

const SUBSCRIPTION_POLL_MS = 60_000;
const INVOICE_REFRESH_MS = 120_000;
const WS_RETRY_MS = 5_000;

export interface Invoice {
  id: string;
  number: string;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  period_start: string;
  period_end: string;
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  created_at: string;
}

export interface Receipt {
  id: string;
  invoice_id: string;
  amount_cents: number;
  currency: string;
  receipt_url: string;
  paid_at: string;
}

export interface PaymentMethodSummary {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

export interface CheckoutSessionResponse {
  /** Stripe-hosted Embedded Checkout client secret (Link). */
  client_secret: string;
  session_id: string;
}

export interface PortalResponse {
  portal_url: string;
}

export interface ConnectOnboardingResponse {
  onboarding_url: string;
  expires_at: string;
}

export interface RefundRequestPayload {
  charge_id: string;
  reason:
    | 'duplicate'
    | 'fraudulent'
    | 'requested_by_customer'
    | 'service_not_delivered'
    | 'other';
  notes?: string;
}

export interface RefundRequestResponse {
  id: string;
  status: 'pending_review' | 'approved' | 'denied';
}

/**
 * Live frame pushed over the usage WebSocket. The server emits one of
 * these whenever a request is metered for the tenant.
 */
export interface BillingUsageFrame {
  type: 'usage';
  period_requests: number;
  included: number;
  overage_cents: number;
  pct_of_quota: number;
  projected_period_overage_cents: number;
  ts: string;
}

export interface BillingUsageState {
  period_requests: number;
  included: number;
  overage_cents: number;
  pct: number;
  projected_period_overage_cents: number;
  updated_at: string | null;
}

const INITIAL_USAGE_STATE: BillingUsageState = {
  period_requests: 0,
  included: 100_000,
  overage_cents: 0,
  pct: 0,
  projected_period_overage_cents: 0,
  updated_at: null,
};

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);

  private readonly subscriptionRefresh$$ = new Subject<void>();
  private readonly invoiceRefresh$$ = new Subject<void>();
  private readonly paymentMethodRefresh$$ = new Subject<void>();
  private readonly receiptRefresh$$ = new Subject<void>();

  private socket: WebSocketSubject<BillingUsageFrame> | null = null;

  /**
   * Entitlements stream — polled every 60s with manual refresh trigger.
   * Errors collapse to `null` so the UI never sticks on stale data.
   */
  readonly subscription$: Observable<Entitlements | null> = merge(
    of<void>(undefined),
    this.subscriptionRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<Entitlements>('/api/billing/subscription').pipe(
        catchError(() => of<Entitlements | null>(null)),
        repeat({ delay: SUBSCRIPTION_POLL_MS }),
      ),
    ),
    startWith<Entitlements | null>(null),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /**
   * Recent invoices — polled every 120s + manual refresh.
   */
  readonly invoices$: Observable<readonly Invoice[]> = merge(
    of<void>(undefined),
    this.invoiceRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<{ invoices: Invoice[] }>('/api/billing/invoices').pipe(
        map((r) => r.invoices),
        catchError(() => of<Invoice[]>([])),
        repeat({ delay: INVOICE_REFRESH_MS }),
      ),
    ),
    startWith<Invoice[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /**
   * Receipts list — same poll cadence as invoices.
   */
  readonly receipts$: Observable<readonly Receipt[]> = merge(
    of<void>(undefined),
    this.receiptRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<{ receipts: Receipt[] }>('/api/billing/receipts').pipe(
        map((r) => r.receipts),
        catchError(() => of<Receipt[]>([])),
        repeat({ delay: INVOICE_REFRESH_MS }),
      ),
    ),
    startWith<Receipt[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /**
   * Saved payment methods (summary only — the source-of-truth lives in
   * Stripe's Customer Portal).
   */
  readonly paymentMethods$: Observable<readonly PaymentMethodSummary[]> = merge(
    of<void>(undefined),
    this.paymentMethodRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http
        .get<{ methods: PaymentMethodSummary[] }>('/api/billing/payment-methods')
        .pipe(
          map((r) => r.methods),
          catchError(() => of<PaymentMethodSummary[]>([])),
        ),
    ),
    startWith<PaymentMethodSummary[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /**
   * Live usage meter. WebSocket frames `scan`d into a running state. The
   * stream auto-reconnects on transient WS errors via `retry({ delay })`.
   *
   * @remarks
   * Uses `shareReplay({ bufferSize: 1, refCount: true })` so the socket
   * closes when no template is subscribed. INP-friendly.
   */
  readonly usageStream$: Observable<BillingUsageState> = timer(0).pipe(
    switchMap(() => this.openUsageSocket()),
    scan<BillingUsageFrame, BillingUsageState>(
      (state, frame) => ({
        period_requests: frame.period_requests,
        included: frame.included,
        overage_cents: frame.overage_cents,
        pct: frame.pct_of_quota,
        projected_period_overage_cents: frame.projected_period_overage_cents,
        updated_at: frame.ts,
      }),
      INITIAL_USAGE_STATE,
    ),
    startWith(INITIAL_USAGE_STATE),
    retry({ delay: WS_RETRY_MS, count: Infinity }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private openUsageSocket(): Observable<BillingUsageFrame> {
    if (!this.socket || this.socket.closed) {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
      const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
      this.socket = webSocket<BillingUsageFrame>(
        `${protocol}://${host}/api/billing/usage/stream`,
      );
    }
    return this.socket;
  }

  refreshSubscription$(): Observable<void> {
    this.subscriptionRefresh$$.next();
    return this.subscription$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  refreshInvoices$(): Observable<void> {
    this.invoiceRefresh$$.next();
    return this.invoices$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  /**
   * Create a Stripe Embedded Checkout session for upgrading to `tier`.
   * Returns the `client_secret` to mount into the `<stripe-buy-button>` /
   * Embedded Checkout component.
   */
  createCheckoutSession$(tier: string): Observable<CheckoutSessionResponse> {
    return this.http.post<CheckoutSessionResponse>(
      '/api/billing/checkout',
      { tier, mode: 'embedded_link' },
    );
  }

  /**
   * Mint a one-time Customer-Portal session URL. Caller opens
   * `window.location.assign(portal_url)` (or `window.open` in a new tab).
   */
  openCustomerPortal$(): Observable<PortalResponse> {
    return this.http.post<PortalResponse>('/api/billing/portal', {});
  }

  /**
   * Mint a one-time Connect Express onboarding link. Caller redirects via
   * `window.location.assign`.
   */
  connectOnboardingLink$(): Observable<ConnectOnboardingResponse> {
    return this.http.post<ConnectOnboardingResponse>(
      '/api/billing/connect/onboarding-link',
      {},
    );
  }

  /**
   * Submit a refund request — never auto-refunds; routes to admin review.
   */
  requestRefund$(
    payload: RefundRequestPayload,
  ): Observable<RefundRequestResponse> {
    return this.http
      .post<RefundRequestResponse>('/api/billing/refunds', payload)
      .pipe(tap(() => this.invoiceRefresh$$.next()));
  }

  /**
   * Pause the subscription for 1, 2, or 3 months (backlog item #38). Stripe's
   * `pause_collection.behavior: 'mark_uncollectible'` keeps the subscription
   * active but suppresses invoice collection until `resumes_at`.
   */
  pauseSubscription$(
    months: 1 | 2 | 3,
  ): Observable<{ ok: boolean; paused_until: string; months: 1 | 2 | 3 }> {
    return this.http
      .post<{ ok: boolean; paused_until: string; months: 1 | 2 | 3 }>(
        '/api/billing/subscription/pause',
        { months },
      )
      .pipe(tap(() => this.subscriptionRefresh$$.next()));
  }

  /**
   * Verify nonprofit eligibility via TechSoup (backlog item #29). On success
   * the subscription's discount_pct flips to 50 and the next invoice
   * cycle picks up the $25/mo nonprofit rate.
   */
  verifyNonprofit$(args: {
    ein: string;
    ts_token: string;
  }): Observable<{
    ok: boolean;
    ein: string;
    discount_pct: number;
    org_name: string | null;
  }> {
    return this.http
      .post<{ ok: boolean; ein: string; discount_pct: number; org_name: string | null }>(
        '/api/billing/verify-nonprofit',
        args,
      )
      .pipe(tap(() => this.subscriptionRefresh$$.next()));
  }

  /**
   * Cash out a connected crew account via ACH push (backlog item #33).
   * Defaults to instant payout; auto-falls back to standard ACH server-side
   * when the destination doesn't support instant.
   */
  cashoutCrewPayout$(args: {
    destination: string;
    amount_cents: number;
    currency?: string;
    prefer_instant?: boolean;
  }): Observable<{
    payout_id: string;
    method: string;
    arrival_date: number;
    status: string;
    amount_cents: number;
  }> {
    return this.http.post<{
      payout_id: string;
      method: string;
      arrival_date: number;
      status: string;
      amount_cents: number;
    }>('/api/billing/crew/payouts/cashout', {
      destination: args.destination,
      amount_cents: args.amount_cents,
      currency: args.currency ?? 'usd',
      prefer_instant: args.prefer_instant ?? true,
    });
  }
}
