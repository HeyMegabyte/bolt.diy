/**
 * @module pages/admin-v2/sections/media
 *
 * V2 Media section — the media library + uploader. Leverages **Uppy** the lean
 * way: `@uppy/core` (restrictions, progress, retry, dedupe) + `@uppy/xhr-upload`
 * pointed at `POST /api/media/upload` (field `file`, Bearer auth). Native HTML5
 * drag-drop + a file input feed files into Uppy — NO `@uppy/dashboard`, so zero
 * Uppy CSS/font assets reach the bundle. The asset list is a Spartan card grid
 * (kind/status badges, size, date — no inline image preview since the raw
 * endpoint is auth-gated and a bare image tag can't send the Bearer header).
 * Re-fetches on upload complete.
 * 4-state contract per [[spartan-ui-design-system]] + [[media-file-document-supervisor]].
 *
 * @example Routed as the `media` child under `/admin/v2`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';

interface MediaAssetRow {
  id: string;
  kind: string;
  source: string;
  name: string;
  mime: string;
  size_bytes: number;
  status: string;
  created_at: number;
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; assets: MediaAssetRow[] };

const MAX_BYTES = 25 * 1024 * 1024;

@Component({
  selector: 'app-v2-media',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Media</h2>
      <p class="text-sm text-muted-foreground">Upload &amp; manage your org's media library</p>
    </div>

    <!-- Drop zone (native DnD → Uppy) -->
    <div
      class="rounded-xl border-2 border-dashed transition-colors p-8 text-center cursor-pointer"
      [class]="dragging() ? 'border-primary bg-primary/10' : 'border-border bg-card'"
      (click)="fileInput.click()"
      (dragover)="onDragOver($event)"
      (dragleave)="dragging.set(false)"
      (drop)="onDrop($event)"
      role="button"
      tabindex="0"
      (keydown.enter)="fileInput.click()"
      data-testid="v2-media-dropzone"
      aria-label="Upload media — drop files or click to browse"
    >
      <p class="text-sm text-foreground font-medium">Drop files here or click to browse</p>
      <p class="text-xs text-muted-foreground mt-1">Images, video, audio, PDF · up to 25 MB each</p>
      <input #fileInput type="file" multiple class="hidden" (change)="onPick($event)"
             accept="image/*,video/*,audio/*,.pdf" data-testid="v2-media-input" />
    </div>

    @if (uploads().length > 0) {
      <ul class="mt-3 flex flex-col gap-1.5" data-testid="v2-media-uploads">
        @for (u of uploads(); track u.id) {
          <li class="flex items-center gap-3 text-sm">
            <span class="flex-1 truncate text-foreground">{{ u.name }}</span>
            <div class="w-32 h-1.5 rounded bg-card border border-border overflow-hidden">
              <div class="h-full bg-primary" [style.width.%]="u.pct"></div>
            </div>
            <span hlmBadge [variant]="u.error ? 'danger' : u.pct === 100 ? 'success' : 'info'" class="w-20 justify-center">
              {{ u.error ? 'failed' : u.pct === 100 ? 'done' : u.pct + '%' }}
            </span>
          </li>
        }
      </ul>
    }

    <div class="flex items-center justify-between mt-5 mb-2">
      <h3 class="text-sm font-semibold text-foreground">Library</h3>
      <button hlmBtn variant="ghost" size="sm" (click)="reload()" data-testid="v2-media-refresh">Refresh</button>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="v2-media-loading">
          @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-20 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-8 text-center" role="alert" data-testid="v2-media-error">
          <h3 hlmCardTitle>Couldn't load media</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (assets().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-media-empty">
            <p hlmCardDescription>No media yet — drop a file above to get started.</p>
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-media-grid">
            @for (a of assets(); track a.id) {
              <div hlmCard data-testid="v2-media-card">
                <div class="flex items-center justify-between gap-2">
                  <h4 class="text-sm font-medium text-foreground truncate">{{ a.name }}</h4>
                  <span hlmBadge [variant]="kindVariant(a.kind)">{{ a.kind }}</span>
                </div>
                <p hlmCardDescription class="mt-1 text-xs truncate">{{ a.mime }}</p>
                <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{{ size(a.size_bytes) }}</span>
                  <span hlmBadge [variant]="a.status === 'ready' ? 'success' : a.status === 'failed' ? 'danger' : 'info'">{{ a.status }}</span>
                </div>
              </div>
            }
          </div>
        }
      }
    }
  `,
})
export class V2MediaComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dragging = signal(false);
  protected readonly uploads = signal<{ id: string; name: string; pct: number; error: boolean }[]>([]);
  private readonly reloadKey = signal(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Uppy instance
  private uppy: any;

  constructor() {
    this.uppy = new Uppy({
      autoProceed: true,
      restrictions: {
        maxFileSize: MAX_BYTES,
        maxNumberOfFiles: 10,
        allowedFileTypes: ['image/*', 'video/*', 'audio/*', '.pdf'],
      },
    }).use(XHRUpload, {
      endpoint: '/api/media/upload',
      method: 'POST',
      fieldName: 'file',
      formData: true,
      limit: 3,
      headers: (): Record<string, string> => {
        const t = this.auth.getToken();
        return t ? { Authorization: `Bearer ${t}` } : {};
      },
    });

    this.uppy.on('upload-progress', (file: { id: string; name: string } | undefined, prog: { bytesUploaded: number; bytesTotal: number }) => {
      if (!file) return;
      const pct = prog.bytesTotal ? Math.round((prog.bytesUploaded / prog.bytesTotal) * 100) : 0;
      this.upsertUpload(file.id, file.name, pct, false);
    });
    this.uppy.on('upload-success', (file: { id: string; name: string } | undefined) => {
      if (file) this.upsertUpload(file.id, file.name, 100, false);
    });
    this.uppy.on('upload-error', (file: { id: string; name: string } | undefined) => {
      if (file) this.upsertUpload(file.id, file.name, 0, true);
    });
    this.uppy.on('complete', () => {
      this.reload();
      // Clear finished uploads after a beat so the user sees the result.
      setTimeout(() => this.uploads.set(this.uploads().filter((u) => u.error)), 2500);
    });

    this.destroyRef.onDestroy(() => this.uppy?.destroy());
  }

  protected readonly state = toSignal(
    toObservable(this.reloadKey).pipe(
      switchMap(() =>
        this.api.get<{ data: MediaAssetRow[] }>('/media/assets').pipe(
          map((res) => ({ status: 'ready', assets: res.data ?? [] }) as ListState),
          startWith({ status: 'loading' } as ListState),
          catchError((e: unknown) =>
            of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as ListState),
          ),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ListState },
  );

  protected readonly assets = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.assets : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected reload(): void {
    this.reloadKey.update((n) => n + 1);
  }

  private upsertUpload(id: string, name: string, pct: number, error: boolean): void {
    const cur = this.uploads();
    const i = cur.findIndex((u) => u.id === id);
    if (i === -1) this.uploads.set([...cur, { id, name, pct, error }]);
    else {
      const next = cur.slice();
      next[i] = { id, name, pct, error };
      this.uploads.set(next);
    }
  }

  private addFiles(files: FileList | null): void {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        this.uppy.addFile({ name: file.name, type: file.type, data: file });
      } catch {
        /* Uppy throws on restriction violation; surfaced via its own events */
      }
    }
  }

  protected onPick(e: Event): void {
    this.addFiles((e.target as HTMLInputElement).files);
    (e.target as HTMLInputElement).value = '';
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    this.addFiles(e.dataTransfer?.files ?? null);
  }

  protected size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected kindVariant(kind: string): BadgeVariant {
    switch (kind) {
      case 'image':
        return 'info';
      case 'video':
        return 'success';
      case 'audio':
        return 'warning';
      default:
        return 'neutral';
    }
  }
}
