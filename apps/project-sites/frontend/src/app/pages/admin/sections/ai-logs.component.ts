import {
  Component,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  type ElementRef,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { HlmInputDirective, HlmTablistDirective } from '../../../ui';
import {
  ClientSideRowModelModule,
  ModuleRegistry,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ValidationModule,
  RowSelectionModule,
  colorSchemeDarkBlue,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
  type IsFullWidthRowParams,
  type ICellRendererParams,
  type RowHeightParams,
} from 'ag-grid-community';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  RowSelectionModule,
  ValidationModule,
]);

/**
 * One AI invocation as returned by `GET /api/sites/:id/ai-logs`.
 *
 * The `_expanded` and `_isDetail` flags are local-only — they drive the
 * faux master/detail row expansion described in the class JSDoc below
 * and are never sent to the API.
 */
interface TraceRow {
  id: string;
  submission_id: string | null;
  trace_kind: string;
  endpoint_slug: string | null;
  model: string;
  status: string;
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  credits_debited: number | null;
  tool_name: string | null;
  tool_status: string | null;
  output_preview: string | null;
  error_message: string | null;
  created_at: string;
  actor_email?: string | null;
  user_id?: string | null;
  /** Local-only: whether the detail panel is rendered below this row. */
  _expanded?: boolean;
  /** Local-only: marks a synthetic full-width detail row in row data. */
  _isDetail?: boolean;
  /** Local-only: the parent trace id (only set on detail rows). */
  _parentId?: string;
}

/** Lazy-fetched full trace detail — system prompt + IO + tool. */
interface TraceDetail extends TraceRow {
  prompt_template: string | null;
  input_json: string;
  output_text: string | null;
  output_json: string | null;
  tool_args_json: string | null;
  tool_result_json: string | null;
}

/** Period selector value driving the latency-percentile chart x-axis. */
type ChartPeriod = '1h' | '24h' | '7d' | '30d';

/**
 * Escape an arbitrary string into an HTML-safe fragment. Used for every
 * dynamic value rendered via the (string-returning) cellRenderer hooks
 * below — never trust trace data, even from our own backend.
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
 * booleans violet, null grey. Mirrors the docs.component.ts pattern but
 * inlined here so the Traces page stays self-contained.
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

/**
 * Highlight ALL-CAPS structural headings (ROLE, OUTPUT, SAFETY, INPUT, etc.)
 * inside a system prompt so the long-form prose is scannable. Lines that look
 * like a heading (≥3 uppercase letters followed by `:` or end-of-line) get a
 * keyword span.
 */
function highlightSystemPrompt(src: string): string {
  return escapeHtml(src).replace(
    /^([A-Z][A-Z0-9 _-]{2,30})(:|$)/gm,
    (_m, head: string, tail: string) => `<span class="kw">${head}</span>${tail}`,
  );
}

/**
 * Collapse the verbose Workers AI model slug (`@cf/meta/llama-3.3-70b-instruct`)
 * down to a human-readable label (`Llama 3.3 70B`). Falls back to the raw value
 * for unrecognised slugs (e.g. external OpenAI / Anthropic models).
 */
function prettifyModel(slug: string | null | undefined): string {
  if (!slug) return '—';
  const m = slug.match(/llama-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)b/i);
  if (m) return `Llama ${m[1]} ${m[2]}B`;
  if (/^gpt-4o/i.test(slug)) return 'GPT-4o';
  if (/^gpt-4/i.test(slug)) return 'GPT-4';
  if (/^claude-opus/i.test(slug)) return 'Claude Opus';
  if (/^claude-sonnet/i.test(slug)) return 'Claude Sonnet';
  if (/^claude-haiku/i.test(slug)) return 'Claude Haiku';
  return slug.split('/').pop() ?? slug;
}

/** Format latency: <1000 → "Xms", else "X.Ys". */
function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Map latency to a fill-color band for the latency-progress cell. */
function latencyBand(ms: number | null | undefined): 'good' | 'mid' | 'bad' {
  if (ms == null) return 'good';
  if (ms > 1000) return 'bad';
  if (ms > 500) return 'mid';
  return 'good';
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

/** Trim a `user_id` to the leading 8 chars when no email is present. */
function fallbackActor(row: TraceRow): string {
  if (row.actor_email) return row.actor_email;
  if (row.user_id) return row.user_id.slice(0, 8);
  return '—';
}

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

/**
 * Admin AI-trace surface (`/admin/ai-logs`). Replaces the bespoke trace table
 * with an AG Grid Community implementation that fakes master/detail expansion
 * without the Enterprise plugin.
 *
 * ## Faux master/detail technique
 *
 * AG Grid's real `masterDetail: true` + `detailCellRenderer` API is Enterprise.
 * We mimic it cleanly in Community using two Community features:
 *
 * 1. **Synthetic detail rows** — when the user clicks a trace row, we insert
 *    a sibling `TraceRow` with `_isDetail: true` right
 *    after it in `displayRows()`. The grid still treats it as a normal row.
 * 2. **`isFullWidthRow` + `fullWidthCellRenderer`** — these ARE Community.
 *    We tell the grid that any row with `_isDetail === true` should render
 *    full-width via our HTML detail renderer. Row height grows dynamically
 *    via `getRowHeight()` so the expanded panel never clips.
 *
 * Net effect: the user clicks → row visually expands below itself showing
 * the system prompt, IO, tool result, action buttons. No Enterprise license.
 * The technique is documented inline so future maintainers don't go hunting
 * for `masterDetail: true` and find this looks like it.
 *
 * @example
 * ```html
 * <app-admin-ai-logs />
 * <!-- Renders the AG Grid + latency-percentile chart + filter row. -->
 * ```
 */
@Component({
  selector: 'app-admin-ai-logs',
  standalone: true,
  imports: [RollingCounterComponent, RevealDirective, AgGridAngular, HlmInputDirective, HlmTablistDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-4">
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="kicker">Observability</div>
          <h2 class="section-h text-lg font-bold text-white m-0 flex items-center gap-3">
            AI Traces
            <span class="live-pill" [class.live-pill--paused]="!polling()" [title]="polling() ? 'Polling every 15s' : (autoRefreshPaused() ? 'Auto-refresh paused after repeated errors — use Retry' : 'Polling paused (tab hidden)')">
              <span class="live-dot" aria-hidden="true"></span>
              <span class="live-text">{{ polling() ? 'Live' : (autoRefreshPaused() ? 'Auto-paused' : 'Paused') }}</span>
            </span>
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Every AI invocation — system prompt, input, output, tool dispatch. Click any row to expand the full trace inline.
          </p>
        </div>
      </header>

      <!-- KPI tiles ──────────────────────────────────────────────────── -->
      <!-- Hidden when the load errored with no data — definitive "0 calls · 0ms
           · 0 errors · 0 credits" over the error card is wrong (unknown, not 0).
           Stale data still shows them. Mirrors the marketplace/site-dna fix. -->
      @if (showKpis()) {
      <div class="grid grid-cols-4 gap-3 text-[0.78rem]">
        <div class="card" appReveal><div class="muted-h">Calls</div><div class="text-2xl font-bold text-white"><app-rolling-counter [value]="rows().length" [duration]="1100" /></div></div>
        <div class="card" appReveal><div class="muted-h">Avg latency</div><div class="text-2xl font-bold text-white">@if (avgLatency() < 1000) { <app-rolling-counter [value]="avgLatency()" suffix="ms" [duration]="1100" /> } @else { <app-rolling-counter [value]="avgLatency() / 1000" [decimals]="1" suffix="s" [duration]="1100" /> }</div></div>
        <div class="card" appReveal><div class="muted-h">Errors</div><div class="text-2xl font-bold" [class.text-red-400]="errors() > 0" [class.text-white]="errors() === 0"><app-rolling-counter [value]="errors()" [duration]="1100" /></div></div>
        <div class="card" appReveal><div class="muted-h">Credits used</div><div class="text-2xl font-bold text-white"><app-rolling-counter [value]="totalCredits()" [duration]="1100" /></div></div>
      </div>
      }

      @if (loadError() && rows().length === 0 && !loading()) {
        <div class="card" role="alert" data-testid="ai-logs-load-error">
          <p class="text-red-300 text-sm m-0 mb-2">{{ loadError() }}</p>
          <button class="btn-ghost text-xs" data-testid="ai-logs-retry" (click)="reload()">Retry</button>
        </div>
      }

      @if (gridLoadingSkeleton()) {
        <div class="card" data-testid="ai-logs-skeleton" aria-busy="true" aria-label="Loading AI traces">
          <div class="sk-line sk-line--head"></div>
          @for (n of [1,2,3,4,5]; track n) { <div class="sk-line"></div> }
        </div>
      } @else if (gridEmpty()) {
        <div class="card text-center py-10" data-testid="ai-logs-empty">
          <div class="empty-glyph" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <p class="text-white text-sm font-semibold m-0 mt-3">No AI traces yet</p>
          <p class="text-text-secondary text-[0.78rem] m-0 mt-1 max-w-sm mx-auto">
            Every AI invocation this site makes — prompts, outputs, tool calls — will appear here in real time.
          </p>
          <button class="btn-ghost text-xs mt-4" data-testid="ai-logs-empty-refresh" (click)="reload()">Refresh</button>
        </div>
      }

      <!-- Latency percentile chart (p50/p95/p99 stacked-area) ────────── -->
      @if (rows().length > 0) {
        <section class="card" appReveal>
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 class="m-0 text-base font-semibold text-white">Latency percentiles</h3>
              <p class="text-[0.7rem] text-text-secondary m-0 mt-0.5" data-testid="ai-logs-chart-subtitle">p50 / p95 / p99 over {{ chartPeriodLabel() }} · {{ windowSampleCount() }} {{ windowSampleCount() === 1 ? 'trace' : 'traces' }} · {{ chartBins().length }} bins</p>
            </div>
            <div class="period-pills" role="tablist" hlmTablist aria-label="Chart period">
              @for (p of periods; track p.id) {
                <button
                  type="button"
                  role="tab"
                  class="period-pill"
                  [class.active]="chartPeriod() === p.id"
                  [attr.data-testid]="'traces-period-' + p.id"
                  [attr.aria-selected]="chartPeriod() === p.id"
                  (click)="chartPeriod.set(p.id)">
                  {{ p.label }}
                </button>
              }
            </div>
          </div>
          <svg viewBox="0 0 600 140" preserveAspectRatio="none" class="w-full h-32 chart-svg">
            <defs>
              <linearGradient id="p50grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#00E5FF" stop-opacity="0.55"/>
                <stop offset="100%" stop-color="#00E5FF" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="p95grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#7C3AED" stop-opacity="0.50"/>
                <stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="p99grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <!-- Drawn back-to-front: p99 widest band → p95 → p50 on top. -->
            <path [attr.d]="chartAreaPath('p99')" fill="url(#p99grad)" />
            <path [attr.d]="chartAreaPath('p95')" fill="url(#p95grad)" />
            <path [attr.d]="chartAreaPath('p50')" fill="url(#p50grad)" />
            <path [attr.d]="chartLinePath('p99')" fill="none" stroke="#fbbf24" stroke-width="1.4" stroke-opacity="0.85"/>
            <path [attr.d]="chartLinePath('p95')" fill="none" stroke="#7C3AED" stroke-width="1.6" stroke-opacity="0.92"/>
            <path [attr.d]="chartLinePath('p50')" fill="none" stroke="#00E5FF" stroke-width="2"/>
          </svg>
          <div class="chart-legend">
            <span class="lg-dot lg-p50"></span>p50 {{ formatLatencyMs(currentP(50)) }}
            <span class="lg-dot lg-p95"></span>p95 {{ formatLatencyMs(currentP(95)) }}
            <span class="lg-dot lg-p99"></span>p99 {{ formatLatencyMs(currentP(99)) }}
          </div>
        </section>
      }

      @if (rows().length > 0) {
      <!-- Quick-filter search box (focus on '/') ───────────────────────── -->
      <label class="filter-shell" [class.is-focused]="searchFocused()">
        <svg class="filter-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
        </svg>
        <input
          #filterInput
          hlmInput
          [seamless]="true"
          data-testid="traces-filter"
          type="text"
          class="flex-1"
          placeholder="Filter traces — endpoint, tool, model, actor, preview…"
          [value]="filter()"
          (input)="filter.set(asInputValue($event))"
          (focus)="searchFocused.set(true)"
          (blur)="searchFocused.set(false)"
          aria-label="Filter traces"
        />
        <kbd class="filter-kbd" aria-hidden="true">/</kbd>
      </label>

      <!-- Full-bleed AG Grid ─────────────────────────────────────────── -->
      <div class="grid-frame">
        <ag-grid-angular
          data-testid="traces-grid"
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
          (gridReady)="onGridReady($event)"
          (rowClicked)="onRowClicked($event)">
        </ag-grid-angular>
      </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 0.3rem; }

    /* ─── Loading skeleton + empty state ─────────────────────────────── */
    .sk-line { height: 14px; border-radius: 6px; margin: 10px 0; background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(0,229,255,0.10) 50%, rgba(255,255,255,0.04) 75%); background-size: 200% 100%; animation: skShimmer 1.4s ease-in-out infinite; }
    .sk-line--head { width: 38%; height: 18px; margin-bottom: 18px; }
    @keyframes skShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    /* Cockpit empty-state glyph: SVG in a circular cyan halo (matches media /
       pseo / billing) — replaces the off-standard floating unicode char. */
    .empty-glyph { width: 56px; height: 56px; margin-inline: auto; display: grid; place-items: center; border-radius: 50%; color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 9%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 24%, transparent); }
    @media (prefers-reduced-motion: reduce) { .sk-line { animation: none; } }

    /* ─── Live pill ──────────────────────────────────────────────────── */
    .live-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: rgba(16,185,129,0.10); border: 1px solid rgba(16,185,129,0.28); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em; color: #10b981; }
    .live-pill--paused { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10); color: rgba(255,255,255,0.55); }
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 0 currentColor; animation: livePulse 1.8s ease-out infinite; }
    .live-pill--paused .live-dot { animation: none; opacity: 0.5; }
    @keyframes livePulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); } 70% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
    @media (prefers-reduced-motion: reduce) { .live-dot { animation: none; } }
    .live-text { text-transform: uppercase; }

    /* ─── Grid frame: full-bleed inside a soft border ────────────────── */
    .grid-frame {
      width: 100%;
      border: 1px solid color-mix(in oklch, currentColor 12%, transparent);
      border-radius: var(--ps-radius-lg, 14px);
      overflow: hidden;
      background: rgba(0,0,0,0.18);
      box-shadow: var(--ps-shadow-md, 0 4px 12px rgba(0,0,0,0.18));
    }
    .ag-grid-host { width: 100%; height: calc(100vh - 360px); min-height: 540px; }

    /* ─── Period selector (chart) ────────────────────────────────────── */
    .period-pills { display: inline-flex; gap: 4px; padding: 3px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    .period-pill { padding: 4px 11px; border-radius: 999px; border: 0; background: transparent; color: rgba(255,255,255,0.7); font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: background 140ms ease, color 140ms ease; }
    .period-pill:hover { color: #fff; }
    .period-pill.active { background: linear-gradient(135deg, rgba(0,229,255,0.22), rgba(124,58,237,0.22)); color: #00E5FF; }
    @media (prefers-reduced-motion: reduce) { .period-pill { transition: none; } }
    .chart-svg { display: block; }
    .chart-legend { display: flex; align-items: center; gap: 0.6rem; font-size: 0.65rem; color: rgba(255,255,255,0.65); margin-top: 0.5rem; flex-wrap: wrap; }
    .lg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-left: 0.4rem; }
    .lg-dot.lg-p50 { background: #00E5FF; }
    .lg-dot.lg-p95 { background: #7C3AED; }
    .lg-dot.lg-p99 { background: #fbbf24; }
    .lg-dot:first-child { margin-left: 0; }

    /* ─── Filter shell: focus ring on wrapper, NOT on input ──────────── */
    .filter-shell {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px; border-radius: 10px;
      background: rgba(0,0,0,0.28);
      border: 1px solid rgba(255,255,255,0.08);
      width: min(100%, 480px);
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    .filter-shell.is-focused { border-color: rgba(0,229,255,0.55); box-shadow: 0 0 0 3px rgba(0,229,255,0.16); }
    .filter-icon { color: rgba(255,255,255,0.55); flex: 0 0 auto; }
    /* .filter-input removed — now Spartan hlmInput [seamless] (wrapper owns the pill). */
    .filter-kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.65rem; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.65); }

    /* ─── Cell renderer: status pill ─────────────────────────────────── */
    :host ::ng-deep .cell-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.5; }
    :host ::ng-deep .cell-status-pill.ok { background: rgba(16,185,129,0.14); color: #34d399; border: 1px solid rgba(16,185,129,0.32); }
    :host ::ng-deep .cell-status-pill.error { background: rgba(239,68,68,0.14); color: #fca5a5; border: 1px solid rgba(239,68,68,0.34); }
    :host ::ng-deep .cell-status-pill.rate { background: rgba(251,191,36,0.14); color: #fcd34d; border: 1px solid rgba(251,191,36,0.32); }
    :host ::ng-deep .cell-status-pill.timeout { background: rgba(168,85,247,0.14); color: #d8b4fe; border: 1px solid rgba(168,85,247,0.32); }
    :host ::ng-deep .cell-status-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    /* ─── Cell renderer: latency w/ proportional fill ────────────────── */
    :host ::ng-deep .latency-cell { position: relative; display: flex; align-items: center; justify-content: flex-end; height: 100%; padding-right: 8px; }
    :host ::ng-deep .latency-cell .lat-fill { position: absolute; left: 4px; top: 50%; transform: translateY(-50%); height: 18px; border-radius: 4px; opacity: 0.20; pointer-events: none; }
    :host ::ng-deep .latency-cell .lat-fill.good { background: linear-gradient(90deg, rgba(16,185,129,0.4), rgba(16,185,129,0.08)); }
    :host ::ng-deep .latency-cell .lat-fill.mid  { background: linear-gradient(90deg, rgba(251,191,36,0.55), rgba(251,191,36,0.08)); }
    :host ::ng-deep .latency-cell .lat-fill.bad  { background: linear-gradient(90deg, rgba(239,68,68,0.65), rgba(239,68,68,0.08)); }
    :host ::ng-deep .latency-cell .lat-val { position: relative; z-index: 1; font-variant-numeric: tabular-nums; font-weight: 600; color: rgba(255,255,255,0.92); }


    /* ─── Detail panel: master/detail expansion (cinematic) ──────────── */
    :host ::ng-deep .detail-card {
      position: relative; padding: 1.1rem 1.3rem 1.35rem; margin: 0;
      background:
        radial-gradient(120% 80% at 50% -20%, rgba(0,229,255,0.10), transparent 60%),
        linear-gradient(180deg, rgba(0,229,255,0.05) 0%, rgba(124,58,237,0.03) 55%, rgba(6,6,16,0.0) 100%),
        rgba(6,6,16,0.55);
      border-top: 1px solid color-mix(in oklch, #00E5FF 28%, transparent);
      border-bottom: 1px solid color-mix(in oklch, #00E5FF 12%, transparent);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.06),
        inset 0 -1px 0 rgba(0,0,0,0.35),
        0 0 80px rgba(0, 229, 255, 0.04);
      animation: detail-in 320ms var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1));
      transform-origin: top center; overflow: hidden;
    }
    :host ::ng-deep .detail-card::before {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0,229,255,0.55) 22%, rgba(124,58,237,0.45) 64%, transparent);
      pointer-events: none;
    }
    @keyframes detail-in {
      0%   { opacity: 0; transform: translateY(-8px) scaleY(0.96); filter: blur(2px); }
      60%  { opacity: 1; filter: blur(0); }
      100% { opacity: 1; transform: translateY(0) scaleY(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      :host ::ng-deep .detail-card { animation: none; }
    }

    /* Metric pill header — latency / cost / tokens / model along the top. */
    :host ::ng-deep .detail-card .det-meta {
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      margin: 0 0 0.85rem;
    }
    :host ::ng-deep .detail-card .met-pill {
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 4px 11px 4px 9px; border-radius: 999px;
      font: 700 0.6rem/1 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--mpill, #00E5FF);
      background: color-mix(in oklch, var(--mpill, #00E5FF) 8%, transparent);
      border: 1px solid color-mix(in oklch, var(--mpill, #00E5FF) 32%, transparent);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
      white-space: nowrap;
    }
    :host ::ng-deep .detail-card .met-pill .met-val {
      font-size: 0.78rem; font-weight: 800; letter-spacing: -0.01em;
      color: #fff; font-variant-numeric: tabular-nums; text-transform: none;
    }
    :host ::ng-deep .detail-card .met-pill.is-lat   { --mpill: #00E5FF; }
    :host ::ng-deep .detail-card .met-pill.is-cost  { --mpill: #fbbf24; }
    :host ::ng-deep .detail-card .met-pill.is-tok   { --mpill: #c4b5fd; }
    :host ::ng-deep .detail-card .met-pill.is-model { --mpill: #34d399; }
    :host ::ng-deep .detail-card .met-pill.is-tool  { --mpill: #fdba74; }

    :host ::ng-deep .detail-card .detail-grid { display: grid; gap: 0.85rem; }
    :host ::ng-deep .detail-card .det-block {
      display: flex; flex-direction: column; gap: 0.45rem;
      position: relative;
      padding: 0.7rem 0.85rem 0.85rem 1rem;
      border-radius: var(--ps-radius-md, 12px);
      background: rgba(255,255,255,0.022);
      border: 1px solid rgba(255,255,255,0.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
      transition: border-color 220ms var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1));
    }
    :host ::ng-deep .detail-card .det-block::before {
      content: ""; position: absolute; left: 0; top: 14px; bottom: 14px;
      width: 2px; border-radius: 0 2px 2px 0;
      background: var(--det-rail, linear-gradient(180deg, #00E5FF, transparent));
      opacity: 0.7;
    }
    :host ::ng-deep .detail-card .det-block.kind-prompt  { --det-rail: linear-gradient(180deg, #00E5FF, rgba(0,229,255,0)); }
    :host ::ng-deep .detail-card .det-block.kind-input   { --det-rail: linear-gradient(180deg, #7C3AED, rgba(124,58,237,0)); }
    :host ::ng-deep .detail-card .det-block.kind-output  { --det-rail: linear-gradient(180deg, #34d399, rgba(52,211,153,0)); }
    :host ::ng-deep .detail-card .det-block.kind-tool    { --det-rail: linear-gradient(180deg, #f97316, rgba(249,115,22,0)); }
    :host ::ng-deep .detail-card .det-block.kind-error   { --det-rail: linear-gradient(180deg, #ef4444, rgba(239,68,68,0)); }
    :host ::ng-deep .detail-card .det-block.kind-explain { --det-rail: linear-gradient(180deg, #c4b5fd, rgba(196,181,253,0)); }
    :host ::ng-deep .detail-card .det-block:hover { border-color: rgba(0,229,255,0.18); }

    :host ::ng-deep .detail-card .det-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    :host ::ng-deep .detail-card .det-label {
      font: 700 0.6rem/1 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.65);
      display: inline-flex; align-items: center; gap: 6px;
    }
    :host ::ng-deep .detail-card .det-block.kind-prompt  .det-label { color: #7feef9; }
    :host ::ng-deep .detail-card .det-block.kind-input   .det-label { color: #c4b5fd; }
    :host ::ng-deep .detail-card .det-block.kind-output  .det-label { color: #6ee7b7; }
    :host ::ng-deep .detail-card .det-block.kind-tool    .det-label { color: #fdba74; }
    :host ::ng-deep .detail-card .det-block.kind-error   .det-label { color: #fca5a5; }
    :host ::ng-deep .detail-card .det-block.kind-explain .det-label { color: #c4b5fd; }

    /* Copy chip per code block */
    :host ::ng-deep .detail-card .det-copy {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 6px;
      font: 700 0.56rem/1 'JetBrains Mono', monospace; letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.55);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer; opacity: 0;
      transition: opacity 180ms ease, background 140ms ease, color 140ms ease, transform 140ms ease, border-color 140ms ease;
    }
    :host ::ng-deep .detail-card .det-block:hover .det-copy { opacity: 1; }
    :host ::ng-deep .detail-card .det-copy:focus-visible { opacity: 1; outline: 2px solid #00E5FF; outline-offset: 2px; }
    :host ::ng-deep .detail-card .det-copy:hover {
      background: rgba(0,229,255,0.10); color: #00E5FF; border-color: rgba(0,229,255,0.30);
      transform: translateY(-1px);
    }
    :host ::ng-deep .detail-card .det-copy.is-copied {
      color: #34d399; border-color: rgba(52,211,153,0.40); background: rgba(52,211,153,0.10); opacity: 1;
    }

    :host ::ng-deep .detail-card pre {
      background: linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0.55));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-sm, 8px);
      padding: 0.78rem 0.95rem;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.7rem; line-height: 1.6;
      white-space: pre-wrap; word-break: break-word;
      max-height: 280px; overflow: auto; margin: 0;
      color: rgba(245,245,247,0.94);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }
    :host ::ng-deep .detail-card pre.error-pre {
      border-left: 3px solid #ef4444; color: #fcd34d;
      background: linear-gradient(180deg, rgba(239,68,68,0.10), rgba(239,68,68,0.04));
      border-color: rgba(239,68,68,0.32);
    }
    :host ::ng-deep .detail-card .tk-key  { color: #fbbf24; }
    :host ::ng-deep .detail-card .tk-str  { color: #86efac; }
    :host ::ng-deep .detail-card .tk-num  { color: #67e8f9; }
    :host ::ng-deep .detail-card .tk-bool { color: #c4b5fd; }
    :host ::ng-deep .detail-card .tk-null { color: rgba(255,255,255,0.45); }
    :host ::ng-deep .detail-card .tk-pun  { color: rgba(255,255,255,0.55); }
    :host ::ng-deep .detail-card .kw {
      color: #00E5FF; font-weight: 700;
      text-shadow: 0 0 12px rgba(0,229,255,0.35);
    }

    :host ::ng-deep .detail-card .det-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 0.4rem; }
    :host ::ng-deep .detail-card .det-action {
      position: relative; isolation: isolate;
      padding: 0.55rem 1rem; border-radius: var(--ps-radius-sm, 8px);
      font: 700 0.68rem/1 'Sora', system-ui, sans-serif; letter-spacing: 0.02em;
      cursor: pointer; border: 1px solid transparent;
      background:
        linear-gradient(rgba(6,6,16,0.78), rgba(6,6,16,0.78)) padding-box,
        linear-gradient(135deg, rgba(0,229,255,0.55), rgba(124,58,237,0.42)) border-box;
      color: #7feef9;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
      transition:
        transform 140ms var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1)),
        box-shadow 220ms ease, background 200ms ease, color 140ms ease;
    }
    :host ::ng-deep .detail-card .det-action:hover:not([disabled]) {
      transform: translateY(-2px); color: #ccfafd;
      box-shadow:
        0 8px 22px -8px rgba(0, 229, 255, 0.55),
        inset 0 1px 0 rgba(255,255,255,0.08);
    }
    :host ::ng-deep .detail-card .det-action:active:not([disabled]) {
      transform: translateY(0) scale(0.97); transition-duration: 80ms;
      box-shadow: 0 0 0 4px rgba(0,229,255,0.22);
    }
    :host ::ng-deep .detail-card .det-action[disabled] { opacity: 0.40; cursor: not-allowed; }
    :host ::ng-deep .detail-card .det-action.violet {
      background:
        linear-gradient(rgba(6,6,16,0.78), rgba(6,6,16,0.78)) padding-box,
        linear-gradient(135deg, rgba(124,58,237,0.65), rgba(0,229,255,0.42)) border-box;
      color: #c4b5fd;
    }
    :host ::ng-deep .detail-card .det-action.violet:hover:not([disabled]) {
      color: #ddd6fe;
      box-shadow:
        0 8px 22px -8px rgba(124, 58, 237, 0.55),
        inset 0 1px 0 rgba(255,255,255,0.08);
    }
    :host ::ng-deep .detail-card .det-action.ghost {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.74);
    }
    :host ::ng-deep .detail-card .det-action.ghost:hover:not([disabled]) {
      background: rgba(255,255,255,0.05); color: #fff;
      border-color: rgba(255,255,255,0.22);
    }
    :host ::ng-deep .detail-card .det-action:focus-visible {
      outline: 2px solid #00E5FF; outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      :host ::ng-deep .detail-card .det-action { transition: none; }
      :host ::ng-deep .detail-card .det-action:hover:not([disabled]) { transform: none; }
    }

    :host ::ng-deep .detail-card .det-explain {
      margin-top: 0; padding: 0.85rem 1rem; border-radius: var(--ps-radius-sm, 8px);
      background: linear-gradient(135deg, rgba(124,58,237,0.14), rgba(124,58,237,0.06));
      border: 1px solid rgba(124,58,237,0.35);
      color: rgba(245,245,247,0.94); font-size: 0.74rem; line-height: 1.6;
      white-space: pre-wrap;
      box-shadow: inset 0 1px 0 rgba(196,181,253,0.10);
    }

    /* ─── AG Grid theme tweaks (dark cyan hover glow) ────────────────── */
    :host ::ng-deep .ag-row-hover { box-shadow: inset 3px 0 0 rgba(0,229,255,0.35); }
  `],
})
export class AdminAiLogsComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);

  @ViewChild('filterInput') filterInputRef?: ElementRef<HTMLInputElement>;

  /** Raw trace rows from the API. Drives every derived signal below. */
  rows = signal<TraceRow[]>([]);
  loading = signal(false);
  /** Persistent load failure — shown only when there are no rows (so a failed fetch isn't a blank/empty masquerade); stale data stays visible otherwise. */
  loadError = signal<string | null>(null);
  /** Consecutive failed auto-polls. After MAX, the 15s poll PAUSES so it stops
   *  re-hammering a persistently-failing endpoint ([[error-recovery]] "retry
   *  with backoff, max 3"). Manual Retry (+ tab-return) bypasses the guard and a
   *  successful load resets the counter → auto-poll resumes. */
  private static readonly MAX_AUTO_RETRIES = 3;
  readonly consecutiveErrors = signal(0);
  readonly autoRefreshPaused = computed(() => this.consecutiveErrors() >= AdminAiLogsComponent.MAX_AUTO_RETRIES);
  filter = signal('');
  searchFocused = signal(false);
  polling = signal(true);

  /** Set of trace ids currently expanded in the grid. */
  private expandedIds = signal<Set<string>>(new Set<string>());
  /** Cache of fetched details keyed by trace id (lazy-loaded on expand). */
  private detailCache = signal<Map<string, TraceDetail>>(new Map());
  /** Cache of AI explanations keyed by trace id. */
  private explainCache = signal<Map<string, string>>(new Map());
  /** Per-row explain-in-flight flag, for spinner UI. */
  private explainLoading = signal<Set<string>>(new Set());

  chartPeriod = signal<ChartPeriod>('24h');

  periods: ReadonlyArray<{ id: ChartPeriod; label: string; ms: number }> = [
    { id: '1h',  label: '1h',  ms: 60 * 60 * 1000 },
    { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
    { id: '7d',  label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
    { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  ] as const;

  /** Number of evenly-spaced time bins for the latency-percentile chart. */
  private static readonly CHART_BINS = 24;

  // ─── KPI signals ────────────────────────────────────────────────────
  avgLatency = computed<number>(() => {
    const list = this.rows();
    if (!list.length) return 0;
    return Math.round(list.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / list.length);
  });
  errors = computed<number>(() => this.rows().filter((r) => r.status === 'error').length);
  totalCredits = computed<number>(() => this.rows().reduce((a, r) => a + (r.credits_debited ?? 0), 0));
  /** Initial fetch with nothing yet on screen → show a skeleton, not the bare ag-grid "No Rows" overlay. */
  gridLoadingSkeleton = computed<boolean>(() => this.loading() && this.rows().length === 0);
  /** Genuine "no traces yet" (not loading, no error) → a friendly empty state, not ag-grid's generic overlay. */
  gridEmpty = computed<boolean>(() => !this.loading() && !this.loadError() && this.rows().length === 0);
  /** KPI tiles hidden when the load errored with no data — a definitive "0 calls
   *  · 0ms · 0 errors · 0 credits" over the error card is wrong (unknown, not 0). */
  // Show the KPI tiles only once the load has SETTLED (or stale data is present):
  // never flash a definitive "0 calls · 0ms · 0 errors · 0 credits" over the
  // loading skeleton (counts are unknown mid-fetch, not zero) NOR over the error
  // card (unknown, not zero). A background refresh with rows keeps them visible.
  showKpis = computed<boolean>(
    () => !this.gridLoadingSkeleton() && (!this.loadError() || this.rows().length > 0),
  );

  // ─── Filtered rows + synthetic detail injection ────────────────────
  /**
   * Rows after the free-text filter + the synthetic detail-row injection.
   * Whenever a row's id is in `expandedIds`, we splice a `_isDetail: true`
   * row right after it so the grid renders the full-width detail panel
   * below the master row (Community-tier master/detail emulation).
   */
  displayRows = computed<TraceRow[]>(() => {
    const q = this.filter().trim().toLowerCase();
    const expanded = this.expandedIds();
    const base = q
      ? this.rows().filter((r) => {
          const hay = `${r.endpoint_slug ?? ''} ${r.tool_name ?? ''} ${r.model ?? ''} ${r.actor_email ?? ''} ${r.output_preview ?? ''} ${r.error_message ?? ''} ${r.trace_kind}`.toLowerCase();
          return hay.includes(q);
        })
      : this.rows();
    const out: TraceRow[] = [];
    for (const r of base) {
      out.push({ ...r, _expanded: expanded.has(r.id) });
      if (expanded.has(r.id)) {
        out.push({
          ...r,
          id: `${r.id}::detail`,
          _isDetail: true,
          _parentId: r.id,
        });
      }
    }
    return out;
  });

  // ─── Chart: derive p50/p95/p99 from currently-loaded rows ──────────
  /**
   * Bin trace rows into N equal-width time slots over the selected period
   * and compute the latency p50/p95/p99 per bin. Bins with no samples
   * report 0 — the area chart will draw them as ground level.
   */
  chartBins = computed<{ p50: number; p95: number; p99: number; count: number }[]>(() => {
    const period = this.periods.find((p) => p.id === this.chartPeriod()) ?? this.periods[1]!;
    const now = Date.now();
    const from = now - period.ms;
    const bins = AdminAiLogsComponent.CHART_BINS;
    const binMs = period.ms / bins;
    const buckets: number[][] = Array.from({ length: bins }, () => []);
    for (const r of this.rows()) {
      const t = Date.parse(r.created_at);
      if (!Number.isFinite(t) || t < from || t > now) continue;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((t - from) / binMs)));
      if (r.latency_ms != null) buckets[idx]!.push(r.latency_ms);
    }
    return buckets.map((arr) => {
      if (arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
      const sorted = [...arr].sort((a, b) => a - b);
      const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), count: arr.length };
    });
  });

  /**
   * Loaded traces that actually fall inside the selected window — surfaced in
   * the chart subtitle so a sparse long-period view (only the recent N traces
   * are fetched, no server-side window param) reads as "small sample", not
   * "no activity".
   */
  readonly windowSampleCount = computed<number>(() =>
    this.chartBins().reduce((sum, b) => sum + b.count, 0),
  );

  /** Maximum latency across all percentiles in the current chart window. */
  private chartMax = computed<number>(() => {
    const bins = this.chartBins();
    return Math.max(1, ...bins.map((b) => b.p99));
  });

  /** Overall percentile across the currently-loaded rows (chart subtitle). */
  currentP(q: number): number {
    const lat = this.rows().map((r) => r.latency_ms ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
    if (!lat.length) return 0;
    return lat[Math.min(lat.length - 1, Math.floor((q / 100) * lat.length))] ?? 0;
  }

  /** SVG path `d` for a percentile band's filled area (with gradient). */
  chartAreaPath(key: 'p50' | 'p95' | 'p99'): string {
    const bins = this.chartBins();
    if (!bins.length) return '';
    const max = this.chartMax();
    const w = 600;
    const h = 140;
    const step = bins.length > 1 ? w / (bins.length - 1) : 0;
    const pts = bins.map((b, i) => ({
      x: i * step,
      y: h - 6 - (b[key] / max) * (h - 16),
    }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `${line} L ${pts[pts.length - 1]!.x.toFixed(1)} ${h} L ${pts[0]!.x.toFixed(1)} ${h} Z`;
  }

  /** SVG path `d` for the percentile line (stroked overlay on top of area). */
  chartLinePath(key: 'p50' | 'p95' | 'p99'): string {
    const bins = this.chartBins();
    if (!bins.length) return '';
    const max = this.chartMax();
    const w = 600;
    const h = 140;
    const step = bins.length > 1 ? w / (bins.length - 1) : 0;
    return bins.map((b, i) => {
      const x = i * step;
      const y = h - 6 - (b[key] / max) * (h - 16);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  chartPeriodLabel = computed<string>(() => {
    const p = this.periods.find((x) => x.id === this.chartPeriod());
    if (!p) return '';
    switch (p.id) {
      case '1h':  return 'the past hour';
      case '24h': return 'the past 24 hours';
      case '7d':  return 'the past 7 days';
      case '30d': return 'the past 30 days';
      default:    return '';
    }
  });

  // ─── AG Grid setup ──────────────────────────────────────────────────
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
    sortable: true,
    filter: false,
    resizable: true,
    minWidth: 60,
  };

  columnDefs: ColDef<TraceRow>[] = [
    {
      headerName: 'Status',
      field: 'status',
      width: 90,
      minWidth: 80,
      cellRenderer: (p: ICellRendererParams<TraceRow>): string => {
        const v = String(p.value ?? '').toLowerCase();
        let klass = 'ok';
        if (v === 'error') klass = 'error';
        else if (v === 'rate_limited' || v === 'rate-limited') klass = 'rate';
        else if (v === 'timeout') klass = 'timeout';
        const label = v ? v.replace(/_/g, ' ') : '—';
        return `<span class="cell-status-pill ${klass}"><span class="dot"></span>${escapeHtml(label)}</span>`;
      },
    },
    {
      headerName: 'When',
      field: 'created_at',
      width: 140,
      minWidth: 110,
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
      headerName: 'Endpoint',
      field: 'endpoint_slug',
      width: 150,
      minWidth: 120,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => p.data?.endpoint_slug ?? p.data?.trace_kind ?? '—',
      cellClass: 'mono',
    },
    {
      headerName: 'Tool',
      field: 'tool_name',
      width: 140,
      minWidth: 110,
      valueFormatter: (p) => (p.value as string | null) ?? '—',
      cellClass: 'mono',
    },
    {
      headerName: 'Model',
      field: 'model',
      width: 120,
      minWidth: 100,
      valueFormatter: (p) => prettifyModel(p.value as string),
    },
    {
      headerName: 'Latency',
      field: 'latency_ms',
      width: 110,
      minWidth: 90,
      type: 'numericColumn',
      cellRenderer: (p: ICellRendererParams<TraceRow>): string => {
        const ms = p.value as number | null;
        const pct = Math.max(0, Math.min(100, ((ms ?? 0) / 2000) * 100));
        const band = latencyBand(ms);
        return `
          <div class="latency-cell">
            <span class="lat-fill ${band}" style="width: calc(${pct.toFixed(1)}% - 8px); max-width: calc(100% - 8px);"></span>
            <span class="lat-val">${escapeHtml(formatLatency(ms))}</span>
          </div>
        `;
      },
    },
    {
      headerName: 'Credits',
      field: 'credits_debited',
      width: 90,
      minWidth: 70,
      type: 'numericColumn',
      cellStyle: { textAlign: 'right' },
      valueFormatter: (p) => NUMBER_FORMATTER.format((p.value as number | null) ?? 0),
    },
    {
      headerName: 'Actor',
      field: 'actor_email',
      width: 180,
      minWidth: 130,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => fallbackActor(p.data ?? ({} as TraceRow)),
      cellClass: 'mono',
    },
  ];

  /**
   * Stable row id callback — uses `id` for master rows and the parent-id
   * suffixed detail key for synthetic rows. Stable ids enable AG Grid's
   * incremental row reconciliation across `rowData` updates so expanded
   * rows don't flicker on each 15s poll.
   */
  getRowId = (params: { data: TraceRow }): string => params.data.id;

  /**
   * Dynamic row height: detail rows are taller to fit the expanded panel.
   * AG Grid calls this on every row when `rowData` changes.
   */
  getRowHeight = (params: RowHeightParams<TraceRow>): number | undefined | null => {
    if (params.data?._isDetail) return 480;
    return 40;
  };

  /** Tell AG Grid which rows render via `fullWidthCellRenderer`. */
  isFullWidthRow = (params: IsFullWidthRowParams<TraceRow>): boolean => {
    return !!params.rowNode.data?._isDetail;
  };

  /**
   * Full-width detail panel renderer — produces the expanded master/detail
   * card with system prompt + IO + tool result + action button row.
   * Imperative DOM construction (not innerHTML for the buttons) so we keep
   * proper closure references to `this.toggleExpand` / `this.copyTrace` /
   * `this.explainTrace` / `this.rerunTrace` / `this.openEndpoint` without
   * leaking globals.
   */
  fullWidthCellRenderer = (params: ICellRendererParams<TraceRow>): HTMLElement => {
    const data = params.data!;
    const parentId = data._parentId ?? '';
    const detail = this.detailCache().get(parentId);
    const root = document.createElement('div');
    root.className = 'detail-card';
    root.setAttribute('data-testid', `traces-detail-${parentId}`);

    if (!detail) {
      // Trigger a lazy fetch — re-render happens via signal effect below.
      this.fetchDetail(parentId);
      root.innerHTML = `
        <div class="detail-grid">
          <div class="det-block kind-prompt">
            <div class="det-head"><span class="det-label"><span aria-hidden="true">◐</span> Loading trace…</span></div>
            <pre style="opacity:0.55">Fetching system prompt, input payload, output text, tool dispatch…</pre>
          </div>
        </div>`;
      return root;
    }

    const promptHtml = detail.prompt_template ? highlightSystemPrompt(detail.prompt_template) : '<em>No system prompt captured.</em>';
    const inputPretty = (() => {
      try { return JSON.stringify(JSON.parse(detail.input_json), null, 2); }
      catch { return detail.input_json ?? ''; }
    })();
    const outputText = detail.output_text ?? detail.output_json ?? '';
    const toolArgs = (() => {
      if (!detail.tool_args_json) return '';
      try { return JSON.stringify(JSON.parse(detail.tool_args_json), null, 2); }
      catch { return detail.tool_args_json; }
    })();
    const toolResult = (() => {
      if (!detail.tool_result_json) return '';
      try { return JSON.stringify(JSON.parse(detail.tool_result_json), null, 2); }
      catch { return detail.tool_result_json; }
    })();

    const canRerun = !!(detail.endpoint_slug && detail.input_json);
    const explanation = this.explainCache().get(parentId);
    const explaining = this.explainLoading().has(parentId);

    // Build cinematic metric pill row — latency / cost / tokens / model / tool.
    const totalTokens = (detail.tokens_input ?? 0) + (detail.tokens_output ?? 0);
    const metaPills: string[] = [];
    if (detail.latency_ms != null) {
      metaPills.push(`<span class="met-pill is-lat" title="End-to-end latency">latency<span class="met-val">${escapeHtml(formatLatency(detail.latency_ms))}</span></span>`);
    }
    if (detail.credits_debited != null && detail.credits_debited > 0) {
      metaPills.push(`<span class="met-pill is-cost" title="Credits debited">cost<span class="met-val">${escapeHtml(NUMBER_FORMATTER.format(detail.credits_debited))}</span></span>`);
    }
    if (totalTokens > 0) {
      const inTok = detail.tokens_input ?? 0;
      const outTok = detail.tokens_output ?? 0;
      metaPills.push(`<span class="met-pill is-tok" title="${inTok} in · ${outTok} out">tokens<span class="met-val">${escapeHtml(NUMBER_FORMATTER.format(totalTokens))}</span></span>`);
    }
    if (detail.model) {
      metaPills.push(`<span class="met-pill is-model" title="${escapeHtml(detail.model)}">model<span class="met-val">${escapeHtml(prettifyModel(detail.model))}</span></span>`);
    }
    if (detail.tool_name) {
      metaPills.push(`<span class="met-pill is-tool" title="Tool dispatch">tool<span class="met-val">${escapeHtml(detail.tool_name)}</span></span>`);
    }

    // Helper to build a code block with a copy chip in its header.
    const codeBlock = (kind: string, label: string, body: string, copySource: string, blockTestId: string): string => `
      <div class="det-block kind-${kind}">
        <div class="det-head">
          <span class="det-label"><span aria-hidden="true">●</span> ${label}</span>
          <button type="button" class="det-copy" data-copy="${escapeHtml(copySource)}" data-no-row-toggle
                  data-testid="traces-copy-${blockTestId}-${parentId}" aria-label="Copy ${label}">Copy</button>
        </div>
        <pre>${body}</pre>
      </div>
    `;

    root.innerHTML = `
      ${metaPills.length ? `<div class="det-meta">${metaPills.join('')}</div>` : ''}
      <div class="detail-grid">
        ${codeBlock('prompt', 'System prompt', promptHtml, detail.prompt_template ?? '', 'prompt')}
        ${codeBlock('input', 'Input payload', highlightJson(inputPretty), inputPretty, 'input')}
        ${detail.error_message ? `
          <div class="det-block kind-error">
            <div class="det-head">
              <span class="det-label"><span aria-hidden="true">▲</span> Error</span>
              <button type="button" class="det-copy" data-copy="${escapeHtml(detail.error_message)}" data-no-row-toggle
                      data-testid="traces-copy-error-${parentId}" aria-label="Copy error">Copy</button>
            </div>
            <pre class="error-pre">${escapeHtml(detail.error_message)}</pre>
          </div>
        ` : codeBlock('output', 'Output text', escapeHtml(outputText || '—'), outputText || '', 'output')}
        ${detail.tool_name ? `
          <div class="det-block kind-tool">
            <div class="det-head">
              <span class="det-label"><span aria-hidden="true">⚙</span> Tool · ${escapeHtml(detail.tool_name)} · ${escapeHtml(detail.tool_status ?? '')}</span>
              <button type="button" class="det-copy" data-copy="${escapeHtml(toolResult || toolArgs || '{}')}" data-no-row-toggle
                      data-testid="traces-copy-tool-${parentId}" aria-label="Copy tool result">Copy</button>
            </div>
            <pre>${highlightJson(toolArgs || '{}')}</pre>
            <pre>${highlightJson(toolResult || '{}')}</pre>
          </div>
        ` : ''}
        ${explanation ? `
          <div class="det-block kind-explain">
            <div class="det-head">
              <span class="det-label"><span aria-hidden="true">✦</span> AI explanation</span>
            </div>
            <div class="det-explain" data-testid="traces-explain-result-${parentId}">${escapeHtml(explanation)}</div>
          </div>
        ` : ''}
        <div class="det-actions"></div>
      </div>
    `;

    // Wire per-code-block copy chips. Each chip carries its own `data-copy`
    // payload + flips to a "copied!" visual for 1.2s. Click bubbling is
    // suppressed so the parent row doesn't toggle collapse.
    root.querySelectorAll<HTMLButtonElement>('.det-copy').forEach((btn) => {
      btn.addEventListener('click', (ev: MouseEvent) => {
        ev.stopPropagation();
        const payload = btn.dataset['copy'] ?? '';
        if (!payload) return;
        navigator.clipboard.writeText(payload).then(
          () => {
            const original = btn.textContent ?? 'Copy';
            btn.classList.add('is-copied');
            btn.textContent = 'Copied';
            setTimeout(() => {
              btn.classList.remove('is-copied');
              btn.textContent = original;
            }, 1200);
          },
          () => this.toast.error('Clipboard unavailable'),
        );
      });
    });

    const actions = root.querySelector('.det-actions') as HTMLDivElement;

    const rerunBtn = document.createElement('button');
    rerunBtn.type = 'button';
    rerunBtn.className = 'det-action';
    rerunBtn.innerHTML = `<span aria-hidden="true">↻</span> Re-run`;
    rerunBtn.disabled = !canRerun;
    rerunBtn.title = canRerun ? 'Re-invoke this endpoint with the same input' : 'Cannot re-run: input or endpoint not captured';
    rerunBtn.setAttribute('data-testid', `traces-rerun-${parentId}`);
    rerunBtn.setAttribute('data-no-row-toggle', '');
    rerunBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.rerunTrace(detail); });
    actions.appendChild(rerunBtn);

    const explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'det-action violet';
    explainBtn.innerHTML = explaining
      ? `<span aria-hidden="true">◐</span> Asking AI…`
      : `<span aria-hidden="true">✦</span> Explain with AI`;
    explainBtn.disabled = explaining;
    explainBtn.setAttribute('data-testid', `traces-explain-${parentId}`);
    explainBtn.setAttribute('data-no-row-toggle', '');
    explainBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.explainTrace(parentId); });
    actions.appendChild(explainBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'det-action ghost';
    copyBtn.innerHTML = `<span aria-hidden="true">⧉</span> Copy JSON`;
    copyBtn.setAttribute('data-testid', `traces-copy-json-${parentId}`);
    copyBtn.setAttribute('data-no-row-toggle', '');
    copyBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.copyTrace(detail); });
    actions.appendChild(copyBtn);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'det-action ghost';
    openBtn.innerHTML = `<span aria-hidden="true">↗</span> Open endpoint`;
    openBtn.disabled = !detail.endpoint_slug;
    openBtn.setAttribute('data-testid', `traces-open-endpoint-${parentId}`);
    openBtn.setAttribute('data-no-row-toggle', '');
    openBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.openEndpoint(detail); });
    actions.appendChild(openBtn);

    return root;
  };

  private gridApi?: GridApi<TraceRow>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler?: () => void;
  /** Polling cadence — 15s matches the audit grid and the spec. */
  private static readonly POLL_MS = 15_000;

  constructor() {
    // Re-render the grid whenever the detail or explain cache flips so
    // freshly-fetched system prompts / AI explanations populate without a
    // second user click. Cheap: ag-grid only re-runs the cell renderers
    // for currently-mounted detail rows.
    effect(() => {
      // Touch the signals so the effect tracks them.
      this.detailCache();
      this.explainCache();
      this.explainLoading();
      if (this.gridApi) {
        this.gridApi.refreshCells({ force: true });
        // Full-width rows aren't covered by refreshCells — redraw them.
        const detailNodes: IRowNode<TraceRow>[] = [];
        this.gridApi.forEachNode((n) => { if (n.data?._isDetail) detailNodes.push(n); });
        if (detailNodes.length) this.gridApi.redrawRows({ rowNodes: detailNodes });
      }
    });
  }

  ngOnInit(): void {
    this.reload();
    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        this.polling.set(false);
        return;
      }
      if (this.autoRefreshPaused()) { this.polling.set(false); return; } // stopped after repeated errors; Retry/tab-return resumes
      this.polling.set(true);
      this.reload();
    }, AdminAiLogsComponent.POLL_MS);
    this.visibilityHandler = (): void => {
      if (typeof document === 'undefined') return;
      const vis = document.visibilityState === 'visible';
      this.polling.set(vis);
      if (vis) this.reload();
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

  reload(): void {
    const s = this.state.selectedSite();
    if (!s) return;
    this.loading.set(true);
    this.api.get<{ data: TraceRow[] }>(`/sites/${s.id}/ai-logs`, undefined, { silent: true }).subscribe({
      next: (r) => { this.rows.set(r.data ?? []); this.loadError.set(null); this.loading.set(false); this.consecutiveErrors.set(0); },
      // Silent error → empty grid masquerades as "no traces". Record it; the
      // banner shows only when there are no rows (stale data stays visible on a poll blip).
      error: () => { this.loadError.set('Could not load AI traces — retry.'); this.loading.set(false); this.consecutiveErrors.update((n) => n + 1); },
    });
  }

  onGridReady(ev: GridReadyEvent<TraceRow>): void {
    this.gridApi = ev.api;
    try {
      const raw = localStorage.getItem('ps_traces_grid_v1');
      if (raw) ev.api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
    } catch { /* ignore */ }
    ev.api.addEventListener('columnMoved', () => this.saveColState());
    ev.api.addEventListener('columnResized', () => this.saveColState());
    ev.api.addEventListener('columnVisible', () => this.saveColState());
    ev.api.addEventListener('sortChanged', () => this.saveColState());
  }
  private saveColState(): void {
    try { localStorage.setItem('ps_traces_grid_v1', JSON.stringify(this.gridApi?.getColumnState() ?? [])); } catch { /* */ }
  }

  /**
   * Toggle the expanded state for a trace row. Splicing a synthetic
   * `_isDetail` row in/out of `displayRows()` happens automatically via
   * the computed signal — we only flip `expandedIds` here.
   */
  toggleExpand(row: TraceRow): void {
    const next = new Set(this.expandedIds());
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    this.expandedIds.set(next);
    if (next.has(row.id)) this.fetchDetail(row.id);
  }

  /**
   * Click anywhere on a master row to toggle its accordion. Detail rows
   * (`_isDetail: true`) are click-through so the trace text inside stays
   * selectable; same goes for cells the user is actively text-selecting.
   */
  onRowClicked = (ev: { data?: TraceRow | null; event?: Event | null }): void => {
    const row = ev.data;
    if (!row || row._isDetail) return;
    // If the user is mid-selection (range-drag on cell text), don't toggle.
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    // If the click landed on an actionable child (link, button), let it own the click.
    const target = ev.event?.target as HTMLElement | undefined;
    if (target?.closest('a, button, [data-no-row-toggle]')) return;
    this.toggleExpand(row);
  };

  /** Lazy-fetch the full trace detail on first expand. */
  private fetchDetail(id: string): void {
    if (this.detailCache().has(id)) return;
    const s = this.state.selectedSite();
    if (!s) return;
    this.api.get<{ data: TraceDetail }>(`/sites/${s.id}/ai-logs/${id}`).subscribe({
      next: (r) => {
        const next = new Map(this.detailCache());
        next.set(id, r.data);
        this.detailCache.set(next);
      },
      error: () => { /* api.service already toasts */ },
    });
  }

  /** Copy the full trace (header + detail) to the clipboard as JSON. */
  async copyTrace(detail: TraceDetail): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
      this.toast.success('Trace copied to clipboard');
    } catch {
      this.toast.error('Clipboard unavailable');
    }
  }

  /**
   * POST to the explain endpoint. If the API returns 404/501 (not yet wired
   * up), surface a friendly toast and stub a cached message so the panel
   * still renders something useful.
   */
  explainTrace(id: string): void {
    if (this.explainCache().has(id) || this.explainLoading().has(id)) return;
    const loading = new Set(this.explainLoading());
    loading.add(id);
    this.explainLoading.set(loading);
    this.api.post<{ data: { markdown: string; model?: string; cached?: boolean } }>(
      `/admin/traces/${id}/explain`, {}, { silent: true },
    ).subscribe({
      next: (r) => {
        const next = new Map(this.explainCache());
        next.set(id, r?.data?.markdown ?? 'Explanation returned empty.');
        this.explainCache.set(next);
        const l = new Set(this.explainLoading()); l.delete(id); this.explainLoading.set(l);
      },
      error: (err: unknown) => {
        const code = (err as { status?: number } | null)?.status;
        const l = new Set(this.explainLoading()); l.delete(id); this.explainLoading.set(l);
        // The explain backend (/api/admin/traces/:id/explain) is live; a 404
        // means the trace row is gone (pruned), not "feature not shipped".
        const next = new Map(this.explainCache());
        if (code === 404) {
          this.toast.error('Trace not found — it may have been pruned.');
          next.set(id, 'This trace is no longer available.');
        } else {
          this.toast.error('Could not load explanation. Try again.');
          next.set(id, 'Explanation failed to load — retry.');
        }
        this.explainCache.set(next);
      },
    });
  }

  /**
   * Replay the trace by POSTing its captured input back to its endpoint slug.
   * Disabled when either field is missing — the rerun button surfaces that
   * via a tooltip and a disabled state.
   */
  rerunTrace(detail: TraceDetail): void {
    if (!detail.endpoint_slug || !detail.input_json) {
      this.toast.warning('Cannot re-run: input or endpoint missing');
      return;
    }
    const s = this.state.selectedSite();
    if (!s) return;
    let payload: unknown;
    try { payload = JSON.parse(detail.input_json); } catch { payload = detail.input_json; }
    this.api.post<{ data?: unknown }>(`/sites/${s.id}/ai-endpoints/${detail.endpoint_slug}/invoke`, payload as Record<string, unknown>, { silent: true }).subscribe({
      next: () => { this.toast.success('Endpoint re-run queued — refreshing traces'); setTimeout(() => this.reload(), 800); },
      error: () => this.toast.error('Re-run failed'),
    });
  }

  /** Navigate to the AI Endpoints page with the trace's endpoint highlighted. */
  openEndpoint(detail: TraceDetail): void {
    if (!detail.endpoint_slug) return;
    void this.router.navigate(['/admin/ai-endpoints'], { queryParams: { slug: detail.endpoint_slug } });
  }

  // ─── Hotkeys: `/` focuses the filter input (mirrors sidebar pattern) ─
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    if (ev.key === '/') {
      ev.preventDefault();
      this.filterInputRef?.nativeElement.focus();
    }
  }

  // ─── Template helpers ───────────────────────────────────────────────
  asInputValue(ev: Event): string {
    const el = ev.target as HTMLInputElement | null;
    return el?.value ?? '';
  }
  formatNumber(n: number): string { return NUMBER_FORMATTER.format(n); }
  formatLatencyMs(ms: number): string { return formatLatency(ms); }
}
