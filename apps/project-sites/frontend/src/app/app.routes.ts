import { type Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { featureFlagGuard } from './services/feature-flag.service';

export const routes: Routes = [
  {
    // Marketing homepage — classic A/B/C surface restored as the default
    // per 2026-05-28 user directive. All navigation stays SPA-only inside
    // the AppComponent shell (no full page reloads on internal nav).
    path: '',
    loadComponent: () =>
      import('./pages/homepage/homepage.component').then((m) => m.HomepageComponent),
  },
  {
    // Backward-compat alias: any old link to /classic still resolves to
    // the same homepage component (no 404 for inbound PostHog events /
    // screenshot tests / external bookmarks).
    path: 'classic',
    redirectTo: '',
    pathMatch: 'full',
  },
  {
    // Super-admin — gated server-side on `users.is_super_admin = 1` (the
    // worker routes return 403 to non-super-admins; the component shows a
    // "Restricted" page). Operator console for cost × markup_factor tuning
    // + wallet drill-down + manual adjustments. Sibling to customer-facing
    // /admin/billing — different audience, different surface.
    path: 'super-admin',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/super-admin/super-admin.component').then((m) => m.SuperAdminComponent),
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
    // Spartan UI admin shell (Wave C) — the rebuilt dashboard, hidden/opt-in
    // ("v2") so the legacy admin stays the default until each module is
    // verified + promoted. Declared BEFORE `admin` so `/admin/v2` matches
    // this standalone shell, not an `admin` child. authGuard-gated.
    path: 'admin/v2',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/admin-v2/admin-v2-shell.component').then((m) => m.AdminV2ShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin-v2/sections/sites.component').then((m) => m.V2SitesComponent),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./pages/admin-v2/sections/analytics.component').then((m) => m.V2AnalyticsComponent),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import('./pages/admin-v2/sections/domains.component').then((m) => m.V2DomainsComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/admin-v2/sections/settings.component').then((m) => m.V2SettingsComponent),
      },
    ],
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
        // Phase-1 native Angular port of the bolt.diy editor. Server-side
        // flag-gated via `native_editor` flag — admin can killswitch without
        // redeploy. Guard redirects to /admin/feature-flags?disabled=native_editor
        // when off. Local opt-in (`localStorage['editor.native']` or `?native=1`)
        // is preserved inside the component itself for developer testing.
        path: 'editor-native',
        canActivate: [featureFlagGuard('native_editor')],
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
        // Per-site detail page with 4 tabs (Logs / Snapshots+Rollback / SQL /
        // Integrations). Closes TEST-PLAN.md TAB-01..TAB-13.
        path: 'sites/:id',
        loadComponent: () =>
          import('./pages/admin/sections/site-detail.component').then(
            (m) => m.AdminSiteDetailComponent,
          ),
      },
      {
        // Branch-style site previews — /admin/sites/:id/branches (#27)
        path: 'sites/:id/branches',
        loadComponent: () =>
          import('./pages/admin/sections/site-branches.component').then(
            (m) => m.SiteBranchesComponent,
          ),
      },
      {
        // Per-site MCP server management — /admin/sites/:id/mcp-server (#29)
        path: 'sites/:id/mcp-server',
        loadComponent: () =>
          import('./pages/admin/sections/site-mcp-server.component').then(
            (m) => m.SiteMcpServerComponent,
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
        // Public API token management — create / list / revoke psk_* tokens.
        // Backend: GET|POST|DELETE /api/v1-tokens; flag-gated: public_api_v1.
        path: 'api-tokens',
        loadComponent: () =>
          import('./pages/admin/sections/api-tokens.component').then((m) => m.AdminApiTokensComponent),
      },
      {
        // Feature flag registry browser + admin override editor.
        // Reads from GET /api/feature-flags, supports filter / search / toggle.
        path: 'feature-flags',
        loadComponent: () =>
          import('./pages/admin/sections/feature-flags.component').then((m) => m.AdminFeatureFlagsComponent),
      },
      {
        // Content Freshness — Feature #16. AI rewrite drafts for idle sections.
        // Daily cron (0 6 * * *) scans stale sections; owner approves here.
        path: 'content-freshness',
        loadComponent: () =>
          import('./pages/admin/sections/content-freshness.component').then(
            (m) => m.AdminContentFreshnessComponent,
          ),
      },
      {
        // pSEO Matrix Builder — Feature #17. service×city×intent×season pages.
        // Trigger generation per site; approve/publish via this grid.
        path: 'pseo',
        loadComponent: () =>
          import('./pages/admin/sections/pseo.component').then((m) => m.AdminPseoComponent),
      },
      {
        // SEO — Meta Tags, Google Search Preview, OG/Twitter cards, JSON-LD per
        // route. Companion surface to the seo_autopilot feature module; landing
        // page for the autopilot draft-approval flow. Component existed
        // standalone but was orphaned (not routed) — wired 2026-05-28.
        path: 'seo',
        loadComponent: () =>
          import('./pages/admin/sections/seo.component').then((m) => m.AdminSeoComponent),
      },
      {
        // Features Hub — every shipped feature in one searchable surface.
        // Tabbed by theme (Stack / CWV / GEO / A11y / Editor / Monetize /
        // Observability / Media / Platform / Gaps). Per-card flag state +
        // "Try it" buttons that hit the real endpoints.
        path: 'features',
        loadComponent: () =>
          import('./pages/admin/sections/features-hub.component').then((m) => m.AdminFeaturesHubComponent),
      },
      {
        path: 'forms',
        loadComponent: () =>
          import('./pages/admin/sections/forms.component').then((m) => m.AdminFormsComponent),
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
        // AI Agents (née "Endpoints"). DUAL-MOUNT: the component renders here
        // as a full-page standalone (for /admin/ai-endpoints deep links +
        // bookmarks) AND inside the in-editor tab strip overlay
        // (admin.component.html → `<app-admin-ai-endpoints [compact]="true">`)
        // when the user selects the Agents tab on /admin/editor. The
        // component honors a `compact` input that shrinks chrome for the
        // overlay surface — see `.agents--compact` styles in the component.
        path: 'ai-endpoints',
        loadComponent: () =>
          import('./pages/admin/sections/ai-endpoints.component').then((m) => m.AdminAiEndpointsComponent),
      },
      {
        // Voice — phone numbers, unified call+SMS conversations timeline,
        // browser-mic test console, agent prompt editor + immutable
        // safety meta-prompt, MCP attachments, share surface. Top-level
        // shell lazy-loads sub-components on demand.
        path: 'voice',
        loadComponent: () =>
          import('./pages/admin/sections/voice.component').then((m) => m.VoiceComponent),
      },
      {
        // Media — Library + Stock Search + Image/Video/Podcast Studios.
        // DUAL-MOUNT: this route renders the component standalone with full
        // chrome (for /admin/media deep links + bookmarks + the global
        // drag-and-drop overlay's post-upload landing). The SAME component
        // also renders inside the in-editor tab strip overlay
        // (admin.component.html → `<app-admin-media [compact]="true">`)
        // when the user selects the Media tab on /admin/editor. The
        // component honors a `compact` input that shrinks chrome for the
        // overlay surface — see `.media--compact` styles in the component.
        path: 'media',
        loadComponent: () =>
          import('./pages/admin/sections/media.component').then((m) => m.AdminMediaComponent),
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
      // Domain Stack Wizard — 7-tile progress board (DNS→SSL→email-auth→GSC).
      // Feature-flagged: domain_stack_wizard.
      {
        path: 'domains/:id/stack',
        loadComponent: () =>
          import('./pages/admin/sections/domain-stack.component').then((m) => m.AdminDomainStackComponent),
      },
      // Worker Tail Log Explorer — 30-day FTS + cost attribution per route.
      // Feature-flagged: log_explorer.
      {
        path: 'logs',
        loadComponent: () =>
          import('./pages/admin/sections/logs-explorer.component').then((m) => m.AdminLogsExplorerComponent),
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
      // Full-page version of the dashboard SocialPerformance widget.
      // Same data source (/api/social/analytics/aggregate) with deeper
      // breakdowns + window switcher.
      {
        path: 'social/analytics',
        loadComponent: () =>
          import('./pages/admin/sections/social-analytics.component').then(
            (m) => m.AdminSocialAnalyticsComponent,
          ),
      },
      // ─── Unified Visitor Inbox (#24) ──────────────────────────────
      // 3-pane: conversation list + thread + AI-draft panel.
      // Flag-gated: unified_inbox. Shows gate notice when off.
      {
        path: 'inbox',
        loadComponent: () =>
          import('./pages/admin/sections/inbox.component').then(
            (m) => m.AdminInboxComponent,
          ),
      },
      // ─── Multimodal AI Site Copilot (#25) ────────────────────────
      // Per-site copilot admin: enable toggle + intent distribution + sessions.
      // Flag-gated: multimodal_copilot. Shows gate notice when off.
      {
        path: 'sites/:id/copilot',
        loadComponent: () =>
          import('./pages/admin/sections/site-copilot.component').then(
            (m) => m.AdminSiteCopilotComponent,
          ),
      },
      // ─── Site DNA Taste Graph (#7) ────────────────────────────────
      // Per-site taste-signal admin: feedback history + preference bars +
      // manual feedback form. Flag-gated: site_dna_taste_graph.
      {
        path: 'sites/:id/dna',
        loadComponent: () =>
          import('./pages/admin/sections/site-dna.component').then(
            (m) => m.AdminSiteDnaComponent,
          ),
      },
      // ── Swarm-stream-marketplace-DNA (Wave 2C — features #5-8) ─────────
      {
        // #5 Multi-Agent Swarm Editor + #6 Live-stream Preview.
        // Per-site live board; :siteId is the slug or UUID.
        path: 'swarm/:siteId',
        loadComponent: () =>
          import('./pages/admin/sections/swarm.component').then(
            (m) => m.AdminSwarmComponent,
          ),
      },
      {
        // #8 Vertical Section Marketplace — /admin/marketplace
        path: 'marketplace',
        loadComponent: () =>
          import('./pages/admin/sections/marketplace.component').then(
            (m) => m.AdminMarketplaceComponent,
          ),
      },
      {
        // #50 Trust Center — /admin/trust
        path: 'trust',
        loadComponent: () =>
          import('./pages/admin/sections/trust-center.component').then(
            (m) => m.AdminTrustCenterComponent,
          ),
      },
      {
        // #44 Enterprise Plan — /admin/enterprise
        path: 'enterprise',
        loadComponent: () =>
          import('./pages/admin/sections/enterprise.component').then(
            (m) => m.AdminEnterpriseComponent,
          ),
      },
      {
        // #36 Stripe App Marketplace status — /admin/stripe-app-status
        path: 'stripe-app-status',
        loadComponent: () =>
          import('./pages/admin/sections/stripe-app-status.component').then(
            (m) => m.AdminStripeAppStatusComponent,
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
    // Public roadmap page — Trello-style 4-column board backed by
    // /api/public/roadmap. Lazy-loaded so the marketing surfaces never pay
    // for the board CSS until the user clicks through.
    path: 'roadmap',
    loadComponent: () =>
      import('./pages/roadmap/roadmap.component').then((m) => m.RoadmapComponent),
  },
  {
    // Public integrations catalog — every third-party service the platform
    // speaks to. Filterable + searchable, backed by
    // /api/public/integrations. Lazy-loaded.
    path: 'integrations',
    loadComponent: () =>
      import('./pages/integrations/integrations.component').then(
        (m) => m.IntegrationsComponent,
      ),
  },
  {
    // Public press kit — 8-slide 1920×1080 cinematic picture walkthrough,
    // brand assets, founder bio, fact sheet, press releases, media contacts.
    // Lazy-loaded so press traffic doesn't pay for the walkthrough chunk
    // until requested.
    path: 'press',
    loadComponent: () =>
      import('./pages/press/press.component').then((m) => m.PressComponent),
  },
  {
    path: 'status',
    loadComponent: () =>
      import('./pages/status/status.component').then((m) => m.StatusComponent),
  },
  {
    // Inline checkout harness — mounts <app-inline-checkout> with a fixed
    // amount so Playwright can drive the 1-click Stripe Link flow under
    // the brian@megabyte.space stub. Production traffic also lands here
    // when a "Buy credits" CTA is clicked.
    path: 'checkout',
    loadComponent: () =>
      import('./pages/checkout/checkout.component').then((m) => m.CheckoutComponent),
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
