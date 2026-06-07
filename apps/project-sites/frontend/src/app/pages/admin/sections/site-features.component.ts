/**
 * /admin/site-features — LAYER 2 of the two-layer feature-flag control plane:
 * the **Features** (owner-facing) surface. SITE/tenant-scoped features a site
 * owner enables for THEIR hosted site (e.g. when projectsites hosts
 * megabyte.space, the owner turns on Online Booking for that site).
 *
 * Owner-friendly + plan-aware: simple cards + a one-line "why", an
 * enabled/disabled toggle, entitlement-locked states (upgrade / add-on) that
 * never expose a broken toggle, a preview mode, undo, and a per-site change
 * timeline. NOT the operator's platform flag console — that's Layer 1 at
 * `/admin/feature-flags`.
 *
 * Progressive disclosure (persisted in `localStorage['ff.mode.features']`):
 *   - Simple   — beautiful cards + toggle + reason.
 *   - Advanced — preview controls + per-feature detail.
 *   - Expert   — raw feature key + entitlement reasoning + per-site timeline.
 *
 * Data: `GET /api/site-features` (catalog + entitlement + state) and
 * `POST /api/site-features/:key` (owner enable/disable, entitlement-checked
 * server-side, tenant-isolated).
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HlmInputDirective } from '../../../ui';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { SkeletonComponent, EmptyStateComponent, ErrorCardComponent } from '../../../components/states';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { FlagModeSwitcherComponent, type DisclosureMode } from './feature-flags/mode-switcher.component';
import { FlagBadgeRowComponent, type FlagBadge } from './feature-flags/badge-row.component';
import { type EntitlementState, type PlanTier } from './feature-flags/flag-logic';
import { firstValueFrom } from 'rxjs';

interface SiteFeature {
  key: string;
  name: string;
  description: string;
  requiredPlan: PlanTier;
  isAddon: boolean;
  category: string;
  entitled: EntitlementState;
  enabled: boolean;
  preview: boolean;
}

@Component({
  selector: 'app-admin-site-features',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, RevealDirective, HlmInputDirective,
    SkeletonComponent, EmptyStateComponent, ErrorCardComponent, RollingCounterComponent,
    FlagModeSwitcherComponent, FlagBadgeRowComponent,
  ],
  template: `
    <section class="sf-page" appReveal>
      <header class="sf-header">
        <div class="sf-head-left">
          <p class="sf-kicker">Control plane · Layer 2</p>
          <h1 data-testid="sf-layer-heading">Features</h1>
          <p class="sf-sub">
            Turn capabilities on for <strong>{{ siteName() }}</strong>.
            <strong><app-rolling-counter [value]="enabledCount()" /></strong> enabled ·
            <strong><app-rolling-counter [value]="availableCount()" /></strong> available on your {{ plan() }} plan.
            Platform operators manage system flags under
            <a routerLink="/admin/feature-flags" data-testid="sf-nav-system" class="sf-cross-link">System Administrator →</a>.
          </p>
        </div>
        <div class="sf-head-right">
          <app-flag-mode-switcher [mode]="mode()" (modeChange)="setMode($event)" label="Disclosure mode (Features)" />
          <button class="sf-refresh" (click)="reload()" [disabled]="loading()" aria-label="Refresh features">↻ Refresh</button>
        </div>
      </header>

      <div class="sf-toolbar">
        <input
          hlmInput
          class="flex-1 min-w-0 basis-[240px]"
          type="search"
          placeholder="Search features…"
          [ngModel]="search()"
          (ngModelChange)="search.set($event)"
          aria-label="Search site features"
        />
        <span class="sr-only" role="status" aria-live="polite">{{ filterAnnouncement() }}</span>
      </div>

      @if (loading()) {
        <app-skeleton variant="card" [rows]="6" label="Loading your site features…" />
      } @else if (error()) {
        <app-error-card
          title="Couldn't load features"
          [message]="error()!"
          hint="The owner feature catalog lives behind GET /api/site-features. Retry, or check you're signed in."
          (retry)="reload()" />
      } @else if (features().length === 0) {
        <app-empty-state icon="✨" title="No features yet" message="Site features appear here once your plan is active." />
      } @else if (filtered().length === 0) {
        <app-empty-state icon="⊘" title="No features match your search"
          [message]="'Nothing matches “' + search() + '”.'" ctaLabel="Clear search" (ctaClick)="search.set('')" />
      } @else {
        <ul class="sf-grid">
          @for (f of filtered(); track f.key) {
            <li class="sf-card" [attr.data-entitled]="f.entitled" [class.sf-card-on]="f.enabled" [attr.data-testid]="'sf-card-' + f.key">
              <header class="sf-card-head">
                <div class="sf-card-title">
                  <h2>{{ f.name }}</h2>
                  <span class="sf-cat">{{ f.category }}</span>
                </div>
                @if (f.entitled === 'available') {
                  <button type="button" class="sf-switch" role="switch" data-testid="sf-toggle"
                          [class.sf-switch-on]="f.enabled" [attr.aria-checked]="f.enabled"
                          [attr.aria-label]="(f.enabled ? 'Disable ' : 'Enable ') + f.name"
                          [disabled]="busy()[f.key]" (click)="toggle(f)">
                    <span class="sf-switch-knob"></span>
                  </button>
                }
              </header>

              <app-flag-badge-row [badges]="badgesFor(f)" />
              <p class="sf-desc">{{ f.description }}</p>
              <p class="sf-why" data-testid="sf-why">{{ whyFor(f) }}</p>

              @if (f.entitled === 'available') {
                <div class="sf-actions">
                  <button type="button" class="sf-btn" data-testid="sf-preview" (click)="togglePreview(f)"
                          [attr.aria-pressed]="previewKey() === f.key">
                    {{ previewKey() === f.key ? 'Hide preview' : 'Preview' }}
                  </button>
                </div>
                @if (previewKey() === f.key) {
                  <div class="sf-preview-panel" data-testid="sf-preview-panel">
                    <h3>Preview</h3>
                    <p>Here's what visitors get with <strong>{{ f.name }}</strong>:</p>
                    <p class="sf-preview-copy">{{ f.description }} You can enable it now and turn it off anytime — your live site updates instantly.</p>
                  </div>
                }
              } @else {
                <div class="sf-locked" data-testid="sf-locked">
                  <p class="sf-locked-msg">
                    @if (f.entitled === 'addon-required') {
                      Available as an add-on — enable it to unlock <strong>{{ f.name }}</strong>.
                    } @else {
                      Included on the <strong>{{ f.requiredPlan }}</strong> plan and above.
                    }
                  </p>
                  <a class="sf-locked-cta" data-testid="sf-locked-cta" routerLink="/admin/billing"
                     [attr.aria-label]="(f.entitled === 'addon-required' ? 'Add ' : 'Upgrade to unlock ') + f.name">
                    {{ f.entitled === 'addon-required' ? 'Add this feature' : 'Upgrade plan' }} →
                  </a>
                </div>
              }

              @if (mode() === 'expert') {
                <div class="sf-expert" data-testid="sf-expert">
                  <h3>Details</h3>
                  <p><span class="sf-meta-label">Feature key:</span> <code>{{ f.key }}</code></p>
                  <p><span class="sf-meta-label">Entitlement:</span> {{ entitlementLabel(f) }}</p>
                  <p><span class="sf-meta-label">Requires plan:</span> {{ f.requiredPlan }}{{ f.isAddon ? ' (or add-on)' : '' }}</p>
                  @if (changesFor(f.key); as changes) {
                    @if (changes.length > 0) {
                      <div class="sf-timeline" data-testid="sf-timeline">
                        <span class="sf-meta-label">Timeline · this session</span>
                        <ul class="sf-timeline-list">
                          @for (ch of changes; track ch.at) {
                            <li class="sf-timeline-row">
                              <span class="sf-tl-dot" [class.sf-tl-dot--on]="ch.enabled" aria-hidden="true"></span>
                              <span class="sf-tl-state">{{ ch.enabled ? 'Enabled' : 'Disabled' }}</span>
                              <span class="sf-tl-at">{{ ch.at | date: 'shortTime' }}</span>
                            </li>
                          }
                        </ul>
                      </div>
                    }
                  }
                </div>
              }
            </li>
          }
        </ul>
      }

      @if (lastChange(); as lc) {
        <div class="sf-undo-bar" role="status" data-testid="sf-undo">
          <span>{{ lc.name }} {{ lc.enabled ? 'enabled' : 'disabled' }}.</span>
          <button type="button" class="sf-undo-btn" (click)="undo()" [disabled]="busy()[lc.key]">Undo</button>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; box-sizing: border-box; width: 100%; min-width: 0; padding: 1.5rem; max-width: 1280px; margin: 0 auto; }
    .sf-page { color: var(--ps-ink, #f4f4ff); }
    .sf-header { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
    .sf-head-left { min-width: 0; }
    .sf-head-right { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
    .sf-kicker { margin: 0 0 .25rem; font: 700 0.62rem/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00e5ff); opacity: 0.85; }
    .sf-header h1 { font-size: clamp(1.5rem, 3vw, 2.25rem); margin: 0 0 .25rem; }
    .sf-sub { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); max-width: 66ch; }
    .sf-sub strong { color: var(--ps-accent, #00e5ff); }
    .sf-cross-link { color: var(--ps-accent, #00e5ff); }
    .sf-cross-link:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; border-radius: 4px; }
    .sf-refresh { background: transparent; border: 1px solid color-mix(in oklch, currentColor 30%, transparent); color: inherit; padding: .5rem 1rem; border-radius: 8px; cursor: pointer; font: inherit; min-height: 24px; }
    .sf-refresh:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .sf-refresh:disabled { opacity: .5; cursor: not-allowed; }
    .sf-refresh:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .sf-toolbar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .sf-grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 1rem; }
    .sf-card { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, currentColor 14%, transparent); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: .65rem; transition: border-color .15s ease; }
    .sf-card:hover { border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 28%, transparent); }
    .sf-card-on { border-color: color-mix(in oklch, #4ade80 38%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklch, #4ade80 16%, transparent); }
    .sf-card[data-entitled="upgrade-required"], .sf-card[data-entitled="addon-required"] { opacity: .92; }
    .sf-card-head { display: flex; align-items: start; justify-content: space-between; gap: .75rem; }
    .sf-card-title h2 { margin: 0; font-size: 1.1rem; }
    .sf-cat { font-size: .66rem; text-transform: uppercase; letter-spacing: .05em; color: color-mix(in oklch, var(--ps-accent, #00e5ff) 75%, var(--ps-ink, #f4f4ff)); }
    .sf-switch { flex: none; width: 46px; height: 26px; border-radius: 999px; border: 1px solid color-mix(in oklch, currentColor 25%, transparent); background: color-mix(in oklch, currentColor 12%, transparent); position: relative; cursor: pointer; padding: 0; transition: background .15s ease, border-color .15s ease; }
    .sf-switch-knob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in oklch, currentColor 70%, transparent); transition: transform .15s ease, background .15s ease; }
    .sf-switch-on { background: var(--ps-accent, #00e5ff); border-color: var(--ps-accent, #00e5ff); }
    .sf-switch-on .sf-switch-knob { transform: translateX(20px); background: var(--ps-bg, #060610); }
    .sf-switch:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .sf-switch:disabled { opacity: .5; cursor: progress; }
    .sf-desc { color: color-mix(in oklch, currentColor 72%, transparent); margin: 0; font-size: .9rem; line-height: 1.45; }
    .sf-why { color: color-mix(in oklch, currentColor 56%, transparent); margin: 0; font-size: .8rem; font-style: italic; }
    .sf-actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: auto; }
    .sf-btn { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 22%, transparent); padding: .35rem .75rem; border-radius: 8px; cursor: pointer; font: inherit; font-size: .82rem; min-height: 24px; }
    .sf-btn:hover { border-color: var(--ps-accent, #00e5ff); color: var(--ps-accent, #00e5ff); }
    .sf-btn:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .sf-preview-panel { background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent); border-radius: 8px; padding: .85rem 1rem; }
    .sf-preview-panel h3 { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 .5rem; color: var(--ps-accent, #00e5ff); }
    .sf-preview-panel p { margin: 0 0 .4rem; font-size: .85rem; line-height: 1.45; }
    .sf-preview-copy { color: color-mix(in oklch, currentColor 75%, transparent); }
    .sf-locked { margin-top: auto; padding: .75rem .9rem; border-radius: 10px; border: 1px dashed color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 5%, transparent); }
    .sf-locked-msg { margin: 0 0 .5rem; font-size: .82rem; color: color-mix(in oklch, currentColor 78%, transparent); }
    .sf-locked-cta { font-size: .85rem; font-weight: 600; color: var(--ps-accent, #00e5ff); }
    .sf-locked-cta:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; border-radius: 4px; }
    .sf-expert { background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent); border-radius: 8px; padding: .75rem 1rem; }
    .sf-expert h3 { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 .5rem; color: var(--ps-accent, #00e5ff); }
    .sf-expert p { margin: 0 0 .35rem; font-size: .82rem; }
    .sf-expert code { font-family: var(--ps-mono, ui-monospace, monospace); color: var(--ps-accent, #00e5ff); }
    .sf-meta-label { color: color-mix(in oklch, currentColor 55%, transparent); }
    .sf-timeline { margin-top: .6rem; padding-top: .5rem; border-top: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent); }
    .sf-timeline-list { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
    .sf-timeline-row { display: flex; align-items: center; gap: .5rem; font-size: .78rem; }
    .sf-tl-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 35%, transparent); }
    .sf-tl-dot--on { background: var(--ps-accent, #00e5ff); box-shadow: 0 0 5px color-mix(in oklch, var(--ps-accent, #00e5ff) 60%, transparent); }
    .sf-tl-state { color: var(--ps-ink, #f4f4ff); }
    .sf-tl-at { margin-left: auto; font-variant-numeric: tabular-nums; color: color-mix(in oklch, currentColor 50%, transparent); }
    .sf-undo-bar { position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%); z-index: var(--ps-z-overlay-takeover, 100000);
      display: flex; gap: 1rem; align-items: center; padding: .65rem 1.1rem; border-radius: 999px;
      background: color-mix(in oklch, var(--ps-bg, #060610) 94%, var(--ps-accent, #00e5ff) 6%);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent); box-shadow: var(--ps-shadow-modal, 0 16px 40px rgba(0,0,0,.5)); font-size: .85rem; }
    .sf-undo-btn { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; border-radius: 999px; padding: .3rem .85rem; font: inherit; font-weight: 600; cursor: pointer; min-height: 24px; }
    .sf-undo-btn:hover { filter: brightness(1.08); }
    .sf-undo-btn:focus-visible { outline: 2px solid var(--ps-ink, #f4f4ff); outline-offset: 2px; }
    .sf-undo-btn:disabled { opacity: .5; cursor: progress; }
    @media (prefers-reduced-motion: reduce) {
      .sf-card, .sf-switch, .sf-switch-knob { transition: none; }
    }
  `],
})
export class AdminSiteFeaturesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly state = inject(AdminStateService);

  private static readonly MODE_KEY = 'ff.mode.features';

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly features = signal<SiteFeature[]>([]);
  readonly plan = signal<PlanTier>('free');
  readonly search = signal('');
  readonly busy = signal<Record<string, boolean>>({});
  readonly previewKey = signal<string | null>(null);
  readonly mode = signal<DisclosureMode>(this.readMode());
  /** Last toggle, for the undo bar. */
  readonly lastChange = signal<{ key: string; name: string; enabled: boolean } | null>(null);
  /**
   * Per-feature session change log (newest first, capped) — the honest,
   * frontend-feasible "per-site timeline": what the owner changed in THIS
   * session. A durable cross-session audit history needs the worker's
   * `/site-features/:key/history` feed (separate wave); this never claims to be
   * more than the current session, so it's not a fake-data leak.
   */
  readonly changeLog = signal<ReadonlyArray<{ key: string; enabled: boolean; at: number }>>([]);

  /** This session's changes for one feature, newest first. */
  changesFor(key: string): ReadonlyArray<{ enabled: boolean; at: number }> {
    return this.changeLog().filter((c) => c.key === key);
  }

  readonly siteName = computed(() => this.state.selectedSite()?.business_name ?? 'your site');
  readonly enabledCount = computed(() => this.features().filter((f) => f.enabled).length);
  readonly availableCount = computed(() => this.features().filter((f) => f.entitled === 'available').length);

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.features();
    return this.features().filter((f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.key.toLowerCase().includes(q));
  });

  readonly filterAnnouncement = computed(() => {
    const n = this.filtered().length;
    return `Showing ${n} feature${n === 1 ? '' : 's'}`;
  });

  private readMode(): DisclosureMode {
    try {
      const v = localStorage.getItem(AdminSiteFeaturesComponent.MODE_KEY);
      return v === 'advanced' || v === 'expert' ? v : 'simple';
    } catch {
      return 'simple';
    }
  }

  setMode(m: DisclosureMode): void {
    this.mode.set(m);
    try { localStorage.setItem(AdminSiteFeaturesComponent.MODE_KEY, m); } catch { /* private mode */ }
  }

  badgesFor(f: SiteFeature): FlagBadge[] {
    const badges: FlagBadge[] = [
      { label: f.enabled ? 'Enabled' : 'Off', tone: f.enabled ? 'on' : 'off', title: `${f.name} is ${f.enabled ? 'enabled' : 'off'} on this site` },
    ];
    if (f.entitled === 'available') badges.push({ label: 'Included', tone: 'scope', title: `Included on your ${this.plan()} plan` });
    else if (f.entitled === 'addon-required') badges.push({ label: 'Add-on', tone: 'warn', title: 'Available as an add-on' });
    else badges.push({ label: `${f.requiredPlan}+`, tone: 'warn', title: `Requires the ${f.requiredPlan} plan` });
    return badges;
  }

  whyFor(f: SiteFeature): string {
    if (f.entitled !== 'available') {
      return f.entitled === 'addon-required'
        ? 'Locked — add this feature to your plan to use it.'
        : `Locked — included on the ${f.requiredPlan} plan and above.`;
    }
    if (f.enabled) return f.preview ? 'On + in preview mode for you only.' : 'On — live on your site for every visitor.';
    return 'Off — flip the switch to turn it on. You can undo anytime.';
  }

  entitlementLabel(f: SiteFeature): string {
    switch (f.entitled) {
      case 'available': return 'Available on your plan';
      case 'addon-required': return 'Requires an add-on';
      default: return `Requires the ${f.requiredPlan} plan`;
    }
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private get siteQuery(): string {
    const id = this.state.selectedSite()?.id;
    return id ? `?site_id=${encodeURIComponent(id)}` : '';
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.api.get<{ features: SiteFeature[]; plan: PlanTier }>(`/site-features${this.siteQuery}`),
      );
      this.features.set(res.features ?? []);
      this.plan.set(res.plan ?? 'free');
    } catch (e) {
      this.error.set((e as Error).message ?? 'unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  togglePreview(f: SiteFeature): void {
    this.previewKey.set(this.previewKey() === f.key ? null : f.key);
  }

  async toggle(f: SiteFeature): Promise<void> {
    if (f.entitled !== 'available' || this.busy()[f.key]) return;
    await this.setEnabled(f, !f.enabled);
  }

  private async setEnabled(f: SiteFeature, next: boolean): Promise<void> {
    const siteId = this.state.selectedSite()?.id;
    if (!siteId) {
      this.toast.error('Select a site first to manage its features.');
      return;
    }
    const before = this.features();
    // Optimistic flip.
    this.features.update((list) => list.map((x) => (x.key === f.key ? { ...x, enabled: next } : x)));
    this.busy.update((b) => ({ ...b, [f.key]: true }));
    try {
      await firstValueFrom(
        this.api.post(`/site-features/${encodeURIComponent(f.key)}`, { site_id: siteId, enabled: next, preview: f.preview }, { silent: true }),
      );
      this.toast.success(`${f.name} ${next ? 'enabled' : 'disabled'}.`);
      this.lastChange.set({ key: f.key, name: f.name, enabled: next });
      this.changeLog.update((log) => [{ key: f.key, enabled: next, at: Date.now() }, ...log].slice(0, 50));
    } catch (e) {
      this.features.set(before);
      const status = (e as { status?: number }).status ?? 'error';
      const hint = status === 403 ? ' — your plan doesn’t include this yet.' : '';
      this.toast.error(`Couldn't update ${f.name} (HTTP ${status}${hint}). Reverted.`, 7000);
    } finally {
      this.busy.update((b) => ({ ...b, [f.key]: false }));
    }
  }

  async undo(): Promise<void> {
    const lc = this.lastChange();
    if (!lc) return;
    const f = this.features().find((x) => x.key === lc.key);
    if (!f) return;
    this.lastChange.set(null);
    await this.setEnabled(f, !lc.enabled);
  }
}
