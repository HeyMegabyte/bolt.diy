/**
 * `@org/dashboard` — single dashboard shell + routes for v2.
 *
 * Public surface (consume from `apps/web`):
 *  - {@link dashboardRoutes} — drop-in `Routes` table for `/dashboard`
 *  - {@link DashboardShellComponent} — toolbar + left rail + outlet + right rail
 *  - {@link provideMeInitializer} — boot-time `/api/me` warmup
 *  - {@link CommandPaletteService} — imperative Cmd+K opener
 *  - {@link MeStore} / {@link RoleService} / {@link CapabilityService}
 */
export { dashboardRoutes } from './lib/dashboard.routes';
export { DashboardShellComponent } from './lib/dashboard-shell/dashboard-shell.component';
export { DashboardHomeComponent } from './lib/home/dashboard-home.component';
export { ChangelogComponent } from './lib/changelog/changelog.component';
export { RoleSwitcherComponent } from './lib/role-switcher/role-switcher.component';
export { NotificationsBellComponent } from './lib/notifications-bell/notifications-bell.component';
export { RightRailComponent } from './lib/right-rail/right-rail.component';
export {
  CommandPaletteComponent,
  CommandPaletteService,
} from './lib/command-palette/command-palette.component';

export { MeStore, provideMeInitializer } from './lib/services/me.store';
export { RoleService } from './lib/services/role.service';
export { CapabilityService } from './lib/services/capability.service';
export { NotificationsStore } from './lib/services/notifications.store';
export { HealthService } from './lib/services/health.service';
export { superAdminGuard } from './lib/guards/super-admin.guard';

export type {
  Capability,
  HealthFrame,
  Me,
  NotificationFrame,
  Role,
  Tenant,
  User,
  ViewAs,
} from './lib/types/domain';
