/**
 * @module pages/admin-v2/admin-v2-shell
 *
 * Spartan UI admin shell — persistent chrome (sidebar + top command bar)
 * wrapping a `<router-outlet>`; child sections lazy-load and swap without
 * re-mounting, so internal nav never full-reloads per [[angular-large-app-supervisor]].
 *
 * IA (matches projectsites.dev/admin): the topbar carries a **Project dropdown**
 * (select site) + **URL dropdown** (select that site's hostname) backed by
 * {@link V2SiteContextService} — the per-site editor sections operate on the
 * selected site. The sidebar groups org-wide surfaces under a **SYS-ADMIN**
 * header; per-site editor sections sit under **SITE**. `Meta/Ctrl+K` opens the
 * command palette; `+ New site` routes to create.
 */
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { HlmButtonDirective } from '../../ui/button';
import { HlmInputDirective } from '../../ui/input';
import { CommandPaletteComponent } from '../../components/command-palette/command-palette.component';
import { V2NotifBellComponent } from './sections/notif-bell.component';
import { V2SiteContextService } from './v2-site-context.service';

interface NavItem {
  id: string;
  label: string;
  link: string;
  exact: boolean;
}

@Component({
  selector: 'app-admin-v2-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HlmButtonDirective, HlmInputDirective, CommandPaletteComponent, V2NotifBellComponent],
  host: { 'data-cockpit': 'v2', class: 'block min-h-screen bg-background text-foreground' },
  template: `
    <div class="flex min-h-screen">
      <!-- Sidebar (persistent) -->
      <aside class="w-[232px] shrink-0 border-r border-border bg-card/40 flex flex-col" data-testid="v2-sidebar">
        <div class="h-[56px] flex items-center px-4 border-b border-border">
          <span class="text-sm font-semibold tracking-tight">project<span class="text-primary">sites</span>.dev</span>
          <span class="ml-2 text-[0.6rem] uppercase tracking-wider text-primary border border-border rounded px-1.5 py-0.5">v2</span>
        </div>
        <nav class="flex flex-col gap-0.5 p-2 text-sm overflow-y-auto" role="navigation">
          <p class="px-2 pt-1 pb-1 text-[0.6rem] uppercase tracking-wider text-muted-foreground/70">Site</p>
          @for (item of siteNav; track item.id) {
            <a [routerLink]="item.link"
               routerLinkActive="bg-primary/10 text-primary"
               [routerLinkActiveOptions]="{ exact: item.exact }"
               hlmBtn variant="ghost" size="sm" class="justify-start w-full"
               [attr.data-testid]="'v2-nav-' + item.id">{{ item.label }}</a>
          }
          <p class="px-2 pt-3 pb-1 text-[0.6rem] uppercase tracking-wider text-muted-foreground/70">Sys-admin</p>
          @for (item of sysNav; track item.id) {
            <a [routerLink]="item.link"
               routerLinkActive="bg-primary/10 text-primary"
               [routerLinkActiveOptions]="{ exact: item.exact }"
               hlmBtn variant="ghost" size="sm" class="justify-start w-full"
               [attr.data-testid]="'v2-nav-' + item.id">{{ item.label }}</a>
          }
        </nav>
      </aside>

      <!-- Main column -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Top command bar (persistent) — Project + URL switchers -->
        <header class="h-[56px] shrink-0 border-b border-border flex items-center justify-between gap-3 px-5 bg-background/80 backdrop-blur sticky top-0 z-10" data-testid="v2-topbar">
          <div class="flex items-center gap-2 min-w-0">
            <label class="sr-only" for="v2-project">Project</label>
            <select hlmInput id="v2-project" class="h-8 max-w-[220px] text-sm" data-testid="v2-project-select"
                    [value]="ctx.selectedSite()?.id ?? ''" (change)="onProject($event)"
                    [disabled]="ctx.sites().length === 0">
              @if (ctx.sites().length === 0) { <option value="">No sites</option> }
              @for (s of ctx.sites(); track s.id) {
                <option [value]="s.id">{{ s.business_name || s.slug }}</option>
              }
            </select>
            @if (ctx.urls().length > 0) {
              <span class="text-muted-foreground opacity-50">/</span>
              <label class="sr-only" for="v2-url">URL</label>
              <select hlmInput id="v2-url" class="h-8 max-w-[240px] text-sm" data-testid="v2-url-select"
                      [value]="ctx.selectedUrl()?.id ?? ''" (change)="onUrl($event)">
                @for (u of ctx.urls(); track u.id) {
                  <option [value]="u.id">{{ u.hostname }}{{ u.is_primary ? ' ★' : '' }}</option>
                }
              </select>
            } @else if (ctx.selectedSite(); as s) {
              <span class="text-muted-foreground opacity-50">/</span>
              <span class="text-sm text-muted-foreground truncate">{{ s.slug }}.projectsites.dev</span>
            }
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button hlmBtn variant="outline" size="sm" data-testid="v2-search" (click)="openPalette()">⌘K</button>
            <app-v2-notif-bell />
            <button hlmBtn variant="primary" size="sm" data-testid="v2-create" (click)="newSite()">+ New site</button>
          </div>
        </header>

        <main class="flex-1 p-5" data-testid="v2-outlet">
          <router-outlet />
        </main>
      </div>
    </div>

    @if (showPalette()) {
      <app-command-palette (closed)="showPalette.set(false)" />
    }
  `,
})
export class AdminV2ShellComponent {
  private readonly router = inject(Router);
  protected readonly ctx = inject(V2SiteContextService);

  /** Per-site editor surfaces (operate on the selected Project). */
  protected readonly siteNav: NavItem[] = [
    { id: 'sites', label: 'Sites', link: '/admin/v2', exact: true },
    { id: 'site-forms', label: 'Forms', link: '/admin/v2/site/forms', exact: false },
    { id: 'site-files', label: 'Files', link: '/admin/v2/site/files', exact: false },
    { id: 'site-domains', label: 'Domains', link: '/admin/v2/site/domains', exact: false },
  ];

  /** Org-wide / sys-admin surfaces. */
  protected readonly sysNav: NavItem[] = [
    { id: 'analytics', label: 'Analytics', link: '/admin/v2/analytics', exact: false },
    { id: 'media', label: 'Media', link: '/admin/v2/media', exact: false },
    { id: 'domains', label: 'Domains', link: '/admin/v2/domains', exact: false },
    { id: 'billing', label: 'Billing', link: '/admin/v2/billing', exact: false },
    { id: 'cost', label: 'Cost', link: '/admin/v2/cost', exact: false },
    { id: 'audit', label: 'Audit', link: '/admin/v2/audit', exact: false },
    { id: 'integrations', label: 'Integrations', link: '/admin/v2/integrations', exact: false },
    { id: 'settings', label: 'Settings', link: '/admin/v2/settings', exact: false },
  ];

  protected readonly showPalette = signal(false);

  protected onProject(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    if (id) this.ctx.selectSite(id);
  }

  protected onUrl(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    if (id) this.ctx.selectUrl(id);
  }

  /** Global Cmd/Ctrl+K toggles the palette (focus handled by the palette). */
  @HostListener('document:keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      this.showPalette.update((v) => !v);
    }
  }

  protected openPalette(): void {
    this.showPalette.set(true);
  }

  protected newSite(): void {
    void this.router.navigate(['/create']);
  }
}
