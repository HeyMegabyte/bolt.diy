/**
 * /admin/feature-flags — flag registry browser + per-scope override editor.
 *
 * Reads from `GET /api/feature-flags` (always available; lists every flag in
 * registry with default state + stage). Per-flag detail at `/api/feature-flags/:key`
 * returns the resolved state including override source (registry / global /
 * org / tenant).
 *
 * UI shape:
 *   - Stage filter pills (all / experimental / beta / stable / deprecated / killswitch)
 *   - Search box (key OR description)
 *   - Cards per flag with: name, description, current state badge, stage chip,
 *     owner, default-enabled toggle, default-rollout slider, killswitch button.
 *
 * Mutations route through `POST /api/admin/feature-flags/:key/override` (admin
 * endpoint not shipped yet — UI surfaces "save" but warns when the endpoint
 * 404s). When the admin endpoint lands, the toggle will flip live.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HlmInputDirective, HlmTablistDirective } from '../../../ui';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

interface FlagDefinition {
  key: string;
  description: string;
  default_enabled: boolean;
  default_rollout_percent: number;
  stage: 'experimental' | 'beta' | 'stable' | 'deprecated' | 'killswitch';
  owner_email: string;
}

interface ResolvedFlag {
  enabled: boolean;
  rollout_percent: number;
  stage: string;
  source: 'registry' | 'global' | 'org' | 'tenant';
}

interface FlagDocs {
  explanation: string;
  smoke_test: string[];
  references?: string[];
}

type StageFilter = 'all' | FlagDefinition['stage'];

@Component({
  selector: 'app-admin-feature-flags',
  standalone: true,
  imports: [CommonModule, FormsModule, HlmInputDirective, HlmTablistDirective],
  template: `
    <section class="ff-page">
      <header class="ff-header">
        <div>
          <h1>Feature flags</h1>
          <p class="ff-sub">
            {{ flagCount() }} flags registered.
            Every new feature ships behind a flag.
            Default state: <code>enabled=false, rollout=0%, stage='experimental'</code>.
          </p>
        </div>
        <button class="ff-refresh" (click)="reload()" [disabled]="loading()">↻ Refresh</button>
      </header>

      <div class="ff-toolbar">
        <input
          hlmInput
          class="flex-1 min-w-[280px]"
          type="search"
          placeholder="Search by key or description…"
          [ngModel]="search()"
          (ngModelChange)="search.set($event)"
          aria-label="Search feature flags"
        />
        <div class="ff-stages" role="tablist" hlmTablist aria-label="Filter by stage">
          @for (s of stages; track s) {
            <button
              class="ff-stage-chip"
              [class.ff-stage-chip-active]="stage() === s"
              (click)="stage.set(s)"
              role="tab"
              [attr.aria-selected]="stage() === s"
            >
              {{ s }}
              <span class="ff-stage-count">{{ countForStage(s) }}</span>
            </button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="ff-state ff-state-loading">Loading flags from the worker…</div>
      } @else if (error()) {
        <div class="ff-state ff-state-error">
          Couldn't load flags: {{ error() }}
          <button (click)="reload()">Retry</button>
        </div>
      } @else if (filtered().length === 0) {
        <div class="ff-state ff-state-empty">No flags match the current filter.</div>
      } @else {
        <ul class="ff-grid">
          @for (flag of filtered(); track flag.key) {
            <li class="ff-card" [attr.data-stage]="flag.stage">
              <header class="ff-card-head">
                <h2 class="ff-key">{{ flag.key }}</h2>
                <span class="ff-stage" [attr.data-stage]="flag.stage">{{ flag.stage }}</span>
              </header>
              <p class="ff-desc">{{ flag.description }}</p>
              <div class="ff-state-row">
                <span class="ff-state-badge" [class.ff-state-on]="flag.default_enabled" [class.ff-state-off]="!flag.default_enabled">
                  {{ flag.default_enabled ? 'ON' : 'OFF' }}
                </span>
                <span class="ff-rollout">rollout: {{ flag.default_rollout_percent }}%</span>
              </div>
              <div class="ff-owner">Owner: {{ flag.owner_email }}</div>
              <div class="ff-actions">
                <button class="ff-btn ff-btn-primary" (click)="toggle(flag)" [attr.aria-label]="'Toggle ' + flag.key">
                  {{ flag.default_enabled ? 'Disable globally' : 'Enable globally' }}
                </button>
                <button class="ff-btn" (click)="openDetail(flag)">Inspect</button>
                @if (flag.stage !== 'killswitch') {
                  <button class="ff-btn ff-btn-danger" (click)="killswitch(flag)" title="Instant disable for all users — no redeploy">
                    Killswitch
                  </button>
                }
              </div>
              @if (detailKey() === flag.key) {
                @if (docsDetail(); as docs) {
                  <div class="ff-detail">
                    <h3>What this does</h3>
                    <p class="ff-explanation">{{ docs.explanation }}</p>

                    <h3>Smoke test</h3>
                    <ol class="ff-smoke">
                      @for (step of docs.smoke_test; track $index) {
                        <li>
                          <code class="ff-step">{{ step }}</code>
                        </li>
                      }
                    </ol>

                    @if (docs.references && docs.references.length) {
                      <h3>References</h3>
                      <ul class="ff-refs">
                        @for (ref of docs.references; track ref) {
                          <li><a [href]="ref" target="_blank" rel="noopener noreferrer">{{ ref }}</a></li>
                        }
                      </ul>
                    }
                  </div>
                }
                @if (resolvedDetail()) {
                  <div class="ff-detail">
                    <h3>Resolved state for this scope</h3>
                    <pre>{{ resolvedDetail() | json }}</pre>
                  </div>
                }
                <div class="ff-detail ff-controls">
                  <h3>Controls</h3>
                  <label class="ff-ctl">
                    <span class="ff-ctl-label">Rollout <strong>{{ flag.default_rollout_percent }}%</strong></span>
                    <input
                      type="range" min="0" max="100" step="5"
                      class="ff-range"
                      [value]="flag.default_rollout_percent"
                      (change)="setRollout(flag, $any($event.target).valueAsNumber)"
                      [attr.aria-label]="'Set rollout percent for ' + flag.key"
                      [attr.aria-valuetext]="flag.default_rollout_percent + ' percent'" />
                  </label>
                  <label class="ff-ctl">
                    <span class="ff-ctl-label">Promote stage</span>
                    <select
                      hlmInput
                      class="ff-stage-select"
                      [value]="flag.stage"
                      (change)="setStage(flag, $any($event.target).value)"
                      [attr.aria-label]="'Set stage for ' + flag.key">
                      @for (s of promotableStages; track s) {
                        <option [value]="s">{{ s }}</option>
                      }
                    </select>
                  </label>
                  <p class="ff-ctl-hint">experimental → beta (5-25%) → stable (100%). Mutations route through the override endpoint.</p>
                </div>
              }
            </li>
          }
        </ul>
      }

      <footer class="ff-footer">
        <p>
          Flag mutations route through <code>POST /api/admin/feature-flags/:key/override</code>.
          Promotion path: experimental → beta (5-25%) → stable (100%). Killswitch instantly disables for all users.
        </p>
      </footer>
    </section>
  `,
  styles: [`
    :host { display: block; padding: 1.5rem; max-width: 1280px; margin: 0 auto; }
    .ff-page { color: var(--ps-ink, #f4f4ff); }
    .ff-header { display: flex; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
    .ff-header h1 { font-size: clamp(1.5rem, 3vw, 2.25rem); margin: 0 0 .25rem; }
    .ff-sub { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); max-width: 60ch; }
    .ff-refresh { background: transparent; border: 1px solid color-mix(in oklch, currentColor 30%, transparent); color: inherit; padding: .5rem 1rem; border-radius: 8px; cursor: pointer; font: inherit; }
    .ff-refresh:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .ff-refresh:disabled { opacity: .5; cursor: not-allowed; }
    .ff-toolbar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
    /* .ff-search removed — now Spartan hlmInput (flex-1 min-w-[280px]). */
    .ff-stages { display: flex; gap: .375rem; flex-wrap: wrap; }
    .ff-stage-chip { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 18%, transparent); border-radius: 999px; padding: .375rem .75rem; cursor: pointer; font: inherit; font-size: .875rem; display: inline-flex; align-items: center; gap: .375rem; }
    .ff-stage-chip:hover { border-color: color-mix(in oklch, currentColor 40%, transparent); }
    .ff-stage-chip-active { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border-color: var(--ps-accent, #00e5ff); }
    .ff-stage-count { background: color-mix(in oklch, currentColor 18%, transparent); padding: .05rem .4rem; border-radius: 999px; font-size: .75rem; }
    .ff-stage-chip-active .ff-stage-count { background: color-mix(in oklch, currentColor 25%, transparent); }
    .ff-grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1rem; }
    .ff-card { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, currentColor 14%, transparent); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: .75rem; transition: border-color .15s ease, transform .15s ease; }
    .ff-card:hover { border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent); }
    .ff-card[data-stage="killswitch"] { border-color: #ff5555; }
    .ff-card[data-stage="stable"] { border-color: color-mix(in oklch, #4ade80 40%, transparent); }
    .ff-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
    .ff-key { font-family: var(--ps-mono, ui-monospace, monospace); font-size: 1rem; margin: 0; word-break: break-all; }
    .ff-stage { font-size: .7rem; padding: .25rem .6rem; border-radius: 999px; background: color-mix(in oklch, currentColor 14%, transparent); text-transform: uppercase; letter-spacing: .04em; }
    .ff-stage[data-stage="stable"] { background: color-mix(in oklch, #4ade80 30%, transparent); color: #052e16; }
    .ff-stage[data-stage="beta"] { background: color-mix(in oklch, #fbbf24 35%, transparent); color: #1c1917; }
    .ff-stage[data-stage="experimental"] { background: color-mix(in oklch, #a78bfa 28%, transparent); }
    .ff-stage[data-stage="killswitch"] { background: #ff5555; color: #fff; }
    .ff-desc { color: color-mix(in oklch, currentColor 70%, transparent); margin: 0; font-size: .9rem; line-height: 1.45; }
    .ff-state-row { display: flex; gap: 1rem; align-items: center; }
    .ff-state-badge { font-weight: 600; font-size: .8rem; padding: .15rem .5rem; border-radius: 6px; font-family: var(--ps-mono, ui-monospace, monospace); }
    .ff-state-on { background: #4ade80; color: #052e16; }
    .ff-state-off { background: color-mix(in oklch, currentColor 18%, transparent); }
    .ff-rollout { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .85rem; color: color-mix(in oklch, currentColor 65%, transparent); }
    .ff-owner { font-size: .75rem; color: color-mix(in oklch, currentColor 50%, transparent); }
    .ff-actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: auto; }
    .ff-btn { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 22%, transparent); padding: .4rem .75rem; border-radius: 8px; cursor: pointer; font: inherit; font-size: .85rem; }
    .ff-btn:hover { border-color: color-mix(in oklch, currentColor 50%, transparent); }
    .ff-btn-primary { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border-color: var(--ps-accent, #00e5ff); }
    .ff-btn-danger:hover { border-color: #ff5555; color: #ff5555; }
    .ff-detail { background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent); border-radius: 8px; padding: .85rem 1rem; margin-top: .5rem; }
    .ff-detail h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; margin: 1rem 0 .5rem; color: var(--ps-accent, #00e5ff); font-weight: 600; }
    .ff-detail h3:first-child { margin-top: 0; }
    .ff-detail pre { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .78rem; margin: 0; overflow: auto; }
    .ff-explanation { line-height: 1.55; margin: 0; color: color-mix(in oklch, currentColor 85%, transparent); font-size: .9rem; }
    .ff-smoke { padding-left: 1.25rem; margin: 0; display: flex; flex-direction: column; gap: .35rem; }
    .ff-smoke li { line-height: 1.45; font-size: .85rem; }
    .ff-step { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .82rem; background: color-mix(in oklch, currentColor 8%, transparent); padding: .15rem .4rem; border-radius: 4px; word-break: break-word; }
    .ff-refs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .25rem; }
    .ff-refs li { font-size: .8rem; }
    .ff-refs a { color: var(--ps-accent, #00e5ff); word-break: break-all; }
    .ff-controls { display: flex; flex-direction: column; gap: .75rem; }
    .ff-ctl { display: flex; flex-direction: column; gap: .35rem; }
    .ff-ctl-label { font-size: .8rem; color: color-mix(in oklch, currentColor 80%, transparent); }
    .ff-ctl-label strong { color: var(--ps-accent, #00e5ff); font-family: var(--ps-mono, ui-monospace, monospace); }
    .ff-range { width: 100%; max-width: 320px; accent-color: var(--ps-accent, #00e5ff); cursor: pointer; }
    .ff-range:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 4px; border-radius: 4px; }
    .ff-stage-select { max-width: 240px; text-transform: capitalize; }
    .ff-ctl-hint { font-size: .72rem; color: color-mix(in oklch, currentColor 50%, transparent); margin: 0; line-height: 1.4; }
    .ff-state { padding: 2rem; text-align: center; border: 1px dashed color-mix(in oklch, currentColor 20%, transparent); border-radius: 14px; }
    .ff-state-error { color: #ff8585; border-color: #ff5555; }
    .ff-state-error button { margin-left: 1rem; background: #ff5555; border: none; color: #fff; padding: .35rem .75rem; border-radius: 6px; cursor: pointer; font: inherit; }
    .ff-footer { margin-top: 2rem; color: color-mix(in oklch, currentColor 55%, transparent); font-size: .85rem; }
    .ff-footer code { font-family: var(--ps-mono, ui-monospace, monospace); }
    @media (prefers-reduced-motion: reduce) {
      .ff-card { transition: none; }
    }
  `],
})
export class AdminFeatureFlagsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly flagSvc = inject(FeatureFlagService);

  readonly stages: StageFilter[] = ['all', 'experimental', 'beta', 'stable', 'deprecated', 'killswitch'];
  /** Stages an operator can promote a flag to from the UI (killswitch has its own button). */
  readonly promotableStages: FlagDefinition['stage'][] = ['experimental', 'beta', 'stable', 'deprecated'];
  readonly stage = signal<StageFilter>('all');
  readonly search = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly flags = signal<FlagDefinition[]>([]);
  readonly detailKey = signal<string | null>(null);
  readonly resolvedDetail = signal<ResolvedFlag | null>(null);
  readonly docsDetail = signal<FlagDocs | null>(null);

  readonly flagCount = computed(() => this.flags().length);

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const s = this.stage();
    return this.flags().filter((f) => {
      if (s !== 'all' && f.stage !== s) return false;
      if (!q) return true;
      return f.key.toLowerCase().includes(q) || f.description.toLowerCase().includes(q);
    });
  });

  countForStage(s: StageFilter): number {
    if (s === 'all') return this.flags().length;
    return this.flags().filter((f) => f.stage === s).length;
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.http.get<{ flags: FlagDefinition[]; count: number }>('/api/feature-flags'));
      this.flags.set(res.flags ?? []);
    } catch (e) {
      this.error.set((e as Error).message ?? 'unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  async openDetail(flag: FlagDefinition): Promise<void> {
    if (this.detailKey() === flag.key) {
      this.detailKey.set(null);
      this.resolvedDetail.set(null);
      this.docsDetail.set(null);
      return;
    }
    this.detailKey.set(flag.key);
    this.docsDetail.set(null);
    try {
      const res = await firstValueFrom(
        this.http.get<{ definition: FlagDefinition; resolved: ResolvedFlag; docs: FlagDocs | null }>(`/api/feature-flags/${flag.key}`),
      );
      this.resolvedDetail.set(res.resolved);
      this.docsDetail.set(res.docs ?? null);
    } catch (e) {
      this.resolvedDetail.set({ enabled: flag.default_enabled, rollout_percent: flag.default_rollout_percent, stage: flag.stage, source: 'registry' });
    }
  }

  /**
   * Single mutation path for every flag override (toggle / rollout / stage /
   * killswitch). Optimistically patches local state, invalidates the client
   * flag cache so route guards + isOn() consumers re-resolve without a session
   * reload, and degrades to a non-blocking toast when the worker override route
   * isn't shipped yet.
   */
  private async applyOverride(
    flag: FlagDefinition,
    value: Record<string, unknown>,
    label: string,
    optimistic: (f: FlagDefinition) => FlagDefinition,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`/api/admin/feature-flags/${flag.key}/override`, {
          scope: 'global',
          scope_id: '*',
          value,
        }),
      );
      this.flags.update((flags) => flags.map((f) => (f.key === flag.key ? optimistic(f) : f)));
      this.flagSvc.invalidate(flag.key);
      this.toast.success(`${flag.key}: ${label}`);
    } catch (e) {
      // Admin override endpoint not shipped yet — surface a non-blocking cockpit toast.
      const status = (e as { status?: number }).status ?? 'error';
      this.toast.warning(`Override not saved — POST /api/admin/feature-flags/${flag.key}/override returned ${status}. Worker route ships next deploy.`, 7000);
    }
  }

  async toggle(flag: FlagDefinition): Promise<void> {
    const next = !flag.default_enabled;
    return this.applyOverride(
      flag,
      { enabled: next, rollout_percent: next ? 100 : 0 },
      next ? 'enabled globally' : 'disabled globally',
      (f) => ({ ...f, default_enabled: next, default_rollout_percent: next ? 100 : 0 }),
    );
  }

  /** Set a gradual rollout percentage (0 disables, >0 enables). */
  async setRollout(flag: FlagDefinition, pct: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    return this.applyOverride(
      flag,
      { enabled: clamped > 0, rollout_percent: clamped },
      `rollout → ${clamped}%`,
      (f) => ({ ...f, default_rollout_percent: clamped, default_enabled: clamped > 0 }),
    );
  }

  /** Promote (or demote) a flag's lifecycle stage. */
  async setStage(flag: FlagDefinition, stage: string): Promise<void> {
    const next = stage as FlagDefinition['stage'];
    if (next === flag.stage) return;
    return this.applyOverride(
      flag,
      { stage: next },
      `stage → ${next}`,
      (f) => ({ ...f, stage: next }),
    );
  }

  async killswitch(flag: FlagDefinition): Promise<void> {
    if (!confirm(`Instant kill ${flag.key} for ALL users?\n\nThis flips the flag off everywhere + moves it to the killswitch stage with no redeploy. Re-enable from this page.`)) return;
    return this.applyOverride(
      flag,
      { enabled: false, rollout_percent: 0, stage: 'killswitch' },
      'KILLSWITCH — disabled for all users',
      (f) => ({ ...f, default_enabled: false, default_rollout_percent: 0, stage: 'killswitch' }),
    );
  }
}
