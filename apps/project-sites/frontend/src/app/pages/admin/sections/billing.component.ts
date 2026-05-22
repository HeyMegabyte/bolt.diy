import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Bundle { credits: number; usd: number; price_id: string; }
interface CreditState { balance: number; bundles: Record<string, Bundle>; ledger: { delta: number; reason: string; stripe_session_id: string | null; created_at: string }[]; }
interface Alert { id: string; name: string; threshold_credits: number; alert_kind: string; notify_email: string; enabled: number; last_triggered_at: string | null; }
interface CostRow { site_id: string; slug: string; business_name: string | null; ai_calls: number; ai_credits: number; estimated_cost_micro_usd: number; bandwidth_bytes: number; storage_bytes: number; }

/** Cost forecast shape returned by `GET /api/admin/forecast/cost` (item #95). */
interface CostForecastState {
  current_month_estimate_usd: number;
  next_month_forecast_usd: number;
  by_category: { workers: number; ai: number; r2: number; d1: number; email: number };
  biggest_driver: string;
  savings_tip: string;
}

/** Renderable bar in the inline-SVG chart. */
interface ForecastBar {
  label: string;
  usd: number;
  height: number;
  color: string;
}

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [FormsModule, DatePipe, CurrencyPipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white m-0">Billing &amp; Plan</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
          AI Credits power form routing, chat, and your custom AI endpoints. Per-site cost breakdown + spend alerts below.
        </p>
      </div>

      <!-- ─────────────────── PLAN TIERS ─────────────────── -->
      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">Plan</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-0.5">Currently on <strong class="text-white">{{ planLabel() }}</strong>. Cancel any time.</p>
          </div>
          @if (plan() === 'free') {
            <button class="btn-primary" (click)="upgrade()" [disabled]="upgrading()">{{ upgrading() ? 'Opening checkout…' : 'Upgrade to Pro' }}</button>
          } @else {
            <button class="btn-ghost" (click)="manage()">Manage</button>
          }
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div class="card-light p-4" [class.tier-active]="plan() === 'free'">
            <div class="flex items-baseline justify-between">
              <div class="text-base font-bold text-white">Free</div>
              <div class="text-lg font-bold text-white">$0<span class="text-[0.7rem] text-text-secondary">/mo</span></div>
            </div>
            <ul class="list-none p-0 mt-3 space-y-1.5 text-[0.74rem] text-text-secondary">
              <li>· 1 project</li>
              <li>· 100 AI credits / month</li>
              <li>· 1 custom domain</li>
              <li>· Community support</li>
              <li>· projectsites.dev branding</li>
            </ul>
          </div>
          <div class="card-light p-4" [class.tier-active]="plan() === 'pro'">
            <div class="flex items-baseline justify-between">
              <div class="text-base font-bold text-white">Pro</div>
              <div class="text-lg font-bold text-white">$50<span class="text-[0.7rem] text-text-secondary">/mo</span></div>
            </div>
            <ul class="list-none p-0 mt-3 space-y-1.5 text-[0.74rem] text-text-secondary">
              <li>· Unlimited projects</li>
              <li>· 5,000 AI credits / month</li>
              <li>· Unlimited custom domains</li>
              <li>· Priority support · Audit log export</li>
              <li>· No projectsites.dev branding</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ─────────────────── PER-PROJECT CREDIT CAPS ─────────────────── -->
      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Per-project AI credit caps</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          Stop runaway spend on a single site. Cap takes effect on the 1st of every month. Empty = no cap.
        </p>
        @if (siteCosts().length === 0) {
          <div class="p-6 text-center text-text-secondary text-sm">No sites yet — create one to set caps.</div>
        } @else {
          <div class="space-y-2">
            @for (r of siteCosts(); track r.site_id) {
              <div class="flex items-center gap-3">
                <div class="flex-1 min-w-0">
                  <div class="text-[0.78rem] text-white truncate">{{ r.business_name || r.slug }}</div>
                  <div class="text-[0.66rem] text-text-secondary font-mono">{{ r.ai_credits }} credits used · 30d</div>
                </div>
                <input type="number" min="0" step="50" placeholder="no cap"
                       class="input-field w-28 text-right" [(ngModel)]="capDraft[r.site_id]" />
                <button class="btn-ghost" (click)="saveCap(r.site_id)" [disabled]="savingCap() === r.site_id">
                  {{ savingCap() === r.site_id ? '…' : 'Save' }}
                </button>
              </div>
            }
          </div>
        }
      </section>

      <!-- ─────────────────── 30-DAY COST FORECAST (#95) ─────────────────── -->
      <section class="card border border-violet-500/40" data-testid="forecast-card">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">30-day forecast</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-0.5">
              Projected Cloudflare spend based on the last 30 days of usage.
            </p>
          </div>
          @if (forecast(); as f) {
            <div class="text-right">
              <div class="text-2xl font-bold text-white">{{ f.next_month_forecast_usd | currency:'USD':'symbol':'1.2-2' }}</div>
              <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary">next 30 days</div>
            </div>
          }
        </div>

        @if (forecastLoading() && !forecast()) {
          <div class="p-6 text-center text-text-secondary text-sm">Computing forecast…</div>
        } @else if (forecast()) {
          @let f = forecast()!;
          <div class="grid sm:grid-cols-2 gap-4 mt-2">
            <!-- Bar chart (inline SVG, no chart lib) -->
            <svg viewBox="0 0 320 140" class="w-full h-32" role="img" aria-label="Cost by category">
              @for (b of forecastBars(); track b.label; let i = $index) {
                <g>
                  <rect
                    [attr.x]="i * 62 + 10"
                    [attr.y]="120 - b.height"
                    width="44"
                    [attr.height]="b.height"
                    rx="4"
                    [attr.fill]="b.color"
                    opacity="0.85" />
                  <text
                    [attr.x]="i * 62 + 32"
                    y="135"
                    text-anchor="middle"
                    fill="rgba(255,255,255,0.55)"
                    font-size="9"
                    font-family="ui-sans-serif, system-ui">{{ b.label }}</text>
                  <text
                    [attr.x]="i * 62 + 32"
                    [attr.y]="120 - b.height - 4"
                    text-anchor="middle"
                    fill="#fff"
                    font-size="9"
                    font-weight="700"
                    font-family="ui-sans-serif, system-ui">{{ b.usd | currency:'USD':'symbol':'1.0-2' }}</text>
                </g>
              }
            </svg>

            <div class="text-[0.78rem] space-y-2">
              <div class="flex items-baseline gap-2">
                <span class="text-text-secondary">Current month:</span>
                <strong class="text-white">{{ f.current_month_estimate_usd | currency:'USD':'symbol':'1.2-2' }}</strong>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-text-secondary">Biggest driver:</span>
                <strong class="text-violet-300">{{ f.biggest_driver }}</strong>
              </div>
              <div class="mt-3 p-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.06]">
                <div class="text-[0.6rem] uppercase tracking-wider text-violet-300 font-bold mb-1">✨ Savings tip</div>
                <div class="text-text-secondary text-[0.72rem] leading-relaxed">{{ f.savings_tip }}</div>
              </div>
            </div>
          </div>
        } @else {
          <div class="p-6 text-center text-text-secondary text-sm">Forecast unavailable.</div>
        }
      </section>

      <section class="card border border-primary/30">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">AI Credits</h3>
          <span class="text-[0.7rem] text-text-secondary">1 credit ≈ 1 AI call</span>
        </div>
        <div class="text-4xl font-bold text-white mb-1">{{ credits()?.balance ?? 0 }}</div>
        <div class="text-[0.78rem] text-text-secondary mb-4">credits remaining</div>

        <div class="grid sm:grid-cols-3 gap-3">
          @for (key of bundleKeys; track key) {
            <button class="card-light text-left p-4 cursor-pointer hover:border-primary/50 transition-colors block w-full" (click)="topup(key)" [disabled]="buying() === key">
              <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary/70 font-bold">{{ key }}</div>
              <div class="text-2xl font-bold text-white mt-1">{{ bundleCredits(key) }}</div>
              <div class="text-[0.78rem] text-text-secondary">credits · &dollar;{{ bundleUsd(key) }}</div>
              <div class="text-[0.66rem] text-primary mt-2">{{ buying() === key ? 'Opening checkout…' : 'Buy →' }}</div>
            </button>
          }
        </div>

        <!-- 14-day spend sparkline -->
        @if (spend14d().length > 0) {
          <div class="mt-4">
            <div class="flex items-center justify-between mb-2">
              <span class="muted-h">Spend · last 14 days</span>
              <span class="text-[0.7rem] text-text-secondary">{{ spend14dTotal() }} credits · projection {{ projectedMonth() }}/mo</span>
            </div>
            <svg viewBox="0 0 280 60" preserveAspectRatio="none" class="w-full h-12">
              <defs>
                <linearGradient id="spgrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#7C3AED" stop-opacity="0.45"/>
                  <stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path [attr.d]="sparkArea()" fill="url(#spgrad)" />
              <path [attr.d]="sparkLine()" fill="none" stroke="#7C3AED" stroke-width="2" />
            </svg>
          </div>
        }

        @if (credits()?.ledger?.length) {
          <details class="mt-4">
            <summary class="cursor-pointer text-[0.74rem] text-text-secondary">Recent activity</summary>
            <ul class="mt-2 space-y-1 text-[0.7rem] list-none p-0">
              @for (l of credits()!.ledger.slice(0, 20); track l.created_at) {
                <li class="flex items-center justify-between border-b border-white/[0.04] py-1">
                  <span class="text-text-secondary">{{ l.created_at | date:'short' }} · {{ l.reason }}</span>
                  <span [class.text-emerald-400]="l.delta > 0" [class.text-red-400]="l.delta < 0">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
                </li>
              }
            </ul>
          </details>
        }
      </section>

      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Per-site cost breakdown</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Rolling 30-day window. AI credits convert to estimated USD at $0.04/credit.</p>
        @if (siteCosts().length === 0) {
          <div class="p-6 text-center text-text-secondary text-sm">No usage in the last 30 days.</div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-2">Site</th>
                <th class="text-right p-2">AI calls</th>
                <th class="text-right p-2">Credits</th>
                <th class="text-right p-2">Bandwidth</th>
                <th class="text-right p-2">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              @for (r of siteCosts(); track r.site_id) {
                <tr class="border-b border-white/[0.04]">
                  <td class="p-2">
                    <div class="font-semibold text-white">{{ r.business_name || r.slug }}</div>
                    <div class="text-text-secondary text-[0.66rem] font-mono">{{ r.slug }}</div>
                  </td>
                  <td class="p-2 text-right">{{ r.ai_calls }}</td>
                  <td class="p-2 text-right">{{ r.ai_credits }}</td>
                  <td class="p-2 text-right text-text-secondary">{{ bytes(r.bandwidth_bytes) }}</td>
                  <td class="p-2 text-right font-mono">{{ (r.estimated_cost_micro_usd / 1000000) | currency:'USD' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">Spend alerts</h3>
          <button class="btn-primary" (click)="newAlert()">+ New alert</button>
        </div>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Get emailed when your balance drops below a threshold or daily burn spikes.</p>

        @if (creating()) {
          <div class="card-light p-3 mb-3">
            <div class="grid md:grid-cols-4 gap-2">
              <input class="input-field" placeholder="Alert name" [(ngModel)]="draft.name" />
              <select class="input-field" [(ngModel)]="draft.alert_kind">
                <option value="balance_low">Balance dropped below</option>
                <option value="daily_burn">Daily burn exceeded</option>
              </select>
              <input type="number" class="input-field" placeholder="threshold (credits)" [(ngModel)]="draft.threshold_credits" />
              <input type="email" class="input-field" placeholder="notify email" [(ngModel)]="draft.notify_email" />
            </div>
            <div class="flex justify-end gap-2 mt-2">
              <button class="btn-ghost" (click)="creating.set(false)">Cancel</button>
              <button class="btn-primary" (click)="saveAlert()">Create</button>
            </div>
          </div>
        }

        @if (alerts().length === 0 && !creating()) {
          <div class="p-6 text-center text-text-secondary text-sm">No alerts yet.</div>
        } @else {
          @for (a of alerts(); track a.id) {
            <div class="flex items-center justify-between py-2 border-b border-white/[0.04] text-[0.78rem]">
              <div>
                <div class="font-semibold text-white">{{ a.name }}</div>
                <div class="text-text-secondary text-[0.7rem]">{{ a.alert_kind === 'balance_low' ? 'When balance <' : 'When daily burn >' }} {{ a.threshold_credits }} credits → {{ a.notify_email }}</div>
              </div>
              <button class="text-red-400 text-[0.72rem]" (click)="removeAlert(a)">Remove</button>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .card-light { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .btn-primary { padding: 0.45rem 0.95rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .tier-active { border-color: rgba(0,229,255,0.55); background: rgba(0,229,255,0.06); box-shadow: 0 0 0 3px rgba(0,229,255,0.08); }
  `],
})
export class AdminBillingComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  credits = signal<CreditState | null>(null);

  /** 30-day forecast loaded from `/admin/forecast/cost` (#95). */
  forecast = signal<CostForecastState | null>(null);
  forecastLoading = signal(false);

  /**
   * Render-ready bars for the inline-SVG chart. Heights normalize to the
   * largest category and clamp at 92px so the chart always sits inside the
   * 140-tall viewBox. Colors carry brand semantics.
   */
  forecastBars = computed<ForecastBar[]>(() => {
    const f = this.forecast();
    if (!f) return [];
    const cats = f.by_category;
    const entries: ForecastBar[] = [
      { label: 'workers', usd: cats.workers, height: 0, color: '#00E5FF' },
      { label: 'ai',      usd: cats.ai,      height: 0, color: '#7C3AED' },
      { label: 'r2',      usd: cats.r2,      height: 0, color: '#50AAE3' },
      { label: 'd1',      usd: cats.d1,      height: 0, color: '#10b981' },
      { label: 'email',   usd: cats.email,   height: 0, color: '#f59e0b' },
    ];
    const peak = Math.max(0.01, ...entries.map((e) => e.usd));
    for (const e of entries) e.height = Math.max(4, Math.min(92, (e.usd / peak) * 92));
    return entries;
  });

  // 14-day spend roll-up from the credits ledger.
  spend14d = computed<{ day: string; spend: number }[]>(() => {
    const ledger = this.credits()?.ledger ?? [];
    const out: Record<string, number> = {};
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      out[d.toISOString().slice(0, 10)] = 0;
    }
    for (const e of ledger) {
      if (e.delta >= 0) continue;
      const day = e.created_at.slice(0, 10);
      if (day in out) out[day]! += -e.delta;
    }
    return Object.entries(out).map(([day, spend]) => ({ day, spend }));
  });
  spend14dTotal = computed(() => this.spend14d().reduce((a, r) => a + r.spend, 0));
  projectedMonth = computed(() => Math.round((this.spend14dTotal() / 14) * 30));
  sparkPoints = computed<{ x: number; y: number }[]>(() => {
    const days = this.spend14d();
    if (!days.length) return [];
    const peak = Math.max(1, ...days.map((d) => d.spend));
    const step = days.length > 1 ? 280 / (days.length - 1) : 0;
    return days.map((d, i) => ({ x: i * step, y: 55 - (d.spend / peak) * 50 }));
  });
  sparkLine = computed(() => this.sparkPoints().map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
  sparkArea = computed(() => {
    const pts = this.sparkPoints(); if (!pts.length) return '';
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `${line} L ${pts[pts.length - 1]!.x.toFixed(1)} 60 L ${pts[0]!.x.toFixed(1)} 60 Z`;
  });
  alerts = signal<Alert[]>([]);
  siteCosts = signal<CostRow[]>([]);
  buying = signal<string | null>(null);
  creating = signal(false);
  plan = signal<'free' | 'pro'>('free');
  upgrading = signal(false);
  savingCap = signal<string | null>(null);
  capDraft: Record<string, number | ''> = {};
  planLabel = computed(() => (this.plan() === 'pro' ? 'Pro · $50/mo' : 'Free'));
  draft: { name: string; alert_kind: string; threshold_credits: number; notify_email: string } = {
    name: '', alert_kind: 'balance_low', threshold_credits: 50, notify_email: '',
  };
  get bundleKeys(): string[] { return Object.keys(this.credits()?.bundles ?? {}); }
  bundleCredits(key: string): number {
    const v = this.credits()?.bundles?.[key]?.credits;
    return typeof v === 'number' ? v : Number(v) || 0;
  }
  bundleUsd(key: string): number {
    const v = this.credits()?.bundles?.[key]?.usd;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  ngOnInit(): void { this.loadAll(); }
  loadAll(): void {
    this.api.get<{ data: CreditState }>('/billing/credits').subscribe({ next: (r) => this.credits.set(r.data) });
    this.api.get<{ data: Alert[] }>('/billing/spend-alerts').subscribe({ next: (r) => this.alerts.set(r.data ?? []) });
    this.api.get<{ data: { rows: CostRow[] } }>('/billing/site-costs').subscribe({
      next: (r) => {
        const rows = r.data?.rows ?? [];
        this.siteCosts.set(rows);
        for (const row of rows) {
          this.api.get<{ data: { monthly_credit_cap: number | null } }>(`/sites/${row.site_id}/credit-cap`).subscribe({
            next: (cap) => { this.capDraft[row.site_id] = cap.data?.monthly_credit_cap ?? ''; },
          });
        }
      },
    });
    this.api.get<{ data: { subscription?: { status?: string } | null } }>('/billing/subscription').subscribe({
      next: (r) => this.plan.set(r.data?.subscription?.status === 'active' ? 'pro' : 'free'),
      error: () => this.plan.set('free'),
    });
    // 30-day forecast (#95). Loaded lazily so it doesn't block the page render.
    this.forecastLoading.set(true);
    this.api.get<{ data: CostForecastState }>('/admin/forecast/cost').subscribe({
      next: (r) => { this.forecast.set(r.data); this.forecastLoading.set(false); },
      error: () => { this.forecast.set(null); this.forecastLoading.set(false); },
    });
  }
  upgrade(): void {
    this.upgrading.set(true);
    this.api.post<{ data: { url?: string } }>('/billing/checkout', { plan: 'pro' }).subscribe({
      next: (r) => {
        this.upgrading.set(false);
        if (r.data?.url) window.location.href = r.data.url;
        else this.toast.info('Checkout opened');
      },
      error: () => { this.upgrading.set(false); this.toast.error('Could not start checkout'); },
    });
  }
  manage(): void {
    this.api.post<{ data: { url?: string } }>('/billing/portal', {}).subscribe({
      next: (r) => { if (r.data?.url) window.location.href = r.data.url; },
      error: () => this.toast.error('Could not open billing portal'),
    });
  }
  saveCap(siteId: string): void {
    this.savingCap.set(siteId);
    const raw = this.capDraft[siteId];
    const cap = raw === '' || raw == null ? null : Math.max(0, Number(raw));
    this.api.put(`/sites/${siteId}/credit-cap`, { monthly_credit_cap: cap }).subscribe({
      next: () => { this.savingCap.set(null); this.toast.success(cap == null ? 'Cap removed' : `Cap set to ${cap} credits/mo`); },
      error: () => { this.savingCap.set(null); this.toast.error('Save failed'); },
    });
  }
  topup(bundle: string): void {
    this.buying.set(bundle);
    this.api.post<{ data: { mode: string; url?: string; balance?: number } }>('/billing/credits/topup', { bundle }).subscribe({
      next: (r) => {
        this.buying.set(null);
        if (r.data?.mode === 'stripe' && r.data.url) window.location.href = r.data.url;
        else { this.toast.success(`Credits added — balance ${r.data?.balance}`); this.loadAll(); }
      },
      error: () => { this.buying.set(null); this.toast.error('Top-up failed'); },
    });
  }
  newAlert(): void { this.creating.set(true); }
  saveAlert(): void {
    this.api.post('/billing/spend-alerts', this.draft).subscribe({
      next: () => { this.toast.success('Alert created'); this.creating.set(false); this.draft = { name: '', alert_kind: 'balance_low', threshold_credits: 50, notify_email: '' }; this.loadAll(); },
      error: () => this.toast.error('Failed'),
    });
  }
  removeAlert(a: Alert): void {
    this.api.delete(`/billing/spend-alerts/${a.id}`).subscribe({ next: () => { this.toast.success('Removed'); this.loadAll(); } });
  }
  bytes(n: number): string { if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`; if (n < Math.pow(1024, 3)) return `${(n/Math.pow(1024,2)).toFixed(1)} MB`; return `${(n/Math.pow(1024,3)).toFixed(2)} GB`; }
}
