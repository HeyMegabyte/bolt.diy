import { Component, inject, signal, computed, effect, type OnInit, type OnDestroy } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { timeout, catchError } from 'rxjs/operators';
import { forkJoin, of, TimeoutError } from 'rxjs';
import { AdminStateService } from '../admin-state.service';
import { HlmTablistDirective } from '../../../ui';
import {
  ApiService,
  type AnalyticsRange,
  type CloudflareCredentialStatus,
  type MultiUrlAnalyticsEnvelope,
  type SiteUrlRow,
} from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { PromptService } from '../../../services/prompt.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { MiniEmptyComponent } from '../../../components/mini-empty/mini-empty.component';
import { RevealDirective } from '../../../directives/reveal.directive';

type RangeId = AnalyticsRange;

/** Auto-refresh cadence in seconds — surfaced in the header countdown. */
const REFRESH_INTERVAL_SEC = 60;

/**
 * Format a count compactly: 999 → "999", 1_240 → "1.2K", 1_400_000 → "1.4M".
 * Falls back to `toLocaleString` for fractional and < 1000 values so commas
 * still surface correctly.
 */
function formatCount(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '0';
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}M`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
}

/**
 * Build a 0..maxX × 0..maxY normalized SVG path from an array of numeric samples.
 */
function sparklinePath(values: number[], width: number, height: number, peak?: number): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const max = Math.max(1, peak ?? Math.max(...values));
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: i * step, y: height - (v / max) * (height - 2) - 1 }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const area = `${line} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`;
  return { line, area };
}

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [RevealDirective, DatePipe, DecimalPipe, RollingCounterComponent, MiniEmptyComponent, HlmTablistDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- ─────────────────── HEADER ─────────────────── -->
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="kicker">Live</div>
          <h2 class="section-h text-lg font-bold text-white m-0 mt-1 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="text-accent"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
            Analytics
            <span class="status-pill" [attr.data-health]="dataHealth()" [title]="dataTooltip()">
              <span class="status-dot" aria-hidden="true"></span>
              {{ dataLabel() }}
            </span>
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1 max-w-prose leading-relaxed">
            Traffic for
            <a class="host-link"
               [href]="liveUrl()"
               target="_blank"
               rel="noopener noreferrer"
               [attr.aria-label]="'Open ' + selectedHost() + ' in a new tab'"
               [title]="'Open ' + selectedHost() + ' in a new tab'">
              <strong class="text-white">{{ selectedHost() }}</strong>
              <svg class="ext-glyph" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M7 17 17 7"/><path d="M8 7h9v9"/>
              </svg>
            </a>
            — refreshes every {{ refreshIntervalSec }}s.
            <span class="countdown" aria-live="polite" [title]="refreshedAt() ? 'Last refreshed ' + (refreshedAt() | date:'medium') : 'Not yet loaded'">
              @if (loading()) {
                <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
                <span>Refreshing now</span>
              } @else {
                Refreshing in {{ secondsUntilRefresh() }}s
              }
            </span>
          </p>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <button class="btn-ghost refresh-btn"
                  type="button"
                  (click)="reload()"
                  [disabled]="loading()"
                  aria-label="Refresh analytics"
                  title="Refresh data now">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [class.spinning]="loading()"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>{{ loading() ? 'Refreshing' : 'Refresh' }}</span>
          </button>
          <div class="range-chip-strip" role="tablist" hlmTablist aria-label="Date range">
            @for (r of ranges; track r.id) {
              <button class="range-chip"
                      type="button"
                      role="tab"
                      [class.active]="range() === r.id"
                      [attr.aria-selected]="range() === r.id"
                      [attr.aria-label]="'View ' + r.label"
                      (click)="setRange(r.id)">{{ r.label }}</button>
            }
          </div>
          <button class="btn-ghost"
                  type="button"
                  (click)="exportCsv()"
                  [disabled]="!envelope()"
                  aria-label="Download visible data as CSV"
                  title="Download visible data as CSV">Export CSV</button>
        </div>
      </header>

      <!-- ─────────────────── URLs PILLS ─────────────────── -->
      @if (urls().length > 0) {
        <div class="urls-row" role="group" aria-label="URLs aggregated in this view">
          <span class="urls-label">Aggregating</span>
          @for (u of urls(); track u.id) {
            <span class="url-pill"
                  [class.is-excluded]="excluded().has(u.hostname)"
                  [class.is-unresolved]="!isResolved(u.hostname)"
                  [title]="urlTooltip(u)">
              @if (u.is_primary) {
                <span class="primary-dot" aria-hidden="true"></span>
              }
              <span class="url-text">{{ u.hostname }}</span>
              @if (!u.is_primary) {
                <button class="url-toggle"
                        type="button"
                        (click)="toggleExclude(u.hostname)"
                        [attr.aria-label]="excluded().has(u.hostname) ? 'Include ' + u.hostname : 'Exclude ' + u.hostname"
                        [title]="excluded().has(u.hostname) ? 'Include this URL' : 'Exclude this URL from the aggregate'">
                  @if (excluded().has(u.hostname)) { + } @else { × }
                </button>
              }
            </span>
          }
          <button class="btn-tiny-ghost"
                  type="button"
                  (click)="promptAddUrl()"
                  aria-label="Bind an additional URL"
                  title="Add an alternate URL to aggregate alongside the primary">+ Add URL</button>
        </div>
      }

      <!-- ─────────────────── CF CREDENTIALS CTA ─────────────────── -->
      @if (envelope() && !envelope()!.any_real_data && credStatus() && credStatus()!.source === 'none') {
        <div class="card notice notice-amber" role="status">
          <div class="flex-1">
            <strong>Connect Cloudflare to see real traffic data.</strong>
            <span class="block text-[0.74rem] mt-0.5">
              Add your Cloudflare global API key once. We aggregate traffic across every URL bound to this site —
              <code class="font-mono">{{ urls().length }}</code> URL{{ urls().length === 1 ? '' : 's' }} ready when you are.
            </span>
          </div>
          <button class="btn-primary"
                  type="button"
                  (click)="openCredentialSettings()"
                  aria-label="Connect Cloudflare credentials">Connect Cloudflare</button>
        </div>
      }

      <!-- ─────────────────── ERROR / STATE BANNERS ─────────────────── -->
      @if (!state.selectedSite()) {
        <div class="card notice notice-amber" role="status">
          <div>
            <strong>No site selected.</strong>
            <span class="block text-[0.74rem] mt-0.5">Pick a site from the sidebar — analytics are scoped per-site.</span>
          </div>
        </div>
      } @else if (error()) {
        <div class="card notice notice-red" role="alert">
          <div class="flex-1">
            <strong>Analytics returned an error.</strong>
            <span class="block text-[0.74rem] mt-0.5">{{ error() }}</span>
          </div>
          <button class="btn-ghost" type="button" (click)="reload()" aria-label="Retry loading analytics">Retry</button>
        </div>
      }

      <!-- Body renders ONLY with a site selected + no load error. On error the
           banner above is the whole truth — never also paint "0 views / no
           traffic yet" (a definitive empty-data claim) over a FAILED load. -->
      @if (state.selectedSite() && !error()) {
      <!-- ─────────────────── KPI TILES ─────────────────── -->
      <div class="grid gap-3 grid-cols-3 max-md:grid-cols-1">
        <div class="card kpi" appReveal data-testid="kpi-pageviews">
          @if (loading() && !envelope()) {
            <div class="skel skel-line w-20 h-3 mb-2"></div>
            <div class="skel skel-line w-28 h-7 mb-2"></div>
            <div class="skel skel-line w-32 h-3"></div>
          } @else {
            <div class="muted-h">Page views</div>
            <div class="kpi-row">
              <div class="text-3xl font-bold text-white mt-1 leading-none" [title]="(envelope()?.pageviews ?? 0) | number">
                <app-rolling-counter [value]="envelope()?.pageviews ?? 0" [duration]="1100" />
              </div>
              <svg viewBox="0 0 80 24" preserveAspectRatio="none" class="kpi-spark" aria-hidden="true">
                <path [attr.d]="kpiSparkArea()" fill="url(#kpi-grad)" />
                <path [attr.d]="kpiSparkLine()" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                <defs>
                  <linearGradient id="kpi-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="currentColor" stop-opacity="0.35"/>
                    <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div class="text-[0.68rem] text-text-secondary mt-1 flex items-center gap-2 flex-wrap">
              @if (pvTrend(); as t) {
                <span class="trend-chip"
                      [attr.data-dir]="t.dir"
                      [attr.aria-label]="t.aria"
                      [title]="t.title">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    @if (t.dir === 'up') { <path d="M6 15l6-6 6 6"/> }
                    @else if (t.dir === 'down') { <path d="M6 9l6 6 6-6"/> }
                    @else { <path d="M5 12h14"/> }
                  </svg>
                  {{ t.label }}
                </span>
              }
              @if ((envelope()?.total_requests ?? 0) > 0) {
                <span>of {{ formatCount(envelope()?.total_requests ?? 0) }} requests</span>
              } @else {
                <span>In the selected period</span>
              }
            </div>
          }
        </div>

        <div class="card kpi" appReveal data-testid="kpi-visitors">
          @if (loading() && !envelope()) {
            <div class="skel skel-line w-24 h-3 mb-2"></div>
            <div class="skel skel-line w-24 h-7 mb-2"></div>
            <div class="skel skel-line w-28 h-3"></div>
          } @else {
            <div class="muted-h">Unique visitors</div>
            <div class="kpi-row">
              <div class="text-3xl font-bold text-white mt-1 leading-none" [title]="(envelope()?.uniques ?? 0) | number">
                <app-rolling-counter [value]="envelope()?.uniques ?? 0" [duration]="1100" />
              </div>
              <svg viewBox="0 0 80 24" preserveAspectRatio="none" class="kpi-spark kpi-spark--secondary" aria-hidden="true">
                <path [attr.d]="kpiVisitorSparkArea()" fill="url(#kpi-grad-2)" />
                <path [attr.d]="kpiVisitorSparkLine()" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                <defs>
                  <linearGradient id="kpi-grad-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="currentColor" stop-opacity="0.35"/>
                    <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div class="text-[0.68rem] text-text-secondary mt-1">Distinct IPs across {{ urls().length }} URL{{ urls().length === 1 ? '' : 's' }}</div>
          }
        </div>

        <div class="card kpi" appReveal data-testid="kpi-requests">
          @if (loading() && !envelope()) {
            <div class="skel skel-line w-24 h-3 mb-2"></div>
            <div class="skel skel-line w-24 h-7 mb-2"></div>
            <div class="skel skel-line w-28 h-3"></div>
          } @else {
            <div class="muted-h">Total requests</div>
            <div class="text-3xl font-bold text-white mt-1 leading-none" [title]="(envelope()?.total_requests ?? 0) | number">
              <app-rolling-counter [value]="envelope()?.total_requests ?? 0" [duration]="1100" />
            </div>
            <div class="text-[0.68rem] text-text-secondary mt-1">All HTTP requests at the edge</div>
          }
        </div>
      </div>

      <!-- ─────────────────── MAIN CHART ─────────────────── -->
      <section class="card" appReveal>
        <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 class="section-h m-0 text-base font-semibold text-white">Page views over time</h3>
          <span class="text-[0.7rem] text-text-secondary">
            {{ envelope()?.series?.length || 0 }} days · peak {{ formatCount(peakDayVisits()) }}
          </span>
        </div>
        @if (loading() && !envelope()) {
          <div class="skel skel-chart" aria-hidden="true"></div>
        } @else if ((envelope()?.series?.length ?? 0) === 0 || peakDayVisits() === 0) {
          <div class="empty-state-pretty" role="status">
            <div class="empty-glyph" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>
              </svg>
            </div>
            <h4 class="glow-h-grad text-xl font-semibold m-0">No traffic yet — share your site</h4>
            <p class="text-[0.86rem] text-text-secondary max-w-[440px] mx-auto m-0 leading-relaxed">
              Once visitors arrive, page-view trends plot here in real time. Tap the button to copy your live URL and start driving traffic.
            </p>
            <div class="flex gap-2 justify-center mt-1 flex-wrap">
              <button class="btn-primary" type="button" (click)="copyShareLink()" aria-label="Copy share link" title="Copy your live site URL">Copy share link</button>
            </div>
          </div>
        } @else {
          <svg viewBox="0 0 600 130" preserveAspectRatio="none" class="w-full h-32 sparkline" role="img" [attr.aria-label]="'Page views chart — peak ' + peakDayVisits() + ' on the busiest day'">
            <defs>
              <linearGradient id="visit-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--ps-accent, #00E5FF)" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="var(--ps-accent, #00E5FF)" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <g class="grid" aria-hidden="true">
              <line x1="0" y1="32"  x2="600" y2="32"  stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
              <line x1="0" y1="65"  x2="600" y2="65"  stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
              <line x1="0" y1="98"  x2="600" y2="98"  stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
            </g>
            <path [attr.d]="sparkArea()" fill="url(#visit-grad)" />
            <path [attr.d]="sparkLine()" fill="none" stroke="var(--ps-accent, #00E5FF)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
            @for (p of sparkDots(); track p.x) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.2" fill="var(--ps-accent, #00E5FF)"/>
            }
          </svg>
        }
      </section>

      <!-- ─────────────────── TOP PAGES + COUNTRIES ─────────────────── -->
      <div class="grid md:grid-cols-2 gap-4">
        <section class="card" appReveal>
          <div class="kicker">URLs</div>
          <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-3">Top pages</h3>
          @if (loading() && !envelope()) {
            <div class="space-y-2" aria-busy="true">
              @for (i of [1,2,3,4]; track i) {
                <div class="skel skel-line w-full h-4"></div>
              }
            </div>
          } @else if ((envelope()?.top_pages?.length ?? 0) === 0) {
            <app-mini-empty text="No visits recorded yet.">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            </app-mini-empty>
          } @else {
            @for (r of envelope()!.top_pages; track r.path) {
              <div class="bar-row">
                <div class="flex justify-between mb-1 gap-2">
                  <span class="font-mono text-[0.72rem] truncate text-white">{{ r.path }}</span>
                  <span class="text-[0.7rem] text-text-secondary tabular">{{ formatCount(r.views) }}</span>
                </div>
                <div class="bar"><div class="bar-fill" [style.width.%]="barWidth(r.views, maxPage())"></div></div>
              </div>
            }
          }
        </section>

        <section class="card" appReveal>
          <div class="kicker">Geo</div>
          <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-3">Top countries</h3>
          @if (loading() && !envelope()) {
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5" aria-busy="true">
              @for (i of [1,2,3,4,5,6]; track i) {
                <div class="skel skel-line w-full h-4"></div>
              }
            </div>
          } @else if ((envelope()?.top_countries?.length ?? 0) === 0) {
            <app-mini-empty text="No geo data yet.">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </app-mini-empty>
          } @else {
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
              @for (r of envelope()!.top_countries; track r.country) {
                <div class="flex items-center justify-between border-b border-white/[0.04] py-1">
                  <span class="text-[0.78rem]">{{ flag(r.country) }} {{ r.country }}</span>
                  <span class="text-[0.7rem] text-text-secondary tabular">{{ formatCount(r.views) }}</span>
                </div>
              }
            </div>
          }
        </section>
      </div>

      <!-- ─────────────────── REFERRERS ─────────────────── -->
      @if ((envelope()?.top_referrers?.length ?? 0) > 0) {
        <section class="card" appReveal>
          <div class="kicker">Acquisition</div>
          <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-3">Top referrers</h3>
          @for (r of envelope()!.top_referrers; track r.referrer) {
            <div class="bar-row">
              <div class="flex justify-between mb-1 gap-2">
                <span class="text-[0.78rem] truncate">{{ r.referrer }}</span>
                <span class="text-[0.7rem] text-text-secondary tabular">{{ formatCount(r.views) }}</span>
              </div>
              <div class="bar"><div class="bar-fill" [style.width.%]="barWidth(r.views, maxReferrer())"></div></div>
            </div>
          }
        </section>
      }

      <p class="text-[0.65rem] text-text-secondary text-center">
        Source: {{ dataLabel() }} · {{ dataTooltip() }} ·
        last refreshed {{ refreshedAt() ? (refreshedAt() | date:'medium') : '—' }}
      </p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .kicker {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85;
    }
    .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .text-accent { color: var(--ps-accent, #00E5FF); }

    .host-link {
      display: inline-flex; align-items: center; gap: 4px;
      text-decoration: none;
      color: inherit;
      border-bottom: 1px dashed color-mix(in oklch, var(--ps-accent, #00E5FF) 38%, transparent);
      transition: color 160ms ease, border-color 160ms ease;
    }
    .host-link:hover {
      color: var(--ps-accent, #00E5FF);
      border-color: var(--ps-accent, #00E5FF);
    }
    .host-link:focus-visible {
      outline: 2px solid var(--ps-accent, #00E5FF);
      outline-offset: 2px;
      border-radius: 4px;
    }
    .ext-glyph {
      color: color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, var(--ps-ink, #fff) 30%);
      transition: transform 160ms ease;
    }
    .host-link:hover .ext-glyph { transform: translate(1px, -1px); }

    .card {
      background: var(--ps-surface-glass, rgba(13,13,40,0.62));
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border-radius: var(--ps-radius-xl, 14px);
      padding: 1.4rem;
      box-shadow: var(--ps-shadow-card, inset 0 0 0 1px color-mix(in oklch, var(--ps-ink, #f4f4ff) 2%, transparent));
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    }
    .card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent), 0 8px 24px -16px color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
    }

    .kpi { padding: 1.1rem; position: relative; overflow: hidden; }
    .kpi-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
    .kpi-spark { width: 72px; height: 22px; flex-shrink: 0; color: var(--ps-accent, #00E5FF); opacity: 0.85; }
    .kpi-spark--secondary { color: var(--ps-accent-secondary, #7C3AED); }

    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
    .tabular { font-variant-numeric: tabular-nums; }

    /* Period-over-period trend chip — neon-cyan up, dimmed down, neutral flat.
       Up reads as the brand accent (the win we want to celebrate); down stays
       muted so a dip never shouts in off-brand red on the cyan/black cockpit. */
    .trend-chip {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 1px 7px 1px 5px; border-radius: 999px;
      font-size: 0.64rem; font-weight: 700; line-height: 1.4;
      font-variant-numeric: tabular-nums;
      border: 1px solid transparent;
    }
    .trend-chip svg { flex-shrink: 0; }
    .trend-chip[data-dir="up"] {
      color: var(--ps-accent, #00E5FF);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 32%, transparent);
    }
    .trend-chip[data-dir="down"] {
      color: rgba(255,255,255,0.62);
      background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 5%, transparent);
      border-color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 12%, transparent);
    }
    .trend-chip[data-dir="flat"] {
      color: rgba(255,255,255,0.5);
      background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
      border-color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
    }

    .btn-ghost {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.45rem 0.9rem; border-radius: 8px; min-height: 32px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      color: #e5e7eb; font-size: 0.74rem; font-weight: 600; cursor: pointer;
      transition: transform 200ms ease, border-color 200ms ease, background 200ms ease, color 200ms ease;
    }
    .btn-ghost:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 30%, transparent);
      color: #fff; background: rgba(255,255,255,0.06);
    }
    .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }
    .refresh-btn { min-width: 110px; justify-content: center; }
    .refresh-btn .spinning { animation: spin 1.2s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .btn-tiny-ghost {
      padding: 3px 9px; border-radius: 6px; min-height: 24px;
      font-size: 0.66rem; font-weight: 600; cursor: pointer;
      background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7);
      border: 1px dashed rgba(255,255,255,0.18);
      transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
    }
    .btn-tiny-ghost:hover { color: #fff; background: rgba(255,255,255,0.06); border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 38%, transparent); }
    .btn-tiny-ghost:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 1rem; border-radius: 10px; min-height: 32px;
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 22%, transparent));
      color: var(--ps-bg, #060610);
      font-weight: 700; border: 0; cursor: pointer; font-size: 0.78rem;
      box-shadow: 0 6px 18px -8px color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent);
      transition: transform 200ms ease, box-shadow 200ms ease;
    }
    .btn-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 10px 24px -8px color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, transparent);
    }
    .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .bar-row { margin-bottom: 0.55rem; }
    .bar { height: 6px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; }
    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--ps-accent, #00E5FF), var(--ps-accent-secondary, #7C3AED));
      transition: width 320ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .range-chip-strip {
      display: inline-flex;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 999px; padding: 2px; gap: 2px;
    }
    .range-chip {
      padding: 4px 12px; border-radius: 999px;
      background: transparent; border: 0;
      color: rgba(255,255,255,0.65);
      font-size: 0.7rem; font-weight: 600; cursor: pointer;
      min-height: 26px;
      transition: color 160ms ease, background 160ms ease;
    }
    .range-chip:hover { color: #fff; }
    .range-chip.active {
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 22%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 22%, transparent));
      color: var(--ps-accent, #00E5FF);
      box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00E5FF) 30%, transparent);
    }
    .range-chip:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .sparkline path { transition: d 320ms ease; }

    .status-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 10px; border-radius: 999px;
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      vertical-align: middle; cursor: help;
      border: 1px solid currentColor;
      margin-left: 0.3rem;
    }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
    .status-pill[data-health="healthy"]  { color: #34d399; background: rgba(52, 211, 153, 0.10); border-color: rgba(52, 211, 153, 0.32); }
    .status-pill[data-health="warning"]  { color: #fb923c; background: rgba(251, 146, 60, 0.10); border-color: rgba(251, 146, 60, 0.32); }
    .status-pill[data-health="degraded"] { color: #f87171; background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.32); }

    .urls-row {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      padding: 0.5rem 0.7rem;
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
    }
    .urls-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: rgba(255,255,255,0.45); margin-right: 4px;
    }
    .url-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px 3px 9px;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 10%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
      border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.66rem; color: var(--ps-ink, #fff);
      transition: opacity 140ms ease, background 140ms ease, border-color 140ms ease;
    }
    .url-pill.is-excluded { opacity: 0.4; background: transparent; }
    .url-pill.is-unresolved {
      border-color: color-mix(in oklch, #fb923c 38%, transparent);
      color: #fde68a;
      background: rgba(251, 146, 60, 0.06);
    }
    .url-text { line-height: 1; }
    .primary-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--ps-success, #4dffb5);
      box-shadow: 0 0 5px color-mix(in oklch, var(--ps-success, #4dffb5) 60%, transparent);
    }
    .url-toggle {
      width: 18px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.65);
      border: 0; cursor: pointer; font-size: 0.78rem; line-height: 1;
      transition: background 140ms ease, color 140ms ease;
    }
    .url-toggle:hover { color: #fff; background: rgba(255,255,255,0.16); }
    .url-toggle:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 1px; }

    .notice { display: flex; gap: 12px; align-items: center; justify-content: space-between; font-size: 0.78rem; line-height: 1.55; }
    .notice strong { display: block; color: #fff; }
    .notice-amber { background: rgba(251, 191, 36, 0.06); border-color: rgba(251, 191, 36, 0.3); color: #fde68a; }
    .notice-amber strong { color: #fcd34d; }
    .notice-red { background: rgba(248, 113, 113, 0.06); border-color: rgba(248, 113, 113, 0.3); color: #fecaca; }
    .notice-red strong { color: #f87171; }

    .empty-state-pretty {
      display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
      padding: 2.4rem 1.2rem; text-align: center;
    }
    .empty-glyph {
      width: 80px; height: 80px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 20px;
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 10%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 8%, transparent));
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent);
      color: color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, currentColor 30%);
      box-shadow: 0 16px 48px -24px color-mix(in oklch, var(--ps-accent, #00E5FF) 38%, transparent);
      animation: pulseGlow 3.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes pulseGlow {
      0%, 100% { box-shadow: 0 16px 48px -24px color-mix(in oklch, var(--ps-accent, #00E5FF) 32%, transparent); }
      50%      { box-shadow: 0 20px 64px -24px color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent); }
    }
    .glow-h-grad {
      background: linear-gradient(135deg, var(--ps-ink, #fff), color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, var(--ps-ink, #fff) 40%));
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }

    .skel {
      position: relative; overflow: hidden;
      background: rgba(255,255,255,0.04);
      border-radius: 6px;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 40%, color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent) 50%, rgba(255,255,255,0.06) 60%, transparent);
      background-size: 200% 100%;
      animation: skel-shine 1.6s linear infinite;
    }
    @keyframes skel-shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    .skel-line { display: block; }
    .skel-chart { height: 128px; width: 100%; border-radius: 10px; }

    .countdown {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0 6px; margin-left: 4px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.66rem;
      color: rgba(255,255,255,0.55);
      border-left: 1px solid rgba(255,255,255,0.1);
    }
    .dots { display: inline-flex; gap: 3px; }
    .dots span {
      width: 4px; height: 4px; border-radius: 50%;
      background: var(--ps-accent, #00E5FF);
      animation: dotPulse 1.2s ease-in-out infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.15s; }
    .dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes dotPulse {
      0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .skel::after, .empty-glyph, .dots span, .refresh-btn .spinning { animation: none; }
      .sparkline path, .bar-fill, .btn-primary, .card, .url-pill { transition: none; }
      .card:hover { transform: none; box-shadow: none; }
    }
  `],
})
export class AdminAnalyticsComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private promptSvc = inject(PromptService);
  private router = inject(Router);

  /** Aggregated CF GraphQL envelope from `GET /api/sites/:id/analytics`. */
  envelope = signal<MultiUrlAnalyticsEnvelope | null>(null);
  urls = signal<SiteUrlRow[]>([]);
  excluded = signal<Set<string>>(new Set());
  credStatus = signal<CloudflareCredentialStatus | null>(null);

  error = signal<string | null>(null);
  loading = signal(false);
  refreshedAt = signal<Date | null>(null);
  secondsUntilRefresh = signal<number>(REFRESH_INTERVAL_SEC);
  readonly refreshIntervalSec = REFRESH_INTERVAL_SEC;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private lastSiteId: string | null = null;
  /** Guards the site-reactive load effect — see constructor + _ULTIMATE_CONVERGENCE.md §7. */
  private loadedSiteId: string | null = null;

  readonly formatCount = formatCount;

  constructor() {
    // Site-reactive load: when the selected site resolves on a deep-link (it
    // arrives AFTER mount) or the operator switches sites, fetch immediately
    // instead of waiting up to REFRESH_INTERVAL_SEC for the next poll tick.
    // Without this the deep-linked analytics panel sits empty for ~60s.
    // (Reactivity class-bug — same fix as webhooks/recipes/pseo/mcp/forms.)
    effect(() => {
      const id = this.state.selectedSite()?.id ?? null;
      if (id !== this.loadedSiteId) {
        this.loadedSiteId = id;
        this.loadUrls();
        this.reload();
      }
    });
  }

  /**
   * 10-second timeout for the analytics fetch. Tighter than the shared
   * `ApiService` 30 s budget — analytics auto-refreshes every 60 s so a
   * hung fetch should never block the operator from interacting.
   */
  private static readonly FETCH_TIMEOUT_MS = 10_000;

  ranges: ReadonlyArray<{ id: RangeId; label: string }> = [
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' },
  ];

  range = signal<RangeId>(((): RangeId => {
    try {
      const stored = localStorage.getItem('ps_analytics_range');
      if (stored === '24h' || stored === '7d' || stored === '30d' || stored === '90d') return stored;
      // Migrate legacy '1d' value from the prior version.
      if (stored === '1d') return '24h';
      return '7d';
    } catch { return '7d'; }
  })());

  setRange(id: RangeId): void {
    this.range.set(id);
    try { localStorage.setItem('ps_analytics_range', id); } catch { /* */ }
    this.reload();
  }

  /** Hostname displayed in the header — primary URL hostname when known. */
  selectedHost = computed<string>(() => {
    const primary = this.urls().find((u) => u.is_primary);
    if (primary?.hostname) return primary.hostname;
    const site = this.state.selectedSite();
    if (!site) return '—';
    return site.primary_hostname || `${site.slug}.projectsites.dev`;
  });

  /** Live URL of the selected site (header hyperlink target). */
  liveUrl = computed<string>(() => {
    const host = this.selectedHost();
    if (!host || host === '—') return '#';
    return host.startsWith('http') ? host : `https://${host}`;
  });

  /** Data-source label/health based on envelope state + credential status. */
  dataLabel = computed<string>(() => {
    const env = this.envelope();
    if (!env) return 'Loading';
    if (env.any_real_data) return 'Cloudflare Edge';
    const cred = this.credStatus();
    if (cred && cred.source === 'none') return 'Not connected';
    return 'No data yet';
  });
  dataHealth = computed<'healthy' | 'warning' | 'degraded'>(() => {
    const env = this.envelope();
    if (env?.any_real_data) return 'healthy';
    const cred = this.credStatus();
    if (cred && cred.source === 'none') return 'degraded';
    return 'warning';
  });
  dataTooltip = computed<string>(() => {
    const env = this.envelope();
    if (env?.any_real_data) {
      return `Cloudflare GraphQL — aggregated across ${env.urls_included.length} URL${env.urls_included.length === 1 ? '' : 's'}. No session-duration / bounce-rate at the edge.`;
    }
    const cred = this.credStatus();
    if (cred && cred.source === 'none') {
      return 'Connect Cloudflare credentials in Settings to see real traffic data.';
    }
    return 'No traffic captured yet. Once visitors arrive, page-view trends plot here.';
  });

  /** True if Cloudflare resolved a zone for this hostname this turn. */
  isResolved = (hostname: string): boolean => {
    const env = this.envelope();
    if (!env) return true;
    return env.urls_included.find((u) => u.hostname === hostname)?.resolved_zone ?? false;
  };

  urlTooltip(u: SiteUrlRow): string {
    const parts: string[] = [];
    parts.push(u.is_primary ? 'Primary URL' : 'Alternate URL');
    if (this.envelope() && !this.isResolved(u.hostname)) parts.push('— zone not resolved');
    if (this.excluded().has(u.hostname)) parts.push('(excluded from aggregate)');
    return parts.join(' ');
  }

  toggleExclude(hostname: string): void {
    const next = new Set(this.excluded());
    if (next.has(hostname)) next.delete(hostname);
    else next.add(hostname);
    this.excluded.set(next);
    this.reload();
  }

  async promptAddUrl(): Promise<void> {
    const site = this.state.selectedSite();
    if (!site) return;
    const entered = await this.promptSvc.prompt({
      title: 'Bind a hostname',
      message: 'Track analytics for an additional hostname pointed at this site.',
      label: 'Hostname',
      placeholder: 'shop.example.com',
      confirmLabel: 'Bind hostname',
      validate: (v) =>
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v)
          ? null
          : 'Enter a valid hostname (e.g. shop.example.com)',
    });
    const hostname = entered?.trim().toLowerCase();
    if (!hostname) return;
    try {
      await new Promise<void>((resolve, reject) => {
        this.api.addSiteUrl(site.id, hostname).subscribe({
          next: () => resolve(),
          error: (err: unknown) => reject(err),
        });
      });
      this.toast.success(`${hostname} added`);
      this.loadUrls();
      this.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add URL';
      this.toast.error(message);
    }
  }

  openCredentialSettings(): void {
    void this.router.navigateByUrl('/admin/user?focus=cloudflare');
  }

  exportCsv(): void {
    const env = this.envelope();
    if (!env) return;
    const lines: string[] = [];
    lines.push('section,key,value');
    lines.push(`summary,source,cloudflare_graphql`);
    lines.push(`summary,page_views,${env.pageviews}`);
    lines.push(`summary,unique_visitors,${env.uniques}`);
    lines.push(`summary,total_requests,${env.total_requests}`);
    for (const r of env.series || []) lines.push(`by_day,${r.date},${r.page_views}`);
    for (const r of env.top_pages || []) lines.push(`top_page,${this.csvCell(r.path)},${r.views}`);
    for (const r of env.top_countries || []) lines.push(`country,${this.csvCell(r.country)},${r.views}`);
    for (const r of env.top_referrers || []) lines.push(`referrer,${this.csvCell(r.referrer)},${r.views}`);
    for (const u of env.urls_included || []) lines.push(`url_included,${this.csvCell(u.hostname)},${u.resolved_zone ? 'resolved' : 'unresolved'}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projectsites-analytics-${this.range()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /**
   * Escape one CSV cell. Two layers:
   *  1. Formula-injection guard (CWE-1236): top_referrers / top_pages / hostnames
   *     are attacker-controllable (a crafted `Referer` header lands in analytics),
   *     so a value starting with = + - @ (or a leading tab/CR) is prefixed with a
   *     literal apostrophe — Excel/Sheets then treat it as text, not a formula.
   *  2. RFC 4180 quoting for embedded comma / quote / newline.
   */
  csvCell(s: string): string {
    const str = String(s ?? '');
    const guarded = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  }

  async copyShareLink(): Promise<void> {
    const url = this.liveUrl();
    if (!url || url === '#') {
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

  /**
   * Period-over-period page-view trend. Splits the day series in half and
   * compares the recent half against the older half — a quick "is traffic
   * rising or falling?" read the bare KPI number can't give. Returns null
   * until there are ≥4 days of data (a 2v2 split is the minimum that means
   * anything). `aria` is the screen-reader sentence; `title` is the hover.
   */
  pvTrend = computed<{ dir: 'up' | 'down' | 'flat'; label: string; aria: string; title: string } | null>(() => {
    const series = this.envelope()?.series ?? [];
    if (series.length < 4) return null;
    const mid = Math.floor(series.length / 2);
    const older = series.slice(0, mid).reduce((s, d) => s + (d.page_views || 0), 0);
    const recent = series.slice(mid).reduce((s, d) => s + (d.page_views || 0), 0);
    if (older === 0 && recent === 0) return null;
    if (older === 0) {
      return { dir: 'up', label: 'new', aria: 'Page views up from zero in the recent period', title: 'No views in the earlier half of this range' };
    }
    const pct = ((recent - older) / older) * 100;
    const rounded = Math.round(Math.abs(pct));
    const dir = pct > 1 ? 'up' : pct < -1 ? 'down' : 'flat';
    const label = dir === 'flat' ? 'flat' : `${rounded}%`;
    const word = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
    return {
      dir,
      label,
      aria: `Page views ${word}${dir === 'flat' ? '' : ' ' + rounded + ' percent'} versus the earlier half of this range`,
      title: `Recent half vs earlier half of the selected range (${dir === 'flat' ? 'no significant change' : word + ' ' + rounded + '%'})`,
    };
  });

  maxPage = computed(() => Math.max(1, ...(this.envelope()?.top_pages ?? []).map((p) => p.views)));
  maxReferrer = computed(() => Math.max(1, ...(this.envelope()?.top_referrers ?? []).map((r) => r.views)));
  peakDayVisits = computed(() => Math.max(0, ...(this.envelope()?.series ?? []).map((d) => d.page_views)));

  sparkPoints = computed<{ x: number; y: number }[]>(() => {
    const days = this.envelope()?.series ?? [];
    if (days.length === 0) return [];
    const peak = Math.max(1, ...days.map((d) => d.page_views));
    const step = days.length > 1 ? 600 / (days.length - 1) : 0;
    return days.map((d, i) => ({ x: i * step, y: 120 - (d.page_views / peak) * 108 }));
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
    return `${line} L ${last.x.toFixed(1)} 130 L ${first.x.toFixed(1)} 130 Z`;
  });
  sparkDots = computed(() => this.sparkPoints());

  kpiSparkLine = computed(() => sparklinePath((this.envelope()?.series ?? []).map((d) => d.page_views), 80, 24).line);
  kpiSparkArea = computed(() => sparklinePath((this.envelope()?.series ?? []).map((d) => d.page_views), 80, 24).area);
  kpiVisitorSparkLine = computed(() => sparklinePath((this.envelope()?.series ?? []).map((d) => d.unique_visitors), 80, 24).line);
  kpiVisitorSparkArea = computed(() => sparklinePath((this.envelope()?.series ?? []).map((d) => d.unique_visitors), 80, 24).area);

  barWidth(visits: number, max: number): number { return max > 0 ? (visits / max) * 100 : 0; }
  flag(code: string): string {
    if (!code || code === '-' || code.length !== 2) return '🌐';
    const base = 'A'.charCodeAt(0);
    const A = 0x1f1e6;
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
  }

  ngOnInit(): void {
    // Org-level credential status has no site dependency — load once on mount.
    // The site-dependent loads (loadUrls + reload) are owned by the constructor
    // effect so a deep-link populates instantly when selectedSite() resolves.
    this.loadCredStatus();
    this.refreshTimer = setInterval(() => this.reload(), REFRESH_INTERVAL_SEC * 1000);
    this.countdownTimer = setInterval(() => {
      this.secondsUntilRefresh.update((s) => (s <= 1 ? REFRESH_INTERVAL_SEC : s - 1));
    }, 1000);
  }
  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  /** Fetch the org's CF credential status (fire-and-forget). */
  loadCredStatus(): void {
    this.api.getCloudflareCredentialStatus().pipe(
      timeout(5000),
      catchError(() => of({ data: null as CloudflareCredentialStatus | null })),
    ).subscribe((r) => {
      if (r.data) this.credStatus.set(r.data);
    });
  }

  loadUrls(): void {
    const site = this.state.selectedSite();
    if (!site) {
      this.urls.set([]);
      return;
    }
    this.api.listSiteUrls(site.id).pipe(
      timeout(5000),
      catchError(() => of({ data: [] as SiteUrlRow[] })),
    ).subscribe((r) => {
      this.urls.set(r.data || []);
    });
  }

  reload(): void {
    const site = this.state.selectedSite();
    if (!site) {
      this.envelope.set(null);
      this.error.set(null);
      this.loading.set(false);
      return;
    }
    if (this.lastSiteId !== site.id) {
      this.envelope.set(null);
      this.lastSiteId = site.id;
      this.excluded.set(new Set());
      this.loadUrls();
    }
    this.loading.set(true);
    this.secondsUntilRefresh.set(REFRESH_INTERVAL_SEC);
    const excludeArr = Array.from(this.excluded());
    forkJoin({
      analytics: this.api.getMultiUrlAnalytics(site.id, this.range(), excludeArr).pipe(
        timeout(AdminAnalyticsComponent.FETCH_TIMEOUT_MS),
        catchError((err: unknown) => {
          const msg = err instanceof TimeoutError
            ? 'Analytics request timed out after 10 s — retry, or check the worker logs.'
            : "Couldn't reach the analytics service — this is usually temporary. Retry below, or check back shortly.";
          this.error.set(msg);
          return of({ data: null as MultiUrlAnalyticsEnvelope | null });
        }),
      ),
    }).subscribe({
      next: (r) => {
        if (r.analytics.data) {
          this.envelope.set(r.analytics.data);
          this.error.set(null);
        }
        this.refreshedAt.set(new Date());
        this.loading.set(false);
      },
    });
  }
}
