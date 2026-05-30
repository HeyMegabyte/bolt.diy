/**
 * @module pages/admin-v2/sections/sites
 *
 * V2 Sites section — the default child view of the Spartan admin shell. A dense,
 * sortable, filterable cockpit table powered by **TanStack Table** (headless,
 * `@tanstack/angular-table` v8) over the live `listSites()` stream. The dev-
 * console aesthetic wants a sortable table, not a card grid; TanStack supplies
 * sort + global-filter logic while we render rows manually so the status column
 * stays a helm badge. 4-state contract (loading / empty / error / ready) on helm
 * primitives per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `''` (index) child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import {
  createAngularTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
  type Updater,
} from '@tanstack/angular-table';
import { ApiService, type Site } from '../../../services/api.service';
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
    HlmInputDirective,
    HlmBadgeDirective,
    RelativeDatePipe,
  ],
  template: `
    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-loading">
          @for (s of skeletons; track s) {
            <div hlmCard class="h-16 animate-pulse opacity-60"></div>
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
        @if (rows().length === 0) {
          <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-empty">
            <h3 hlmCardTitle>No sites yet</h3>
            <p hlmCardDescription class="mt-1">Create your first AI-built website in minutes.</p>
            <button hlmBtn variant="primary" size="sm" class="mt-3">+ Create site</button>
          </div>
        } @else {
          <div class="flex items-center justify-between gap-3 mb-3">
            <input hlmInput class="max-w-xs h-8" placeholder="Filter sites…"
                   [value]="filter()" (input)="onFilter($event)" data-testid="v2-sites-filter"
                   aria-label="Filter sites by name or domain" />
            <span class="text-xs text-muted-foreground tabular-nums">
              {{ table.getRowModel().rows.length }} of {{ rows().length }}
            </span>
          </div>

          <div hlmCard class="p-0 overflow-hidden" data-testid="v2-site-table">
            <table class="w-full text-sm border-collapse">
              <thead class="border-b border-border bg-card/60">
                @for (hg of table.getHeaderGroups(); track hg.id) {
                  <tr>
                    @for (header of hg.headers; track header.id) {
                      <th scope="col" class="text-left font-medium text-muted-foreground px-3 py-2 select-none"
                          [class.cursor-pointer]="header.column.getCanSort()"
                          (click)="header.column.getToggleSortingHandler()?.($event)"
                          [attr.aria-sort]="ariaSort(header.column.getIsSorted())">
                        <span class="inline-flex items-center gap-1">
                          {{ labels[header.column.id] }}
                          @if (header.column.getIsSorted() === 'asc') { <span class="text-primary">▲</span> }
                          @else if (header.column.getIsSorted() === 'desc') { <span class="text-primary">▼</span> }
                        </span>
                      </th>
                    }
                  </tr>
                }
              </thead>
              <tbody>
                @for (row of table.getRowModel().rows; track row.id) {
                  <tr class="border-b border-border/50 hover:bg-primary/5 transition-colors" data-testid="v2-site-row">
                    <td class="px-3 py-2 font-medium text-foreground">{{ row.original.business_name }}</td>
                    <td class="px-3 py-2 text-muted-foreground">{{ row.original.slug }}.projectsites.dev</td>
                    <td class="px-3 py-2">
                      <span hlmBadge [variant]="badgeVariant(row.original.status)">{{ row.original.status }}</span>
                    </td>
                    <td class="px-3 py-2 text-muted-foreground">{{ row.original.plan || '—' }}</td>
                    <td class="px-3 py-2 text-muted-foreground tabular-nums" [title]="shortDate(row.original.created_at)">{{ row.original.created_at | relativeDate }}</td>
                    <td class="px-3 py-2 text-right">
                      <a [routerLink]="['/admin/v2/sites', row.original.id]" hlmBtn variant="ghost" size="sm">Open</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
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

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.sites : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected readonly sorting = signal<SortingState>([{ id: 'business_name', desc: false }]);
  protected readonly filter = signal('');

  /** Human header labels keyed by column id (type-safe vs columnDef.header union). */
  protected readonly labels: Record<string, string> = {
    business_name: 'Site',
    slug: 'Domain',
    status: 'Status',
    plan: 'Plan',
    created_at: 'Created',
  };

  private readonly columns: ColumnDef<Site>[] = [
    { accessorKey: 'business_name' },
    { accessorKey: 'slug' },
    { accessorKey: 'status' },
    { accessorKey: 'plan' },
    { accessorKey: 'created_at' },
  ];

  protected readonly table = createAngularTable<Site>(() => ({
    data: this.rows(),
    columns: this.columns,
    state: { sorting: this.sorting(), globalFilter: this.filter() },
    onSortingChange: (u: Updater<SortingState>) =>
      this.sorting.set(typeof u === 'function' ? u(this.sorting()) : u),
    onGlobalFilterChange: (u: Updater<string>) =>
      this.filter.set(typeof u === 'function' ? u(this.filter()) : u),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  }));

  protected onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement).value);
  }

  protected ariaSort(dir: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
    return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
  }

  protected shortDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected reload(): void {
    location.reload();
  }

  protected badgeVariant(status: string): BadgeVariant {
    switch (status) {
      case 'published':
        return 'success';
      case 'building':
      case 'generating':
        return 'info';
      case 'error':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
