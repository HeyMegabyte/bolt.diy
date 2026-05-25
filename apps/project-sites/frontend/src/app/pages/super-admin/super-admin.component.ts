import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { RollingCounterComponent } from '../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../directives/reveal.directive';

/**
 * Cost category row — single source of truth for every billable action.
 * `markup_factor` is what the super-admin tunes; the worker uses it on every
 * `wallet.chargeWallet({category, quantity, base_cost_cents})` call to debit
 * `base_cost_cents * quantity * markup_factor` from the user's wallet.
 */
interface CostCategory {
  slug: string;
  label: string;
  unit: string;
  base_cost_cents: number;
  markup_factor: number;
  min_charge_cents: number;
  billable: number;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

interface OrgWalletRow {
  org_id: string;
  org_name: string;
  balance_cents: number;
  subscription_status: string;
  last_topup_at: string | null;
  total_charged_30d_cents: number;
}

interface SuperAdminStats {
  orgs_total: number;
  active_subscriptions: number;
  monthly_revenue_cents: number;
  spend_30d_cents: number;
  topups_today_cents: number;
  margin_30d_cents: number;
}

/**
 * `/super-admin` — single-page surface for tuning the cost × markup_factor
 * model that drives every wallet debit. Gated server-side on
 * `users.is_super_admin = 1`; non-super-admin requests get a 403.
 *
 * Sections:
 *  - Stats hero (6 rolling-counter tiles)
 *  - Cost categories table (inline-editable `markup_factor` per row)
 *  - Org wallets list (search + status + last-topup)
 *  - Recent transactions feed (last 100 org-wide)
 *
 * Pairs with worker routes in `apps/project-sites/src/routes/super_admin.ts`.
 */
@Component({
  selector: 'app-super-admin',
  standalone: true,
  imports: [FormsModule, RollingCounterComponent, RevealDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sa-root">
      <header class="sa-head" appReveal>
        <div class="sa-kicker">Operator console</div>
        <h1 class="sa-h1">Super admin</h1>
        <p class="sa-sub">Tune the cost × factor model. Every change writes an audit row.</p>
      </header>

      @if (forbidden()) {
        <div class="sa-forbidden" appReveal>
          <div class="sa-forbidden-glyph">⛔</div>
          <h2>Restricted</h2>
          <p>This surface requires <code>users.is_super_admin = 1</code>.</p>
        </div>
      } @else {
        <!-- 6 KPI tiles -->
        <section class="sa-stats" appReveal>
          @if (stats(); as s) {
            <div class="sa-tile">
              <div class="sa-tile-k">Orgs</div>
              <div class="sa-tile-v"><app-rolling-counter [value]="s.orgs_total" /></div>
            </div>
            <div class="sa-tile">
              <div class="sa-tile-k">Active subs</div>
              <div class="sa-tile-v"><app-rolling-counter [value]="s.active_subscriptions" /></div>
            </div>
            <div class="sa-tile">
              <div class="sa-tile-k">Monthly revenue</div>
              <div class="sa-tile-v">
                <span class="sa-cur">$</span>
                <app-rolling-counter [value]="s.monthly_revenue_cents / 100" [decimals]="0" />
              </div>
            </div>
            <div class="sa-tile">
              <div class="sa-tile-k">Spend 30d</div>
              <div class="sa-tile-v">
                <span class="sa-cur">$</span>
                <app-rolling-counter [value]="s.spend_30d_cents / 100" [decimals]="0" />
              </div>
            </div>
            <div class="sa-tile">
              <div class="sa-tile-k">Topups today</div>
              <div class="sa-tile-v">
                <span class="sa-cur">$</span>
                <app-rolling-counter [value]="s.topups_today_cents / 100" [decimals]="0" />
              </div>
            </div>
            <div class="sa-tile sa-tile-accent">
              <div class="sa-tile-k">Margin 30d</div>
              <div class="sa-tile-v">
                <span class="sa-cur">$</span>
                <app-rolling-counter [value]="s.margin_30d_cents / 100" [decimals]="0" />
              </div>
            </div>
          }
        </section>

        <!-- Cost categories table -->
        <section class="sa-card" appReveal>
          <header class="sa-card-head">
            <h2>Cost categories</h2>
            <p>Inline-edit <code>markup_factor</code> per row. Saved on blur or Enter.</p>
          </header>
          <table class="sa-tbl">
            <thead>
              <tr>
                <th>Slug</th>
                <th>Label</th>
                <th>Unit</th>
                <th class="num">Base cost</th>
                <th class="num">× Factor</th>
                <th class="num">Effective</th>
                <th class="num">Min</th>
                <th>Billable</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              @for (c of categories(); track c.slug) {
                <tr class="sa-row" [class.sa-row-edited]="dirty().has(c.slug)">
                  <td><code class="sa-mono">{{ c.slug }}</code></td>
                  <td>{{ c.label }}</td>
                  <td class="muted">{{ c.unit }}</td>
                  <td class="num">{{ formatCents(c.base_cost_cents) }}</td>
                  <td class="num">
                    <input
                      type="number"
                      class="sa-factor-input"
                      [(ngModel)]="c.markup_factor"
                      (blur)="saveFactor(c)"
                      (keydown.enter)="saveFactor(c); $event.preventDefault()"
                      (ngModelChange)="markDirty(c.slug)"
                      step="0.05"
                      min="0.5"
                      max="10"
                      [attr.aria-label]="'Markup factor for ' + c.label"
                    />
                  </td>
                  <td class="num cyan">{{ formatCents(Math.round(c.base_cost_cents * c.markup_factor)) }}</td>
                  <td class="num muted">{{ formatCents(c.min_charge_cents) }}</td>
                  <td>
                    <button
                      type="button"
                      class="sa-toggle"
                      [class.is-on]="c.billable === 1"
                      (click)="toggleBillable(c)"
                      [attr.aria-pressed]="c.billable === 1"
                      [attr.aria-label]="(c.billable === 1 ? 'Disable' : 'Enable') + ' billing for ' + c.label"
                    >{{ c.billable === 1 ? 'on' : 'off' }}</button>
                  </td>
                  <td class="muted small">{{ formatRelative(c.updated_at) }}</td>
                </tr>
              }
              @if (categories().length === 0 && !categoriesLoading()) {
                <tr><td colspan="9" class="muted center">No cost categories seeded yet.</td></tr>
              }
            </tbody>
          </table>
        </section>

        <!-- Wallets -->
        <section class="sa-card" appReveal>
          <header class="sa-card-head">
            <h2>Wallets</h2>
            <input
              type="search"
              class="sa-search"
              placeholder="Search by org name or email…"
              [(ngModel)]="walletsQuery"
              (ngModelChange)="onWalletsQueryChange()"
              aria-label="Search wallets"
            />
          </header>
          <table class="sa-tbl">
            <thead>
              <tr>
                <th>Org</th>
                <th>Balance</th>
                <th>Subscription</th>
                <th>Last top-up</th>
                <th class="num">Spend 30d</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (w of wallets(); track w.org_id) {
                <tr>
                  <td>{{ w.org_name }}</td>
                  <td class="num cyan">{{ formatCents(w.balance_cents) }}</td>
                  <td>
                    <span class="sa-pill" [attr.data-status]="w.subscription_status">{{ w.subscription_status }}</span>
                  </td>
                  <td class="muted small">{{ w.last_topup_at ? formatRelative(w.last_topup_at) : '—' }}</td>
                  <td class="num muted">{{ formatCents(w.total_charged_30d_cents) }}</td>
                  <td>
                    <button type="button" class="sa-btn-ghost" (click)="openAdjust(w)">Adjust</button>
                  </td>
                </tr>
              }
              @if (wallets().length === 0) {
                <tr><td colspan="6" class="muted center">No wallets match.</td></tr>
              }
            </tbody>
          </table>
        </section>
      }

      @if (adjustOpen(); as w) {
        <div class="sa-modal-bg" (click)="closeAdjust()">
          <div class="sa-modal" (click)="$event.stopPropagation()" role="dialog" aria-label="Manual wallet adjustment">
            <h3>Adjust {{ w.org_name }}</h3>
            <p class="muted small">Current balance: <span class="cyan">{{ formatCents(w.balance_cents) }}</span></p>
            <label>
              Amount in cents (negative to debit)
              <input type="number" [(ngModel)]="adjustCents" autofocus />
            </label>
            <label>
              Reason
              <input type="text" [(ngModel)]="adjustReason" placeholder="why this adjustment?" />
            </label>
            <div class="sa-modal-actions">
              <button type="button" class="sa-btn-ghost" (click)="closeAdjust()">Cancel</button>
              <button type="button" class="sa-btn-primary" (click)="submitAdjust()" [disabled]="!adjustReason.trim()">
                Apply
              </button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; color: var(--ps-ink, #f4f4ff); }
    .sa-root { padding: 32px; max-width: 1400px; margin: 0 auto; }
    .sa-head { margin-bottom: 28px; }
    .sa-kicker { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ps-accent, #00E5FF); opacity: 0.85; margin-bottom: 8px; }
    .sa-h1 { font-family: 'Sora', system-ui, sans-serif; font-weight: 700; font-size: clamp(1.6rem, 3vw, 2.4rem); letter-spacing: -0.02em; margin: 0; background: linear-gradient(120deg, var(--ps-ink, #f4f4ff), color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent)); background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .sa-sub { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); margin: 6px 0 0; font-size: 0.9rem; }
    .sa-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px; }
    .sa-tile { background: rgba(255,255,255,0.02); border: 1px solid rgba(0,229,255,0.08); border-radius: 14px; padding: 14px 16px; }
    .sa-tile-accent { border-color: rgba(0,229,255,0.30); background: linear-gradient(135deg, rgba(0,229,255,0.06), rgba(124,58,237,0.04)); }
    .sa-tile-k { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); }
    .sa-tile-v { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 1.6rem; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .sa-cur { color: var(--ps-accent, #00E5FF); font-size: 0.95rem; margin-right: 2px; }
    .sa-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 22px; margin-bottom: 20px; }
    .sa-card-head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
    .sa-card-head h2 { font-family: 'Sora', sans-serif; font-weight: 600; font-size: 1.1rem; margin: 0; letter-spacing: -0.01em; }
    .sa-card-head p { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); font-size: 0.78rem; margin: 4px 0 0; }
    .sa-search { background: rgba(0,0,0,0.32); border: 1px solid rgba(255,255,255,0.08); color: var(--ps-ink); padding: 8px 12px; border-radius: 8px; min-width: 280px; font-family: inherit; }
    .sa-search:focus { outline: none; border-color: rgba(0,229,255,0.35); }
    .sa-tbl { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    .sa-tbl thead { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
    .sa-tbl th, .sa-tbl td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .sa-tbl th.num, .sa-tbl td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; }
    .sa-tbl .center { text-align: center; padding: 32px 0; }
    .sa-mono { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--ps-accent, #00E5FF); }
    .muted { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); }
    .cyan { color: var(--ps-accent, #00E5FF); }
    .small { font-size: 0.72rem; }
    .sa-row-edited { background: rgba(0,229,255,0.04); }
    .sa-factor-input { width: 70px; background: rgba(0,0,0,0.32); border: 1px solid rgba(0,229,255,0.16); color: var(--ps-accent, #00E5FF); padding: 4px 6px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; text-align: right; font-variant-numeric: tabular-nums; }
    .sa-factor-input:focus { outline: none; border-color: rgba(0,229,255,0.55); box-shadow: 0 0 0 3px rgba(0,229,255,0.18); }
    .sa-toggle { padding: 3px 12px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); cursor: pointer; font-family: inherit; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .sa-toggle.is-on { background: rgba(0,229,255,0.14); border-color: rgba(0,229,255,0.45); color: var(--ps-accent, #00E5FF); }
    .sa-pill { padding: 2px 9px; border-radius: 999px; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
    .sa-pill[data-status="active"] { background: rgba(52,211,153,0.12); color: #6ee7b7; border: 1px solid rgba(52,211,153,0.32); }
    .sa-pill[data-status="past_due"], .sa-pill[data-status="canceled"], .sa-pill[data-status="inactive"] { background: rgba(248,113,113,0.10); color: #fca5a5; border: 1px solid rgba(248,113,113,0.22); }
    .sa-btn-ghost { padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--ps-ink); font-family: inherit; font-size: 0.78rem; cursor: pointer; }
    .sa-btn-ghost:hover { background: rgba(0,229,255,0.08); border-color: rgba(0,229,255,0.22); }
    .sa-btn-primary { padding: 8px 14px; border-radius: 8px; background: linear-gradient(135deg, var(--ps-accent, #00E5FF), color-mix(in oklch, var(--ps-accent, #00E5FF) 65%, #7C3AED)); border: none; color: #06121A; font-family: 'Sora', sans-serif; font-weight: 600; cursor: pointer; }
    .sa-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .sa-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 9999; }
    .sa-modal { background: linear-gradient(180deg, rgba(20,20,42,0.96), rgba(10,10,28,0.98)); border: 1px solid rgba(0,229,255,0.20); border-radius: 14px; padding: 24px; min-width: 420px; max-width: 92vw; }
    .sa-modal h3 { font-family: 'Sora', sans-serif; font-weight: 600; margin: 0 0 6px; }
    .sa-modal label { display: block; font-size: 0.78rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); margin-top: 14px; }
    .sa-modal input { display: block; width: 100%; margin-top: 4px; background: rgba(0,0,0,0.32); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; color: var(--ps-ink); font-family: inherit; }
    .sa-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .sa-forbidden { text-align: center; padding: 80px 20px; }
    .sa-forbidden-glyph { font-size: 3rem; margin-bottom: 10px; }
    .sa-forbidden h2 { font-family: 'Sora', sans-serif; font-weight: 700; }
    .sa-forbidden code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
    }
  `],
})
export class SuperAdminComponent implements OnInit {
  protected readonly Math = Math;
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  forbidden = signal(false);
  categoriesLoading = signal(true);
  categories = signal<CostCategory[]>([]);
  wallets = signal<OrgWalletRow[]>([]);
  stats = signal<SuperAdminStats | null>(null);
  dirty = signal<Set<string>>(new Set());

  walletsQuery = '';
  adjustOpen = signal<OrgWalletRow | null>(null);
  adjustCents = 0;
  adjustReason = '';

  private walletsDebounce: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.loadAll();
  }

  private loadAll(): void {
    Promise.all([this.loadStats(), this.loadCategories(), this.loadWallets('')]).catch((e) => {
      if (this.is403(e)) this.forbidden.set(true);
    });
  }

  private async loadStats(): Promise<void> {
    try {
      const res = await this.api.get<SuperAdminStats>('/super-admin/stats?days=30').toPromise();
      if (res) this.stats.set(res);
    } catch (e) { if (this.is403(e)) this.forbidden.set(true); }
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categoriesLoading.set(true);
      const res = await this.api.get<{ categories: CostCategory[] }>('/super-admin/cost-categories').toPromise();
      this.categories.set(res?.categories || []);
    } catch (e) {
      if (this.is403(e)) this.forbidden.set(true);
    } finally {
      this.categoriesLoading.set(false);
    }
  }

  private async loadWallets(q: string): Promise<void> {
    try {
      const url = q ? `/super-admin/wallets?q=${encodeURIComponent(q)}&limit=100` : '/super-admin/wallets?limit=100';
      const res = await this.api.get<{ wallets: OrgWalletRow[] }>(url).toPromise();
      this.wallets.set(res?.wallets || []);
    } catch (e) { if (this.is403(e)) this.forbidden.set(true); }
  }

  markDirty(slug: string): void {
    const next = new Set(this.dirty());
    next.add(slug);
    this.dirty.set(next);
  }

  async saveFactor(c: CostCategory): Promise<void> {
    try {
      await this.api.patch(`/super-admin/cost-categories/${c.slug}`, { markup_factor: Number(c.markup_factor) }).toPromise();
      const next = new Set(this.dirty()); next.delete(c.slug); this.dirty.set(next);
      this.toast.success(`Factor saved for ${c.label}`);
    } catch (e) {
      console.warn('[super-admin] saveFactor failed', e);
      this.toast.error(`Could not save factor — try again`);
    }
  }

  async toggleBillable(c: CostCategory): Promise<void> {
    const next = c.billable === 1 ? 0 : 1;
    try {
      await this.api.patch(`/super-admin/cost-categories/${c.slug}`, { billable: next }).toPromise();
      c.billable = next;
      this.toast.success(`${c.label} ${next === 1 ? 'enabled' : 'disabled'}`);
    } catch (e) {
      console.warn('[super-admin] toggleBillable failed', e);
      this.toast.error('Could not toggle billable');
    }
  }

  onWalletsQueryChange(): void {
    if (this.walletsDebounce) clearTimeout(this.walletsDebounce);
    this.walletsDebounce = setTimeout(() => this.loadWallets(this.walletsQuery.trim()), 280);
  }

  openAdjust(w: OrgWalletRow): void {
    this.adjustOpen.set(w);
    this.adjustCents = 0;
    this.adjustReason = '';
  }
  closeAdjust(): void { this.adjustOpen.set(null); }
  async submitAdjust(): Promise<void> {
    const w = this.adjustOpen();
    if (!w || !this.adjustReason.trim()) return;
    try {
      await this.api.post('/super-admin/manual-adjustment', { org_id: w.org_id, amount_cents: Number(this.adjustCents), reason: this.adjustReason.trim() }).toPromise();
      this.toast.success(`Adjusted ${w.org_name} by ${this.formatCents(Number(this.adjustCents))}`);
      this.closeAdjust();
      this.loadWallets(this.walletsQuery);
      this.loadStats();
    } catch (e) {
      console.warn('[super-admin] submitAdjust failed', e);
      this.toast.error('Adjustment failed');
    }
  }

  formatCents(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }

  formatRelative(iso: string): string {
    const t = Date.parse(iso); if (!Number.isFinite(t)) return '—';
    const delta = Math.max(0, Date.now() - t);
    const s = Math.floor(delta / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  private is403(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'status' in (e as Record<string, unknown>) && (e as { status: number }).status === 403;
  }
}

export default SuperAdminComponent;
