/**
 * Cmd-K command palette — Linear / Raycast-grade global launcher for the admin.
 *
 * @remarks
 * Provides ranked fuzzy search, sectioned results, keyboard navigation, recents
 * + pinned persistence, inline calculator + colour converter, live docs/site
 * search, and a self-aware "Ask AI" fallback when no built-in action matches.
 *
 * Action definitions live in {@link CommandPaletteActionsService} — this file
 * owns ONLY UI, scoring, keyboard handling, and ephemeral state.
 *
 * @example
 * ```html
 * <app-command-palette #palette></app-command-palette>
 * ```
 * Then press Cmd/Ctrl + K to open.
 */
import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  ViewChild,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from './admin-state.service';
import { ToastService } from '../../services/toast.service';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  CommandPaletteActionsService,
  type PaletteAction,
  type AiSearchHit,
} from './command-palette-actions.service';

const RECENT_KEY = 'ps_palette_recent';
const PINNED_KEY = 'ps_palette_pinned';
const LAST_CMD_KEY = 'ps_palette_last_cmd';
const RECENT_LIMIT = 10;

interface ScoredAction extends PaletteAction {
  /** Fuzzy score (higher is better). */
  _score: number;
  /** HTML title with <mark>…</mark> around matched characters. */
  _renderedTitle: string;
}

interface DocsEndpoint {
  method: string;
  path: string;
  summary?: string;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="cp-overlay" (click)="close()" tabindex="-1">
        <div
          class="cp-panel"
          role="dialog"
          aria-label="Command palette"
          aria-modal="true"
          (click)="$event.stopPropagation()"
        >
          <header class="cp-head">
            <svg class="cp-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              #cpInput
              data-testid="palette-input"
              type="text"
              class="cp-input"
              placeholder="Type a command, page, or '= 2+2' · ⌘K to toggle · Esc to close"
              [ngModel]="query()"
              (ngModelChange)="onQueryInput($event)"
              (keydown)="onKey($event)"
              autocomplete="off"
              spellcheck="false"
              aria-autocomplete="list"
              aria-controls="cp-results"
            />
            <kbd class="cp-kbd">esc</kbd>
          </header>

          @if (specialResult() !== null) {
            <div class="cp-special" data-testid="palette-special">
              <span class="cp-special-label">{{ specialResult()!.label }}</span>
              <span class="cp-special-value">{{ specialResult()!.value }}</span>
              <button type="button" class="cp-special-btn" (click)="copySpecial()">Copy</button>
            </div>
          }

          <div class="cp-body" #cpBody data-testid="palette-results" id="cp-results" role="listbox">
            @if (groups().length === 0 && !specialResult()) {
              <div class="cp-empty">
                <p>No matches for "{{ query() }}"</p>
                @if (query().trim().length >= 2) {
                  <button
                    type="button"
                    class="cp-ask-ai"
                    data-testid="palette-action-ask-ai"
                    [disabled]="aiSearchLoading()"
                    (click)="askAi()"
                  >
                    {{ aiSearchLoading() ? 'Searching with AI…' : 'Ask AI to "' + query() + '" →' }}
                  </button>
                }
                @if (aiSearchHits().length > 0) {
                  <div class="cp-group-label" data-testid="palette-ai-results-label">AI search results</div>
                  @for (hit of aiSearchHits(); track hit.raw['id']) {
                    <button
                      type="button"
                      class="cp-row"
                      role="option"
                      [attr.data-testid]="'palette-ai-hit-' + hit.entity"
                      (click)="openAiHit(hit)">
                      <span class="cp-icon" aria-hidden="true">✨</span>
                      <span class="cp-title-wrap">
                        <span class="cp-title">{{ hit.title }}</span>
                        @if (hit.description) { <span class="cp-desc">{{ hit.description }}</span> }
                      </span>
                      <span class="cp-hint"><kbd class="cp-kbd">{{ hit.entity }}</kbd></span>
                    </button>
                  }
                }
              </div>
            }
            @for (g of groups(); track g.label) {
              <div class="cp-group-label">{{ g.label }}</div>
              @for (cmd of g.items; track cmd.id; let i = $index) {
                <button
                  type="button"
                  class="cp-row"
                  role="option"
                  [attr.data-testid]="'palette-action-' + cmd.id"
                  [class.active]="globalIndexOf(cmd.id) === activeIndex()"
                  [attr.aria-selected]="globalIndexOf(cmd.id) === activeIndex()"
                  (mouseenter)="activeIndex.set(globalIndexOf(cmd.id))"
                  (click)="runCmd(cmd, $event)"
                  (keydown.arrowright)="togglePin(cmd, $event)"
                >
                  <span class="cp-icon" [innerHTML]="cmd.icon || defaultIcon"></span>
                  <span class="cp-title-wrap">
                    <span class="cp-title" [innerHTML]="cmd._renderedTitle"></span>
                    @if (cmd.description) {
                      <span class="cp-desc">{{ cmd.description }}</span>
                    }
                  </span>
                  @if (isPinned(cmd.id)) {
                    <span class="cp-pin" title="Pinned">★</span>
                  }
                  @if (cmd.shortcut) {
                    <span class="cp-hint">
                      @for (k of cmd.shortcut.split(' '); track k) {
                        <kbd class="cp-kbd">{{ k }}</kbd>
                      }
                    </span>
                  }
                </button>
              }
            }
            @for (d of docsResults(); track d.path) {
              <button type="button" class="cp-row cp-row-doc" (click)="openDoc(d)">
                <span class="cp-icon" [innerHTML]="defaultIcon"></span>
                <span class="cp-title-wrap">
                  <span class="cp-title">{{ d.method }} {{ d.path }}</span>
                  @if (d.summary) { <span class="cp-desc">{{ d.summary }}</span> }
                </span>
                <span class="cp-hint"><kbd class="cp-kbd">docs</kbd></span>
              </button>
            }
          </div>

          @if (aiPaneVisible()) {
            <section
              class="cmdk-ai-pane"
              data-testid="cmdk-ai-pane"
              aria-label="Inline AI answer"
            >
              <div class="cmdk-ai-echo">
                <span class="cmdk-ai-echo-label">Ask AI</span>
                <span class="cmdk-ai-echo-q">{{ aiEchoQuery() }}</span>
              </div>
              @if (aiStreaming() && !aiText()) {
                <div class="cmdk-ai-thinking">
                  <span class="cmdk-ai-spinner" aria-hidden="true"></span>
                  <span>Thinking…</span>
                </div>
              }
              <div
                class="ai-streaming-text"
                role="status"
                aria-live="polite"
                aria-atomic="false"
              >
                @if (aiStreaming()) {
                  <pre class="cmdk-ai-raw">{{ aiText() }}</pre>
                } @else if (aiText()) {
                  <div class="cmdk-ai-rendered" [innerHTML]="aiHtml()"></div>
                }
                @if (aiError()) {
                  <p class="cmdk-ai-error">{{ aiError() }}</p>
                }
              </div>
              <div class="cmdk-ai-actions">
                <button
                  type="button"
                  class="cmdk-ai-chip"
                  data-testid="cmdk-ai-copy"
                  [disabled]="!aiText()"
                  (click)="copyAiAnswer()"
                >Copy answer</button>
                <button
                  type="button"
                  class="cmdk-ai-chip"
                  data-testid="cmdk-ai-open-chat"
                  (click)="openFullChat()"
                >Open full chat</button>
                <button
                  type="button"
                  class="cmdk-ai-chip"
                  data-testid="cmdk-ai-ask-again"
                  (click)="resetAiPane()"
                >Ask again</button>
              </div>
            </section>
          }

          <footer class="cp-foot">
            <span class="cp-foot-grp"><kbd class="cp-kbd">↑↓</kbd> navigate</span>
            <span class="cp-foot-grp"><kbd class="cp-kbd">↵</kbd> run</span>
            <span class="cp-foot-grp"><kbd class="cp-kbd">⌘↵</kbd> new tab</span>
            <span class="cp-foot-grp"><kbd class="cp-kbd">→</kbd> pin</span>
            <span class="cp-foot-grp"><kbd class="cp-kbd">⌘1-9</kbd> jump</span>
            <span class="cp-foot-grp ml-auto">{{ flatVisible().length }} results</span>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .cp-overlay {
      position: fixed; inset: 0;
      background: rgba(2, 2, 12, 0.62);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      z-index: 9000;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      animation: cpIn 140ms ease-out;
    }
    @keyframes cpIn { from { opacity: 0 } to { opacity: 1 } }
    .cp-panel {
      width: min(640px, 92vw);
      max-height: 70vh;
      background: linear-gradient(180deg, rgba(20,20,42,0.96), rgba(10,10,28,0.96));
      border: 1px solid rgba(0,229,255,0.22);
      border-radius: 10px;
      box-shadow: 0 30px 80px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,229,255,0.06);
      display: flex; flex-direction: column;
      overflow: hidden;
      animation: cpRise 180ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes cpRise { from { transform: translateY(-12px) scale(0.97); opacity: 0; } to { transform: none; opacity: 1; } }
    .cp-head { display: flex; align-items: center; gap: 10px; padding: 18px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); color: #94a3b8; }
    .cp-search-icon { flex: 0 0 auto; opacity: 0.7; }
    .cp-input { flex: 1; background: transparent; border: 0; outline: none; color: #f0f0f8; font-size: 0.96rem; font-family: inherit; padding: 0; }
    .cp-input::placeholder { color: rgba(255,255,255,0.32); }
    .cp-special { display: flex; align-items: center; gap: 10px; padding: 10px 18px; background: rgba(0,229,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.82rem; color: #e2e8f0; }
    .cp-special-label { color: rgba(255,255,255,0.55); }
    .cp-special-value { font-family: ui-monospace, monospace; color: #00E5FF; flex: 1; }
    .cp-special-btn { background: transparent; border: 1px solid rgba(255,255,255,0.14); color: #e2e8f0; padding: 3px 10px; border-radius: 5px; cursor: pointer; font-size: 0.72rem; font-family: inherit; }
    .cp-special-btn:hover { background: rgba(0,229,255,0.12); }
    .cp-body { overflow-y: auto; padding: 6px; flex: 1; scroll-behavior: smooth; }
    .cp-empty { padding: 28px 16px; text-align: center; color: rgba(255,255,255,0.55); font-size: 0.85rem; display: flex; flex-direction: column; gap: 10px; align-items: center; }
    .cp-ask-ai { background: linear-gradient(90deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18)); border: 1px solid rgba(0,229,255,0.32); color: #fff; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 0.82rem; }
    .cp-group-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.09em; font-weight: 700; color: rgba(255,255,255,0.4); padding: 12px 10px 6px; }
    .cp-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; background: transparent; border: 0; cursor: pointer; text-align: left; color: #e2e8f0; border-radius: 6px; transition: background 100ms ease, color 100ms ease; font-size: 0.86rem; font-family: inherit; }
    .cp-row.active { background: linear-gradient(90deg, rgba(0,229,255,0.16), rgba(124,58,237,0.08)); color: #fff; }
    .cp-row.active .cp-icon { color: #00E5FF; }
    .cp-icon { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: rgba(255,255,255,0.04); color: #a5b4fc; flex: 0 0 auto; }
    .cp-title-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .cp-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp-title mark { background: transparent; color: #00E5FF; font-weight: 600; padding: 0; }
    .cp-desc { font-size: 0.7rem; color: rgba(255,255,255,0.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp-pin { color: #FACC15; font-size: 0.78rem; }
    .cp-hint { display: inline-flex; gap: 3px; font-size: 0.7rem; color: rgba(255,255,255,0.45); }
    .cp-foot { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-top: 1px solid rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); font-size: 0.68rem; flex-wrap: wrap; }
    .cp-foot-grp { display: inline-flex; align-items: center; gap: 4px; }
    .ml-auto { margin-left: auto; }
    .cp-kbd { display: inline-flex; align-items: center; justify-content: center; padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); font-size: 0.65rem; font-family: ui-monospace, monospace; min-width: 16px; }
    /* Inline AI streaming pane — keeps palette open while tokens arrive. */
    .cmdk-ai-pane {
      border-top: 1px solid rgba(0,229,255,0.18);
      padding: 12px 16px 14px;
      background: linear-gradient(180deg, rgba(0,229,255,0.04), rgba(124,58,237,0.06));
      display: flex; flex-direction: column; gap: 8px;
      max-height: 38vh; overflow-y: auto;
      animation: cpRise 160ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .cmdk-ai-echo { display: flex; align-items: baseline; gap: 8px; font-size: 0.72rem; }
    .cmdk-ai-echo-label { color: #00E5FF; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
    .cmdk-ai-echo-q { color: rgba(255,255,255,0.78); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmdk-ai-thinking { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.72); font-size: 0.82rem; }
    .cmdk-ai-spinner {
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid rgba(0,229,255,0.25); border-top-color: #00E5FF;
      animation: cmdkSpin 720ms linear infinite;
    }
    @keyframes cmdkSpin { to { transform: rotate(360deg); } }
    .ai-streaming-text { color: #e2e8f0; font-size: 0.86rem; line-height: 1.5; min-height: 1em; }
    .cmdk-ai-raw { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; }
    .cmdk-ai-rendered { font-size: 0.86rem; line-height: 1.55; }
    .cmdk-ai-rendered :is(h1,h2,h3) { font-size: 0.95rem; margin: 8px 0 4px; color: #fff; }
    .cmdk-ai-rendered p { margin: 0 0 6px; }
    .cmdk-ai-rendered ul, .cmdk-ai-rendered ol { margin: 0 0 6px; padding-left: 20px; }
    .cmdk-ai-rendered code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-size: 0.78rem; font-family: ui-monospace, monospace; }
    .cmdk-ai-rendered pre { background: rgba(0,0,0,0.36); padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 0.78rem; }
    .cmdk-ai-rendered a { color: #00E5FF; text-decoration: underline; }
    .cmdk-ai-error { margin: 4px 0 0; color: #fda4af; font-size: 0.78rem; }
    .cmdk-ai-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .cmdk-ai-chip {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(0,229,255,0.22);
      color: #e2e8f0;
      padding: 4px 10px; border-radius: 999px;
      font-size: 0.72rem; font-family: inherit; cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .cmdk-ai-chip:hover:not(:disabled) { background: rgba(0,229,255,0.14); border-color: #00E5FF; color: #fff; }
    .cmdk-ai-chip:disabled { opacity: 0.45; cursor: not-allowed; }
    @media (prefers-reduced-motion: reduce) {
      .cp-overlay, .cp-panel, .cmdk-ai-pane { animation: none; }
      .cmdk-ai-spinner { animation: none; border-top-color: #00E5FF; }
      .cp-body { scroll-behavior: auto; }
    }
  `],
})
export class CommandPaletteComponent implements OnInit, OnDestroy, AfterViewInit {
  private router = inject(Router);
  private toast = inject(ToastService);
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private registry = inject(CommandPaletteActionsService);
  state = inject(AdminStateService);

  @ViewChild('cpInput') private inputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('cpBody') private bodyRef?: ElementRef<HTMLDivElement>;

  open = signal(false);
  /**
   * Query input as a signal so `groups()` / `specialResult()` recompute on
   * every keystroke. ngModel reads via `query()` and writes via
   * `onQueryInput()` — there is NO debounce on the local filter (<16ms).
   */
  query = signal('');
  activeIndex = signal(0);
  recent = signal<string[]>([]);
  pinned = signal<string[]>([]);
  docsResults = signal<DocsEndpoint[]>([]);
  /** AI-search hits to render in the empty-state result panel (#94). */
  aiSearchHits = signal<AiSearchHit[]>([]);
  /** True while `/api/admin/search/ai` is in flight. */
  aiSearchLoading = signal(false);
  /** Visible whenever an AI streaming request has started for this open session. */
  aiPaneVisible = signal(false);
  /** Echo of the user's query, displayed at the top of the AI pane. */
  aiEchoQuery = signal('');
  /** Accumulating streamed answer text (raw, pre-markdown-render). */
  aiText = signal('');
  /** True while tokens are still arriving from the worker. */
  aiStreaming = signal(false);
  /** Error message rendered inline if the stream collapses. */
  aiError = signal('');
  /** Markdown→HTML rendered once streaming completes. */
  aiHtml = computed(() => (this.aiStreaming() ? '' : this.renderMarkdownLite(this.aiText())));
  /** Aborts the in-flight stream on close / re-query. */
  private aiAbort: AbortController | null = null;
  /** Debounce handle for the zero-match → AI fallback. */
  private aiDebounce: ReturnType<typeof setTimeout> | null = null;
  private docsEndpoints: DocsEndpoint[] = [];
  private docsLoaded = false;

  /** Inline SVG used when an action does not provide its own icon. */
  defaultIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';

  ngOnInit(): void {
    document.addEventListener('keydown', this.hotkey, { capture: true });
    try {
      const r = localStorage.getItem(RECENT_KEY);
      if (r) this.recent.set(JSON.parse(r));
      const p = localStorage.getItem(PINNED_KEY);
      if (p) this.pinned.set(JSON.parse(p));
    } catch { /* ignore */ }
  }

  /**
   * Reactive auto-focus: every time `open()` flips to `true` the input is
   * focused + selected on the very next animation frame. The `@if (open())`
   * block in the template only renders the input AFTER the flip, so we wait
   * one rAF for the DOM to commit before grabbing the ref. This is the path
   * that satisfies the Cmd+K mandate ("blinking caret, zero extra clicks").
   */
  private focusEffect = effect(() => {
    if (!this.open()) return;
    requestAnimationFrame(() => {
      const el = this.inputRef?.nativeElement;
      if (el) { el.focus({ preventScroll: true }); el.select(); }
    });
  });

  ngAfterViewInit(): void {
    // No-op: focus is driven by the reactive `focusEffect` above. Declaring
    // the lifecycle hook lets us add post-render fallback logic later
    // without touching the open path.
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.hotkey, { capture: true } as EventListenerOptions);
    this.abortAiStream();
    if (this.aiDebounce) { clearTimeout(this.aiDebounce); this.aiDebounce = null; }
  }

  // ─── Hotkey + open/close ───────────────────────────────────────
  private hotkey = (ev: KeyboardEvent): void => {
    const k = ev.key.toLowerCase();
    if ((ev.metaKey || ev.ctrlKey) && k === 'k') {
      ev.preventDefault();
      this.toggle();
    } else if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && k === 'p') {
      ev.preventDefault();
      this.rerunLast();
    } else if (ev.key === 'Escape' && this.open()) {
      ev.preventDefault();
      this.close();
    } else if ((ev.metaKey || ev.ctrlKey) && k === ',' && !this.open()) {
      ev.preventDefault();
      this.router.navigateByUrl('/admin/settings');
    }
  };

  toggle(): void {
    if (this.open()) {
      // Re-focus + select existing query (toggle-friendly behaviour).
      requestAnimationFrame(() => {
        const el = this.inputRef?.nativeElement;
        if (el) { el.focus({ preventScroll: true }); el.select(); }
      });
    } else {
      this.openIt();
    }
  }

  openIt(): void {
    this.open.set(true);
    this.activeIndex.set(0);
    this.loadDocs();
    // Focus input on the SAME requestAnimationFrame tick — no setTimeout flash.
    requestAnimationFrame(() => {
      const el = this.inputRef?.nativeElement;
      if (el) { el.focus({ preventScroll: true }); el.select(); }
    });
  }

  close(): void {
    this.open.set(false);
    this.query.set('');
    this.abortAiStream();
    this.resetAiPane();
  }

  // ─── Keyboard ──────────────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  blockUnderlyingScroll(ev: KeyboardEvent): void {
    if (!this.open()) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
    }
  }

  onKey(ev: KeyboardEvent): void {
    if (!this.open()) return;
    const flat = this.flatVisible();
    const meta = ev.metaKey || ev.ctrlKey;
    const key = ev.key;

    if (key === 'ArrowDown') {
      ev.preventDefault();
      if (meta) { this.jumpSection(1); return; }
      this.activeIndex.update((i) => Math.min(i + 1, flat.length - 1));
      this.scrollActive();
    } else if (key === 'ArrowUp') {
      ev.preventDefault();
      if (meta) { this.jumpSection(-1); return; }
      this.activeIndex.update((i) => Math.max(i - 1, 0));
      this.scrollActive();
    } else if (key === 'Enter') {
      ev.preventDefault();
      const cmd = flat[this.activeIndex()];
      if (cmd) this.runCmd(cmd, ev);
    } else if (key === 'Tab') {
      ev.preventDefault();
      this.jumpSection(ev.shiftKey ? -1 : 1);
    } else if (meta && /^[1-9]$/.test(key)) {
      ev.preventDefault();
      const idx = parseInt(key, 10) - 1;
      const cmd = flat[idx];
      if (cmd) this.runCmd(cmd, ev);
    } else if (key === 'ArrowRight') {
      const cmd = flat[this.activeIndex()];
      if (cmd) { ev.preventDefault(); this.togglePin(cmd); }
    }
  }

  private jumpSection(dir: 1 | -1): void {
    const gs = this.groups();
    if (!gs.length) return;
    // Find current group from active index
    const active = this.activeIndex();
    let acc = 0; let curIdx = 0;
    for (let i = 0; i < gs.length; i++) {
      if (active < acc + gs[i].items.length) { curIdx = i; break; }
      acc += gs[i].items.length;
    }
    const next = (curIdx + dir + gs.length) % gs.length;
    let newIdx = 0;
    for (let i = 0; i < next; i++) newIdx += gs[i].items.length;
    this.activeIndex.set(newIdx);
    this.scrollActive();
  }

  private scrollActive(): void {
    requestAnimationFrame(() => {
      const el = this.bodyRef?.nativeElement.querySelector('.cp-row.active') as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ─── Search input ──────────────────────────────────────────────
  /**
   * Fires on every keystroke. Writes to the `query` signal synchronously so
   * `groups()` + `specialResult()` recompute in the same microtask — the
   * filtered list rerenders under one frame (<16ms) with zero debounce.
   * Only the docs HTTP search is debounce-friendly, but we keep it sync here
   * because it just hits a pre-loaded in-memory array (`docsEndpoints`).
   */
  onQueryInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
    this.runDocsSearch();
    this.scheduleAiIntent(value);
  }

  /**
   * Detect AI-intent and fire the streaming endpoint without closing the
   * palette. Two triggers:
   *   1. Explicit prefix (`ai:` / `ask ai:`) → fires immediately.
   *   2. Zero matches + query ≥ 10 chars → fires after a 400ms debounce so
   *      users still typing don't get a stream per keystroke.
   * A new keystroke always aborts the in-flight request first.
   */
  private scheduleAiIntent(raw: string): void {
    const trimmed = raw.trim();
    const prefixMatch = trimmed.match(/^(ai|ask ai)\s*:\s*(.*)$/i);
    if (prefixMatch) {
      const q = (prefixMatch[2] ?? '').trim();
      if (this.aiDebounce) { clearTimeout(this.aiDebounce); this.aiDebounce = null; }
      if (q.length >= 2) this.startAiStream(q);
      return;
    }
    if (this.aiDebounce) { clearTimeout(this.aiDebounce); this.aiDebounce = null; }
    // Abort any in-flight stream the moment the user keeps typing; only the
    // last debounced value matters.
    if (this.aiStreaming() && trimmed !== this.aiEchoQuery()) this.abortAiStream();
    if (trimmed.length < 10) return;
    this.aiDebounce = setTimeout(() => {
      this.aiDebounce = null;
      if (this.flatVisible().length === 0 && this.query().trim().length >= 10) {
        this.startAiStream(this.query().trim());
      }
    }, 400);
  }

  // ─── Special inline parsers (calculator, color) ────────────────
  specialResult = computed<{ label: string; value: string; raw: string } | null>(() => {
    const q = this.query().trim();
    if (!q) return null;
    // Calculator: `= 1+2` or just `=expr`
    if (q.startsWith('=')) {
      const expr = q.slice(1).trim();
      if (/^[\d+\-*/().\s%]*$/.test(expr) && expr.length > 0) {
        try {
          // Restricted eval — only arithmetic chars allowed by regex above.
          // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
          const value = Function(`"use strict"; return (${expr});`)() as number;
          if (Number.isFinite(value)) return { label: 'Result', value: String(value), raw: String(value) };
        } catch { /* fall through */ }
      }
    }
    // Color converter
    const hex = q.match(/^#?([0-9a-fA-F]{6})$/);
    if (hex) {
      const r = parseInt(hex[1].slice(0, 2), 16);
      const g = parseInt(hex[1].slice(2, 4), 16);
      const b = parseInt(hex[1].slice(4, 6), 16);
      const oklch = this.rgbToOklch(r, g, b);
      const value = `rgb(${r}, ${g}, ${b}) · ${oklch}`;
      return { label: '#' + hex[1].toUpperCase(), value, raw: '#' + hex[1].toUpperCase() };
    }
    return null;
  });

  copySpecial(): void {
    const s = this.specialResult();
    if (!s) return;
    navigator.clipboard.writeText(s.raw).then(
      () => this.toast.success('Copied'),
      () => this.toast.error('Copy failed'),
    );
  }

  private rgbToOklch(r: number, g: number, b: number): string {
    // Quick & dirty OKLCH approximation — sRGB → linear → OKLab → OKLCH.
    const lin = (c: number): number => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const R = lin(r), G = lin(g), B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const C = Math.sqrt(A * A + Bb * Bb);
    const H = (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360;
    return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
  }

  // ─── Build action list + scoring ───────────────────────────────
  private allActions = computed<PaletteAction[]>(() => {
    const site = this.state.selectedSite();
    return this.registry.build({
      go: (p: string) => this.router.navigateByUrl(p),
      openExt: (u: string) => window.open(u, '_blank', 'noopener,noreferrer'),
      copy: (t: string, label?: string) => {
        navigator.clipboard.writeText(t).then(
          () => this.toast.success(label ?? 'Copied'),
          () => this.toast.error('Copy failed'),
        );
      },
      slug: site?.slug,
      siteId: site?.id,
      sites: this.state.sites().map((s) => ({ id: s.id, slug: s.slug, business_name: s.business_name, status: s.status })),
      setTheme: (t) => this.setTheme(t),
      toggleSidebar: () => document.body.classList.toggle('sidebar-collapsed'),
      signOut: () => this.state.signOut(),
      createSnapshot: () => this.runSnapshot('create'),
      rollbackSnapshot: () => this.runSnapshot('rollback'),
      manualDeploy: () => this.runSnapshot('deploy'),
      resetSite: () => this.runSnapshot('reset'),
      toggleLivePolling: () => window.dispatchEvent(new CustomEvent('ps:toggle-live-polling')),
      aiImprove: () => this.runAi(),
      openAiChat: (pre?: string) => window.dispatchEvent(new CustomEvent('ps:open-ai-chat', { detail: { prefill: pre } })),
      openShortcuts: () => window.dispatchEvent(new CustomEvent('ps:open-shortcuts')),
      askAi: (q) => this.callAskAi(q),
    });
  });

  /** Section-filter parser: `>nav` limits to Navigation, etc. */
  private parseSectionFilter(): { section: string | null; cleanQuery: string } {
    const q = this.query().trim();
    if (q.startsWith('>')) {
      const m = q.match(/^>(\w+)\s*(.*)$/);
      if (m) {
        const map: Record<string, string> = {
          nav: 'Navigation', site: 'Sites', action: 'Actions',
          setting: 'Settings', settings: 'Settings', help: 'Help',
          integration: 'Integrations', ai: 'AI',
        };
        return { section: map[m[1].toLowerCase()] ?? null, cleanQuery: m[2] ?? '' };
      }
    }
    return { section: null, cleanQuery: q };
  }

  /** Audit/forms in-search prefixes (`audit:term`, `form:term`). */
  private parsePrefixSearch(): { kind: 'audit' | 'forms' | null; term: string } {
    const q = this.query().trim();
    const m = q.match(/^(audit|form):\s*(.*)$/i);
    if (m) return { kind: m[1].toLowerCase() === 'audit' ? 'audit' : 'forms', term: m[2] };
    return { kind: null, term: '' };
  }

  /** Fuzzy scorer — substring boost + consecutive char boost + all-words. */
  private score(needle: string, hay: string): number {
    if (!needle) return 1;
    const n = needle.toLowerCase();
    const h = hay.toLowerCase();
    if (h === n) return 100;
    const idx = h.indexOf(n);
    if (idx >= 0) return 80 - idx * 0.5 + (idx === 0 ? 10 : 0);
    // Subsequence match with bonus for consecutive hits
    let hi = 0, score = 0, consecutive = 0;
    for (let ni = 0; ni < n.length; ni++) {
      while (hi < h.length && h[hi] !== n[ni]) { hi++; consecutive = 0; }
      if (hi >= h.length) return 0;
      score += 1 + consecutive;
      consecutive++;
      hi++;
    }
    // All-words-present bonus
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => h.includes(w))) score += 15;
    return score;
  }

  private renderHighlight(title: string, needle: string): string {
    const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    if (!needle) return escape(title);
    const t = title, n = needle.toLowerCase(), lt = t.toLowerCase();
    const idx = lt.indexOf(n);
    if (idx >= 0) {
      return `${escape(t.slice(0, idx))}<mark>${escape(t.slice(idx, idx + n.length))}</mark>${escape(t.slice(idx + n.length))}`;
    }
    // Subsequence highlight
    let out = ''; let hi = 0;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (hi < n.length && ch.toLowerCase() === n[hi]) { out += `<mark>${escape(ch)}</mark>`; hi++; }
      else { out += escape(ch); }
    }
    return out;
  }

  /** Sectioned, ranked result list. */
  groups = computed<{ label: string; items: ScoredAction[] }[]>(() => {
    const { section, cleanQuery } = this.parseSectionFilter();
    const prefix = this.parsePrefixSearch();
    const q = prefix.kind ? prefix.term : cleanQuery;
    const all = this.allActions();

    const ranked: ScoredAction[] = all.map((a) => {
      const hay = [a.title, a.description ?? '', a.section, ...(a.keywords ?? [])].join(' ');
      const s = q ? this.score(q, hay) : 1;
      return { ...a, _score: s, _renderedTitle: this.renderHighlight(a.title, q) };
    }).filter((a) => a._score > 0);

    let filtered = section ? ranked.filter((a) => a.section === section) : ranked;
    if (prefix.kind === 'audit') filtered = filtered.filter((a) => a.section === 'Navigation' && a.id === 'nav-audit');
    if (prefix.kind === 'forms') filtered = filtered.filter((a) => a.section === 'Navigation' && a.id === 'nav-forms');

    filtered.sort((a, b) => b._score - a._score);

    // When query empty → show Pinned + Recent first, then default sections.
    const out: { label: string; items: ScoredAction[] }[] = [];
    const pinnedIds = this.pinned();
    const recentIds = this.recent();

    if (!q && !section && !prefix.kind) {
      const pinnedItems = pinnedIds.map((id) => filtered.find((a) => a.id === id)).filter(Boolean) as ScoredAction[];
      if (pinnedItems.length) out.push({ label: 'Pinned', items: pinnedItems });

      const recentItems = recentIds
        .filter((id) => !pinnedIds.includes(id))
        .map((id) => filtered.find((a) => a.id === id))
        .filter(Boolean)
        .slice(0, RECENT_LIMIT) as ScoredAction[];
      if (recentItems.length) out.push({ label: 'Recent', items: recentItems });
    }

    const seen = new Set<string>(out.flatMap((g) => g.items.map((i) => i.id)));
    const sectionOrder = ['Navigation', 'Sites', 'Actions', 'AI', 'Settings', 'Integrations', 'Help'];
    for (const sec of sectionOrder) {
      const items = filtered.filter((a) => a.section === sec && !seen.has(a.id));
      if (items.length) out.push({ label: sec, items: items.slice(0, q ? 20 : 50) });
    }
    return out;
  });

  flatVisible = computed<ScoredAction[]>(() => this.groups().flatMap((g) => g.items));

  globalIndexOf(id: string): number {
    const flat = this.flatVisible();
    for (let i = 0; i < flat.length; i++) if (flat[i].id === id) return i;
    return -1;
  }

  // ─── Run / pin / persist ───────────────────────────────────────
  runCmd(cmd: PaletteAction, ev?: KeyboardEvent | MouseEvent): void {
    // ⌘+Enter on navigation actions opens in a new tab
    const newTab = !!(ev && (ev as KeyboardEvent | MouseEvent).metaKey) || !!(ev && (ev as KeyboardEvent | MouseEvent).ctrlKey);
    this.pushRecent(cmd.id);
    try { localStorage.setItem(LAST_CMD_KEY, cmd.id); } catch { /* ignore */ }
    this.close();
    try {
      if (newTab && cmd.href) {
        window.open(cmd.href, '_blank', 'noopener,noreferrer');
      } else {
        const res = cmd.run();
        if (res && typeof (res as Promise<void>).then === 'function') {
          (res as Promise<void>).catch((e) => { this.toast.error('Action failed'); console.warn(e); });
        }
      }
    } catch (e) { this.toast.error('Action failed'); console.warn(e); }
  }

  private rerunLast(): void {
    try {
      const id = localStorage.getItem(LAST_CMD_KEY);
      if (!id) return;
      const cmd = this.allActions().find((a) => a.id === id);
      if (cmd) this.runCmd(cmd);
    } catch { /* ignore */ }
  }

  togglePin(cmd: PaletteAction, ev?: Event): void {
    ev?.preventDefault();
    const cur = this.pinned();
    const next = cur.includes(cmd.id) ? cur.filter((x) => x !== cmd.id) : [cmd.id, ...cur].slice(0, 8);
    this.pinned.set(next);
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  isPinned(id: string): boolean { return this.pinned().includes(id); }

  private pushRecent(id: string): void {
    const list = [id, ...this.recent().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
    this.recent.set(list);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }

  // ─── Theme ────────────────────────────────────────────────────
  private setTheme(t: 'dark' | 'light' | 'system'): void {
    try { localStorage.setItem('ps_theme', t); } catch { /* ignore */ }
    const root = document.documentElement;
    if (t === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset['theme'] = dark ? 'dark' : 'light';
    } else {
      root.dataset['theme'] = t;
    }
    this.toast.success(`Theme: ${t}`);
  }

  // ─── Snapshots / deploy / reset ───────────────────────────────
  private runSnapshot(kind: 'create' | 'rollback' | 'deploy' | 'reset'): void {
    const site = this.state.selectedSite();
    if (!site) { this.toast.error('No site selected'); return; }
    const path = kind === 'create' ? `/sites/${site.id}/snapshots`
      : kind === 'rollback' ? `/sites/${site.id}/snapshots`
      : kind === 'deploy' ? `/sites/${site.id}/deploy`
      : `/sites/${site.id}/reset`;
    this.api.post(path, {}).subscribe({
      next: () => this.toast.success(`${kind} ok`),
      error: () => {
        // Fallback to navigation when API not wired.
        if (kind === 'create' || kind === 'rollback') this.router.navigateByUrl('/admin/snapshots');
        else this.toast.error(`${kind} failed`);
      },
    });
  }

  private runAi(): void {
    const site = this.state.selectedSite();
    if (!site) { this.toast.error('No site selected'); return; }
    this.api.post(`/sites/improve-prompt`, { site_id: site.id }).subscribe({
      next: () => this.toast.success('AI improvement queued'),
      error: () => this.toast.error('AI request failed'),
    });
  }

  // ─── Docs live search ─────────────────────────────────────────
  private loadDocs(): void {
    if (this.docsLoaded) return;
    this.docsLoaded = true;
    this.api.get<{ paths?: Record<string, Record<string, { summary?: string }>> }>('/admin/docs/openapi.json').subscribe({
      next: (spec) => {
        const out: DocsEndpoint[] = [];
        for (const [p, methods] of Object.entries(spec.paths ?? {})) {
          for (const [m, info] of Object.entries(methods)) {
            out.push({ method: m.toUpperCase(), path: p, summary: info?.summary });
          }
        }
        this.docsEndpoints = out;
      },
      error: () => { /* docs unavailable — no-op */ },
    });
  }

  private runDocsSearch(): void {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2 || !this.docsEndpoints.length) { this.docsResults.set([]); return; }
    const matches = this.docsEndpoints
      .filter((d) => d.path.toLowerCase().includes(q) || (d.summary?.toLowerCase().includes(q) ?? false))
      .slice(0, 6);
    this.docsResults.set(matches);
  }

  openDoc(d: DocsEndpoint): void {
    this.router.navigateByUrl(`/admin/docs#${encodeURIComponent(d.method.toLowerCase() + ' ' + d.path)}`);
    this.close();
  }

  // ─── Ask-AI fallback ──────────────────────────────────────────
  /**
   * Empty-state fallback when no registered action matches the query.
   *
   * Tries `POST /api/admin/search/ai` first (item #94) and renders hits
   * inline. Falls back to the legacy "open chat with prefill" path when
   * the AI search returns no results.
   */
  askAi(): void {
    const q = this.query().trim();
    if (!q) return;
    this.aiSearchLoading.set(true);
    this.registry.askAiSearch(q).subscribe((hits) => {
      this.aiSearchLoading.set(false);
      this.aiSearchHits.set(hits);
      if (!hits.length) this.callAskAi(q);
    });
  }

  /** Navigate to the page that owns this AI search hit. */
  openAiHit(hit: AiSearchHit): void {
    this.router.navigateByUrl(hit.navigateTo);
    this.close();
  }

  private callAskAi(q: string): void {
    // Keep palette open — stream the answer inline via SSE.
    this.startAiStream(q);
  }

  // ─── Inline AI streaming (Cmd-K stays open) ───────────────────
  /**
   * Open an SSE stream against `POST /api/admin/ai/stream/palette` and append
   * each `{chunk}` frame to {@link aiText} in real time. Aborts any prior
   * stream first so old tokens never interleave with a new query.
   */
  startAiStream(rawQuery: string): void {
    const q = rawQuery.trim();
    if (!q) return;
    this.abortAiStream();
    this.aiEchoQuery.set(q);
    this.aiText.set('');
    this.aiError.set('');
    this.aiStreaming.set(true);
    this.aiPaneVisible.set(true);

    const ctrl = new AbortController();
    this.aiAbort = ctrl;
    const url = '/api/admin/ai/stream/palette';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    const token = this.auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body = JSON.stringify({
      query: q,
      context: {
        selected_site_id: this.state.selectedSite()?.id,
        current_route: this.router.url,
      },
    });

    fetch(url, { method: 'POST', headers, body, signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `AI stream failed (${res.status})`);
        }
        await this.consumeSse(res.body, ctrl);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'AI stream failed';
        this.aiError.set(msg);
      })
      .finally(() => {
        if (this.aiAbort === ctrl) this.aiAbort = null;
        this.aiStreaming.set(false);
      });
  }

  /** Parse an SSE byte stream into `{chunk}` / `{done}` / `{error}` frames. */
  private async consumeSse(stream: ReadableStream<Uint8Array>, ctrl: AbortController): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const lines = frame.split('\n').filter((l) => l.startsWith('data:'));
          if (!lines.length) continue;
          const payload = lines.map((l) => l.slice(5).trim()).join('');
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload) as {
              chunk?: string;
              done?: boolean;
              error?: { code?: string; message?: string };
            };
            if (parsed.chunk) this.aiText.update((prev) => prev + parsed.chunk);
            if (parsed.error?.message) this.aiError.set(parsed.error.message);
            if (parsed.done) { try { await reader.cancel(); } catch { /* noop */ } return; }
          } catch {
            // Malformed frame — ignore, keep streaming.
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
      // If we got here without seeing `done`, treat as graceful EOF.
      if (!ctrl.signal.aborted) this.aiStreaming.set(false);
    }
  }

  /** Abort the live SSE stream (close, re-query, or component teardown). */
  private abortAiStream(): void {
    if (this.aiAbort) {
      try { this.aiAbort.abort(); } catch { /* noop */ }
      this.aiAbort = null;
    }
    this.aiStreaming.set(false);
  }

  /** Clear the AI pane so the user can ask again with a fresh prompt. */
  resetAiPane(): void {
    this.abortAiStream();
    this.aiPaneVisible.set(false);
    this.aiEchoQuery.set('');
    this.aiText.set('');
    this.aiError.set('');
  }

  /** "Copy answer" chip — drops the raw streamed text on the clipboard. */
  copyAiAnswer(): void {
    const text = this.aiText().trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => this.toast.success('Copied'),
      () => this.toast.error('Copy failed'),
    );
  }

  /**
   * "Open full chat" chip — fires the global `ps:open-ai-chat` event so the
   * side-panel agent can pick up the conversation. Closes the palette.
   */
  openFullChat(): void {
    const q = this.aiEchoQuery();
    window.dispatchEvent(new CustomEvent('ps:open-ai-chat', { detail: { prefill: q } }));
    this.router.navigateByUrl('/admin/ai-chat-history');
    this.close();
  }

  /**
   * Tiny markdown renderer — paragraphs, links, inline code, fenced code,
   * bold, italic, unordered list. ~30 lines so we don't drag in `marked` for
   * a 4-sentence answer. The output is escaped HTML; only the recognised
   * tokens become real tags.
   */
  private renderMarkdownLite(md: string): string {
    if (!md) return '';
    const escape = (s: string): string =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    // Fenced code first so its body isn't mangled by inline rules.
    const codeBlocks: string[] = [];
    let working = md.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
      codeBlocks.push(`<pre><code>${escape(code.trim())}</code></pre>`);
      return ` CB${codeBlocks.length - 1} `;
    });
    working = escape(working);
    // Inline tokens.
    working = working
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+|\/[^)]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Paragraphs + bullets.
    const blocks = working.split(/\n{2,}/).map((blk) => {
      const lines = blk.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return '<ul>' + lines.map((l) => '<li>' + l.replace(/^\s*[-*]\s+/, '') + '</li>').join('') + '</ul>';
      }
      return '<p>' + blk.replace(/\n/g, '<br>') + '</p>';
    });
    let html = blocks.join('\n');
    html = html.replace(/ CB(\d+) /g, (_m, i: string) => codeBlocks[parseInt(i, 10)] ?? '');
    return html;
  }
}
