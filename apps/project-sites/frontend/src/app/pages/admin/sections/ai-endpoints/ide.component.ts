/**
 * AI Endpoint IDE — multi-file editor with file tree, tabs, side panels, status
 * bar, and deploy/logs/test panes. Mounts a Monaco editor instance directly
 * via the lazy {@link loadMonaco} loader so the heavy editor bundle (~3-5 MB)
 * never lands in the initial Angular chunk.
 *
 * The IDE owns no network state — the parent passes the full file map and
 * receives change events. Save / Deploy emit upward; the parent decides whether
 * to PUT or POST.
 *
 * @example
 * ```html
 * <app-ide
 *   data-testid="ai-endpoint-ide"
 *   [files]="files()"
 *   [language]="language()"
 *   [deployStatus]="deployStatus()"
 *   (filesChange)="onFilesChange($event)"
 *   (deployClick)="onDeploy()" />
 * ```
 */
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  signal,
  type AfterViewInit,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HlmInputDirective } from '../../../../ui';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import { loadMonaco, type MonacoNamespace } from './monaco-loader';
import {
  LANGUAGE_OPTIONS,
  extensionFor,
  type DeployStatus,
  type EndpointBinding,
  type EndpointMethod,
  type IdeLanguage,
  type OpenTab,
} from './types';

type MonacoEditor = ReturnType<MonacoNamespace['editor']['create']>;
type MonacoModel = ReturnType<MonacoNamespace['editor']['createModel']>;

/** Monaco-supported language id we hand to `editor.setModelLanguage`. */
type MonacoLanguageId = 'typescript' | 'javascript' | 'python' | 'rust' | 'markdown' | 'json' | 'html' | 'plaintext';

@Component({
  selector: 'app-ide',
  standalone: true,
  imports: [CommonModule, FormsModule, HlmInputDirective, ...BrnTooltipImports],
  template: `
    <div class="ide-shell" data-testid="ai-endpoint-ide">
      <!-- TOOLBAR -->
      <div class="toolbar">
        <div class="flex items-center gap-2">
          <select class="input-mini" [(ngModel)]="languageLocal" (ngModelChange)="onLanguageChange($event)" data-testid="ide-language">
            @for (l of langs; track l.id) {
              <option [value]="l.id">{{ l.label }}</option>
            }
          </select>
          <button class="btn-mini" (click)="save.emit()" [brnTooltip]="'Save (⌘S)'" data-testid="ide-save">Save</button>
          <button class="btn-mini btn-deploy" (click)="deployClick.emit()" [disabled]="deployStatus === 'deploying'" [brnTooltip]="'Deploy to production'" data-testid="ide-deploy">
            {{ deployStatus === 'deploying' ? 'Deploying…' : 'Deploy' }}
          </button>
          <button class="btn-mini" (click)="format()" [brnTooltip]="'Format'" data-testid="ide-format">Format</button>
          <input class="input-mini search" placeholder="Find (⌘F)" [(ngModel)]="findQuery" (keydown.enter)="findNext()" data-testid="ide-find" />
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-mini" (click)="togglePanel('tester')" data-testid="ide-panel-tester">Tester</button>
          <button class="btn-mini" (click)="togglePanel('logs')" data-testid="ide-panel-logs">Logs</button>
          <button class="btn-mini" (click)="togglePanel('bindings')" data-testid="ide-panel-bindings">Bindings</button>
          <button
            class="btn-mini"
            type="button"
            [disabled]="method !== 'GET'"
            [attr.title]="method === 'GET' ? 'HTML preview of the deployed endpoint' : 'HTML preview is only available for GET endpoints'"
            (click)="togglePanel('preview')"
            data-testid="ide-panel-preview">Preview</button>
        </div>
      </div>

      <!-- BODY -->
      <div class="ide-body">
        <!-- FILE TREE -->
        <aside class="file-tree" data-testid="ide-file-tree">
          <div class="tree-head">
            <span>Files</span>
            <div class="flex gap-1">
              <button class="icon-btn" (click)="newFile()" [brnTooltip]="'New file'" aria-label="New file" data-testid="ide-new-file">＋</button>
              <button class="icon-btn" (click)="newFolder()" [brnTooltip]="'New folder'" aria-label="New folder" data-testid="ide-new-folder">📁</button>
            </div>
          </div>
          @if (newPathMode(); as mode) {
            <div class="new-path-row">
              <input
                hlmInput
                [seamless]="true"
                class="w-full font-mono text-[0.72rem]"
                [placeholder]="mode === 'file' ? 'src/util.js' : 'lib/utils'"
                [ngModel]="newPathDraft()"
                (ngModelChange)="newPathDraft.set($event)"
                (keydown.enter)="confirmNewPath()"
                (keydown.escape)="newPathMode.set(null)"
                (blur)="newPathMode.set(null)"
                autofocus
                [attr.aria-label]="mode === 'file' ? 'New file path' : 'New folder path'"
                data-testid="ide-new-path-input" />
            </div>
          }
          <ul class="tree-list">
            @for (path of paths(); track path) {
              <li
                class="tree-item"
                [class.active]="path === activePath()"
                (click)="openFile(path)"
                [attr.data-testid]="'ide-file-' + path">
                <span class="tree-icon">{{ iconFor(path) }}</span>
                <span class="tree-name">{{ path }}</span>
                <button class="tree-del" (click)="deleteFile(path); $event.stopPropagation()" [brnTooltip]="'Delete'" aria-label="Delete file" data-testid="ide-delete-file">×</button>
              </li>
            }
          </ul>
        </aside>

        <!-- EDITOR COLUMN -->
        <div class="editor-col">
          <!-- TABS -->
          <div class="tabs" data-testid="ide-tabs">
            @for (t of tabs(); track t.path) {
              <div class="tab" [class.active]="t.path === activePath()" (click)="openFile(t.path)">
                <span class="tab-name">{{ basename(t.path) }}{{ t.dirty ? ' •' : '' }}</span>
                <button class="tab-close" (click)="closeTab(t.path); $event.stopPropagation()" aria-label="Close tab">×</button>
              </div>
            }
          </div>
          <!-- EDITOR -->
          <div class="editor-area">
            @if (activePath()) {
              <div #editorHost class="monaco-host" data-testid="ide-editor"></div>
              @if (loading()) {
                <div class="editor-loading" role="status" aria-live="polite">Loading Monaco…</div>
              }
              @if (loadError()) {
                <div class="editor-error" role="alert">
                  Failed to load editor: {{ loadError() }}
                </div>
              }
            } @else {
              <div class="empty-editor">Pick a file from the tree to start editing.</div>
            }
          </div>
        </div>

        <!-- SIDE PANEL -->
        @if (activePanel()) {
          <section class="side-panel" data-testid="ide-side-panel">
            <div class="panel-head">
              <strong>{{ activePanel() | titlecase }}</strong>
              <button class="icon-btn" (click)="activePanel.set(null)" aria-label="Close panel">×</button>
            </div>
            <div class="panel-body">
              @switch (activePanel()) {
                @case ('tester') {
                  <p class="text-[0.7rem] text-text-secondary mb-2">POST to your live endpoint.</p>
                  <textarea hlmInput [multiline]="true" class="font-mono w-full" rows="6" [(ngModel)]="testerBody" placeholder='{ "hello": "world" }' data-testid="ide-tester-body"></textarea>
                  <button class="btn-mini mt-2" (click)="runTester.emit(testerBody)" data-testid="ide-tester-run">Run request</button>
                  @if (testerResponse) {
                    <pre class="response">{{ testerResponse }}</pre>
                  }
                }
                @case ('logs') {
                  <p class="text-[0.7rem] text-text-secondary mb-2">Last 20 invocations.</p>
                  @if (logs.length === 0) {
                    <p class="text-[0.7rem] text-text-secondary">No invocations yet.</p>
                  } @else {
                    <ul class="logs">
                      @for (l of logs; track l.id) {
                        <li class="log-row">
                          <span class="log-status" [class.ok]="l.status === 'success'">{{ l.status }}</span>
                          <span class="log-ms">{{ l.latency_ms }}ms</span>
                          <span class="log-time">{{ l.created_at }}</span>
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('bindings') {
                  <p class="text-[0.7rem] text-text-secondary mb-2">KV / R2 / D1 / AI / Queue / Vars / Secrets exposed to this endpoint.</p>
                  @for (b of bindings; track b.name; let i = $index) {
                    <div class="binding-row">
                      <select [(ngModel)]="b.type" class="input-mini">
                        <option value="kv">KV</option><option value="r2">R2</option><option value="d1">D1</option>
                        <option value="ai">AI</option><option value="queue">Queue</option>
                        <option value="var">Var</option><option value="secret">Secret</option>
                      </select>
                      <input class="input-mini" placeholder="NAME" [(ngModel)]="b.name" />
                      <input class="input-mini" placeholder="id / value" [(ngModel)]="b.value" />
                      <button class="icon-btn" (click)="removeBinding(i)" aria-label="Remove binding">×</button>
                    </div>
                  }
                  <button class="btn-mini mt-2" (click)="addBinding()" data-testid="ide-add-binding">+ Add binding</button>
                  <p class="text-[0.66rem] text-amber-300 mt-2">Bindings are persisted but enforcement ships in the next release.</p>
                }
                @case ('preview') {
                  <p class="text-[0.7rem] text-text-secondary mb-2">Live preview iframe (HTML endpoints).</p>
                  @if (liveUrl) {
                    <iframe class="preview-frame" [src]="liveUrl" data-testid="ide-preview-frame"></iframe>
                  } @else {
                    <p class="text-[0.7rem] text-text-secondary">Endpoint not deployed yet.</p>
                  }
                }
              }
            </div>
          </section>
        }
      </div>

      <!-- STATUS BAR -->
      <div class="status-bar" data-testid="ide-status-bar">
        <span>{{ languageLocal }}</span>
        <span>{{ paths().length }} files</span>
        <span>branch: main</span>
        <span class="grow"></span>
        <span class="deploy-pill" [class.live]="deployStatus === 'live'" [class.error]="deployStatus === 'error'" [class.deploying]="deployStatus === 'deploying'">
          {{ deployStatusLabel() }}
        </span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ide-shell { display: flex; flex-direction: column; height: 70vh; min-height: 540px; background: #0a0a14; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.7rem; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; gap: 6px; }
    .ide-body { flex: 1; display: grid; grid-template-columns: 240px 1fr; min-height: 0; }
    .ide-body:has(.side-panel) { grid-template-columns: 240px 1fr 320px; }
    .file-tree { background: rgba(255,255,255,0.015); border-right: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; min-width: 0; }
    .tree-head { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.7rem; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); border-bottom: 1px solid rgba(255,255,255,0.04); }
    .new-path-row { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .tree-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; }
    .tree-item { display: grid; grid-template-columns: 22px 1fr 22px; align-items: center; padding: 0.4rem 0.7rem; cursor: pointer; font-size: 0.72rem; color: rgba(255,255,255,0.8); gap: 6px; }
    .tree-item:hover { background: rgba(0,229,255,0.04); }
    .tree-item.active { background: rgba(0,229,255,0.08); color: #00E5FF; }
    .tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tree-del { background: transparent; border: 0; color: rgba(255,255,255,0.3); cursor: pointer; font-size: 0.9rem; }
    .tree-del:hover { color: #ff6b6b; }
    .editor-col { display: flex; flex-direction: column; min-width: 0; }
    .tabs { display: flex; gap: 2px; padding: 0.4rem 0.5rem 0; background: rgba(255,255,255,0.015); border-bottom: 1px solid rgba(255,255,255,0.04); overflow-x: auto; }
    .tab { display: flex; align-items: center; gap: 6px; padding: 0.35rem 0.6rem; border-radius: 6px 6px 0 0; background: rgba(255,255,255,0.02); cursor: pointer; font-size: 0.7rem; color: rgba(255,255,255,0.7); }
    .tab.active { background: #0a0a14; color: #00E5FF; }
    .tab-close { background: transparent; border: 0; color: rgba(255,255,255,0.4); cursor: pointer; }
    .editor-area { flex: 1; min-height: 0; padding: 0.5rem; position: relative; }
    .monaco-host { width: 100%; height: 100%; min-height: 320px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); background: #1e1e1e; }
    .editor-loading, .editor-error { position: absolute; inset: 0.5rem; display: flex; align-items: center; justify-content: center; background: rgba(10,10,20,0.8); color: rgba(255,255,255,0.7); font-size: 0.78rem; pointer-events: none; border-radius: 8px; }
    .editor-error { color: #fca5a5; pointer-events: auto; padding: 1rem; text-align: center; }
    .empty-editor { padding: 2rem; text-align: center; color: rgba(255,255,255,0.4); font-size: 0.8rem; }
    .side-panel { background: rgba(255,255,255,0.015); border-left: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; min-width: 0; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.75rem; }
    .panel-body { padding: 0.7rem 0.8rem; overflow-y: auto; }
    .status-bar { display: flex; gap: 14px; align-items: center; padding: 0.35rem 0.7rem; background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.62rem; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.06em; }
    .status-bar .grow { flex: 1; }
    .deploy-pill { padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7); }
    .deploy-pill.live { background: rgba(74, 222, 128, 0.12); color: #4ade80; }
    .deploy-pill.error { background: rgba(248, 113, 113, 0.14); color: #f87171; }
    .deploy-pill.deploying { background: rgba(124, 58, 237, 0.16); color: #c4b5fd; }
    .input-mini, .btn-mini { font-size: 0.7rem; padding: 0.35rem 0.55rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; }
    .btn-mini { cursor: pointer; }
    .btn-mini:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-mini { cursor: pointer; }
    .btn-mini.btn-deploy { background: rgba(0,229,255,0.12); color: #00E5FF; border-color: rgba(0,229,255,0.35); font-weight: 600; }
    .btn-mini:disabled { opacity: 0.5; cursor: not-allowed; }
    .input-mini.search { min-width: 160px; }
    .icon-btn { background: transparent; border: 0; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 0.85rem; padding: 2px 6px; }
    .icon-btn:hover { color: #00E5FF; }
    .binding-row { display: grid; grid-template-columns: 80px 1fr 1fr 22px; gap: 4px; margin-bottom: 4px; }
    .response { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 6px 8px; font-size: 0.66rem; max-height: 240px; overflow: auto; margin-top: 8px; white-space: pre-wrap; }
    .logs { list-style: none; padding: 0; margin: 0; font-size: 0.66rem; }
    .log-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); }
    .log-status { color: #f87171; text-transform: uppercase; font-weight: 600; font-size: 0.6rem; }
    .log-status.ok { color: #4ade80; }
    /* .input-field removed — the tester textarea now uses hlmInput [multiline] (Spartan). */
    .preview-frame { width: 100%; height: 320px; background: #fff; border-radius: 8px; border: 0; }
  `],
})
export class IdeComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() files: Record<string, string> = {};
  @Input() language: IdeLanguage = 'javascript';
  @Input() deployStatus: DeployStatus = 'idle';
  @Input() bindings: EndpointBinding[] = [];
  @Input() logs: { id: string; status: string; latency_ms: number; created_at: string }[] = [];
  @Input() liveUrl: string | null = null;
  @Input() testerResponse: string | null = null;
  /**
   * HTTP method of the parent endpoint. Required to gate the Preview panel
   * — only GET endpoints can render in an iframe (POST/PUT/DELETE/PATCH
   * would 405/400 the iframe load and surface a spurious bottom-right
   * error toast from the global error interceptor).
   */
  @Input() method: EndpointMethod = 'POST';

  @Output() filesChange = new EventEmitter<Record<string, string>>();
  @Output() languageChange = new EventEmitter<IdeLanguage>();
  @Output() bindingsChange = new EventEmitter<EndpointBinding[]>();
  @Output() save = new EventEmitter<void>();
  @Output() deployClick = new EventEmitter<void>();
  @Output() runTester = new EventEmitter<string>();

  @ViewChild('editorHost') editorHost?: ElementRef<HTMLDivElement>;

  langs = LANGUAGE_OPTIONS;
  languageLocal: IdeLanguage = 'javascript';

  activePath = signal<string | null>(null);
  tabs = signal<OpenTab[]>([]);
  /** Inline new-file/-folder entry mode + draft path (replaces prompt()). */
  newPathMode = signal<'file' | 'folder' | null>(null);
  newPathDraft = signal('');
  paths = computed(() => Object.keys(this.files).sort());
  activePanel = signal<'tester' | 'logs' | 'bindings' | 'preview' | null>(null);
  loading = signal<boolean>(false);
  loadError = signal<string | null>(null);

  findQuery = '';
  testerBody = '{}';

  // Monaco internals — kept private; the public API stays files/language.
  private monaco: MonacoNamespace | null = null;
  private editor: MonacoEditor | null = null;
  /** One Monaco model per file path, so per-file undo/redo + scroll position is preserved. */
  private models = new Map<string, MonacoModel>();
  /** Re-entrance guard: when we programmatically write to a model, skip the change handler. */
  private suppressChange = false;

  ngOnInit(): void {
    this.languageLocal = this.language;
    const first = Object.keys(this.files)[0];
    if (first) this.openFile(first);
  }

  async ngAfterViewInit(): Promise<void> {
    await this.bootEditor();
  }

  ngOnDestroy(): void {
    // Dispose editor + every model. Each Monaco instance + model holds
    // ~5MB of tokenized state — leaving them attached leaks memory across
    // overlay open/close cycles.
    this.editor?.dispose();
    this.editor = null;
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    // Also reap any orphan models (defensive — Monaco occasionally creates
    // diff-editor side models that don't make it into our map).
    this.monaco?.editor.getModels().forEach((m) => m.dispose());
    this.monaco = null;
  }

  /** Open a file (adds to tabs if not already open). */
  openFile(path: string): void {
    this.activePath.set(path);
    const cur = this.tabs();
    if (!cur.find((t) => t.path === path)) {
      this.tabs.set([...cur, { path, dirty: false }]);
    }
    this.attachModelFor(path);
  }

  closeTab(path: string): void {
    this.tabs.set(this.tabs().filter((t) => t.path !== path));
    if (this.activePath() === path) {
      const remaining = this.tabs();
      const next = remaining.length ? remaining[remaining.length - 1].path : null;
      this.activePath.set(next);
      if (next) this.attachModelFor(next);
    }
    // Drop the model for the closed tab so memory is reclaimed promptly.
    const model = this.models.get(path);
    if (model) {
      model.dispose();
      this.models.delete(path);
    }
  }

  /** Inline new-path entry (replaces raw prompt() — branded, focus-safe). */
  newFile(): void { this.newPathDraft.set(''); this.newPathMode.set('file'); }
  newFolder(): void { this.newPathDraft.set(''); this.newPathMode.set('folder'); }

  confirmNewPath(): void {
    const mode = this.newPathMode();
    const name = this.newPathDraft().trim();
    this.newPathMode.set(null);
    if (!mode || !name) return;
    if (mode === 'file') {
      if (this.files[name] !== undefined) return;
      this.files = { ...this.files, [name]: '' };
      this.filesChange.emit(this.files);
      this.openFile(name);
    } else {
      const placeholder = `${name.replace(/\/$/, '')}/.keep`;
      this.files = { ...this.files, [placeholder]: '' };
      this.filesChange.emit(this.files);
    }
  }

  deleteFile(path: string): void {
    if (!confirm(`Delete ${path}?`)) return;
    const next = { ...this.files };
    delete next[path];
    this.files = next;
    this.filesChange.emit(this.files);
    this.closeTab(path);
  }

  onLanguageChange(next: IdeLanguage): void {
    this.languageLocal = next;
    this.languageChange.emit(next);
    // Re-evaluate the active model's language since the picker is a global
    // hint (per-file language is still inferred from extension).
    const path = this.activePath();
    if (path) this.applyLanguageForPath(path);
  }

  togglePanel(p: 'tester' | 'logs' | 'bindings' | 'preview'): void {
    this.activePanel.set(this.activePanel() === p ? null : p);
  }

  addBinding(): void {
    this.bindings = [...this.bindings, { type: 'kv', name: '' }];
    this.bindingsChange.emit(this.bindings);
  }

  removeBinding(i: number): void {
    this.bindings = this.bindings.filter((_, idx) => idx !== i);
    this.bindingsChange.emit(this.bindings);
  }

  iconFor(path: string): string {
    const ext = extensionFor(path);
    if (ext === 'js' || ext === 'mjs') return 'JS';
    if (ext === 'ts' || ext === 'tsx') return 'TS';
    if (ext === 'py') return 'PY';
    if (ext === 'rs') return 'RS';
    if (ext === 'md') return 'MD';
    if (ext === 'json') return 'JS';
    if (ext === 'toml') return 'CF';
    return '⋯';
  }

  basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i === -1 ? path : path.slice(i + 1);
  }

  /** Map a file path to a Monaco language id. */
  private monacoLanguageFor(path: string): MonacoLanguageId {
    const ext = extensionFor(path);
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
    if (ext === 'py') return 'python';
    if (ext === 'rs') return 'rust';
    if (ext === 'md') return 'markdown';
    if (ext === 'json') return 'json';
    if (ext === 'html' || ext === 'htm') return 'html';
    return 'plaintext';
  }

  deployStatusLabel(): string {
    switch (this.deployStatus) {
      case 'live': return 'Live';
      case 'deploying': return 'Deploying…';
      case 'error': return 'Error';
      default: return 'Idle';
    }
  }

  format(): void {
    // Trigger Monaco's built-in formatter when a formatting provider is registered
    // (TS/JS/JSON/HTML/CSS are all covered out of the box).
    this.editor?.getAction('editor.action.formatDocument')?.run().catch(() => undefined);
  }

  findNext(): void {
    // Monaco's find widget owns Cmd+F natively. This is a parent-level hook
    // that opens the widget pre-populated with the toolbar query.
    if (!this.editor) return;
    const action = this.editor.getAction('actions.find');
    action?.run().catch(() => undefined);
  }

  /** Boot the Monaco namespace, then mount the editor for the active file. */
  private async bootEditor(): Promise<void> {
    if (!this.editorHost) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.monaco = await loadMonaco();
      const reducedMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      this.editor = this.monaco.editor.create(this.editorHost.nativeElement, {
        value: '',
        language: 'plaintext',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        cursorBlinking: reducedMotion ? 'solid' : 'blink',
        tabSize: 2,
        renderWhitespace: 'selection',
        smoothScrolling: !reducedMotion,
        wordWrap: 'off',
        roundedSelection: true,
      });
      this.editor.onDidChangeModelContent(() => {
        if (this.suppressChange) return;
        const path = this.activePath();
        if (!path || !this.editor) return;
        const value = this.editor.getValue();
        this.commitFileChange(path, value);
      });
      const path = this.activePath();
      if (path) this.attachModelFor(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.loadError.set(message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Ensure a model exists for `path`, then attach it to the editor. */
  private attachModelFor(path: string): void {
    if (!this.monaco || !this.editor) return;
    let model = this.models.get(path);
    const language = this.monacoLanguageFor(path);
    if (!model) {
      model = this.monaco.editor.createModel(this.files[path] ?? '', language);
      this.models.set(path, model);
    } else {
      // Re-sync if the parent mutated the file externally (e.g. Save reverted state).
      const incoming = this.files[path] ?? '';
      if (model.getValue() !== incoming) {
        this.suppressChange = true;
        try {
          model.setValue(incoming);
        } finally {
          this.suppressChange = false;
        }
      }
      if (model.getLanguageId() !== language) {
        this.monaco.editor.setModelLanguage(model, language);
      }
    }
    this.editor.setModel(model);
  }

  /** Re-apply the language for the currently mounted file path. */
  private applyLanguageForPath(path: string): void {
    const model = this.models.get(path);
    if (!this.monaco || !model) return;
    this.monaco.editor.setModelLanguage(model, this.monacoLanguageFor(path));
  }

  /** Propagate an edit to the file map + mark the tab dirty. */
  private commitFileChange(path: string, value: string): void {
    this.files = { ...this.files, [path]: value };
    this.filesChange.emit(this.files);
    this.tabs.set(this.tabs().map((t) => (t.path === path ? { ...t, dirty: true } : t)));
  }
}
