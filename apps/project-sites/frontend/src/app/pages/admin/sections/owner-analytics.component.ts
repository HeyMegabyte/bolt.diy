/**
 * AN7 — owner "Your Visitors" single-screen overview for the SELECTED site.
 * Consumes GET /api/sites/:siteId/analytics (the `site_analytics` feature, which
 * aggregates contacts / form submissions / newsletter / donations / traffic the
 * platform already captures). The route 404s while the flag is dark, so a 404
 * (or no selected site) renders nothing — the tab is harmless until the flag is
 * flipped. Mobile-first stat grid; every number rolls via <app-rolling-counter>
 * per the cinematic-ui rule.
 */
import { Component, inject, signal, effect, untracked, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { UtmBuilderComponent } from './utm-builder.component';

interface SourceCount {
  source: string;
  count: number;
}
interface SiteAnalyticsSummary {
  siteId: string;
  windowDays: number;
  contacts: { total: number; newInWindow: number; bySource: SourceCount[] };
  formSubmissions: { total: number; newInWindow: number };
  newsletter: { confirmed: number; total: number };
  donations: { raisedCents: number; count: number };
  traffic: {
    pageviews: number;
    uniqueSessions: number;
    conversions: number;
    topPaths: { path: string; count: number }[];
    byType: { type: string; count: number }[];
    byDevice: { label: string; count: number }[];
    byChannel: { label: string; count: number }[];
    previous: { pageviews: number; uniqueSessions: number; conversions: number };
    windowDays: number;
  };
  generatedAt: string;
}

@Component({
  selector: 'app-owner-analytics',
  standalone: true,
  imports: [RollingCounterComponent, UtmBuilderComponent],
  template: `
    <div class="px-6 pt-4 pb-8 max-md:px-4" data-testid="owner-analytics">
      @if (!siteId()) {
        <p class="text-[0.85rem] text-text-secondary">Select a site to see who's visiting it.</p>
      } @else if (loading()) {
        <div class="oa-grid" aria-hidden="true">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <div class="oa-card oa-skeleton"></div>
          }
        </div>
      } @else if (summary(); as s) {
        <p class="text-[0.78rem] text-text-secondary mb-3">
          Last {{ s.windowDays }} days · your site's real visitor + lead activity.
        </p>
        <div class="oa-grid">
          <div class="oa-card" data-testid="oa-pageviews">
            <span class="oa-label">Pageviews</span>
            <span class="oa-value"><app-rolling-counter [value]="s.traffic.pageviews" /></span>
            @if (delta(s.traffic.pageviews, s.traffic.previous.pageviews); as d) {
              <span class="oa-delta" [attr.data-dir]="d.dir" data-testid="oa-delta-pv">{{ d.label }} vs last {{ s.windowDays }}d</span>
            }
          </div>
          <div class="oa-card" data-testid="oa-sessions">
            <span class="oa-label">Unique sessions</span>
            <span class="oa-value"><app-rolling-counter [value]="s.traffic.uniqueSessions" /></span>
            @if (delta(s.traffic.uniqueSessions, s.traffic.previous.uniqueSessions); as d) {
              <span class="oa-delta" [attr.data-dir]="d.dir">{{ d.label }}</span>
            }
          </div>
          <div class="oa-card" data-testid="oa-conversions">
            <span class="oa-label">Conversions</span>
            <span class="oa-value"><app-rolling-counter [value]="s.traffic.conversions" /></span>
            @if (s.traffic.pageviews > 0) {
              <span class="oa-sub" data-testid="oa-conv-rate">{{ convRate(s) }} of visits</span>
            }
            @if (delta(s.traffic.conversions, s.traffic.previous.conversions); as d) {
              <span class="oa-delta" [attr.data-dir]="d.dir">{{ d.label }}</span>
            }
          </div>
          <div class="oa-card" data-testid="oa-contacts">
            <span class="oa-label">Contacts</span>
            <span class="oa-value"><app-rolling-counter [value]="s.contacts.total" /></span>
            <span class="oa-sub">+{{ s.contacts.newInWindow }} new</span>
          </div>
          <div class="oa-card" data-testid="oa-forms">
            <span class="oa-label">Form submissions</span>
            <span class="oa-value"><app-rolling-counter [value]="s.formSubmissions.total" /></span>
            <span class="oa-sub">+{{ s.formSubmissions.newInWindow }} new</span>
          </div>
          <div class="oa-card" data-testid="oa-newsletter">
            <span class="oa-label">Newsletter</span>
            <span class="oa-value"><app-rolling-counter [value]="s.newsletter.confirmed" /></span>
            <span class="oa-sub">of {{ s.newsletter.total }} signed up</span>
          </div>
          @if (s.donations.count > 0) {
            <div class="oa-card oa-card--accent" data-testid="oa-donations">
              <span class="oa-label">Raised</span>
              <span class="oa-value"
                ><app-rolling-counter [value]="s.donations.raisedCents / 100" prefix="$" [decimals]="0"
              /></span>
              <span class="oa-sub">{{ s.donations.count }} gifts</span>
            </div>
          }
        </div>

        @if (s.traffic.topPaths.length) {
          <h2 class="text-[0.95rem] font-bold text-white mt-6 mb-2">Top pages</h2>
          <ul class="oa-paths">
            @for (p of s.traffic.topPaths.slice(0, 6); track p.path) {
              <li class="oa-path">
                <span class="oa-path-name">{{ p.path }}</span>
                <span class="oa-path-count">{{ p.count }}</span>
              </li>
            }
          </ul>
        }

        @if (s.traffic.byChannel.length) {
          <h2 class="text-[0.95rem] font-bold text-white mt-6 mb-2">Traffic by channel</h2>
          <ul class="oa-paths" data-testid="oa-channels">
            @for (ch of s.traffic.byChannel.slice(0, 6); track ch.label) {
              <li class="oa-path">
                <span class="oa-path-name oa-cap">{{ ch.label }}</span>
                <span class="oa-path-count">{{ ch.count }}</span>
              </li>
            }
          </ul>
        }

        @if (s.traffic.byDevice.length) {
          <h2 class="text-[0.95rem] font-bold text-white mt-6 mb-2">Devices</h2>
          <ul class="oa-paths" data-testid="oa-devices">
            @for (d of s.traffic.byDevice.slice(0, 6); track d.label) {
              <li class="oa-path">
                <span class="oa-path-name oa-cap">{{ d.label }}</span>
                <span class="oa-path-count">{{ d.count }}</span>
              </li>
            }
          </ul>
        }

        @if (s.contacts.bySource.length) {
          <h2 class="text-[0.95rem] font-bold text-white mt-6 mb-2">Where your contacts came from</h2>
          <ul class="oa-paths" data-testid="oa-contact-sources">
            @for (src of s.contacts.bySource.slice(0, 6); track src.source) {
              <li class="oa-path">
                <span class="oa-path-name">{{ src.source || 'Direct / unknown' }}</span>
                <span class="oa-path-count">{{ src.count }}</span>
              </li>
            }
          </ul>
        }
      } @else {
        <!-- 404 (flag dark) or empty — stay quiet; the tab is harmless until enabled. -->
        <p class="text-[0.82rem] text-text-secondary" data-testid="oa-unavailable">
          Visitor analytics aren't enabled for this site yet.
        </p>
      }

      <!-- AN11 — UTM builder always available; tagging links feeds the channel widget. -->
      <app-utm-builder />
    </div>
  `,
  styles: [
    `
      .oa-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 0.75rem;
      }
      .oa-card {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.9rem 1rem;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
        min-height: 84px;
      }
      .oa-card--accent {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
      }
      .oa-label {
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary, #9aa);
        font-weight: 700;
      }
      .oa-value {
        font-size: 1.6rem;
        font-weight: 800;
        color: #fff;
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
      .oa-sub {
        font-size: 0.7rem;
        color: var(--ps-accent, #00e5ff);
        font-weight: 600;
      }
      .oa-delta {
        font-size: 0.66rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .oa-delta[data-dir='up'] {
        color: #4ade80;
      }
      .oa-delta[data-dir='down'] {
        color: #ffb4b4;
      }
      .oa-delta[data-dir='flat'] {
        color: var(--text-secondary, #9aa);
      }
      .oa-skeleton {
        animation: oa-pulse 1.4s ease-in-out infinite;
      }
      @keyframes oa-pulse {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 0.7;
        }
      }
      .oa-paths {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      .oa-path {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.5rem 0.75rem;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.02);
        font-size: 0.82rem;
      }
      .oa-path-name {
        color: #d7d7ea;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .oa-cap {
        text-transform: capitalize;
      }
      .oa-path-count {
        color: var(--ps-accent, #00e5ff);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      @media (prefers-reduced-motion: reduce) {
        .oa-skeleton {
          animation: none;
        }
      }
    `,
  ],
})
export class OwnerAnalyticsComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly siteId = this.state.selectedSiteId;
  readonly summary = signal<SiteAnalyticsSummary | null>(null);
  readonly loading = signal(false);

  /** Conversion rate as a 1-dp percent of pageviews (caller guards pageviews > 0). */
  convRate(s: SiteAnalyticsSummary): string {
    if (s.traffic.pageviews <= 0) return '0%';
    return `${((s.traffic.conversions / s.traffic.pageviews) * 100).toFixed(1)}%`;
  }

  /**
   * Period-over-period delta (AN15). Returns a sign-prefixed percent + direction,
   * or `null` when there's no prior baseline (prev = 0) so we don't show a
   * meaningless "+100%". `dir` drives the colour + arrow.
   */
  delta(current: number, previous: number): { label: string; dir: 'up' | 'down' | 'flat' } | null {
    if (previous <= 0) return null;
    const pct = ((current - previous) / previous) * 100;
    const dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
    const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    return { label: `${arrow} ${Math.abs(pct).toFixed(0)}%`, dir };
  }

  constructor() {
    // Re-fetch whenever the operator switches sites. untracked() around the
    // imperative load so the effect only depends on selectedSiteId.
    effect(() => {
      const id = this.siteId();
      untracked(() => this.load(id));
    });
  }

  private load(id: string | null): void {
    this.summary.set(null);
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    // silent: a 404 here just means the `site_analytics` flag is dark — never toast it.
    this.api
      .get<{ data: SiteAnalyticsSummary }>(`/sites/${id}/analytics`, undefined, { silent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.summary.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: () => {
          this.summary.set(null);
          this.loading.set(false);
        },
      });
  }
}
