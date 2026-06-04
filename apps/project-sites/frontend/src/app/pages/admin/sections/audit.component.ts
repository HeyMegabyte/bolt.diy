import { Component, computed, effect, inject, signal, type OnInit, type OnDestroy } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ClientSideRowModelModule,
  ModuleRegistry,
  themeQuartz,
  colorSchemeDarkBlue,
  type ColDef,
  type GridReadyEvent,
  type GridApi,
  type IRowNode,
  type IsFullWidthRowParams,
  type ICellRendererParams,
  type RowHeightParams,
  CsvExportModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ValidationModule,
  RowSelectionModule,
} from 'ag-grid-community';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';

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
 *
 * Turn-6 added `message` — a human-readable English summary written at the
 * audit-write boundary (with `actionToFallbackMessage` synthesis when older
 * callers omit it). Always populated server-side; nullable here as a belt-
 * and-suspenders for any in-flight rows mid-migration.
 *
 * The `__detail` / `masterId` flags are LOCAL ONLY and drive the faux
 * master/detail row expansion described in the class JSDoc below — never
 * sent over the wire.
 */
interface AuditRow {
  id: string;
  action: string;
  message: string | null;
  target_type: string | null;
  target_id: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
  site: string | null;
  /** Local-only: marks a synthetic full-width detail row spliced into rowData. */
  __detail?: boolean;
  /** Local-only: the parent master row's id (only set on detail rows). */
  masterId?: string;
  /** Local-only: whether the master row currently has its detail panel open. */
  __expanded?: boolean;
}

/**
 * Escape an arbitrary string into an HTML-safe fragment. Used for every
 * dynamic value rendered via the (string-returning) cellRenderer hooks
 * below — never trust audit data even from our own backend.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal JSON syntax highlighter — strings green, numbers cyan, keys amber,
 * booleans violet, null grey. Mirrors the Traces page (ai-logs.component.ts)
 * so the audit detail panel shares the same colour vocabulary.
 */
function highlightJson(src: string): string {
  return escapeHtml(src).replace(
    /(&quot;(?:\\.|[^"\\])*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g,
    (_m, str?: string, colon?: string, bool?: string, num?: string, pun?: string) => {
      if (str) {
        return colon
          ? `<span class="tk-key">${str}</span><span class="tk-pun">${colon}</span>`
          : `<span class="tk-str">${str}</span>`;
      }
      if (bool) return bool === 'null' ? `<span class="tk-null">${bool}</span>` : `<span class="tk-bool">${bool}</span>`;
      if (num) return `<span class="tk-num">${num}</span>`;
      if (pun) return `<span class="tk-pun">${pun}</span>`;
      return _m as string;
    },
  );
}

/** Compact relative-time formatter — "3 min ago", "12 sec ago", "yesterday". */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const delta = Math.max(0, Date.now() - t);
  const s = Math.floor(delta / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} sec ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * Fallback statement synthesis for any in-flight row that still lacks a
 * `message` (older writers, replay backfill, etc). Mirrors the worker
 * helper `actionToFallbackMessage` so the UI label matches what would have
 * been persisted had we written the row today.
 */
function actionToFallbackMessage(action: string): string {
  const words = action.split('.').filter(Boolean);
  if (words.length === 0) return action;
  return words
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/_/g, ' ');
}

/**
 * Admin audit-log surface. Renders the org's `audit_logs` as an AG Grid
 * view scoped to the currently-selected site (visual chip — the backend
 * call is always org-wide). Auto-polls every 15s, pauses on hidden tab.
 *
 * ## Faux master/detail technique (Community-tier)
 *
 * AG Grid's real `masterDetail: true` API is Enterprise-licensed. We mimic
 * it cleanly in Community using two Community features, exactly mirroring
 * the Traces page (ai-logs.component.ts) so both admin grids share one
 * pattern future maintainers can recognise instantly:
 *
 * 1. **Synthetic detail rows** — when the user clicks the expand kebab on
 *    a row we insert a sibling `AuditRow` with `__detail: true` right
 *    after it in `displayRows()`. The grid still treats it as a normal
 *    row internally.
 * 2. **`isFullWidthRow` + `fullWidthCellRenderer`** — these ARE Community.
 *    We tell the grid that any row with `__detail === true` renders
 *    full-width via our HTML detail renderer, with `getRowHeight()`
 *    expanding it to 360px so the expanded panel never clips.
 *
 * Net effect: click the kebab → row visually expands below itself
 * showing actor, target, request_id, and the metadata JSON. Zero
 * Enterprise license required.
 *
 * @example
 * ```html
 * <app-admin-audit />
 * <!-- Renders the auto-polling grid + scope chip + per-row detail
 *      panel expansion via the kebab on the right of every row. -->
 * ```
 */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [RollingCounterComponent, AgGridAngular],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-4">
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="kicker">Forensics</div>
          <h2 class="section-h text-lg font-bold text-white m-0">Audit Log</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Every privileged action — what happened, who did it, when. Auto-refreshing every 15s · last sync {{ lastSyncLabel() }}.
          </p>
        </div>
        <div class="flex gap-2 items-center">
          @if (showScopeChip()) {
            <button
              type="button"
              data-testid="audit-scope-chip"
              class="scope-chip"
              [title]="'Showing audit rows for ' + scopeName() + '. Click × to view every row in the org.'"
              (click)="clearScope()">
              Filtered to: {{ scopeName() }} <span class="x">×</span>
            </button>
          }
          <button class="btn-ghost" (click)="exportCsv()">Export CSV</button>
        </div>
      </header>

      <div class="grid grid-cols-4 gap-3 text-[0.78rem]">
        @if (loading() && displayRows().length === 0) {
          @for (i of [0,1,2,3]; track i) {
            <div class="card"><div class="muted-h">Loading</div><div class="skeleton skeleton-line"></div></div>
          }
        } @else {
          <div class="card"><div class="muted-h">Events</div><div class="text-2xl font-bold text-white"><app-rolling-counter [value]="displayRows().length" [duration]="1100" /></div></div>
          <div class="card"><div class="muted-h">Unique actions</div><div class="text-2xl font-bold text-white"><app-rolling-counter [value]="uniqueActions()" [duration]="1100" /></div></div>
          <div class="card"><div class="muted-h">Last 24h</div><div class="text-2xl font-bold text-white"><app-rolling-counter [value]="last24h()" [duration]="1100" /></div></div>
          <div class="card"><div class="muted-h">Actors</div><div class="text-2xl font-bold text-white"><app-rolling-counter [value]="uniqueActors()" [duration]="1100" /></div></div>
        }
      </div>

      @if (loadError(); as err) {
        <div class="empty-state card error-state" role="alert" data-testid="audit-error">
          <svg class="error-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          </svg>
          <h3 class="empty-title">Couldn't load audit events</h3>
          <p class="empty-body">{{ err }}</p>
          <button class="btn-gradient" type="button" (click)="load()">Retry</button>
        </div>
      } @else if (!loading() && displayRows().length === 0) {
        <div class="empty-state card" role="status" data-testid="audit-empty">
          <svg class="empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h12"/>
          </svg>
          <h3 class="empty-title">No audit events yet</h3>
          <p class="empty-body">Privileged actions you take — deploys, hostname changes, billing edits — will appear here within seconds.</p>
          <button class="btn-gradient" type="button" (click)="load()">Refresh now</button>
        </div>
      }

      <!-- Full-bleed grid — no card padding so AG-Grid claims maximum real estate. -->
      <div class="grid-frame">
        <ag-grid-angular
          data-testid="audit-grid"
          class="ag-grid-host"
          [theme]="theme"
          [rowData]="displayRows()"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
          [pagination]="true"
          [paginationPageSize]="50"
          [paginationPageSizeSelector]="[25, 50, 100, 250]"
          [getRowId]="getRowId"
          [getRowHeight]="getRowHeight"
          [isFullWidthRow]="isFullWidthRow"
          [fullWidthCellRenderer]="fullWidthCellRenderer"
          [animateRows]="true"
          [enableCellTextSelection]="true"
          (gridReady)="onGridReady($event)">
        </ag-grid-angular>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .btn-ghost { padding: 0.5rem 1rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .btn-mini { padding: 0.2rem 0.55rem; border-radius: 6px; background: rgba(0,229,255,0.12); border: 1px solid rgba(0,229,255,0.30); color: #00E5FF; font-size: 0.62rem; font-weight: 700; cursor: pointer; letter-spacing: 0.04em; text-transform: uppercase; transition: background 140ms ease; }
    .btn-mini:hover { background: rgba(0,229,255,0.22); }
    .btn-gradient { padding: 0.5rem 1rem; border-radius: 10px; background: var(--ps-grad-primary); color: #060610; font-size: 0.74rem; font-weight: 700; border: 0; cursor: pointer; box-shadow: 0 6px 18px -8px rgba(0, 212, 255, 0.55); transition: transform 140ms ease, box-shadow 140ms ease; }
    .btn-gradient:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px -8px rgba(0, 212, 255, 0.7); }
    .scope-chip { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.85rem; border-radius: 999px; background: rgba(0,229,255,0.10); color: #00E5FF; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; font-weight: 600; }
    .scope-chip:hover { background: rgba(0,229,255,0.18); }
    .scope-chip .x { font-size: 0.95rem; line-height: 1; opacity: 0.85; }
    .scope-chip-all { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.75); border-color: rgba(255,255,255,0.10); cursor: default; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 0.3rem; }
    .ag-grid-host { width: 100%; height: calc(100vh - 280px); min-height: 520px; }
    .grid-frame {
      width: 100%;
      border: 1px solid color-mix(in oklch, currentColor 12%, transparent);
      border-radius: var(--ps-radius-lg, 14px);
      overflow: hidden;
      background: rgba(0,0,0,0.18);
      box-shadow: var(--ps-shadow-md, 0 4px 12px rgba(0,0,0,0.18));
    }
    .skeleton { background: rgba(255,255,255,0.10); border-radius: 8px; animation: skel-pulse 1.4s ease-in-out infinite; }
    .skeleton-line { height: 28px; margin-top: 0.45rem; }
    @keyframes skel-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; opacity: 0.7; } }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2.5rem 1.2rem; gap: 0.6rem; }
    .empty-icon { color: rgba(0, 229, 255, 0.65); }
    .error-state { border-color: rgba(255, 92, 122, 0.32); }
    .error-icon { color: rgba(255, 92, 122, 0.8); }
    .empty-title { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; font-size: 1rem; color: #fff; margin: 0.2rem 0 0; }
    .empty-body { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin: 0 0 0.5rem; max-width: 360px; }
    /* ─── Cell renderer: action code pill (JetBrains Mono) ──────────── */
    :host ::ng-deep .cell-action-pill {
      display: inline-flex; align-items: center;
      padding: 2px 9px; border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.66rem; font-weight: 600; letter-spacing: 0.01em;
      background: rgba(0,229,255,0.10); color: #00E5FF;
      border: 1px solid rgba(0,229,255,0.22);
    }

    /* ─── Cell renderer: log statement (primary content) ────────────── */
    :host ::ng-deep .cell-message {
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 500; font-size: 0.78rem;
      letter-spacing: -0.005em;
      color: rgba(245,245,247,0.96);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    :host ::ng-deep .cell-message.is-fallback { color: rgba(255,255,255,0.55); font-style: italic; }

    /* ─── Cell renderer: expand-kebab (rotates on open) ─────────────── */
    :host ::ng-deep .kebab-btn {
      width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent;
      background: transparent; color: rgba(255,255,255,0.55); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 200ms ease;
    }
    :host ::ng-deep .kebab-btn:hover { background: rgba(0,229,255,0.12); color: #00E5FF; border-color: rgba(0,229,255,0.30); }
    :host ::ng-deep .kebab-btn.is-open { background: rgba(0,229,255,0.18); color: #00E5FF; border-color: rgba(0,229,255,0.45); transform: rotate(90deg); }
    @media (prefers-reduced-motion: reduce) { :host ::ng-deep .kebab-btn { transition: none; } }

    /* ─── Detail panel: master/detail expansion ─────────────────────── */
    :host ::ng-deep .detail-card {
      padding: 1rem 1.2rem 1.2rem; margin: 0;
      background: linear-gradient(180deg, rgba(0,229,255,0.04), rgba(124,58,237,0.02));
      border-top: 1px solid rgba(0,229,255,0.20);
      border-bottom: 1px solid rgba(0,229,255,0.10);
      border-radius: var(--ps-radius-lg, 14px);
      animation: detail-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes detail-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { :host ::ng-deep .detail-card { animation: none; } }

    :host ::ng-deep .detail-card .detail-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.7rem; }
    :host ::ng-deep .detail-card .detail-head h4 {
      font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em;
      font-size: 0.92rem; color: #fff; margin: 0;
    }
    :host ::ng-deep .detail-card .detail-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.8rem; margin-bottom: 0.7rem; }
    :host ::ng-deep .detail-card .detail-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.8rem; margin-bottom: 0.7rem; }
    :host ::ng-deep .detail-card .det-block { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
    :host ::ng-deep .detail-card .det-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.55); font-weight: 700; }
    :host ::ng-deep .detail-card .det-value {
      font-size: 0.74rem; color: rgba(245,245,247,0.92);
      word-break: break-word; line-height: 1.45;
    }
    :host ::ng-deep .detail-card .det-value.mono {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.7rem;
    }
    :host ::ng-deep .detail-card .req-row {
      display: flex; align-items: center; gap: 0.55rem;
      padding: 0.45rem 0.6rem; border-radius: 8px;
      background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06);
      margin-bottom: 0.7rem;
    }
    :host ::ng-deep .detail-card .req-row code {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.7rem; color: rgba(245,245,247,0.92); flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    :host ::ng-deep .detail-card .req-row .req-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.55); font-weight: 700; }
    :host ::ng-deep .detail-card pre {
      background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 0.7rem 0.9rem;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.68rem; line-height: 1.55;
      white-space: pre-wrap; word-break: break-word;
      max-height: 200px; overflow: auto; margin: 0;
      color: rgba(245,245,247,0.92);
    }
    :host ::ng-deep .detail-card .tk-key  { color: #fbbf24; }
    :host ::ng-deep .detail-card .tk-str  { color: #86efac; }
    :host ::ng-deep .detail-card .tk-num  { color: #67e8f9; }
    :host ::ng-deep .detail-card .tk-bool { color: #c4b5fd; }
    :host ::ng-deep .detail-card .tk-null { color: rgba(255,255,255,0.45); }
    :host ::ng-deep .detail-card .tk-pun  { color: rgba(255,255,255,0.55); }
    :host ::ng-deep .detail-card .det-action {
      padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.64rem; font-weight: 700;
      letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer;
      border: 1px solid rgba(0,229,255,0.30); background: rgba(0,229,255,0.10); color: #00E5FF;
      transition: background 140ms ease, transform 140ms ease;
    }
    :host ::ng-deep .detail-card .det-action:hover { background: rgba(0,229,255,0.22); transform: translateY(-1px); }
    @media (prefers-reduced-motion: reduce) { :host ::ng-deep .detail-card .det-action { transition: none; transform: none !important; } }

    /* ─── AG Grid theme tweaks (dark cyan hover glow) ───────────────── */
    :host ::ng-deep .ag-row-hover { box-shadow: inset 3px 0 0 rgba(0,229,255,0.35); }
  `],
})
export class AdminAuditComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  state = inject(AdminStateService);
  rows = signal<AuditRow[]>([]);
  loading = signal(false);
  /** Set when /audit-logs fails so we show a distinct error card instead of the
   *  misleading "No audit events yet" empty state (a security log must never
   *  imply zero activity when the fetch actually failed). */
  loadError = signal<string | null>(null);

  /** Set of master-row ids currently expanded with their detail panel open. */
  private expandedIds = signal<Set<string>>(new Set<string>());

  /**
   * Rows + synthetic detail-row injection. Splices a `__detail: true` row
   * right after every expanded master so AG Grid renders it via
   * `fullWidthCellRenderer`. Drives the grid + every KPI tile so the
   * numbers always reflect what's actually visible.
   *
   * Turn-8 removed the heartbeat-noise filter — `workflow.heartbeat` is
   * no longer written server-side (workflows/site-generation.ts) and the
   * existing rows were deleted from production D1.
   */
  displayRows = computed<AuditRow[]>(() => {
    const all = this.rows();
    const expanded = this.expandedIds();
    const out: AuditRow[] = [];
    for (const r of all) {
      out.push({ ...r, __expanded: expanded.has(r.id) });
      if (expanded.has(r.id)) {
        out.push({
          ...r,
          id: `${r.id}::detail`,
          __detail: true,
          masterId: r.id,
        });
      }
    }
    return out;
  });
  /**
   * Default chip slug — `megabytespace` is the canonical org slug surfaced as
   * the initial filter chip. The chip is purely a visual label here; the
   * audit API call always loads events across ALL sites in the org. Clicking
   * the chip's × clears the label without re-filtering the API call.
   */
  scopeSlug = signal<string | null>('megabytespace');
  scopeName = signal<string>('megabytespace');

  /**
   * Snapshot of the scope slug at component-mount time. The "Filtered to:"
   * chip is gated on `scopeSlug() === initialScopeSlug` — the moment the
   * user clears or changes the filter (which can happen via the chip's ×,
   * a site-selector switch, or any future programmatic mutation of
   * `scopeSlug`), the computed `showScopeChip` flips false and Angular's
   * `@if` removes the chip from the DOM. Signal reactivity is the event —
   * no manual listener wiring needed.
   */
  private readonly initialScopeSlug: string | null = this.scopeSlug();

  /**
   * Drives the `@if` around the scope chip. Computed so it re-evaluates
   * on EVERY mutation of `scopeSlug()` — chip auto-removes on clear AND
   * on any divergence from the initial value (different site selected,
   * etc).
   */
  readonly showScopeChip = computed(() => {
    const s = this.scopeSlug();
    return s !== null && s === this.initialScopeSlug;
  });
  lastSyncAt = signal<number>(0);
  private gridApi?: GridApi<AuditRow>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler?: () => void;

  /** Polling cadence in ms — matched to operator expectations for "live". */
  private static readonly POLL_MS = 15_000;

  theme = themeQuartz.withPart(colorSchemeDarkBlue).withParams({
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

  defaultColDef: ColDef = {
    sortable: true, filter: true, resizable: true, minWidth: 80,
  };

  /**
   * Column set (Turn 6 rewrite):
   *
   * | Column        | Field         | Notes                                            |
   * |---------------|---------------|--------------------------------------------------|
   * | Action        | `action`      | JetBrains Mono pill, 200px, text-filterable      |
   * | Log statement | `message`     | Primary content, flex:1, fallback synthesised    |
   * | When          | `created_at`  | Relative time + ISO tooltip, default sort desc   |
   * | Site          | `site`        | Slug or org.name, 140px                          |
   * | Expand        | (synthetic)   | 50px kebab, rotates on open, opens detail panel  |
   *
   * Dropped columns (now surfaced in the detail panel instead):
   * actor, target, target_type, request_id, metadata.
   */
  columnDefs: ColDef<AuditRow>[] = [
    {
      headerName: 'Action',
      field: 'action',
      width: 200,
      minWidth: 160,
      filter: 'agTextColumnFilter',
      cellRenderer: (p: ICellRendererParams<AuditRow>): string => {
        const v = String(p.value ?? '');
        return `<span class="cell-action-pill">${escapeHtml(v)}</span>`;
      },
    },
    {
      headerName: 'Log statement',
      field: 'message',
      flex: 1,
      minWidth: 280,
      filter: 'agTextColumnFilter',
      // Falls back to the synthesised English summary when an in-flight row
      // still lacks a `message` (older writers, replay backfill, etc).
      valueGetter: (p) => {
        const data = p.data;
        if (!data) return '';
        return data.message ?? actionToFallbackMessage(data.action);
      },
      cellRenderer: (p: ICellRendererParams<AuditRow>): string => {
        const data = p.data;
        if (!data) return '';
        const isFallback = data.message == null;
        const text = data.message ?? actionToFallbackMessage(data.action);
        const klass = `cell-message${isFallback ? ' is-fallback' : ''}`;
        return `<span class="${klass}" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
      },
      tooltipValueGetter: (p) => {
        const data = p.data;
        if (!data) return '';
        return data.message ?? actionToFallbackMessage(data.action);
      },
    },
    {
      headerName: 'When',
      field: 'created_at',
      width: 140,
      minWidth: 110,
      filter: 'agDateColumnFilter',
      sort: 'desc',
      valueFormatter: (p) => relativeTime(p.value as string | null | undefined),
      tooltipValueGetter: (p) => {
        const v = p.value as string | null | undefined;
        if (!v) return '';
        return new Date(v).toISOString();
      },
      comparator: (a, b) => Date.parse(String(a ?? 0)) - Date.parse(String(b ?? 0)),
    },
    {
      headerName: 'Site',
      field: 'site',
      width: 140,
      minWidth: 110,
      filter: 'agTextColumnFilter',
      valueFormatter: (p) => (p.value as string | null) ?? '—',
    },
    {
      headerName: '',
      colId: 'expand',
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: (p: ICellRendererParams<AuditRow>): HTMLElement => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const id = p.data?.id ?? '';
        btn.className = 'kebab-btn' + (p.data?.__expanded ? ' is-open' : '');
        btn.setAttribute('aria-label', p.data?.__expanded ? 'Collapse audit detail' : 'Expand audit detail');
        btn.setAttribute('aria-expanded', String(!!p.data?.__expanded));
        btn.setAttribute('data-testid', `audit-row-expand-${id}`);
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <circle cx="8" cy="3" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="13" r="1.2"/>
          </svg>
        `;
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (p.data) this.toggleExpand(p.data);
        });
        return btn;
      },
    },
  ];

  constructor() {
    // Audit log is intentionally org-wide — the chip is a visual label only,
    // and the API call always loads every row in the org regardless of the
    // currently-selected project. This mirrors how operators triage privileged
    // actions (they want everything, not a single-site slice).
    //
    // Track the expanded-ids signal so freshly-opened detail rows redraw via
    // ag-grid's full-width renderer without a second user click. Cheap: the
    // grid only re-runs renderers for currently-mounted detail rows.
    effect(() => {
      this.expandedIds();
      if (this.gridApi) {
        this.gridApi.refreshCells({ force: true });
        const detailNodes: IRowNode<AuditRow>[] = [];
        this.gridApi.forEachNode((n) => { if (n.data?.__detail) detailNodes.push(n); });
        if (detailNodes.length) this.gridApi.redrawRows({ rowNodes: detailNodes });
      }
    });
  }

  uniqueActions(): number { return new Set(this.displayRows().filter((r) => !r.__detail).map((r) => r.action)).size; }
  uniqueActors(): number { return new Set(this.displayRows().filter((r) => !r.__detail).map((r) => r.actor_id).filter(Boolean)).size; }
  last24h(): number {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return this.displayRows().filter((r) => !r.__detail && Date.parse(r.created_at) >= cutoff).length;
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
   * Fetch audit rows across ALL sites in the org. The chip in the toolbar is
   * a visual label only — the backend call never pre-filters by site. The
   * backend caps at 500 rows; the grid client-side filters from there.
   */
  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const params: Record<string, string> = { limit: '500' };
    this.api.get<{ data: AuditRow[] }>('/audit-logs', params, { silent: true }).subscribe({
      next: (r) => {
        this.rows.set(r.data ?? []);
        this.loading.set(false);
        this.lastSyncAt.set(Date.now());
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Could not load audit events — check your connection and retry.');
      },
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

  /**
   * Clear the chip label. The API call is already org-wide, so this only
   * affects the visual chip + the ag-grid `site` filter (lets every row show
   * even if one matched the default chip's text).
   */
  clearScope(): void {
    this.scopeSlug.set(null);
    this.scopeName.set('');
    this.applyScopeFilter(null);
  }

  onGridReady(ev: GridReadyEvent<AuditRow>): void {
    this.gridApi = ev.api;
    // Apply the initial scope filter as soon as the grid is ready — the
    // effect() in the constructor may have fired before gridApi existed.
    this.applyScopeFilter(this.scopeSlug());
    // Restore + persist column state across sessions (visibility, order, width, sort).
    try {
      const raw = localStorage.getItem('ps_audit_grid_v2');
      if (raw) ev.api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
    } catch { /* ignore */ }
    ev.api.addEventListener('columnMoved', () => this.saveColState());
    ev.api.addEventListener('columnResized', () => this.saveColState());
    ev.api.addEventListener('columnVisible', () => this.saveColState());
    ev.api.addEventListener('sortChanged', () => this.saveColState());
  }
  private saveColState(): void {
    try { localStorage.setItem('ps_audit_grid_v2', JSON.stringify(this.gridApi?.getColumnState() ?? [])); } catch { /* */ }
  }

  /**
   * Stable row id callback — keeps AG Grid's incremental reconciliation in
   * sync across the 15s polls so expanded detail rows don't flicker.
   * Detail rows already carry a `::detail` suffix from `displayRows()`.
   */
  getRowId = (params: { data: AuditRow }): string => params.data.id;

  /**
   * Dynamic row height: detail rows expand to 360px so the full detail
   * panel renders without internal scroll. Master rows stay at 40px.
   */
  getRowHeight = (params: RowHeightParams<AuditRow>): number | undefined | null => {
    if (params.data?.__detail) return 360;
    return 40;
  };

  /** Tell AG Grid which rows render via `fullWidthCellRenderer`. */
  isFullWidthRow = (params: IsFullWidthRowParams<AuditRow>): boolean => {
    return !!params.rowNode.data?.__detail;
  };

  /**
   * Full-width detail panel renderer — produces the expanded card holding
   * actor + target + when + site + request_id + metadata. Mirrors the
   * Traces page renderer; both pages share `.detail-card` styling.
   *
   * Uses `innerHTML` for the static layout and imperative DOM construction
   * for the action buttons so we keep proper closure references to
   * `this.copyRowAsJson` / `this.copyCorrelationId` without leaking globals.
   */
  fullWidthCellRenderer = (params: ICellRendererParams<AuditRow>): HTMLElement => {
    const data = params.data!;
    const parentId = data.masterId ?? '';
    const root = document.createElement('div');
    root.className = 'detail-card';
    root.setAttribute('data-testid', `audit-detail-${parentId}`);

    const whenIso = data.created_at;
    const whenLocale = whenIso ? new Date(whenIso).toLocaleString() : '—';
    const actor = data.actor_id ? `${data.actor_id.slice(0, 8)}…` : 'system';
    const actorTitle = data.actor_id ?? 'system';
    const site = data.site ?? '—';
    const action = data.action ?? '—';
    const targetType = data.target_type ?? '—';
    const targetId = data.target_id ?? '—';
    const target = (data.target_type || data.target_id) ? `${targetType}:${targetId}` : '—';
    const requestId = data.request_id ?? '';
    const metadataPretty = data.metadata ? JSON.stringify(data.metadata, null, 2) : '';

    root.innerHTML = `
      <div class="detail-head">
        <h4>Event detail</h4>
        <div class="detail-head-actions"></div>
      </div>
      <div class="detail-grid-3">
        <div class="det-block">
          <div class="det-label">When</div>
          <div class="det-value">${escapeHtml(whenLocale)}</div>
          <div class="det-value mono" style="opacity:0.7;font-size:0.62rem;">${escapeHtml(whenIso ?? '')}</div>
        </div>
        <div class="det-block">
          <div class="det-label">Actor</div>
          <div class="det-value mono" title="${escapeHtml(actorTitle)}">${escapeHtml(actor)}</div>
        </div>
        <div class="det-block">
          <div class="det-label">Site</div>
          <div class="det-value mono">${escapeHtml(site)}</div>
        </div>
      </div>
      <div class="detail-grid-2">
        <div class="det-block">
          <div class="det-label">Action</div>
          <div class="det-value mono">${escapeHtml(action)}</div>
        </div>
        <div class="det-block">
          <div class="det-label">Target</div>
          <div class="det-value mono" title="${escapeHtml(target)}">${escapeHtml(target)}</div>
        </div>
      </div>
      <div class="req-row">
        <span class="req-label">Request ID</span>
        <code>${escapeHtml(requestId || '—')}</code>
        <div class="req-row-actions"></div>
      </div>
      <div class="det-block">
        <div class="det-label">Metadata</div>
        ${
          metadataPretty
            ? `<pre>${highlightJson(metadataPretty)}</pre>`
            : `<div class="det-value" style="opacity:0.6;font-style:italic;">No metadata recorded for this event.</div>`
        }
      </div>
    `;

    // ─ Copy row as JSON (top-right of the panel — incident hand-off) ─
    const headActions = root.querySelector('.detail-head-actions') as HTMLDivElement;
    const copyRowBtn = document.createElement('button');
    copyRowBtn.type = 'button';
    copyRowBtn.className = 'det-action';
    copyRowBtn.textContent = 'Copy row JSON';
    copyRowBtn.setAttribute('data-testid', `audit-copy-row-${parentId}`);
    copyRowBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.copyRowAsJson(data); });
    headActions.appendChild(copyRowBtn);

    // ─ Copy request_id (inline next to the value — for grep/Sentry) ─
    if (requestId) {
      const reqActions = root.querySelector('.req-row-actions') as HTMLDivElement;
      const copyReqBtn = document.createElement('button');
      copyReqBtn.type = 'button';
      copyReqBtn.className = 'det-action';
      copyReqBtn.textContent = 'Copy';
      copyReqBtn.setAttribute('data-testid', `audit-copy-correlation-${parentId}`);
      copyReqBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.copyCorrelationId(requestId); });
      reqActions.appendChild(copyReqBtn);
    }

    return root;
  };

  /**
   * Toggle the expanded state for an audit row. Splicing a synthetic
   * `__detail` row in/out of `displayRows()` happens automatically via
   * the computed signal — we only flip `expandedIds` here.
   */
  toggleExpand(row: AuditRow): void {
    // Don't try to toggle a detail row itself (defensive — the kebab only
    // renders on master rows because detail rows hit the full-width path).
    if (row.__detail) return;
    const next = new Set(this.expandedIds());
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    this.expandedIds.set(next);
  }

  exportCsv(): void {
    this.gridApi?.exportDataAsCsv({ fileName: `audit-log-${new Date().toISOString().slice(0, 10)}.csv` });
  }

  /**
   * Copy a correlation/request ID to the clipboard with feedback so the
   * operator can paste it straight into a support ticket or Sentry search.
   */
  async copyCorrelationId(id: string): Promise<void> {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.toast.success('Request ID copied');
    } catch {
      this.toast.error('Could not copy — select the ID and copy manually');
    }
  }

  /**
   * Copy the entire audit row (sans synthetic flags) as a pretty-printed
   * JSON payload — the "give-me-the-row" button at the top-right of the
   * detail panel for incident hand-off.
   */
  async copyRowAsJson(row: AuditRow): Promise<void> {
    try {
      // Strip local-only flags before serialising — they're not part of the
      // wire shape and operators pasting into Sentry don't want them.
      const { __detail: _detail, masterId: _master, __expanded: _expanded, ...wire } = row;
      void _detail; void _master; void _expanded;
      await navigator.clipboard.writeText(JSON.stringify(wire, null, 2));
      this.toast.success('Row JSON copied');
    } catch {
      this.toast.error('Could not copy — please select the JSON manually');
    }
  }

}
