/**
 * ReceiptsPageComponent — `/dashboard/billing/receipts`.
 *
 * @remarks
 * Receipt-only view (paid invoices with the Stripe-hosted receipt URL).
 * ag-grid Community renders the list; each row links out to the
 * stripe-hosted receipt.
 */
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import { BillingService, type Receipt } from '@org/data-access';

@Component({
  selector: 'lib-receipts-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CurrencyPipe, AgGridAngular],
  template: `
    <section class="receipts-page" data-testid="receipts-page">
      <h1>Receipts</h1>
      <div
        class="ag-theme-alpine-dark receipts-page__grid"
        data-testid="receipts-grid"
      >
        <ag-grid-angular
          [rowData]="receipts()"
          [columnDefs]="cols"
          [domLayout]="'autoHeight'"
          [animateRows]="true"
          [suppressCellFocus]="true"
        />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: clamp(16px, 2vw, 32px);
      }
      h1 {
        margin: 0 0 16px;
        font-size: clamp(1.4rem, 1.4vw + 1rem, 2.1rem);
      }
      .receipts-page__grid {
        min-height: 240px;
        border-radius: 22px;
        overflow: hidden;
      }
    `,
  ],
})
export class ReceiptsPageComponent {
  private readonly billing = inject(BillingService);

  readonly receipts = toSignal(this.billing.receipts$, { initialValue: [] });

  readonly cols: readonly ColDef<Receipt>[] = [
    {
      field: 'id',
      headerName: 'Receipt',
      flex: 1,
      cellRenderer: (params: { value: string; data: Receipt }) =>
        `<a href="${params.data.receipt_url}" target="_blank" rel="noopener" data-testid="receipt-link">${params.value}</a>`,
    },
    {
      field: 'amount_cents',
      headerName: 'Amount',
      flex: 1,
      valueFormatter: (p: { value: number }) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(p.value / 100),
    },
    {
      field: 'paid_at',
      headerName: 'Paid',
      flex: 1,
      valueFormatter: (p: { value: string }) =>
        new Date(p.value).toLocaleString(),
    },
  ];
}
