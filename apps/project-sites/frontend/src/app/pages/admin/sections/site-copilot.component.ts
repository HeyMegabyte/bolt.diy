/**
 * /admin/sites/:id/copilot — Multimodal AI Site Copilot admin panel.
 *
 * Shows:
 *   - Enable toggle (PUT /api/sites/:id/copilot/config)
 *   - Intent distribution donut chart (rolling-counter per intent)
 *   - Recent multimodal sessions list (50 rows, ≤36px)
 *   - Copy-to-clipboard widget script tag
 *
 * Flag: multimodal_copilot — renders a flag-gate notice when off.
 * All numerics via <app-rolling-counter>, sections via appReveal.
 */

import {
  Component, OnInit, OnDestroy, computed, inject, signal, Input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmCheckboxDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';

interface CopilotSession {
  id: string;
  intent: string | null;
  has_text: number;
  has_audio: number;
  has_image: number;
  total_ms: number;
  status: string;
  created_at: string;
}

interface IntentDistRow { intent: string; count: number; }

const INTENT_COLORS: Record<string, string> = {
  book: '#22c55e', quote: '#00e5ff', support: '#f59e0b', browse: '#7c3aed', unknown: 'rgba(244,244,255,0.2)',
};
const INTENT_ICONS: Record<string, string> = {
  book: '📅', quote: '💰', support: '🛠', browse: '👁', unknown: '❓',
};

@Component({
  selector: 'app-admin-site-copilot',
  standalone: true,
  imports: [RevealDirective, CommonModule, FormsModule, RouterModule, RollingCounterComponent, HlmCheckboxDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="copilot-shell" appReveal>
      <header class="copilot-hdr">
        <div>
          <span class="copilot-eyebrow">Site Copilot</span>
          <h2 class="copilot-title">Multimodal AI Copilot</h2>
          <p class="copilot-sub">Visitor uploads photo + voice + text → AI extracts intent + autofills forms.</p>
        </div>
        <div class="copilot-toggle-wrap" appReveal
             [attr.title]="!flagEnabled() ? 'Enable the multimodal_copilot feature flag first' : null">
          <label class="copilot-toggle" [attr.aria-label]="enabled() ? 'Copilot enabled' : 'Copilot disabled'">
            <input hlmCheckbox type="checkbox" [checked]="enabled()" [disabled]="!flagEnabled()" (change)="toggleEnabled($event)" />
            <span class="copilot-toggle-track"></span>
          </label>
          <span class="copilot-toggle-label">{{ enabled() ? 'Enabled' : 'Disabled' }}</span>
        </div>
      </header>

      @if (!flagEnabled()) {
        <div class="copilot-flag-gate" appReveal>
          <p>The Multimodal Copilot is behind the <code>multimodal_copilot</code> feature flag.</p>
          <a routerLink="/admin/feature-flags" class="copilot-flag-link">Enable in Feature Flags →</a>
        </div>
      } @else {
        <!-- Widget embed snippet -->
        @if (siteSlug()) {
          <div class="copilot-embed-card" appReveal>
            <span class="copilot-embed-label">Embed on your site</span>
            <code class="copilot-embed-code" id="copilot-embed-snippet">
              &lt;script src="https://projectsites.dev/sites/{{ siteSlug() }}/copilot.js"&gt;&lt;/script&gt;
            </code>
            <button class="copilot-copy-btn" (click)="copySnippet()">{{ copied() ? '✓ Copied' : 'Copy' }}</button>
          </div>
        }

        <!-- Stats row -->
        <div class="copilot-stats" appReveal>
          <div class="copilot-stat">
            <app-rolling-counter [value]="totalSessions()" suffix=" sessions" />
            <span class="copilot-stat-label">Total</span>
          </div>
          @for (d of distribution(); track d.intent) {
            <div class="copilot-stat">
              <app-rolling-counter [value]="d.count" [suffix]="' ' + d.intent" />
              <span class="copilot-stat-label" [style.color]="intentColor(d.intent)">{{ intentIcon(d.intent) }}</span>
            </div>
          }
        </div>

        <!-- Sessions table -->
        <div class="copilot-table-wrap" appReveal>
          <table class="copilot-table" aria-label="Recent copilot sessions" [attr.aria-busy]="loading()">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Signals</th>
                <th>Latency</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (i of [0,1,2,3,4]; track i) {
                  <tr class="copilot-skel-row" aria-hidden="true">
                    <td><span class="glow-skel copilot-skel-bar" style="width:70%"></span></td>
                    <td><span class="glow-skel copilot-skel-bar" style="width:55%"></span></td>
                    <td><span class="glow-skel copilot-skel-bar" style="width:38%"></span></td>
                    <td><span class="glow-skel copilot-skel-bar" style="width:46%"></span></td>
                    <td><span class="glow-skel copilot-skel-bar" style="width:60%"></span></td>
                  </tr>
                }
              } @else if (loadError()) {
                <tr><td colspan="5" class="copilot-td-center" role="alert" data-testid="copilot-load-error">
                  <span class="text-red-300">{{ loadError() }}</span>
                  <button class="btn-ghost text-xs ml-3" data-testid="copilot-retry" (click)="loadSessions()" [disabled]="loading()">Retry</button>
                </td></tr>
              } @else if (sessions().length === 0) {
                <tr><td colspan="5" class="copilot-td-center">No sessions yet. Embed the widget to start.</td></tr>
              } @else {
                @for (s of sessions(); track s.id) {
                  <tr>
                    <td>
                      <span class="copilot-intent-chip" [style.color]="intentColor(s.intent ?? 'unknown')">
                        {{ intentIcon(s.intent ?? 'unknown') }} {{ s.intent ?? 'unknown' }}
                      </span>
                    </td>
                    <td class="copilot-signals">
                      @if (s.has_text) { <span title="Text">T</span> }
                      @if (s.has_audio) { <span title="Audio">A</span> }
                      @if (s.has_image) { <span title="Image">I</span> }
                    </td>
                    <td>{{ s.total_ms }}ms</td>
                    <td>
                      <span class="copilot-status-dot" [class]="s.status">{{ s.status }}</span>
                    </td>
                    <td>{{ relativeTime(s.created_at) }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <style>
      .copilot-shell { padding: 20px 24px; background: var(--ps-bg); color: var(--ps-ink); display: flex; flex-direction: column; gap: 16px; }
      .copilot-hdr { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
      .copilot-eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--ps-accent); font-weight: 600; }
      .copilot-title { font-size: 20px; font-weight: 700; margin: 4px 0 4px; }
      .copilot-sub { font-size: 13px; color: rgba(244,244,255,0.5); margin: 0; }
      .copilot-toggle-wrap { display: flex; align-items: center; gap: 8px; }
      .copilot-toggle { position: relative; display: inline-flex; cursor: pointer; }
      .copilot-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
      .copilot-toggle-track { width: 40px; height: 22px; background: rgba(255,255,255,0.1); border-radius: 11px; transition: background .2s; }
      .copilot-toggle input:checked ~ .copilot-toggle-track { background: var(--ps-accent); }
      .copilot-toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: left .2s; }
      .copilot-toggle input:checked ~ .copilot-toggle-track::after { left: 21px; }
      .copilot-toggle-label { font-size: 13px; color: rgba(244,244,255,0.7); }
      .copilot-flag-gate { padding: 20px; background: rgba(0,229,255,0.06); border: 1px solid rgba(0,229,255,0.2); border-radius: 12px; }
      .copilot-flag-link { color: var(--ps-accent); font-weight: 600; }
      .copilot-embed-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(0,229,255,0.12); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .copilot-embed-label { font-size: 11px; color: rgba(244,244,255,0.72); text-transform: uppercase; letter-spacing: 1px; flex-shrink: 0; }
      .copilot-embed-code { flex: 1; font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--ps-accent); background: rgba(0,229,255,0.06); padding: 6px 10px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .copilot-copy-btn { background: rgba(0,229,255,0.1); border: 1px solid rgba(0,229,255,0.2); border-radius: 8px; padding: 5px 12px; color: var(--ps-accent); font-size: 12px; cursor: pointer; flex-shrink: 0; }
      .copilot-stats { display: flex; gap: 20px; flex-wrap: wrap; }
      .copilot-stat { display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; }
      .copilot-stat-label { font-size: 11px; color: rgba(244,244,255,0.72); }
      .copilot-table-wrap { background: rgba(255,255,255,0.02); border: 1px solid rgba(0,229,255,0.1); border-radius: 12px; overflow: hidden; }
      .copilot-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .copilot-table th { padding: 8px 12px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(244,244,255,0.72); border-bottom: 1px solid rgba(255,255,255,0.05); }
      .copilot-table td { padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); }
      .copilot-table tr:last-child td { border-bottom: none; }
      .copilot-table tr:hover td { background: rgba(0,229,255,0.04); }
      .copilot-skel-row:hover td { background: transparent; }
      .copilot-skel-bar { display: inline-block; height: 11px; border-radius: 4px; }
      .copilot-td-center { text-align: center; color: rgba(244,244,255,0.72); padding: 24px !important; }
      .copilot-intent-chip { font-size: 12px; font-weight: 500; }
      .copilot-signals { display: flex; gap: 4px; }
      .copilot-signals span { background: rgba(0,229,255,0.1); border: 1px solid rgba(0,229,255,0.2); border-radius: 4px; padding: 1px 5px; font-size: 10px; font-weight: 700; color: var(--ps-accent); }
      .copilot-status-dot { font-size: 11px; }
      .copilot-status-dot.done { color: #22c55e; }
      .copilot-status-dot.error { color: #ef4444; }
      .copilot-status-dot.pending { color: #f59e0b; }
    </style>
  `,
})
export class AdminSiteCopilotComponent implements OnInit, OnDestroy {
  @Input() siteId = '';
  @Input() siteSlug = signal('');

  private http = inject(HttpClient);
  private destroy$ = new Subject<void>();

  sessions = signal<CopilotSession[]>([]);
  distribution = signal<IntentDistRow[]>([]);
  enabled = signal(false);
  flagEnabled = signal(true);
  loading = signal(true);
  /** Persistent non-404 sessions-load failure — so a real error shows a Retry card, not a fake "No sessions yet". (404 stays the honest flag-disabled state.) */
  loadError = signal<string | null>(null);
  copied = signal(false);

  totalSessions = computed(() => this.sessions().length);

  ngOnInit(): void {
    if (!this.siteId) return;
    this.loadConfig();
    this.loadSessions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadConfig(): void {
    this.http.get<{ enabled: boolean }>(`/api/sites/${this.siteId}/copilot/config`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => { this.enabled.set(r.enabled); this.flagEnabled.set(true); },
        error: (e) => { if (e.status === 404) this.flagEnabled.set(false); },
      });
  }

  loadSessions(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.http.get<{ sessions: CopilotSession[]; distribution: IntentDistRow[] }>(
      `/api/sites/${this.siteId}/copilot/sessions`,
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => {
          this.sessions.set(r.sessions);
          this.distribution.set(r.distribution);
          this.flagEnabled.set(true);
          this.loadError.set(null);
          this.loading.set(false);
        },
        error: (e) => {
          // 404 = honest flag-disabled state; any other error must NOT masquerade as "no sessions".
          if (e.status === 404) this.flagEnabled.set(false);
          else this.loadError.set('Could not load copilot sessions — retry.');
          this.loading.set(false);
        },
      });
  }

  toggleEnabled(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Flag-gated off — the per-site toggle is moot (config route 404s). Revert the
    // native checkbox to the real state + no PUT (the gate notice is the truth).
    if (!this.flagEnabled()) { input.checked = this.enabled(); return; }
    const enabled = input.checked;
    this.http.put<{ ok: boolean }>(`/api/sites/${this.siteId}/copilot/config`, { enabled })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.enabled.set(enabled),
        error: () => {},
      });
  }

  copySnippet(): void {
    const slug = this.siteSlug();
    if (!slug) return;
    const snippet = `<script src="https://projectsites.dev/sites/${slug}/copilot.js"></script>`;
    navigator.clipboard.writeText(snippet).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }).catch(() => {});
  }

  intentColor(intent: string): string { return INTENT_COLORS[intent] ?? 'rgba(244,244,255,0.4)'; }
  intentIcon(intent: string): string { return INTENT_ICONS[intent] ?? '?'; }

  relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString();
  }
}
