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
 * Mutations route through `POST /api/super-admin/feature-flags` (super-admin
 * guarded) — the worker upserts feature_flags(enabled_globally, rollout_pct,
 * kill_switch). `stage` is registry/code-managed (no column) so non-killswitch
 * stage changes are optimistic-only. (Prior wiring hit a non-existent /override
 * path that 404'd; fixed round 141.)
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HlmInputDirective, HlmTablistDirective } from '../../../ui';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
import { AdminStateService } from '../admin-state.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';
import { SkeletonComponent, EmptyStateComponent, ErrorCardComponent } from '../../../components/states';

interface FlagDefinition {
  key: string;
  description: string;
  default_enabled: boolean;
  default_rollout_percent: number;
  stage: 'experimental' | 'beta' | 'stable' | 'deprecated' | 'killswitch';
  owner_email: string;
  /** Worker-resolved hard kill switch (feature_flags.kill_switch). When true the
      flag is off for everyone regardless of enabled/rollout. */
  kill_switch?: boolean;
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
  // Playwright spec paths that gate the feature (the operator runbook's
  // automated-coverage arm, per the feature-flags rule). The worker returns
  // this for flags whose specs are wired; absent/empty → block hidden.
  e2e_tests?: string[];
  references?: string[];
}

type StageFilter = 'all' | FlagDefinition['stage'];

@Component({
  selector: 'app-admin-feature-flags',
  standalone: true,
  imports: [CommonModule, FormsModule, HlmInputDirective, HlmTablistDirective, SkeletonComponent, EmptyStateComponent, ErrorCardComponent],
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

      @if (blockedFeature(); as key) {
        <div class="ff-blocked" role="status" data-testid="ff-blocked-banner">
          <span class="ff-blocked-icon" aria-hidden="true">🔒</span>
          <span class="ff-blocked-text">
            The <code>{{ key }}</code> feature is currently <strong>disabled</strong>, so that page isn't available yet. Enable it below to access it.
          </span>
          <button type="button" class="ff-blocked-dismiss" (click)="dismissBlockedBanner()" aria-label="Dismiss">✕</button>
        </div>
      }

      <div class="ff-toolbar">
        <input
          hlmInput
          class="flex-1 min-w-0 basis-[240px]"
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
        <app-skeleton variant="card" [rows]="6" label="Loading flags from the worker…" />
      } @else if (error()) {
        <app-error-card
          title="Couldn't load feature flags"
          [message]="error()!"
          hint="The flag registry lives behind GET /api/feature-flags. Retry, or check you're signed in as a super-admin."
          (retry)="reload()" />
      } @else if (flags().length === 0) {
        <app-empty-state
          icon="⚑"
          title="No feature flags registered"
          message="Every new feature ships behind a flag (enabled=false, rollout=0%, stage='experimental'). Flags appear here once seeded in the worker registry." />
      } @else if (filtered().length === 0) {
        <app-empty-state
          icon="⊘"
          title="No flags match this filter"
          [message]="emptyFilterHint()"
          ctaLabel="Clear filters"
          (ctaClick)="clearFilters()" />
      } @else {
        <ul class="ff-grid">
          @for (flag of filtered(); track flag.key) {
            <li class="ff-card" [attr.data-stage]="flag.stage" [class.ff-card-killed]="flag.kill_switch" [class.ff-card-on]="resolvedOn(flag)">
              <header class="ff-card-head">
                <h2 class="ff-key">
                  <button type="button" class="ff-key-btn" (click)="copyKey(flag.key)"
                          [attr.aria-label]="'Copy flag key ' + flag.key" title="Copy key to clipboard">
                    {{ flag.key }}
                    <span class="ff-key-copy" aria-hidden="true">⧉</span>
                  </button>
                </h2>
                <span class="ff-stage" [attr.data-stage]="flag.stage">{{ flag.stage }}</span>
              </header>
              <p class="ff-desc">{{ flag.description }}</p>
              <div class="ff-state-row">
                <span class="ff-state-badge" [class.ff-state-on]="resolvedOn(flag)" [class.ff-state-off]="!resolvedOn(flag)"
                      [attr.aria-label]="flag.key + ' is ' + (resolvedOn(flag) ? 'on' : 'off')">
                  {{ resolvedOn(flag) ? 'ON' : 'OFF' }}
                </span>
                <span class="ff-rollout">rollout: {{ flag.default_rollout_percent }}%</span>
                @if (flag.kill_switch) {
                  <span class="ff-kill-badge" title="Hard kill switch is active — off for everyone regardless of rollout">⛔ killswitch</span>
                }
              </div>
              <div class="ff-owner">Owner: {{ flag.owner_email }}</div>
              <div class="ff-actions">
                <button class="ff-btn ff-btn-primary" (click)="toggle(flag)" [disabled]="busy()[flag.key]"
                        [attr.aria-label]="(flag.default_enabled ? 'Disable ' : 'Enable ') + flag.key + ' globally'">
                  {{ flag.default_enabled ? 'Disable globally' : 'Enable globally' }}
                </button>
                <button class="ff-btn" (click)="openDetail(flag)"
                        [attr.aria-expanded]="detailKey() === flag.key" [attr.aria-label]="'Inspect ' + flag.key">Inspect</button>
                @if (flag.kill_switch || flag.stage === 'killswitch') {
                  <button class="ff-btn ff-btn-restore" (click)="restore(flag)" [disabled]="busy()[flag.key]"
                          [attr.aria-label]="'Restore ' + flag.key + ' from killswitch'"
                          title="Lift the kill switch — flag returns to its prior enabled/rollout state">
                    Restore
                  </button>
                } @else {
                  <button class="ff-btn ff-btn-danger" (click)="killswitch(flag)" [disabled]="busy()[flag.key]"
                          [attr.aria-label]="'Killswitch ' + flag.key" title="Instant disable for all users — no redeploy">
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

                    @if (docs.e2e_tests && docs.e2e_tests.length) {
                      <h3>Automated coverage</h3>
                      <ul class="ff-e2e">
                        @for (spec of docs.e2e_tests; track spec) {
                          <li><code class="ff-step">{{ spec }}</code></li>
                        }
                      </ul>
                    }

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
                @if (resolvedDetail(); as r) {
                  <div class="ff-detail">
                    <h3>Resolved state for this scope</h3>
                    <div class="ff-resolved">
                      <span class="ff-state-badge" [class.ff-state-on]="r.enabled" [class.ff-state-off]="!r.enabled">{{ r.enabled ? 'ON' : 'OFF' }}</span>
                      <span class="ff-rollout">rollout: {{ r.rollout_percent }}%</span>
                      <span class="ff-stage" [attr.data-stage]="r.stage">{{ r.stage }}</span>
                      <span class="ff-resolved-source">resolved via {{ r.source }}</span>
                    </div>
                  </div>
                }
                <div class="ff-detail ff-controls">
                  <h3>Controls</h3>
                  <label class="ff-ctl">
                    <span class="ff-ctl-label">Rollout <strong>{{ displayRollout(flag) }}%</strong></span>
                    <input
                      type="range" min="0" max="100" step="5"
                      class="ff-range"
                      [value]="flag.default_rollout_percent"
                      (input)="rolloutDraft.set({ key: flag.key, pct: $any($event.target).valueAsNumber })"
                      (change)="setRollout(flag, $any($event.target).valueAsNumber); rolloutDraft.set(null)"
                      [attr.aria-label]="'Set rollout percent for ' + flag.key"
                      [attr.aria-valuetext]="displayRollout(flag) + ' percent'" />
                  </label>
                  <label class="ff-ctl">
                    <span class="ff-ctl-label">Stage</span>
                    <span class="ff-stage" [attr.data-stage]="flag.stage">{{ flag.stage }}</span>
                  </label>
                  <p class="ff-ctl-hint">experimental → beta (5-25%) → stable (100%). Enable / rollout / killswitch persist via the super-admin endpoint; stage is registry-managed (set in code).</p>
                </div>
              }
            </li>
          }
        </ul>
      }

      <footer class="ff-footer">
        <p>
          Flag mutations route through <code>POST /api/super-admin/feature-flags</code> (super-admin only).
          Promotion path: experimental → beta (5-25%) → stable (100%). Killswitch instantly disables for all users.
        </p>
      </footer>
    </section>
  `,
  styles: [`
    :host { display: block; box-sizing: border-box; width: 100%; min-width: 0; padding: 1.5rem; max-width: 1280px; margin: 0 auto; }
    .ff-page { color: var(--ps-ink, #f4f4ff); }
    .ff-header { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
    .ff-header h1 { font-size: clamp(1.5rem, 3vw, 2.25rem); margin: 0 0 .25rem; }
    .ff-sub { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); max-width: 60ch; }
    .ff-refresh { background: transparent; border: 1px solid color-mix(in oklch, currentColor 30%, transparent); color: inherit; padding: .5rem 1rem; border-radius: 8px; cursor: pointer; font: inherit; }
    .ff-refresh:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .ff-refresh:disabled { opacity: .5; cursor: not-allowed; }
    .ff-blocked { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1.25rem; padding: 0.7rem 0.9rem; border-radius: 12px;
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 8%, transparent); }
    .ff-blocked-icon { font-size: 1rem; line-height: 1; }
    .ff-blocked-text { flex: 1; font-size: 0.78rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 88%, transparent); }
    .ff-blocked-text code { font-family: 'JetBrains Mono', monospace; color: var(--ps-accent, #00E5FF); font-size: 0.74rem; }
    .ff-blocked-dismiss { background: none; border: 0; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); cursor: pointer; font-size: 0.85rem; padding: 0.2rem 0.35rem; border-radius: 6px; min-height: 24px; min-width: 24px; }
    .ff-blocked-dismiss:hover { color: var(--ps-ink, #f4f4ff); }
    .ff-blocked-dismiss:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 1px; }
    .ff-toolbar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
    /* .ff-search removed — now Spartan hlmInput (flex-1 min-w-[280px]). */
    .ff-stages { display: flex; gap: .375rem; flex-wrap: wrap; min-width: 0; }
    .ff-stage-chip { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 18%, transparent); border-radius: 999px; padding: .375rem .75rem; cursor: pointer; font: inherit; font-size: .875rem; display: inline-flex; align-items: center; gap: .375rem; }
    .ff-stage-chip:hover { border-color: color-mix(in oklch, currentColor 40%, transparent); }
    .ff-stage-chip-active { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border-color: var(--ps-accent, #00e5ff); }
    .ff-stage-count { background: color-mix(in oklch, currentColor 18%, transparent); padding: .05rem .4rem; border-radius: 999px; font-size: .75rem; }
    .ff-stage-chip-active .ff-stage-count { background: color-mix(in oklch, currentColor 25%, transparent); }
    .ff-grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr)); gap: 1rem; }
    .ff-card { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, currentColor 14%, transparent); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: .75rem; transition: border-color .15s ease, transform .15s ease; }
    .ff-card:hover { border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent); }
    .ff-card[data-stage="killswitch"] { border-color: #ff5555; }
    .ff-card[data-stage="stable"] { border-color: color-mix(in oklch, #4ade80 40%, transparent); }
    /* Resolved-state accents: enabled flags glow cyan-green, killed flags read red + dimmed. */
    .ff-card-on { border-color: color-mix(in oklch, #4ade80 38%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklch, #4ade80 18%, transparent); }
    .ff-card-killed { border-color: #ff5555 !important; background: color-mix(in oklch, #ff5555 7%, color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent)); }
    .ff-card-killed .ff-key, .ff-card-killed .ff-desc { opacity: .7; }
    .ff-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
    .ff-key { font-family: var(--ps-mono, ui-monospace, monospace); font-size: 1rem; margin: 0; word-break: break-all; }
    .ff-key-btn { background: none; border: none; color: inherit; font: inherit; cursor: pointer; padding: 0; display: inline-flex; align-items: baseline; gap: .4em; word-break: break-all; text-align: left; border-radius: 4px; }
    .ff-key-btn:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 3px; }
    .ff-key-copy { font-size: .8em; opacity: .35; transition: opacity .12s, color .12s; }
    .ff-key-btn:hover .ff-key-copy, .ff-key-btn:focus-visible .ff-key-copy { opacity: 1; color: var(--ps-accent, #00e5ff); }
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
    .ff-kill-badge { font-size: .72rem; font-weight: 600; color: #fff; background: #ff5555; padding: .15rem .5rem; border-radius: 6px; letter-spacing: .02em; }
    .ff-owner { font-size: .75rem; color: color-mix(in oklch, currentColor 50%, transparent); }
    .ff-resolved { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
    .ff-resolved-source { font-size: .72rem; color: color-mix(in oklch, currentColor 60%, transparent); font-style: italic; }
    .ff-actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: auto; }
    .ff-btn { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 22%, transparent); padding: .4rem .75rem; border-radius: 8px; cursor: pointer; font: inherit; font-size: .85rem; }
    .ff-btn:hover { border-color: color-mix(in oklch, currentColor 50%, transparent); }
    .ff-btn:disabled { opacity: .5; cursor: progress; }
    .ff-btn:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .ff-btn-primary { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border-color: var(--ps-accent, #00e5ff); }
    .ff-btn-danger:hover { border-color: #ff5555; color: #ff5555; }
    .ff-btn-restore { border-color: color-mix(in oklch, #4ade80 50%, transparent); color: #4ade80; }
    .ff-btn-restore:hover { border-color: #4ade80; background: color-mix(in oklch, #4ade80 12%, transparent); }
    .ff-detail { background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent); border-radius: 8px; padding: .85rem 1rem; margin-top: .5rem; }
    .ff-detail h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; margin: 1rem 0 .5rem; color: var(--ps-accent, #00e5ff); font-weight: 600; }
    .ff-detail h3:first-child { margin-top: 0; }
    .ff-detail pre { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .78rem; margin: 0; overflow: auto; }
    .ff-explanation { line-height: 1.55; margin: 0; color: color-mix(in oklch, currentColor 85%, transparent); font-size: .9rem; }
    .ff-smoke { padding-left: 1.25rem; margin: 0; display: flex; flex-direction: column; gap: .35rem; }
    .ff-smoke li { line-height: 1.45; font-size: .85rem; }
    .ff-step { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .82rem; background: color-mix(in oklch, currentColor 8%, transparent); padding: .15rem .4rem; border-radius: 4px; word-break: break-word; }
    .ff-e2e { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .3rem; }
    .ff-e2e li { font-size: .8rem; }
    .ff-refs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .25rem; }
    .ff-refs li { font-size: .8rem; }
    .ff-refs a { color: var(--ps-accent, #00e5ff); word-break: break-all; }
    .ff-controls { display: flex; flex-direction: column; gap: .75rem; }
    .ff-ctl { display: flex; flex-direction: column; gap: .35rem; }
    .ff-ctl-label { font-size: .8rem; color: color-mix(in oklch, currentColor 80%, transparent); }
    .ff-ctl-label strong { color: var(--ps-accent, #00e5ff); font-family: var(--ps-mono, ui-monospace, monospace); }
    .ff-range { width: 100%; max-width: 320px; accent-color: var(--ps-accent, #00e5ff); cursor: pointer; }
    .ff-range:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 4px; border-radius: 4px; }
    .ff-ctl-hint { font-size: .72rem; color: color-mix(in oklch, currentColor 50%, transparent); margin: 0; line-height: 1.4; }
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
  private readonly confirmSvc = inject(ConfirmService);
  private readonly state = inject(AdminStateService);
  private readonly flagSvc = inject(FeatureFlagService);
  private readonly route = inject(ActivatedRoute);

  /** Set from `?disabled=<key>` when featureFlagGuard bounced the user here, so
   *  we explain WHICH feature was off + point them at the exact flag to enable. */
  readonly blockedFeature = signal<string | null>(null);

  readonly stages: StageFilter[] = ['all', 'experimental', 'beta', 'stable', 'deprecated', 'killswitch'];
  readonly stage = signal<StageFilter>('all');
  readonly search = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly flags = signal<FlagDefinition[]>([]);
  readonly detailKey = signal<string | null>(null);
  readonly resolvedDetail = signal<ResolvedFlag | null>(null);
  readonly docsDetail = signal<FlagDocs | null>(null);
  /** Live rollout value while the slider is being dragged (commits on release). */
  readonly rolloutDraft = signal<{ key: string; pct: number } | null>(null);
  /** Per-flag in-flight mutation guard — disables that card's controls during a POST. */
  readonly busy = signal<Record<string, boolean>>({});

  readonly flagCount = computed(() => this.flags().length);

  /** A flag is "on" for the audience only when not kill-switched AND enabled. */
  resolvedOn(flag: FlagDefinition): boolean {
    return !flag.kill_switch && flag.default_enabled;
  }

  readonly emptyFilterHint = computed(() => {
    const q = this.search().trim();
    const s = this.stage();
    if (q && s !== 'all') return `No "${q}" flags in the ${s} stage.`;
    if (q) return `No flags match "${q}".`;
    return `No flags in the ${s} stage.`;
  });

  clearFilters(): void {
    this.search.set('');
    this.stage.set('all');
  }

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const s = this.stage();
    return this.flags().filter((f) => {
      if (s !== 'all' && f.stage !== s) return false;
      if (!q) return true;
      return f.key.toLowerCase().includes(q) || f.description.toLowerCase().includes(q);
    });
  });

  /** Copy a flag key to the clipboard — devs paste it into isFlagOn()/useFeatureFlag(). */
  async copyKey(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.toast.success(`Copied "${key}"`);
    } catch {
      this.toast.error('Copy failed — clipboard unavailable');
    }
  }

  /** Rollout % to display: the live drag draft for this flag, else its committed value. */
  displayRollout(flag: FlagDefinition): number {
    const d = this.rolloutDraft();
    return d && d.key === flag.key ? d.pct : flag.default_rollout_percent;
  }

  countForStage(s: StageFilter): number {
    if (s === 'all') return this.flags().length;
    return this.flags().filter((f) => f.stage === s).length;
  }

  async ngOnInit(): Promise<void> {
    // featureFlagGuard redirects here with ?disabled=<key> when a flag-gated
    // route is off — surface which feature + pre-filter the list to that flag.
    const blocked = this.route.snapshot.queryParamMap.get('disabled');
    if (blocked) {
      this.blockedFeature.set(blocked);
      this.search.set(blocked);
    }
    await this.reload();
  }

  /** Dismiss the "feature disabled" banner. */
  dismissBlockedBanner(): void {
    this.blockedFeature.set(null);
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.http.get<{ flags: FlagDefinition[]; count: number }>('/api/feature-flags'));
      let flags = res.flags ?? [];
      // Merge persisted super-admin overrides (enabled_globally / rollout_pct /
      // kill_switch) onto the registry list so EVERY card shows live state on
      // first load. Gated on the super-admin flag (/api/auth/me) so non-super
      // admins never fire the super-admin-only endpoint — that 401 is logged by
      // the browser and JS can't suppress it, so gating is the only way to keep
      // the console clean. Non-super-admins keep the registry defaults (they
      // can't mutate anyway); per-flag Inspect still shows resolved live state.
      if (this.state.isSuperAdmin()) {
        try {
          const ov = await firstValueFrom(
            this.http.get<{
              flags: { key: string; enabled_globally: number | boolean; rollout_pct: number; kill_switch: number | boolean }[];
            }>('/api/super-admin/feature-flags'),
          );
          const byKey = new Map((ov.flags ?? []).map((o) => [o.key, o] as const));
          flags = flags.map((f) => {
            const o = byKey.get(f.key);
            if (!o) return f;
            return {
              ...f,
              default_enabled: !!o.enabled_globally,
              default_rollout_percent: Number(o.rollout_pct ?? f.default_rollout_percent),
              kill_switch: !!o.kill_switch,
            };
          });
        } catch {
          /* endpoint unavailable — registry defaults stand */
        }
      }
      this.flags.set(flags);
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
   * Single mutation path for every flag override (toggle / rollout / killswitch
   * / restore). TRUE optimistic UI: patch local state FIRST so the card updates
   * instantly, fire the POST, and ROLL BACK to the pre-mutation snapshot if the
   * worker rejects it. Invalidates the client flag cache on success so route
   * guards + isOn() consumers re-resolve without a session reload.
   *
   * Maps the cockpit's intent to the worker's flag-patch contract
   * (POST /api/super-admin/feature-flags, super-admin guarded — the ONLY flag
   * mutation route the worker serves; the prior /override path 404'd). The
   * worker upserts feature_flags(enabled_globally, rollout_pct, kill_switch);
   * `stage` has no column (registry/code-managed) so it is never sent.
   */
  private async applyOverride(
    flag: FlagDefinition,
    patch: { enabled_globally?: boolean; rollout_pct?: number; kill_switch?: boolean },
    label: string,
    optimistic: (f: FlagDefinition) => FlagDefinition,
  ): Promise<void> {
    if (this.busy()[flag.key]) return;
    const before = this.flags().find((f) => f.key === flag.key);
    if (!before) return;

    // 1. Optimistic patch — card reflects the new state immediately.
    this.flags.update((flags) => flags.map((f) => (f.key === flag.key ? optimistic(f) : f)));
    this.busy.update((b) => ({ ...b, [flag.key]: true }));

    try {
      await firstValueFrom(this.http.post('/api/super-admin/feature-flags', { key: flag.key, ...patch }));
      this.flagSvc.invalidate(flag.key);
      this.toast.success(`${flag.key}: ${label}`);
    } catch (e) {
      // 2. Roll back to the captured snapshot — the optimistic patch never landed.
      this.flags.update((flags) => flags.map((f) => (f.key === flag.key ? before : f)));
      const status = (e as { status?: number }).status ?? 'error';
      const hint = status === 403 ? ' — super-admin only' : status === 401 ? ' — sign in again' : '';
      this.toast.error(`Couldn't update ${flag.key} (HTTP ${status}${hint}). Reverted.`, 7000);
    } finally {
      this.busy.update((b) => ({ ...b, [flag.key]: false }));
    }
  }

  async toggle(flag: FlagDefinition): Promise<void> {
    const next = !flag.default_enabled;
    return this.applyOverride(
      flag,
      { enabled_globally: next, rollout_pct: next ? 100 : 0 },
      next ? 'enabled globally' : 'disabled globally',
      (f) => ({ ...f, default_enabled: next, default_rollout_percent: next ? 100 : 0 }),
    );
  }

  /** Set a gradual rollout percentage (0 disables, >0 enables). */
  async setRollout(flag: FlagDefinition, pct: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    return this.applyOverride(
      flag,
      { enabled_globally: clamped > 0, rollout_pct: clamped },
      `rollout → ${clamped}%`,
      (f) => ({ ...f, default_rollout_percent: clamped, default_enabled: clamped > 0 }),
    );
  }

  async killswitch(flag: FlagDefinition): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      title: 'Trigger kill switch',
      message: `Instant-kill "${flag.key}" for ALL users? This flips the hard kill switch off everywhere with no redeploy. You can restore it from this page.`,
      confirmLabel: 'Kill for everyone',
    });
    if (!ok) return;
    return this.applyOverride(
      flag,
      { kill_switch: true, enabled_globally: false, rollout_pct: 0 },
      'KILLSWITCH — disabled for all users',
      (f) => ({ ...f, default_enabled: false, default_rollout_percent: 0, kill_switch: true, stage: 'killswitch' }),
    );
  }

  /** Lift the hard kill switch — flag returns to experimental/off; re-enable as needed. */
  async restore(flag: FlagDefinition): Promise<void> {
    return this.applyOverride(
      flag,
      { kill_switch: false },
      'killswitch lifted',
      (f) => ({ ...f, kill_switch: false, stage: f.stage === 'killswitch' ? 'experimental' : f.stage }),
    );
  }
}
