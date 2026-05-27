/**
 * RefundRequestComponent — self-serve refund request.
 *
 * @remarks
 * NEVER auto-refunds. POSTs to `/api/billing/refunds` which queues the
 * request for admin review. The user receives a confirmation when the
 * request is approved or denied.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
  type FormGroup,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { HttpClient } from '@angular/common/http';
import { catchError, of, take } from 'rxjs';
import {
  BillingService,
  type RefundRequestPayload,
} from '@org/data-access';

/** #40 — refund disposition selector. */
type RefundType = 'card' | 'credits';

interface RefundResult {
  readonly type: RefundType;
  readonly status: string;
  readonly amount_cents?: number;
  readonly refund_id?: string;
  readonly wallet_transaction_id?: string;
}

interface RefundReason {
  label: string;
  value: RefundRequestPayload['reason'];
}

const REASONS: readonly RefundReason[] = [
  { label: 'Duplicate charge', value: 'duplicate' },
  { label: 'Fraudulent / unauthorized', value: 'fraudulent' },
  { label: 'Customer request', value: 'requested_by_customer' },
  { label: 'Service not delivered', value: 'service_not_delivered' },
  { label: 'Other', value: 'other' },
];

@Component({
  selector: 'lib-refund-request',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    SelectButtonModule,
  ],
  templateUrl: './refund-request.component.html',
  styleUrl: './refund-request.component.css',
})
export class RefundRequestComponent {
  private readonly fb = inject(FormBuilder);
  private readonly billing = inject(BillingService);
  private readonly http = inject(HttpClient);

  @Output() readonly closed = new EventEmitter<void>();

  readonly reasons = REASONS;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  /** #40 — disposition: refund to card OR post as wallet credit. */
  readonly refundType = signal<RefundType>('card');
  readonly refundTypeOptions = [
    { label: 'Back to card', value: 'card' as const },
    { label: 'Account credit', value: 'credits' as const },
  ];

  readonly form: FormGroup = this.fb.nonNullable.group({
    charge_id: ['', [Validators.required, Validators.minLength(4)]],
    reason: ['requested_by_customer', Validators.required],
    notes: [''],
    amount_cents: [0],
  });

  setRefundType(value: RefundType): void {
    this.refundType.set(value);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue() as RefundRequestPayload & {
      amount_cents?: number;
    };
    const amount = Math.max(0, Math.round(Number(raw.amount_cents) || 0));

    // Credits path requires an amount.
    if (this.refundType() === 'credits' && amount <= 0) {
      this.error.set('Enter the credit amount in cents.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    if (this.refundType() === 'credits') {
      // #40 — post to /api/billing/refund with type=credits. No Stripe call.
      this.http
        .post<RefundResult>('/api/billing/refund', {
          type: 'credits',
          charge_id: raw.charge_id,
          amount_cents: amount,
          reason: raw.notes ?? raw.reason,
        })
        .pipe(
          take(1),
          catchError((err: { message?: string }) => {
            this.error.set(err?.message ?? 'Unable to post credit');
            this.busy.set(false);
            return of(null);
          }),
        )
        .subscribe((r) => {
          this.busy.set(false);
          if (r) {
            this.success.set(
              `Credit posted (${r.wallet_transaction_id ?? '—'}). The customer can redeem on the next booking.`,
            );
            this.form.reset({
              reason: 'requested_by_customer',
              notes: '',
              amount_cents: 0,
            });
          }
        });
      return;
    }

    // Card path — keep the legacy "queue for admin review" behaviour.
    const payload: RefundRequestPayload = {
      charge_id: raw.charge_id,
      reason: raw.reason,
      notes: raw.notes,
    };
    this.billing
      .requestRefund$(payload)
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.error.set(err?.message ?? 'Unable to submit request');
          this.busy.set(false);
          return of(null);
        }),
      )
      .subscribe((r) => {
        this.busy.set(false);
        if (r) {
          this.success.set(`Request submitted (${r.id}). Status: ${r.status}.`);
          this.form.reset({
            reason: 'requested_by_customer',
            notes: '',
            amount_cents: 0,
          });
        }
      });
  }

  cancel(): void {
    this.closed.emit();
  }
}
