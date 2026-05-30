/**
 * @module pages/admin-v2/admin-v2-shell
 *
 * Spartan UI admin shell (Wave C). The first user-visible surface of the
 * Spartan rebuild — a compact black/cyan developer-console shell built from the
 * helm primitives ([[spartan-ui-design-system]]). Lives at the flag-gated
 * `/admin/v2` route; the legacy admin stays the default until this is verified
 * + promoted.
 *
 * Demonstrates the foundation end-to-end: helm tokens (bg-background/card,
 * text-foreground, border-border), helm Button + Card directives, RxJS-first
 * data (`listSites()` → `toSignal`), and the 4-state contract (loading /
 * empty / error / success) per [[angular-large-app-supervisor]].
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type Site } from '../../services/api.service';
import { HlmButtonDirective } from '../../ui/button';
import { HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective } from '../../ui/card';
import { HlmBadgeDirective, type BadgeVariant } from '../../ui/badge';

type SitesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sites: Site[] };

@Component({
  selector: 'app-admin-v2-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HlmButtonDirective, HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective, HlmBadgeDirective],
  host: { 'data-cockpit': 'v2', class: 'block min-h-screen bg-background text-foreground' },
  template: `
    <div class="flex min-h-screen">
      <!-- Sidebar (persistent) -->
      <aside class="w-[232px] shrink-0 border-r border-border bg-card/40 flex flex-col" data-testid="v2-sidebar">
        <div class="h-[56px] flex items-center px-4 border-b border-border">
          <span class="text-sm font-semibold tracking-tight">project<span class="text-primary">sites</span>.dev</span>
          <span class="ml-2 text-[0.6rem] uppercase tracking-wider text-primary border border-border rounded px-1.5 py-0.5">v2</span>
        </div>
        <nav class="flex flex-col gap-0.5 p-2 text-sm" role="navigation">
          @for (item of nav; track item.id) {
            <a [routerLink]="item.link" hlmBtn variant="ghost" size="sm"
               class="justify-start w-full" [attr.data-testid]="'v2-nav-' + item.id">{{ item.label }}</a>
          }
        </nav>
      </aside>

      <!-- Main column -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Top command bar (persistent) -->
        <header class="h-[56px] shrink-0 border-b border-border flex items-center justify-between px-5 bg-background/80 backdrop-blur sticky top-0 z-10" data-testid="v2-topbar">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <span class="text-foreground font-medium">Sites</span>
            <span class="opacity-40">·</span>
            <span>Spartan UI</span>
          </div>
          <div class="flex items-center gap-2">
            <button hlmBtn variant="outline" size="sm" data-testid="v2-search">⌘K Search</button>
            <button hlmBtn variant="primary" size="sm" data-testid="v2-create">+ New site</button>
          </div>
        </header>

        <!-- Content (the routed sub-view in the real app; here: live site grid) -->
        <main class="flex-1 p-5">
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
                <p hlmCardDescription class="mt-1">{{ state().status === 'error' ? errMsg() : '' }}</p>
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
                          @if ($any(site).lighthouse_score != null) { Lighthouse {{ $any(site).lighthouse_score }} } @else { — }
                        </span>
                        <a routerLink="/admin/v2" hlmBtn variant="ghost" size="sm">Open</a>
                      </div>
                    </div>
                  }
                </div>
              }
            }
          }
        </main>
      </div>
    </div>
  `,
})
export class AdminV2ShellComponent {
  private readonly api = inject(ApiService);
  protected readonly skeletons = [0, 1, 2, 3, 4, 5];
  // Sub-routes land in later waves; until then every nav item targets the
  // working shell route so there are zero broken links.
  protected readonly nav = [
    { id: 'sites', label: 'Sites', link: '/admin/v2' },
    { id: 'analytics', label: 'Analytics', link: '/admin/v2' },
    { id: 'domains', label: 'Domains', link: '/admin/v2' },
    { id: 'settings', label: 'Settings', link: '/admin/v2' },
  ];

  protected readonly state = toSignal(
    this.api.listSites().pipe(
      map((res: { data: Site[] }) => ({ status: 'ready', sites: res.data ?? [] }) as SitesState),
      startWith({ status: 'loading' } as SitesState),
      catchError((e: unknown) =>
        of({
          status: 'error',
          message: (e as { message?: string })?.message ?? 'Network error',
        } as SitesState)),
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
      case 'published': return 'success';
      case 'building': return 'info';
      default: return 'neutral';
    }
  }
}
