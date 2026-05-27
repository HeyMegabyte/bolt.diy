/**
 * Quotes data-access. All methods return cold observables. Mutations
 * MUST be subscribed (no fire-and-forget `.subscribe()` inside the
 * service) — components own subscription lifetime via
 * `takeUntilDestroyed()` per `[[rxjs-first-angular]]`.
 *
 * @remarks
 * Endpoint surface mirrors `apps/project-sites/src/routes/api.ts`
 * + `services/billing.ts` from the v1 worker.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreatePaymentIntentInput,
  PaymentIntentResponse,
  PaymentIntentResponseSchema,
  Quote,
  QuoteSchema,
} from '@org/domain';
import { retryWithBackoff } from '@org/util-rxjs';
import { Observable, map } from 'rxjs';

export interface QuoteListItem
  extends Pick<
    Quote,
    'id' | 'customer_id' | 'total_cents' | 'currency' | 'expires_at'
  > {
  readonly status: 'draft' | 'sent' | 'accepted' | 'expired';
}

export interface ShareLink {
  readonly url: string;
  readonly signed_until: string;
  readonly qr_data_url: string;
}

@Injectable({ providedIn: 'root' })
export class QuotesService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/quotes';

  list$(): Observable<readonly QuoteListItem[]> {
    return this.http
      .get<{ items: QuoteListItem[] }>(this.base)
      .pipe(retryWithBackoff({ count: 2 }), map((r) => r.items));
  }

  getQuote$(id: string): Observable<Quote> {
    return this.http
      .get<unknown>(`${this.base}/${encodeURIComponent(id)}`)
      .pipe(retryWithBackoff({ count: 2 }), map((b) => QuoteSchema.parse(b)));
  }

  createQuote$(payload: Partial<Quote>): Observable<Quote> {
    return this.http
      .post<unknown>(this.base, payload)
      .pipe(map((b) => QuoteSchema.parse(b)));
  }

  updateQuote$(id: string, patch: Partial<Quote>): Observable<Quote> {
    return this.http
      .patch<unknown>(`${this.base}/${encodeURIComponent(id)}`, patch)
      .pipe(map((b) => QuoteSchema.parse(b)));
  }

  /**
   * Mints a Stripe PaymentIntent for this quote. The worker is
   * idempotent on `quote_id` so an accidental double-click is safe;
   * the UI ALSO disables the pay button until the response resolves
   * (defense-in-depth — see `quote-detail-pay.spec.ts`).
   */
  payQuote$(
    id: string,
    extras: Partial<CreatePaymentIntentInput> = {}
  ): Observable<PaymentIntentResponse> {
    return this.http
      .post<unknown>(`${this.base}/${encodeURIComponent(id)}/pay`, extras)
      .pipe(map((b) => PaymentIntentResponseSchema.parse(b)));
  }

  shareQuote$(id: string): Observable<ShareLink> {
    return this.http.post<ShareLink>(
      `${this.base}/${encodeURIComponent(id)}/share`,
      {}
    );
  }
}
