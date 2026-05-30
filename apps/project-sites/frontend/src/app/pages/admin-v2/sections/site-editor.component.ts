/**
 * @module pages/admin-v2/sections/site-editor
 *
 * Per-site Editor — the SITE-group centerpiece. Embeds the bolt.diy editor
 * (`editor.projectsites.dev`) for the Project selected in the topbar dropdown
 * ({@link V2SiteContextService.selectedSite}), using the same embed params as
 * the legacy {@link BoltEmbedService} (`embedded/hideHeader/hideDiff/hideDeploy/
 * slug/importChatFrom`). The editor self-authenticates via its own session.
 *
 * NOTE: this mounts a fresh iframe per Project (re-boots WebContainer on switch);
 * the legacy warm-persistent-iframe optimization (BoltEmbedService living in the
 * shell) is a follow-up. Functional + driven by the dropdown today. Per
 * [[bolt-diy-as-editor-foundation]] (every editor surface extends bolt.diy).
 *
 * @example Routed as `site/editor` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective } from '../../../ui';
import { V2SiteContextService } from '../v2-site-context.service';

const EDITOR_BASE = 'https://editor.projectsites.dev';

@Component({
  selector: 'app-v2-site-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective],
  // Pull the editor flush to the chrome — it wants the whole content area.
  host: { class: 'block -m-5 h-[calc(100vh-56px)]' },
  template: `
    @if (!ctx.selectedSite()) {
      <div class="h-full flex items-center justify-center p-5">
        <div hlmCard class="max-w-md text-center" data-testid="v2-site-editor-nosite">
          <h3 hlmCardTitle>No site selected</h3>
          <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to open it in the editor.</p>
        </div>
      </div>
    } @else if (editorUrl(); as url) {
      <iframe
        [src]="url"
        title="Site editor"
        class="w-full h-full border-0 bg-background"
        allow="clipboard-read; clipboard-write; microphone"
        data-testid="v2-site-editor-iframe"></iframe>
    }
  `,
})
export class V2SiteEditorComponent {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly ctx = inject(V2SiteContextService);

  /** Sanitized editor URL for the selected Project — rebuilds on switch. */
  protected readonly editorUrl = computed<SafeResourceUrl | null>(() => {
    const site = this.ctx.selectedSite();
    if (!site) return null;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://projectsites.dev';
    const params = new URLSearchParams({
      embedded: 'true',
      hideHeader: 'true',
      hideDiff: 'true',
      hideDeploy: 'true',
      slug: site.slug,
      importChatFrom: `${origin}/api/sites/by-slug/${site.slug}/chat`,
    });
    return this.sanitizer.bypassSecurityTrustResourceUrl(`${EDITOR_BASE}/?${params.toString()}`);
  });
}
