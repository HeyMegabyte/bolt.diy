import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

/** `GET /api/credits/balance` response. */
interface BalanceResponse {
  org_id: string;
  balance: number;
  monthly_allowance: number;
  rollover_cap: number;
}

/** One ledger row, mirrors the worker shape. */
interface LedgerRow {
  id: string;
  kind: string;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

/** `GET /api/credits/history` response. */
interface HistoryResponse {
  org_id: string;
  rows: LedgerRow[];
  count: number;
}

/**
 * Credit wallet — the client for the `credit_wallet_rollover` feature. Shows the
 * org's AI-credit balance (with monthly allowance + rollover cap) and the recent
 * ledger on the Billing "Plan & usage" tab.
 *
 * @remarks
 * The API IS the flag gate: `GET /api/credits/balance` returns 404 when the
 * `credit_wallet_rollover` flag is off → the widget renders nothing.
 *
 * @example
 * <app-credits-widget />
 */
@Component({
  selector: 'app-credits-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <!-- Reserve the wallet card's height while the balance fetches, so the Plan card
           below it (and the rest of the subscription tab) doesn't shift when it lands —
           a top /admin/billing layout-shift contributor (CLS 0.12 → ≤0.05). aria-hidden;
           collapses (honest-empty) when the flag is off / no balance. -->
      <div class="card cw cw-skeleton" aria-hidden="true" data-testid="credits-skeleton">
        <div class="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <span class="cw-skel cw-skel-title"></span>
            <span class="cw-skel cw-skel-sub"></span>
          </div>
          <span class="cw-skel cw-skel-balance"></span>
        </div>
        <ul class="cw-list">
          @for (i of skelRows; track i) {
            <li class="cw-row"><span class="cw-skel cw-skel-chip"></span><span class="cw-skel cw-skel-desc"></span><span class="cw-skel cw-skel-amt"></span></li>
          }
        </ul>
      </div>
    } @else if (loaded()) {
      <div class="card cw" data-testid="credits-widget">
        <div class="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">Credit wallet</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-1">AI credits — rolls over up to {{ cap() }}/mo.</p>
          </div>
          <div class="cw-balance">
            <span class="cw-num" data-testid="credits-balance">{{ balance() }}</span>
            <span class="cw-lbl">credits · {{ allowance() }}/mo</span>
          </div>
        </div>
        @if (rows().length > 0) {
          <ul class="cw-list" data-testid="credits-history">
            @for (r of rows(); track r.id) {
              <li class="cw-row" data-testid="credit-entry" [attr.data-kind]="r.kind">
                <span class="cw-chip" [class]="'cw-chip--' + toneClass(r.kind)">{{ r.kind }}</span>
                <span class="cw-desc">{{ r.description || r.kind }}</span>
                <span class="cw-amt" [class.cw-amt--pos]="r.amount >= 0" [class.cw-amt--neg]="r.amount < 0" data-testid="credit-amount">
                  {{ r.amount >= 0 ? '+' : '' }}{{ r.amount }}
                </span>
              </li>
            }
          </ul>
        } @else {
          <p class="cw-empty" data-testid="credits-empty">No credit activity yet this period.</p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .cw { margin-top: 1rem; }
    .cw-balance { text-align: right; line-height: 1.05; }
    .cw-num { display: block; font-size: 1.6rem; font-weight: 800; color: var(--ps-accent, #00e5ff); font-variant-numeric: tabular-nums; }
    .cw-lbl { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.45); }
    .cw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .cw-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0; border-top: 1px solid rgba(255,255,255,0.04); min-width: 0; }
    .cw-row:first-child { border-top: 0; }
    .cw-chip { flex-shrink: 0; font-size: 0.58rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; }
    .cw-chip--grant { color: #34d399; background: color-mix(in oklch, #34d399 14%, transparent); }
    .cw-chip--applied { color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .cw-desc { flex: 1; min-width: 0; font-size: 0.8rem; color: var(--ps-ink, #f4f4ff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cw-amt { flex-shrink: 0; font-size: 0.82rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .cw-amt--pos { color: #34d399; }
    .cw-amt--neg { color: rgba(255,255,255,0.7); }
    .cw-empty { font-size: 0.8rem; color: rgba(255,255,255,0.45); margin: 0; }
    /* Loading skeleton — reuses .cw / .cw-row so its height matches the real wallet card
       (reserves space → no CLS when the balance lands). */
    .cw-skel { display: block; border-radius: 6px; background: rgba(255,255,255,0.06); animation: cw-pulse 1.4s ease-in-out infinite; }
    .cw-skel-title { width: 7rem; height: 1rem; }
    .cw-skel-sub { width: 10rem; height: 0.7rem; margin-top: 6px; }
    .cw-skel-balance { width: 5rem; height: 1.8rem; border-radius: 8px; }
    .cw-skel-chip { flex-shrink: 0; width: 3.4rem; height: 1rem; border-radius: 999px; }
    .cw-skel-desc { flex: 1; min-width: 0; height: 0.8rem; }
    .cw-skel-amt { flex-shrink: 0; width: 2.2rem; height: 0.82rem; }
    @keyframes cw-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }
    @media (prefers-reduced-motion: reduce) { .cw-skel { animation: none; } }
  `],
})
export class CreditsWidgetComponent implements OnInit {
  private readonly api = inject(ApiService);

  private readonly bal = signal<BalanceResponse | null>(null);
  private readonly rowsSig = signal<LedgerRow[]>([]);
  private readonly seenBalance = signal(false);
  /** Flips true once the balance fetch resolves (success OR error) — distinguishes
   *  "loading" from "settled-empty" (flag off), both of which leave seenBalance false. */
  private readonly settled = signal(false);

  readonly balance = computed(() => this.bal()?.balance ?? 0);
  readonly allowance = computed(() => this.bal()?.monthly_allowance ?? 0);
  readonly cap = computed(() => this.bal()?.rollover_cap ?? 0);
  readonly rows = computed(() => this.rowsSig());
  /** Show once the balance loads (200 = flag on). */
  readonly loaded = computed(() => this.seenBalance());
  /** True until the balance fetch resolves — drives the height-reserving skeleton so the
   *  wallet card doesn't shift the Plan card below it when it lands. */
  readonly loading = computed(() => !this.settled());
  /** Skeleton ledger-row placeholders — reserves a representative wallet height. */
  readonly skelRows = [0, 1, 2, 3];

  ngOnInit(): void {
    this.api.get<BalanceResponse>('/credits/balance', undefined, { silent: true }).subscribe({
      next: (res) => {
        if (res && typeof res.balance === 'number') {
          this.bal.set(res);
          this.seenBalance.set(true);
        }
        this.settled.set(true);
      },
      error: () => this.settled.set(true),
    });
    this.api.get<HistoryResponse>('/credits/history', undefined, { silent: true }).subscribe({
      next: (res) => this.rowsSig.set(Array.isArray(res?.rows) ? res.rows : []),
      error: () => this.rowsSig.set([]),
    });
  }

  /** Positive-amount kinds tone green; debits tone accent. */
  toneClass(kind: string): 'grant' | 'applied' {
    return kind === 'applied' ? 'applied' : 'grant';
  }
}
