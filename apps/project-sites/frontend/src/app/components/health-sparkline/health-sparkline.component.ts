import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';

/** One day of traffic, mirrors the worker sparkline shape. */
interface SparkDay {
  date: string;
  visits: number;
}

/** `GET /api/sites/:id/sparkline` response. */
interface SparklineResponse {
  siteId: string;
  days: SparkDay[];
}

/**
 * Visits sparkline — the client for the `site_health_sparklines` feature. Draws
 * the selected site's last-7-day traffic trend as a compact SVG sparkline on the
 * Snapshots surface (beside the production-readiness panel).
 *
 * @remarks
 * Reactively re-fetches when `AdminStateService.selectedSite()` changes. The API
 * gate means it renders nothing when the feature is off, no site is selected, or
 * the site has no traffic days yet.
 *
 * @example
 * <app-health-sparkline />
 */
@Component({
  selector: 'app-health-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="hs" role="region" aria-labelledby="hs-heading" data-testid="health-sparkline">
        <div class="hs-head">
          <div>
            <p class="hs-eyebrow" id="hs-heading">Visits · last {{ days().length }} days</p>
            <p class="hs-total"><span data-testid="sparkline-total">{{ total() }}</span> <span class="hs-total-lbl">total visits</span></p>
          </div>
          <div class="hs-peak">
            <span class="hs-peak-num" data-testid="sparkline-peak">{{ peak() }}</span>
            <span class="hs-peak-lbl">peak/day</span>
          </div>
        </div>
        <svg class="hs-svg" [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" role="img" [attr.aria-label]="'Visits trend, ' + total() + ' total over ' + days().length + ' days'" data-testid="sparkline-svg">
          <polyline class="hs-line" [attr.points]="linePoints()" fill="none" />
          <polygon class="hs-area" [attr.points]="areaPoints()" />
          <circle class="hs-dot" [attr.cx]="lastPoint().x" [attr.cy]="lastPoint().y" r="3" />
        </svg>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .hs {
      margin: 0 0 1.25rem; padding: 1.1rem 1.3rem;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--ps-radius-xl, 22px);
      background: rgba(255,255,255,0.015);
    }
    .hs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.6rem; }
    .hs-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ps-accent, #00e5ff); margin: 0 0 0.2rem; }
    .hs-total { font-size: 1.15rem; font-weight: 800; margin: 0; color: var(--ps-ink, #f4f4ff); font-variant-numeric: tabular-nums; }
    .hs-total-lbl { font-size: 0.7rem; font-weight: 600; color: rgba(255,255,255,0.7); }
    .hs-peak { text-align: right; line-height: 1.1; }
    .hs-peak-num { display: block; font-size: 1rem; font-weight: 800; color: var(--ps-accent, #00e5ff); font-variant-numeric: tabular-nums; }
    .hs-peak-lbl { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.7); }
    .hs-svg { width: 100%; height: 56px; display: block; overflow: visible; }
    .hs-line { stroke: var(--ps-accent, #00e5ff); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
    .hs-area { fill: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .hs-dot { fill: var(--ps-accent, #00e5ff); }
  `],
})
export class HealthSparklineComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);

  readonly W = 300;
  readonly H = 56;

  private readonly data = signal<SparkDay[] | null>(null);
  private lastSiteId: string | null = null;

  readonly days = computed(() => this.data() ?? []);
  readonly total = computed(() => this.days().reduce((s, d) => s + d.visits, 0));
  readonly peak = computed(() => this.days().reduce((m, d) => Math.max(m, d.visits), 0));
  /** Only show when there is a real multi-point trend. */
  readonly visible = computed(() => this.days().length >= 2 && this.total() > 0);

  constructor() {
    effect(() => {
      const id = this.state.selectedSite()?.id;
      if (!id) {
        this.lastSiteId = null;
        this.data.set(null);
        return;
      }
      if (id === this.lastSiteId) return;
      this.lastSiteId = id;
      this.load(id);
    });
  }

  private load(siteId: string): void {
    this.api.get<SparklineResponse>(`/sites/${siteId}/sparkline`, { days: '7' }, { silent: true }).subscribe({
      next: (res) => this.data.set(Array.isArray(res?.days) ? res.days : []),
      error: () => this.data.set(null),
    });
  }

  /** Map each day to an {x,y} within the viewBox (y inverted; flat line when peak=0). */
  private points(): { x: number; y: number }[] {
    const d = this.days();
    const max = Math.max(1, this.peak());
    const n = d.length;
    return d.map((day, i) => ({
      x: n === 1 ? this.W / 2 : (i / (n - 1)) * this.W,
      y: this.H - 4 - (day.visits / max) * (this.H - 8),
    }));
  }

  linePoints(): string {
    return this.points().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  areaPoints(): string {
    const pts = this.points();
    if (pts.length === 0) return '';
    const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `0,${this.H} ${line} ${this.W},${this.H}`;
  }

  lastPoint(): { x: number; y: number } {
    const pts = this.points();
    return pts[pts.length - 1] ?? { x: 0, y: this.H };
  }
}
