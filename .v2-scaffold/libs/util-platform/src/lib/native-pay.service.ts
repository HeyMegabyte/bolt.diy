/**
 * `NativePayService` — Apple Pay (iOS) / Google Pay (Android) via the
 * `@capacitor-community/stripe` PaymentSheet API.
 *
 * @remarks
 * RxJS-first wrapper around `Stripe.createPaymentSheet` +
 * `presentPaymentSheet`. The PaymentSheet automatically selects Apple Pay
 * on iOS and Google Pay on Android when the device supports it; falls
 * back to a Stripe-hosted card form when not.
 *
 * Flow:
 *  1. Caller emits `{ amountCents, currency, label }`.
 *  2. Service hits the existing `POST /api/billing/payment-intent`
 *     endpoint to mint a PaymentIntent + ephemeral key for the customer.
 *  3. `Stripe.createPaymentSheet({...})` configures the native sheet.
 *  4. `Stripe.presentPaymentSheet()` opens it; user pays.
 *  5. Emits `{ success, paymentIntentId }`, completes.
 *
 * Web path is a no-op fallback — the Stripe.js Elements form is the
 * canonical web checkout and lives in `@org/feature-billing`. This
 * service is the native sibling.
 *
 * @example
 * ```ts
 * pay.payNative$({ amountCents: 4500, currency: 'usd', label: 'Job tip' })
 *   .subscribe(r => r.success && this.toast('Paid', r.paymentIntentId));
 * ```
 *
 * @see ./capacitor-plugins.ts § StripeModule
 * @see [[rxjs-first-angular]]
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { loadStripe } from './capacitor-plugins';

/** Options accepted by `payNative$`. */
export interface PayNativeOpts {
  readonly amountCents: number;
  readonly currency: string;
  readonly label: string;
  /** Optional Stripe customer id; if absent, the server creates a guest. */
  readonly customerId?: string;
}

/** Result emitted by `payNative$`. */
export interface PayNativeResult {
  readonly success: boolean;
  readonly paymentIntentId?: string;
  readonly canceled?: boolean;
  readonly source: 'native' | 'web' | 'unsupported';
}

interface PaymentIntentResponse {
  readonly client_secret: string;
  readonly payment_intent_id: string;
  readonly customer_id?: string;
  readonly ephemeral_key_secret?: string;
  readonly publishable_key: string;
}

function detectIsNative(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

@Injectable({ providedIn: 'root' })
export class NativePayService {
  private readonly http = inject(HttpClient);
  private stripeInitialized = false;

  /** `true` when running on iOS or Android via Capacitor. */
  readonly isNative = detectIsNative();

  /**
   * Mint a PaymentIntent + open the native PaymentSheet.
   *
   * @param opts - {@link PayNativeOpts}
   * @returns `Observable<PayNativeResult>` — emits once, then completes.
   */
  payNative$(opts: PayNativeOpts): Observable<PayNativeResult> {
    if (!this.isNative) {
      return of<PayNativeResult>({
        success: false,
        canceled: false,
        source: 'unsupported',
      });
    }

    return this.createPaymentIntent$(opts).pipe(
      switchMap((pi) =>
        defer(() => from(loadStripe())).pipe(
          switchMap((mod) => this.ensureInitialized$(mod, pi.publishable_key).pipe(map(() => mod))),
          switchMap((mod) =>
            from(
              mod.Stripe.createPaymentSheet({
                paymentIntentClientSecret: pi.client_secret,
                customerEphemeralKeySecret: pi.ephemeral_key_secret,
                customerId: pi.customer_id,
                merchantDisplayName: opts.label || 'ProjectSites',
                style: 'alwaysDark',
                enableApplePay: true,
                applePayMerchantId: 'merchant.space.megabyte.projectsites',
                enableGooglePay: true,
                countryCode: 'US',
              }),
            ).pipe(map(() => mod)),
          ),
          switchMap((mod) => from(mod.Stripe.presentPaymentSheet())),
          map<unknown, PayNativeResult>((res) => {
            const r = res as { paymentResult: string; paymentIntent?: { id?: string } };
            if (r.paymentResult === 'paymentSheetCompleted') {
              return {
                success: true,
                paymentIntentId: r.paymentIntent?.id ?? pi.payment_intent_id,
                source: 'native',
              };
            }
            if (r.paymentResult === 'paymentSheetCanceled') {
              return { success: false, canceled: true, source: 'native' };
            }
            return { success: false, source: 'native' };
          }),
        ),
      ),
      catchError((err) => throwError(() => err)),
    );
  }

  private createPaymentIntent$(opts: PayNativeOpts): Observable<PaymentIntentResponse> {
    return this.http.post<PaymentIntentResponse>('/api/billing/payment-intent', {
      amount_cents: opts.amountCents,
      currency: opts.currency,
      label: opts.label,
      customer_id: opts.customerId,
    });
  }

  private ensureInitialized$(
    mod: Awaited<ReturnType<typeof loadStripe>>,
    publishableKey: string,
  ): Observable<void> {
    if (this.stripeInitialized) return of(void 0);
    return defer(() => from(mod.Stripe.initialize({ publishableKey }))).pipe(
      tap(() => (this.stripeInitialized = true)),
    );
  }
}
