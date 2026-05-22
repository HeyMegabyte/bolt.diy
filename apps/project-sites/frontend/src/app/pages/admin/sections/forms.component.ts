import {
  Component,
  inject,
  signal,
  computed,
  type OnInit,
  type OnDestroy,
} from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { mcpProvider } from './mcp-providers';

/**
 * Compare two dates for same-day equality (local timezone).
 * @example sameDay(new Date(), new Date()) // → true
 */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * One row in the form-submissions inbox.
 * @remarks Returned by `GET /sites/:id/form-submissions`.
 */
interface Submission {
  id: string;
  form_name: string;
  email: string | null;
  fields: Record<string, unknown>;
  status: string;
  origin_url: string | null;
  ip_address: string | null;
  created_at: string;
}

/**
 * AI router trace row attached to a submission.
 * @remarks Returned by `GET /sites/:id/form-submissions/:id` under `ai_logs`.
 */
interface AiLog {
  id: string;
  trace_kind: string;
  status: string;
  model: string;
  latency_ms: number | null;
  output_text: string | null;
  tool_name: string | null;
  tool_status: string | null;
  error_message: string | null;
  created_at: string;
}

/**
 * Settings payload for the form-handling-prompt widget. The fallback reply
 * email is intentionally NOT edited from here — it lives in Settings → General
 * and is mirrored read-only via the inline notice.
 */
interface Settings {
  form_router_prompt: string | null;
  form_router_prompt_default: string;
  reply_email: string | null;
}

/**
 * Single MCP brand metadata entry. Duplicated locally to avoid a circular
 * dep with `settings.component.ts` — keep this subset in sync if a new
 * provider is added there.
 */
interface McpMeta {
  readonly label: string;
  readonly color: string;
  readonly desc: string;
}

/**
 * Local accessor that adapts the shared MCP_PROVIDERS catalogue to the
 * `McpMeta` shape used by the pill row (label + color + desc only).
 *
 * @remarks
 * Previously this file kept a local frozen `MCP_META` copy to avoid a
 * circular import via `settings.component.ts`. The catalogue now lives in
 * `./mcp-providers.ts` (no Angular dependencies → safe to import from any
 * sibling), so we delegate to `mcpProvider(id)` for the data and project
 * down to `McpMeta` here.
 *
 * @example
 * mcpMeta('stripe'); // { label: 'Stripe', color: '#635BFF', desc: '…' }
 */
function mcpMeta(id: string): McpMeta | undefined {
  const p = mcpProvider(id);
  return p ? { label: p.label, color: p.color, desc: p.desc } : undefined;
}

/**
 * Decorated MCP connection used by the pill row.
 * @internal
 */
interface McpPill {
  readonly provider: string;
  readonly label: string;
  readonly color: string;
  readonly desc: string;
}

/**
 * Auto-poll cadence for the submissions inbox, milliseconds.
 * @remarks Paused while the tab is hidden (visibilityState !== 'visible').
 */
const POLL_INTERVAL_MS = 10_000;

/**
 * Admin → Forms section. Inbox + analytics list, plus the embedded
 * Form-Handling-Prompt widget (textarea + MCP pills + AI improve + save).
 *
 * @remarks
 * - No "Refresh" button: auto-polls every {@link POLL_INTERVAL_MS} ms.
 * - Fallback reply email is read-only here; edit it in Settings → General.
 * - MCP pills are unchecked by default and toggle to brand color on click.
 *
 * @example
 * <app-admin-forms />
 */
@Component({
  selector: 'app-admin-forms',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, JsonPipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Forms</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            One prompt handles every form submission and routes it to the right action — MailChimp signup, Stripe invoice, email reply, HubSpot contact — using your connected MCPs.
            @if (mcpConnections().length > 0) {
              <span class="text-emerald-400">· {{ mcpConnections().length }} MCP{{ mcpConnections().length === 1 ? '' : 's' }} connected</span>
            } @else {
              <span class="text-amber-300">· no MCPs connected — only email fallback available</span>
            }
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="live-pill" [title]="livePillTooltip()" aria-live="polite">
            <span class="live-dot" [class.is-paused]="!polling()"></span>
            Live · last sync {{ syncAgoLabel() }}
          </span>
          <button class="btn-primary" (click)="toggleTest()" title="Try the prompt against a sample payload (1 credit)">{{ testOpen() ? 'Close Test' : 'Test Prompt' }}</button>
        </div>
      </header>

      <!-- Inline expansion below the entire button stack — opens for Test Prompt -->
      @if (testOpen()) {
        <section class="card border border-primary/30">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="m-0 text-base font-semibold text-white">Test the Form Handling Prompt</h3>
              <p class="m-0 mt-0.5 text-[0.7rem] text-text-secondary">Runs the current prompt against this payload (1 credit).</p>
            </div>
            <button class="text-text-secondary hover:text-white" (click)="testOpen.set(false)" aria-label="Close" title="Close test panel">×</button>
          </div>
          <div class="grid sm:grid-cols-2 gap-2">
            <input class="input-field" placeholder="form_name (e.g. newsletter, contact)" [(ngModel)]="testInput.form_name" />
            <input class="input-field" type="email" placeholder="email" [(ngModel)]="testInput.email" />
          </div>
          <textarea class="input-field w-full mt-2 font-mono text-[0.72rem]" rows="3" placeholder='Other fields as JSON, e.g. { "message": "hi", "name": "Brian" }'
                    [(ngModel)]="testInput.fields_json"></textarea>
          <div class="flex justify-between items-center mt-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              @for (m of mcpConnections(); track m.provider) {
                <span class="mcp-chip" [style.background]="m.color + '20'" [style.color]="m.color" [style.border-color]="m.color + '60'" [title]="m.desc">{{ m.label }}</span>
              }
            </div>
            <button class="btn-primary" (click)="runTest()" [disabled]="testing()" title="Run the prompt now">{{ testing() ? 'Running…' : 'Run' }}</button>
          </div>
          @if (testResult()) {
            <div class="mt-3">
              <span class="muted-h">Result</span>
              <pre class="bg-black/40 border border-white/5 rounded-lg p-3 text-[0.7rem] overflow-auto max-h-72 mt-1">{{ testResult() | json }}</pre>
            </div>
          }
        </section>
      }

      <!-- Form Handling Prompt — inline widget (no modal) -->
      <section class="card">
        <header class="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">Form Handling Prompt</h3>
            <p class="m-0 mt-0.5 text-[0.7rem] text-text-secondary">The single prompt that routes every submission. Enable MCPs to expose them as routing targets.</p>
          </div>
        </header>

        <label class="block">
          <span class="muted-h">Handling prompt</span>
          <textarea class="input-field w-full mt-1 font-mono text-[0.72rem]" rows="12"
                    [placeholder]="settings.form_router_prompt_default || 'Describe how form submissions should be routed…'"
                    [(ngModel)]="settings.form_router_prompt"></textarea>
        </label>

        <div class="mt-3">
          <span class="muted-h">MCP integrations available to this prompt</span>
          <p class="text-[0.66rem] text-text-secondary m-0 mt-1 mb-2">Tap a pill to enable it. Unchecked MCPs stay connected but aren't offered as routing targets.</p>
          <div class="flex flex-wrap gap-1.5">
            @for (m of mcpConnections(); track m.provider) {
              <button type="button"
                      class="mcp-pill"
                      [class.is-on]="isMcpEnabled(m.provider)"
                      [style.--brand]="m.color"
                      (click)="togglePromptMcp(m.provider)"
                      [attr.aria-pressed]="isMcpEnabled(m.provider)"
                      [title]="m.desc">
                <svg class="mcp-logo" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
                  <text x="7" y="9.6" text-anchor="middle" font-size="7" font-weight="700"
                        fill="#060610" font-family="system-ui, sans-serif">{{ providerMonogram(m.provider) }}</text>
                </svg>
                <span class="mcp-pill-label">{{ m.label }}</span>
                @if (isMcpEnabled(m.provider)) {
                  <span class="mcp-check" aria-hidden="true">✓</span>
                }
              </button>
            }
            @if (mcpConnections().length === 0) {
              <a routerLink="/admin/settings" fragment="mcp" class="text-[0.7rem] text-primary underline">+ Connect MCPs in Settings → MCP</a>
            }
          </div>
        </div>

        <p class="text-[0.7rem] text-text-secondary mt-3 mb-0">
          Fallback reply email is controlled in
          <a routerLink="/admin/settings" fragment="general" class="text-primary hover:underline">Settings → General</a>.
        </p>

        <div class="flex items-center gap-2 mt-3">
          <button type="button"
                  class="btn-improve"
                  (click)="improvePrompt()"
                  [disabled]="improving()"
                  [title]="improveButtonTitle()">
            {{ improving() ? '…' : improveButtonLabel() }}
          </button>
          <button class="btn-primary" [disabled]="saving()" (click)="save()" title="Save prompt + MCP selection">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </div>
      </section>

      <!-- Submissions table -->
      <section class="card p-0 overflow-hidden">
        <div class="flex items-center justify-between p-4 flex-wrap gap-2">
          <h3 class="m-0 text-base font-semibold text-white">Submissions</h3>
          <div class="flex items-center gap-2">
            <div class="filter-chips" role="tablist" aria-label="Saved views">
              @for (v of views; track v.id) {
                <button class="filter-chip" [class.active]="activeView() === v.id" (click)="setView(v.id)" role="tab">{{ v.label }} <span class="filter-count">{{ countView(v.id) }}</span></button>
              }
            </div>
            <span class="text-[0.7rem] text-text-secondary">{{ filteredSubmissions().length }} / {{ submissions().length }}</span>
          </div>
        </div>
        @if (loading() && submissions().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (submissions().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">
            No submissions yet. Drop the snippet on your site (see <a routerLink="/admin/ai-endpoints" class="text-primary underline">AI Endpoints</a> for app.js install).
          </div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-3 font-semibold">When</th>
                <th class="text-left p-3 font-semibold">Form</th>
                <th class="text-left p-3 font-semibold">Email</th>
                <th class="text-left p-3 font-semibold">Origin</th>
                <th class="text-right p-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              @for (s of filteredSubmissions(); track s.id) {
                <tr class="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors"
                    (click)="open(s)">
                  <td class="p-3 text-text-secondary">{{ s.created_at | date:'short' }}</td>
                  <td class="p-3 font-mono text-[0.72rem]">{{ s.form_name }}</td>
                  <td class="p-3">{{ s.email || '—' }}</td>
                  <td class="p-3 text-text-secondary/70 truncate max-w-[240px]" [title]="s.origin_url">{{ s.origin_url || '—' }}</td>
                  <td class="p-3 text-right text-primary text-[0.7rem] font-semibold">Open ›</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (selected(); as s) {
        <section class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">{{ s.form_name }} · {{ s.created_at | date:'medium' }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="selected.set(null)" aria-label="Close form submission detail">×</button>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <h4 class="muted-h">Fields</h4>
              <pre class="bg-black/30 border border-white/5 rounded-lg p-3 text-[0.7rem] overflow-auto max-h-72">{{ s.fields | json }}</pre>
            </div>
            <div>
              <h4 class="muted-h">AI Trace</h4>
              @if (logs().length === 0) {
                <p class="text-text-secondary/70 italic text-[0.78rem]">No AI trace yet — the router may still be running or credits exhausted.</p>
              } @else {
                @for (l of logs(); track l.id) {
                  <div class="bg-black/30 border border-white/5 rounded-lg p-3 mb-2 text-[0.7rem]">
                    <div class="flex justify-between text-[0.6rem] mb-1">
                      <span class="font-mono opacity-70">{{ l.model }}</span>
                      <span class="font-bold uppercase" [class.text-emerald-400]="l.status === 'ok'" [class.text-red-400]="l.status === 'error'">{{ l.status }} · {{ l.latency_ms }}ms</span>
                    </div>
                    @if (l.tool_name) {
                      <div class="text-primary font-mono mb-1">{{ l.tool_name }} · {{ l.tool_status }}</div>
                    }
                    @if (l.error_message) {
                      <div class="text-red-300">{{ l.error_message }}</div>
                    } @else {
                      <pre class="whitespace-pre-wrap break-words">{{ l.output_text }}</pre>
                    }
                  </div>
                }
              }
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.5); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: #00E5FF; color: #060610; font-weight: 600; border: 0; cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { padding: 0.4rem 0.9rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
    .btn-improve { font-size: 0.66rem; line-height: 1; padding: 0.25rem 0.625rem; border-radius: 7px; background: rgba(124,58,237,0.14); border: 1px solid rgba(124,58,237,0.4); color: #c4b5fd; font-weight: 600; cursor: pointer; transition: all 140ms ease; }
    .btn-improve:hover:not(:disabled) { background: rgba(124,58,237,0.22); color: #ddd6fe; }
    .btn-improve:disabled { opacity: 0.5; cursor: not-allowed; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin: 0 0 0.4rem; }
    .filter-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
    .filter-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 150ms ease; }
    .filter-chip:hover { color: #fff; border-color: rgba(0,229,255,0.3); }
    .filter-chip.active { background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18)); color: #00E5FF; border-color: rgba(0,229,255,0.4); }
    .filter-count { font-size: 0.6rem; opacity: 0.7; padding: 1px 5px; border-radius: 999px; background: rgba(255,255,255,0.06); }
    .mcp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1); font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .mcp-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.55); font-size: 0.66rem; font-weight: 600; cursor: pointer; transition: all 160ms ease; --brand: #94a3b8; }
    .mcp-pill:hover { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.85); }
    .mcp-pill.is-on { background: color-mix(in oklch, var(--brand) 18%, transparent); border-color: color-mix(in oklch, var(--brand) 55%, transparent); color: var(--brand); }
    .mcp-pill .mcp-logo { flex-shrink: 0; }
    .mcp-pill.is-on .mcp-logo { color: var(--brand); }
    .mcp-pill:not(.is-on) .mcp-logo { color: rgba(255,255,255,0.55); }
    .mcp-pill-label { line-height: 1; }
    .mcp-check { font-weight: 800; font-size: 0.72rem; line-height: 1; color: var(--brand); }
    .live-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.22); color: #6ee7b7; font-size: 0.66rem; font-weight: 600; letter-spacing: 0.02em; }
    .live-dot { width: 6px; height: 6px; border-radius: 999px; background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.6); animation: livePulse 1.6s ease-in-out infinite; }
    .live-dot.is-paused { animation: none; background: #6b7280; box-shadow: none; }
    @keyframes livePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  `],
})
export class AdminFormsComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  submissions = signal<Submission[]>([]);
  loading = signal(false);
  views = [
    { id: 'all', label: 'All', test: (_s: Submission) => true },
    { id: 'today', label: 'Today', test: (s: Submission) => sameDay(new Date(s.created_at), new Date()) },
    { id: 'newsletter', label: 'Newsletter', test: (s: Submission) => /newsletter|subscribe/i.test(s.form_name) },
    { id: 'contact', label: 'Contact', test: (s: Submission) => /contact|message|hello/i.test(s.form_name) },
    { id: 'with-email', label: 'With email', test: (s: Submission) => !!s.email },
    { id: 'errors', label: 'Errors', test: (s: Submission) => s.status !== 'received' },
  ] as const;
  activeView = signal<(typeof this.views)[number]['id']>(((): (typeof this.views)[number]['id'] => {
    try {
      return (localStorage.getItem('ps_forms_view') as (typeof this.views)[number]['id']) || 'all';
    } catch {
      return 'all';
    }
  })());
  filteredSubmissions = computed(() => {
    const v = this.views.find((x) => x.id === this.activeView()) ?? this.views[0]!;
    return this.submissions().filter((s) => v.test(s));
  });

  testing = signal(false);
  testOpen = signal(false);
  improving = signal(false);

  // Per-prompt MCP allow-list — drives the pill row + is sent to the backend
  // so the router only offers checked MCPs as routing targets.
  promptMcps = signal<string[]>(((): string[] => {
    try {
      return JSON.parse(localStorage.getItem('ps_form_prompt_mcps') ?? '[]') as string[];
    } catch {
      return [];
    }
  })());

  mcpConnections = signal<McpPill[]>([]);
  testInput: { form_name: string; email: string; fields_json: string } = {
    form_name: 'newsletter',
    email: 'test@example.com',
    fields_json: '{ "message": "Hi — please add me to your list." }',
  };
  testResult = signal<unknown | null>(null);
  selected = signal<Submission | null>(null);
  logs = signal<AiLog[]>([]);
  saving = signal(false);
  settings: Settings = { form_router_prompt: '', form_router_prompt_default: '', reply_email: '' };

  // ── Auto-polling state ────────────────────────────────────
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  lastSyncAt = signal<number | null>(null);
  polling = signal(true);
  private tickSignal = signal(0); // bumped each second for the "Xs ago" label

  /**
   * Format the live-sync "Xs ago" label.
   * @example syncAgoLabel() // → "2s ago" or "just now"
   */
  syncAgoLabel = computed(() => {
    this.tickSignal();
    const at = this.lastSyncAt();
    if (!at) return '…';
    const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (secs < 2) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const m = Math.floor(secs / 60);
    return `${m}m ago`;
  });

  livePillTooltip = computed(() => {
    if (!this.polling()) return 'Auto-refresh paused — tab is in background';
    return `Auto-refreshing every ${POLL_INTERVAL_MS / 1000}s while this tab is visible`;
  });

  improveButtonLabel = computed(() =>
    (this.settings.form_router_prompt ?? '').trim().length === 0
      ? 'Load an example routing prompt'
      : 'Improve prompt',
  );

  improveButtonTitle = computed(() =>
    (this.settings.form_router_prompt ?? '').trim().length === 0
      ? 'Insert a ready-to-edit example prompt (no AI credits used)'
      : 'Tighten + clarify the current prompt via AI',
  );

  /**
   * Lifecycle: kick off initial load + auto-poll loop.
   */
  ngOnInit(): void {
    this.reload();
    this.loadSettings();
    this.loadMcp();
    this.startPolling();
    this.visibilityHandler = (): void => this.handleVisibility();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * Lifecycle: clear timers + listeners to avoid leaks.
   */
  ngOnDestroy(): void {
    this.stopPolling();
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.polling.set(true);
    this.pollTimer = setInterval(() => {
      this.tickSignal.update((n) => n + 1);
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        // visibility handler will pause us; defensive guard if event hasn't fired
        return;
      }
      // Re-fetch on every Nth tick — keep tick at 1s so the "Xs ago" label
      // updates smoothly, but only hit the API every POLL_INTERVAL_MS / 1000.
      const at = this.lastSyncAt() ?? 0;
      if (Date.now() - at >= POLL_INTERVAL_MS) this.reload({ silent: true });
    }, 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.polling.set(false);
  }

  private handleVisibility(): void {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      this.startPolling();
      this.reload({ silent: true });
    } else {
      this.stopPolling();
    }
  }

  setView(id: (typeof this.views)[number]['id']): void {
    this.activeView.set(id);
    try {
      localStorage.setItem('ps_forms_view', id);
    } catch {
      /* persistence is best-effort */
    }
  }

  countView(id: (typeof this.views)[number]['id']): number {
    const v = this.views.find((x) => x.id === id) ?? this.views[0]!;
    return this.submissions().filter((s) => v.test(s)).length;
  }

  toggleTest(): void {
    this.testOpen.update((v) => !v);
  }

  /**
   * Return true when an MCP provider is currently enabled for the router.
   * @example isMcpEnabled('stripe') // → true|false
   */
  isMcpEnabled(provider: string): boolean {
    return this.promptMcps().includes(provider);
  }

  /**
   * Toggle an MCP on/off + persist locally + push to the backend config.
   * @param provider - the MCP provider id (e.g. "stripe", "resend").
   */
  togglePromptMcp(provider: string): void {
    const cur = this.promptMcps();
    const next = cur.includes(provider) ? cur.filter((p) => p !== provider) : [...cur, provider];
    this.promptMcps.set(next);
    try {
      localStorage.setItem('ps_form_prompt_mcps', JSON.stringify(next));
    } catch {
      /* persistence is best-effort */
    }
    // Push to backend immediately so the live router picks up the change.
    const site = this.state.selectedSite();
    if (!site) return;
    this.api
      .put(`/sites/${site.id}/ai-settings`, { enabled_mcps: next })
      .subscribe({
        next: () => {
          /* silent — UI already reflects the change */
        },
        error: () => this.toast.error('Failed to save MCP selection'),
      });
  }

  /**
   * Single-letter monogram used inside the inline SVG logo. Stable, no
   * external image refs.
   * @example providerMonogram('mailchimp') // → "M"
   */
  providerMonogram(provider: string): string {
    const meta = mcpMeta(provider);
    return (meta?.label ?? provider).charAt(0).toUpperCase();
  }

  loadMcp(): void {
    const s = this.state.selectedSite();
    if (!s) return;
    this.api
      .get<{ data: { connections: { provider: string; status: string }[] } }>(
        `/sites/${s.id}/mcp/connections`,
      )
      .subscribe({
        next: (r) => {
          const list = (r.data?.connections ?? [])
            .filter((c) => c.status === 'active')
            .map<McpPill>((c) => {
              const meta = mcpMeta(c.provider);
              return {
                provider: c.provider,
                label: meta?.label ?? c.provider,
                color: meta?.color ?? '#94a3b8',
                desc:
                  meta?.desc ?? `${meta?.label ?? c.provider} — integration available.`,
              };
            });
          this.mcpConnections.set(list);
        },
        error: () => this.mcpConnections.set([]),
      });
  }

  /**
   * Improve OR seed the current prompt. The backend decides which mode based
   * on whether `value` is empty.
   *
   * @example
   * // textarea empty → loads seed template, toast "Loaded example prompt"
   * // textarea has content → AI rewrite, toast "Improved with AI"
   */
  improvePrompt(): void {
    const site = this.state.selectedSite();
    if (!site) {
      this.toast.error('Select a site first');
      return;
    }
    const value = (this.settings.form_router_prompt ?? '').trim();
    this.improving.set(true);
    this.api
      .post<{ data: { mode: 'seed' | 'improved'; text: string } }>(
        `/sites/${site.id}/form-router/improve`,
        { value },
      )
      .subscribe({
        next: (r) => {
          this.improving.set(false);
          const text = r.data?.text?.trim();
          if (!text || text.length < 40) {
            this.toast.error('No usable prompt returned — try again');
            return;
          }
          this.settings.form_router_prompt = text;
          if (r.data?.mode === 'seed') {
            this.toast.success('Loaded example prompt — edit + save');
          } else {
            this.toast.success('Improved with AI — review + save');
          }
        },
        error: () => {
          this.improving.set(false);
          this.toast.error('AI improve failed — try again');
        },
      });
  }

  /**
   * Reload the submissions list.
   * @param opts.silent - when true, suppress the loading spinner + error toast
   *   (used by the auto-poll timer so the UI doesn't flicker every 10s).
   */
  reload(opts: { silent?: boolean } = {}): void {
    const site = this.state.selectedSite();
    if (!site) return;
    if (!opts.silent) this.loading.set(true);
    this.api.get<{ data: Submission[] }>(`/sites/${site.id}/form-submissions`).subscribe({
      next: (r) => {
        this.submissions.set(r.data ?? []);
        this.loading.set(false);
        this.lastSyncAt.set(Date.now());
      },
      error: () => {
        this.loading.set(false);
        if (!opts.silent) this.toast.error('Failed to load submissions');
      },
    });
  }

  open(s: Submission): void {
    this.selected.set(s);
    const site = this.state.selectedSite();
    if (!site) return;
    this.api
      .get<{ data: { ai_logs: AiLog[] } }>(`/sites/${site.id}/form-submissions/${s.id}`)
      .subscribe({
        next: (r) => this.logs.set(r.data?.ai_logs ?? []),
        error: () => this.logs.set([]),
      });
  }

  loadSettings(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.get<{ data: Settings }>(`/sites/${site.id}/ai-settings`).subscribe({
      next: (r) => {
        this.settings = {
          form_router_prompt: r.data?.form_router_prompt ?? '',
          form_router_prompt_default: r.data?.form_router_prompt_default ?? '',
          reply_email: r.data?.reply_email ?? '',
        };
      },
    });
  }

  save(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.saving.set(true);
    this.api
      .put(`/sites/${site.id}/ai-settings`, {
        form_router_prompt: this.settings.form_router_prompt,
        enabled_mcps: this.promptMcps(),
      })
      .subscribe({
        next: () => {
          this.toast.success('Saved');
          this.saving.set(false);
          this.loadSettings();
        },
        error: () => {
          this.toast.error('Save failed');
          this.saving.set(false);
        },
      });
  }

  testRouter(): void {
    this.testOpen.set(true);
  }

  runTest(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    let fields: Record<string, unknown> = {};
    try {
      fields = JSON.parse(this.testInput.fields_json || '{}') as Record<string, unknown>;
    } catch {
      this.toast.error('Fields must be valid JSON');
      return;
    }
    this.testing.set(true);
    this.testResult.set(null);
    // Reuse the public form-submit endpoint — the worker runs the router prompt
    // and writes an ai_form_logs row we then poll back for the structured trace.
    this.api
      .post<{ data?: { submission_id?: string } }>(`/v1/forms/submit`, {
        form_name: this.testInput.form_name,
        email: this.testInput.email,
        fields,
        origin_url: 'admin://test',
      })
      .subscribe({
        next: (res) => {
          const subId = res?.data?.submission_id;
          if (!subId) {
            this.testResult.set({ note: 'Submitted — open AI Logs to see the trace.' });
            this.testing.set(false);
            return;
          }
          // Poll once the AI trace exists (router runs async via waitUntil).
          let tries = 0;
          const poll = (): void => {
            this.api
              .get<{ data: { ai_logs: unknown[] } }>(
                `/sites/${site.id}/form-submissions/${subId}`,
              )
              .subscribe({
                next: (d) => {
                  const logs = d.data?.ai_logs ?? [];
                  if (logs.length || tries++ > 12) {
                    this.testResult.set(logs[0] ?? { note: 'No trace returned in time — check AI Logs.' });
                    this.testing.set(false);
                  } else {
                    setTimeout(poll, 750);
                  }
                },
                error: () => {
                  this.testing.set(false);
                  this.toast.error('Failed to fetch trace');
                },
              });
          };
          setTimeout(poll, 700);
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.testing.set(false);
          this.toast.error(err?.error?.error?.message || 'Test failed');
        },
      });
  }
}
