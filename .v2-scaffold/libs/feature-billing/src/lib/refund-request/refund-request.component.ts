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
  ReactiveFormsModule,
  Validators,
  type FormGroup,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { catchError, of, take } from 'rxjs';
import {
  BillingService,
  type RefundRequestPayload,
} from '@org/data-access';

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
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
  ],
  templateUrl: './refund-request.component.html',
  styleUrl: './refund-request.component.css',
})
export class RefundRequestComponent {
  private readonly fb = inject(FormBuilder);
  private readonly billing = inject(BillingService);

  @Output() readonly closed = new EventEmitter<void>();

  readonly reasons = REASONS;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly form: FormGroup = this.fb.nonNullable.group({
    charge_id: ['', [Validators.required, Validators.minLength(4)]],
    reason: ['requested_by_customer', Validators.required],
    notes: [''],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const payload: RefundRequestPayload = this.form.getRawValue();
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
          this.form.reset({ reason: 'requested_by_customer', notes: '' });
        }
      });
  }

  cancel(): void {
    this.closed.emit();
  }
}
