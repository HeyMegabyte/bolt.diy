import { type Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    // Cinematic landing — persona-aligned voice, animated OKLCH mesh, typing
    // AI pill that routes to /create. Bundle "Cinematic" finish, 2026-05-24.
    path: '',
    loadComponent: () =>
      import('./pages/homepage/cinematic/cinematic-landing.component').then(
        (m) => m.CinematicLandingComponent,
      ),
  },
  {
    // Previous A/B/C marketing homepage preserved as a fallback so any
    // existing inbound link, screenshot test, or PostHog event can still
    // reach it.
    path: 'classic',
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
        // /admin → new Perplexity-like AI dashboard. The bolt.diy editor
        // experience moved to /admin/editor (untouched). /admin/welcome
        // keeps the empty-state editor card around for onboarding links.
        path: '',
        loadComponent: () =>
          import('./pages/admin/sections/dashboard.component').then((m) => m.AdminDashboardComponent),
        pathMatch: 'full',
      },
      {
        path: 'welcome',
        loadComponent: () =>
          import('./pages/admin/sections/editor.component').then((m) => m.AdminEditorComponent),
      },
      {
        path: 'editor',
        loadComponent: () =>
          import('./pages/admin/sections/editor.component').then((m) => m.AdminEditorComponent),
      },
      {
        // Phase-1 native Angular port of the bolt.diy editor. Feature-flagged
        // via `localStorage['editor.native'] === 'true'` OR `?native=1`. The
        // host component renders an opt-in gate when neither flag is set.
        path: 'editor-native',
        loadComponent: () =>
          import('./editor-native/pages/editor-native-page.component').then(
            (m) => m.EditorNativePageComponent,
          ),
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
        // Side-by-side snapshot diff — `?from=A&to=B`. Lazy-chunked so the
        // `diff` rendering payload only ships when a user actually opens
        // the diff view.
        path: 'snapshots/diff',
        loadComponent: () =>
          import('./pages/admin/sections/snapshots-diff.component').then(
            (m) => m.AdminSnapshotsDiffComponent,
          ),
      },
      {
        // Per-site Web Vitals heatmap (item #3 — sortable LCP/CLS/INP/
        // Lighthouse columns, sparklines, triage view).
        path: 'sites',
        loadComponent: () =>
          import('./pages/admin/sections/sites.component').then(
            (m) => m.AdminSitesComponent,
          ),
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
        // Pulse Inbox — unified conversation hub (email + slack + discord +
        // telegram + website widget). 3-column layout with realtime WS
        // updates. Backend owned by sibling agent — routes/inbox.ts +
        // durable_objects/conversation_hub.ts.
        path: 'inbox',
        loadComponent: () =>
          import('./pages/admin/sections/inbox.component').then((m) => m.AdminInboxComponent),
      },
      {
        // One-click site-import — paste a URL, crawler runs source-site-
        // enhancement pre-pass + spins the generation workflow. Bundle C
        // finish (2026-05-24).
        path: 'import',
        loadComponent: () =>
          import('./pages/import-from-url/import-from-url.component').then(
            (m) => m.ImportFromUrlComponent,
          ),
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
      // ─── Apps store ───────────────────────────────────────────────
      // Catalog of self-hostable apps deployable to Cloudflare Workers
      // Containers in <5 min. List → detail → instances. All three lazy.
      // Order matters: more-specific routes (`apps/instances`, `apps/instances/:id`)
      // come BEFORE `apps/:id` so the param route doesn't swallow them.
      {
        path: 'apps',
        loadComponent: () =>
          import('./pages/admin/sections/apps.component').then((m) => m.AppsComponent),
      },
      {
        path: 'apps/instances',
        loadComponent: () =>
          import('./pages/admin/sections/apps-instances.component').then(
            (m) => m.AppInstancesComponent,
          ),
      },
      {
        path: 'apps/instances/:id',
        loadComponent: () =>
          import('./pages/admin/sections/apps-instances.component').then(
            (m) => m.AppInstanceDetailComponent,
          ),
      },
      {
        path: 'apps/:id',
        loadComponent: () =>
          import('./pages/admin/sections/apps-detail.component').then(
            (m) => m.AppDetailComponent,
          ),
      },
      // ─── Pulse Social ─────────────────────────────────────────────
      // Composer + scheduler for 11 social networks. Lazy-loaded — the
      // composer + preview surface only ships when /admin/social is
      // visited. Backend at apps/project-sites/src/routes/social.ts.
      {
        path: 'social',
        loadComponent: () =>
          import('./pages/admin/sections/social.component').then(
            (m) => m.AdminSocialComponent,
          ),
      },
      // ─── Pulse Analytics drill-downs ──────────────────────────────
      // Full-page versions of the dashboard SocialPerformance + InboxMetrics
      // widgets. Same data sources (/api/social/analytics/aggregate +
      // /api/inbox/metrics) with deeper breakdowns + window switcher.
      {
        path: 'social/analytics',
        loadComponent: () =>
          import('./pages/admin/sections/social-analytics.component').then(
            (m) => m.AdminSocialAnalyticsComponent,
          ),
      },
      {
        path: 'inbox/analytics',
        loadComponent: () =>
          import('./pages/admin/sections/inbox-analytics.component').then(
            (m) => m.AdminInboxAnalyticsComponent,
          ),
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
