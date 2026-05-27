import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { PanelMenuModule } from 'primeng/panelmenu';
import { BreadcrumbModule } from 'primeng/breadcrumb';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MenuModule } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';

import { CapabilityService } from '../services/capability.service';
import { HealthService } from '../services/health.service';
import { MeStore } from '../services/me.store';
import { NotificationsStore } from '../services/notifications.store';
import { RoleService } from '../services/role.service';
import { CommandPaletteService } from '../command-palette/command-palette.component';
import { NotificationsBellComponent } from '../notifications-bell/notifications-bell.component';
import { RoleSwitcherComponent } from '../role-switcher/role-switcher.component';
import { RightRailComponent } from '../right-rail/right-rail.component';
import type { Capability, Tenant } from '../types/domain';

interface NavItem {
  readonly label: string;
  readonly route: readonly string[];
  readonly icon: string;
  readonly requires: Capability | null;
  /** Show only when `me.isSuperAdmin && viewAs === 'super_admin'`. */
  readonly superAdminOnly?: boolean;
}

/**
 * Single dashboard shell — top toolbar, left rail, breadcrumbs, main
 * outlet, contextual right rail, minimal footer. Owns Cmd+K, role
 * switcher, tenant switcher, notifications bell, online/offline
 * toggle, health beacon.
 *
 * @example
 * ```ts
 * // app.routes.ts
 * { path: 'dashboard', loadComponent: () =>
 *     import('@org/dashboard').then(m => m.DashboardShellComponent) }
 * ```
 */
@Component({
  selector: 'lib-dashboard-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    RouterOutlet,
    ToolbarModule,
    ButtonModule,
    SelectModule,
    PanelMenuModule,
    BreadcrumbModule,
    ToggleSwitchModule,
    MenuModule,
    NotificationsBellComponent,
    RoleSwitcherComponent,
    RightRailComponent,
  ],
  template: `
    <div class="ps-shell" [attr.data-view-as]="viewAs()" data-testid="dashboard-shell">
      <p-toolbar styleClass="ps-shell__toolbar">
        <ng-template pTemplate="start">
          <a class="ps-shell__brand" routerLink="/dashboard" aria-label="Project Sites dashboard">
            <span class="ps-shell__brand-mark" aria-hidden="true">◆</span>
            <span class="ps-shell__brand-text">projectsites</span>
          </a>
          @if (showTenantSwitcher()) {
            <p-select
              data-testid="tenant-switcher"
              [options]="tenantOptions()"
              optionLabel="name"
              [ngModel]="currentTenant()"
              (ngModelChange)="onTenantSwitch($event)"
              placeholder="Switch tenant"
              ariaLabel="Switch tenant"
              styleClass="ps-shell__tenant"
            />
          }
        </ng-template>

        <ng-template pTemplate="end">
          <button
            pButton
            type="button"
            class="p-button-text ps-shell__cmdk"
            (click)="palette.open()"
            aria-label="Open command palette (⌘K)"
            data-testid="cmdk-trigger"
          >
            <span class="ps-shell__cmdk-label">Search</span>
            <kbd class="ps-shell__kbd">⌘K</kbd>
          </button>

          @if (showOnlineToggle()) {
            <label class="ps-shell__online" data-testid="crew-online-toggle">
              <span class="ps-shell__online-label">{{ online() ? 'On the clock' : 'Off the clock' }}</span>
              <p-toggleswitch [ngModel]="online()" (ngModelChange)="setOnline($event)" />
            </label>
          }

          <lib-role-switcher />

          <lib-notifications-bell />

          <p-menu
            #accountMenu
            [popup]="true"
            [model]="accountMenuItems()"
            appendTo="body"
          />
          <button
            pButton
            type="button"
            class="p-button-text"
            aria-label="Account menu"
            data-testid="account-menu-trigger"
            (click)="accountMenu.toggle($event)"
          >
            <span aria-hidden="true">{{ initials() }}</span>
          </button>
        </ng-template>
      </p-toolbar>

      <div class="ps-shell__grid">
        <nav class="ps-shell__left" aria-label="Primary">
          <p-panelMenu [model]="navMenu()" [multiple]="false" styleClass="ps-shell__menu" />
        </nav>

        <main class="ps-shell__main" id="main-content" tabindex="-1">
          <p-breadcrumb [model]="breadcrumbs()" [home]="breadcrumbHome" styleClass="ps-shell__crumbs" />
          <div class="ps-shell__outlet">
            <router-outlet />
          </div>
        </main>

        <div class="ps-shell__right">
          @defer (on viewport) {
            <lib-right-rail />
          } @placeholder {
            <div class="ps-shell__right-placeholder" aria-hidden="true"></div>
          }
        </div>
      </div>

      <footer class="ps-shell__footer" role="contentinfo">
        <span>© {{ year() }} Megabyte Labs</span>
        <span class="ps-shell__footer-links">
          <a routerLink="/privacy">Privacy</a>
          <a routerLink="/terms">Terms</a>
          <a routerLink="/status">Status</a>
          <a routerLink="/support">Support</a>
        </span>
        <span class="ps-shell__footer-meta">
          <span class="ps-shell__build">v{{ buildVersion }}</span>
          <span
            class="ps-shell__health"
            [class.is-ok]="healthy()"
            [attr.aria-label]="healthy() ? 'Edge healthy' : 'Edge offline'"
            data-testid="health-indicator"
          >
            <span class="ps-shell__health-dot" aria-hidden="true"></span>
            {{ healthy() ? 'live' : 'offline' }}
          </span>
        </span>
      </footer>
    </div>
  `,
  styleUrl: './dashboard-shell.component.css',
})
export class DashboardShellComponent implements OnInit, OnDestroy {
  protected readonly me = inject(MeStore);
  protected readonly role = inject(RoleService);
  protected readonly caps = inject(CapabilityService);
  protected readonly palette = inject(CommandPaletteService);
  private readonly notifications = inject(NotificationsStore);
  private readonly health = inject(HealthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly buildVersion: string = '2.0.0-alpha';

  readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly viewAs = computed(() => this.role.viewAs());
  readonly currentTenant = computed<Tenant | null>(() => this.me.currentTenant());
  readonly tenantOptions = computed<Tenant[]>(() => [...this.me.tenants()]);
  readonly showTenantSwitcher = computed(() => this.me.hasMultipleTenants());
  readonly healthy = computed(() => this.health.isHealthy());

  /** Online/offline (crew only). Local UI state pending API. */
  readonly online = signal(true);
  readonly showOnlineToggle = computed(() => this.viewAs() === 'crew');

  readonly initials = computed<string>(() => {
    const name = this.me.user()?.name ?? this.me.user()?.email ?? '?';
    return name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  });

  readonly year = signal<number>(new Date().getFullYear());

  readonly breadcrumbHome: MenuItem = { icon: 'pi pi-home', routerLink: '/dashboard' };

  readonly breadcrumbs = computed<MenuItem[]>(() => {
    const url = this.currentUrl().split('?')[0] ?? '/';
    const parts = url.split('/').filter(Boolean);
    if (parts[0] === 'dashboard') parts.shift();
    const out: MenuItem[] = [];
    let acc = '/dashboard';
    for (const p of parts) {
      acc += `/${p}`;
      out.push({ label: this.toTitle(p), routerLink: acc });
    }
    return out;
  });

  private readonly navDef: readonly NavItem[] = [
    { label: 'Bookings', route: ['/dashboard', 'bookings'], icon: 'pi pi-calendar', requires: 'bookings:read' },
    { label: 'Quotes', route: ['/dashboard', 'quotes'], icon: 'pi pi-file', requires: 'quotes:read' },
    { label: 'Jobs', route: ['/dashboard', 'jobs'], icon: 'pi pi-briefcase', requires: 'jobs:read' },
    { label: 'Crew', route: ['/dashboard', 'crew'], icon: 'pi pi-users', requires: 'crew:read' },
    { label: 'Sites', route: ['/dashboard', 'sites'], icon: 'pi pi-globe', requires: 'sites:read' },
    { label: 'Billing', route: ['/dashboard', 'billing'], icon: 'pi pi-credit-card', requires: 'billing:read' },
    { label: 'Team', route: ['/dashboard', 'team'], icon: 'pi pi-id-card', requires: 'users:read' },
    { label: 'Integrations', route: ['/dashboard', 'integrations'], icon: 'pi pi-link', requires: 'apps:read' },
    { label: 'Settings', route: ['/dashboard', 'settings'], icon: 'pi pi-cog', requires: 'settings:read' },
    { label: 'Admin', route: ['/dashboard', 'admin'], icon: 'pi pi-shield', requires: 'super_admin', superAdminOnly: true },
  ];

  readonly navMenu = computed<MenuItem[]>(() =>
    this.navDef
      .filter((n) => {
        if (n.superAdminOnly && (!this.me.isSuperAdmin() || this.viewAs() !== 'super_admin')) {
          return false;
        }
        return n.requires === null || this.caps.has(n.requires);
      })
      .map<MenuItem>((n) => ({
        label: n.label,
        icon: n.icon,
        routerLink: n.route,
        styleClass: `ps-nav__item ps-nav__item--${n.label.toLowerCase()}`,
      })),
  );

  readonly accountMenuItems = computed<MenuItem[]>(() => [
    { label: 'Profile', icon: 'pi pi-user', routerLink: ['/dashboard', 'settings', 'profile'] },
    { label: 'Settings', icon: 'pi pi-cog', routerLink: ['/dashboard', 'settings'] },
    { separator: true },
    { label: 'Sign out', icon: 'pi pi-sign-out', command: () => this.signOut() },
  ]);

  ngOnInit(): void {
    this.me.startRefresh();
    this.notifications.connect();
    this.health.connect();
  }

  ngOnDestroy(): void {
    this.me.stopRefresh();
    this.notifications.disconnect();
    this.health.disconnect();
  }

  onTenantSwitch(t: Tenant | null): void {
    if (!t || t.id === this.currentTenant()?.id) return;
    // TODO: lock in once the foundation lands — POST /api/me/tenant
    // then refetch /api/me to swap capabilities. For now, refresh.
    void this.me.fetch();
  }

  setOnline(next: boolean): void {
    this.online.set(next);
    // TODO: lock in once the foundation lands — POST /api/crew/availability
  }

  signOut(): void {
    if (typeof globalThis !== 'undefined') {
      globalThis.location.assign('/auth/sign-out');
    }
  }

  /** Cmd+K / Ctrl+K opens the palette globally. */
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const isPalette = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (!isPalette) return;
    event.preventDefault();
    this.palette.open();
  }

  private toTitle(slug: string): string {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Silences "unused" lint on the route injector while leaving it
   * available for child overlays / nested dialogs. */
  protected readonly _route = this.route;
}
