/**
 * @module pages/admin-v2/sections/sites
 *
 * V2 Sites section — the default child view of the Spartan admin shell. Holds
 * the live site grid extracted from the original shell so the shell can host a
 * `<router-outlet>` instead of embedding one section. Demonstrates the 4-state
 * contract (loading / empty / error / ready) on helm primitives per
 * [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `''` (index) child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type Site } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';

type SitesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sites: Site[] };

@Component({
  selector: 'app-v2-sites',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
  ],
  template: `
    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-loading">
          @for (s of skeletons; track s) {
            <div hlmCard class="h-24 animate-pulse opacity-60"></div>
          }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-error">
          <h3 hlmCardTitle>Couldn't load sites</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (sites().length === 0) {
          <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-empty">
            <h3 hlmCardTitle>No sites yet</h3>
            <p hlmCardDescription class="mt-1">Create your first AI-built website in minutes.</p>
            <button hlmBtn variant="primary" size="sm" class="mt-3">+ Create site</button>
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-site-grid">
            @for (site of sites(); track site.id) {
              <div hlmCard data-testid="v2-site-card">
                <div class="flex items-center justify-between">
                  <h3 hlmCardTitle>{{ site.business_name }}</h3>
                  <span hlmBadge [variant]="badgeVariant(site.status)">{{ site.status }}</span>
                </div>
                <p hlmCardDescription class="mt-1">{{ site.slug }}.projectsites.dev</p>
                <div class="mt-3 flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">
                    @if ($any(site).lighthouse_score != null) {
                      Lighthouse {{ $any(site).lighthouse_score }}
                    } @else {
                      —
                    }
                  </span>
                  <a routerLink="/admin/v2/domains" hlmBtn variant="ghost" size="sm">Open</a>
                </div>
              </div>
            }
          </div>
        }
      }
    }
  `,
})
export class V2SitesComponent {
  private readonly api = inject(ApiService);
  protected readonly skeletons = [0, 1, 2, 3, 4, 5];

  protected readonly state = toSignal(
    this.api.listSites().pipe(
      map((res: { data: Site[] }) => ({ status: 'ready', sites: res.data ?? [] }) as SitesState),
      startWith({ status: 'loading' } as SitesState),
      catchError((e: unknown) =>
        of({
          status: 'error',
          message: (e as { message?: string })?.message ?? 'Network error',
        } as SitesState),
      ),
    ),
    { initialValue: { status: 'loading' } as SitesState },
  );

  protected readonly sites = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.sites : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected reload(): void {
    location.reload();
  }

  protected badgeVariant(status: string): BadgeVariant {
    switch (status) {
      case 'published':
        return 'success';
      case 'building':
        return 'info';
      default:
        return 'neutral';
    }
  }
}
