/**
 * /admin/sites/:id/dna — Site DNA Taste Graph admin panel.
 *
 * Shows:
 *   - Stats row (total feedback, accepted, rejected, edited) via <app-rolling-counter>
 *   - Feedback history table (≤36px rows, newest-first, paginated 50)
 *   - Preferences chart — top accepted component classes as a horizontal bar grid
 *   - Manual feedback submission form (component_id + action + optional context JSON)
 *
 * Flag: `site_dna_taste_graph` (experimental, enabled=0, rollout=0).
 * Renders a flag-gate notice when off.
 * All numerics via <app-rolling-counter>, sections via appReveal directive.
 */

import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  Input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmInputDirective, HlmSelectDirective } from '../../../ui';

// ── Data shapes (mirrors site_dna.ts service types) ──────────────────────

interface DnaFeedbackRow {
  id: string;
  component_id: string;
  component_class: string;
  action: 'accept' | 'reject' | 'edit';
  context: Record<string, unknown> | null;
  created_at: string;
}

interface DnaPrefRow {
  component_class: string;
  accept_count: number;
  reject_count: number;
  net_score: number;
}

interface DnaHistoryResp {
  site_id: string;
  history: DnaFeedbackRow[];
  count: number;
}

interface DnaPrefsResp {
  site_id: string;
  component_class: string;
  preferences: DnaPrefRow[];
  count: number;
}

// ── Component ─────────────────────────────────────────────────────────────

@Component({
  selector: 'app-admin-site-dna',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, RollingCounterComponent, HlmInputDirective, HlmSelectDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dna-shell" appReveal>

      <!-- Header -->
      <header class="dna-hdr">
        <div>
          <span class="dna-eyebrow">Site DNA</span>
          <h2 class="dna-title">Taste Graph</h2>
          <p class="dna-sub">
            Accept/reject/edit signals per component — shapes the AI's style preferences over time.
          </p>
        </div>
        <a routerLink="/admin/feature-flags" class="dna-flag-link" title="Manage flags">
          <code class="dna-flag-chip">site_dna_taste_graph</code>
        </a>
      </header>

      <!-- Flag-gate notice -->
      @if (!flagEnabled()) {
        <div class="dna-flag-gate" appReveal data-testid="dna-flag-gate">
          <p>
            The Site DNA Taste Graph is behind the
            <code>site_dna_taste_graph</code> feature flag (currently disabled).
          </p>
          <a routerLink="/admin/feature-flags" class="dna-link">Enable in Feature Flags →</a>
        </div>
      } @else {

        <!-- Stats row -->
        <div class="dna-stats" appReveal data-testid="dna-stats">
          <div class="dna-stat">
            <app-rolling-counter [value]="totalFeedback()" suffix=" signals" />
            <span class="dna-stat-label">Total</span>
          </div>
          <div class="dna-stat">
            <app-rolling-counter [value]="acceptCount()" suffix=" accepted" />
            <span class="dna-stat-label" style="color:#22c55e">✓</span>
          </div>
          <div class="dna-stat">
            <app-rolling-counter [value]="rejectCount()" suffix=" rejected" />
            <span class="dna-stat-label" style="color:#ef4444">✕</span>
          </div>
          <div class="dna-stat">
            <app-rolling-counter [value]="editCount()" suffix=" edited" />
            <span class="dna-stat-label" style="color:#f59e0b">✎</span>
          </div>
          <div class="dna-stat">
            <app-rolling-counter [value]="prefCount()" suffix=" classes" />
            <span class="dna-stat-label">Learned</span>
          </div>
        </div>

        <!-- Preferences chart -->
        @if (prefs().length > 0) {
          <div class="dna-prefs-card" appReveal data-testid="dna-prefs-chart">
            <span class="dna-section-label">Top accepted component classes</span>
            <div class="dna-prefs-grid">
              @for (p of prefs(); track p.component_class) {
                <div class="dna-pref-row">
                  <span class="dna-pref-class">{{ p.component_class }}</span>
                  <div class="dna-pref-bar-wrap" [attr.aria-label]="p.component_class + ' net score ' + p.net_score">
                    <div
                      class="dna-pref-bar"
                      [style.width]="barWidth(p.net_score) + '%'"
                      [style.background]="p.net_score >= 0 ? 'var(--ps-accent)' : '#ef4444'"
                    ></div>
                  </div>
                  <span class="dna-pref-score" [class.positive]="p.net_score >= 0">{{ p.net_score > 0 ? '+' : '' }}{{ p.net_score }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Feedback history table -->
        <div class="dna-table-wrap" appReveal>
          <div class="dna-table-hdr">
            <span class="dna-section-label">Recent feedback</span>
            <button class="dna-refresh-btn" (click)="load()" [disabled]="loading()" aria-label="Refresh feedback history">
              {{ loading() ? '…' : '↻' }}
            </button>
          </div>
          <table class="dna-table" aria-label="Site DNA feedback history" [attr.aria-busy]="loading()">
            <thead>
              <tr>
                <th>Component</th>
                <th>Class</th>
                <th>Action</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (i of [0,1,2,3,4]; track i) {
                  <tr class="dna-skel-row" aria-hidden="true">
                    <td><span class="glow-skel dna-skel-bar" style="width:72%"></span></td>
                    <td><span class="glow-skel dna-skel-bar" style="width:50%"></span></td>
                    <td><span class="glow-skel dna-skel-bar" style="width:42%"></span></td>
                    <td><span class="glow-skel dna-skel-bar" style="width:60%"></span></td>
                  </tr>
                }
              } @else if (history().length === 0) {
                <tr>
                  <td colspan="4" class="dna-td-center">
                    No feedback yet. Use the form below to seed the first signal.
                  </td>
                </tr>
              } @else {
                @for (row of history(); track row.id) {
                  <tr>
                    <td class="dna-mono">{{ row.component_id }}</td>
                    <td>
                      <span class="dna-class-chip">{{ row.component_class }}</span>
                    </td>
                    <td>
                      <span class="dna-action-chip" [class]="row.action">{{ row.action }}</span>
                    </td>
                    <td class="dna-ts">{{ relativeTime(row.created_at) }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <!-- Manual feedback form -->
        <div class="dna-form-card" appReveal data-testid="dna-feedback-form">
          <span class="dna-section-label">Submit manual feedback</span>
          <form class="dna-form" (ngSubmit)="submitFeedback()" #feedbackForm="ngForm">
            <div class="dna-form-row">
              <label class="dna-label" for="dna-cid">Component ID</label>
              <input
                id="dna-cid"
                hlmInput
                type="text"
                placeholder="hero-section-v2"
                [(ngModel)]="newComponentId"
                name="component_id"
                required
                minlength="1"
                data-testid="dna-component-id-input"
              />
            </div>
            <div class="dna-form-row">
              <label class="dna-label" for="dna-action">Action</label>
              <select
                id="dna-action"
                hlmSelect
                [(ngModel)]="newAction"
                name="action"
                required
                data-testid="dna-action-select"
              >
                <option value="accept">accept</option>
                <option value="reject">reject</option>
                <option value="edit">edit</option>
              </select>
            </div>
            <div class="dna-form-row">
              <label class="dna-label" for="dna-context">Context JSON <span class="dna-opt">(optional)</span></label>
              <input
                id="dna-context"
                hlmInput
                class="font-mono"
                type="text"
                placeholder='{"component_class":"hero"}'
                [(ngModel)]="newContext"
                name="context"
                data-testid="dna-context-input"
              />
            </div>
            <div class="dna-form-actions">
              @if (submitError()) {
                <span class="dna-error" role="alert">{{ submitError() }}</span>
              }
              @if (submitSuccess()) {
                <span class="dna-success" role="status">✓ Feedback recorded</span>
              }
              <button
                type="submit"
                class="dna-submit-btn"
                [disabled]="submitting() || !newComponentId || !newAction"
                data-testid="dna-submit-btn"
              >
                {{ submitting() ? 'Submitting…' : 'Submit Feedback' }}
              </button>
            </div>
          </form>
        </div>

      }
    </section>

    <style>
      /* ── Shell ── */
      .dna-shell { padding: 20px 24px; background: var(--ps-bg, #060610); color: var(--ps-ink, #f4f4ff); display: flex; flex-direction: column; gap: 16px; }

      /* ── Header ── */
      .dna-hdr { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
      .dna-eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--ps-accent, #00e5ff); font-weight: 600; }
      .dna-title { font-size: 20px; font-weight: 700; margin: 4px 0 4px; }
      .dna-sub { font-size: 13px; color: rgba(244,244,255,0.5); margin: 0; }
      .dna-flag-link { text-decoration: none; }
      .dna-flag-chip { background: rgba(0,229,255,0.08); border: 1px solid rgba(0,229,255,0.2); border-radius: 6px; padding: 4px 8px; font-size: 11px; color: var(--ps-accent, #00e5ff); font-family: 'JetBrains Mono', monospace; }

      /* ── Flag gate ── */
      .dna-flag-gate { padding: 20px; background: rgba(0,229,255,0.06); border: 1px solid rgba(0,229,255,0.2); border-radius: 12px; font-size: 13px; }
      .dna-link { color: var(--ps-accent, #00e5ff); font-weight: 600; }

      /* ── Stats ── */
      .dna-stats { display: flex; gap: 24px; flex-wrap: wrap; }
      .dna-stat { display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; }
      .dna-stat-label { font-size: 11px; color: rgba(244,244,255,0.4); }

      /* ── Section label ── */
      .dna-section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: rgba(244,244,255,0.4); font-weight: 600; }

      /* ── Preferences chart ── */
      .dna-prefs-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(0,229,255,0.1); border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
      .dna-prefs-grid { display: flex; flex-direction: column; gap: 6px; }
      .dna-pref-row { display: grid; grid-template-columns: 120px 1fr 48px; align-items: center; gap: 8px; min-height: 22px; }
      .dna-pref-class { font-size: 12px; color: rgba(244,244,255,0.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dna-pref-bar-wrap { height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
      .dna-pref-bar { height: 100%; border-radius: 3px; transition: width .4s ease; min-width: 2px; }
      .dna-pref-score { font-size: 11px; font-variant-numeric: tabular-nums; color: rgba(244,244,255,0.4); text-align: right; }
      .dna-pref-score.positive { color: var(--ps-accent, #00e5ff); }

      /* ── Table ── */
      .dna-table-wrap { background: rgba(255,255,255,0.02); border: 1px solid rgba(0,229,255,0.1); border-radius: 12px; overflow: hidden; }
      .dna-table-hdr { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .dna-refresh-btn { background: none; border: 1px solid rgba(0,229,255,0.2); border-radius: 6px; padding: 3px 8px; color: var(--ps-accent, #00e5ff); font-size: 14px; cursor: pointer; }
      .dna-refresh-btn:disabled { opacity: 0.4; cursor: default; }
      .dna-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .dna-table th { padding: 7px 12px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(244,244,255,0.4); }
      .dna-table td { padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); line-height: 1.3; max-height: 36px; overflow: hidden; }
      .dna-table tr:last-child td { border-bottom: none; }
      .dna-table tr:hover td { background: rgba(0,229,255,0.04); }
      .dna-td-center { text-align: center; color: rgba(244,244,255,0.35); padding: 24px !important; }
      .dna-skel-bar { display: inline-block; height: 11px; border-radius: 4px; }
      .dna-mono { font-family: 'JetBrains Mono', monospace; color: rgba(244,244,255,0.7); }
      .dna-ts { color: rgba(244,244,255,0.35); font-size: 11px; }
      .dna-class-chip { background: rgba(0,229,255,0.08); border: 1px solid rgba(0,229,255,0.15); border-radius: 4px; padding: 1px 6px; font-size: 11px; color: var(--ps-accent, #00e5ff); }
      .dna-action-chip { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 4px; }
      .dna-action-chip.accept { background: rgba(34,197,94,0.12); color: #22c55e; }
      .dna-action-chip.reject { background: rgba(239,68,68,0.12); color: #ef4444; }
      .dna-action-chip.edit   { background: rgba(245,158,11,0.12); color: #f59e0b; }

      /* ── Form ── */
      .dna-form-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(0,229,255,0.1); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
      .dna-form { display: flex; flex-direction: column; gap: 10px; }
      .dna-form-row { display: flex; flex-direction: column; gap: 4px; }
      .dna-label { font-size: 11px; color: rgba(244,244,255,0.5); font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
      .dna-opt { text-transform: none; letter-spacing: 0; color: rgba(244,244,255,0.3); font-weight: 400; }
      /* .dna-input/.dna-select removed — now Spartan hlmInput/hlmSelect. (.dna-mono kept; shared with the table cell.) */
      .dna-form-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .dna-submit-btn { background: var(--ps-accent, #00e5ff); color: #060610; border: none; border-radius: 8px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; transition: opacity .15s; }
      .dna-submit-btn:disabled { opacity: 0.45; cursor: default; }
      .dna-error { font-size: 12px; color: #ef4444; }
      .dna-success { font-size: 12px; color: #22c55e; }
    </style>
  `,
})
export class AdminSiteDnaComponent implements OnInit, OnDestroy {
  // siteId can come from the route param or an explicit @Input for embedding.
  @Input() siteId: string | null = null;

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy$ = new Subject<void>();

  // ── State signals ────────────────────────────────────────────────────────
  readonly loading = signal(false);
  readonly history = signal<DnaFeedbackRow[]>([]);
  readonly prefs = signal<DnaPrefRow[]>([]);
  readonly flagEnabled = signal(true); // assume on unless API 404s

  // ── Form state ──────────────────────────────────────────────────────────
  newComponentId = '';
  newAction: 'accept' | 'reject' | 'edit' = 'accept';
  newContext = '';
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly submitSuccess = signal(false);

  // ── Computed stats ───────────────────────────────────────────────────────
  readonly totalFeedback = computed(() => this.history().length);
  readonly acceptCount = computed(() => this.history().filter((r) => r.action === 'accept').length);
  readonly rejectCount = computed(() => this.history().filter((r) => r.action === 'reject').length);
  readonly editCount = computed(() => this.history().filter((r) => r.action === 'edit').length);
  readonly prefCount = computed(() => this.prefs().length);

  ngOnInit(): void {
    // Prefer explicit @Input; fall back to route param.
    const routeId = this.route.snapshot.paramMap.get('id');
    if (!this.siteId && routeId) this.siteId = routeId;
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    if (!this.siteId) return;
    this.loading.set(true);

    forkJoin({
      history: this.http.get<DnaHistoryResp>(`/api/site-dna/${this.siteId}/history?limit=50`),
      prefs: this.http.get<DnaPrefsResp>(`/api/site-dna/${this.siteId}/preferences?top_k=10`),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ history, prefs }) => {
          this.flagEnabled.set(true);
          this.history.set(history.history ?? []);
          this.prefs.set(prefs.preferences ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          // 404 means flag is off; other errors are surfaced via loading state.
          if (err?.status === 404) this.flagEnabled.set(false);
          this.loading.set(false);
        },
      });
  }

  submitFeedback(): void {
    if (!this.siteId || !this.newComponentId || !this.newAction) return;

    this.submitting.set(true);
    this.submitError.set(null);
    this.submitSuccess.set(false);

    let context: Record<string, unknown> | undefined;
    if (this.newContext.trim()) {
      try {
        context = JSON.parse(this.newContext) as Record<string, unknown>;
      } catch {
        this.submitError.set('Context must be valid JSON');
        this.submitting.set(false);
        return;
      }
    }

    this.http
      .post<{ id: string }>(
        `/api/site-dna/${this.siteId}/feedback`,
        { component_id: this.newComponentId, action: this.newAction, ...(context ? { context } : {}) },
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.submitSuccess.set(true);
          this.newComponentId = '';
          this.newContext = '';
          // Reload history to show the new row.
          this.load();
          setTimeout(() => this.submitSuccess.set(false), 3500);
        },
        error: (err) => {
          this.submitting.set(false);
          const msg = (err?.error?.error?.message as string | undefined) ?? 'Submit failed. Try again.';
          this.submitError.set(msg);
        },
      });
  }

  /** Width % for preference bar (max-score normalised to 80%). */
  barWidth(score: number): number {
    const max = Math.max(...this.prefs().map((p) => Math.abs(p.net_score)), 1);
    return Math.round((Math.abs(score) / max) * 80);
  }

  /** Human-relative timestamp ("3m ago", "2d ago"). */
  relativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
}
