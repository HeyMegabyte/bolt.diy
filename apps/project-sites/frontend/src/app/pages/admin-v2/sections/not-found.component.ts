/**
 * @module pages/admin-v2/sections/not-found
 *
 * V2 not-found — the wildcard child for unknown `/admin/v2/*` routes. Without it
 * a bad deep-link (or a renamed section) renders a blank outlet inside the shell.
 * Deep-link + refresh safe per [[angular-large-app-supervisor]]; offers a route
 * back to Sites. helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as the `**` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HlmButtonDirective, HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective } from '../../../ui';

@Component({
  selector: 'app-v2-not-found',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HlmButtonDirective, HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective],
  template: `
    <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-not-found">
      <p class="text-4xl font-semibold text-primary tabular-nums">404</p>
      <h3 hlmCardTitle class="mt-2">Section not found</h3>
      <p hlmCardDescription class="mt-1">That cockpit section doesn't exist (or hasn't been ported yet).</p>
      <a routerLink="/admin/v2" hlmBtn variant="primary" size="sm" class="mt-3">Back to Sites</a>
    </div>
  `,
})
export class V2NotFoundComponent {}
