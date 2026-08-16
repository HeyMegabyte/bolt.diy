import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';

/** One readiness check, mirrors the worker readiness shape. */
interface ReadinessCheck {
  name: string;
  pass: boolean;
  weight: number;
  hint: string;
}

/** `GET /api/sites/:id/readiness` response. */
interface ReadinessResponse {
  score: number;
  grade: string;
  checks: ReadinessCheck[];
}

/**
 * Production-readiness panel — the client for the `prod_readiness_score` feature.
 * Grades the SELECTED site (A–F) from weighted checks (published / custom domain /
 * performance / sitemap) and surfaces the actionable next fixes on the Snapshots
 * surface.
 *
 * @remarks
 * Reactively re-fetches when `AdminStateService.selectedSite()` changes. The API
 * gate means it renders nothing when the feature is off or no site is selected.
 *
 * @example
 * <app-readiness-panel />
 */
@Component({
  selector: 'app-readiness-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as r) {
      <section class="rp" role="region" aria-labelledby="rp-heading" data-testid="readiness-panel">
        <div class="rp-grade" [class]="'rp-grade--' + tone(r.grade)" data-testid="readiness-grade" [attr.aria-label]="'Readiness grade ' + r.grade">
          {{ r.grade }}
        </div>
        <div class="rp-body">
          <header class="rp-head">
            <h2 id="rp-heading" class="rp-title">Production readiness</h2>
            <span class="rp-score" data-testid="readiness-score">{{ r.score }}<span class="rp-score-den">/100</span></span>
          </header>
          @if (openChecks().length > 0) {
            <p class="rp-lead">{{ openChecks().length }} thing{{ openChecks().length === 1 ? '' : 's' }} left to make this site production-ready:</p>
            <ul class="rp-list">
              @for (c of openChecks(); track c.name) {
                <li class="rp-item" [attr.data-testid]="'readiness-check-' + c.name">
                  <span class="rp-x" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </span>
                  <span class="rp-hint">{{ c.hint }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="rp-lead rp-lead--done" data-testid="readiness-all-clear">✓ This site passes every readiness check.</p>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .rp {
      display: flex; gap: 1.1rem; align-items: flex-start;
      margin: 0 0 1.25rem; padding: 1.2rem 1.4rem;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--ps-radius-xl, 22px);
      background: rgba(255,255,255,0.015);
    }
    .rp-grade {
      flex-shrink: 0; width: 62px; height: 62px; border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem; font-weight: 800; line-height: 1;
    }
    .rp-grade--ok { color: #34d399; background: color-mix(in oklch, #34d399 14%, transparent); border: 1px solid color-mix(in oklch, #34d399 30%, transparent); }
    .rp-grade--warn { color: #fbbf24; background: color-mix(in oklch, #fbbf24 14%, transparent); border: 1px solid color-mix(in oklch, #fbbf24 30%, transparent); }
    .rp-grade--danger { color: #f87171; background: color-mix(in oklch, #f87171 14%, transparent); border: 1px solid color-mix(in oklch, #f87171 30%, transparent); }
    .rp-body { flex: 1; min-width: 0; }
    .rp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; }
    .rp-title { font-size: 1rem; font-weight: 700; margin: 0; color: var(--ps-ink, #f4f4ff); }
    .rp-score { font-size: 1rem; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ps-ink, #f4f4ff); }
    .rp-score-den { font-size: 0.75rem; color: rgba(255,255,255,0.7); font-weight: 600; }
    .rp-lead { font-size: 0.84rem; color: rgba(255,255,255,0.62); margin: 0 0 0.7rem; }
    .rp-lead--done { color: #34d399; }
    .rp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
    .rp-item { display: flex; align-items: flex-start; gap: 0.6rem; min-width: 0; }
    .rp-x { flex-shrink: 0; width: 18px; height: 18px; color: #f87171; margin-top: 0.1rem; }
    .rp-x svg { width: 100%; height: 100%; }
    .rp-hint { font-size: 0.82rem; color: rgba(255,255,255,0.78); }
  `],
})
export class ReadinessPanelComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);

  readonly data = signal<ReadinessResponse | null>(null);
  private lastSiteId: string | null = null;

  /** Only the failing checks — the actionable "what to fix" list. */
  readonly openChecks = computed(() => (this.data()?.checks ?? []).filter((c) => !c.pass));

  constructor() {
    // Reactively (re)load whenever the selected site changes.
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
    // `silent: true` — a 404 (flag off) is expected, never a user-facing toast.
    this.api.get<ReadinessResponse>(`/sites/${siteId}/readiness`, undefined, { silent: true }).subscribe({
      next: (res) => this.data.set(res && typeof res.grade === 'string' ? res : null),
      error: () => this.data.set(null),
    });
  }

  /** Colour tone for a letter grade. */
  tone(grade: string): 'ok' | 'warn' | 'danger' {
    const g = (grade || '').toUpperCase();
    if (g === 'A' || g === 'B') return 'ok';
    if (g === 'C') return 'warn';
    return 'danger';
  }
}
