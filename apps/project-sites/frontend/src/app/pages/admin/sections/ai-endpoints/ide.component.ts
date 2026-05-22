/**
 * AI Endpoint IDE — multi-file editor with file tree, tabs, side panels, status
 * bar, and deploy/logs/test panes. Wraps {@link IdeCodeEditorComponent}.
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
import { Component, EventEmitter, Input, Output, computed, signal, type OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IdeCodeEditorComponent } from './code-editor.component';
import {
  LANGUAGE_OPTIONS,
  extensionFor,
  type DeployStatus,
  type EndpointBinding,
  type IdeLanguage,
  type OpenTab,
} from './types';

@Component({
  selector: 'app-ide',
  standalone: true,
  imports: [CommonModule, FormsModule, IdeCodeEditorComponent],
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
          <button class="btn-mini" (click)="save.emit()" title="Save (⌘S)" data-testid="ide-save">Save</button>
          <button class="btn-mini btn-deploy" (click)="deployClick.emit()" [disabled]="deployStatus === 'deploying'" title="Deploy to production" data-testid="ide-deploy">
            {{ deployStatus === 'deploying' ? 'Deploying…' : 'Deploy' }}
          </button>
          <button class="btn-mini" (click)="format()" title="Format" data-testid="ide-format">Format</button>
          <input class="input-mini search" placeholder="Find (⌘F)" [(ngModel)]="findQuery" (keydown.enter)="findNext()" data-testid="ide-find" />
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-mini" (click)="togglePanel('tester')" data-testid="ide-panel-tester">Tester</button>
          <button class="btn-mini" (click)="togglePanel('logs')" data-testid="ide-panel-logs">Logs</button>
          <button class="btn-mini" (click)="togglePanel('bindings')" data-testid="ide-panel-bindings">Bindings</button>
          <button class="btn-mini" (click)="togglePanel('preview')" data-testid="ide-panel-preview">Preview</button>
        </div>
      </div>

      <!-- BODY -->
      <div class="ide-body">
        <!-- FILE TREE -->
        <aside class="file-tree" data-testid="ide-file-tree">
          <div class="tree-head">
            <span>Files</span>
            <div class="flex gap-1">
              <button class="icon-btn" (click)="newFile()" title="New file" data-testid="ide-new-file">＋</button>
              <button class="icon-btn" (click)="newFolder()" title="New folder" data-testid="ide-new-folder">📁</button>
            </div>
          </div>
          <ul class="tree-list">
            @for (path of paths(); track path) {
              <li
                class="tree-item"
                [class.active]="path === activePath()"
                (click)="openFile(path)"
                [attr.data-testid]="'ide-file-' + path">
                <span class="tree-icon">{{ iconFor(path) }}</span>
                <span class="tree-name">{{ path }}</span>
                <button class="tree-del" (click)="deleteFile(path); $event.stopPropagation()" title="Delete" data-testid="ide-delete-file">×</button>
              </li>
            }
          </ul>
        </aside>

        <!-- EDITOR COLUMN -->
        <main class="editor-col">
          <!-- TABS -->
          <div class="tabs" data-testid="ide-tabs">
            @for (t of tabs(); track t.path) {
              <div class="tab" [class.active]="t.path === activePath()" (click)="openFile(t.path)">
                <span class="tab-name">{{ basename(t.path) }}{{ t.dirty ? ' •' : '' }}</span>
                <button class="tab-close" (click)="closeTab(t.path); $event.stopPropagation()">×</button>
              </div>
            }
          </div>
          <!-- EDITOR -->
          <div class="editor-area">
            @if (activePath(); as ap) {
              <app-ide-code-editor
                [value]="files[ap] ?? ''"
                [language]="editorLanguageFor(ap)"
                (valueChange)="onEditorChange(ap, $event)"
                data-testid="ide-editor" />
            } @else {
              <div class="empty-editor">Pick a file from the tree to start editing.</div>
            }
          </div>
        </main>

        <!-- SIDE PANEL -->
        @if (activePanel()) {
          <section class="side-panel" data-testid="ide-side-panel">
            <div class="panel-head">
              <strong>{{ activePanel() | titlecase }}</strong>
              <button class="icon-btn" (click)="activePanel.set(null)">×</button>
            </div>
            <div class="panel-body">
              @switch (activePanel()) {
                @case ('tester') {
                  <p class="text-[0.7rem] text-text-secondary mb-2">POST to your live endpoint.</p>
                  <textarea class="input-field font-mono w-full" rows="6" [(ngModel)]="testerBody" placeholder='{ "hello": "world" }' data-testid="ide-tester-body"></textarea>
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
                      <button class="icon-btn" (click)="removeBinding(i)">×</button>
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
    .editor-area { flex: 1; min-height: 0; padding: 0.5rem; }
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
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .preview-frame { width: 100%; height: 320px; background: #fff; border-radius: 8px; border: 0; }
  `],
})
export class IdeComponent implements OnInit {
  @Input() files: Record<string, string> = {};
  @Input() language: IdeLanguage = 'javascript';
  @Input() deployStatus: DeployStatus = 'idle';
  @Input() bindings: EndpointBinding[] = [];
  @Input() logs: { id: string; status: string; latency_ms: number; created_at: string }[] = [];
  @Input() liveUrl: string | null = null;
  @Input() testerResponse: string | null = null;

  @Output() filesChange = new EventEmitter<Record<string, string>>();
  @Output() languageChange = new EventEmitter<IdeLanguage>();
  @Output() bindingsChange = new EventEmitter<EndpointBinding[]>();
  @Output() save = new EventEmitter<void>();
  @Output() deployClick = new EventEmitter<void>();
  @Output() runTester = new EventEmitter<string>();

  langs = LANGUAGE_OPTIONS;
  languageLocal: IdeLanguage = 'javascript';

  activePath = signal<string | null>(null);
  tabs = signal<OpenTab[]>([]);
  paths = computed(() => Object.keys(this.files).sort());
  activePanel = signal<'tester' | 'logs' | 'bindings' | 'preview' | null>(null);

  findQuery = '';
  testerBody = '{}';

  ngOnInit(): void {
    this.languageLocal = this.language;
    const first = Object.keys(this.files)[0];
    if (first) this.openFile(first);
  }

  /** Open a file (adds to tabs if not already open). */
  openFile(path: string): void {
    this.activePath.set(path);
    const cur = this.tabs();
    if (!cur.find((t) => t.path === path)) {
      this.tabs.set([...cur, { path, dirty: false }]);
    }
  }

  closeTab(path: string): void {
    this.tabs.set(this.tabs().filter((t) => t.path !== path));
    if (this.activePath() === path) {
      const remaining = this.tabs();
      this.activePath.set(remaining.length ? remaining[remaining.length - 1].path : null);
    }
  }

  newFile(): void {
    const name = prompt('New file path (e.g. src/util.js)');
    if (!name) return;
    if (this.files[name] !== undefined) return;
    this.files = { ...this.files, [name]: '' };
    this.filesChange.emit(this.files);
    this.openFile(name);
  }

  newFolder(): void {
    const name = prompt('New folder path (e.g. lib/utils)');
    if (!name) return;
    const placeholder = `${name.replace(/\/$/, '')}/.keep`;
    this.files = { ...this.files, [placeholder]: '' };
    this.filesChange.emit(this.files);
  }

  deleteFile(path: string): void {
    if (!confirm(`Delete ${path}?`)) return;
    const next = { ...this.files };
    delete next[path];
    this.files = next;
    this.filesChange.emit(this.files);
    this.closeTab(path);
  }

  onEditorChange(path: string, value: string): void {
    this.files = { ...this.files, [path]: value };
    this.filesChange.emit(this.files);
    this.tabs.set(this.tabs().map((t) => (t.path === path ? { ...t, dirty: true } : t)));
  }

  onLanguageChange(next: IdeLanguage): void {
    this.languageChange.emit(next);
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

  editorLanguageFor(path: string): 'ai-prompt' | 'javascript' | 'typescript' | 'python' | 'rust-wasm' {
    const ext = extensionFor(path);
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    if (ext === 'py') return 'python';
    if (ext === 'rs') return 'rust-wasm';
    if (ext === 'md') return 'ai-prompt';
    return 'javascript';
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
    // No-op when no formatter is bundled — placeholder for Prettier-lite.
  }

  findNext(): void {
    // CodeMirror handles its own search via Cmd+F; this is a parent-level hook.
  }
}
