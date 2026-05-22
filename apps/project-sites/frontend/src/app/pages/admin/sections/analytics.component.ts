import { Component, inject, signal, computed, type OnInit, type OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';

interface Overview {
  total_visits: number;
  last_hour_visits: number;
  visits_by_day: { day: string; visits: number }[];
  top_routes: { route_path: string; visits: number }[];
  ua_breakdown: { user_agent_class: string; visits: number }[];
  top_referrers: { referrer: string; visits: number }[];
  top_countries: { country: string; visits: number }[];
}

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
            Analytics
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Live data from <strong>Cloudflare Workers Analytics Engine</strong> — every admin visit gets one data point. Refreshes every 30 s.
          </p>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          @if ((data()?.last_hour_visits ?? 0) > 0) {
            <span class="pulse-dot" aria-label="Live"></span>
            <span class="text-[0.72rem] text-emerald-400">{{ data()?.last_hour_visits }} in the last hour</span>
          } @else {
            <span class="text-[0.72rem] text-text-secondary">Quiet — no visits in the last hour</span>
          }
          <!-- Refresh sits LEFT of the date range so the loading state doesn't shift the strip horizontally. Fixed-width wrapper keeps everything stable. -->
          <button class="btn-ghost refresh-btn" (click)="reload()" [disabled]="loading()" title="Refresh data">{{ loading() ? '…' : 'Refresh' }}</button>
          <div class="range-chip-strip">
            @for (r of ranges; track r.id) {
              <button class="range-chip" [class.active]="range() === r.id" (click)="setRange(r.id)">{{ r.label }}</button>
            }
          </div>
          <button class="btn-ghost" (click)="exportCsv()" [disabled]="!data()" title="Download visible data as CSV">Export CSV</button>
        </div>
      </header>

      @if (cfStatus(); as cfs) {
        <div class="card flex items-center justify-between gap-3 text-[0.74rem]" [style.border-color]="cfs.analytics_configured ? 'rgba(16,185,129,0.32)' : 'rgba(245,158,11,0.32)'" [style.background]="cfs.analytics_configured ? 'rgba(16,185,129,0.04)' : 'rgba(245,158,11,0.06)'">
          <div class="flex items-center gap-2">
            <span class="font-semibold" [style.color]="cfs.analytics_configured ? '#34d399' : '#fcd34d'">
              {{ cfs.analytics_configured ? 'Cloudflare Analytics · Configured' : 'Cloudflare Analytics · Setup needed' }}
            </span>
            @if (cfs.account_id_masked) {
              <span class="text-text-secondary">· account {{ cfs.account_id_masked }} · {{ cfs.auth_mode === 'scoped_token' ? 'scoped token' : 'global key' }}</span>
            }
          </div>
          @if (!cfs.analytics_configured) {
            <button class="btn-primary" (click)="autoSetup()" [disabled]="settingUp()" title="Run Cloudflare auto-config now">{{ settingUp() ? 'Configuring…' : 'Auto-configure now' }}</button>
          }
        </div>
      }
      @if (error() && !cfStatus()?.analytics_configured) {
        <div class="card bg-amber-500/[0.06] border border-amber-500/30 text-[0.78rem]">
          <strong class="text-amber-300">Analytics returned an error.</strong>
          {{ error() }} — visits are still being recorded; once the worker has <code class="font-mono">CF_API_TOKEN</code> + the Analytics Engine SQL permission, this page will populate.
        </div>
      }

      <div class="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <div class="card kpi">
          <div class="muted-h">Total visits (30d)</div>
          <div class="text-3xl font-bold text-white mt-1">{{ data()?.total_visits ?? 0 }}</div>
          <div class="text-[0.68rem] text-text-secondary mt-1">Across all admin pages for your org</div>
        </div>
        <div class="card kpi">
          <div class="muted-h">Last hour</div>
          <div class="text-3xl font-bold text-white mt-1">{{ data()?.last_hour_visits ?? 0 }}</div>
          <div class="text-[0.68rem] text-text-secondary mt-1">Rolling 60-minute window</div>
        </div>
        <div class="card kpi">
          <div class="muted-h">Top page</div>
          <div class="text-base font-mono text-primary mt-2 truncate" [title]="data()?.top_routes?.[0]?.route_path">{{ data()?.top_routes?.[0]?.route_path || '—' }}</div>
          <div class="text-[0.68rem] text-text-secondary mt-1">{{ data()?.top_routes?.[0]?.visits || 0 }} visits</div>
        </div>
        <div class="card kpi">
          <div class="muted-h">Top country</div>
          <div class="text-2xl font-bold text-white mt-2">{{ topCountry() || '—' }}</div>
          <div class="text-[0.68rem] text-text-secondary mt-1">{{ topCountryVisits() }} visits</div>
        </div>
      </div>

      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">Daily visits</h3>
          <span class="text-[0.7rem] text-text-secondary">{{ data()?.visits_by_day?.length || 0 }} days · peak {{ peakDayVisits() }}</span>
        </div>
        @if ((data()?.visits_by_day?.length ?? 0) === 0) {
          <p class="text-center text-text-secondary text-sm py-8">No data yet. Visit a few admin pages and refresh.</p>
        } @else {
          <svg viewBox="0 0 600 120" preserveAspectRatio="none" class="w-full h-32">
            <defs>
              <linearGradient id="visit-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#00E5FF" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#00E5FF" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path [attr.d]="sparkArea()" fill="url(#visit-grad)" />
            <path [attr.d]="sparkLine()" fill="none" stroke="#00E5FF" stroke-width="2"/>
            @for (p of sparkDots(); track p.x) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" fill="#00E5FF"/>
            }
          </svg>
        }
      </section>

      <div class="grid md:grid-cols-2 gap-4">
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Top pages</h3>
          @if ((data()?.top_routes?.length ?? 0) === 0) {
            <p class="text-text-secondary text-sm">No visits recorded yet.</p>
          } @else {
            @for (r of data()!.top_routes; track r.route_path) {
              <div class="bar-row">
                <div class="flex justify-between mb-1">
                  <span class="font-mono text-[0.72rem] truncate">{{ r.route_path }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.visits }}</span>
                </div>
                <div class="bar"><div class="bar-fill" [style.width.%]="barWidth(r.visits, maxRoute())"></div></div>
              </div>
            }
          }
        </section>

        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Devices</h3>
          @if ((data()?.ua_breakdown?.length ?? 0) === 0) {
            <p class="text-text-secondary text-sm">No data.</p>
          } @else {
            @for (r of data()!.ua_breakdown; track r.user_agent_class) {
              <div class="bar-row">
                <div class="flex justify-between mb-1">
                  <span class="capitalize text-[0.78rem]">{{ r.user_agent_class }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.visits }} · {{ pct(r.visits) }}%</span>
                </div>
                <div class="bar"><div class="bar-fill" [style.width.%]="pct(r.visits)"></div></div>
              </div>
            }
          }
        </section>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Top referrers</h3>
          @if ((data()?.top_referrers?.length ?? 0) === 0) {
            <p class="text-text-secondary text-sm">No external referrers yet.</p>
          } @else {
            <table class="w-full text-[0.78rem]">
              <tbody>
                @for (r of data()!.top_referrers; track r.referrer) {
                  <tr class="border-b border-white/[0.04]">
                    <td class="p-1.5 font-mono text-[0.72rem]">{{ r.referrer === '-' ? 'direct / none' : r.referrer }}</td>
                    <td class="p-1.5 text-right text-text-secondary">{{ r.visits }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Top countries</h3>
          @if ((data()?.top_countries?.length ?? 0) === 0) {
            <p class="text-text-secondary text-sm">No geo data yet.</p>
          } @else {
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
              @for (r of data()!.top_countries; track r.country) {
                <div class="flex items-center justify-between border-b border-white/[0.04] py-1">
                  <span class="text-[0.78rem]">{{ flag(r.country) }} {{ r.country }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.visits }}</span>
                </div>
              }
            </div>
          }
        </section>
      </div>

      <p class="text-[0.65rem] text-text-secondary/70 text-center">
        Data point per visit · Workers Analytics Engine dataset <code class="font-mono">projectsites_admin_v1</code> · last refreshed {{ refreshedAt() | date:'medium' }}
      </p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .kpi { padding: 1.1rem; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
    .btn-ghost { padding: 0.4rem 0.9rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
    /* Fixed-width Refresh button so the date strip never shifts when label flips between "Refresh" and "…". */
    .refresh-btn { min-width: 78px; text-align: center; }
    .refresh-btn:disabled { opacity: 0.5; cursor: progress; }
    .pulse-dot { width: 9px; height: 9px; border-radius: 50%; background: #10b981; box-shadow: 0 0 0 0 rgba(16,185,129,0.7); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.7); } 70% { box-shadow: 0 0 0 8px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
    .bar-row { margin-bottom: 0.55rem; }
    .bar { height: 6px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #00E5FF, #7C3AED); transition: width 250ms ease; }
    .range-chip-strip { display: inline-flex; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 2px; gap: 2px; }
    .range-chip { padding: 4px 10px; border-radius: 999px; background: transparent; border: 0; color: rgba(255,255,255,0.65); font-size: 0.7rem; font-weight: 600; cursor: pointer; }
    .range-chip.active { background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18)); color: #00E5FF; }
  `],
})
export class AdminAnalyticsComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);

  data = signal<Overview | null>(null);
  error = signal<string | null>(null);
  loading = signal(false);
  refreshedAt = signal<Date | null>(null);
  cfStatus = signal<{
    account_id_masked: string | null;
    wfp_namespace_name: string | null;
    analytics_configured: boolean;
    wfp_configured: boolean;
    auth_mode: 'scoped_token' | 'global_key' | 'none';
    dispatch_binding_present: boolean;
  } | null>(null);
  settingUp = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  ranges = [
    { id: '1d', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
  ] as const;
  range = signal<'1d' | '7d' | '30d' | '90d'>(((): '1d' | '7d' | '30d' | '90d' => {
    try { return (localStorage.getItem('ps_analytics_range') as '1d' | '7d' | '30d' | '90d') || '30d'; } catch { return '30d'; }
  })());

  setRange(id: '1d' | '7d' | '30d' | '90d'): void {
    this.range.set(id);
    try { localStorage.setItem('ps_analytics_range', id); } catch { /* */ }
    this.reload();
  }

  exportCsv(): void {
    const d = this.data();
    if (!d) return;
    const lines: string[] = [];
    lines.push('section,key,value');
    lines.push(`summary,total_visits,${d.total_visits}`);
    lines.push(`summary,last_hour_visits,${d.last_hour_visits}`);
    for (const r of d.visits_by_day || []) lines.push(`by_day,${r.day},${r.visits}`);
    for (const r of d.top_routes || []) lines.push(`top_route,${csv(r.route_path)},${r.visits}`);
    for (const r of d.ua_breakdown || []) lines.push(`ua,${r.user_agent_class},${r.visits}`);
    for (const r of d.top_referrers || []) lines.push(`referrer,${csv(r.referrer)},${r.visits}`);
    for (const r of d.top_countries || []) lines.push(`country,${r.country},${r.visits}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projectsites-analytics-${this.range()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    function csv(s: string): string { return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  }

  topCountry = computed(() => this.data()?.top_countries?.[0]?.country ?? null);
  topCountryVisits = computed(() => this.data()?.top_countries?.[0]?.visits ?? 0);
  maxRoute = computed(() => Math.max(1, ...(this.data()?.top_routes ?? []).map((r) => r.visits)));
  peakDayVisits = computed(() => Math.max(0, ...(this.data()?.visits_by_day ?? []).map((d) => d.visits)));

  sparkPoints = computed<{ x: number; y: number }[]>(() => {
    const days = this.data()?.visits_by_day ?? [];
    if (days.length === 0) return [];
    const peak = Math.max(1, ...days.map((d) => d.visits));
    const step = days.length > 1 ? 600 / (days.length - 1) : 0;
    return days.map((d, i) => ({ x: i * step, y: 110 - (d.visits / peak) * 100 }));
  });
  sparkLine = computed(() => {
    const pts = this.sparkPoints();
    if (!pts.length) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  });
  sparkArea = computed(() => {
    const pts = this.sparkPoints();
    if (!pts.length) return '';
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1]!;
    const first = pts[0]!;
    return `${line} L ${last.x.toFixed(1)} 120 L ${first.x.toFixed(1)} 120 Z`;
  });
  sparkDots = computed(() => this.sparkPoints());

  totalVisits(): number { return this.data()?.total_visits ?? 0; }
  pct(visits: number): number { const t = this.totalVisits(); return t > 0 ? Math.round((visits / t) * 100) : 0; }
  barWidth(visits: number, max: number): number { return max > 0 ? (visits / max) * 100 : 0; }
  flag(code: string): string {
    if (!code || code === '-' || code.length !== 2) return '🌐';
    const base = 'A'.charCodeAt(0);
    const A = 0x1f1e6;
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
  }

  ngOnInit(): void {
    this.reload();
    this.loadCfStatus();
    this.timer = setInterval(() => this.reload(), 30000);
  }
  ngOnDestroy(): void { if (this.timer) clearInterval(this.timer); }
  loadCfStatus(): void {
    type CfStatus = NonNullable<ReturnType<typeof this.cfStatus>>;
    this.api.get<{ data: CfStatus }>('/admin/cloudflare/status').subscribe({
      next: (r) => this.cfStatus.set(r.data),
      error: () => this.cfStatus.set(null),
    });
  }
  autoSetup(): void {
    this.settingUp.set(true);
    this.api.post<{ data: { account_id_masked: string; wfp_namespace_name: string; note: string } }>('/admin/cloudflare/auto-setup', {}).subscribe({
      next: (r) => {
        this.settingUp.set(false);
        this.loadCfStatus();
        this.reload();
        // eslint-disable-next-line no-console
        console.warn('cloudflare auto-setup:', r.data?.note);
      },
      error: () => { this.settingUp.set(false); this.error.set('Auto-setup failed — check worker creds.'); },
    });
  }

  reload(): void {
    this.loading.set(true);
    this.api.get<{ data: Overview | null; error?: { message: string } }>('/analytics/overview', { range: this.range() }).subscribe({
      next: (r) => {
        if (r.data) { this.data.set(r.data); this.error.set(null); }
        else if (r.error?.message) this.error.set(r.error.message);
        this.refreshedAt.set(new Date());
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Analytics endpoint returned an error');
        this.loading.set(false);
      },
    });
  }
}
