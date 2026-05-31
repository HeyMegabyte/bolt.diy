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
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { HlmButtonDirective } from '../../ui/button';
import { HlmInputDirective } from '../../ui/input';
import { HlmCardDirective, HlmCardTitleDirective } from '../../ui/card';
import { CommandPaletteComponent } from '../../components/command-palette/command-palette.component';
import { V2NotifBellComponent } from './sections/notif-bell.component';
import { V2SiteContextService } from './v2-site-context.service';

interface NavItem {
  id: string;
  label: string;
  link: string;
  exact: boolean;
  /** When set, renders a live count chip pulled from `navCount(key)`. */
  count?: 'sites' | 'building';
}

const EDITOR_BASE = 'https://editor.projectsites.dev';

@Component({
  selector: 'app-admin-v2-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    HlmButtonDirective,
    HlmInputDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    CommandPaletteComponent,
    V2NotifBellComponent,
  ],
  host: { 'data-cockpit': 'v2', class: 'block min-h-screen bg-background text-foreground' },
  template: `
    <div class="flex min-h-screen">
      <!-- Sidebar (persistent) -->
      <aside
        class="w-[232px] shrink-0 border-r border-border bg-card flex flex-col
               fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform
               md:static md:translate-x-0 md:bg-card/40"
        [class.translate-x-0]="sidebarOpen()"
        data-testid="v2-sidebar">
        <div class="h-[56px] flex items-center px-4 border-b border-border">
          <span class="text-sm font-semibold tracking-tight">project<span class="text-primary">sites</span>.dev</span>
          <span class="ml-2 text-[0.6rem] uppercase tracking-wider text-primary border border-border rounded px-1.5 py-0.5">v2</span>
        </div>
        <nav class="flex flex-col gap-0.5 p-2 text-sm overflow-y-auto" role="navigation">
          <p class="px-2 pt-1 pb-1 text-[0.6rem] uppercase tracking-wider text-muted-foreground">Site</p>
          @for (item of siteNav; track item.id) {
            <a [routerLink]="item.link"
               routerLinkActive="bg-primary/10 text-primary !border-primary shadow-[inset_0_0_18px_-10px_rgba(0,229,255,0.5)]"
               [routerLinkActiveOptions]="{ exact: item.exact }"
               hlmBtn variant="ghost" size="sm" class="justify-start w-full border-l-2 border-transparent"
               (click)="sidebarOpen.set(false)"
               [attr.data-testid]="'v2-nav-' + item.id">
              <span class="flex-1 text-left truncate">{{ item.label }}</span>
              @if (item.count && navCount(item.count) > 0) {
                <span class="ml-2 shrink-0 rounded px-1.5 py-px text-[0.65rem] font-medium tabular-nums bg-primary/15 text-primary border border-primary/30"
                      [attr.aria-label]="navCount(item.count) + ' ' + item.label">{{ navCount(item.count) }}</span>
              }
            </a>
          }
          <p class="px-2 pt-3 pb-1 text-[0.6rem] uppercase tracking-wider text-muted-foreground">Sys-admin</p>
          @for (item of sysNav; track item.id) {
            <a [routerLink]="item.link"
               routerLinkActive="bg-primary/10 text-primary !border-primary shadow-[inset_0_0_18px_-10px_rgba(0,229,255,0.5)]"
               [routerLinkActiveOptions]="{ exact: item.exact }"
               hlmBtn variant="ghost" size="sm" class="justify-start w-full border-l-2 border-transparent"
               (click)="sidebarOpen.set(false)"
               [attr.data-testid]="'v2-nav-' + item.id">
              <span class="flex-1 text-left truncate">{{ item.label }}</span>
              @if (item.count && navCount(item.count) > 0) {
                <span class="ml-2 shrink-0 rounded px-1.5 py-px text-[0.65rem] font-medium tabular-nums bg-primary/15 text-primary border border-primary/30"
                      [attr.aria-label]="navCount(item.count) + ' ' + item.label">{{ navCount(item.count) }}</span>
              }
            </a>
          }
        </nav>
      </aside>

      <!-- Main column -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Top command bar (persistent) — Project + URL switchers -->
        <header class="h-[56px] shrink-0 border-b border-border flex items-center justify-between gap-3 px-5 bg-background/70 backdrop-blur-md sticky top-0 z-10 shadow-[0_6px_24px_-16px_rgba(0,0,0,0.8)]" data-testid="v2-topbar">
          <div class="flex items-center gap-2 min-w-0">
            <button hlmBtn variant="ghost" size="icon" class="md:hidden shrink-0"
                    (click)="sidebarOpen.set(true)" aria-label="Open navigation" data-testid="v2-menu-toggle">☰</button>
            <label class="sr-only" for="v2-project">Project</label>
            <select hlmInput id="v2-project" class="h-8 max-w-[140px] sm:max-w-[220px] text-sm" data-testid="v2-project-select"
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
            @if (navCount('building') > 0) {
              <span class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[0.7rem] font-medium text-primary tabular-nums"
                    data-testid="v2-building-chip" role="status" aria-live="polite"
                    [attr.aria-label]="navCount('building') + ' sites building now'">
                <span class="h-1.5 w-1.5 rounded-full bg-primary animate-pulse motion-reduce:animate-none"></span>
                {{ navCount('building') }} building
              </span>
            }
            @if (liveUrl(); as url) {
              <button hlmBtn variant="ghost" size="sm" (click)="copyLive(url)" data-testid="v2-copy-url"
                      class="hidden sm:inline-flex"
                      [attr.aria-label]="'Copy ' + url">{{ copied() ? '✓ Copied' : 'Copy URL' }}</button>
              <a [href]="url" target="_blank" rel="noopener noreferrer" hlmBtn variant="outline" size="sm"
                 class="hidden sm:inline-flex"
                 data-testid="v2-open-site" aria-label="Open live site in a new tab">Open ↗</a>
            }
            <button hlmBtn variant="ghost" size="sm" data-testid="v2-search" (click)="openPalette()" class="hidden sm:inline-flex">⌘K</button>
            <app-v2-notif-bell />
            <button hlmBtn variant="primary" size="sm" data-testid="v2-create" (click)="newSite()">+ New site</button>
          </div>
        </header>

        <main class="flex-1 relative min-h-0 bg-[radial-gradient(85%_55%_at_50%_-8%,rgba(0,229,255,0.05),transparent_55%)]" data-testid="v2-outlet">
          <!-- Routed non-editor sections -->
          <div class="h-full overflow-auto p-5" [class.hidden]="onEditorRoute()">
            <router-outlet />
          </div>

          <!-- Warm-persistent editor iframe: ALWAYS mounted (boots the selected
               site in the background → warm), shown only on /site/editor, hidden
               (display:none, stays warm) elsewhere so nav back doesn't re-boot.
               src changes only when the Project changes. -->
          @if (editorUrl(); as url) {
            <iframe
              [src]="url"
              [class.hidden]="!onEditorRoute()"
              class="absolute inset-0 w-full h-full border-0 bg-background"
              allow="clipboard-read; clipboard-write; microphone"
              title="Site editor" data-testid="v2-editor-frame"></iframe>
          }
        </main>
      </div>
    </div>

    @if (sidebarOpen()) {
      <div class="fixed inset-0 z-30 bg-black/60 md:hidden" (click)="sidebarOpen.set(false)"
           aria-hidden="true" data-testid="v2-sidebar-backdrop"></div>
    }

    @if (showPalette()) {
      <app-command-palette (closed)="showPalette.set(false)" />
    }

    @if (showHelp()) {
      <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
           (click)="showHelp.set(false)" data-testid="v2-shortcuts-help">
        <div hlmCard class="max-w-sm w-full" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between">
            <h3 hlmCardTitle>Keyboard shortcuts</h3>
            <button hlmBtn variant="ghost" size="sm" (click)="showHelp.set(false)">Esc</button>
          </div>
          <ul class="mt-3 text-sm flex flex-col gap-1.5">
            @for (s of shortcutList; track s.keys) {
              <li class="flex items-center justify-between gap-4">
                <span class="text-muted-foreground">{{ s.label }}</span>
                <kbd class="font-mono text-[0.7rem] px-1.5 py-0.5 rounded border border-border text-foreground bg-card">{{ s.keys }}</kbd>
              </li>
            }
          </ul>
        </div>
      </div>
    }
  `,
})
export class AdminV2ShellComponent {
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly ctx = inject(V2SiteContextService);

  /** Current URL, reactive on navigation. */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** True on the per-site Editor route — toggles the shell-owned warm iframe. */
  protected readonly onEditorRoute = computed(() =>
    this.currentUrl().split('?')[0].split('#')[0].endsWith('/site/editor'),
  );

  /**
   * Editor URL for the selected Project (same embed params as BoltEmbedService).
   * The iframe stays mounted across nav; this only changes on Project switch.
   */
  protected readonly editorUrl = computed<SafeResourceUrl | null>(() => {
    const site = this.ctx.selectedSite();
    if (!site) return null;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://projectsites.dev';
    const params = new URLSearchParams({
      embedded: 'true',
      hideHeader: 'true',
      hideDiff: 'true',
      hideDeploy: 'true',
      slug: site.slug,
      importChatFrom: `${origin}/api/sites/by-slug/${site.slug}/chat`,
    });
    return this.sanitizer.bypassSecurityTrustResourceUrl(`${EDITOR_BASE}/?${params.toString()}`);
  });

  /** Per-site editor surfaces (operate on the selected Project). */
  protected readonly siteNav: NavItem[] = [
    { id: 'sites', label: 'Sites', link: '/admin/v2', exact: true, count: 'sites' },
    { id: 'site-editor', label: 'Editor', link: '/admin/v2/site/editor', exact: false },
    { id: 'site-forms', label: 'Forms', link: '/admin/v2/site/forms', exact: false },
    { id: 'site-files', label: 'Files', link: '/admin/v2/site/files', exact: false },
    { id: 'site-domains', label: 'Domains', link: '/admin/v2/site/domains', exact: false },
    { id: 'site-build', label: 'Build', link: '/admin/v2/site/build', exact: false },
    { id: 'site-snapshots', label: 'Snapshots', link: '/admin/v2/site/snapshots', exact: false },
    { id: 'site-ai-logs', label: 'AI Logs', link: '/admin/v2/site/ai-logs', exact: false },
    { id: 'site-ai-endpoints', label: 'AI Endpoints', link: '/admin/v2/site/ai-endpoints', exact: false },
    { id: 'site-voice', label: 'Voice', link: '/admin/v2/site/voice', exact: false },
  ];

  /** Org-wide / sys-admin surfaces. */
  protected readonly sysNav: NavItem[] = [
    { id: 'overview', label: 'Overview', link: '/admin/v2/overview', exact: false },
    { id: 'analytics', label: 'Analytics', link: '/admin/v2/analytics', exact: false },
    { id: 'media', label: 'Media', link: '/admin/v2/media', exact: false },
    { id: 'apps', label: 'Apps', link: '/admin/v2/apps', exact: false },
    { id: 'social', label: 'Social', link: '/admin/v2/social', exact: false },
    { id: 'domains', label: 'Domains', link: '/admin/v2/domains', exact: false },
    { id: 'billing', label: 'Billing', link: '/admin/v2/billing', exact: false },
    { id: 'cost', label: 'Cost', link: '/admin/v2/cost', exact: false },
    { id: 'audit', label: 'Audit', link: '/admin/v2/audit', exact: false },
    { id: 'integrations', label: 'Integrations', link: '/admin/v2/integrations', exact: false },
    { id: 'mcp', label: 'MCP', link: '/admin/v2/mcp', exact: false },
    { id: 'docs', label: 'Docs', link: '/admin/v2/docs', exact: false },
    { id: 'feature-flags', label: 'Feature Flags', link: '/admin/v2/feature-flags', exact: false },
    { id: 'api-tokens', label: 'API Tokens', link: '/admin/v2/api-tokens', exact: false },
    { id: 'trust-center', label: 'Trust Center', link: '/admin/v2/trust-center', exact: false },
    { id: 'site-dna', label: 'Site DNA', link: '/admin/v2/site-dna', exact: false },
    { id: 'enterprise', label: 'Enterprise', link: '/admin/v2/enterprise', exact: false },
    { id: 'settings', label: 'Settings', link: '/admin/v2/settings', exact: false },
  ];

  /** Live nav chip counts — total sites + how many are mid-build. */
  protected navCount(key: 'sites' | 'building'): number {
    const sites = this.ctx.sites();
    if (key === 'building') {
      return sites.filter((s) => s.status === 'building' || s.status === 'generating').length;
    }
    return sites.length;
  }

  protected readonly showPalette = signal(false);
  protected readonly copied = signal(false);

  /** Rows shown in the `?` shortcuts overlay. */
  protected readonly shortcutList = [
    { label: 'Command palette', keys: '⌘K' },
    { label: 'This help', keys: '?' },
    { label: 'Go to Editor', keys: 'g e' },
    { label: 'Go to Sites', keys: 'g s' },
    { label: 'Go to Forms', keys: 'g f' },
    { label: 'Go to Files', keys: 'g i' },
    { label: 'Go to Domains', keys: 'g d' },
    { label: 'Go to Build', keys: 'g b' },
    { label: 'Go to Analytics', keys: 'g a' },
    { label: 'Go to Cost', keys: 'g c' },
  ];
  /** Mobile off-canvas sidebar (md+ is always static/visible). */
  protected readonly sidebarOpen = signal(false);

  /** Live URL of the selected Project (custom hostname if set, else free subdomain). */
  protected readonly liveUrl = computed<string | null>(() => {
    const site = this.ctx.selectedSite();
    if (!site) return null;
    const host = this.ctx.selectedUrl()?.hostname || `${site.slug}.projectsites.dev`;
    return `https://${host}`;
  });

  protected copyLive(url: string): void {
    navigator.clipboard?.writeText(url).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
      },
      () => {
        /* clipboard blocked — no-op */
      },
    );
  }

  protected onProject(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    if (id) this.ctx.selectSite(id);
  }

  protected onUrl(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    if (id) this.ctx.selectUrl(id);
  }

  protected readonly showHelp = signal(false);
  private readonly gArmed = signal(false);

  /** `g`-then-key navigation map (Linear/GitHub style). */
  private readonly GMAP: Record<string, string> = {
    e: '/admin/v2/site/editor',
    s: '/admin/v2',
    f: '/admin/v2/site/forms',
    i: '/admin/v2/site/files',
    d: '/admin/v2/site/domains',
    b: '/admin/v2/site/build',
    a: '/admin/v2/analytics',
    m: '/admin/v2/media',
    c: '/admin/v2/cost',
    u: '/admin/v2/audit',
    n: '/admin/v2/integrations',
    t: '/admin/v2/settings',
  };

  /**
   * Keyboard: ⌘/Ctrl+K palette · `?` shortcuts help · `g` then a key jumps to a
   * section (e=editor, s=sites, f=forms, i=files, d=domains, b=build, a=analytics,
   * m=media, c=cost, u=audit, n=integrations, t=settings). Ignored while typing.
   */
  @HostListener('document:keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      this.showPalette.update((v) => !v);
      return;
    }
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '?') {
      e.preventDefault();
      this.showHelp.update((v) => !v);
      return;
    }
    if (e.key === 'Escape') {
      this.showHelp.set(false);
      this.gArmed.set(false);
      return;
    }
    if (e.key === 'g' || e.key === 'G') {
      this.gArmed.set(true);
      setTimeout(() => this.gArmed.set(false), 1200);
      return;
    }
    if (this.gArmed()) {
      this.gArmed.set(false);
      const dest = this.GMAP[e.key.toLowerCase()];
      if (dest) {
        e.preventDefault();
        void this.router.navigateByUrl(dest);
      }
    }
  }

  protected openPalette(): void {
    this.showPalette.set(true);
  }

  protected newSite(): void {
    void this.router.navigate(['/create']);
  }
}
