import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

/** Budget meter, mirrors the worker `BudgetMeter` shape. */
interface BudgetMeter {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  pct: number;
}

/** `GET /api/usage/budget` response. */
interface OrgBudgetResponse {
  orgId: string;
  plan: 'free' | 'paid' | 'unlimited';
  meter: BudgetMeter;
}

/**
 * AI budget meter — the client for the `token_burn_meter` feature. Surfaces the
 * org's AI spend against its period cap (with the budget killswitch state), so
 * an owner sees their burn before a request is blocked.
 *
 * @remarks
 * The API IS the flag gate: `GET /api/usage/budget` returns 404 when the
 * `token_burn_meter` flag is off → the widget renders nothing.
 *
 * @example
 * <app-ai-budget-meter />
 */
@Component({
  selector: 'app-ai-budget-meter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      <section class="bm" role="region" aria-labelledby="bm-heading" data-testid="ai-budget-meter" [class.bm--blocked]="!d.meter.allowed">
        <div class="bm-row">
          <div class="bm-lead">
            <span class="bm-eyebrow" id="bm-heading">AI budget · {{ d.plan }}</span>
            @if (unlimited()) {
              <span class="bm-amount" data-testid="ai-budget-unlimited">Unlimited spend</span>
            } @else {
              <span class="bm-amount">
                <span data-testid="ai-budget-spent">{{ usd(d.meter.spentUsd) }}</span>
                <span class="bm-of"> of </span>
                <span data-testid="ai-budget-cap">{{ usd(d.meter.capUsd) }}</span>
                <span class="bm-period"> this period</span>
              </span>
            }
          </div>
          @if (!unlimited()) {
            <span class="bm-remaining" [class.bm-remaining--low]="lowOrOver()" data-testid="ai-budget-remaining">
              {{ usd(d.meter.remainingUsd) }} left
            </span>
          }
        </div>
        @if (!unlimited()) {
          <div class="bm-track" role="progressbar" [attr.aria-valuenow]="clampPct(d.meter.pct)" aria-valuemin="0" aria-valuemax="100" aria-label="AI budget used">
            <span class="bm-fill" [class]="'bm-fill--' + tone(d.meter)" [style.width.%]="clampPct(d.meter.pct)" data-testid="ai-budget-bar"></span>
          </div>
        }
        @if (!d.meter.allowed) {
          <p class="bm-blocked-msg" role="alert" data-testid="ai-budget-blocked">
            AI budget reached — new AI runs are paused until the period resets or you raise the cap.
          </p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .bm {
      padding: 0.9rem 1.1rem; border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.015);
    }
    .bm--blocked { border-color: color-mix(in oklch, #f87171 40%, transparent); background: color-mix(in oklch, #f87171 6%, transparent); }
    .bm-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.55rem; }
    .bm-lead { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .bm-eyebrow { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ps-accent, #00e5ff); }
    .bm-amount { font-size: 0.9rem; color: var(--ps-ink, #f4f4ff); font-variant-numeric: tabular-nums; }
    .bm-of, .bm-period { color: rgba(255,255,255,0.7); }
    .bm-remaining { font-size: 0.82rem; font-weight: 700; color: #34d399; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .bm-remaining--low { color: #f87171; }
    .bm-track { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
    .bm-fill { display: block; height: 100%; border-radius: 999px; transition: width 0.5s ease; }
    @media (prefers-reduced-motion: reduce) { .bm-fill { transition: none; } }
    .bm-fill--ok { background: #34d399; }
    .bm-fill--warn { background: #fbbf24; }
    .bm-fill--danger { background: #f87171; }
    .bm-blocked-msg { font-size: 0.72rem; color: #f87171; margin: 0.5rem 0 0; }
  `],
})
export class AiBudgetMeterComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly data = signal<OrgBudgetResponse | null>(null);

  /** Unlimited plans (or non-positive caps) have no meaningful bar. */
  readonly unlimited = computed(() => {
    const d = this.data();
    return !!d && (d.plan === 'unlimited' || d.meter.capUsd <= 0);
  });

  ngOnInit(): void {
    // `silent: true` — a 404 (flag off) is expected, never a user-facing toast.
    this.api.get<OrgBudgetResponse>('/usage/budget', undefined, { silent: true }).subscribe({
      next: (res) => this.data.set(res && res.meter ? res : null),
      error: () => this.data.set(null),
    });
  }

  /** Bar tone by fill / blocked state. */
  tone(m: BudgetMeter): 'ok' | 'warn' | 'danger' {
    if (!m.allowed || m.pct >= 100) return 'danger';
    if (m.pct >= 75) return 'warn';
    return 'ok';
  }

  lowOrOver(): boolean {
    const m = this.data()?.meter;
    return !!m && (!m.allowed || m.pct >= 90);
  }

  clampPct(pct: number): number {
    return Math.max(0, Math.min(100, pct));
  }

  /** Format a USD amount compactly ("$5.00", "$0.42"). */
  usd(v: number): string {
    return `$${(Math.round((v ?? 0) * 100) / 100).toFixed(2)}`;
  }
}
