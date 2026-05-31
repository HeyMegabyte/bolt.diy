/**
 * @module pages/admin-v2/sections/apps
 *
 * V2 Apps section (SYS-ADMIN, org-wide) — mirrors the legacy admin Apps tab:
 * the full **app catalog** (~68 self-hostable apps via `getAppCatalog()`,
 * searchable + category-filterable) as the primary browse surface, plus the
 * org's **installed instances** (`getAppInstances()`) below. Loaded together
 * via `forkJoin`. Catalog cards show name · tagline · category · bootable badge;
 * instance rows show subdomain link · status · last-started. 4-state on helm
 * primitives per [[spartan-ui-design-system]]. (Earlier this section showed only
 * instances — the 50+ catalog is the content Brian flagged as missing.)
 *
 * @example Routed as the `apps` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith } from 'rxjs';
import { ApiService, type CatalogApp, type AppInstance } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmInputDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type AppsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: CatalogApp[]; instances: AppInstance[] };

@Component({
  selector: 'app-v2-apps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmInputDirective,
    HlmBadgeDirective,
    RelativeDatePipe,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Apps</h2>
      <p class="text-sm text-muted-foreground">Install self-hostable apps on your own subdomains</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-apps-loading">
          @for (s of [0,1,2,3,4,5]; track s) { <div hlmCard class="h-24 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-apps-error">
          <h3 hlmCardTitle>Couldn't load apps</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <!-- Installed instances first (if any) -->
        @if (instances().length > 0) {
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground">Installed</h3>
            <span class="text-xs text-muted-foreground tabular-nums">{{ instances().length }}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5" data-testid="v2-apps-instances">
            @for (app of instances(); track app.id) {
              <div hlmCard data-testid="v2-apps-instance">
                <div class="flex items-center justify-between gap-2">
                  <h4 class="text-sm font-medium text-foreground truncate">{{ app.app_slug }}</h4>
                  <span hlmBadge [variant]="instanceVariant(app.status)" class="shrink-0">{{ app.status }}</span>
                </div>
                <a [href]="'https://' + app.subdomain + '.app.projectsites.dev'" target="_blank" rel="noopener noreferrer"
                   class="mt-1 block font-mono text-xs text-primary/80 hover:text-primary truncate transition-colors">{{ app.subdomain }}.app.projectsites.dev ↗</a>
                @if (app.last_error) { <p class="mt-1 text-xs text-[#ff7d96] truncate" [title]="app.last_error">{{ app.last_error }}</p> }
                <p class="mt-2 text-xs text-muted-foreground tabular-nums">{{ app.last_started_at ? 'Started' : 'Created' }} {{ (app.last_started_at || app.created_at) | relativeDate }}</p>
              </div>
            }
          </div>
        }

        <!-- Catalog -->
        <div class="flex items-center justify-between gap-3 mb-3">
          <h3 class="text-sm font-semibold text-foreground">Catalog</h3>
          <input hlmInput class="max-w-xs h-8" placeholder="Search apps…"
                 [value]="filter()" (input)="onFilter($event)" data-testid="v2-apps-filter"
                 aria-label="Search the app catalog" />
        </div>

        <!-- Category pills -->
        <div class="flex flex-wrap gap-1.5 mb-3" data-testid="v2-apps-categories">
          @for (cat of categories(); track cat) {
            <button hlmBtn size="sm" [variant]="category() === cat ? 'primary' : 'ghost'"
                    (click)="category.set(cat)" class="capitalize"
                    [attr.aria-pressed]="category() === cat"
                    [attr.data-testid]="'v2-apps-cat-' + cat">{{ cat }}</button>
          }
        </div>

        @if (filteredCatalog().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-apps-catalog-empty">
            <p hlmCardDescription>No apps match this filter.</p>
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-apps-catalog">
            @for (app of filteredCatalog(); track app.id) {
              <div hlmCard class="flex flex-col" data-testid="v2-apps-catalog-card">
                <div class="flex items-start justify-between gap-2">
                  <h4 class="text-sm font-medium text-foreground truncate">{{ app.name }}</h4>
                  @if (app.supported) {
                    <span hlmBadge variant="success" class="shrink-0">bootable</span>
                  } @else {
                    <span hlmBadge variant="neutral" class="shrink-0">soon</span>
                  }
                </div>
                @if (app.tagline) { <p hlmCardDescription class="mt-1 text-xs line-clamp-2">{{ app.tagline }}</p> }
                <div class="mt-auto pt-3 flex items-center justify-between">
                  <span hlmBadge variant="info" class="capitalize">{{ app.category }}</span>
                  <span class="font-mono text-[0.65rem] text-muted-foreground">{{ app.id }}</span>
                </div>
              </div>
            }
          </div>
          <p class="mt-3 text-xs text-muted-foreground tabular-nums" data-testid="v2-apps-count">
            {{ filteredCatalog().length }} of {{ catalog().length }} apps
          </p>
        }
      }
    }
  `,
})
export class V2AppsComponent {
  private readonly api = inject(ApiService);
  protected readonly filter = signal('');
  protected readonly category = signal<string>('all');

  protected readonly state = toSignal(
    forkJoin({
      catalog: this.api.getAppCatalog().pipe(catchError(() => of({ apps: [] as CatalogApp[], count: 0 }))),
      instances: this.api.getAppInstances().pipe(catchError(() => of({ instances: [] as AppInstance[] }))),
    }).pipe(
      map((r) => ({ status: 'ready', catalog: r.catalog.apps ?? [], instances: r.instances.instances ?? [] }) as AppsState),
      startWith({ status: 'loading' } as AppsState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as AppsState),
      ),
    ),
    { initialValue: { status: 'loading' } as AppsState },
  );

  protected readonly catalog = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.catalog : [];
  });
  protected readonly instances = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.instances : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  /** Distinct categories (with 'all' first) for the filter pills. */
  protected readonly categories = computed(() => {
    const cats = new Set<string>();
    for (const a of this.catalog()) cats.add(a.category);
    return ['all', ...Array.from(cats).sort()];
  });

  protected readonly filteredCatalog = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const cat = this.category();
    return this.catalog()
      .filter((a) => (cat === 'all' ? true : a.category === cat))
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          (a.tagline ?? '').toLowerCase().includes(q),
      );
  });

  protected onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement).value);
  }

  protected instanceVariant(status: string): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('running') || s.includes('active') || s.includes('healthy')) return 'success';
    if (s.includes('error') || s.includes('failed') || s.includes('crash')) return 'danger';
    if (s.includes('boot') || s.includes('provision') || s.includes('pending') || s.includes('starting')) return 'warning';
    if (s.includes('hibern') || s.includes('idle') || s.includes('stopped')) return 'info';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
