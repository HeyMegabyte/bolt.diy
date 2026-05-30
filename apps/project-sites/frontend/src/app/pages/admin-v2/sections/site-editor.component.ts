/**
 * @module pages/admin-v2/sections/site-editor
 *
 * Per-site Editor route target — intentionally a thin placeholder. The actual
 * bolt.diy editor iframe is owned by {@link AdminV2ShellComponent} so it stays
 * mounted (warm) across section navigation and only re-boots on Project switch.
 * When this route is active the shell shows that warm iframe over the content
 * area and hides the router-outlet, so this component is never visible — it
 * exists only to satisfy the route + drive `routerLinkActive`.
 *
 * Per [[bolt-diy-as-editor-foundation]] (every editor surface extends bolt.diy).
 *
 * @example Routed as `site/editor` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-v2-site-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="h-full" data-testid="v2-site-editor-placeholder"></div>`,
})
export class V2SiteEditorComponent {}
