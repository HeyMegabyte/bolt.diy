import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';

/** One personalization signal set, mirrors the worker `PersonalizationSignals`. */
interface Conditions {
  geo?: string;
  device?: 'mobile' | 'tablet' | 'desktop';
  referrer?: string;
  hour?: number;
  isReturn?: boolean;
}

/** One variant rule, mirrors the worker list shape. */
interface VariantRule {
  id: string;
  name: string;
  conditions: Conditions;
  priority: number;
}

/** `GET /api/personalize/:siteId/variants` response. */
interface ListResponse {
  siteId: string;
  variants: VariantRule[];
  count: number;
}

/** `GET /api/personalize/:siteId/resolve` response. */
interface ResolveResponse {
  siteId: string;
  variantId: string;
  variantName: string;
}

/**
 * Edge personalization panel — the client for the `edge_personalization` feature.
 * Lists the SELECTED site's rules-based visitor variants (geo / device / referrer /
 * hour / return-visitor, no PII) and a live resolver that shows which variant a
 * visitor with a given signal set would see. Rendered on the Snapshots surface.
 *
 * @remarks
 * Reactively re-fetches when `AdminStateService.selectedSite()` changes. The API IS
 * the flag gate — `/variants` returns 404 when the feature is off → renders nothing.
 *
 * @example
 * <app-edge-personalization-panel />
 */
@Component({
  selector: 'app-edge-personalization-panel',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loaded()) {
      <section class="ep card" role="region" aria-labelledby="ep-heading" data-testid="personalization-panel">
        <header class="ep-head">
          <div>
            <h3 id="ep-heading" class="ep-title">Edge personalization</h3>
            <p class="ep-sub">Which hero/CTA a visitor sees — by geo, device, referrer, time. No PII stored.</p>
          </div>
          <span class="ep-count" data-testid="pv-count">{{ rules().length }} rule{{ rules().length === 1 ? '' : 's' }}</span>
        </header>

        @if (rules().length > 0) {
          <ul class="ep-list" data-testid="pv-list">
            @for (r of rules(); track r.id) {
              <li class="ep-rule" data-testid="pv-rule" [attr.data-variant]="r.name"
                  [class.ep-rule--active]="resolved()?.variantId === r.id">
                <div class="ep-rule-top">
                  <span class="ep-name" data-testid="pv-rule-name">{{ r.name }}</span>
                  @if (resolved()?.variantId === r.id) {
                    <span class="ep-active-chip" data-testid="pv-rule-active">active</span>
                  }
                  <span class="ep-prio" data-testid="pv-priority" [title]="'Priority ' + r.priority">P{{ r.priority }}</span>
                </div>
                <div class="ep-conds">
                  @for (c of condPairs(r.conditions); track c) {
                    <span class="ep-cond" data-testid="pv-cond">{{ c }}</span>
                  }
                  @if (condPairs(r.conditions).length === 0) {
                    <span class="ep-cond ep-cond--any" data-testid="pv-cond">any visitor</span>
                  }
                </div>
              </li>
            }
          </ul>
        } @else {
          <p class="ep-empty" data-testid="pv-empty">No personalization rules configured for this site yet.</p>
        }

        <div class="ep-resolver" data-testid="pv-resolver">
          <span class="ep-resolver-label">Preview a visitor</span>
          <div class="ep-controls">
            <label class="ep-ctl">
              <span class="ep-ctl-lbl">Device</span>
              <select [(ngModel)]="device" (ngModelChange)="resolve()" data-testid="pv-device-select" aria-label="Visitor device">
                <option value="">any</option>
                <option value="mobile">mobile</option>
                <option value="tablet">tablet</option>
                <option value="desktop">desktop</option>
              </select>
            </label>
            <label class="ep-ctl">
              <span class="ep-ctl-lbl">Geo</span>
              <input type="text" [(ngModel)]="geo" (ngModelChange)="resolve()" placeholder="US" maxlength="8"
                     data-testid="pv-geo-input" aria-label="Visitor geo" />
            </label>
            <label class="ep-ctl ep-ctl--check">
              <input type="checkbox" [(ngModel)]="isReturn" (ngModelChange)="resolve()" data-testid="pv-return-toggle" aria-label="Returning visitor" />
              <span class="ep-ctl-lbl">returning</span>
            </label>
          </div>
          <div class="ep-outcome">
            <span class="ep-outcome-lbl">Sees:</span>
            <span class="ep-outcome-val" data-testid="pv-resolved">{{ resolved()?.variantName || 'Default' }}</span>
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .ep { margin: 0 0 1.25rem; padding: 1.2rem 1.4rem; }
    .ep-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.9rem; }
    .ep-title { font-size: 1rem; font-weight: 700; margin: 0; color: var(--ps-ink, #f4f4ff); }
    .ep-sub { font-size: 0.72rem; color: rgba(255,255,255,0.5); margin: 0.2rem 0 0; }
    .ep-count { flex-shrink: 0; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
    .ep-list { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .ep-rule { padding: 0.6rem 0.75rem; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; background: rgba(255,255,255,0.015); min-width: 0; }
    .ep-rule--active { border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 45%, transparent); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 7%, transparent); }
    .ep-rule-top { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
    .ep-name { font-size: 0.86rem; font-weight: 700; color: var(--ps-ink, #f4f4ff); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ep-active-chip { flex-shrink: 0; font-size: 0.55rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #34d399; background: color-mix(in oklch, #34d399 16%, transparent); padding: 2px 7px; border-radius: 999px; }
    .ep-prio { flex-shrink: 0; font-size: 0.62rem; font-weight: 700; font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.4); }
    .ep-conds { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .ep-cond { font-size: 0.66rem; font-weight: 600; color: rgba(255,255,255,0.72); background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 6px; font-family: var(--ps-font-mono, ui-monospace, monospace); }
    .ep-cond--any { color: rgba(255,255,255,0.4); font-style: italic; font-family: inherit; }
    .ep-empty { font-size: 0.82rem; color: rgba(255,255,255,0.45); margin: 0 0 1rem; }
    .ep-resolver { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.9rem; }
    .ep-resolver-label { display: block; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.4); margin-bottom: 0.55rem; }
    .ep-controls { display: flex; flex-wrap: wrap; gap: 0.7rem; align-items: flex-end; }
    .ep-ctl { display: flex; flex-direction: column; gap: 0.2rem; }
    .ep-ctl--check { flex-direction: row; align-items: center; gap: 0.35rem; padding-bottom: 0.35rem; }
    .ep-ctl-lbl { font-size: 0.62rem; color: rgba(255,255,255,0.5); }
    .ep-ctl select, .ep-ctl input[type=text] { background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: var(--ps-ink, #f4f4ff); font-size: 0.78rem; padding: 0.3rem 0.5rem; min-width: 92px; }
    .ep-ctl input[type=checkbox] { accent-color: var(--ps-accent, #00e5ff); width: 15px; height: 15px; }
    .ep-outcome { margin-top: 0.75rem; display: flex; align-items: baseline; gap: 0.5rem; }
    .ep-outcome-lbl { font-size: 0.72rem; color: rgba(255,255,255,0.5); }
    .ep-outcome-val { font-size: 0.95rem; font-weight: 800; color: var(--ps-accent, #00e5ff); }
  `],
})
export class EdgePersonalizationPanelComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);

  private readonly rulesSig = signal<VariantRule[]>([]);
  private readonly seenList = signal(false);
  readonly resolved = signal<ResolveResponse | null>(null);

  readonly rules = computed(() => this.rulesSig());
  /** Show once the variant list loads (200 = flag on). */
  readonly loaded = computed(() => this.seenList());

  // Resolver controls — seeded from the real visitor on first load.
  device = this.detectDevice();
  geo = '';
  isReturn = false;

  private lastSiteId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.state.selectedSite()?.id;
      if (!id) {
        this.lastSiteId = null;
        this.seenList.set(false);
        this.rulesSig.set([]);
        this.resolved.set(null);
        return;
      }
      if (id === this.lastSiteId) return;
      this.lastSiteId = id;
      this.loadFor(id);
    });
  }

  private loadFor(siteId: string): void {
    this.api.get<ListResponse>(`/personalize/${siteId}/variants`, undefined, { silent: true }).subscribe({
      next: (res) => {
        this.rulesSig.set(Array.isArray(res?.variants) ? res.variants : []);
        this.seenList.set(true);
        this.resolve();
      },
      error: () => {
        this.seenList.set(false);
        this.rulesSig.set([]);
      },
    });
  }

  /** Re-resolve the preview variant from the current control values. */
  resolve(): void {
    const siteId = this.state.selectedSite()?.id;
    if (!siteId) return;
    const params: Record<string, string> = { hour: String(new Date().getHours()) };
    if (this.device) params['device'] = this.device;
    if (this.geo.trim()) params['geo'] = this.geo.trim();
    if (this.isReturn) params['isReturn'] = 'true';
    this.api.get<ResolveResponse>(`/personalize/${siteId}/resolve`, params, { silent: true }).subscribe({
      next: (res) => this.resolved.set(res && typeof res.variantName === 'string' ? res : null),
      error: () => this.resolved.set(null),
    });
  }

  /** Human-readable condition chips for a rule. */
  condPairs(c: Conditions): string[] {
    const out: string[] = [];
    if (c.device) out.push(`device=${c.device}`);
    if (c.geo) out.push(`geo=${c.geo}`);
    if (c.referrer) out.push(`ref~${c.referrer}`);
    if (typeof c.hour === 'number') out.push(`hour=${c.hour}`);
    if (c.isReturn !== undefined) out.push(`returning=${c.isReturn}`);
    return out;
  }

  /** Best-effort device class from the viewport (never sent as PII). */
  private detectDevice(): 'mobile' | 'tablet' | 'desktop' | '' {
    try {
      const w = window.innerWidth;
      if (w < 768) return 'mobile';
      if (w < 1024) return 'tablet';
      return 'desktop';
    } catch {
      return '';
    }
  }
}
