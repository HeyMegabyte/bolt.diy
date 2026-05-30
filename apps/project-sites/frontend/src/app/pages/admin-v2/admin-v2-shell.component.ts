/**
 * @module pages/admin-v2/admin-v2-shell
 *
 * Spartan UI admin shell (Wave C). The first user-visible surface of the
 * Spartan rebuild — a compact black/cyan developer-console shell built from the
 * helm primitives ([[spartan-ui-design-system]]). Lives at the flag-gated
 * `/admin/v2` route; the legacy admin stays the default until this is verified
 * + promoted.
 *
 * The shell is PERSISTENT chrome (sidebar + top command bar) wrapping a
 * `<router-outlet>` — child sections (sites / analytics / domains / settings)
 * are lazy-loaded and swap without re-mounting the chrome, so there are zero
 * full page reloads on internal nav per [[angular-large-app-supervisor]] +
 * the dashboard-cockpit no-full-reload mandate. `routerLinkActive` drives the
 * cyan active state.
 *
 * Command surface: `Meta/Ctrl+K` (and the topbar ⌘K button) open the shared
 * {@link CommandPaletteComponent} — the canonical palette is `!inAdmin()`-gated
 * in `app.component`, so v2 mounts its own instance. `+ New site` routes to the
 * create flow. Honors the global Cmd+K focus mandate via the palette's own
 * autofocus.
 */
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { HlmButtonDirective } from '../../ui/button';
import { CommandPaletteComponent } from '../../components/command-palette/command-palette.component';
import { V2NotifBellComponent } from './sections/notif-bell.component';

@Component({
  selector: 'app-admin-v2-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HlmButtonDirective, CommandPaletteComponent, V2NotifBellComponent],
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
            <a [routerLink]="item.link"
               routerLinkActive="bg-primary/10 text-primary"
               [routerLinkActiveOptions]="{ exact: item.exact }"
               hlmBtn variant="ghost" size="sm"
               class="justify-start w-full"
               [attr.data-testid]="'v2-nav-' + item.id">{{ item.label }}</a>
          }
        </nav>
      </aside>

      <!-- Main column -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Top command bar (persistent) -->
        <header class="h-[56px] shrink-0 border-b border-border flex items-center justify-between px-5 bg-background/80 backdrop-blur sticky top-0 z-10" data-testid="v2-topbar">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <span class="text-foreground font-medium">Cockpit</span>
            <span class="opacity-40">·</span>
            <span>Spartan UI</span>
          </div>
          <div class="flex items-center gap-2">
            <button hlmBtn variant="outline" size="sm" data-testid="v2-search" (click)="openPalette()">⌘K Search</button>
            <app-v2-notif-bell />
            <button hlmBtn variant="primary" size="sm" data-testid="v2-create" (click)="newSite()">+ New site</button>
          </div>
        </header>

        <!-- Routed section (sites / analytics / domains / settings) -->
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

  protected readonly nav = [
    { id: 'sites', label: 'Sites', link: '/admin/v2', exact: true },
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
