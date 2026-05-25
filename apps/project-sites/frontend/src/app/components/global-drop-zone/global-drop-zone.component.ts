/**
 * GlobalDropZoneComponent — admin-shell-wide drag-and-drop file upload surface.
 *
 * @remarks
 * Listens to window `dragenter`/`dragover`/`dragleave`/`drop` and reveals a
 * fullscreen overlay when files are dragged anywhere over the admin chrome.
 * On drop, each file is POSTed to `/api/media/upload` as multipart FormData;
 * progress is surfaced via {@link ToastService}. After all uploads complete
 * the router navigates to `/admin/media` so the user lands in the Library
 * with their new assets — unless we're already on `/admin/media`, in which
 * case we fire a `window.dispatchEvent(new CustomEvent('ps:media:refresh'))`
 * so the Library tab picks them up without a route change.
 *
 * Ignores any drag whose `dataTransfer.types` doesn't include `'Files'` —
 * dragging text/links/HTML never triggers the overlay.
 *
 * @example
 * ```html
 * <app-global-drop-zone />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/** Window-level events the overlay listens to. */
const DRAG_EVENTS = ['dragenter', 'dragover', 'dragleave', 'drop'] as const;

/** Window-level event the Media section listens to when it should refresh. */
const REFRESH_EVENT = 'ps:media:refresh';

@Component({
  selector: 'app-global-drop-zone',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div
        class="gdz-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gdz-title"
        aria-describedby="gdz-help"
      >
        <div class="gdz-card">
          <div class="gdz-glyph" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.4"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h2 id="gdz-title" class="gdz-title">Drop files to add to Media</h2>
          <p id="gdz-help" class="gdz-help">
            @if (fileCount() > 0) {
              {{ fileCount() }} {{ fileCount() === 1 ? 'file' : 'files' }} ready to upload
            } @else {
              Images, videos, audio, and documents are all welcome
            }
          </p>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .gdz-overlay {
        position: fixed; inset: 0;
        /* One below the takeover layer so modal-takeover dialogs still win. */
        z-index: calc(var(--ps-z-overlay-takeover, 100000) - 1);
        background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent);
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        display: grid; place-items: center;
        animation: gdz-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1);
        padding: 1.5rem;
      }
      .gdz-card {
        display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
        padding: 2.25rem 2.5rem;
        border: 2px dashed color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
        border-radius: var(--ps-radius-xl, 22px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 80%, transparent);
        box-shadow: var(--ps-shadow-modal, 0 24px 80px rgba(0, 0, 0, 0.55));
        color: var(--ps-ink, #f4f4ff);
        max-width: min(560px, 100%);
        text-align: center;
        animation: gdz-pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .gdz-glyph {
        display: grid; place-items: center;
        width: 84px; height: 84px;
        border-radius: 50%;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        color: var(--ps-accent, #00e5ff);
      }
      .gdz-title {
        font: 700 1.35rem/1.2 'Sora', system-ui, sans-serif;
        margin: 0; letter-spacing: -0.02em;
        color: var(--ps-ink, #f4f4ff);
      }
      .gdz-help {
        font-size: 0.88rem; line-height: 1.45; margin: 0;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
      }
      @keyframes gdz-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes gdz-pop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .gdz-overlay, .gdz-card { animation: none !important; }
      }
    `,
  ],
})
export class GlobalDropZoneComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** Overlay visibility — flips true while the user drags files over the page. */
  readonly visible = signal(false);
  /** Number of items in the active drag (best-effort — browsers only fill this on dragenter). */
  readonly fileCount = signal(0);

  /** Counter incremented on dragenter, decremented on dragleave. We're "in" while > 0. */
  private dragDepth = 0;

  /** Pre-bound handler so add+remove use the same reference. */
  private readonly onDragEnter = (e: DragEvent): void => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.fileCount.set(e.dataTransfer?.items?.length ?? 0);
    this.visible.set(true);
  };
  private readonly onDragOver = (e: DragEvent): void => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  private readonly onDragLeave = (e: DragEvent): void => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.visible.set(false);
  };
  private readonly onDrop = async (e: DragEvent): Promise<void> => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.visible.set(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    await this.uploadFiles(Array.from(files));
  };

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('dragenter', this.onDragEnter);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('drop', this.onDrop);
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('dragenter', this.onDragEnter);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('dragleave', this.onDragLeave);
    window.removeEventListener('drop', this.onDrop);
  }

  /** True when the drag payload actually contains files (not just text/links). */
  private hasFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // `types` is a DOMStringList in older browsers; both expose `contains` /
    // iteration. Coerce to array for a simple includes check.
    return Array.from(types).includes('Files');
  }

  /**
   * Upload each file sequentially (most browsers cap parallel multipart POSTs
   * to ~6 anyway, and sequential keeps toast feedback legible). After all
   * uploads finish, navigate to /admin/media — unless we're already there,
   * in which case dispatch a refresh event the Media section listens for.
   */
  private async uploadFiles(files: File[]): Promise<void> {
    const total = files.length;
    let succeeded = 0;
    let failed = 0;

    const pendingToastId = this.toast.info(
      total === 1 ? `Uploading ${files[0].name}…` : `Uploading ${total} files…`,
      { duration: 0 },
    );

    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        await new Promise<void>((resolve, reject) => {
          this.api.postFormData<{ data?: unknown }>('/media/upload', fd).subscribe({
            next: () => resolve(),
            error: (err: Error) => reject(err),
          });
        });
        succeeded++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : 'Upload failed';
        // eslint-disable-next-line no-console
        console.warn('[global-drop-zone] upload failed:', file.name, msg);
      }
    }

    this.toast.dismiss(pendingToastId);

    if (succeeded > 0 && failed === 0) {
      this.toast.success(
        succeeded === 1 ? 'Uploaded 1 file' : `Uploaded ${succeeded} files`,
      );
    } else if (succeeded > 0 && failed > 0) {
      this.toast.warning(`Uploaded ${succeeded}, ${failed} failed`);
    } else {
      this.toast.error(
        failed === 1 ? 'Upload failed' : `${failed} uploads failed`,
      );
    }

    if (succeeded === 0) return;

    const currentUrl = this.router.url.split('?')[0];
    if (currentUrl === '/admin/media') {
      // Already on the Media route — let the section refresh itself.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
      }
    } else {
      void this.router.navigate(['/admin/media']);
    }
  }
}
