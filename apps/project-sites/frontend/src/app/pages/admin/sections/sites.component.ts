/**
 * Per-site Web Vitals heatmap (item #3 from the May 24 polish pass).
 *
 * Renders a table of every site in the org with sortable colored cells for
 * LCP / CLS / INP / Lighthouse Performance, each accompanied by a tiny
 * inline-SVG sparkline of the last 30 days. A "Triage view" toggle re-sorts
 * worst-first by the weighted composite score returned by the backend.
 *
 * Data source: `GET /api/sites/sparklines?days=30` — see
 * `apps/project-sites/src/routes/api.ts` for shape + scoring.
 */
import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  EmptyStateComponent,
  ErrorCardComponent,
  SkeletonComponent,
} from '../../../components/states';
import { HlmCheckboxDirective } from '../../../ui';
import { SyncedPillComponent } from '../../../components/synced-pill/synced-pill.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Daily {
  date: string;
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
  lh_perf: number | null;
}

interface SiteSparkline {
  site_id: string;
  slug: string;
  business_name: string | null;
  daily: Daily[];
  latest: {
    lcp_ms: number | null;
    cls: number | null;
    inp_ms: number | null;
    lh_perf: number | null;
    lh_accessibility: number | null;
    axe_violations: number | null;
    captured_at: string | null;
  };
  composite_score: number | null;
}

type SortKey = 'name' | 'lcp' | 'cls' | 'inp' | 'lh' | 'composite';
type Tier = 'green' | 'yellow' | 'red' | 'neutral';

@Component({
  imports: [RouterModule, SkeletonComponent, EmptyStateComponent, ErrorCardComponent, HlmCheckboxDirective, SyncedPillComponent],
  selector: 'app-admin-sites',
  standalone: true,
  styles: [`
    :host ::ng-deep .spark { display: inline-block; vertical-align: middle; margin-left: 6px; }
    :host ::ng-deep .cell-val { display: inline-block; vertical-align: middle; min-width: 48px; }
    /* Sort affordance: faint ↕ on unsorted sortable headers, cyan ↑/↓ on the active one (parity with content-freshness). */
    .st-sort-ind { margin-left: 4px; opacity: .45; font-size: .8em; }
    th[aria-sort="ascending"] .st-sort-ind,
    th[aria-sort="descending"] .st-sort-ind { opacity: 1; color: var(--ps-accent, #00e5ff); }
    /* Refresh-button spinner (parity with analytics' refresh-btn); reduced-motion safe. */
    .st-spin { animation: st-spin 1.2s linear infinite; transform-origin: center; }
    @keyframes st-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .st-spin { animation: none; } }
  `],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-5">
      <header class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-[1.4rem] font-semibold text-white">Sites — Web Vitals heatmap</h1>
          <p class="text-[0.82rem] text-white/55 mt-1">
            Last 30 days · click any column to sort · triage view ranks worst-first by weighted score
          </p>
        </div>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 text-[0.82rem] text-white/80 select-none cursor-pointer">
            <input hlmCheckbox type="checkbox" [checked]="triage()" (change)="toggleTriage()" />
            Triage view
          </label>
          <app-synced-pill [at]="syncedAt()" data-testid="sites-synced" />
          <button (click)="reload()"
                  type="button"
                  [disabled]="loading()"
                  [attr.aria-busy]="loading()"
                  aria-label="Refresh sites"
                  title="Refresh sites data now"
                  class="inline-flex items-center gap-1.5 text-[0.78rem] text-white/80 border border-white/15 hover:border-white/30 px-3 py-1.5 rounded-md disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [class.st-spin]="loading()"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>{{ loading() ? 'Refreshing' : 'Refresh' }}</span>
          </button>
        </div>
      </header>

      @if (loading()) {
        <app-skeleton variant="table" [rows]="6" [columns]="6"
                      label="Loading metrics for every site…" />
      } @else if (error()) {
        <app-error-card
          title="Couldn't load the Web Vitals heatmap"
          [message]="error()!"
          [correlationId]="errorRef()"
          (retry)="reload()" />
      } @else if (rows().length === 0 && fallbackSites().length > 0) {
        <ul class="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06]">
          @for (s of fallbackSites(); track s.id) {
            <li class="px-4 py-3">
              <a [routerLink]="['/admin/sites', s.id]"
                 class="text-white font-medium hover:text-[var(--ps-accent)] inline-flex items-center min-h-[24px]">
                {{ s.name || s.slug }}
              </a>
              <span class="text-[0.75rem] text-white/50 ml-2">{{ s.slug }}.projectsites.dev</span>
            </li>
          }
        </ul>
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="🌐"
          title="No sites yet"
          message="Build your first AI-generated site and its Web Vitals will appear here."
          ctaLabel="Create your first site"
          (ctaClick)="createSite()" />
      } @else {
        @if (allVitalsEmpty()) {
          <div class="mb-3 flex items-start gap-2 rounded-lg border border-[var(--ps-accent)]/25 bg-[var(--ps-accent)]/[0.06] px-3.5 py-2.5 text-[0.8rem] text-white/75" role="status" data-testid="sites-no-vitals-hint">
            <span aria-hidden="true" class="text-[var(--ps-accent)] leading-none mt-0.5">◆</span>
            <span>No Web Vitals data yet — published sites report Core Web Vitals automatically once they receive real traffic. The heatmap fills in as data arrives.</span>
          </div>
        }
        <div class="rounded-xl border border-white/10 bg-white/[0.02] overflow-x-auto" tabindex="0" role="region" aria-label="Sites table — scroll horizontally">
          <table class="w-full text-[0.85rem] text-left">
            <thead class="bg-white/[0.03] text-[0.7rem] uppercase tracking-wider text-white/60">
              <tr>
                <th scope="col" tabindex="0" class="px-4 py-3 cursor-pointer hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]"
                    [attr.aria-sort]="ariaSort('name')"
                    (click)="sortBy('name')" (keydown.enter)="sortBy('name')" (keydown.space)="sortBy('name'); $event.preventDefault()">
                  Site <span class="st-sort-ind" aria-hidden="true">{{ sortIndicator('name') }}</span>
                </th>
                <th scope="col" tabindex="0" class="px-4 py-3 cursor-pointer hover:text-white text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]"
                    [attr.aria-sort]="ariaSort('lcp')"
                    (click)="sortBy('lcp')" (keydown.enter)="sortBy('lcp')" (keydown.space)="sortBy('lcp'); $event.preventDefault()">
                  LCP <span class="st-sort-ind" aria-hidden="true">{{ sortIndicator('lcp') }}</span>
                </th>
                <th scope="col" tabindex="0" class="px-4 py-3 cursor-pointer hover:text-white text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]"
                    [attr.aria-sort]="ariaSort('cls')"
                    (click)="sortBy('cls')" (keydown.enter)="sortBy('cls')" (keydown.space)="sortBy('cls'); $event.preventDefault()">
                  CLS <span class="st-sort-ind" aria-hidden="true">{{ sortIndicator('cls') }}</span>
                </th>
                <th scope="col" tabindex="0" class="px-4 py-3 cursor-pointer hover:text-white text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]"
                    [attr.aria-sort]="ariaSort('inp')"
                    (click)="sortBy('inp')" (keydown.enter)="sortBy('inp')" (keydown.space)="sortBy('inp'); $event.preventDefault()">
                  INP <span class="st-sort-ind" aria-hidden="true">{{ sortIndicator('inp') }}</span>
                </th>
                <th scope="col" tabindex="0" class="px-4 py-3 cursor-pointer hover:text-white text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]"
                    [attr.aria-sort]="ariaSort('lh')"
                    (click)="sortBy('lh')" (keydown.enter)="sortBy('lh')" (keydown.space)="sortBy('lh'); $event.preventDefault()">
                  Lighthouse <span class="st-sort-ind" aria-hidden="true">{{ sortIndicator('lh') }}</span>
                </th>
                <th scope="col" tabindex="0" class="px-4 py-3 cursor-pointer hover:text-white text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ps-accent)]"
                    [attr.aria-sort]="ariaSort('composite')"
                    (click)="sortBy('composite')" (keydown.enter)="sortBy('composite')" (keydown.space)="sortBy('composite'); $event.preventDefault()">
                  Score <span class="st-sort-ind" aria-hidden="true">{{ sortIndicator('composite') }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.06]">
              @for (r of sortedRows(); track r.site_id) {
                <tr class="hover:bg-white/[0.03]"
                    [attr.title]="rowTooltip(r)">
                  <td class="px-4 py-3">
                    <div class="flex flex-col">
                      <a [routerLink]="['/admin/sites', r.site_id]"
                         class="text-white font-medium truncate max-w-[260px] hover:text-[var(--ps-accent)] inline-flex items-center min-h-[24px]">
                        {{ r.business_name || r.slug }}
                      </a>
                      <a [href]="'https://' + r.slug + '.projectsites.dev'" target="_blank" rel="noopener"
                         class="text-[0.7rem] text-white/50 hover:text-[var(--ps-accent)] truncate inline-flex items-center min-h-[24px]">
                        {{ r.slug }}.projectsites.dev
                      </a>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-center" [innerHTML]="cellHtml(r, 'lcp')"></td>
                  <td class="px-4 py-3 text-center" [innerHTML]="cellHtml(r, 'cls')"></td>
                  <td class="px-4 py-3 text-center" [innerHTML]="cellHtml(r, 'inp')"></td>
                  <td class="px-4 py-3 text-center" [innerHTML]="cellHtml(r, 'lh')"></td>
                  <td class="px-4 py-3 text-center">
                    @if (r.composite_score != null) {
                      <span class="inline-block px-2 py-1 rounded-md font-semibold text-[0.85rem]"
                            [style.background]="bgForTier(tierForScore(r.composite_score))"
                            [style.color]="fgForTier(tierForScore(r.composite_score))">
                        {{ r.composite_score }}
                      </span>
                    } @else {
                      <span class="text-white/30">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AdminSitesComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  loading = signal(true);
  error = signal<string | null>(null);
  errorRef = signal<string>('');
  rows = signal<SiteSparkline[]>([]);
  fallbackSites = signal<Array<{ id: string; slug: string; name: string }>>([]);
  sortKey = signal<SortKey>('composite');
  sortDir = signal<'asc' | 'desc'>('asc');
  triage = signal<boolean>(false);
  /** When the heatmap data last loaded — fed to <app-synced-pill> for the live freshness indicator. */
  syncedAt = signal<number | null>(null);

  /**
   * True when sites exist but NONE has reported any Web Vitals metric yet.
   * Drives a contextual "data fills in after traffic" hint so a wall of "—"
   * cells reads as "no data yet" rather than broken / still loading.
   */
  readonly allVitalsEmpty = computed<boolean>(() => {
    const rs = this.rows();
    return rs.length > 0 && rs.every((r) =>
      r.composite_score == null &&
      r.latest.lcp_ms == null && r.latest.cls == null &&
      r.latest.inp_ms == null && r.latest.lh_perf == null);
  });

  ngOnInit(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    // Always load the raw sites list so we can router-link to /admin/sites/:id
    // even when the sparklines endpoint hasn't been populated yet.
    this.api
      .get<{ sites?: Array<{ id: string; slug: string; name: string }> }>('/sites', undefined, { silent: true })
      .subscribe({
        error: () => this.fallbackSites.set([]),
        next: (res) => this.fallbackSites.set(res.sites ?? []),
      });
    try {
      const res = await firstValueFrom(
        this.api.get<{ data: SiteSparkline[] }>('/sites/sparklines', { days: '30' }, { silent: true }),
      );
      this.rows.set(res.data ?? []);
      this.syncedAt.set(Date.now());
    } catch (err) {
      // Sparklines may not be populated for a brand-new org. Silently fall
      // back to the simple list above; only toast on hard 5xx.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('sites heatmap load failed', { error: msg });
      if (this.fallbackSites().length === 0) {
        this.error.set(`Could not load sites — ${msg}`);
        // Surface a copy-able reference for support hand-off.
        const ref = (err as { request_id?: string })?.request_id;
        this.errorRef.set(ref ?? `sites-heatmap-${Date.now().toString(36)}`);
        // The inline error card (with the copy-able ref) is the persistent UX —
        // no transient toast on top, and both gets are {silent} so the generic
        // ApiService toast doesn't fire either (was triple feedback on a hard fail).
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Empty-state CTA → first-result action: kick off a new site build. */
  createSite(): void {
    void this.router.navigate(['/']);
  }

  toggleTriage(): void {
    const next = !this.triage();
    this.triage.set(next);
    if (next) {
      this.sortKey.set('composite');
      this.sortDir.set('asc'); // worst-first
    }
  }

  sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'name' ? 'asc' : 'desc');
    }
    this.triage.set(false);
  }

  sortIndicator(key: SortKey): string {
    // Unsorted columns advertise sortability with a faint ↕ (parity with
    // content-freshness / api-tokens) rather than rendering nothing until clicked.
    if (this.sortKey() !== key) return '↕';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }

  /** WAI-ARIA sort state for the active column header (WCAG 4.1.2). */
  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  sortedRows = computed<SiteSparkline[]>(() => {
    const rows = [...this.rows()];
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    const valueOf = (r: SiteSparkline): number | string => {
      switch (key) {
        case 'name': return (r.business_name || r.slug).toLowerCase();
        case 'lcp': return r.latest.lcp_ms ?? Number.POSITIVE_INFINITY;
        case 'cls': return r.latest.cls ?? Number.POSITIVE_INFINITY;
        case 'inp': return r.latest.inp_ms ?? Number.POSITIVE_INFINITY;
        case 'lh': return r.latest.lh_perf ?? -1;
        case 'composite': return r.composite_score ?? -1;
      }
    };
    rows.sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return rows;
  });

  /**
   * Tier mapping for the colored heatmap cells. Different metrics use
   * different thresholds — score-based (perf, composite) use 90/50, latency
   * metrics use absolute ms thresholds, CLS uses 0.1/0.25.
   */
  tierForScore(score: number | null): Tier {
    if (score == null) return 'neutral';
    if (score >= 90) return 'green';
    if (score >= 50) return 'yellow';
    return 'red';
  }

  tierForLcp(ms: number | null): Tier {
    if (ms == null) return 'neutral';
    if (ms <= 2500) return 'green';
    if (ms <= 4000) return 'yellow';
    return 'red';
  }

  tierForCls(v: number | null): Tier {
    if (v == null) return 'neutral';
    if (v <= 0.1) return 'green';
    if (v <= 0.25) return 'yellow';
    return 'red';
  }

  tierForInp(ms: number | null): Tier {
    if (ms == null) return 'neutral';
    if (ms <= 200) return 'green';
    if (ms <= 500) return 'yellow';
    return 'red';
  }

  bgForTier(tier: Tier): string {
    switch (tier) {
      case 'green': return 'rgba(16, 185, 129, 0.18)';
      case 'yellow': return 'rgba(245, 158, 11, 0.20)';
      case 'red': return 'rgba(239, 68, 68, 0.18)';
      case 'neutral': return 'rgba(255, 255, 255, 0.06)';
    }
  }

  fgForTier(tier: Tier): string {
    switch (tier) {
      case 'green': return '#86efac';
      case 'yellow': return '#fcd34d';
      case 'red': return '#fca5a5';
      case 'neutral': return 'rgba(255, 255, 255, 0.5)';
    }
  }

  /**
   * Render one heatmap cell (colored badge + inline sparkline SVG). We emit
   * raw HTML strings to keep the template terse and avoid one micro-component
   * per metric. Colors and SVG attributes are computed server-safely; no user
   * input is interpolated into the markup, so this is safe with bypassed
   * sanitization (we use `innerHTML` binding which sanitizes anyway).
   */
  cellHtml(r: SiteSparkline, kind: 'lcp' | 'cls' | 'inp' | 'lh'): string {
    let val: number | null;
    let tier: Tier;
    let label: string;
    const series: Array<number | null> = r.daily.map((d) => {
      switch (kind) {
        case 'lcp': return d.lcp_ms;
        case 'cls': return d.cls;
        case 'inp': return d.inp_ms;
        case 'lh': return d.lh_perf;
      }
    });
    switch (kind) {
      case 'lcp':
        val = r.latest.lcp_ms; tier = this.tierForLcp(val);
        label = val == null ? '—' : `${Math.round(val)}ms`; break;
      case 'cls':
        val = r.latest.cls; tier = this.tierForCls(val);
        label = val == null ? '—' : val.toFixed(2); break;
      case 'inp':
        val = r.latest.inp_ms; tier = this.tierForInp(val);
        label = val == null ? '—' : `${Math.round(val)}ms`; break;
      case 'lh':
        val = r.latest.lh_perf; tier = this.tierForScore(val);
        label = val == null ? '—' : String(Math.round(val)); break;
    }
    const bg = this.bgForTier(tier);
    const fg = this.fgForTier(tier);
    const spark = this.sparklineSvg(series, fg);
    return `<span class="cell-val" style="background:${bg};color:${fg};padding:4px 8px;border-radius:6px;font-weight:600;">${label}</span>${spark}`;
  }

  /**
   * Tiny inline-SVG sparkline — no chart lib. 60×18 viewport, normalized
   * within the visible series min/max, missing values broken via separate
   * `<polyline>` segments so gaps render as gaps, not as straight lines.
   */
  private sparklineSvg(series: Array<number | null>, color: string): string {
    const visible = series.filter((v): v is number => v != null);
    if (visible.length < 2) return '';
    const min = Math.min(...visible);
    const max = Math.max(...visible);
    const range = max - min || 1;
    const w = 60;
    const h = 18;
    const n = series.length;
    let path = '';
    let started = false;
    series.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const x = (i / (n - 1)) * w;
      const y = h - ((v - min) / range) * h;
      path += `${started ? ' L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      started = true;
    });
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" /></svg>`;
  }

  rowTooltip(r: SiteSparkline): string {
    const cap = r.latest.captured_at;
    if (!cap) return 'No metrics captured yet';
    const d = new Date(cap);
    return `Most recent capture: ${d.toLocaleString()}`;
  }
}
