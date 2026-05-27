/**
 * `InvoicingService` — customer-managed invoicing (backlog #39).
 *
 * @remarks
 *  Wraps `/api/tenants/:id/invoices` (CREATE) and `GET /api/tenants/:id/invoices`
 *  (LIST). RxJS-first per `[[rxjs-first-angular]]`. The list polls every 60s
 *  and refreshes on every successful create.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  type Observable,
  Subject,
  catchError,
  map,
  merge,
  of,
  repeat,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';

const INVOICE_POLL_MS = 60_000;

export interface ManagedInvoiceLine {
  readonly description: string;
  readonly amount_cents: number;
  readonly quantity: number;
}

export interface ManagedInvoice {
  readonly id: string;
  readonly stripe_invoice_id: string | null;
  readonly customer_email: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status:
    | 'draft'
    | 'open'
    | 'paid'
    | 'uncollectible'
    | 'void'
    | 'sent'
    | 'failed';
  readonly hosted_invoice_url: string | null;
  readonly pdf_url: string | null;
  readonly due_date: string | null;
  readonly created_at: string;
}

export interface CreateInvoicePayload {
  readonly customer_email: string;
  readonly customer_name?: string;
  readonly line_items: ReadonlyArray<ManagedInvoiceLine>;
  readonly due_date?: string;
  readonly currency?: string;
  readonly send_now?: boolean;
  readonly memo?: string;
}

export interface CreateInvoiceReceipt {
  readonly invoice_id: string;
  readonly stripe_invoice_id: string;
  readonly hosted_invoice_url: string | null;
  readonly pdf_url: string | null;
  readonly status: string;
  readonly amount_cents: number;
  readonly currency: string;
}

@Injectable({ providedIn: 'root' })
export class InvoicingService {
  private readonly http = inject(HttpClient);
  private readonly tenant$$ = new BehaviorSubject<string | null>(null);
  private readonly refresh$$ = new Subject<void>();

  /** List poll. Bind a tenant via `setTenant(id)` to activate the stream. */
  readonly invoices$: Observable<ReadonlyArray<ManagedInvoice>> = merge(
    this.tenant$$,
    this.refresh$$.pipe(map(() => this.tenant$$.getValue())),
  ).pipe(
    switchMap((tenantId) => {
      if (!tenantId) return of<ReadonlyArray<ManagedInvoice>>([]);
      return this.http
        .get<{ invoices: ReadonlyArray<ManagedInvoice> }>(
          `/api/tenants/${encodeURIComponent(tenantId)}/invoices`,
        )
        .pipe(
          map((r) => r.invoices),
          catchError(() => of<ReadonlyArray<ManagedInvoice>>([])),
          repeat({ delay: INVOICE_POLL_MS }),
        );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  setTenant(tenantId: string): void {
    this.tenant$$.next(tenantId);
  }

  refresh(): void {
    this.refresh$$.next();
  }

  createInvoice$(
    tenantId: string,
    payload: CreateInvoicePayload,
  ): Observable<CreateInvoiceReceipt> {
    return this.http
      .post<CreateInvoiceReceipt>(
        `/api/tenants/${encodeURIComponent(tenantId)}/invoices`,
        payload,
      )
      .pipe(tap(() => this.refresh$$.next()));
  }
}
