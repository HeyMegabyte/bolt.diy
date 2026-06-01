/**
 * @module pages/admin/sections/domain-stack
 *
 * @description
 * Domain Stack One-Click Wizard admin surface.
 *
 * Renders a 7-tile progress board for the domain stack run associated with
 * the current site's primary hostname. Polls `GET /api/domains/:hostname/stack-status`
 * every 4s while any step is in_progress and auto-advances via
 * `POST /api/domains/:hostname/stack`.
 *
 * Route: `/admin/domains/:id/stack`
 *
 * Design tokens: `--ps-bg`, `--ps-ink`, `--ps-accent`. All numbers use
 * `<app-rolling-counter>`; every section uses `appReveal`.
 *
 * @packageDocumentation
 */
import {
  Component, inject, signal, computed, effect, OnDestroy, input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { RevealDirective } from '../../../directives/reveal.directive';

interface StackTile {
  readonly step: string;
  readonly label: string;
  readonly status: 'pending' | 'in_progress' | 'done' | 'error';
  readonly error: string | null;
  readonly data: unknown;
}

interface StackStatusResponse {
  data: {
    run_id: string;
    hostname: string;
    state: string;
    tiles: StackTile[];
    done_at: string | null;
    last_error: string | null;
    retries: number;
  };
}

interface StackAdvanceResponse {
  data: { run_id: string; state: string; step_results: Record<string, unknown>; last_error: string | null };
}

@Component({
  selector: 'app-domain-stack',
  standalone: true,
  imports: [RevealDirective, CommonModule, RouterLink, RollingCounterComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 space-y-6">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="kicker">Domain Stack</div>
          <h2 class="section-h text-lg font-bold text-white m-0">
            One-Click Stack Wizard
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Configures DNS, SSL, email auth, security.txt, and Google Search Console in one pass.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a routerLink="/admin/domains" class="btn-ghost text-xs">← Domains</a>
          @if (canAdvance()) {
            <button class="btn-primary text-xs" (click)="advance()" [disabled]="advancing()">
              {{ advancing() ? 'Running…' : 'Advance' }}
            </button>
          }
          @if (runId()) {
            <button class="btn-ghost text-xs" (click)="refresh()" [disabled]="loading()">Refresh</button>
          }
        </div>
      </header>

      <!-- No site selected -->
      @if (!state.selectedSite()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">Select a site to start the domain stack wizard.</p>
        </div>
      }

      <!-- Hostname missing -->
      @if (state.selectedSite() && !hostname()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">This site has no primary custom hostname yet.</p>
          <a routerLink="/admin/domains" class="btn-ghost text-xs mt-3">Add Domain →</a>
        </div>
      }

      <!-- Progress board -->
      @if (hostname() && tiles().length > 0) {
        <section class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          @for (tile of tiles(); track tile.step) {
            <div class="stack-tile" [attr.data-status]="tile.status">
              <!-- Status icon -->
              <div class="tile-icon">
                @if (tile.status === 'done') { <span class="text-[--ps-accent]">✓</span> }
                @if (tile.status === 'in_progress') { <span class="tile-spin">⟳</span> }
                @if (tile.status === 'pending') { <span class="text-text-secondary">○</span> }
                @if (tile.status === 'error') { <span class="text-red-400">✗</span> }
              </div>
              <p class="tile-label">{{ tile.label }}</p>
              @if (tile.error) {
                <p class="tile-error" title="{{ tile.error }}">{{ tile.error | slice:0:60 }}</p>
              }
            </div>
          }
        </section>

        <!-- Summary stats -->
        <div class="flex gap-6 text-xs text-text-secondary">
          <span>Done: <app-rolling-counter [value]="doneCount()" /></span>
          <span>Pending: <app-rolling-counter [value]="pendingCount()" /></span>
          <span>Retries: <app-rolling-counter [value]="retries()" /></span>
        </div>

        @if (currentState() === 'done') {
          <div class="callout-success text-sm">
            Stack complete — domain is fully configured.
          </div>
        }
        @if (currentState() === 'error') {
          <div class="callout-error text-sm">
            {{ lastError() ?? 'Stack errored — see tile above.' }}
          </div>
        }
      }

      @if (hostname() && tiles().length === 0 && !loading()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">No stack run yet for <strong class="text-white">{{ hostname() }}</strong>.</p>
          <button class="btn-primary text-xs mt-3" (click)="start()">Start Wizard</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .stack-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.07);
      background: rgba(0,229,255,.03);
      text-align: center;
      transition: border-color .2s;
    }
    .stack-tile[data-status="done"]        { border-color: rgba(0,229,255,.35); }
    .stack-tile[data-status="in_progress"] { border-color: rgba(255,200,0,.4); animation: pulse 1.5s infinite; }
    .stack-tile[data-status="error"]       { border-color: rgba(255,80,80,.4); }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
    .tile-icon { font-size:1.2rem; line-height:1; }
    .tile-spin { display:inline-block; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .tile-label { font-size:.65rem; color: var(--ps-ink,#f4f4ff); opacity:.8; margin:0; line-height:1.3; }
    .tile-error  { font-size:.58rem; color: #f87171; margin:0; word-break:break-word; }
    .callout-success { background:rgba(0,229,255,.08); border:1px solid rgba(0,229,255,.3); border-radius:8px; padding:10px 14px; color:var(--ps-accent,#00e5ff); }
    .callout-error   { background:rgba(255,80,80,.08); border:1px solid rgba(255,80,80,.3); border-radius:8px; padding:10px 14px; color:#f87171; }
  `],
})
export class AdminDomainStackComponent implements OnDestroy {
  protected readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly tiles = signal<StackTile[]>([]);
  readonly currentState = signal<string>('');
  readonly lastError = signal<string | null>(null);
  readonly retries = signal<number>(0);
  readonly runId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly advancing = signal(false);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  readonly hostname = computed(() => {
    const site = this.state.selectedSite();
    return site?.primary_hostname ?? null;
  });

  readonly doneCount = computed(() => this.tiles().filter((t) => t.status === 'done').length);
  readonly pendingCount = computed(() => this.tiles().filter((t) => t.status === 'pending').length);
  readonly canAdvance = computed(() => {
    const s = this.currentState();
    return this.hostname() && s !== 'done' && s !== 'error';
  });

  constructor() {
    effect(() => {
      if (this.hostname()) this.refresh();
    });
  }

  ngOnDestroy() { this.stopPoll(); }

  refresh() {
    const hn = this.hostname();
    if (!hn) return;
    this.loading.set(true);
    this.api.get<StackStatusResponse>(`/api/domains/${encodeURIComponent(hn)}/stack-status`).subscribe({
      next: (res) => {
        const d = res.data;
        this.tiles.set(d.tiles ?? []);
        this.currentState.set(d.state);
        this.lastError.set(d.last_error);
        this.retries.set(d.retries ?? 0);
        this.runId.set(d.run_id);
        this.loading.set(false);
        if (d.state === 'in_progress' || d.tiles.some((t) => t.status === 'in_progress')) {
          this.startPoll();
        } else {
          this.stopPoll();
        }
      },
      error: (err) => {
        // 404 = no run yet; treat as empty
        if (err?.status === 404) { this.loading.set(false); return; }
        this.toast.error('Failed to load stack status');
        this.loading.set(false);
      },
    });
  }

  start() {
    const hn = this.hostname();
    const siteId = this.state.selectedSite()?.id;
    if (!hn || !siteId) return;
    this.advance();
  }

  advance() {
    const hn = this.hostname();
    const siteId = this.state.selectedSite()?.id;
    if (!hn || !siteId) return;
    this.advancing.set(true);
    const body: Record<string, string> = { site_id: siteId };
    if (this.runId()) body['run_id'] = this.runId()!;
    this.api.post<StackAdvanceResponse>(`/api/domains/${encodeURIComponent(hn)}/stack`, body).subscribe({
      next: (res) => {
        this.currentState.set(res.data.state);
        this.advancing.set(false);
        this.refresh();
      },
      error: () => {
        this.toast.error('Failed to advance stack wizard');
        this.advancing.set(false);
      },
    });
  }

  private startPoll() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.refresh(), 4000);
  }

  private stopPoll() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}
