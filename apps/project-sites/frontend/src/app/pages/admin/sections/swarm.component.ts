/**
 * Swarm Editor admin board — /admin/swarm/:siteId
 *
 * 7-column live progress grid for the Multi-Agent Swarm Editor (#5).
 * Also hosts the progressive-preview panel (#6) that streams components
 * from the SSE channel via EventSource.
 *
 * Per [[cinematic-ui-patterns]]:
 *  - Every numeric stat uses <app-rolling-counter>
 *  - Every section uses appReveal directive
 *  - View Transitions hooks for agent-status swaps
 *  - JetBrains Mono for all numeric cells
 *  - ≤36px rows, ≤12px card padding
 *  - routerLink for all navigation (no bare href=)
 *
 * Flag: swarm_editor + multi_agent_concurrent (both must be on).
 */

import {
  Component, OnInit, OnDestroy, inject, signal, computed,
  ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../directives/reveal.directive';

type AgentStatus = 'queued' | 'running' | 'done' | 'error';

interface AgentSlot {
  id: string;
  name: string;
  status: AgentStatus;
  file_glob: string;
  duration_ms?: number;
  output_preview?: string;
  conflict_detected?: boolean;
  started_at?: string;
  finished_at?: string;
}

interface SwarmRun {
  run_id: string;
  site_id: string;
  prompt: string;
  status: string;
  agents: AgentSlot[];
  started_at: string;
  sse_url?: string;
  conflict_detected?: boolean;
}

interface ProgressiveComponent {
  component: string;
  index: number;
  total: number;
  progress_pct: number;
  ts: string;
}

const SPECIALIST_ICONS: Record<string, string> = {
  visual: '🎨', copy: '✍️', seo: '🔍', a11y: '♿',
  motion: '✨', media: '🖼️', qa: '🧪',
};

const SPECIALIST_COLORS: Record<string, string> = {
  visual: '#7c3aed', copy: '#00e5ff', seo: '#10b981', a11y: '#f59e0b',
  motion: '#ec4899', media: '#3b82f6', qa: '#6366f1',
};

@Component({
  selector: 'app-admin-swarm',
  standalone: true,
  imports: [RevealDirective, CommonModule, RouterLink, RollingCounterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="swarm-shell" appReveal>
  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="swarm-header" appReveal>
    <div class="swarm-header__meta">
      <a [routerLink]="['/admin']" class="swarm-header__back">← Admin</a>
      <span class="swarm-header__sep">/</span>
      <span class="swarm-header__site">{{ siteId() }}</span>
    </div>
    <h1 class="swarm-header__title">Swarm Editor</h1>
    <p class="swarm-header__sub">7 specialists co-edit in parallel — each owns a file partition</p>

    <div class="swarm-header__stats">
      <div class="swarm-stat">
        <app-rolling-counter [value]="agentsDone()" suffix="/" />
        <span class="swarm-stat__total">7</span>
        <span class="swarm-stat__label">complete</span>
      </div>
      <div class="swarm-stat">
        <span class="swarm-stat__num" [class.swarm-stat__num--conflict]="conflictsDetected() > 0">
          {{ conflictsDetected() }}
        </span>
        <span class="swarm-stat__label">conflicts</span>
      </div>
      <div class="swarm-stat">
        <app-rolling-counter [value]="progressPct()" suffix="%" />
        <span class="swarm-stat__label">progress</span>
      </div>
    </div>

    <button class="swarm-header__start" (click)="startSwarm()"
            [disabled]="running()" aria-label="Start new swarm run">
      {{ running() ? '⚡ Running…' : '▶ Start Swarm' }}
    </button>
  </header>

  <!-- ── 7-Column Agent Board ──────────────────────────────────────────── -->
  @if (currentRun()) {
    <section class="swarm-board" appReveal aria-label="Agent progress board">
      @for (agent of currentRun()!.agents; track agent.id) {
        <div class="swarm-agent"
             [class.swarm-agent--queued]="agent.status === 'queued'"
             [class.swarm-agent--running]="agent.status === 'running'"
             [class.swarm-agent--done]="agent.status === 'done'"
             [class.swarm-agent--error]="agent.status === 'error'"
             [class.swarm-agent--conflict]="agent.conflict_detected"
             [style.--agent-color]="agentColor(agent.name)"
             appReveal>
          <div class="swarm-agent__header">
            <span class="swarm-agent__icon" aria-hidden="true">{{ agentIcon(agent.name) }}</span>
            <span class="swarm-agent__name">{{ agent.name }}</span>
            <span class="swarm-agent__status-pill" [attr.data-status]="agent.status">
              {{ statusLabel(agent.status) }}
            </span>
          </div>
          <p class="swarm-agent__glob" title="File ownership">{{ agent.file_glob }}</p>
          @if (agent.output_preview) {
            <p class="swarm-agent__preview">{{ agent.output_preview }}</p>
          }
          @if (agent.duration_ms) {
            <div class="swarm-agent__duration">
              <app-rolling-counter [value]="agent.duration_ms / 1000" [decimals]="1" suffix="s" />
            </div>
          }
          @if (agent.conflict_detected) {
            <div class="swarm-agent__conflict-badge" role="alert">⚠ Conflict</div>
          }
        </div>
      }
    </section>
  } @else if (!loading()) {
    <section class="swarm-empty" appReveal>
      <p>No swarm runs yet for this site.</p>
      <button class="swarm-empty__cta" (click)="startSwarm()">Start first swarm run →</button>
    </section>
  }

  <!-- ── Progressive Preview Panel (#6) ───────────────────────────────── -->
  <section class="swarm-preview" appReveal aria-label="Progressive component preview">
    <h2 class="swarm-preview__title">Live Component Stream</h2>
    <p class="swarm-preview__sub">Components stream in via SSE as specialists complete them</p>

    <div class="swarm-preview__progress-bar" role="progressbar"
         [attr.aria-valuenow]="progressPct()" aria-valuemin="0" aria-valuemax="100">
      <div class="swarm-preview__progress-fill" [style.width.%]="progressPct()"></div>
    </div>

    <div class="swarm-preview__grid">
      @for (comp of skeletonSlots; track comp) {
        <div class="swarm-preview__slot"
             [class.swarm-preview__slot--done]="isComponentDone(comp)"
             [class.swarm-preview__slot--active]="isComponentActive(comp)">
          <span class="swarm-preview__slot-name">{{ comp }}</span>
          @if (isComponentDone(comp)) {
            <span class="swarm-preview__slot-tick" aria-label="ready">✓</span>
          } @else if (isComponentActive(comp)) {
            <span class="swarm-preview__slot-spinner" aria-label="streaming" aria-live="polite">⟳</span>
          } @else {
            <span class="swarm-preview__slot-skeleton"></span>
          }
        </div>
      }
    </div>

    @if (!sseConnected()) {
      <button class="swarm-preview__connect" (click)="connectSse()">
        Connect live stream
      </button>
    }
  </section>

  <!-- ── Run History ──────────────────────────────────────────────────── -->
  @if (runHistory().length > 0) {
    <section class="swarm-history" appReveal aria-label="Run history">
      <h2>Recent Runs</h2>
      <table class="swarm-history__table" role="grid">
        <thead>
          <tr>
            <th scope="col">Run ID</th>
            <th scope="col">Prompt</th>
            <th scope="col">Status</th>
            <th scope="col">Agents done</th>
            <th scope="col">Started</th>
          </tr>
        </thead>
        <tbody>
          @for (run of runHistory(); track run.run_id) {
            <tr class="swarm-history__row" (click)="selectRun(run)" tabindex="0"
                (keydown.enter)="selectRun(run)" (keydown.space)="selectRun(run)">
              <td><code class="swarm-history__id">{{ run.run_id.slice(0,8) }}</code></td>
              <td class="swarm-history__prompt">{{ run.prompt }}</td>
              <td><span class="swarm-history__status-pill" [attr.data-status]="run.status">{{ run.status }}</span></td>
              <td>{{ doneCount(run.agents) }}/7</td>
              <td>{{ run.started_at | date:'HH:mm:ss' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  }
</div>
  `,
  styles: [`
    :host { display: block; color: var(--ps-ink, #f4f4ff); }
    .swarm-shell { padding: 0.75rem; max-width: 1200px; margin: 0 auto; }
    .swarm-header { margin-bottom: 1.5rem; }
    .swarm-header__meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; opacity: 0.6; margin-bottom: 0.75rem; }
    .swarm-header__back { color: var(--ps-accent, #00e5ff); text-decoration: none; }
    .swarm-header__title { font: 700 1.5rem/1.1 'Sora', sans-serif; margin: 0 0 0.25rem; }
    .swarm-header__sub { font-size: 0.8rem; opacity: 0.6; margin: 0 0 1rem; }
    .swarm-header__stats { display: flex; gap: 1.5rem; margin-bottom: 1rem; }
    .swarm-stat { display: flex; align-items: baseline; gap: 0.25rem; font-family: 'JetBrains Mono', monospace; }
    .swarm-stat__label { font-size: 0.7rem; opacity: 0.6; }
    .swarm-stat__num--conflict { color: #f59e0b; }
    .swarm-header__start { background: var(--ps-accent, #00e5ff); color: #060610; border: none; padding: 0.375rem 1rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
    .swarm-header__start:disabled { opacity: 0.5; cursor: default; }
    /* Board */
    .swarm-board { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
    @media (max-width: 900px) { .swarm-board { grid-template-columns: repeat(4, 1fr); } }
    @media (max-width: 600px) { .swarm-board { grid-template-columns: repeat(2, 1fr); } }
    .swarm-agent { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 0.625rem; min-height: 100px; display: flex; flex-direction: column; gap: 0.375rem; transition: border-color 0.3s; }
    .swarm-agent--running { border-color: var(--agent-color, var(--ps-accent, #00e5ff)); animation: agent-pulse 2s ease-in-out infinite; }
    .swarm-agent--done { border-color: #10b981; }
    .swarm-agent--error { border-color: #ef4444; }
    .swarm-agent--conflict { border-color: #f59e0b; }
    @keyframes agent-pulse { 0%,100%{opacity:1} 50%{opacity:.7} }
    .swarm-agent__header { display: flex; align-items: center; gap: 0.375rem; }
    .swarm-agent__icon { font-size: 1rem; }
    .swarm-agent__name { font-size: 0.7rem; font-weight: 600; text-transform: capitalize; }
    .swarm-agent__status-pill { font-size: 0.6rem; padding: 0.1rem 0.4rem; border-radius: 9999px; margin-left: auto;
      background: rgba(255,255,255,.08); }
    .swarm-agent__status-pill[data-status=running] { background: rgba(0,229,255,.2); color: #00e5ff; }
    .swarm-agent__status-pill[data-status=done] { background: rgba(16,185,129,.2); color: #10b981; }
    .swarm-agent__status-pill[data-status=error] { background: rgba(239,68,68,.2); color: #ef4444; }
    .swarm-agent__glob { font: 0.6rem/1.3 'JetBrains Mono', monospace; opacity: 0.5; word-break: break-all; margin: 0; }
    .swarm-agent__preview { font-size: 0.65rem; opacity: 0.7; margin: 0; font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .swarm-agent__duration { font: 0.65rem 'JetBrains Mono', monospace; color: var(--ps-accent, #00e5ff); }
    .swarm-agent__conflict-badge { font-size: 0.6rem; background: rgba(245,158,11,.15); color: #f59e0b; padding: 0.1rem 0.4rem; border-radius: 4px; }
    /* Empty */
    .swarm-empty { text-align: center; padding: 3rem 1rem; opacity: 0.6; }
    .swarm-empty__cta { color: var(--ps-accent, #00e5ff); background: none; border: 1px solid; padding: 0.375rem 0.875rem; border-radius: 9999px; cursor: pointer; }
    /* Progressive preview */
    .swarm-preview { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 0.75rem; margin-bottom: 1.5rem; }
    .swarm-preview__title { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.25rem; }
    .swarm-preview__sub { font-size: 0.7rem; opacity: 0.5; margin: 0 0 0.75rem; }
    .swarm-preview__progress-bar { background: rgba(255,255,255,.08); border-radius: 9999px; height: 4px; margin-bottom: 0.75rem; overflow: hidden; }
    .swarm-preview__progress-fill { background: var(--ps-accent, #00e5ff); height: 100%; border-radius: 9999px; transition: width 0.4s ease; }
    .swarm-preview__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 0.375rem; }
    .swarm-preview__slot { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 6px; padding: 0.375rem 0.5rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.65rem; min-height: 28px; transition: all 0.3s; }
    .swarm-preview__slot--done { border-color: #10b981; background: rgba(16,185,129,.06); }
    .swarm-preview__slot--active { border-color: var(--ps-accent, #00e5ff); animation: agent-pulse 1.5s ease-in-out infinite; }
    .swarm-preview__slot-name { opacity: 0.8; }
    .swarm-preview__slot-tick { color: #10b981; font-size: 0.75rem; }
    .swarm-preview__slot-spinner { color: var(--ps-accent, #00e5ff); animation: spin 1s linear infinite; display: inline-block; font-size: 0.75rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .swarm-preview__slot-skeleton { width: 24px; height: 6px; background: rgba(255,255,255,.08); border-radius: 3px; animation: shimmer 1.5s ease-in-out infinite; }
    @keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:.8} }
    .swarm-preview__connect { margin-top: 0.75rem; background: rgba(0,229,255,.1); border: 1px solid rgba(0,229,255,.3); color: var(--ps-accent, #00e5ff); padding: 0.375rem 0.875rem; border-radius: 9999px; font-size: 0.75rem; cursor: pointer; }
    /* History */
    .swarm-history h2 { font-size: 0.875rem; margin: 0 0 0.75rem; }
    .swarm-history__table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    .swarm-history__table th { text-align: left; padding: 0.375rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,.1); font-size: 0.65rem; text-transform: uppercase; letter-spacing: .05em; opacity: 0.5; }
    .swarm-history__row { cursor: pointer; }
    .swarm-history__row:hover td { background: rgba(255,255,255,.03); }
    .swarm-history__row td { padding: 0.25rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,.05); max-height: 36px; vertical-align: middle; }
    .swarm-history__id { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; opacity: 0.7; }
    .swarm-history__prompt { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .swarm-history__status-pill { font-size: 0.6rem; padding: 0.1rem 0.4rem; border-radius: 9999px; background: rgba(255,255,255,.08); }
    .swarm-history__status-pill[data-status=done] { background: rgba(16,185,129,.15); color: #10b981; }
    .swarm-history__status-pill[data-status=running] { background: rgba(0,229,255,.15); color: #00e5ff; }
  `],
})
export class AdminSwarmComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  readonly siteId = signal<string>('');
  readonly loading = signal(false);
  readonly running = signal(false);
  readonly currentRun = signal<SwarmRun | null>(null);
  readonly runHistory = signal<SwarmRun[]>([]);
  readonly sseConnected = signal(false);
  readonly componentsReady = signal<string[]>([]);
  readonly activeComponent = signal<string | null>(null);

  readonly skeletonSlots = ['nav', 'hero', 'features', 'social-proof', 'pricing', 'testimonials', 'faq', 'cta', 'footer'];

  readonly agentsDone = computed(() => {
    const run = this.currentRun();
    if (!run) return 0;
    return run.agents.filter((a: AgentSlot) => a.status === 'done').length;
  });

  readonly conflictsDetected = computed(() => {
    const run = this.currentRun();
    if (!run) return 0;
    return run.agents.filter((a: AgentSlot) => a.conflict_detected).length;
  });

  readonly progressPct = computed(() => {
    const run = this.currentRun();
    if (!run) return 0;
    return Math.round((this.agentsDone() / run.agents.length) * 100);
  });

  private sseSource: EventSource | null = null;

  ngOnInit() {
    this.siteId.set(this.route.snapshot.paramMap.get('siteId') ?? '');
    this.loadHistory();
  }

  ngOnDestroy() {
    this.disconnectSse();
  }

  loadHistory() {
    if (!this.siteId()) return;
    this.loading.set(true);
    this.http.get<{ runs: SwarmRun[] }>(`/api/swarm/${this.siteId()}/runs`)
      .pipe(catchError(() => of({ runs: [] as SwarmRun[] })))
      .subscribe((res: { runs: SwarmRun[] }) => {
        this.runHistory.set(res.runs ?? []);
        if (res.runs?.[0]) this.currentRun.set(res.runs[0]);
        this.loading.set(false);
        this.cdr.markForCheck();
      });
  }

  startSwarm() {
    if (this.running()) return;
    this.running.set(true);
    this.http.post<SwarmRun>(`/api/swarm/${this.siteId()}/start`, {
      prompt: 'Improve all site sections with 7 parallel specialists',
    }).pipe(catchError((_e: unknown) => {
      this.running.set(false);
      return of(null as SwarmRun | null);
    })).subscribe((run: SwarmRun | null) => {
      if (run) {
        this.currentRun.set(run);
        this.runHistory.update((h: SwarmRun[]) => [run, ...h]);
        this.connectSse();
      } else {
        this.running.set(false);
      }
      this.cdr.markForCheck();
    });
  }

  connectSse() {
    if (this.sseConnected()) return;
    const run = this.currentRun();
    const url = `/api/swarm/${this.siteId()}/stream${run ? `?run_id=${run.run_id}` : ''}`;
    this.sseSource = new EventSource(url);
    this.sseConnected.set(true);

    this.sseSource.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as {
          type: string; agent?: string; component?: string; progress_pct?: number;
        };
        if (data.type === 'agent_done' && data.agent) {
          this.currentRun.update((r: SwarmRun | null) => {
            if (!r) return r;
            return {
              ...r,
              agents: r.agents.map((a: AgentSlot) =>
                a.name === data.agent ? { ...a, status: 'done' as AgentStatus } : a,
              ),
            };
          });
        }
        if (data.type === 'component_ready' && data.component) {
          this.componentsReady.update((prev) => [...prev, data.component!]);
          this.activeComponent.set(data.component ?? null);
        }
        if (data.type === 'swarm_complete' || data.type === 'all_components_ready') {
          this.running.set(false);
          this.disconnectSse();
        }
        this.cdr.markForCheck();
      } catch { /* ignore malformed */ }
    };

    this.sseSource.onerror = () => {
      this.sseConnected.set(false);
      this.running.set(false);
      this.cdr.markForCheck();
    };
  }

  disconnectSse() {
    this.sseSource?.close();
    this.sseSource = null;
    this.sseConnected.set(false);
  }

  selectRun(run: SwarmRun) {
    this.currentRun.set(run);
    this.cdr.markForCheck();
  }

  isComponentDone(name: string) { return this.componentsReady().includes(name); }
  isComponentActive(name: string) { return this.activeComponent() === name; }
  agentIcon(name: string) { return SPECIALIST_ICONS[name] ?? '🤖'; }
  agentColor(name: string) { return SPECIALIST_COLORS[name] ?? '#00e5ff'; }
  statusLabel(s: AgentStatus) {
    return { queued: 'Waiting', running: 'Running', done: 'Done', error: 'Error' }[s] ?? s;
  }
  doneCount(agents: AgentSlot[]) { return agents.filter((a: AgentSlot) => a.status === 'done').length; }
}
