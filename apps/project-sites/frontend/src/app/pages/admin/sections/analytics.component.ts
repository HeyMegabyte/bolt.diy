import { Component, inject, signal, computed, type OnInit, type OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { timeout, catchError } from 'rxjs/operators';
import { of, TimeoutError } from 'rxjs';
import { AdminStateService } from '../admin-state.service';
import { ApiService, type AnalyticsData } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

type RangeId = '1d' | '7d' | '30d' | '90d';

/**
 * Map UI range chip → `period` query value (days) for `GET /api/analytics/:siteId`.
 */
const RANGE_DAYS: Record<RangeId, string> = { '1d': '1', '7d': '7', '30d': '30', '90d': '90' };

/**
 * Source pill label shown near the chart so operators know which fallback
 * path produced the numbers they're looking at.
 */
function sourceLabel(source: AnalyticsData['source']): string {
  if (source === 'ga4') return 'GA4';
  if (source === 'cloudflare_zone_analytics') return 'Cloudflare Edge';
  return 'Audit log estimate';
}

/**
 * Marketing copy for the source pill — explains the trade-offs of each
 * fallback path in plain language so non-engineers reading the dashboard
 * understand why bounce-rate is missing on CF and why everything is zero
 * on the audit-log fallback.
 */
function sourceTooltip(source: AnalyticsData['source']): string {
  if (source === 'ga4') return 'Google Analytics 4 — full session + behavior data.';
  if (source === 'cloudflare_zone_analytics') return 'Cloudflare edge analytics — page views, unique visitors, top pages, geo. No session-duration / bounce-rate at the edge.';
  return 'No analytics source configured — counts are estimated from the audit log. Wire GA4 or Cloudflare zone analytics for real numbers.';
}

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="section-h text-lg font-bold text-white m-0 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
            Analytics
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Traffic for <strong>{{ selectedHost() }}</strong> — pulled from
            <span class="source-pill" [title]="sourcePillTooltip()" [class.pill-ga4]="data()?.source === 'ga4'" [class.pill-cf]="data()?.source === 'cloudflare_zone_analytics'" [class.pill-estimate]="!data()?.source">
              {{ sourcePillLabel() }}
            </span>. Refreshes every 60 s.
          </p>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
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

      @if (!state.selectedSite()) {
        <div class="card bg-amber-500/[0.06] border border-amber-500/30 text-[0.78rem]">
          <strong class="text-amber-300">No site selected.</strong>
          Pick a site from the sidebar — analytics are scoped per-site.
        </div>
      } @else if (error()) {
        <div class="card bg-amber-500/[0.06] border border-amber-500/30 text-[0.78rem]">
          <strong class="text-amber-300">Analytics returned an error.</strong>
          {{ error() }}
        </div>
      } @else if (data() && !data()?.source && stats().pageViews === 0 && (data()?.chartData?.length ?? 0) === 0) {
        <div class="card bg-amber-500/[0.06] border border-amber-500/30 text-[0.78rem]">
          <strong class="text-amber-300">Cloudflare zone analytics not configured for this site.</strong>
          GA4 isn't connected either, so we're falling back to a D1 audit-log estimate (which is 0 today). Contact support to wire <code class="font-mono">CF_API_TOKEN</code> + <code class="font-mono">CF_ZONE_ID</code> on the production worker — or connect GA4 in Settings.
        </div>
      }

      <div class="grid gap-3" [class.grid-cols-4]="data()?.source === 'ga4'" [class.grid-cols-2]="data()?.source !== 'ga4'" [class.max-md:grid-cols-2]="true">
        <div class="card kpi">
          <div class="muted-h">Page views</div>
          <div class="text-3xl font-bold text-white mt-1">{{ stats().pageViews }}</div>
          <div class="text-[0.68rem] text-text-secondary mt-1">
            @if (data()?.source === 'cloudflare_zone_analytics' && stats().totalRequests != null) {
              of {{ stats().totalRequests }} requests
            } @else {
              In the selected period
            }
          </div>
        </div>
        <div class="card kpi">
          <div class="muted-h">Unique visitors</div>
          <div class="text-3xl font-bold text-white mt-1">{{ stats().uniqueVisitors }}</div>
          <div class="text-[0.68rem] text-text-secondary mt-1">Distinct IPs / users</div>
        </div>
        @if (data()?.source === 'ga4') {
          <div class="card kpi">
            <div class="muted-h">Avg session</div>
            <div class="text-3xl font-bold text-white mt-1">{{ stats().avgSessionDuration }}</div>
            <div class="text-[0.68rem] text-text-secondary mt-1">GA4 engaged session</div>
          </div>
          <div class="card kpi">
            <div class="muted-h">Bounce rate</div>
            <div class="text-3xl font-bold text-white mt-1">{{ stats().bounceRate }}%</div>
            <div class="text-[0.68rem] text-text-secondary mt-1">Single-page sessions</div>
          </div>
        }
      </div>

      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="section-h m-0 text-base font-semibold text-white">Page views over time</h3>
          <span class="text-[0.7rem] text-text-secondary">{{ data()?.chartData?.length || 0 }} days · peak {{ peakDayVisits() }}</span>
        </div>
        @if (loading() && !data()) {
          <div class="skeleton skeleton-chart" aria-hidden="true"></div>
        } @else if ((data()?.chartData?.length ?? 0) === 0) {
          <div class="empty-state" data-testid="analytics-empty">
            <svg class="empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>
            </svg>
            <h4 class="empty-title">No traffic yet — share your site</h4>
            <p class="empty-body">Once visitors arrive, page-view trend data will plot here in real time.</p>
            <button class="btn-gradient" type="button" (click)="copyShareLink()" title="Copy your live site URL">Copy share link</button>
          </div>
        } @else {
          <svg viewBox="0 0 600 120" preserveAspectRatio="none" class="w-full h-32 sparkline">
            <defs>
              <linearGradient id="visit-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="oklch(0.75 0.2 195 / 0.4)"/>
                <stop offset="100%" stop-color="oklch(0.75 0.2 195 / 0)"/>
              </linearGradient>
            </defs>
            <path [attr.d]="sparkArea()" fill="url(#visit-grad)" />
            <path [attr.d]="sparkLine()" fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
            @for (p of sparkDots(); track p.x) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" fill="#00E5FF"/>
            }
          </svg>
        }
      </section>

      <div class="grid md:grid-cols-2 gap-4">
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Top pages</h3>
          @if ((data()?.topPages?.length ?? 0) === 0) {
            <p class="text-text-secondary text-sm">No visits recorded yet.</p>
          } @else {
            @for (r of data()!.topPages; track r.path) {
              <div class="bar-row">
                <div class="flex justify-between mb-1">
                  <span class="font-mono text-[0.72rem] truncate">{{ r.path }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.views }}</span>
                </div>
                <div class="bar"><div class="bar-fill" [style.width.%]="barWidth(r.views, maxPage())"></div></div>
              </div>
            }
          }
        </section>

        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Top countries</h3>
          @if ((data()?.topCountries?.length ?? 0) === 0) {
            <p class="text-text-secondary text-sm">No geo data yet.</p>
          } @else {
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
              @for (r of data()!.topCountries ?? []; track r.country) {
                <div class="flex items-center justify-between border-b border-white/[0.04] py-1">
                  <span class="text-[0.78rem]">{{ flag(r.country) }} {{ r.country }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.views }}</span>
                </div>
              }
            </div>
          }
        </section>
      </div>

      @if (data()?.source === 'ga4' && (data()?.trafficSources?.length ?? 0) > 0) {
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-3">Traffic sources</h3>
          @for (r of data()!.trafficSources; track r.name) {
            <div class="bar-row">
              <div class="flex justify-between mb-1">
                <span class="text-[0.78rem]">{{ r.name }}</span>
                <span class="text-[0.7rem] text-text-secondary">{{ r.percent }}%</span>
              </div>
              <div class="bar"><div class="bar-fill" [style.width.%]="r.percent"></div></div>
            </div>
          }
        </section>
      }

      <p class="text-[0.65rem] text-text-secondary/70 text-center">
        Source: {{ sourcePillLabel() }} · {{ sourcePillTooltip() }} · last refreshed {{ refreshedAt() | date:'medium' }}
      </p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .kpi { padding: 1.1rem; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
    .btn-ghost { padding: 0.4rem 0.9rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
    .btn-gradient { padding: 0.5rem 1rem; border-radius: 10px; background: linear-gradient(135deg, #00ffc8, #00d4ff); color: #060610; font-size: 0.74rem; font-weight: 700; border: 0; cursor: pointer; box-shadow: 0 6px 18px -8px rgba(0, 212, 255, 0.55); transition: transform 140ms ease, box-shadow 140ms ease; }
    .btn-gradient:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px -8px rgba(0, 212, 255, 0.7); }
    .btn-gradient:disabled { opacity: 0.55; cursor: not-allowed; }
    /* Fixed-width Refresh button so the date strip never shifts when label flips between "Refresh" and "…". */
    .refresh-btn { min-width: 78px; text-align: center; }
    .refresh-btn:disabled { opacity: 0.5; cursor: progress; }
    .bar-row { margin-bottom: 0.55rem; }
    .bar { height: 6px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #00E5FF, #7C3AED); transition: width 250ms ease; }
    .range-chip-strip { display: inline-flex; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 2px; gap: 2px; }
    .range-chip { padding: 4px 10px; border-radius: 999px; background: transparent; border: 0; color: rgba(255,255,255,0.65); font-size: 0.7rem; font-weight: 600; cursor: pointer; }
    .range-chip.active { background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18)); color: #00E5FF; }
    .sparkline path { transition: d 320ms ease; }
    .source-pill { display: inline-flex; align-items: center; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; vertical-align: middle; cursor: help; }
    .pill-ga4 { background: rgba(16,185,129,0.14); color: #34d399; border: 1px solid rgba(16,185,129,0.32); }
    .pill-cf { background: rgba(247,127,0,0.14); color: #fb923c; border: 1px solid rgba(247,127,0,0.32); }
    .pill-estimate { background: rgba(255,255,255,0.06); color: color-mix(in oklch, currentColor 70%, #f4f4ff 30%); border: 1px solid rgba(255,255,255,0.14); }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2.4rem 1.2rem; gap: 0.6rem; }
    .empty-icon { color: rgba(0, 229, 255, 0.7); }
    .empty-title { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; font-size: 0.95rem; color: #fff; margin: 0.2rem 0 0; }
    .empty-body { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin: 0 0 0.4rem; max-width: 340px; }
    .skeleton { background: rgba(255,255,255,0.10); border-radius: 10px; animation: skel-pulse 1.4s ease-in-out infinite; }
    .skeleton-chart { height: 128px; width: 100%; }
    @keyframes skel-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .skeleton, .sparkline path, .btn-gradient { animation: none; transition: none; }
    }
  `],
})
export class AdminAnalyticsComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  /** Per-site analytics envelope from `GET /api/analytics/:siteId`. */
  data = signal<AnalyticsData | null>(null);
  error = signal<string | null>(null);
  loading = signal(false);
  refreshedAt = signal<Date | null>(null);
  private timer?: ReturnType<typeof setInterval>;
  private lastSiteId: string | null = null;

  /**
   * 10-second timeout for the analytics fetch. The shared
   * {@link ApiService} timeout is 30 s; we tighten it here per the
   * dashboard UX spec — analytics should never make the operator wait
   * for a hung fetch, since the page auto-refreshes every 60 s anyway.
   */
  private static readonly FETCH_TIMEOUT_MS = 10_000;

  ranges: ReadonlyArray<{ id: RangeId; label: string }> = [
    { id: '1d', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
  ];

  range = signal<RangeId>(((): RangeId => {
    try { return (localStorage.getItem('ps_analytics_range') as RangeId) || '30d'; } catch { return '30d'; }
  })());

  setRange(id: RangeId): void {
    this.range.set(id);
    try { localStorage.setItem('ps_analytics_range', id); } catch { /* */ }
    this.reload();
  }

  /** Hostname displayed in the header — primary hostname if set, else the platform slug. */
  selectedHost = computed<string>(() => {
    const site = this.state.selectedSite();
    if (!site) return '—';
    return site.primary_hostname || `${site.slug}.projectsites.dev`;
  });

  stats = computed(() => this.data()?.stats ?? {
    pageViews: 0, uniqueVisitors: 0, avgSessionDuration: '0s', bounceRate: 0,
  });

  sourcePillLabel = computed(() => sourceLabel(this.data()?.source));
  sourcePillTooltip = computed(() => sourceTooltip(this.data()?.source));

  exportCsv(): void {
    const d = this.data();
    if (!d) return;
    const lines: string[] = [];
    lines.push('section,key,value');
    lines.push(`summary,source,${d.source ?? 'audit_log_estimate'}`);
    lines.push(`summary,page_views,${d.stats.pageViews}`);
    lines.push(`summary,unique_visitors,${d.stats.uniqueVisitors}`);
    if (d.source === 'ga4') {
      lines.push(`summary,avg_session_duration,${d.stats.avgSessionDuration}`);
      lines.push(`summary,bounce_rate,${d.stats.bounceRate}`);
    }
    for (const r of d.chartData || []) lines.push(`by_day,${r.date},${r.views}`);
    for (const r of d.topPages || []) lines.push(`top_page,${csv(r.path)},${r.views}`);
    for (const r of d.topCountries || []) lines.push(`country,${r.country},${r.views}`);
    for (const r of d.trafficSources || []) lines.push(`traffic_source,${csv(r.name)},${r.percent}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projectsites-analytics-${this.range()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    function csv(s: string): string { return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  }

  /**
   * Copy the currently-selected site's public URL so the user can share it
   * and start generating traffic. Falls back gracefully when no site is
   * selected or the Clipboard API is unavailable.
   */
  async copyShareLink(): Promise<void> {
    const site = this.state.selectedSite();
    const slug = site?.slug;
    const url = slug ? `https://${slug}.projectsites.dev` : (typeof location !== 'undefined' ? location.origin : '');
    if (!url) {
      this.toast.error('Select a site first to copy its link');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Share link copied to clipboard');
    } catch {
      this.toast.error('Could not copy — copy this URL manually: ' + url);
    }
  }

  maxPage = computed(() => Math.max(1, ...(this.data()?.topPages ?? []).map((p) => p.views)));
  peakDayVisits = computed(() => Math.max(0, ...(this.data()?.chartData ?? []).map((d) => d.views)));

  sparkPoints = computed<{ x: number; y: number }[]>(() => {
    const days = this.data()?.chartData ?? [];
    if (days.length === 0) return [];
    const peak = Math.max(1, ...days.map((d) => d.views));
    const step = days.length > 1 ? 600 / (days.length - 1) : 0;
    return days.map((d, i) => ({ x: i * step, y: 110 - (d.views / peak) * 100 }));
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

  barWidth(visits: number, max: number): number { return max > 0 ? (visits / max) * 100 : 0; }
  flag(code: string): string {
    if (!code || code === '-' || code.length !== 2) return '🌐';
    const base = 'A'.charCodeAt(0);
    const A = 0x1f1e6;
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
  }

  ngOnInit(): void {
    this.reload();
    // Re-fetch every 60 s. The shared admin-state service ALSO polls analytics
    // every 60 s and writes into `state.analytics`, but we keep our own timer
    // so the range chips can change cadence without fighting global polling.
    this.timer = setInterval(() => this.reload(), 60_000);
  }
  ngOnDestroy(): void { if (this.timer) clearInterval(this.timer); }

  reload(): void {
    const site = this.state.selectedSite();
    if (!site) {
      this.data.set(null);
      this.error.set(null);
      this.loading.set(false);
      return;
    }
    // If the user switched sites, clear stale data so the previous site's
    // numbers don't flash in for a frame before the new fetch lands.
    if (this.lastSiteId !== site.id) {
      this.data.set(null);
      this.lastSiteId = site.id;
    }
    this.loading.set(true);
    const period = RANGE_DAYS[this.range()];
    this.api.getAnalytics(site.id, period).pipe(
      timeout(AdminAnalyticsComponent.FETCH_TIMEOUT_MS),
      catchError((err: unknown) => {
        const msg = err instanceof TimeoutError
          ? 'Analytics request timed out after 10 s — retry, or check the worker logs.'
          : 'Analytics endpoint returned an error.';
        this.error.set(msg);
        return of({ data: null as AnalyticsData | null });
      }),
    ).subscribe({
      next: (r) => {
        if (r.data) { this.data.set(r.data); this.error.set(null); }
        this.refreshedAt.set(new Date());
        this.loading.set(false);
      },
    });
  }
}
