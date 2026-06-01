/**
 * @file Per-site AI Chat extras — drops in under the system-prompt field.
 * Contains four sub-sections:
 *   1. Allow web research toggle
 *   2. Knowledge file upload (PDF / image) with extraction
 *   3. Google Drive folder monitoring (connect → pick → sync)
 *   4. Context summary modal
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmInputDirective } from '../../../ui';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';

/** Row returned by GET /sites/:id/ai/context/files. */
interface ContextFile {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number;
  source: 'upload' | 'drive';
  drive_file_id: string | null;
  extracted_chars: number;
  created_at: string;
}

/** Folder shape returned by POST /sites/:id/ai/drive/folders. */
interface DriveFolder {
  id: string;
  name: string;
  modified_time: string;
}

/** Per-file upload progress entry. */
interface UploadProgress {
  filename: string;
  pct: number;
  status: 'uploading' | 'extracting' | 'done' | 'error';
  error?: string;
}

/** Settings shape used to seed local state from GET /sites/:id/ai-settings. */
interface AiSettings {
  allow_web_research: boolean;
  drive_connected: boolean;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  drive_last_synced_at: string | null;
}

/** Tiny, safe Markdown renderer — supports headings, **bold**, lists, code fences. */
function renderMarkdown(md: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  for (const raw of lines) {
    if (raw.startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        out.push('<pre class="md-code"><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const level = heading[1].length;
      out.push(`<h${level}>${esc(heading[2])}</h${level}>`);
      continue;
    }
    if (raw.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${esc(raw.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    if (raw.trim() === '') {
      out.push('');
      continue;
    }
    let line = esc(raw);
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
    out.push(`<p>${line}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

@Component({
  selector: 'app-ai-chat-extras',
  standalone: true,
  imports: [FormsModule, HlmInputDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (siteId(); as sid) {
    <section class="extras">
      <!-- 1. Web research toggle -->
      <fieldset class="card" data-testid="ai-chat-extras-web-research">
        <legend>Web research</legend>
        <label class="toggle">
          <input
            type="checkbox"
            [checked]="allowWebResearch()"
            (change)="toggleWebResearch($any($event.target).checked)"
            data-testid="ai-chat-extras-allow-web-research"
          />
          <span>Allow the AI to search the web when answering questions about this site.</span>
        </label>
        <p class="hint">
          When enabled, the assistant may call out to live search engines for facts not present in
          the system prompt or knowledge files. Disable to keep answers strictly grounded in your
          uploaded context.
        </p>
      </fieldset>

      <!-- 2. Knowledge files -->
      <fieldset class="card" data-testid="ai-chat-extras-files">
        <legend>Knowledge files</legend>
        <p class="hint">PDFs and images, up to 10 MB each. Text is extracted automatically.</p>
        <div
          class="dropzone"
          [class.drag]="dragOver()"
          (dragover)="onDragOver($event)"
          (dragleave)="dragOver.set(false)"
          (drop)="onDrop($event)"
        >
          <input
            #fileInput
            type="file"
            accept="application/pdf,image/*"
            multiple
            (change)="onFileInput($any($event.target).files)"
            data-testid="ai-chat-extras-file-input"
          />
          <button type="button" class="btn" (click)="fileInput.click()">
            Choose files
          </button>
          <span class="dz-hint">or drop here</span>
        </div>
        @if (uploads().length) {
          <ul class="uploads">
            @for (u of uploads(); track u.filename) {
              <li>
                <span class="up-name">{{ u.filename }}</span>
                <span class="up-status">{{ u.status }}</span>
                <progress max="100" [value]="u.pct"></progress>
                @if (u.error) {
                  <span class="up-error">{{ u.error }}</span>
                }
              </li>
            }
          </ul>
        }
        @if (filesLoading()) {
          <p class="hint">Loading files…</p>
        }
        <ul class="files" data-testid="ai-chat-extras-files-list">
          @for (f of files(); track f.id) {
            <li>
              <span class="badge" [attr.data-source]="f.source">{{ f.source }}</span>
              <span class="f-name">{{ f.filename }}</span>
              <span class="f-meta">
                {{ formatBytes(f.size_bytes) }} · {{ f.extracted_chars }} chars
              </span>
              <button type="button" class="btn-delete" (click)="deleteFile(f)">Delete</button>
            </li>
          } @empty {
            <li class="empty" role="status">No knowledge files yet.</li>
          }
        </ul>
      </fieldset>

      <!-- 3. Google Drive -->
      <fieldset class="card" data-testid="ai-chat-extras-drive">
        <legend>Google Drive</legend>
        @if (!driveConnected()) {
          <p class="hint">Connect a Drive account, then pick a folder. We re-sync hourly.</p>
          <button type="button" class="btn primary" (click)="connectDrive()" data-testid="ai-chat-extras-connect-drive">
            Connect Google Drive
          </button>
        } @else {
          <p class="hint">
            Connected.
            @if (driveFolderName()) {
              Folder: <strong>{{ driveFolderName() }}</strong>
              @if (driveLastSyncedAt()) {
                · Last synced {{ driveLastSyncedAt() }}
              }
            } @else {
              No folder selected.
            }
          </p>
          <div class="row">
            <button type="button" class="btn" (click)="openFolderPicker()">
              @if (driveFolderName()) { Change folder } @else { Pick folder }
            </button>
            @if (driveFolderName()) {
              <button type="button" class="btn" (click)="resyncDrive()" [disabled]="syncing()">
                {{ syncing() ? 'Syncing…' : 'Re-sync now' }}
              </button>
            }
            <button type="button" class="btn danger" (click)="disconnectDrive()">Disconnect</button>
          </div>
        }
      </fieldset>

      <!-- 4. Context summary -->
      <fieldset class="card" data-testid="ai-chat-extras-summary">
        <legend>Context summary</legend>
        <p class="hint">
          See exactly what the AI sees: system prompt, web-research toggle, drive folder,
          extracted file text.
        </p>
        <button
          type="button"
          class="btn primary"
          (click)="openSummary()"
          data-testid="ai-chat-extras-view-summary"
        >
          View context summary
        </button>
      </fieldset>

      <!-- Folder picker modal -->
      @if (folderPickerOpen()) {
        <div class="modal" role="dialog" aria-modal="true" aria-label="Pick a Drive folder">
          <div class="modal-body">
            <h3>Pick a folder</h3>
            <input
              hlmInput
              type="text"
              class="w-full mb-3"
              placeholder="Filter folders…"
              [(ngModel)]="folderQuery"
              (input)="loadFolders()"
            />
            @if (foldersLoading()) {
              <p class="hint">Loading…</p>
            }
            <ul class="folder-list">
              @for (f of folders(); track f.id) {
                <li>
                  <button type="button" class="folder-row" (click)="selectFolder(f)">
                    <span class="folder-name">{{ f.name }}</span>
                    <span class="folder-time">{{ f.modified_time }}</span>
                  </button>
                </li>
              } @empty {
                <li class="empty" role="status">No folders match.</li>
              }
            </ul>
            <div class="row right">
              <button type="button" class="btn" (click)="folderPickerOpen.set(false)">Cancel</button>
            </div>
          </div>
        </div>
      }

      <!-- Context summary modal -->
      @if (summaryOpen()) {
        <div class="modal" role="dialog" aria-modal="true" aria-label="AI context summary">
          <div class="modal-body large">
            <header class="summary-head">
              <h3>Context summary</h3>
              <span class="summary-stat" data-testid="ai-chat-extras-summary-stats">
                {{ summaryFileCount() }} files · {{ summaryTotalChars() }} chars
              </span>
              <button type="button" class="btn" (click)="copySummary()">Copy raw markdown</button>
              <button type="button" class="btn" (click)="summaryOpen.set(false)">Close</button>
            </header>
            @if (summaryLoading()) {
              <p class="hint">Loading…</p>
            } @else {
              <article
                class="summary-body"
                data-testid="ai-chat-extras-summary-body"
                [innerHTML]="summaryHtml()"
              ></article>
            }
          </div>
        </div>
      }
    </section>
    } @else {
      <p class="hint">Select a site to configure AI chat extras.</p>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .extras { display: flex; flex-direction: column; gap: 1rem; }
      .card { border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1rem 1.1rem; background: rgba(255,255,255,0.02); }
      legend { font-weight: 700; padding: 0 .35rem; color: #fff; }
      .hint { font-size: .82rem; color: rgba(255,255,255,0.65); margin: .35rem 0 .6rem; }
      .toggle { display: flex; align-items: center; gap: .55rem; color: #fff; font-size: .9rem; }
      .toggle input { width: 1.05rem; height: 1.05rem; }
      .dropzone { border: 1px dashed rgba(255,255,255,0.2); border-radius: 10px; padding: 1rem; display: flex; align-items: center; gap: .75rem; }
      .dropzone.drag { border-color: #00E5FF; background: rgba(0,229,255,0.04); }
      .dropzone input[type=file] { display: none; }
      .dz-hint { color: rgba(255,255,255,0.5); font-size: .8rem; }
      .btn { padding: .45rem .85rem; border-radius: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff; cursor: pointer; font-size: .82rem; }
      .btn:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
      .btn:disabled { opacity: .5; cursor: not-allowed; }
      .btn.primary { background: rgba(0,229,255,0.14); border-color: rgba(0,229,255,0.35); color: #00E5FF; }
      .btn.danger { color: #ff6b6b; border-color: rgba(255,107,107,0.35); }
      .btn-delete { background: transparent; border: 0; color: #ff6b6b; cursor: pointer; font-size: .78rem; }
      .uploads { list-style: none; padding: 0; margin: .75rem 0; display: flex; flex-direction: column; gap: .35rem; }
      .uploads li { display: grid; grid-template-columns: 1fr auto 7rem; align-items: center; gap: .5rem; font-size: .8rem; color: #fff; }
      progress { width: 100%; height: .55rem; }
      .files { list-style: none; padding: 0; margin: .5rem 0 0; display: flex; flex-direction: column; gap: .4rem; }
      .files li { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: .65rem; padding: .55rem .75rem; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; }
      .files .empty { justify-content: center; color: rgba(255,255,255,0.4); }
      .badge { font-size: .65rem; text-transform: uppercase; padding: .15rem .45rem; border-radius: 4px; background: rgba(0,229,255,0.12); color: #00E5FF; }
      .badge[data-source=drive] { background: rgba(124,58,237,0.18); color: #c4a8ff; }
      .f-name { color: #fff; font-size: .85rem; word-break: break-all; }
      .f-meta { color: rgba(255,255,255,0.55); font-size: .75rem; }
      .up-error { color: #ff6b6b; font-size: .75rem; }
      .row { display: flex; gap: .55rem; }
      .row.right { justify-content: flex-end; }
      .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 100; }
      .modal-body { background: #11121a; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 1.25rem; min-width: min(420px, 90vw); max-width: 90vw; max-height: 88vh; overflow: auto; }
      .modal-body.large { min-width: min(720px, 92vw); }
      .summary-head { display: flex; align-items: center; gap: .75rem; margin-bottom: .75rem; flex-wrap: wrap; }
      .summary-head h3 { margin: 0; flex: 1; color: #fff; }
      .summary-stat { font-size: .8rem; color: rgba(255,255,255,0.6); }
      .summary-body :is(h1,h2,h3) { color: #fff; margin: 1rem 0 .35rem; }
      .summary-body p { color: rgba(255,255,255,0.78); font-size: .85rem; line-height: 1.55; }
      .summary-body code { background: rgba(255,255,255,0.06); padding: 0 .25rem; border-radius: 3px; }
      .summary-body pre { background: rgba(0,0,0,0.4); padding: .65rem .85rem; border-radius: 8px; overflow-x: auto; font-size: .75rem; }
      /* .input removed — folder filter now Spartan hlmInput (mb-3). */
      .folder-list { list-style: none; padding: 0; margin: 0; max-height: 360px; overflow-y: auto; }
      .folder-list .empty { color: rgba(255,255,255,0.4); text-align: center; padding: 1rem; }
      .folder-row { width: 100%; text-align: left; background: transparent; border: 0; padding: .55rem .65rem; border-radius: 6px; color: #fff; display: flex; justify-content: space-between; cursor: pointer; }
      .folder-row:hover { background: rgba(255,255,255,0.05); }
      .folder-name { font-size: .88rem; }
      .folder-time { font-size: .72rem; color: rgba(255,255,255,0.45); }
    `,
  ],
})
export class AiChatExtrasComponent {
  /** Currently-selected site ID. The component fetches when this changes. */
  siteId = input<string | undefined>(undefined);

  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  // State signals
  readonly allowWebResearch = signal(false);
  readonly driveConnected = signal(false);
  readonly driveFolderId = signal<string | null>(null);
  readonly driveFolderName = signal<string | null>(null);
  readonly driveLastSyncedAt = signal<string | null>(null);
  readonly files = signal<ContextFile[]>([]);
  readonly filesLoading = signal(false);
  readonly uploads = signal<UploadProgress[]>([]);
  readonly dragOver = signal(false);
  readonly syncing = signal(false);

  readonly folderPickerOpen = signal(false);
  readonly folders = signal<DriveFolder[]>([]);
  readonly foldersLoading = signal(false);
  folderQuery = '';

  readonly summaryOpen = signal(false);
  readonly summaryLoading = signal(false);
  readonly summaryMarkdown = signal('');
  readonly summaryFileCount = signal(0);
  readonly summaryTotalChars = signal(0);
  readonly summaryHtml = computed(() => renderMarkdown(this.summaryMarkdown()));

  constructor() {
    effect(() => {
      const id = this.siteId();
      if (!id) return;
      this.refresh(id);
    });
    // Auto-toast OAuth redirect outcome (drive=connected|expired|error).
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const driveParam = p.get('drive');
      if (driveParam === 'connected') {
        this.toast.success('Google Drive connected');
        const url = new URL(window.location.href);
        url.searchParams.delete('drive');
        history.replaceState({}, '', url.toString());
      } else if (driveParam === 'expired' || driveParam === 'error') {
        this.toast.error('Google Drive connection failed');
      }
    }
  }

  /** Re-fetch settings + file list for a site. */
  refresh(id: string): void {
    this.api
      .get<{ data: AiSettings }>(`/sites/${id}/ai-settings`)
      .subscribe({
        next: (r) => {
          this.allowWebResearch.set(!!r.data.allow_web_research);
          this.driveConnected.set(!!r.data.drive_connected);
          this.driveFolderId.set(r.data.drive_folder_id ?? null);
          this.driveFolderName.set(r.data.drive_folder_name ?? null);
          this.driveLastSyncedAt.set(r.data.drive_last_synced_at ?? null);
        },
        error: () => this.toast.error('Failed to load AI settings'),
      });
    this.loadFiles(id);
  }

  /** Reload the file list. */
  loadFiles(id: string): void {
    this.filesLoading.set(true);
    this.api.get<{ data: ContextFile[] }>(`/sites/${id}/ai/context/files`).subscribe({
      next: (r) => {
        this.files.set(r.data);
        this.filesLoading.set(false);
      },
      error: () => {
        this.filesLoading.set(false);
        this.toast.error('Failed to load knowledge files');
      },
    });
  }

  /** Persist web-research toggle. */
  toggleWebResearch(checked: boolean): void {
    const id = this.siteId();
    if (!id) return;
    this.allowWebResearch.set(checked);
    this.api
      .put(`/sites/${id}/ai-settings`, { allow_web_research: checked })
      .subscribe({
        next: () => this.toast.success(checked ? 'Web research on' : 'Web research off'),
        error: () => {
          this.allowWebResearch.set(!checked);
          this.toast.error('Failed to update setting');
        },
      });
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    if (ev.dataTransfer?.files) this.onFileInput(ev.dataTransfer.files);
  }

  /** Handle file picker / drop selections — upload each in parallel. */
  onFileInput(list: FileList | null): void {
    if (!list || !list.length) return;
    const id = this.siteId();
    if (!id) return;
    Array.from(list).forEach((file) => this.uploadFile(id, file));
  }

  /** Upload a single file with progress via XHR (lets us report % done). */
  uploadFile(siteId: string, file: File): void {
    if (file.size > 10 * 1024 * 1024) {
      this.toast.error(`${file.name}: too large (10 MB max)`);
      return;
    }
    const entry: UploadProgress = { filename: file.name, pct: 0, status: 'uploading' };
    this.uploads.update((arr) => [...arr, entry]);
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sites/${siteId}/ai/context/upload`, true);
    const token = this.auth.getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 90);
      this.updateUpload(file.name, { pct, status: pct < 90 ? 'uploading' : 'extracting' });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        this.updateUpload(file.name, { pct: 100, status: 'done' });
        this.toast.success(`Uploaded ${file.name}`);
        this.loadFiles(siteId);
        setTimeout(() => {
          this.uploads.update((arr) => arr.filter((u) => u.filename !== file.name));
        }, 1500);
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? msg;
        } catch {
          /* ignore */
        }
        this.updateUpload(file.name, { pct: 100, status: 'error', error: msg });
        this.toast.error(`${file.name}: ${msg}`);
      }
    };
    xhr.onerror = () => {
      this.updateUpload(file.name, { pct: 100, status: 'error', error: 'network error' });
      this.toast.error(`${file.name}: network error`);
    };
    xhr.send(form);
  }

  private updateUpload(filename: string, patch: Partial<UploadProgress>): void {
    this.uploads.update((arr) => arr.map((u) => (u.filename === filename ? { ...u, ...patch } : u)));
  }

  /** Delete a single knowledge file (soft-delete + R2 cleanup). */
  deleteFile(f: ContextFile): void {
    const id = this.siteId();
    if (!id) return;
    if (!confirm(`Delete ${f.filename}?`)) return;
    this.api.delete(`/sites/${id}/ai/context/files/${f.id}`).subscribe({
      next: () => {
        this.toast.success('Deleted');
        this.files.update((arr) => arr.filter((x) => x.id !== f.id));
      },
      error: () => this.toast.error('Delete failed'),
    });
  }

  /** Kick off the Drive OAuth flow. */
  connectDrive(): void {
    const id = this.siteId();
    if (!id) return;
    const redirect = encodeURIComponent('/admin/settings?tab=ai-chat');
    this.api
      .get<{ data: { auth_url: string } }>(`/sites/${id}/ai/drive/auth-url?redirect_url=${redirect}`)
      .subscribe({
        next: (r) => {
          window.location.href = r.data.auth_url;
        },
        error: () => this.toast.error('Failed to start OAuth'),
      });
  }

  disconnectDrive(): void {
    const id = this.siteId();
    if (!id) return;
    if (!confirm('Disconnect Google Drive?')) return;
    // Clear server-side state by writing nulls back through the settings PUT.
    // The settings endpoint accepts string fields; we set folder name back to
    // empty + leave the encrypted-token columns alone server-side.
    this.api
      .put(`/sites/${id}/ai-settings`, { drive_folder_id: null, drive_folder_name: null })
      .subscribe({
        next: () => {
          this.driveConnected.set(false);
          this.driveFolderId.set(null);
          this.driveFolderName.set(null);
          this.toast.success('Drive disconnected');
        },
        error: () => this.toast.error('Disconnect failed'),
      });
  }

  openFolderPicker(): void {
    this.folderPickerOpen.set(true);
    this.folders.set([]);
    this.folderQuery = '';
    this.loadFolders();
  }

  loadFolders(): void {
    const id = this.siteId();
    if (!id) return;
    this.foldersLoading.set(true);
    this.api
      .post<{ data: DriveFolder[] }>(`/sites/${id}/ai/drive/folders`, { query: this.folderQuery || undefined })
      .subscribe({
        next: (r) => {
          this.folders.set(r.data);
          this.foldersLoading.set(false);
        },
        error: () => {
          this.foldersLoading.set(false);
          this.toast.error('Failed to list folders');
        },
      });
  }

  selectFolder(f: DriveFolder): void {
    const id = this.siteId();
    if (!id) return;
    this.syncing.set(true);
    this.api
      .post<{ data: { added: number; updated: number; removed: number } }>(
        `/sites/${id}/ai/drive/select-folder`,
        { folder_id: f.id, folder_name: f.name },
      )
      .subscribe({
        next: (r) => {
          this.driveFolderId.set(f.id);
          this.driveFolderName.set(f.name);
          this.folderPickerOpen.set(false);
          this.syncing.set(false);
          this.toast.success(`${r.data.added} added · ${r.data.updated} updated · ${r.data.removed} removed`);
          this.loadFiles(id);
        },
        error: () => {
          this.syncing.set(false);
          this.toast.error('Folder select failed');
        },
      });
  }

  resyncDrive(): void {
    const id = this.siteId();
    if (!id) return;
    this.syncing.set(true);
    this.api
      .post<{ data: { added: number; updated: number; removed: number } }>(
        `/sites/${id}/ai/drive/sync`,
        {},
      )
      .subscribe({
        next: (r) => {
          this.syncing.set(false);
          this.toast.success(`${r.data.added} added · ${r.data.updated} updated · ${r.data.removed} removed`);
          this.loadFiles(id);
        },
        error: () => {
          this.syncing.set(false);
          this.toast.error('Re-sync failed');
        },
      });
  }

  openSummary(): void {
    const id = this.siteId();
    if (!id) return;
    this.summaryOpen.set(true);
    this.summaryLoading.set(true);
    this.summaryMarkdown.set('');
    this.api
      .get<{ data: { markdown: string; total_chars: number; file_count: number } }>(
        `/sites/${id}/ai/context/summary`,
      )
      .subscribe({
        next: (r) => {
          this.summaryMarkdown.set(r.data.markdown);
          this.summaryTotalChars.set(r.data.total_chars);
          this.summaryFileCount.set(r.data.file_count);
          this.summaryLoading.set(false);
        },
        error: () => {
          this.summaryLoading.set(false);
          this.toast.error('Failed to load summary');
        },
      });
  }

  copySummary(): void {
    const md = this.summaryMarkdown();
    if (!md) return;
    navigator.clipboard
      .writeText(md)
      .then(() => this.toast.success('Copied markdown'))
      .catch(() => this.toast.error('Copy failed'));
  }

  /** Pretty byte formatter (KB / MB). */
  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
}
