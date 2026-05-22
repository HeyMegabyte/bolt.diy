import { Component, inject, signal, effect, type OnInit, type OnDestroy } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ClientSideRowModelModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridReadyEvent,
  type GridApi,
  CsvExportModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ValidationModule,
  RowSelectionModule,
  type RowSelectionOptions,
} from 'ag-grid-community';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CsvExportModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  RowSelectionModule,
  ValidationModule,
]);

/**
 * Shape of an audit row as returned by `GET /api/audit-logs`. The `site`
 * field is populated server-side via a LEFT JOIN against `sites` (or a
 * metadata-JSON fallback) so the ag-grid `site` column always has data.
 */
interface AuditRow {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
  site: string | null;
}

/**
 * Admin audit-log surface. Renders the org's audit_logs as an ag-grid view
 * scoped to the currently-selected site, with an operator escape hatch to
 * widen the view to every row in the org. Auto-polls every 15s (paused when
 * the tab is hidden) — no manual Refresh button, no free-text search input.
 *
 * @example
 * ```html
 * <app-admin-audit />
 * <!-- Renders the auto-polling grid. The scope chip exposes the
 *      currently-selected site; clicking × clears the ag-grid filter. -->
 * ```
 */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [AgGridAngular],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-4">
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Audit Log</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Every privileged action — who, what, when, request ID. Auto-refreshing every 15s · last sync {{ lastSyncLabel() }}.
          </p>
        </div>
        <div class="flex gap-2 items-center">
          @if (scopeSlug(); as slug) {
            <button
              type="button"
              data-testid="audit-scope-chip"
              class="scope-chip"
              [title]="'Showing audit rows for ' + scopeName() + '. Click × to view every row in the org.'"
              (click)="clearScope()">
              Filtered to: {{ scopeName() }} <span class="x">×</span>
            </button>
          } @else {
            <span class="scope-chip scope-chip-all" data-testid="audit-scope-chip">All sites</span>
          }
          <button class="btn-ghost" (click)="exportCsv()">Export CSV</button>
        </div>
      </header>

      <div class="grid grid-cols-4 gap-3 text-[0.78rem]">
        <div class="card"><div class="muted-h">Events</div><div class="text-2xl font-bold text-white">{{ rows().length }}</div></div>
        <div class="card"><div class="muted-h">Unique actions</div><div class="text-2xl font-bold text-white">{{ uniqueActions() }}</div></div>
        <div class="card"><div class="muted-h">Last 24h</div><div class="text-2xl font-bold text-white">{{ last24h() }}</div></div>
        <div class="card"><div class="muted-h">Actors</div><div class="text-2xl font-bold text-white">{{ uniqueActors() }}</div></div>
      </div>

      <!-- Full-bleed grid — no card padding so AG-Grid claims maximum real estate. -->
      <div class="grid-frame">
        <ag-grid-angular
          data-testid="audit-grid"
          class="ag-grid-host"
          [theme]="theme"
          [rowData]="rows()"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
          [pagination]="true"
          [paginationPageSize]="50"
          [paginationPageSizeSelector]="[25, 50, 100, 250]"
          [rowSelection]="rowSelection"
          [animateRows]="true"
          [enableCellTextSelection]="true"
          (gridReady)="onGridReady($event)">
        </ag-grid-angular>
      </div>

      @if (selected(); as s) {
        <div class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">{{ s.action }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="selected.set(null)" aria-label="Close audit detail">×</button>
          </div>
          <div class="grid md:grid-cols-2 gap-3 text-[0.72rem]">
            <div><div class="muted-h">When</div><div>{{ s.created_at }}</div></div>
            <div><div class="muted-h">Request ID</div><div class="font-mono">{{ s.request_id }}</div></div>
            <div><div class="muted-h">Actor</div><div class="font-mono">{{ s.actor_id || '—' }}</div></div>
            <div><div class="muted-h">Target</div><div class="font-mono">{{ s.target_type }}:{{ s.target_id }}</div></div>
            <div><div class="muted-h">Site</div><div class="font-mono">{{ s.site || '—' }}</div></div>
          </div>
          <div class="mt-3">
            <div class="muted-h">Metadata</div>
            <pre class="bg-black/30 border border-white/5 rounded-lg p-3 text-[0.7rem] overflow-auto max-h-72">{{ pretty(s.metadata) }}</pre>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .btn-ghost { padding: 0.5rem 1rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .scope-chip { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.85rem; border-radius: 999px; background: rgba(0,229,255,0.10); color: #00E5FF; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; font-weight: 600; }
    .scope-chip:hover { background: rgba(0,229,255,0.18); }
    .scope-chip .x { font-size: 0.95rem; line-height: 1; opacity: 0.85; }
    .scope-chip-all { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.75); border-color: rgba(255,255,255,0.10); cursor: default; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 0.3rem; }
    .ag-grid-host { width: 100%; height: calc(100vh - 280px); min-height: 520px; }
    .grid-frame { width: 100%; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; overflow: hidden; background: rgba(0,0,0,0.18); }
  `],
})
export class AdminAuditComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  state = inject(AdminStateService);
  rows = signal<AuditRow[]>([]);
  loading = signal(false);
  selected = signal<AuditRow | null>(null);
  scopeSlug = signal<string | null>(null);
  scopeName = signal<string>('');
  lastSyncAt = signal<number>(0);
  private gridApi?: GridApi<AuditRow>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler?: () => void;

  /** Polling cadence in ms — matched to operator expectations for "live". */
  private static readonly POLL_MS = 15_000;

  theme = themeQuartz.withParams({
    backgroundColor: '#0a0a1a',
    foregroundColor: '#e5e7eb',
    headerBackgroundColor: '#0e0e22',
    headerTextColor: '#f5f5f7',
    rowHoverColor: 'rgba(0, 229, 255, 0.06)',
    selectedRowBackgroundColor: 'rgba(0, 229, 255, 0.14)',
    accentColor: '#00E5FF',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    rowBorder: { color: 'rgba(255, 255, 255, 0.04)' },
    headerColumnBorder: false,
    spacing: 6,
    fontSize: 12,
  });

  rowSelection: RowSelectionOptions = { mode: 'singleRow', checkboxes: false, enableClickSelection: true };

  defaultColDef: ColDef = {
    sortable: true, filter: true, resizable: true, flex: 1, minWidth: 120,
  };

  columnDefs: ColDef<AuditRow>[] = [
    {
      headerName: 'When',
      field: 'created_at',
      width: 180,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString() : '',
      sort: 'desc',
    },
    {
      headerName: 'Action',
      field: 'action',
      cellRenderer: (p: { value: string }) =>
        `<span style="font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,229,255,0.1);color:#00E5FF;">${p.value}</span>`,
    },
    {
      headerName: 'Site',
      field: 'site',
      width: 180,
      filter: 'agTextColumnFilter',
      valueFormatter: (p) => (p.value as string | null) ?? '—',
    },
    { headerName: 'Target Type', field: 'target_type', width: 140 },
    { headerName: 'Target ID', field: 'target_id', cellClass: 'mono', width: 200 },
    { headerName: 'Actor', field: 'actor_id', cellClass: 'mono', width: 200 },
    {
      headerName: 'Metadata',
      field: 'metadata',
      flex: 2,
      valueFormatter: (p) => p.value ? JSON.stringify(p.value).slice(0, 200) : '',
      getQuickFilterText: (p) => p.value ? JSON.stringify(p.value) : '',
      filter: false,
      sortable: false,
    },
    { headerName: 'Request ID', field: 'request_id', cellClass: 'mono', width: 200 },
  ];

  constructor() {
    // React to site selection changes — reload rows for the new site + push
    // the new slug into the ag-grid `site` filter so the visible row set
    // shrinks immediately even before the network round-trip completes.
    effect(() => {
      const site = this.state.selectedSite();
      const slug = site?.slug ?? null;
      const name = site?.business_name ?? site?.slug ?? '';
      this.scopeSlug.set(slug);
      this.scopeName.set(name);
      this.applyScopeFilter(slug);
      this.load();
    });
  }

  uniqueActions(): number { return new Set(this.rows().map((r) => r.action)).size; }
  uniqueActors(): number { return new Set(this.rows().map((r) => r.actor_id).filter(Boolean)).size; }
  last24h(): number {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return this.rows().filter((r) => Date.parse(r.created_at) >= cutoff).length;
  }

  /**
   * Human-readable "last sync 2s ago" label. Recomputes on every Angular
   * change-detection tick (cheap — just two Date.now() ops).
   *
   * @example "2s ago" → after a fresh poll | "—" before first sync
   */
  lastSyncLabel(): string {
    const t = this.lastSyncAt();
    if (!t) return '—';
    const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ago`;
  }

  ngOnInit(): void {
    this.load();
    // Poll every 15s, but pause when the tab is hidden so we don't burn API
    // quota on background tabs. Resume + immediate sync on visibility return.
    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      this.load();
    }, AdminAuditComponent.POLL_MS);
    this.visibilityHandler = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.load();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * Fetch audit rows scoped to the current site (if one is selected). The
   * backend caps at 500 rows; the grid client-side filters from there.
   */
  load(): void {
    this.loading.set(true);
    const slug = this.scopeSlug();
    const params: Record<string, string> = { limit: '500' };
    if (slug) params['site_slug'] = slug;
    this.api.get<{ data: AuditRow[] }>('/audit-logs', params).subscribe({
      next: (r) => {
        this.rows.set(r.data ?? []);
        this.loading.set(false);
        this.lastSyncAt.set(Date.now());
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Apply ag-grid `site` filter to scope visible rows to a single slug.
   * `null` clears the filter — used by the chip's × button as the operator
   * escape hatch to view every row in the org.
   */
  private applyScopeFilter(slug: string | null): void {
    if (!this.gridApi) return;
    if (slug) {
      this.gridApi.setFilterModel({
        site: { filterType: 'text', type: 'equals', filter: slug },
      });
    } else {
      this.gridApi.setFilterModel(null);
    }
  }

  /** Clear the site scope — show every audit row in the org. */
  clearScope(): void {
    this.scopeSlug.set(null);
    this.scopeName.set('');
    this.applyScopeFilter(null);
    this.load();
  }

  onGridReady(ev: GridReadyEvent<AuditRow>): void {
    this.gridApi = ev.api;
    ev.api.addEventListener('rowSelected', () => {
      const sel = ev.api.getSelectedRows() as AuditRow[];
      this.selected.set(sel[0] ?? null);
    });
    // Apply the initial scope filter as soon as the grid is ready — the
    // effect() in the constructor may have fired before gridApi existed.
    this.applyScopeFilter(this.scopeSlug());
    // Restore + persist column state across sessions (visibility, order, width, sort).
    try {
      const raw = localStorage.getItem('ps_audit_grid_v1');
      if (raw) ev.api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
    } catch { /* ignore */ }
    ev.api.addEventListener('columnMoved', () => this.saveColState());
    ev.api.addEventListener('columnResized', () => this.saveColState());
    ev.api.addEventListener('columnVisible', () => this.saveColState());
    ev.api.addEventListener('sortChanged', () => this.saveColState());
  }
  private saveColState(): void {
    try { localStorage.setItem('ps_audit_grid_v1', JSON.stringify(this.gridApi?.getColumnState() ?? [])); } catch { /* */ }
  }

  exportCsv(): void {
    this.gridApi?.exportDataAsCsv({ fileName: `audit-log-${new Date().toISOString().slice(0, 10)}.csv` });
  }

  pretty(o: unknown): string { return JSON.stringify(o, null, 2); }
}
