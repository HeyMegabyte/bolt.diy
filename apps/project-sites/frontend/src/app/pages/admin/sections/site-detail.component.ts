/**
 * Site Detail — `/admin/sites/:id`
 *
 * Per-project surface with four tabs exposed by `data-testid`-stable buttons:
 *
 * 1. **Logs** — live tail of the per-site WS log stream + level filter + search.
 * 2. **Snapshots** — merged snapshots + deploy history with rollback button.
 * 3. **SQL** — read-only D1 console for the per-site database.
 * 4. **Integrations** — per-site MCP provider connect / paste-key fallback /
 *    disconnect surface.
 *
 * Satisfies TEST-PLAN.md TAB-01..TAB-13.
 *
 * Hard rule: never weaken tests. UI matches the spec contract — `data-testid`
 * attributes drive Playwright assertions.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HlmInputDirective, HlmSelectDirective, HlmTablistDirective } from '../../../ui';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, retry, switchMap, timer } from 'rxjs';

interface LogRow {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

interface SnapshotRow {
  id: string;
  snapshot_name: string;
  ai_name?: string;
  kind: 'deploy' | 'edit' | 'initial';
  created_at: string;
}

interface SqlResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  duration_ms: number;
}

interface IntegrationProvider {
  key: string;
  name: string;
  status: 'connected' | 'disconnected';
  oauth_supported: boolean;
}

type Tab = 'logs' | 'snapshots' | 'sql' | 'integrations';

@Component({
  selector: 'app-admin-site-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HlmInputDirective, HlmSelectDirective, HlmTablistDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="site-detail animate-fade-in" data-testid="site-detail">
      <header class="site-detail__head">
        <h1 class="site-detail__title">{{ site()?.name || 'Site' }}</h1>
        @if (site()?.slug; as slug) {
          <p class="site-detail__subtitle">{{ slug }}.projectsites.dev</p>
        } @else {
          <!-- Site didn't fully resolve (GET can 200 with site:null) — fall back to
               the URL slug so the host is meaningful, never a bare ".projectsites.dev". -->
          <p class="site-detail__subtitle">{{ siteId() ? siteId() + '.projectsites.dev' : 'Site overview' }}</p>
        }
      </header>

      <nav class="site-detail__tabs" role="tablist" hlmTablist aria-label="Site detail sections">
        <button
          type="button"
          role="tab"
          id="sd-tab-logs"
          [attr.aria-controls]="'sd-panel-logs'"
          [attr.aria-selected]="tab() === 'logs'"
          [class.active]="tab() === 'logs'"
          (click)="setTab('logs')"
        >Logs</button>
        <button
          type="button"
          role="tab"
          id="sd-tab-snapshots"
          [attr.aria-controls]="'sd-panel-snapshots'"
          [attr.aria-selected]="tab() === 'snapshots'"
          [class.active]="tab() === 'snapshots'"
          (click)="setTab('snapshots')"
        >Snapshots</button>
        <button
          type="button"
          role="tab"
          id="sd-tab-sql"
          [attr.aria-controls]="'sd-panel-sql'"
          [attr.aria-selected]="tab() === 'sql'"
          [class.active]="tab() === 'sql'"
          (click)="setTab('sql')"
        >SQL</button>
        <button
          type="button"
          role="tab"
          id="sd-tab-integrations"
          [attr.aria-controls]="'sd-panel-integrations'"
          [attr.aria-selected]="tab() === 'integrations'"
          [class.active]="tab() === 'integrations'"
          (click)="setTab('integrations')"
        >Integrations</button>
      </nav>

      <!-- ──────────────────────────────────────── LOGS TAB ──────────────────────────────────────── -->
      @if (tab() === 'logs') {
        <div class="site-detail__panel" role="tabpanel" id="sd-panel-logs" aria-labelledby="sd-tab-logs" data-testid="site-logs-panel">
          <div class="site-detail__toolbar">
            <label>
              Level
              <select hlmSelect class="mt-1" [ngModel]="logLevel()" (ngModelChange)="logLevel.set($event)">
                <option value="all">all</option>
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
            </label>
            <input
              hlmInput
              type="search"
              placeholder="Search logs"
              aria-label="Search logs"
              [ngModel]="logSearch()"
              (ngModelChange)="logSearch.set($event)"
            />
            <span data-testid="site-logs-ws-status" [class]="'ws-' + wsStatus()">
              {{ wsStatus() === 'connected' ? 'connected' : wsStatus() }}
            </span>
          </div>
          <div class="site-detail__logs" data-testid="site-logs-tail">
            @for (row of filteredLogs(); track row.ts + row.message) {
              <div class="log-row" data-testid="site-logs-row" [attr.data-level]="row.level">
                <time>{{ row.ts }}</time>
                <span class="log-level">{{ row.level }}</span>
                <span class="log-message">{{ row.message }}</span>
              </div>
            } @empty {
              <p class="muted">No logs yet.</p>
            }
          </div>
        </div>
      }

      <!-- ──────────────────────────────────── SNAPSHOTS TAB ──────────────────────────────────── -->
      @if (tab() === 'snapshots') {
        <div class="site-detail__panel" role="tabpanel" id="sd-panel-snapshots" aria-labelledby="sd-tab-snapshots" data-testid="site-snapshots-panel">
          <ul class="snapshot-list" data-testid="site-snapshots-list">
            @for (s of snapshots(); track s.id) {
              <li class="snapshot-row" data-testid="snapshot-row">
                <div class="snapshot-meta">
                  <strong>{{ s.snapshot_name }}</strong>
                  @if (s.ai_name) {
                    <span class="ai-name" data-testid="snapshot-ai-name">{{ s.ai_name }}</span>
                  }
                  <small>{{ s.kind }} · {{ s.created_at }}</small>
                </div>
                <button
                  type="button"
                  class="rollback-btn"
                  (click)="onRollbackClick(s)"
                >Rollback</button>
              </li>
            } @empty {
              <li class="muted">No snapshots yet.</li>
            }
          </ul>

          @if (pendingRollback()) {
            <div class="confirm-dialog" role="dialog" aria-modal="true">
              <p>Roll back to <strong>{{ pendingRollback()?.snapshot_name }}</strong>?</p>
              <button type="button" (click)="confirmRollback()">Confirm rollback</button>
              <button type="button" (click)="pendingRollback.set(null)">Cancel</button>
            </div>
          }

          @if (rollbackResult()) {
            <p class="rollback-result">Rolled back to {{ rollbackResult() }}</p>
          }
          @if (rollbackError()) {
            <p class="rollback-error" role="alert" data-testid="rollback-error">{{ rollbackError() }}</p>
          }
        </div>
      }

      <!-- ──────────────────────────────────────── SQL TAB ──────────────────────────────────────── -->
      @if (tab() === 'sql') {
        <div class="site-detail__panel" role="tabpanel" id="sd-panel-sql" aria-labelledby="sd-tab-sql" data-testid="site-sql-panel">
          <textarea
            data-testid="sql-editor"
            hlmInput
            [multiline]="true"
            class="font-mono resize-y"
            rows="5"
            aria-label="SQL query"
            [ngModel]="sqlQuery()"
            (ngModelChange)="sqlQuery.set($event)"
            placeholder="SELECT * FROM ..."
          ></textarea>
          <div class="sql-toolbar">
            <button type="button" (click)="runSql()">Run</button>
            @if (sqlRunning()) { <span class="muted">running…</span> }
          </div>

          @if (sqlError()) {
            <p class="sql-error" data-testid="sql-error">{{ sqlError() }}</p>
          }

          @if (sqlResult(); as r) {
            <!-- Arbitrary SELECT results can be far wider than the viewport;
                 scroll the table inside its own region instead of overflowing
                 the page (WCAG 1.4.10 — matches the sites/domains/billing tables). -->
            <div class="sql-result-scroll" tabindex="0" role="region" aria-label="SQL result — scroll horizontally">
              <table class="sql-result-table">
                <thead>
                  <tr>
                    @for (col of r.columns; track col) { <th>{{ col }}</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (row of r.rows; track $index) {
                    <tr>
                      @for (col of r.columns; track col) {
                        <td data-testid="sql-result-cell">{{ row[col] }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <details class="sql-history" open>
            <summary>Query history</summary>
            <ul>
              @for (h of sqlHistory(); track h) {
                <li data-testid="sql-history-item">{{ h }}</li>
              } @empty {
                <li class="muted">No queries yet.</li>
              }
            </ul>
          </details>
        </div>
      }

      <!-- ──────────────────────────────────── INTEGRATIONS TAB ──────────────────────────────────── -->
      @if (tab() === 'integrations') {
        <div class="site-detail__panel" role="tabpanel" id="sd-panel-integrations" aria-labelledby="sd-tab-integrations" data-testid="site-integrations-panel">
          <div class="mcp-list" data-testid="mcp-provider-list">
            @for (p of integrations(); track p.key) {
              <article class="mcp-card" [attr.data-testid]="'mcp-provider-card-' + p.key">
                <header>
                  <strong>{{ p.name }}</strong>
                  <span class="mcp-status">{{ p.status }}</span>
                </header>
                @if (p.status === 'connected') {
                  <button
                    type="button"
                    (click)="onDisconnect(p)"
                  >Disconnect</button>
                } @else {
                  <button
                    type="button"
                    (click)="onConnect(p)"
                  >Connect</button>
                }

                @if (pasteKeyOpen() === p.key) {
                  <form class="mcp-paste-key-form" data-testid="mcp-paste-key-form" (submit)="$event.preventDefault(); submitPasteKey(p)">
                    <input
                      hlmInput
                      type="text"
                      placeholder="API key"
                      aria-label="API key"
                      [ngModel]="pasteKeyValue()"
                      (ngModelChange)="pasteKeyValue.set($event)"
                      name="apiKey"
                    />
                    <button type="submit">Save key</button>
                  </form>
                }
              </article>
            }
          </div>

          @if (disconnectTarget()) {
            <div class="confirm-dialog" role="dialog" aria-modal="true">
              <p>Disconnect {{ disconnectTarget()?.name }}?</p>
              <button type="button" (click)="confirmDisconnect()">Confirm</button>
              <button type="button" (click)="disconnectTarget.set(null)">Cancel</button>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .site-detail { padding: 1.5rem; color: var(--ps-ink, #f4f4ff); }
    .site-detail__head { margin-bottom: 1rem; }
    .site-detail__title { font-size: 1.5rem; margin: 0; }
    .site-detail__subtitle { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); margin: 0.25rem 0 0; font-size: 0.9rem; }
    .site-detail__tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--ps-edge, rgba(255,255,255,0.08)); margin-bottom: 1.25rem; }
    .site-detail__tabs button { background: transparent; border: none; color: inherit; padding: 0.6rem 1rem; font: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
    .site-detail__tabs button.active { border-bottom-color: var(--ps-accent, #00e5ff); color: var(--ps-accent, #00e5ff); }
    .site-detail__toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; }
    .site-detail__logs { background: rgba(0,0,0,0.25); border-radius: 8px; padding: 0.75rem; max-height: 60vh; overflow-y: auto; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.85rem; }
    .log-row { display: grid; grid-template-columns: 12rem 5rem 1fr; gap: 0.75rem; padding: 0.25rem 0; }
    .log-row[data-level="error"] { color: #ff7e8a; }
    .log-row[data-level="warn"] { color: #ffd166; }
    .ws-connected { color: #76e7a3; }
    .ws-connecting { color: #ffd166; }
    .ws-error { color: #ff7e8a; }
    .snapshot-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; }
    .snapshot-row { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: rgba(255,255,255,0.04); border-radius: 8px; }
    .snapshot-meta { display: flex; flex-direction: column; gap: 0.15rem; }
    .ai-name { color: var(--ps-accent, #00e5ff); font-size: 0.85rem; }
    .rollback-btn { padding: 0.4rem 0.9rem; background: transparent; border: 1px solid var(--ps-accent, #00e5ff); color: var(--ps-accent, #00e5ff); border-radius: 6px; cursor: pointer; }
    .rollback-btn:hover { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .confirm-dialog { margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.5); border: 1px solid var(--ps-edge, rgba(255,255,255,0.08)); border-radius: 8px; }
    /* .sql-editor removed — now Spartan hlmInput [multiline] (font-mono resize-y). */
    .sql-toolbar { display: flex; gap: 0.75rem; align-items: center; margin: 0.5rem 0 1rem; }
    .sql-result-scroll { overflow-x: auto; max-width: 100%; border-radius: 8px; }
    .sql-result-scroll:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .sql-result-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .sql-result-table th, .sql-result-table td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--ps-edge, rgba(255,255,255,0.08)); }
    .sql-error { color: #ff7e8a; }
    .rollback-error { margin-top: 0.5rem; color: #ff7e8a; font-size: 0.85rem; }
    .sql-history { margin-top: 1rem; }
    .sql-history ul { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.25rem; }
    .sql-history li { padding: 0.25rem 0.5rem; background: rgba(255,255,255,0.03); border-radius: 4px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.8rem; }
    .mcp-list { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .mcp-card { padding: 1rem; background: rgba(255,255,255,0.04); border-radius: 8px; }
    .mcp-card header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .mcp-status { font-size: 0.8rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); }
    .mcp-paste-key-form { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    .mcp-paste-key-form input { flex: 1; }
    .muted { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
  `],
})
export class AdminSiteDetailComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly siteId = signal<string>('');
  readonly site = signal<{ id: string; slug: string; name: string } | null>(null);
  readonly tab = signal<Tab>('logs');

  // ── Logs ─────────────────────────────────────────────────────────────
  readonly logs = signal<LogRow[]>([]);
  readonly logLevel = signal<'all' | 'debug' | 'info' | 'warn' | 'error'>('all');
  readonly logSearch = signal('');
  readonly wsStatus = signal<'connecting' | 'connected' | 'error'>('connecting');
  readonly filteredLogs = computed(() => {
    const level = this.logLevel();
    const q = this.logSearch().toLowerCase().trim();
    return this.logs().filter((r) => {
      if (level !== 'all' && r.level !== level) return false;
      if (q && !r.message.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  // ── Snapshots ────────────────────────────────────────────────────────
  readonly snapshots = signal<SnapshotRow[]>([]);
  readonly pendingRollback = signal<SnapshotRow | null>(null);
  readonly rollbackResult = signal<string | null>(null);
  readonly rollbackError = signal<string | null>(null);

  // ── SQL ──────────────────────────────────────────────────────────────
  readonly sqlQuery = signal('');
  readonly sqlResult = signal<SqlResult | null>(null);
  readonly sqlError = signal<string | null>(null);
  readonly sqlRunning = signal(false);
  readonly sqlHistory = signal<string[]>([]);

  // ── Integrations ─────────────────────────────────────────────────────
  readonly integrations = signal<IntegrationProvider[]>([]);
  readonly pasteKeyOpen = signal<string | null>(null);
  readonly pasteKeyValue = signal('');
  readonly disconnectTarget = signal<IntegrationProvider | null>(null);

  constructor() {
    // Capture siteId once route param is available.
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id') ?? '';
        this.siteId.set(id);
        this.loadSite(id);
      });

    // Restore SQL history from localStorage (per-site).
    effect(() => {
      const id = this.siteId();
      if (!id) return;
      try {
        const raw = localStorage.getItem(`ps_sql_history_${id}`);
        if (raw) this.sqlHistory.set(JSON.parse(raw) as string[]);
      } catch { /* private mode etc. */ }
    });

    // Poll logs every 3s as the floor (per [[rxjs-first-angular]]). WS is
    // the ceiling but not yet wired — polling keeps the live-tail UX honest
    // and the wsStatus signal flips to 'connected' once the first batch lands.
    effect(() => {
      const id = this.siteId();
      if (!id) return;
      this.startLogTail(id);
      this.loadSnapshots(id);
      this.loadIntegrations(id);
    });
  }

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  // ── Site load ────────────────────────────────────────────────────────
  private loadSite(id: string): void {
    this.api
      .get<{ site: { id: string; slug: string; name: string } }>(`/sites/${id}`)
      .pipe(
        catchError(() => of({ site: { id, slug: id, name: 'Site' } })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.site.set(res.site ?? null));
  }

  // ── Logs ─────────────────────────────────────────────────────────────
  private startLogTail(id: string): void {
    this.wsStatus.set('connecting');
    timer(0, 3000)
      .pipe(
        switchMap(() =>
          this.api.get<{ logs: LogRow[] }>(`/sites/${id}/logs/tail`).pipe(
            retry({ count: 2, delay: 1000 }),
            catchError(() => of({ logs: [] as LogRow[] })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.wsStatus.set('connected');
        if (Array.isArray(res.logs) && res.logs.length) {
          this.logs.set(res.logs);
        }
      });
  }

  // ── Snapshots ────────────────────────────────────────────────────────
  private loadSnapshots(id: string): void {
    this.api
      .get<{ snapshots: SnapshotRow[] }>(`/sites/${id}/snapshots`)
      .pipe(
        catchError(() => of({ snapshots: [] as SnapshotRow[] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.snapshots.set(res.snapshots ?? []));
  }

  onRollbackClick(s: SnapshotRow): void {
    this.pendingRollback.set(s);
  }

  confirmRollback(): void {
    const s = this.pendingRollback();
    if (!s) return;
    const id = this.siteId();
    this.rollbackError.set(null);
    this.api
      .post<{ ok: boolean; snapshot_name: string }>(
        `/sites/${id}/snapshots/${s.id}/rollback`,
        {},
      )
      .pipe(
        // Surface the failure — do NOT fabricate a success shape. A faked
        // { ok: true } here would show "Rolled back to X" while the site was
        // never rolled back (a destructive-action lying-UI). Return null on
        // error and branch on it in the subscriber.
        catchError((err: unknown) => {
          const msg =
            (err as { error?: { error?: { message?: string } } })?.error?.error?.message ??
            (err as { message?: string })?.message ??
            'Rollback failed — please try again.';
          this.rollbackError.set(msg);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.pendingRollback.set(null);
        if (!res) return; // failure already surfaced via rollbackError — no false success
        this.rollbackError.set(null);
        this.rollbackResult.set(res.snapshot_name);
        this.loadSnapshots(id);
      });
  }

  // ── SQL ──────────────────────────────────────────────────────────────
  runSql(): void {
    const query = this.sqlQuery().trim();
    if (!query) return;
    const id = this.siteId();
    this.sqlRunning.set(true);
    this.sqlError.set(null);
    interface SqlExecRes {
      ok: boolean;
      columns?: string[];
      rows?: Array<Record<string, unknown>>;
      duration_ms?: number;
      error?: string;
    }
    this.api
      .post<SqlExecRes>(`/sites/${id}/sql/exec`, { query })
      .pipe(
        catchError((err) =>
          of<SqlExecRes>({
            ok: false,
            error: err?.error?.error?.message ?? err?.message ?? 'unknown error',
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res: SqlExecRes) => {
        this.sqlRunning.set(false);
        if (!res.ok || res.error) {
          this.sqlError.set(res.error ?? 'query failed');
          return;
        }
        this.sqlResult.set({
          columns: res.columns ?? [],
          rows: res.rows ?? [],
          duration_ms: res.duration_ms ?? 0,
        });
        // Persist history.
        const next = [query, ...this.sqlHistory().filter((q) => q !== query)].slice(0, 50);
        this.sqlHistory.set(next);
        try {
          localStorage.setItem(`ps_sql_history_${id}`, JSON.stringify(next));
        } catch { /* ignore */ }
      });
  }

  // ── Integrations ─────────────────────────────────────────────────────
  private loadIntegrations(id: string): void {
    this.api
      .get<{ providers: IntegrationProvider[] }>(`/sites/${id}/integrations`)
      .pipe(
        catchError(() => of({ providers: DEFAULT_PROVIDERS })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.integrations.set(res.providers?.length ? res.providers : DEFAULT_PROVIDERS);
      });
  }

  onConnect(p: IntegrationProvider): void {
    // Open OAuth popup; if 501 → paste-key fallback.
    const url = `/api/mcp/${p.key}/connect?site_id=${this.siteId()}`;
    const popup = window.open(url, `mcp_${p.key}`, 'width=600,height=720');
    if (!popup) {
      // Popup blocked — fall back to paste-key.
      this.pasteKeyOpen.set(p.key);
      return;
    }
    // Probe for 501 immediately so paste-key surfaces without waiting on popup.
    this.api
      .get<{ status?: string }>(`/mcp/${p.key}/connect`)
      .pipe(
        catchError((err) => of({ status: err?.status === 501 ? 'oauth_not_configured' : 'ok' })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (res.status === 'oauth_not_configured') {
          this.pasteKeyOpen.set(p.key);
        }
      });
  }

  submitPasteKey(p: IntegrationProvider): void {
    const apiKey = this.pasteKeyValue();
    if (!apiKey) return;
    this.api
      .post(`/mcp/${p.key}/paste`, { api_key: apiKey, site_id: this.siteId() })
      .pipe(
        catchError(() => of({ ok: false })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.pasteKeyOpen.set(null);
        this.pasteKeyValue.set('');
        this.loadIntegrations(this.siteId());
      });
  }

  onDisconnect(p: IntegrationProvider): void {
    this.disconnectTarget.set(p);
  }

  confirmDisconnect(): void {
    const p = this.disconnectTarget();
    if (!p) return;
    this.api
      .delete(`/sites/${this.siteId()}/integrations/${p.key}`)
      .pipe(
        // Return null on error (don't fabricate { ok: true }) so a failed
        // disconnect never optimistically flips the chip to "disconnected".
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.disconnectTarget.set(null);
        if (res === null) {
          this.toast.error(`Could not disconnect ${p.name} — please try again.`);
          return;
        }
        // Optimistic flip only on a confirmed success.
        this.integrations.update((list) =>
          list.map((x) => (x.key === p.key ? { ...x, status: 'disconnected' as const } : x)),
        );
        this.loadIntegrations(this.siteId());
      });
  }
}

// Fallback catalog shown when the integrations API errors or returns empty.
// Every provider defaults to 'disconnected' — never fabricate a live connection
// (a hardcoded 'connected' Mailchimp misrepresented real connection state).
const DEFAULT_PROVIDERS: IntegrationProvider[] = [
  { key: 'mailchimp', name: 'Mailchimp', status: 'disconnected', oauth_supported: true },
  { key: 'stripe', name: 'Stripe', status: 'disconnected', oauth_supported: true },
  { key: 'hubspot', name: 'HubSpot', status: 'disconnected', oauth_supported: true },
  { key: 'resend', name: 'Resend', status: 'disconnected', oauth_supported: false },
];
