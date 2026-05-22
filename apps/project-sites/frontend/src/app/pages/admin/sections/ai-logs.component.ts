import { Component, inject, signal, computed, HostListener, type OnInit, type OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { EmptyStateComponent } from '../empty-state.component';

function sameDayLog(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';

interface Row {
  id: string; submission_id: string | null; trace_kind: string; endpoint_slug: string | null;
  model: string; status: string; latency_ms: number | null; tokens_input: number | null;
  tokens_output: number | null; credits_debited: number | null;
  tool_name: string | null; tool_status: string | null;
  output_preview: string | null; error_message: string | null; created_at: string;
  /** Optional join keys used for client-side forms filtering. */
  form_id?: string | null; source?: string | null;
}
interface Detail extends Row {
  prompt_template: string | null; input_json: string;
  output_text: string | null; output_json: string | null;
  tool_args_json: string | null; tool_result_json: string | null;
}

/** Compact representation of a form, used to populate the right-side filter. */
interface FormOption { id: string; label: string }

/**
 * Traces toolbar quick-filter view IDs. Kept literal so we can map keyboard
 * shortcuts (1/2/3) directly to the first three pills.
 */
type ViewId = 'all' | 'today' | 'errors' | 'with-tool' | 'high-lat';

@Component({
  selector: 'app-admin-ai-logs',
  standalone: true,
  imports: [FormsModule, DatePipe, EmptyStateComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0 flex items-center gap-3">
            AI Traces
            <!-- Live status pill: green dot pulses while polling, grey when paused. -->
            <span class="live-pill" [class.live-pill--paused]="!polling()" [title]="polling() ? 'Auto-syncing every 8s' : 'Polling paused (tab hidden)'">
              <span class="live-dot" aria-hidden="true"></span>
              <span class="live-text">{{ polling() ? 'Live' : 'Paused' }}</span>
              <span class="live-sep">·</span>
              <span class="live-sync" aria-live="polite">synced {{ syncedAgo() }}</span>
            </span>
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Every AI invocation — form router, custom endpoints, chat turns. Click any row for full prompt + input + output + tool execution trace.
          </p>
        </div>
      </header>

      <!-- Three-slot toolbar: search (left) · pills (center) · forms filter (right). -->
      <div class="toolbar" role="toolbar" aria-label="Trace filters">
        <!-- LEFT: search input with magnifying glass + ⌘F focus chip. -->
        <label class="tb-search" [class.tb-search--focused]="searchFocused()">
          <svg class="tb-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
          </svg>
          <input
            #searchInput
            data-testid="traces-search"
            type="text"
            class="tb-search-input"
            placeholder="Filter traces by endpoint, model, preview…"
            [value]="filter()"
            (input)="filter.set(asInputValue($event))"
            (focus)="searchFocused.set(true)"
            (blur)="searchFocused.set(false)"
            aria-label="Search traces"
          />
          <kbd class="tb-kbd" aria-hidden="true">⌘F</kbd>
        </label>

        <!-- CENTER: All/Today/Errors quick-filter pills with keyboard hints. -->
        <div class="tb-pills" role="tablist" aria-label="Quick filters">
          @for (v of clientViews; track v.id; let i = $index) {
            <button
              class="filter-chip"
              [class.active]="clientView() === v.id"
              [attr.aria-pressed]="clientView() === v.id"
              [attr.data-testid]="'traces-pill-' + v.id"
              (click)="setClientView(v.id)"
              [title]="v.label + ' view (press ' + (i + 1) + ')'"
            >
              {{ v.label }}
              <span class="filter-count">{{ countView(v.id) }}</span>
              @if (i < 3) { <kbd class="chip-kbd" aria-hidden="true">{{ i + 1 }}</kbd> }
            </button>
          }
        </div>

        <!-- RIGHT: forms-source filter — current site's forms, plus "All forms". -->
        <label class="tb-forms">
          <span class="tb-forms-label">Source</span>
          <select
            data-testid="traces-forms-filter"
            class="tb-forms-select"
            [value]="formFilter()"
            (change)="formFilter.set(asSelectValue($event))"
            aria-label="Filter by form source"
          >
            <option value="">All forms</option>
            @for (f of formOptions(); track f.id) {
              <option [value]="f.id">{{ f.label }}</option>
            }
          </select>
        </label>
      </div>

      <!-- Existing kind multi-select moved into a small secondary row to keep the
           three-slot primary toolbar visually balanced. -->
      <div class="flex items-center gap-2 flex-wrap">
        <div class="ml-select" #msel>
          <button class="ml-trigger" (click)="toggleKindMenu($event)" [class.active]="kindMenuOpen() || selectedKinds().length > 0" title="Filter by kind — choose any combination">
            <span class="ml-trigger-label">{{ selectedKindsLabel() }}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><polyline points="2 4 5 7 8 4"/></svg>
          </button>
          @if (kindMenuOpen()) {
            <div class="ml-menu" (click)="$event.stopPropagation()">
              @for (k of kindOptions; track k.id) {
                <label class="ml-row">
                  <input type="checkbox" [checked]="selectedKinds().includes(k.id)" (change)="toggleKind(k.id)" />
                  <span class="ml-dot" [style.background]="k.color"></span>
                  <span class="flex-1">{{ k.label }}</span>
                  <span class="ml-count">{{ countByKind(k.id) }}</span>
                </label>
              }
              @if (selectedKinds().length > 0) {
                <button class="ml-clear" (click)="clearKinds()">Clear</button>
              }
            </div>
          }
        </div>
      </div>

      <div class="grid grid-cols-4 gap-3">
        <div class="card"><div class="muted-h">Calls</div><div class="text-2xl font-bold text-white">{{ rows().length }}</div></div>
        <div class="card"><div class="muted-h">Avg latency</div><div class="text-2xl font-bold text-white">{{ avgLatency() }}ms</div></div>
        <div class="card"><div class="muted-h">Errors</div><div class="text-2xl font-bold" [class.text-red-400]="errors() > 0" [class.text-white]="errors() === 0">{{ errors() }}</div></div>
        <div class="card"><div class="muted-h">Credits used</div><div class="text-2xl font-bold text-white">{{ totalCredits() }}</div></div>
      </div>

      @if (rows().length > 0) {
        <section class="card">
          <div class="flex items-center justify-between mb-2">
            <h3 class="m-0 text-base font-semibold text-white">Calls — last 14 days</h3>
            <span class="text-[0.7rem] text-text-secondary">peak {{ peakDay() }} · today {{ todayCount() }}</span>
          </div>
          <svg viewBox="0 0 600 70" preserveAspectRatio="none" class="w-full h-16">
            <defs>
              <linearGradient id="ailGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#00E5FF" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#00E5FF" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path [attr.d]="sparkArea()" fill="url(#ailGrad)" />
            <path [attr.d]="sparkLine()" fill="none" stroke="#00E5FF" stroke-width="2"/>
          </svg>
        </section>
      }

      <section class="card p-0 overflow-hidden">
        @if (loading() && rows().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (rows().length === 0) {
          <app-empty-state
            icon="🛰"
            title="No AI traces yet"
            body="Submit a form via app.js or hit an AI endpoint — every model call lands here with the full prompt, input, output and tool dispatch."
            primary="Go to Forms"
            secondary="Open AI Endpoints"
            (primaryClick)="goForms()"
            (secondaryClick)="goEndpoints()" />
        } @else if (filteredRows().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">No traces match the current filter.</div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-3">When</th>
                <th class="text-left p-3">Kind</th>
                <th class="text-left p-3">Endpoint / Submission</th>
                <th class="text-left p-3">Status</th>
                <th class="text-left p-3">Tool</th>
                <th class="text-right p-3">ms</th>
                <th class="text-right p-3">Credits</th>
                <th class="text-left p-3">Preview</th>
                <th class="text-right p-3">Explain</th>
              </tr>
            </thead>
            <tbody>
              @for (r of filteredRows(); track r.id) {
                <tr class="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer" (click)="open(r.id)">
                  <td class="p-3 text-text-secondary">{{ r.created_at | date:'short' }}</td>
                  <td class="p-3"><span class="badge">{{ r.trace_kind }}</span></td>
                  <td class="p-3 font-mono text-[0.72rem]">{{ r.endpoint_slug || (r.submission_id?.slice(0,8) ?? '—') }}</td>
                  <td class="p-3">
                    <span class="font-bold text-[0.62rem] uppercase"
                          [class.text-emerald-400]="r.status === 'ok'"
                          [class.text-red-400]="r.status === 'error'"
                          [class.text-amber-400]="r.status !== 'ok' && r.status !== 'error'">{{ r.status }}</span>
                  </td>
                  <td class="p-3 text-[0.7rem]">
                    @if (r.tool_name) {
                      <span class="font-mono text-primary">{{ r.tool_name }}</span>
                      <span class="text-text-secondary"> · {{ r.tool_status }}</span>
                    } @else { — }
                  </td>
                  <td class="p-3 text-right text-text-secondary">{{ r.latency_ms }}</td>
                  <td class="p-3 text-right text-text-secondary">{{ r.credits_debited || 0 }}</td>
                  <td class="p-3 text-text-secondary/80 truncate max-w-[260px]" [title]="r.error_message || r.output_preview">
                    {{ r.error_message || r.output_preview || '—' }}
                  </td>
                  <td class="p-3 text-right">
                    <button
                      class="explain-btn"
                      type="button"
                      [attr.data-testid]="'trace-explain-' + r.id"
                      [disabled]="explainLoading() === r.id"
                      title="Ask AI to explain this trace"
                      (click)="explainTrace(r.id, $event)"
                    >
                      {{ explainLoading() === r.id ? '…' : '✨ Explain' }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (detail(); as d) {
        <section class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">Trace {{ d.id.substring(0, 8) }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="detail.set(null)">×</button>
          </div>
          <div class="space-y-3 text-[0.7rem]">
            <div><div class="muted-h">System prompt</div><pre class="trace">{{ d.prompt_template }}</pre></div>
            <div><div class="muted-h">Input</div><pre class="trace">{{ d.input_json }}</pre></div>
            <div><div class="muted-h">Output</div>
              @if (d.error_message) {
                <div class="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3">{{ d.error_message }}</div>
              } @else {
                <pre class="trace">{{ d.output_text }}</pre>
              }
            </div>
            @if (d.tool_name) {
              <div><div class="muted-h">Tool executed — {{ d.tool_name }} · {{ d.tool_status }}</div>
                <pre class="trace">{{ d.tool_args_json }}</pre>
                <pre class="trace">{{ d.tool_result_json }}</pre>
              </div>
            }
          </div>
        </section>
      }

      @if (explainPopover(); as p) {
        <section class="card border border-violet-500/40" role="dialog" aria-label="AI trace explanation" data-testid="trace-explain-popover">
          <div class="flex items-start justify-between gap-3 mb-2">
            <h3 class="m-0 text-base font-semibold text-white">✨ AI explanation · {{ p.id.substring(0,8) }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="explainPopover.set(null)" aria-label="Close">×</button>
          </div>
          <pre class="trace explain-md">{{ p.markdown }}</pre>
          <div class="explain-meta text-[0.6rem] text-text-secondary mt-2">
            {{ p.cached ? 'cached · ' : '' }}{{ p.model }}
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 0.3rem; }
    .trace { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 0.6rem; white-space: pre-wrap; word-break: break-word; max-height: 14rem; overflow: auto; font-size: 0.68rem; }
    .explain-btn { padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(124,58,237,0.4); background: rgba(124,58,237,0.10); color: #C7B6FF; font-size: 0.62rem; font-weight: 600; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
    .explain-btn:hover:not([disabled]) { background: rgba(124,58,237,0.18); border-color: rgba(124,58,237,0.65); color: #fff; }
    .explain-btn[disabled] { opacity: 0.6; cursor: progress; }
    .explain-md { max-height: 22rem; }

    /* ─── Live status pill (header) ──────────────────────────────────── */
    .live-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: rgba(16,185,129,0.10); border: 1px solid rgba(16,185,129,0.28); font-size: 0.62rem; font-weight: 600; letter-spacing: 0.02em; color: #10b981; }
    .live-pill--paused { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10); color: rgba(255,255,255,0.55); }
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 0 currentColor; animation: livePulse 1.8s ease-out infinite; }
    .live-pill--paused .live-dot { animation: none; opacity: 0.5; }
    @keyframes livePulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); } 70% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
    @media (prefers-reduced-motion: reduce) { .live-dot { animation: none; } }
    .live-sep { opacity: 0.55; }
    .live-sync { font-variant-numeric: tabular-nums; opacity: 0.85; }
    .live-text { text-transform: uppercase; }

    /* ─── Three-slot toolbar ─────────────────────────────────────────── */
    .toolbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 8px 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; }
    .tb-search { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.08); transition: border-color 150ms ease, box-shadow 150ms ease; justify-self: start; width: min(100%, 360px); }
    .tb-search--focused { border-color: rgba(0,229,255,0.5); box-shadow: 0 0 0 2px rgba(0,229,255,0.15); }
    .tb-search-icon { color: rgba(255,255,255,0.55); flex: 0 0 auto; }
    .tb-search-input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #fff; font-size: 0.78rem; padding: 2px 0; }
    .tb-search-input::placeholder { color: rgba(255,255,255,0.4); }
    .tb-kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.58rem; padding: 1px 6px; border-radius: 5px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
    .tb-pills { display: inline-flex; flex-wrap: wrap; gap: 6px; justify-self: center; }
    .tb-forms { display: inline-flex; align-items: center; gap: 8px; justify-self: end; }
    .tb-forms-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: rgba(255,255,255,0.5); }
    .tb-forms-select { padding: 6px 10px; border-radius: 10px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.74rem; font-weight: 600; min-width: 160px; max-width: 240px; }
    .tb-forms-select:hover { border-color: rgba(0,229,255,0.3); }

    /* ─── Pills ──────────────────────────────────────────────────────── */
    .filter-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.78); font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: background 150ms ease, border-color 150ms ease, color 150ms ease; }
    .filter-chip:hover { color: #fff; border-color: rgba(0,229,255,0.35); }
    .filter-chip.active { background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18)); color: #00E5FF; border-color: rgba(0,229,255,0.45); }
    @media (prefers-reduced-motion: reduce) { .filter-chip { transition: none; } }
    .filter-count { font-size: 0.6rem; opacity: 0.7; padding: 1px 5px; border-radius: 999px; background: rgba(255,255,255,0.06); }
    .chip-kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.56rem; padding: 0 5px; border-radius: 4px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.55); margin-left: 2px; }

    /* ─── Focus rings ────────────────────────────────────────────────── */
    .filter-chip:focus-visible, .tb-forms-select:focus-visible, .tb-search-input:focus-visible, .ml-trigger:focus-visible { outline: 2px solid #00E5FF; outline-offset: 2px; }

    /* ─── Existing inline multi-select (kind) ───────────────────────── */
    .ml-select { position: relative; display: inline-flex; }
    .ml-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.78); font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 150ms ease; }
    .ml-trigger:hover { color: #fff; border-color: rgba(0,229,255,0.3); }
    .ml-trigger.active { background: linear-gradient(135deg, rgba(0,229,255,0.14), rgba(124,58,237,0.14)); color: #00E5FF; border-color: rgba(0,229,255,0.35); }
    .ml-trigger svg { opacity: 0.65; }
    .ml-trigger-label { white-space: nowrap; }
    .ml-menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 220px; background: rgba(10,10,26,0.97); backdrop-filter: blur(16px); border: 1px solid rgba(0,229,255,0.22); border-radius: 10px; box-shadow: 0 18px 40px rgba(0,0,0,0.5); padding: 4px; z-index: 50; animation: mlIn 140ms ease; }
    @keyframes mlIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .ml-menu { animation: none; } }
    .ml-row { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; cursor: pointer; font-size: 0.74rem; color: rgba(255,255,255,0.85); }
    .ml-row:hover { background: rgba(0,229,255,0.06); }
    .ml-row input { accent-color: #00E5FF; cursor: pointer; }
    .ml-dot { width: 8px; height: 8px; border-radius: 50%; }
    .ml-count { font-size: 0.6rem; opacity: 0.6; padding: 1px 6px; border-radius: 999px; background: rgba(255,255,255,0.05); }
    .ml-clear { display: block; width: 100%; padding: 6px 9px; border: 0; border-top: 1px solid rgba(255,255,255,0.06); background: transparent; color: rgba(255,255,255,0.55); font-size: 0.66rem; cursor: pointer; text-align: left; margin-top: 2px; }
    .ml-clear:hover { color: #00E5FF; }

    /* ─── Responsive collapse: stack vertically under 768px ──────────── */
    @media (max-width: 768px) {
      .toolbar { grid-template-columns: 1fr; gap: 10px; }
      /* Order: pills first, then search, then forms filter (per spec). */
      .tb-pills   { order: 1; justify-self: stretch; justify-content: center; }
      .tb-search  { order: 2; justify-self: stretch; width: 100%; }
      .tb-forms   { order: 3; justify-self: stretch; }
      .tb-forms-select { flex: 1; max-width: none; }
    }
  `],
})
export class AdminAiLogsComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private router = inject(Router);
  goForms(): void { this.router.navigateByUrl('/admin/forms'); }
  goEndpoints(): void { this.router.navigateByUrl('/admin/ai-endpoints'); }

  // 14-day calls sparkline
  callsByDay = computed<{ day: string; count: number }[]>(() => {
    const out: Record<string, number> = {};
    const today = new Date();
    for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); out[d.toISOString().slice(0, 10)] = 0; }
    for (const r of this.rows()) { const day = r.created_at.slice(0, 10); if (day in out) out[day]! += 1; }
    return Object.entries(out).map(([day, count]) => ({ day, count }));
  });
  peakDay = computed(() => Math.max(0, ...this.callsByDay().map((d) => d.count)));
  todayCount = computed(() => this.callsByDay()[13]?.count ?? 0);
  sparkPoints = computed<{ x: number; y: number }[]>(() => {
    const days = this.callsByDay();
    if (!days.length) return [];
    const peak = Math.max(1, ...days.map((d) => d.count));
    const step = days.length > 1 ? 600 / (days.length - 1) : 0;
    return days.map((d, i) => ({ x: i * step, y: 65 - (d.count / peak) * 55 }));
  });
  sparkLine = computed(() => this.sparkPoints().map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
  sparkArea = computed(() => {
    const pts = this.sparkPoints(); if (!pts.length) return '';
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `${line} L ${pts[pts.length - 1]!.x.toFixed(1)} 70 L ${pts[0]!.x.toFixed(1)} 70 Z`;
  });
  rows = signal<Row[]>([]);
  clientViews: ReadonlyArray<{ id: ViewId; label: string; test: (r: Row) => boolean }> = [
    { id: 'all',       label: 'All',        test: (_r: Row) => true },
    { id: 'today',     label: 'Today',      test: (r: Row) => sameDayLog(new Date(r.created_at), new Date()) },
    { id: 'errors',    label: 'Errors',     test: (r: Row) => r.status === 'error' },
    { id: 'with-tool', label: 'Tool-used',  test: (r: Row) => !!r.tool_name },
    { id: 'high-lat',  label: 'Slow (>1s)', test: (r: Row) => (r.latency_ms ?? 0) > 1000 },
  ] as const;
  clientView = signal<ViewId>(((): ViewId => {
    try { return (localStorage.getItem('ps_ailogs_view') as ViewId) || 'all'; } catch { return 'all'; }
  })());

  /** Free-text search filter (left toolbar slot). Matches endpoint/model/preview/error. */
  filter = signal<string>('');
  /** Whether the search input currently has focus (for ring styling). */
  searchFocused = signal<boolean>(false);
  /** Selected form id for the right-slot dropdown — empty string = "All forms". */
  formFilter = signal<string>('');
  /** Forms loaded from `/sites/:id/forms`, used to populate the source dropdown. */
  formOptions = signal<FormOption[]>([]);

  filteredRows = computed(() => {
    const v = this.clientViews.find((x) => x.id === this.clientView()) ?? this.clientViews[0]!;
    const q = this.filter().trim().toLowerCase();
    const fid = this.formFilter();
    return this.rows().filter((r) => {
      if (!v.test(r)) return false;
      if (fid) {
        // Match either trace.form_id or trace.source for resilience to schema drift.
        const matches = r.form_id === fid || r.source === fid || r.endpoint_slug === fid;
        if (!matches) return false;
      }
      if (q) {
        const hay = `${r.endpoint_slug ?? ''} ${r.model ?? ''} ${r.output_preview ?? ''} ${r.error_message ?? ''} ${r.tool_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });
  setClientView(id: ViewId): void {
    this.clientView.set(id);
    try { localStorage.setItem('ps_ailogs_view', id); } catch { /* */ }
  }
  countView(id: ViewId): number {
    const v = this.clientViews.find((x) => x.id === id) ?? this.clientViews[0]!;
    return this.rows().filter((r) => v.test(r)).length;
  }
  detail = signal<Detail | null>(null);
  loading = signal(false);

  /** Trace id currently being explained — drives the row-level spinner. */
  explainLoading = signal<string | null>(null);
  /** Currently-displayed AI explanation popover, or `null` when closed. */
  explainPopover = signal<{ id: string; markdown: string; model: string; cached: boolean } | null>(null);
  // Multi-select kind filter — replaces the old single-value native dropdown.
  kindOptions = [
    { id: 'form',     label: 'Forms',     color: '#00E5FF' },
    { id: 'endpoint', label: 'Endpoints', color: '#7C3AED' },
    { id: 'chat',     label: 'Chat',      color: '#10b981' },
    { id: 'search',   label: 'Search',    color: '#fbbf24' },
  ] as const;
  selectedKinds = signal<string[]>(((): string[] => {
    try { return JSON.parse(localStorage.getItem('ps_ailogs_kinds') ?? '[]'); } catch { return []; }
  })());
  kindMenuOpen = signal(false);
  toggleKindMenu(ev: Event): void { ev.stopPropagation(); this.kindMenuOpen.update((v) => !v); }
  toggleKind(id: string): void {
    const cur = this.selectedKinds();
    const next = cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id];
    this.selectedKinds.set(next);
    try { localStorage.setItem('ps_ailogs_kinds', JSON.stringify(next)); } catch { /* */ }
    this.reload();
  }
  clearKinds(): void {
    this.selectedKinds.set([]);
    try { localStorage.setItem('ps_ailogs_kinds', '[]'); } catch { /* */ }
    this.reload();
  }
  selectedKindsLabel = computed(() => {
    const k = this.selectedKinds();
    if (k.length === 0) return 'All kinds';
    if (k.length === 1) return this.kindOptions.find((o) => o.id === k[0])?.label ?? '1 selected';
    return `${k.length} kinds`;
  });
  countByKind(id: string): number { return this.rows().filter((r) => r.trace_kind === id).length; }
  avgLatency = computed(() => { const list = this.rows(); if (!list.length) return 0; return Math.round(list.reduce((a,r) => a + (r.latency_ms ?? 0), 0) / list.length); });
  errors = computed(() => this.rows().filter((r) => r.status === 'error').length);
  totalCredits = computed(() => this.rows().reduce((a,r) => a + (r.credits_debited ?? 0), 0));

  // ─── Live sync / polling state ──────────────────────────────────────
  /** Whether the polling loop is actively running (false when tab hidden). */
  polling = signal<boolean>(true);
  /** Wall-clock ms of the last successful reload, used to render "synced Xs ago". */
  private lastSyncedAt = signal<number>(Date.now());
  /** 1Hz tick driving the "synced N s ago" relative-time pill. */
  private nowTick = signal<number>(Date.now());
  /** Browser timer ID for the 8s reload loop. Exposed on window for tests/debug. */
  public pollingTimerId: number | null = null;
  /** Browser timer ID for the 1Hz "syncedAgo" clock. */
  private clockTimerId: number | null = null;
  /** Active SSE stream when the optional realtime path is connected. */
  private sse: EventSource | null = null;
  /** Number of consecutive SSE errors observed (fall back to polling at >=2). */
  private sseErrors = 0;

  /**
   * Human-readable "N seconds/minutes ago" since last successful reload.
   * Updates each tick so the header pill feels alive without re-rendering rows.
   */
  syncedAgo = computed<string>(() => {
    const delta = Math.max(0, Math.round((this.nowTick() - this.lastSyncedAt()) / 1000));
    if (delta < 2) return '<2s ago';
    if (delta < 60) return `${delta}s ago`;
    const m = Math.floor(delta / 60);
    return `${m}m ago`;
  });

  ngOnInit(): void {
    this.reload();
    this.loadForms();
    this.startSync();
    // Close the multi-select on outside click.
    document.addEventListener('click', this.outsideClick);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }
  ngOnDestroy(): void {
    document.removeEventListener('click', this.outsideClick);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stopPolling();
    this.stopClock();
    this.closeSse();
  }
  private outsideClick = (): void => { if (this.kindMenuOpen()) this.kindMenuOpen.set(false); };

  /**
   * Bootstraps the live-sync layer. Tries SSE first; if it 404s or errors out
   * twice, transparently falls back to an 8-second polling loop. Always starts
   * the 1Hz clock so the "synced Xs ago" pill stays fresh.
   */
  private startSync(): void {
    this.startClock();
    this.tryOpenSse();
    // Polling starts immediately as a safety net; SSE success will pause it.
    this.startPolling();
  }

  /** Attempt to open the optional SSE stream. Silent fallback to polling on failure. */
  private tryOpenSse(): void {
    if (typeof EventSource === 'undefined') return; // server-side / unsupported env
    try {
      const es = new EventSource('/api/admin/traces/stream');
      this.sse = es;
      es.onmessage = (): void => {
        // Any server event = reload; cheap enough at trace volumes.
        this.reload();
      };
      es.onopen = (): void => {
        // Stream is live — pause polling to avoid double-loading.
        this.sseErrors = 0;
        this.stopPolling();
      };
      es.onerror = (): void => {
        this.sseErrors += 1;
        if (this.sseErrors >= 2) {
          this.closeSse();
          // Make sure polling is running once we give up on SSE.
          this.startPolling();
        }
      };
    } catch {
      // Constructor itself threw — never had a stream, polling already covers us.
      this.sse = null;
    }
  }

  private closeSse(): void {
    if (this.sse) { try { this.sse.close(); } catch { /* */ } this.sse = null; }
  }

  /** Start the 8s reload loop. Guarded against double-start and against hidden tabs. */
  private startPolling(): void {
    if (this.pollingTimerId !== null) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.polling.set(false);
      return;
    }
    this.polling.set(true);
    this.pollingTimerId = (globalThis.setInterval(() => {
      // Re-check visibility every tick — covers the case where the listener missed an event.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      this.reload();
    }, 8000) as unknown as number);
  }

  private stopPolling(): void {
    if (this.pollingTimerId !== null) { globalThis.clearInterval(this.pollingTimerId); this.pollingTimerId = null; }
    this.polling.set(false);
  }

  /** 1Hz tick that drives the relative-time pill. Cheap, no API calls. */
  private startClock(): void {
    if (this.clockTimerId !== null) return;
    this.clockTimerId = (globalThis.setInterval(() => this.nowTick.set(Date.now()), 1000) as unknown as number);
  }
  private stopClock(): void {
    if (this.clockTimerId !== null) { globalThis.clearInterval(this.clockTimerId); this.clockTimerId = null; }
  }

  /** Pause polling when the tab is hidden; resume + immediate refresh on return. */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // Resume: if SSE is healthy, leave polling stopped; otherwise restart.
      if (!this.sse) this.startPolling();
      else this.polling.set(true);
      this.reload();
    } else {
      this.stopPolling();
    }
  };

  /** Populate the right-slot forms dropdown from the current site's forms. */
  private loadForms(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: Array<{ id: string; name?: string | null; slug?: string | null }> }>(`/sites/${s.id}/forms`).subscribe({
      next: (r) => {
        const list = (r?.data ?? []).map((f) => ({
          id: f.id,
          label: f.name?.trim() || f.slug?.trim() || f.id.slice(0, 8),
        }));
        this.formOptions.set(list);
      },
      error: () => this.formOptions.set([]),
    });
  }

  reload(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.loading.set(true);
    // Multi-kind request: fan-out per selected kind, merge + dedupe. When
    // none selected, single request returns ALL kinds.
    const kinds = this.selectedKinds();
    if (kinds.length === 0) {
      this.api.get<{ data: Row[] }>(`/sites/${s.id}/ai-logs`).subscribe({
        next: (r) => { this.rows.set(r.data ?? []); this.loading.set(false); this.lastSyncedAt.set(Date.now()); },
        error: () => this.loading.set(false),
      });
      return;
    }
    Promise.all(kinds.map((k) =>
      new Promise<Row[]>((resolve) => {
        this.api.get<{ data: Row[] }>(`/sites/${s.id}/ai-logs`, { kind: k }).subscribe({
          next: (r) => resolve(r.data ?? []),
          error: () => resolve([]),
        });
      }),
    )).then((batches) => {
      const seen = new Set<string>();
      const merged: Row[] = [];
      for (const batch of batches) for (const r of batch) if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
      merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
      this.rows.set(merged);
      this.loading.set(false);
      this.lastSyncedAt.set(Date.now());
    });
  }
  open(id: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: Detail }>(`/sites/${s.id}/ai-logs/${id}`).subscribe({
      next: (r) => this.detail.set(r.data),
    });
  }

  /**
   * Ask the backend to summarise a trace via Llama 3.3 70B.
   *
   * The button is rendered per-row; clicking stops event bubbling so the
   * row's row-click handler (which opens the detail drawer) does not also
   * fire. Result is cached server-side in KV for an hour.
   */
  explainTrace(id: string, ev: Event): void {
    ev.stopPropagation();
    this.explainLoading.set(id);
    this.api.post<{ data: { markdown: string; model: string; cached: boolean } }>(
      `/admin/traces/${id}/explain`, {},
    ).subscribe({
      next: (r) => {
        this.explainLoading.set(null);
        this.explainPopover.set({
          id,
          markdown: r.data.markdown,
          model: r.data.model,
          cached: r.data.cached,
        });
      },
      error: () => {
        this.explainLoading.set(null);
        this.explainPopover.set({
          id,
          markdown: 'AI explanation unavailable. Try again in a moment.',
          model: '@cf/meta/llama-3.3-70b-instruct',
          cached: false,
        });
      },
    });
  }

  /**
   * Keyboard shortcuts (1/2/3) cycle through the first three pills. Suppressed
   * while focus is inside an editable field so users can still type "1/2/3".
   */
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target as HTMLElement | null;
    if (t) {
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
    }
    const map: Record<string, ViewId> = { '1': 'all', '2': 'today', '3': 'errors' };
    const target = map[ev.key];
    if (target) { ev.preventDefault(); this.setClientView(target); }
  }

  /** Type-safe extractor for `<input>` change events (avoids `any` casts). */
  asInputValue(ev: Event): string {
    const el = ev.target as HTMLInputElement | null;
    return el?.value ?? '';
  }
  /** Type-safe extractor for `<select>` change events. */
  asSelectValue(ev: Event): string {
    const el = ev.target as HTMLSelectElement | null;
    return el?.value ?? '';
  }
}
