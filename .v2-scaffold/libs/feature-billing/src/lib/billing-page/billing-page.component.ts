/**
 * BillingPageComponent — admin `/dashboard/billing`.
 *
 * @remarks
 * Layout:
 * - Current-plan card (PrimeNG `p-card`): tier, monthly cost, included
 *   quota, overage rate, "Manage in Customer Portal" button.
 * - Live usage meter: WebSocket-driven `p-progressBar`, color-shifted by
 *   % of quota (green <70, amber 70-90, red >90).
 * - Recent invoices (ag-grid Community).
 * - Saved payment methods (summary; full CRUD in Stripe Portal).
 *
 * Pricing per `BILLING.md`: $50/mo base + 100k included reqs + $0.001/req
 * overage, 12% take-rate, 1.5% Connect fee.
 *
 * RxJS-first per `[[rxjs-first-angular]]` — every dynamic value is an
 * observable consumed via `async` pipe or `toSignal` for template reads.
 */
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { SelectButtonModule } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import { computed, signal } from '@angular/core';
import { catchError, of, take } from 'rxjs';
import {
  BillingService,
  type BillingUsageState,
  type Invoice,
} from '@org/data-access';
import { UpgradeDialogComponent } from '../upgrade-dialog/upgrade-dialog.component';
import { RefundRequestComponent } from '../refund-request/refund-request.component';

const BASE_MONTHLY_CENTS = 5_000; // $50/mo per BILLING.md
const OVERAGE_RATE_CENTS_PER_REQ = 0.1; // $0.001/req → 0.1 cents
const INCLUDED_REQUESTS = 100_000;

@Component({
  selector: 'lib-billing-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    CurrencyPipe,
    DatePipe,
    FormsModule,
    ButtonModule,
    CardModule,
    ProgressBarModule,
    TagModule,
    DialogModule,
    ConfirmDialogModule,
    ToastModule,
    SelectButtonModule,
    AgGridAngular,
    UpgradeDialogComponent,
    RefundRequestComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './billing-page.component.html',
  styleUrl: './billing-page.component.css',
})
export class BillingPageComponent {
  private readonly billing = inject(BillingService);
  private readonly router = inject(Router);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messages = inject(MessageService);

  readonly subscription = toSignal(this.billing.subscription$, {
    initialValue: null,
  });
  readonly usage = toSignal(this.billing.usageStream$, {
    initialValue: {
      period_requests: 0,
      included: INCLUDED_REQUESTS,
      overage_cents: 0,
      pct: 0,
      projected_period_overage_cents: 0,
      updated_at: null,
    } satisfies BillingUsageState,
  });
  readonly invoices = toSignal(this.billing.invoices$, { initialValue: [] });
  readonly paymentMethods = toSignal(this.billing.paymentMethods$, {
    initialValue: [],
  });

  readonly upgradeDialogOpen = signal(false);
  readonly refundDialogOpen = signal(false);
  readonly portalBusy = signal(false);
  readonly portalError = signal<string | null>(null);
  readonly pauseBusy = signal(false);
  readonly pauseMonths = signal<1 | 2 | 3>(1);
  readonly pauseOptions: readonly { label: string; value: 1 | 2 | 3 }[] = [
    { label: '1 month', value: 1 },
    { label: '2 months', value: 2 },
    { label: '3 months', value: 3 },
  ];

  readonly progressColor = computed(() => {
    const pct = this.usage().pct;
    if (pct >= 90) return 'danger';
    if (pct >= 70) return 'warning';
    return 'success';
  });

  readonly progressClass = computed(() => `usage-meter--${this.progressColor()}`);

  readonly projectedMonthCents = computed(() => {
    const overage = this.usage().projected_period_overage_cents;
    return BASE_MONTHLY_CENTS + Math.max(0, overage);
  });

  readonly baseMonthlyCents = BASE_MONTHLY_CENTS;
  readonly overageRateCentsPerReq = OVERAGE_RATE_CENTS_PER_REQ;
  readonly includedRequests = INCLUDED_REQUESTS;

  readonly invoiceCols: readonly ColDef<Invoice>[] = [
    {
      field: 'number',
      headerName: 'Invoice',
      flex: 1,
      cellRenderer: (params: { value: string; data: Invoice }) => {
        const url = params.data.hosted_invoice_url;
        return url
          ? `<a href="${url}" target="_blank" rel="noopener" data-testid="invoice-link">${params.value}</a>`
          : params.value;
      },
    },
    {
      field: 'period_start',
      headerName: 'Period',
      flex: 1,
      valueFormatter: (p: { value: string }) =>
        new Date(p.value).toLocaleDateString(),
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
    { field: 'status', headerName: 'Status', flex: 1 },
  ];

  openCustomerPortal(): void {
    this.portalBusy.set(true);
    this.portalError.set(null);
    this.billing
      .openCustomerPortal$()
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.portalError.set(err?.message ?? 'Unable to open portal');
          this.portalBusy.set(false);
          return of(null);
        }),
      )
      .subscribe((r) => {
        this.portalBusy.set(false);
        if (r?.portal_url) {
          window.open(r.portal_url, '_blank', 'noopener,noreferrer');
        }
      });
  }

  openUpgradeDialog(): void {
    this.upgradeDialogOpen.set(true);
  }

  closeUpgradeDialog(): void {
    this.upgradeDialogOpen.set(false);
  }

  openRefundDialog(): void {
    this.refundDialogOpen.set(true);
  }

  closeRefundDialog(): void {
    this.refundDialogOpen.set(false);
  }

  goToConnectOnboarding(): void {
    this.router.navigate(['/dashboard/billing/connect']);
  }

  goToReceipts(): void {
    this.router.navigate(['/dashboard/billing/receipts']);
  }

  /**
   * Open a confirm dialog explaining the prorated pause calculation, then
   * pause the subscription for the selected number of months (backlog #38).
   */
  confirmPauseSubscription(): void {
    const months = this.pauseMonths();
    const proratedBase = this.baseMonthlyCents * months;
    const dollars = (proratedBase / 100).toFixed(2);
    this.confirmation.confirm({
      header: 'Pause subscription',
      message:
        `Pause your subscription for ${months} month${months > 1 ? 's' : ''}? ` +
        `Stripe will mark invoices uncollectible during the pause. You'll save ` +
        `roughly $${dollars} in base subscription fees and overage stays at $0 ` +
        `while paused. Subscription auto-resumes after the pause window.`,
      icon: 'pi pi-pause-circle',
      acceptLabel: `Pause ${months}mo`,
      rejectLabel: 'Cancel',
      accept: () => this.pauseSubscription(months),
    });
  }

  private pauseSubscription(months: 1 | 2 | 3): void {
    this.pauseBusy.set(true);
    this.billing
      .pauseSubscription$(months)
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.messages.add({
            severity: 'error',
            summary: 'Pause failed',
            detail: err?.message ?? 'Unable to pause subscription',
          });
          this.pauseBusy.set(false);
          return of(null);
        }),
      )
      .subscribe((r) => {
        this.pauseBusy.set(false);
        if (r?.ok) {
          this.messages.add({
            severity: 'success',
            summary: 'Subscription paused',
            detail: `Resumes ${new Date(r.paused_until).toLocaleDateString()}`,
          });
        }
      });
  }
}
