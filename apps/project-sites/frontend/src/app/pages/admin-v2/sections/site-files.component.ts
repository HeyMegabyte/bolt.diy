/**
 * @module pages/admin-v2/sections/site-files
 *
 * Per-site Files — a SITE-group section (driven by the topbar Project dropdown
 * via {@link V2SiteContextService.selectedSite}) listing the selected site's
 * deployed build assets (`getBuildAssets`): name, type badge, size, open-link.
 * Same dropdown-reactive pattern as the per-site Forms section. 4-state +
 * no-site state on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/files` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  HlmInputDirective,
  type BadgeVariant,
} from '../../../ui';
import { V2SiteContextService } from '../v2-site-context.service';

interface BuildAsset {
  key: string;
  name: string;
  type: string;
  size: number;
  url: string;
}

type FilesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; assets: BuildAsset[] };

@Component({
  selector: 'app-v2-site-files',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    HlmInputDirective,
    RouterModule,
  ],
  template: `
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-files-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to browse its deployed files.</p>
      </div>
    } @else {
      <div class="mb-3">
        <h2 class="text-lg font-semibold text-foreground">Files</h2>
        <p class="text-sm text-muted-foreground">{{ ctx.selectedSite()!.business_name }} — deployed assets</p>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-site-files-loading">
            @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-11 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-files-error">
            <h3 hlmCardTitle>Couldn't load files</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (assets().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-files-empty">
              <p hlmCardDescription>No deployed files yet — files appear after the site builds.</p>
              <a routerLink="/admin/v2/site/editor" hlmBtn variant="primary" size="sm" class="mt-3"
                 data-testid="v2-site-files-cta">Open editor to build →</a>
            </div>
          } @else {
            <div class="flex items-center justify-between gap-3 mb-3">
              <input hlmInput class="max-w-xs h-8" placeholder="Filter files…"
                     [value]="filter()" (input)="onFilter($event)" data-testid="v2-site-files-filter"
                     aria-label="Filter files by name" />
              <span class="text-xs text-muted-foreground tabular-nums">{{ filtered().length }} of {{ assets().length }}</span>
            </div>
            <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-site-files-list">
              @for (a of filtered(); track a.key) {
                <li class="flex items-center gap-3 px-3 py-2 text-sm" data-testid="v2-site-files-row">
                  <span hlmBadge [variant]="typeVariant(a.type)" class="shrink-0 w-16 justify-center">{{ ext(a.name) }}</span>
                  <span class="flex-1 min-w-0 truncate text-foreground font-mono text-xs">{{ a.name }}</span>
                  <span class="text-xs text-muted-foreground shrink-0 tabular-nums">{{ size(a.size) }}</span>
                  @if (a.url) {
                    <a [href]="a.url" target="_blank" rel="noopener noreferrer" hlmBtn variant="ghost" size="sm" class="shrink-0">Open ↗</a>
                  }
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteFilesComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);
  protected readonly filter = signal('');

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getBuildAssets(site.id).pipe(
              map((r) => ({ status: 'ready', assets: (r.data ?? []) as BuildAsset[] }) as FilesState),
              startWith({ status: 'loading' } as FilesState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as FilesState),
              ),
            )
          : of({ status: 'ready', assets: [] } as FilesState),
      ),
    ),
    { initialValue: { status: 'loading' } as FilesState },
  );

  protected readonly assets = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.assets : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });
  protected readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    return q ? this.assets().filter((a) => a.name.toLowerCase().includes(q)) : this.assets();
  });

  protected onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement).value);
  }

  protected ext(name: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : 'file';
  }

  protected typeVariant(type: string): BadgeVariant {
    const t = (type || '').toLowerCase();
    if (t.includes('html')) return 'info';
    if (t.includes('css')) return 'success';
    if (t.includes('javascript') || t.includes('js')) return 'warning';
    if (t.includes('image') || t.includes('png') || t.includes('svg')) return 'neutral';
    return 'neutral';
  }

  protected size(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected reload(): void {
    location.reload();
  }
}
