/**
 * @module pages/admin-v2/sections/overview
 *
 * V2 Overview (SYS-ADMIN, org-wide) — the cockpit command center. Aggregates
 * already-clean endpoints via `forkJoin` (sites · API-surface docs stats · apps
 * · feature flags) into animated stat cards (`<app-rolling-counter>`), a live
 * "building now" pulse, a needs-attention strip for error sites, and quick-nav
 * tiles into the busiest sections. No new backend, no flag gates, no fake
 * controls — every number is real. 4-state on helm primitives per
 * [[spartan-ui-design-system]] + [[cinematic-ui-patterns]] (counters animate).
 *
 * @example Routed as the `overview` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith } from 'rxjs';
import { ApiService, type Site, type DocsStats, type AppInstance, type FeatureFlag } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
} from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';

interface OverviewData {
  sites: Site[];
  docs: DocsStats | null;
  apps: AppInstance[];
  flags: FeatureFlag[];
}
type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: OverviewData };

interface QuickLink {
  label: string;
  link: string;
  hint: string;
}

@Component({
  selector: 'app-v2-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RollingCounterComponent,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Overview</h2>
      <p class="text-sm text-muted-foreground">Your org at a glance</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="v2-overview-loading">
          @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-24 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-overview-error">
          <h3 hlmCardTitle>Couldn't load overview</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <!-- Stat cards -->
        <section class="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="v2-overview-stats">
          @for (stat of stats(); track stat.label) {
            <div hlmCard>
              <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">{{ stat.label }}</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                <app-rolling-counter [value]="stat.value" />
                @if (stat.label === 'Building' && stat.value > 0) {
                  <span class="ml-2 inline-block h-2 w-2 rounded-full bg-primary animate-pulse motion-reduce:animate-none align-middle" aria-hidden="true"></span>
                }
              </p>
            </div>
          }
        </section>

        <!-- Needs attention -->
        @if (errorSites().length > 0) {
          <div hlmCard class="mt-3 border-l-2 !border-l-[#ff4d6d]" data-testid="v2-overview-attention">
            <h3 hlmCardTitle class="flex items-center gap-2">
              <span class="h-1.5 w-1.5 rounded-full bg-[#ff4d6d]" aria-hidden="true"></span>
              Needs attention
            </h3>
            <ul class="mt-2 flex flex-col gap-1.5">
              @for (s of errorSites(); track s.id) {
                <li class="flex items-center gap-3 text-sm">
                  <a [routerLink]="['/admin/v2/sites', s.id]" class="text-foreground hover:text-primary transition-colors truncate">{{ s.business_name }}</a>
                  <span class="text-muted-foreground truncate">{{ s.slug }}.projectsites.dev</span>
                  <span class="flex-1"></span>
                  <span hlmBadge variant="danger" class="shrink-0">{{ s.status }}</span>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Quick nav -->
        <h3 class="mt-4 mb-2 text-sm font-semibold text-foreground">Jump to</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid="v2-overview-quicklinks">
          @for (q of quickLinks; track q.link) {
            <a [routerLink]="q.link" hlmCard
               class="group block transition-colors hover:border-primary/40 hover:bg-primary/5"
               [attr.data-testid]="'v2-overview-link-' + q.link.split('/').pop()">
              <p class="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{{ q.label }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ q.hint }}</p>
            </a>
          }
        </div>
      }
    }
  `,
})
export class V2OverviewComponent {
  private readonly api = inject(ApiService);

  protected readonly quickLinks: QuickLink[] = [
    { label: 'Sites', link: '/admin/v2', hint: 'Manage every site' },
    { label: 'Analytics', link: '/admin/v2/analytics', hint: 'Totals & status' },
    { label: 'Cost', link: '/admin/v2/cost', hint: 'AI build spend' },
    { label: 'Apps', link: '/admin/v2/apps', hint: 'Installed apps' },
    { label: 'Social', link: '/admin/v2/social', hint: 'Accounts & posts' },
    { label: 'Audit', link: '/admin/v2/audit', hint: 'Activity log' },
    { label: 'Feature Flags', link: '/admin/v2/feature-flags', hint: 'Gated capabilities' },
    { label: 'Docs', link: '/admin/v2/docs', hint: 'API surface' },
  ];

  protected readonly state = toSignal(
    forkJoin({
      sites: this.api.listSites().pipe(catchError(() => of({ data: [] as Site[] }))),
      docs: this.api.getDocsStats().pipe(
        map((r) => r.data),
        catchError(() => of(null as DocsStats | null)),
      ),
      apps: this.api.getAppInstances().pipe(catchError(() => of({ instances: [] as AppInstance[] }))),
      flags: this.api.getFeatureFlags().pipe(catchError(() => of({ flags: [] as FeatureFlag[], count: 0 }))),
    }).pipe(
      map(
        (r) =>
          ({
            status: 'ready',
            data: { sites: r.sites.data ?? [], docs: r.docs, apps: r.apps.instances ?? [], flags: r.flags.flags ?? [] },
          }) as OverviewState,
      ),
      startWith({ status: 'loading' } as OverviewState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as OverviewState),
      ),
    ),
    { initialValue: { status: 'loading' } as OverviewState },
  );

  private readonly data = computed<OverviewData | null>(() => {
    const s = this.state();
    return s.status === 'ready' ? s.data : null;
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  private readonly sites = computed(() => this.data()?.sites ?? []);
  protected readonly errorSites = computed(() => this.sites().filter((s) => s.status === 'error'));

  protected readonly stats = computed(() => {
    const d = this.data();
    const sites = this.sites();
    const building = sites.filter((s) => s.status === 'building' || s.status === 'generating').length;
    const published = sites.filter((s) => s.status === 'published').length;
    const apiCount = d?.docs ? d.docs.public + d.docs.authed : 0;
    return [
      { label: 'Sites', value: sites.length },
      { label: 'Published', value: published },
      { label: 'Building', value: building },
      { label: 'Installed apps', value: d?.apps.length ?? 0 },
      { label: 'API endpoints', value: apiCount },
      { label: 'Feature flags', value: d?.flags.length ?? 0 },
      { label: 'Needs attention', value: this.errorSites().length },
      { label: 'Rate-limited APIs', value: d?.docs?.rate_limited ?? 0 },
    ];
  });

  protected reload(): void {
    location.reload();
  }
}
