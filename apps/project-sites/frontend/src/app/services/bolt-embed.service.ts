/**
 * @module services/bolt-embed
 *
 * @description
 * Owns the lifecycle of the bolt.diy (`editor.projectsites.dev`) iframe so it
 * survives Angular route changes inside `/admin/*`. Without this, every
 * navigation between admin sub-routes destroys + re-mounts the iframe and
 * pays the WebContainer cold-boot tax (~30-60s) again.
 *
 * Architecture:
 * - The iframe element lives inside `AdminComponent`'s template (one
 *   stable parent across all sub-routes).
 * - `AdminEditorComponent` is now a *visibility shell* — it tells the
 *   service to show/hide the iframe and renders the loading veil while
 *   the iframe is still booting.
 * - Pre-boot: as soon as `AdminStateService.selectedSite()` resolves, we
 *   call {@link bootForSite} to start downloading bolt.diy + WebContainer
 *   in the background — even when the user is still on `/admin/forms` or
 *   `/admin/billing`. By the time they click "Editor" the iframe is
 *   already running.
 * - Postmessage protocol mirrors the previous in-component handler
 *   (PS_BOLT_READY / PS_APP_RUNNING / PS_FILES_READY / PS_GENERATION_STATUS).
 */

import { Injectable, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';

const HARD_TIMEOUT_MS = 60_000;
const SOFT_TIMEOUT_MS = 30_000;
const SAVE_TIMEOUT_MS = 30_000;
const EDITOR_BASE = 'https://editor.projectsites.dev';
const ALLOWED_ORIGINS = ['https://editor.projectsites.dev', 'http://localhost:5173'];

export interface BoltEmbedSite {
  readonly id: string;
  readonly slug: string;
  readonly business_name?: string;
}

interface PsMessage {
  readonly type?: string;
  readonly status?: string;
  readonly error?: string;
  readonly message?: string;
  readonly files?: Record<string, string>;
  readonly chat?: { messages: unknown[]; description?: string; exportDate?: string };
}

@Injectable({ providedIn: 'root' })
export class BoltEmbedService {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  /** Sanitized iframe URL — null until a site has been selected. */
  readonly iframeUrl = signal<SafeResourceUrl | null>(null);
  /** True once the iframe has fired PS_APP_RUNNING (or a timeout fallback). */
  readonly editorReady = signal(false);
  /** Human label for the loading veil. */
  readonly loadingStage = signal('Booting bolt.diy');
  /** True while a save-and-deploy round-trip is in flight. */
  readonly saving = signal(false);

  /** The actual `<iframe>` element — registered by `AdminComponent` once it mounts. */
  private iframeEl: HTMLIFrameElement | null = null;
  private currentSlug: string | null = null;
  private currentSite: BoltEmbedSite | null = null;
  private boltReady = false;
  private hardTimeout: ReturnType<typeof setTimeout> | null = null;
  private softTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: ((e: MessageEvent) => void) | null = null;

  /**
   * Called once by `AdminComponent` after its `<iframe #boltFrame>` view child
   * is available. Lets the service read response data + dispatch messages.
   */
  registerIframe(el: HTMLIFrameElement | null): void {
    this.iframeEl = el;
  }

  /**
   * Boot (or rebind) the iframe for a given site. Idempotent — re-calling
   * with the same slug is a no-op so the iframe never reloads when the user
   * switches between admin sub-routes for the same site.
   */
  bootForSite(site: BoltEmbedSite | null): void {
    if (!site) {
      this.teardown();
      return;
    }
    if (this.currentSlug === site.slug) {
      this.currentSite = site;
      return;
    }
    this.currentSite = site;
    this.currentSlug = site.slug;
    this.editorReady.set(false);
    this.boltReady = false;
    this.loadingStage.set('Booting bolt.diy');

    const params = new URLSearchParams({
      embedded: 'true',
      hideHeader: 'true',
      hideDiff: 'true',
      hideDeploy: 'true',
      slug: site.slug,
      importChatFrom: `${window.location.origin}/api/sites/by-slug/${site.slug}/chat`,
    });
    this.iframeUrl.set(
      this.sanitizer.bypassSecurityTrustResourceUrl(`${EDITOR_BASE}/?${params.toString()}`),
    );

    this.attachMessageListener();
    this.clearTimers();
    this.hardTimeout = setTimeout(() => this.dismissVeil('timeout'), HARD_TIMEOUT_MS);
  }

  /**
   * Send the iframe a `PS_REQUEST_FILES` message and wait for `PS_FILES_READY`
   * to upload and deploy. Returns nothing — caller listens to {@link saving}.
   */
  saveAndDeploy(): void {
    const site = this.currentSite;
    const iframe = this.iframeEl;
    if (!iframe?.contentWindow || !site) {
      this.toast.error('Editor not ready');
      return;
    }
    this.saving.set(true);
    iframe.contentWindow.postMessage(
      { type: 'PS_REQUEST_FILES', includeChat: true, correlationId: crypto.randomUUID() },
      '*',
    );
    this.toast.info('Saving files from editor...');
    setTimeout(() => {
      if (this.saving()) {
        this.saving.set(false);
        this.toast.error('Save timed out. The editor may not have responded.');
      }
    }, SAVE_TIMEOUT_MS);
  }

  /**
   * Open the editor in a new tab with the same site context, full-screen.
   * Used by the "Open in new tab" affordance on the editor route.
   */
  openFullscreen(): void {
    if (!this.currentSlug) return;
    window.open(`${EDITOR_BASE}/?slug=${this.currentSlug}`, '_blank', 'noopener,noreferrer');
  }

  /** Tear down everything — called when the user signs out or unselects sites. */
  teardown(): void {
    this.detachMessageListener();
    this.clearTimers();
    this.iframeUrl.set(null);
    this.editorReady.set(false);
    this.currentSlug = null;
    this.currentSite = null;
    this.boltReady = false;
  }

  // ── internals ──────────────────────────────────────────────────

  private dismissVeil(_reason: 'app_running' | 'timeout' | 'soft_timeout'): void {
    if (this.editorReady()) return;
    this.editorReady.set(true);
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.hardTimeout) { clearTimeout(this.hardTimeout); this.hardTimeout = null; }
    if (this.softTimeout) { clearTimeout(this.softTimeout); this.softTimeout = null; }
  }

  private attachMessageListener(): void {
    if (this.messageHandler) return;
    this.messageHandler = (event: MessageEvent): void => {
      if (!ALLOWED_ORIGINS.includes(event.origin)) return;
      const msg = event.data as PsMessage | null;
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('PS_')) return;

      switch (msg.type) {
        case 'PS_BOLT_READY':
          this.boltReady = true;
          this.loadingStage.set('Running Start Application');
          if (!this.softTimeout) {
            this.softTimeout = setTimeout(() => this.dismissVeil('soft_timeout'), SOFT_TIMEOUT_MS);
          }
          break;
        case 'PS_APP_RUNNING':
          this.dismissVeil('app_running');
          break;
        case 'PS_FILES_READY':
          this.uploadFiles(msg.files ?? {}, msg.chat);
          break;
        case 'PS_GENERATION_STATUS':
          if (msg.status === 'complete') {
            this.toast.success('AI generation complete');
            this.saveAndDeploy();
          } else if (msg.status === 'app_ready' || msg.status === 'preview_ready') {
            this.dismissVeil('app_running');
          } else if (msg.status === 'error') {
            this.toast.error('AI generation failed: ' + (msg.error || 'Unknown error'));
          }
          break;
        case 'PS_ERROR':
          this.toast.error('Editor error: ' + (msg.message || 'Unknown error'));
          this.saving.set(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  private detachMessageListener(): void {
    if (!this.messageHandler) return;
    window.removeEventListener('message', this.messageHandler);
    this.messageHandler = null;
  }

  private uploadFiles(
    files: Record<string, string>,
    chat?: { messages: unknown[]; description?: string; exportDate?: string },
  ): void {
    const site = this.currentSite;
    if (!site) {
      this.saving.set(false);
      return;
    }
    const entries = Object.entries(files);
    if (entries.length === 0) {
      this.saving.set(false);
      this.toast.error('No files received from the editor');
      return;
    }
    const fileList = entries.map(([filePath, content]) => ({
      path: filePath.replace(/^\/home\/project\//, ''),
      content,
    }));
    const chatExport = chat || {
      messages: [],
      description: site.business_name ?? site.slug,
      exportDate: new Date().toISOString(),
    };
    this.api.publishFromBolt(site.id, site.slug, fileList, chatExport).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(`Deployed ${fileList.length} files successfully`);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const e = err as { error?: { error?: { message?: string }; message?: string } };
        const message = e?.error?.error?.message || e?.error?.message || 'Unknown error';
        this.toast.error('Deploy failed: ' + message);
      },
    });
  }
}
