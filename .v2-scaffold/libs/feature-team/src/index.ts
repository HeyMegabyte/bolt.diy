/**
 * `@org/feature-team` — `/dashboard/team` admin surface.
 *
 * Workspace roles (owner / admin / member / viewer) overlaid with the
 * platform `Role` system (customer / crew / super_admin) per v2 §9.2.
 */
export * from './lib/team-page/team-page.component';
export * from './lib/invite-dialog/invite-dialog.component';
export * from './lib/pending-invites/pending-invites.component';
export * from './lib/role-edit-drawer/role-edit-drawer.component';
export * from './lib/active-sessions-view/active-sessions-view.component';
export * from './lib/team.routes';
