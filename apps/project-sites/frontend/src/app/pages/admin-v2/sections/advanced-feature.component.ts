/**
 * @module pages/admin-v2/sections/advanced-feature
 *
 * V2 Advanced-feature landing — ONE reusable, route-data-driven section for the
 * flag-gated experimental surfaces (Trust Center, Site DNA, Enterprise) whose
 * full UI hasn't been ported to the Spartan cockpit yet. Rather than fake their
 * data (they 404 when their flag is off) or dead-end the nav, it tells the
 * truth: what the feature is, a link to manage its flag, and a link to open the
 * full tool in the classic admin. Honest-by-design per the no-fake-controls
 * rule; reads `title`/`blurb`/`flagKey`/`legacyPath` from the route `data`.
 *
 * @example Routed (with `data`) as `trust-center`, `site-dna`, `enterprise`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { HlmButtonDirective, HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective, HlmBadgeDirective } from '../../../ui';

interface AdvancedFeatureData {
  title: string;
  blurb: string;
  flagKey: string;
  legacyPath: string;
}

@Component({
  selector: 'app-v2-advanced-feature',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HlmButtonDirective, HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective, HlmBadgeDirective],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">{{ d().title }}</h2>
      <p class="text-sm text-muted-foreground">Advanced feature</p>
    </div>

    <div hlmCard class="max-w-xl border-l-2 !border-l-primary/50" data-testid="v2-advanced-feature">
      <div class="flex items-center gap-2">
        <span class="text-lg" aria-hidden="true">✦</span>
        <h3 hlmCardTitle>{{ d().title }}</h3>
        <span hlmBadge variant="warning" class="ml-auto shrink-0">flag-gated</span>
      </div>
      <p hlmCardDescription class="mt-2 leading-relaxed">{{ d().blurb }}</p>
      <p class="mt-2 text-xs text-muted-foreground">
        Its full UI hasn't moved to the new cockpit yet. Manage the rollout flag here, or open the complete tool in the classic admin.
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <a routerLink="/admin/v2/feature-flags" hlmBtn variant="primary" size="sm" data-testid="v2-advanced-flag">
          Manage flag <span class="font-mono opacity-70">{{ d().flagKey }}</span> →
        </a>
        <a [href]="'/admin/' + d().legacyPath" hlmBtn variant="outline" size="sm" data-testid="v2-advanced-legacy"
           [attr.aria-label]="'Open ' + d().title + ' in the classic admin'">Open in classic admin ↗</a>
      </div>
    </div>
  `,
})
export class V2AdvancedFeatureComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly routeData = toSignal(this.route.data.pipe(map((d) => d as Partial<AdvancedFeatureData>)), {
    initialValue: {} as Partial<AdvancedFeatureData>,
  });

  protected readonly d = computed<AdvancedFeatureData>(() => {
    const r = this.routeData();
    return {
      title: r.title ?? 'Advanced feature',
      blurb: r.blurb ?? 'An experimental capability gated behind a feature flag.',
      flagKey: r.flagKey ?? '',
      legacyPath: r.legacyPath ?? '',
    };
  });
}
