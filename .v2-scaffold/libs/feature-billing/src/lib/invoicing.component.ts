/**
 * `InvoicingComponent` — customer-managed invoicing (backlog #39).
 *
 * @remarks
 *  Two surfaces:
 *   1. Table of past invoices (`invoices$` from `InvoicingService`).
 *   2. PrimeNG dialog for creating a new invoice — one customer email, n line
 *      items, due date, optional memo. Submits to the tenant's Connect acct.
 *
 *  RxJS-first per `[[rxjs-first-angular]]`. Refreshes on every successful
 *  create.
 */
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { catchError, of, take } from 'rxjs';
import {
  InvoicingService,
  type CreateInvoicePayload,
  type ManagedInvoice,
  type ManagedInvoiceLine,
} from '@org/data-access';

@Component({
  selector: 'lib-invoicing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    DialogModule,
    InputTextModule,
    TagModule,
    ToastModule,
    CurrencyPipe,
    DatePipe,
  ],
  providers: [MessageService],
  template: `
    <section class="invoicing" data-testid="invoicing">
      <header>
        <h2>Invoices</h2>
        <button
          pButton
          icon="pi pi-plus"
          label="Create invoice"
          (click)="openCreate()"
          data-testid="invoicing-create"
        ></button>
      </header>

      @if (invoices().length === 0) {
        <p class="empty">No invoices yet. Bill a customer to get started.</p>
      } @else {
        <table class="t" data-testid="invoicing-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Due</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (inv of invoices(); track inv.id) {
              <tr>
                <td>{{ inv.customer_email }}</td>
                <td>{{ inv.amount_cents / 100 | currency: inv.currency.toUpperCase() }}</td>
                <td><p-tag [severity]="statusSeverity(inv.status)" [value]="inv.status" /></td>
                <td>{{ inv.due_date || '—' }}</td>
                <td>{{ inv.created_at | date: 'medium' }}</td>
                <td>
                  @if (inv.hosted_invoice_url) {
                    <a [href]="inv.hosted_invoice_url" target="_blank" rel="noopener">View</a>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }

      <p-dialog
        [(visible)]="dialogOpen"
        [modal]="true"
        header="Create invoice"
        [style]="{ width: '560px' }"
        (onHide)="resetForm()"
      >
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="form"
          data-testid="invoicing-form"
        >
          <label>
            <span>Customer email</span>
            <input pInputText type="email" formControlName="customer_email" required />
          </label>
          <label>
            <span>Customer name (optional)</span>
            <input pInputText type="text" formControlName="customer_name" />
          </label>
          <label>
            <span>Due date</span>
            <input pInputText type="date" formControlName="due_date" />
          </label>

          <fieldset class="lines" formArrayName="line_items">
            <legend>Line items</legend>
            @for (item of lines.controls; track $index; let i = $index) {
              <div class="line" [formGroupName]="i">
                <input pInputText type="text" formControlName="description" placeholder="Description" />
                <input pInputText type="number" min="1" step="1" formControlName="quantity" placeholder="Qty" />
                <input pInputText type="number" min="100" step="100" formControlName="amount_cents" placeholder="Cents" />
                <button
                  pButton
                  type="button"
                  size="small"
                  icon="pi pi-trash"
                  severity="danger"
                  text
                  (click)="removeLine(i)"
                  [disabled]="lines.length === 1"
                  aria-label="Remove line"
                ></button>
              </div>
            }
            <button
              pButton
              type="button"
              size="small"
              icon="pi pi-plus"
              label="Add line"
              text
              (click)="addLine()"
              data-testid="invoicing-add-line"
            ></button>
          </fieldset>

          <label>
            <span>Memo (optional)</span>
            <input pInputText type="text" formControlName="memo" />
          </label>

          @if (errorMessage()) {
            <p class="err">{{ errorMessage() }}</p>
          }

          <footer>
            <button
              pButton
              type="button"
              label="Cancel"
              text
              (click)="dialogOpen.set(false)"
            ></button>
            <button
              pButton
              type="submit"
              [label]="busy() ? 'Sending…' : 'Send invoice'"
              [disabled]="busy() || form.invalid"
              data-testid="invoicing-submit"
            ></button>
          </footer>
        </form>
      </p-dialog>

      <p-toast position="top-right" />
    </section>
  `,
  styles: [
    `
      .invoicing { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; }
      header { display: flex; align-items: center; justify-content: space-between; }
      header h2 { margin: 0; font-size: 1.25rem; }
      table.t { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      table.t th, table.t td { padding: .5rem; border-bottom: 1px solid var(--surface-border, #2a2a36); text-align: left; }
      .empty { color: var(--text-color-secondary, #8a8a98); padding: 1rem 0; }
      .form { display: flex; flex-direction: column; gap: .75rem; }
      .form label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
      .lines { display: flex; flex-direction: column; gap: .5rem; border: 1px solid var(--surface-border, #2a2a36); border-radius: .5rem; padding: .75rem; }
      .line { display: grid; grid-template-columns: 2fr .5fr 1fr auto; gap: .5rem; align-items: center; }
      footer { display: flex; justify-content: flex-end; gap: .5rem; margin-top: .5rem; }
      .err { color: var(--p-red-400, #f87171); font-size: .85rem; }
    `,
  ],
})
export class InvoicingComponent {
  @Input({ required: true }) set tenantId(value: string) {
    this.tenant = value;
    this.invoicing.setTenant(value);
  }

  private readonly fb = inject(FormBuilder);
  private readonly invoicing = inject(InvoicingService);
  private readonly toast = inject(MessageService);
  private tenant = '';

  readonly dialogOpen = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly invoices = toSignal(this.invoicing.invoices$, {
    initialValue: [] as ReadonlyArray<ManagedInvoice>,
  });

  readonly form = this.fb.nonNullable.group({
    customer_email: ['', [Validators.required, Validators.email]],
    customer_name: [''],
    due_date: [''],
    memo: [''],
    line_items: this.fb.array([this.makeLine()]),
  });

  get lines(): FormArray {
    return this.form.get('line_items') as FormArray;
  }

  openCreate(): void {
    this.errorMessage.set(null);
    this.dialogOpen.set(true);
  }

  resetForm(): void {
    this.form.reset({
      customer_email: '',
      customer_name: '',
      due_date: '',
      memo: '',
    });
    while (this.lines.length > 1) this.lines.removeAt(this.lines.length - 1);
    this.lines.at(0).reset({ description: '', quantity: 1, amount_cents: 0 });
  }

  addLine(): void {
    if (this.lines.length >= 40) return;
    this.lines.push(this.makeLine());
  }

  removeLine(i: number): void {
    if (this.lines.length === 1) return;
    this.lines.removeAt(i);
  }

  submit(): void {
    if (!this.tenant) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const items: ManagedInvoiceLine[] = (raw.line_items as ManagedInvoiceLine[]).map(
      (l) => ({
        description: String(l.description ?? '').slice(0, 500),
        amount_cents: Math.max(1, Math.round(Number(l.amount_cents) || 0)),
        quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
      }),
    );
    if (items.length === 0 || items.some((l) => !l.description)) {
      this.errorMessage.set('Every line needs a description and amount.');
      return;
    }
    const payload: CreateInvoicePayload = {
      customer_email: raw.customer_email,
      customer_name: raw.customer_name || undefined,
      due_date: raw.due_date || undefined,
      memo: raw.memo || undefined,
      send_now: true,
      currency: 'usd',
      line_items: items,
    };
    this.busy.set(true);
    this.errorMessage.set(null);
    this.invoicing
      .createInvoice$(this.tenant, payload)
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.busy.set(false);
          this.errorMessage.set(err?.message ?? 'Unable to create invoice');
          return of(null);
        }),
      )
      .subscribe((r) => {
        this.busy.set(false);
        if (r) {
          this.toast.add({
            severity: 'success',
            summary: 'Invoice sent',
            detail: `Stripe invoice ${r.stripe_invoice_id} created.`,
            life: 5_000,
          });
          this.dialogOpen.set(false);
          this.resetForm();
        }
      });
  }

  protected statusSeverity(s: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    if (s === 'paid') return 'success';
    if (s === 'sent' || s === 'open') return 'info';
    if (s === 'failed' || s === 'uncollectible') return 'danger';
    if (s === 'void') return 'secondary';
    return 'warn';
  }

  private makeLine() {
    return this.fb.nonNullable.group({
      description: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
      amount_cents: [0, [Validators.required, Validators.min(1)]],
    });
  }
}
