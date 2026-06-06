import { Component, type OnInit, type OnDestroy, inject, signal, computed, effect, ViewChild, ViewChildren, ElementRef, HostListener, type QueryList, afterNextRender, Injector } from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Subscription, filter } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { ApiService, type Site } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { NovuInboxService } from '../../services/novu-inbox.service';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import { provideHlmTooltip } from '../../ui';
import { AppShellService, type AppLanguage } from '../../services/app-shell.service';
import { BoltEmbedService } from '../../services/bolt-embed.service';
import { AdminStateService } from './admin-state.service';
import { CommandPaletteComponent } from './command-palette.component';
import { ShortcutsOverlayComponent } from '../../components/shortcuts-overlay/shortcuts-overlay.component';
import { AiChatWidgetComponent } from '../../components/ai-chat-widget/ai-chat-widget.component';
import { SectionErrorBoundaryComponent } from '../../components/section-error-boundary/section-error-boundary.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { DomainPickerComponent } from '../../components/domain-picker/domain-picker.component';
import { GlobalDropZoneComponent } from '../../components/global-drop-zone/global-drop-zone.component';
import { TaskTrayComponent } from '../../components/task-tray/task-tray.component';
import { EditorTabsComponent, type EditorTab } from '../../components/editor-tabs/editor-tabs.component';
import { AdminMediaComponent } from './sections/media.component';
import { AdminAiEndpointsComponent } from './sections/ai-endpoints.component';
import { adminSectionLabelFromPath } from './admin-section-labels';

interface Notification { id: string; title: string; time: string; kind: 'info' | 'warn' | 'ok'; read: boolean; ts?: number; href?: string; }

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, RouterModule, CommandPaletteComponent, ShortcutsOverlayComponent, AiChatWidgetComponent, SectionErrorBoundaryComponent, FocusTrapDirective, DomainPickerComponent, GlobalDropZoneComponent, TaskTrayComponent, EditorTabsComponent, AdminMediaComponent, AdminAiEndpointsComponent, ...BrnTooltipImports],
  providers: [AdminStateService, provideHlmTooltip()],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
  // Activates the black+cyan compact cockpit token layer (_cockpit.scss) for
  // the entire admin subtree ONLY — the marketing surface keeps its own theme.
  // Tokens cascade to all 54 sections + overlays via the shared --ps-* remap.
  host: { 'data-cockpit': 'v2' },
})
export class AdminComponent implements OnInit, OnDestroy {
  // AfterViewInit is declared via the hook below; no need for a separate
  // import since Angular only checks for the named method on the class.
  state = inject(AdminStateService);
  auth = inject(AuthService);
  router = inject(Router);
  bolt = inject(BoltEmbedService);
  private toast = inject(ToastService);
  private api = inject(ApiService);
  private novuInbox = inject(NovuInboxService);
  private titleService = inject(Title);
  private metaService = inject(Meta);
  private translate = inject(TranslateService);
  private appShell = inject(AppShellService);

  @ViewChild('boltFrame') private boltFrameRef?: ElementRef<HTMLIFrameElement>;
  @ViewChild('siteSearchInput') private siteSearchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChildren('siteOption') private siteOptionRefs?: QueryList<ElementRef<HTMLButtonElement>>;
  private injector = inject(Injector);

  /** Track favicon URLs that failed to load so we can fall back to the monogram tile. */
  faviconFailed = signal<Set<string>>(new Set());

  /** Active UI language — used by the avatar-menu toggle to render the chip. */
  currentLang = signal<AppLanguage>(((): AppLanguage => {
    try {
      const stored = localStorage.getItem('ps_language');
      return stored === 'es' ? 'es' : 'en';
    } catch {
      return 'en';
    }
  })());

  siteDropdownOpen = signal(false);
  siteSearchQuery = signal('');
  /**
   * Mobile (`max-md`) drives the sidebar as a fixed overlay drawer
   * (`-translate-x-full` when collapsed); desktop ignores the flag and always
   * shows the rail. Default collapsed on mobile so a phone user lands on the
   * SECTION, not a drawer covering it. SSR-safe (guards `window`).
   */
  sidebarCollapsed = signal(typeof window !== 'undefined' && window.innerWidth < 768);
  isEditorRoute = signal(false);
  currentSection = signal('Editor');

  /**
   * SPA route announcer text. SR users get NO signal that the section changed on
   * client-side navigation (document-title changes are unreliably announced); a
   * visually-hidden aria-live region bound to this announces "<Section> section"
   * on every nav. Derived from the existing currentSection so it stays in lockstep
   * with the visible breadcrumb + title without a second source of truth.
   */
  readonly routeAnnouncement = computed(() => {
    const s = this.currentSection();
    return s ? `${s} section` : '';
  });

  /**
   * Active editor tab — bound to the slim tab strip rendered above the bolt
   * editor when the user is on `/admin/editor`. Initialised from
   * `localStorage['editor.tab']` so a hard reload restores the last view.
   * Valid values: `code` (default), `media`, `agents`. The Media + Agents
   * tabs swap in FULL-WIDTH overlay panels rendered by the template; Code
   * delegates to bolt via postMessage (handled inside
   * `EditorTabsComponent.dispatch`). Legacy persisted `'preview'` normalizes
   * to `'code'`.
   */
  editorActiveTab = signal<EditorTab>(((): EditorTab => {
    try {
      const saved = localStorage.getItem('editor.tab');
      if (saved === 'code' || saved === 'media' || saved === 'agents') {
        return saved;
      }
    } catch {
      /* localStorage unavailable — fall through to default */
    }
    return 'code';
  })());


  // User menu + notifications + palette.
  userMenuOpen = signal(false);
  notifOpen = signal(false);
  /** Navbar "Site actions" dropdown (Preview · Save & Deploy · Review links). */
  siteActionsOpen = signal(false);
  notifications = signal<Notification[]>([]);
  unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  @ViewChild('palette') palette?: CommandPaletteComponent;

  /**
   * Visibility of the global keyboard-shortcuts overlay. Conditional-mount
   * pattern (matches `AppComponent`) — flipping to `true` mounts the
   * overlay, which is internally `open=true` by default. The overlay emits
   * `(closed)` when the user presses Esc, clicks the backdrop, or hits the
   * X button.
   */
  shortcutsOpen = signal(false);

  // Theme toggle — persisted to localStorage, sets data-theme on <html>.
  theme = signal<'dark' | 'light' | 'system'>(((): 'dark' | 'light' | 'system' => {
    try { return (localStorage.getItem('ps_theme') as 'dark' | 'light' | 'system') || 'dark'; } catch { return 'dark'; }
  })());

  private routerSub?: Subscription;

  private updateRouteState(url: string): void {
    this.isEditorRoute.set(url === '/admin' || url.startsWith('/admin/editor'));
    // Mobile: auto-close the overlay drawer after navigating so the user sees
    // the section they just picked instead of the nav covering it.
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.sidebarCollapsed.set(true);
    }
    // Resolve from the FULL path, not the last segment — a param route
    // (`/admin/sites/:id`) or sub-path (`/admin/snapshots/diff`) would otherwise
    // mislabel to "Dashboard" (the last segment is a param value / unmapped tail).
    const section = adminSectionLabelFromPath(url);
    this.currentSection.set(section);
    // Per-route meta swap — only the title + description change; the shell
    // (sidebar + topbar) is never touched. Keeps each tab a distinct, share-
    // able, bookmark-correct view without a full document load.
    this.titleService.setTitle(`${section} · ProjectSites`);
    this.metaService.updateTag({
      name: 'description',
      content: `${section} — your ProjectSites admin dashboard.`,
    });
    this.api.post('/analytics/track', {
      route: url.split('?')[0],
      site_id: this.state.selectedSite()?.id ?? null,
    }).subscribe({ error: () => {} });
  }

  ngOnInit(): void {
    this.applyTheme(this.theme());
    this.updateRouteState(this.router.url);
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.updateRouteState(e.urlAfterRedirects));

    if (!this.auth.isLoggedIn()) {
      this.state.loading.set(false);
      return;
    }
    this.state.loadData();
    this.state.startPolling();
    this.seedNotifications();
    // Item 1 (perf): kick off the bolt.diy editor pre-warm the moment the
    // user lands on /admin — even before a site is selected. By the time
    // they click "Editor" the WebContainer cold-boot tax has been paid in a
    // hidden tab. Idempotent + cleaned up on teardown.
    this.bolt.prewarmEditor();
  }

  ngAfterViewInit(): void {
    // Hand the iframe element to the embed service so it can postMessage
    // into the live editor without a DOM query.
    this.bolt.registerIframe(this.boltFrameRef?.nativeElement ?? null);
  }

  /**
   * Effect: pre-boot the bolt.diy iframe as soon as a site is selected, even
   * when the user is on a different admin sub-route. By the time they click
   * "Editor" the iframe is already running.
   */
  private bootEffect = effect(() => {
    const site = this.state.selectedSite();
    this.bolt.bootForSite(site ?? null);
  });

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.state.stopPolling();
    this.bolt.teardown();
  }

  // ── Editor save ─────────────────────────────────────

  saveEditor(): void {
    this.bolt.saveAndDeploy();
  }

  /**
   * Receive the user's tab selection from `<app-editor-tabs>` and mirror it
   * into our local signal so the template can mount/unmount the Media or
   * Agents overlay panel. Persistence + the iframe-side postMessage are
   * already handled inside `EditorTabsComponent`.
   *
   * @param tab The newly-active editor tab.
   */
  onEditorTabChange(tab: EditorTab): void {
    this.editorActiveTab.set(tab);
  }

  /**
   * Close the active editor overlay (Media / Agents) and reset the tab
   * strip back to `code` so the bolt iframe regains full focus. Wired to
   * the X button rendered in the overlay header.
   */
  closeEditorOverlay(): void {
    this.editorActiveTab.set('code');
    try {
      localStorage.setItem('editor.tab', 'code');
    } catch {
      /* ignore — non-fatal */
    }
  }

  // ── Sidebar ─────────────────────────────────────────

  toggleSiteDropdown(event: MouseEvent): void {
    event.stopPropagation();
    const willOpen = !this.siteDropdownOpen();
    this.siteDropdownOpen.set(willOpen);
    if (!willOpen) { this.siteSearchQuery.set(''); return; }
    // Auto-focus the search input on open — no extra click required. Use
    // afterNextRender so the @if-mounted input is present in the DOM.
    afterNextRender({
      read: () => {
        requestAnimationFrame(() => {
          this.siteSearchInputRef?.nativeElement.focus({ preventScroll: true });
        });
      },
    }, { injector: this.injector });
  }

  get filteredSites(): Site[] {
    const q = this.siteSearchQuery().toLowerCase().trim();
    if (!q) return this.state.sites();
    return this.state.sites().filter((s) =>
      (s.business_name || '').toLowerCase().includes(q) || (s.slug || '').toLowerCase().includes(q),
    );
  }

  closeSiteDropdown(): void { this.siteDropdownOpen.set(false); }
  toggleSidebar(): void { this.sidebarCollapsed.update((v) => !v); }

  closeDropdowns(): void {
    this.siteDropdownOpen.set(false);
    this.siteSearchQuery.set('');
    this.userMenuOpen.set(false);
    this.notifOpen.set(false);
    this.siteActionsOpen.set(false);
  }

  selectSite(site: Site): void {
    this.state.selectSite(site);
    this.siteDropdownOpen.set(false);
    this.siteSearchQuery.set('');
  }

  /**
   * Resolve a favicon URL for a site. Sites don't carry a `favicon_url` on
   * the API model (yet) — fall back to Google's S2 favicon service keyed by
   * the primary hostname or the `{slug}.projectsites.dev` default.
   */
  siteFaviconUrl(site: Site): string {
    const host = (site.primary_hostname || '').trim();
    // Only ask Google's S2 service for a favicon on REAL custom domains.
    // Generated `*.projectsites.dev` subdomains (and the slug default) aren't
    // crawled by Google → it 404s, which logs a console error AND falls back to
    // the monogram anyway. Returning '' renders the monogram tile directly with
    // no network request, keeping the console clean (console-error gate).
    if (!host || /\.projectsites\.dev$/i.test(host)) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  }

  /** First letter of business name, fallback "?". Used by the monogram tile. */
  siteMonogram(site: Site | null | undefined): string {
    const name = (site?.business_name || '').trim();
    if (name) return name.charAt(0).toUpperCase();
    const slug = (site?.slug || '').trim();
    return slug ? slug.charAt(0).toUpperCase() : '?';
  }

  /** True when the upstream favicon for this site failed to load. */
  isFaviconFailed(site: Site): boolean {
    return this.faviconFailed().has(site.id);
  }

  /** Mark a favicon as broken so the template swaps to the monogram tile. */
  onFaviconError(site: Site): void {
    if (this.faviconFailed().has(site.id)) return;
    const next = new Set(this.faviconFailed());
    next.add(site.id);
    this.faviconFailed.set(next);
  }

  /**
   * Enter inside the search input. With a typed query:
   *   • Matches → select the first (top-ranked) match and close dropdown.
   *   • No matches → jump to /create with `?name=<query>` pre-filled so the
   *     user lands on the create wizard with their typed name already in
   *     the business-name field.
   * Empty query falls through (no-op).
   */
  onSiteSearchEnter(ev: Event): void {
    const event = ev as KeyboardEvent;
    event.preventDefault();
    const query = this.siteSearchQuery().trim();
    if (!query) return;
    const top = this.filteredSites[0];
    if (top) {
      this.selectSite(top);
      return;
    }
    // No match — go create a new site with the typed name pre-filled.
    this.siteDropdownOpen.set(false);
    this.siteSearchQuery.set('');
    this.router.navigate(['/create'], { queryParams: { name: query } });
  }

  /**
   * Arrow-key navigation through the site option list. Up/Down move focus,
   * Home/End jump to first/last, Esc closes the dropdown and re-focuses the
   * trigger button via blur. Called from both the search input and the
   * option buttons.
   */
  onSiteListKeydown(ev: KeyboardEvent): void {
    const opts = this.siteOptionRefs?.toArray() ?? [];
    if (!opts.length && ev.key !== 'Escape') return;
    const active = document.activeElement as HTMLElement | null;
    const idx = opts.findIndex((r) => r.nativeElement === active);
    let next = -1;
    switch (ev.key) {
      case 'ArrowDown':
        next = idx < 0 ? 0 : Math.min(opts.length - 1, idx + 1);
        break;
      case 'ArrowUp':
        if (idx <= 0) {
          // Bounce focus back to search input from the top of the list.
          ev.preventDefault();
          this.siteSearchInputRef?.nativeElement.focus();
          return;
        }
        next = idx - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = opts.length - 1;
        break;
      case 'Escape':
        ev.preventDefault();
        this.siteDropdownOpen.set(false);
        this.siteSearchQuery.set('');
        return;
      default:
        return;
    }
    if (next >= 0 && opts[next]) {
      ev.preventDefault();
      opts[next].nativeElement.focus();
    }
  }

  // ── Palette ─────────────────────────────────────────

  openPalette(): void { this.palette?.openIt(); }

  openShortcuts(): void { this.shortcutsOpen.set(true); this.userMenuOpen.set(false); }

  /**
   * Flip the active UI language between English and Spanish, push the change
   * through `TranslateService` so all `| translate` bindings refresh, stamp
   * `<html lang>` for screen readers, and persist to localStorage so the
   * choice survives reload (consumed by `app.config.ts initTranslations`).
   */
  toggleLanguage(): void {
    const next: AppLanguage = this.currentLang() === 'en' ? 'es' : 'en';
    this.currentLang.set(next);
    this.translate.use(next).subscribe({
      next: () => undefined,
      error: () => undefined,
    });
    this.appShell.applyLanguage(next);
    this.userMenuOpen.set(false);
    this.toast.info(next === 'es' ? 'Idioma: Español' : 'Language: English');
  }

  toggleTheme(): void {
    const order: ('dark' | 'light' | 'system')[] = ['dark', 'system', 'light'];
    const next = order[(order.indexOf(this.theme()) + 1) % order.length]!;
    this.theme.set(next);
    this.applyTheme(next);
    try { localStorage.setItem('ps_theme', next); } catch { /* ignore */ }
    this.toast.info(`Theme: ${next}`);
  }
  private applyTheme(t: 'dark' | 'light' | 'system'): void {
    document.documentElement.setAttribute('data-theme', t);
  }

  // ── User menu ───────────────────────────────────────

  /**
   * Up-to-two-character monogram for the avatar. Preference order:
   *   1. First+last initial when `auth.user.name` has 2+ tokens ("Brian Zalewski" → "BZ").
   *   2. First letter of the single-token name ("Brian" → "B").
   *   3. First letter of the email ("hey@megabyte.space" → "H").
   *   4. "?" when nothing is known.
   */
  userInitials(): string {
    const name = this.userName().trim();
    if (name) {
      const tokens = name.split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length >= 2) {
        return (tokens[0]!.charAt(0) + tokens[tokens.length - 1]!.charAt(0)).toUpperCase();
      }
      if (tokens.length === 1) return tokens[0]!.charAt(0).toUpperCase();
    }
    const email = this.userEmail().trim();
    if (email) return email.charAt(0).toUpperCase();
    return '?';
  }
  /** Back-compat alias — older templates/tests may still reference `userInitial()`. */
  userInitial(): string { return this.userInitials(); }
  userEmail(): string { return (this.auth as unknown as { user?: { email?: string } }).user?.email ?? ''; }
  userName(): string { return (this.auth as unknown as { user?: { name?: string } }).user?.name ?? ''; }
  planLabel(): string { return 'Free'; }
  toggleUserMenu(ev: MouseEvent): void {
    ev.stopPropagation();
    this.userMenuOpen.update((v) => !v);
    this.notifOpen.set(false);
    this.siteActionsOpen.set(false);
  }

  // ── Notifications ───────────────────────────────────

  toggleNotifications(ev: MouseEvent): void {
    ev.stopPropagation();
    this.notifOpen.update((v) => !v);
    this.userMenuOpen.set(false);
    this.siteActionsOpen.set(false);
  }

  // ── Site actions dropdown (Preview · Save & Deploy · Review links) ──

  toggleSiteActions(ev: MouseEvent): void {
    ev.stopPropagation();
    this.siteActionsOpen.update((v) => !v);
    this.notifOpen.set(false);
    this.userMenuOpen.set(false);
  }
  closeSiteActions(): void { this.siteActionsOpen.set(false); }
  /** Preview the live site in a new tab, then close the menu. */
  previewSite(site: Site): void {
    this.state.visitSite(site);
    this.siteActionsOpen.set(false);
  }
  /** Copy the site's live URL to the clipboard (toast + graceful failure), then close. */
  copySiteUrl(site: Site): void {
    this.state.copyUrl(site);
    this.siteActionsOpen.set(false);
  }
  /** Save & deploy from the menu (no-ops off the editor route), then close. */
  deployFromMenu(): void {
    if (!this.isEditorRoute() || this.bolt.saving()) return;
    this.saveEditor();
    this.siteActionsOpen.set(false);
  }

  /** Close the avatar-wrap popovers on any outside click (the toggles + pop
   *  contents stopPropagation, so only genuine outside clicks reach here). */
  @HostListener('document:click')
  onDocumentClick(): void {
    this.siteActionsOpen.set(false);
    this.notifOpen.set(false);
    this.userMenuOpen.set(false);
  }
  markAllRead(): void {
    const ids = this.notifications().map((n) => n.id);
    // Propagate read receipts to Novu for any Novu-sourced items (best-effort).
    for (const id of ids) if (id.startsWith('novu-')) void this.novuInbox.read(id);
    this.notifications.update((ns) => ns.map((n) => ({ ...n, read: true })));
    try { localStorage.setItem('ps_notif_read', JSON.stringify(ids)); } catch { /* */ }
  }
  openNotification(n: Notification): void {
    if (n.id.startsWith('novu-')) void this.novuInbox.read(n.id);
    this.notifications.update((ns) => ns.map((m) => m.id === n.id ? { ...m, read: true } : m));
    try {
      const prev = JSON.parse(localStorage.getItem('ps_notif_read') ?? '[]') as string[];
      if (!prev.includes(n.id)) localStorage.setItem('ps_notif_read', JSON.stringify([...prev, n.id]));
    } catch { /* */ }
    if (n.href) { this.router.navigateByUrl(n.href); this.notifOpen.set(false); }
  }
  groupedNotifications(): { label: string; items: Notification[] }[] {
    const now = Date.now();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const groups = { Today: [] as Notification[], 'This week': [] as Notification[], Earlier: [] as Notification[] };
    for (const n of this.notifications()) {
      const ts = n.ts ?? now;
      if (ts >= dayStart.getTime()) groups['Today'].push(n);
      else if (now - ts < 1000 * 60 * 60 * 24 * 7) groups['This week'].push(n);
      else groups['Earlier'].push(n);
    }
    return (['Today', 'This week', 'Earlier'] as const)
      .filter((k) => groups[k].length)
      .map((label) => ({ label, items: groups[label] }));
  }
  private seedNotifications(): void {
    let readIds: string[] = [];
    try { readIds = JSON.parse(localStorage.getItem('ps_notif_read') ?? '[]') as string[]; } catch { /* */ }
    const seeded: Notification[] = [
      { id: 'welcome', title: 'Welcome — press ⌘K to find anything.', time: 'just now', kind: 'info', read: readIds.includes('welcome'), ts: Date.now() },
    ];
    this.notifications.set(seeded);
    // Pull recent audit log entries as notifications (last 5).
    this.api.get<{ data: { id: string; action: string; target_type: string; created_at: string }[] }>('/audit/rows?limit=5').subscribe({
      next: (r) => {
        const now = Date.now();
        const items: Notification[] = (r.data ?? []).map((row) => {
          const t = new Date(row.created_at).getTime();
          return {
            id: `audit-${row.id}`,
            title: this.humanizeAction(row.action) + this.targetSuffix(row.target_type),
            time: this.relativeTime(now - t),
            kind: row.action.includes('delete') ? 'warn' : row.action.includes('error') ? 'warn' : 'info',
            read: readIds.includes(`audit-${row.id}`),
            ts: t,
            href: '/admin/audit',
          };
        });
        if (items.length) this.notifications.update((cur) => [...items, ...cur]);
      },
      error: () => { /* no audit available — silent */ },
    });
    // Merge the Novu Cloud inbox (the doctrine notification backbone) as an
    // ADDITIVE source — local audit/seed feed stays primary, so the bell never
    // regresses if Novu is empty/unreachable. Fully guarded inside the service.
    this.novuInbox.list(20).then((rows) => {
      if (!rows.length) return;
      const mapped: Notification[] = rows.map((n) => ({
        id: n.id,
        title: n.title,
        time: this.relativeTime(Date.now() - n.ts),
        kind: 'info',
        read: n.read || readIds.includes(n.id),
        ts: n.ts,
        href: n.href ?? undefined,
      }));
      this.notifications.update((cur) => {
        const seen = new Set(cur.map((c) => c.id));
        const fresh = mapped.filter((m) => !seen.has(m.id));
        return [...fresh, ...cur].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      });
    }).catch(() => { /* swallow — Novu is additive, never blocks the local feed */ });
  }
  /**
   * Build the "· {site}" suffix for a notification title. When the audit row's
   * `target_type` is the literal word "site" (the most common case), swap in
   * the currently-selected site's business_name or `{slug}.projectsites.dev`
   * so the operator sees which site the event belongs to instead of the
   * generic word. For non-site targets (org, billing, hostname…), keep the
   * raw target_type as the descriptor.
   */
  private targetSuffix(targetType: string | null): string {
    if (!targetType) return '';
    if (targetType.toLowerCase() === 'site') {
      const site = this.state.selectedSite();
      const label = site?.business_name?.trim() || (site?.slug ? `${site.slug}.projectsites.dev` : '');
      return label ? ` · ${label}` : '';
    }
    return ` · ${targetType}`;
  }
  private humanizeAction(a: string): string {
    return a.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  private relativeTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // Global keyboard shortcuts:
  //   ?     → open shortcuts cheat-sheet
  //   /     → focus sidebar search
  //   ⌘D    → toggle density
  //   ⌘.    → toggle theme
  //   ⌘B    → toggle sidebar
  //   g e/s/a/f/l → navigate to Editor/Snapshots/Analytics/Forms/AI Logs
  private gPressedAt = 0;
  @HostListener('document:keydown', ['$event'])
  onGlobalKey(ev: KeyboardEvent): void {
    const inField = (ev.target as HTMLElement | null)?.matches('input, textarea, [contenteditable]');
    if (ev.key === 'Escape' && (this.siteActionsOpen() || this.notifOpen() || this.userMenuOpen())) {
      this.siteActionsOpen.set(false); this.notifOpen.set(false); this.userMenuOpen.set(false); return;
    }
    if (ev.key === '?' && !inField) { ev.preventDefault(); this.shortcutsOpen.set(true); return; }
    if (ev.key === '/' && !inField) {
      ev.preventDefault();
      (document.querySelector('input[placeholder*="Search sites" i]') as HTMLInputElement | null)?.focus();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key === '.') { ev.preventDefault(); this.toggleTheme(); return; }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); this.toggleSidebar(); return; }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's' && this.isEditorRoute()) { ev.preventDefault(); this.saveEditor(); return; }
    if (!inField && !ev.metaKey && !ev.ctrlKey) {
      if (ev.key === 'g') { this.gPressedAt = Date.now(); return; }
      if (Date.now() - this.gPressedAt < 900) {
        const map: Record<string, string> = { e: '/admin', s: '/admin/snapshots', a: '/admin/analytics', f: '/admin/forms', l: '/admin/traces', c: '/admin/ai-chat', b: '/admin/billing', v: '/admin/voice', d: '/admin/domains', u: '/admin/user' };
        const path = map[ev.key.toLowerCase()];
        if (path) { ev.preventDefault(); this.router.navigateByUrl(path); this.gPressedAt = 0; }
      }
    }
  }
}
