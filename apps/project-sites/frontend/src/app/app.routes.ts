import { type Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/homepage/homepage.component').then((m) => m.HomepageComponent),
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./pages/search/search.component').then((m) => m.SearchComponent),
  },
  {
    path: 'signin',
    loadComponent: () =>
      import('./pages/signin/signin.component').then((m) => m.SigninComponent),
  },
  {
    path: 'create',
    loadComponent: () =>
      import('./pages/create/create.component').then((m) => m.CreateComponent),
  },
  {
    path: 'details',
    redirectTo: 'create',
  },
  {
    path: 'waiting',
    loadComponent: () =>
      import('./pages/waiting/waiting.component').then((m) => m.WaitingComponent),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/admin/admin.component').then((m) => m.AdminComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/sections/editor.component').then((m) => m.AdminEditorComponent),
        pathMatch: 'full',
      },
      {
        path: 'editor',
        loadComponent: () =>
          import('./pages/admin/sections/editor.component').then((m) => m.AdminEditorComponent),
      },
      { path: 'dashboard', redirectTo: '', pathMatch: 'full' },
      {
        // Team invite acceptance landing — reads ?token=… and POSTs to backend.
        path: 'accept-invite',
        loadComponent: () =>
          import('./pages/admin/sections/accept-invite.component').then((m) => m.AdminAcceptInviteComponent),
      },
      {
        path: 'snapshots',
        loadComponent: () =>
          import('./pages/admin/sections/snapshots.component').then((m) => m.AdminSnapshotsComponent),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./pages/admin/sections/analytics.component').then((m) => m.AdminAnalyticsComponent),
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./pages/admin/sections/billing.component').then((m) => m.AdminBillingComponent),
      },
      {
        path: 'audit',
        loadComponent: () =>
          import('./pages/admin/sections/audit.component').then((m) => m.AdminAuditComponent),
      },
      {
        path: 'forms',
        loadComponent: () =>
          import('./pages/admin/sections/forms.component').then((m) => m.AdminFormsComponent),
      },
      {
        // Interactive API explorer (OpenAPI 3.1). Shell hosts the left-rail
        // endpoint nav + a `<router-outlet>`; per-endpoint detail is its own
        // lazy chunk so the overview reader never pays for the Try-It UI.
        path: 'docs',
        loadComponent: () =>
          import('./pages/admin/sections/docs.component').then((m) => m.AdminDocsComponent),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/sections/docs/docs-overview.component').then(
                (m) => m.DocsOverviewComponent,
              ),
          },
          {
            // `/admin/docs/:endpointId` — `:endpointId` is the OpenAPI
            // `operationId` (e.g. `get_api_auth_me`, `post_api_sites`). The
            // child component looks the op up via `DocsSpecService.findById`
            // and renders a 404 card if no match is found.
            path: ':endpointId',
            loadComponent: () =>
              import('./pages/admin/sections/docs/docs-endpoint.component').then(
                (m) => m.DocsEndpointComponent,
              ),
          },
        ],
      },
      // ai-chat moved into Settings as a tab — keep redirect for old links.
      { path: 'ai-chat', redirectTo: 'settings#ai-chat', pathMatch: 'full' },
      {
        path: 'traces',
        loadComponent: () =>
          import('./pages/admin/sections/ai-logs.component').then((m) => m.AdminAiLogsComponent),
      },
      // Old name kept for any deep links / bookmarks.
      { path: 'ai-logs', redirectTo: 'traces', pathMatch: 'full' },
      {
        path: 'ai-endpoints',
        loadComponent: () =>
          import('./pages/admin/sections/ai-endpoints.component').then((m) => m.AdminAiEndpointsComponent),
      },
      { path: 'mcp', redirectTo: 'settings/mcp', pathMatch: 'full' },
      { path: 'github', redirectTo: 'snapshots', pathMatch: 'full' },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/admin/sections/settings.component').then((m) => m.AdminSettingsComponent),
      },
      {
        // User-level preferences: theme + API keys. Distinct from per-project
        // settings — switching projects must NOT touch personal preferences.
        path: 'user',
        loadComponent: () =>
          import('./pages/admin/sections/user-settings.component').then((m) => m.AdminUserSettingsComponent),
      },
      // Per-project Domain Management — backup subdomain + AI creative search
      // + connected domains table with transfer-out flow. See
      // sections/domains.component.ts.
      {
        path: 'domains',
        loadComponent: () =>
          import('./pages/admin/sections/domains.component').then((m) => m.AdminDomainsComponent),
      },
    ],
  },
  {
    path: 'editor/:slug',
    redirectTo: 'admin/editor',
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/legal/legal.component').then((m) => m.LegalComponent),
    data: { type: 'privacy' },
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./pages/legal/legal.component').then((m) => m.LegalComponent),
    data: { type: 'terms' },
  },
  {
    path: 'content',
    loadComponent: () =>
      import('./pages/legal/legal.component').then((m) => m.LegalComponent),
    data: { type: 'content' },
  },
  {
    path: 'contact',
    loadComponent: () =>
      import('./pages/contact/contact.component').then((m) => m.ContactComponent),
  },
  {
    path: 'billing',
    redirectTo: 'admin/billing',
  },
  {
    path: 'blog',
    loadComponent: () =>
      import('./pages/blog/blog-list.component').then((m) => m.BlogListComponent),
  },
  {
    path: 'blog/:slug',
    loadComponent: () =>
      import('./pages/blog/blog-post.component').then((m) => m.BlogPostComponent),
  },
  {
    path: 'changelog',
    loadComponent: () =>
      import('./pages/changelog/changelog.component').then((m) => m.ChangelogComponent),
  },
  {
    path: 'status',
    loadComponent: () =>
      import('./pages/status/status.component').then((m) => m.StatusComponent),
  },
  {
    path: 'error',
    loadComponent: () =>
      import('./pages/error/server-error.component').then((m) => m.ServerErrorComponent),
  },
  {
    path: 'offline',
    loadComponent: () =>
      import('./pages/error/offline.component').then((m) => m.OfflineComponent),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./pages/error/not-found.component').then((m) => m.NotFoundComponent),
  },
];
