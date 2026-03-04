import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, SiteFile } from '../services/api.service';
import { ToastService } from '../services/toast.service';

interface FileNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

const LANG_MAP: Record<string, string> = {
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.js': 'JavaScript',
  '.ts': 'TypeScript',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.xml': 'XML',
  '.svg': 'SVG',
  '.txt': 'Text',
};

const ICON_MAP: Record<string, string> = {
  '.html': '🌐',
  '.htm': '🌐',
  '.css': '🎨',
  '.scss': '🎨',
  '.js': '⚡',
  '.ts': '⚡',
  '.json': '📋',
  '.md': '📝',
  '.svg': '🖼',
  '.png': '🖼',
  '.jpg': '🖼',
  '.jpeg': '🖼',
  '.ico': '🖼',
};

@Component({
  selector: 'app-files-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>File Editor</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="files-layout">
        <!-- File tree -->
        <div class="file-tree">
          @if (loading()) {
            <div class="tree-loading"><ion-spinner name="crescent"></ion-spinner></div>
          } @else {
            <div class="tree-header">
              <span class="tree-title">Files</span>
              <span class="tree-count">{{ files().length }}</span>
            </div>
            <div class="tree-items">
              @for (node of fileTree(); track node.path) {
                <div class="tree-item" [style.padding-left.px]="getDepth(node.path) * 16 + 12">
                  @if (node.isFolder) {
                    <button class="tree-folder" (click)="toggleFolder(node)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        [style.transform]="node.expanded ? 'rotate(90deg)' : ''">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                      {{ node.name }}
                    </button>
                  } @else {
                    <button class="tree-file" [class.active]="selectedFile()?.path === node.path"
                      [class.modified]="isModified(node.path)"
                      (click)="openFile(node)">
                      <span class="file-icon">{{ getFileIcon(node.name) }}</span>
                      {{ node.name }}
                      @if (isModified(node.path)) {
                        <span class="modified-dot"></span>
                      }
                    </button>
                  }
                </div>
              }
            </div>
            <div class="new-file-row">
              <input type="text" class="input-field" placeholder="path/to/new-file.html" [(ngModel)]="newFilePath" />
              <ion-button size="small" fill="solid" (click)="createNewFile()" [disabled]="!newFilePath.trim()">New</ion-button>
            </div>
          }
        </div>

        <!-- Editor -->
        <div class="file-editor">
          @if (selectedFile()) {
            <!-- Editor toolbar -->
            <div class="editor-toolbar">
              <div class="toolbar-left">
                <span class="toolbar-path">{{ selectedFile()!.path }}</span>
                <span class="toolbar-lang">{{ getLanguage(selectedFile()!.path) }}</span>
                @if (isModified(selectedFile()!.path)) {
                  <span class="toolbar-modified">Modified</span>
                }
              </div>
              <div class="toolbar-actions">
                <button class="toolbar-btn" (click)="revertFile()" [disabled]="!isModified(selectedFile()!.path)"
                        title="Revert changes" data-testid="revert-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                  Revert
                </button>
                <button class="toolbar-btn toolbar-btn-primary" (click)="saveFile()" [disabled]="saving() || !isModified(selectedFile()!.path)"
                        data-testid="save-btn">
                  @if (saving()) {
                    <ion-spinner name="dots" class="btn-spinner"></ion-spinner>
                    Saving...
                  } @else {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Save
                  }
                </button>
              </div>
            </div>
            <textarea
              class="code-editor"
              [(ngModel)]="editorContent"
              spellcheck="false"
              data-testid="code-editor"
            ></textarea>
          } @else {
            <div class="editor-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
              </svg>
              <p>Select a file to edit</p>
            </div>
          }
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .files-layout { display: flex; height: calc(100vh - 56px); }
    .file-tree {
      width: 280px; min-width: 280px; border-right: 1px solid var(--border);
      display: flex; flex-direction: column; overflow-y: auto;
      background: var(--bg-secondary);
    }
    .tree-loading { padding: 40px; text-align: center; }
    .tree-header {
      padding: 10px 16px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .tree-title { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .tree-count {
      font-size: 0.68rem; font-weight: 700; color: var(--accent);
      background: var(--accent-dim); padding: 1px 6px; border-radius: 10px;
    }
    .tree-items { flex: 1; overflow-y: auto; padding: 4px 0; }
    .tree-item { display: flex; }
    .tree-folder, .tree-file {
      display: flex; align-items: center; gap: 6px; width: 100%;
      padding: 5px 12px; border: none; background: none;
      color: var(--text-secondary); font-size: 0.8rem; cursor: pointer;
      text-align: left; font-family: 'Menlo', 'Consolas', monospace;
      transition: background 0.15s, color 0.15s; outline: none;
      &:hover { background: rgba(0, 229, 255, 0.05); color: var(--text-primary); }
      &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      &:active { background: rgba(0, 229, 255, 0.08); }
    }
    .tree-folder { font-weight: 600; }
    .tree-file.active { background: var(--accent-dim); color: var(--accent); }
    .tree-file svg, .tree-folder svg { flex-shrink: 0; transition: transform 0.15s; }
    .file-icon { font-size: 0.72rem; flex-shrink: 0; }
    .modified-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #ffab00; margin-left: auto; flex-shrink: 0;
    }
    .tree-file.modified { color: #ffab00; }
    .new-file-row {
      padding: 8px; border-top: 1px solid var(--border);
      display: flex; gap: 6px;
      .input-field { flex: 1; padding: 6px 10px; font-size: 0.78rem; }
    }
    .file-editor {
      flex: 1; display: flex; flex-direction: column;
      background: var(--bg-primary);
    }

    /* Editor toolbar */
    .editor-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 12px; border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      gap: 8px;
    }
    .toolbar-left {
      display: flex; align-items: center; gap: 8px; min-width: 0;
    }
    .toolbar-path {
      font-size: 0.78rem; color: var(--text-muted);
      font-family: 'Menlo', 'Consolas', monospace;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .toolbar-lang {
      font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      padding: 1px 6px; border-radius: 4px;
      background: var(--accent-dim); color: var(--accent);
      white-space: nowrap;
    }
    .toolbar-modified {
      font-size: 0.65rem; font-weight: 600;
      padding: 1px 6px; border-radius: 4px;
      background: rgba(255, 171, 0, 0.12); color: #ffab00;
      white-space: nowrap;
    }
    .toolbar-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .toolbar-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; border-radius: 6px;
      border: 1px solid var(--border); background: transparent;
      color: var(--text-secondary); font-size: 0.72rem; font-weight: 500;
      cursor: pointer; transition: all 0.15s; white-space: nowrap;
      font-family: var(--font); outline: none;
      &:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
      &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      &:active:not(:disabled) { transform: scale(0.95); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }
    .toolbar-btn-primary {
      background: var(--accent); color: var(--bg-primary); border-color: var(--accent);
      &:hover:not(:disabled) { filter: brightness(1.1); color: var(--bg-primary); }
      &:active:not(:disabled) { filter: brightness(0.9); }
    }
    .btn-spinner { width: 12px; height: 12px; }

    .code-editor {
      flex: 1; width: 100%; border: none; outline: none;
      background: var(--bg-primary); color: var(--text-primary);
      font-family: 'Menlo', 'Consolas', monospace;
      font-size: 0.85rem; line-height: 1.6;
      padding: 16px; resize: none;
      tab-size: 2;
    }
    .editor-empty {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px;
      color: var(--text-muted); font-size: 0.9rem;
      svg { opacity: 0.3; }
    }
  `],
})
export class FilesModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  siteId!: string;
  files = signal<SiteFile[]>([]);
  fileTree = signal<FileNode[]>([]);
  loading = signal(true);
  selectedFile = signal<SiteFile | null>(null);
  editorContent = '';
  originalContent = '';
  saving = signal(false);
  newFilePath = '';

  ngOnInit(): void {
    this.loadFiles();
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  isModified(path: string): boolean {
    const file = this.selectedFile();
    if (!file || file.path !== path) return false;
    return this.editorContent !== this.originalContent;
  }

  getLanguage(path: string): string {
    const ext = '.' + path.split('.').pop()?.toLowerCase();
    return LANG_MAP[ext] || 'Plain Text';
  }

  getFileIcon(name: string): string {
    const ext = '.' + name.split('.').pop()?.toLowerCase();
    return ICON_MAP[ext] || '📄';
  }

  revertFile(): void {
    this.editorContent = this.originalContent;
    this.toast.success('Reverted to saved version');
  }

  private loadFiles(): void {
    this.loading.set(true);
    this.api.getFiles(this.siteId).subscribe({
      next: (res) => {
        this.files.set(res.data || []);
        this.fileTree.set(this.buildTree(res.data || []));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load files');
      },
    });
  }

  private buildTree(files: SiteFile[]): FileNode[] {
    const nodes: FileNode[] = [];
    const folders = new Set<string>();

    for (const f of files) {
      const parts = f.path.split('/');
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        if (!folders.has(current)) {
          folders.add(current);
          nodes.push({ name: parts[i], path: current, isFolder: true, expanded: true });
        }
      }
      nodes.push({ name: parts[parts.length - 1], path: f.path, isFolder: false });
    }

    return nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  getDepth(path: string): number {
    return path.split('/').length - 1;
  }

  toggleFolder(node: FileNode): void {
    node.expanded = !node.expanded;
    this.fileTree.update((tree) => {
      return tree.filter((n) => {
        if (n.path === node.path) return true;
        if (!node.expanded && n.path.startsWith(node.path + '/')) return false;
        return true;
      });
    });
    if (node.expanded) {
      this.fileTree.set(this.buildTree(this.files()));
    }
  }

  openFile(node: FileNode): void {
    const file = this.files().find((f) => f.path === node.path);
    if (file) {
      this.selectedFile.set(file);
      this.editorContent = file.content || '';
      this.originalContent = file.content || '';
    }
  }

  saveFile(): void {
    const file = this.selectedFile();
    if (!file) return;
    this.saving.set(true);
    this.api.updateFile(this.siteId, file.path, this.editorContent).subscribe({
      next: () => {
        this.saving.set(false);
        this.originalContent = this.editorContent;
        this.files.update((files) =>
          files.map((f) => f.path === file.path ? { ...f, content: this.editorContent } : f)
        );
        this.toast.success('File saved');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Failed to save file');
      },
    });
  }

  createNewFile(): void {
    if (!this.newFilePath.trim()) return;
    this.saving.set(true);
    this.api.updateFile(this.siteId, this.newFilePath.trim(), '').subscribe({
      next: (res) => {
        this.saving.set(false);
        const newFile = res.data;
        this.files.update((f) => [...f, newFile]);
        this.fileTree.set(this.buildTree(this.files()));
        this.selectedFile.set(newFile);
        this.editorContent = '';
        this.originalContent = '';
        this.newFilePath = '';
        this.toast.success('File created');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Failed to create file');
      },
    });
  }
}
