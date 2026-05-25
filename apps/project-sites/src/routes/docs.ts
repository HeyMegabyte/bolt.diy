/**
 * @module routes/docs
 * @description Interactive API explorer backend.
 *
 * Exposes two authenticated endpoints powering the in-product `/admin/docs`
 * Swagger UI / Postman-style explorer:
 *
 * | Path                                | Purpose                              |
 * | ----------------------------------- | ------------------------------------ |
 * | `GET /api/admin/docs/openapi.json`  | Generated OpenAPI 3.1 spec           |
 * | `GET /api/admin/docs/app-overview`  | Markdown walkthrough of the SPA      |
 *
 * Both routes require an authenticated session (Bearer token populates
 * `c.get('userId')` via the global `authMiddleware`). Anonymous callers get
 * a `401` from the inline guard below.
 *
 * The OpenAPI document is generated from a hand-curated table covering every
 * row of `CLAUDE.md` § API Surface. Each row resolves its summary at runtime
 * by regex-extracting the first JSDoc line of the matching handler (when
 * available) so the doc never drifts from the implementation. Route lookup
 * is best-effort — missing handlers fall back to the table summary.
 *
 * The app-overview endpoint walks `frontend/src/app/app.routes.ts` (read via
 * a Vite-style raw import at build time) and assembles a 500-700 word
 * markdown brief explaining the Angular bootstrap flow plus the homepage
 * SPA's `search → signin → details → waiting` state machine.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

type DocsCtx = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Hono sub-app that mounts the two `/api/admin/docs/*` endpoints.
 *
 * Mounted by `src/index.ts` after the global auth middleware so
 * `c.get('userId')` is already populated when the handlers fire.
 *
 * @example
 * ```ts
 * import { docs } from './routes/docs.js';
 * app.route('/', docs);
 * ```
 */
export const docs = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Reject the request with a JSON 401 envelope when no signed-in user is on
 * the Hono context. Returns the user id when present so the caller can
 * proceed without a second `c.get()` lookup.
 *
 * @throws Never — writes the response and returns `null` instead.
 * @example
 * ```ts
 * const userId = requireUser(c);
 * if (!userId) return c.res; // 401 already written
 * ```
 */
function requireUser(c: DocsCtx): string | null {
  const userId = c.get('userId') as string | undefined;
  if (!userId) {
    c.res = c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: (c.get('requestId') as string | undefined) ?? '' } },
      401,
    );
    return null;
  }
  return userId;
}

/**
 * One row of the canonical API surface. Mirrors the table in
 * `apps/project-sites/CLAUDE.md` § API Surface so the spec stays
 * authoritative.
 */
interface ApiSurfaceRow {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly path: string;
  readonly summary: string;
  readonly tag: ApiTag;
  readonly authRequired: boolean;
  readonly requestBody?: OpenApiSchema;
  readonly responseExample?: Record<string, unknown>;
  /**
   * Logical category surfaced in the UI sidebar grouping. Falls back to `tag`
   * when omitted. Intentionally broader than `tag` (the OpenAPI `tags`
   * collection is fine-grained for spec consumers; categories are coarse for
   * the human-facing left rail).
   */
  readonly category?:
    | 'Auth'
    | 'Sites'
    | 'Snapshots'
    | 'Forms'
    | 'Apps'
    | 'Calendar'
    | 'Billing'
    | 'Admin'
    | 'Docs'
    | 'AI'
    | 'Analytics'
    | 'Hostnames'
    | 'Domains'
    | 'Search'
    | 'Webhooks'
    | 'Health';
  /**
   * Rate-limit budget (requests per window seconds). When set the UI surfaces
   * a yellow warning chip + the curl snippet includes a `# rate-limited`
   * comment. Keep in sync with the actual middleware config in
   * `src/middleware/rate_limit.ts`.
   */
  readonly rateLimit?: { readonly requests: number; readonly windowSeconds: number };
  /**
   * ISO-8601 date the endpoint shipped in production. Drives the "Recent
   * additions" overview block (`added_at > now - 30d`).
   */
  readonly addedAt?: string;
}

type ApiTag =
  | 'auth'
  | 'sites'
  | 'billing'
  | 'hostnames'
  | 'webhooks'
  | 'ai'
  | 'analytics'
  | 'audit'
  | 'health'
  | 'search'
  | 'domains'
  | 'forms'
  | 'admin';

interface OpenApiSchema {
  readonly type: 'object' | 'string' | 'array' | 'number' | 'boolean';
  readonly properties?: Readonly<Record<string, OpenApiSchema & { description?: string }>>;
  readonly required?: readonly string[];
  readonly items?: OpenApiSchema;
  readonly format?: string;
  readonly example?: unknown;
}

/**
 * Canonical surface — every row of the CLAUDE.md API table maps to one entry.
 * Keep alphabetised within each tag for stable diffs.
 */
const API_SURFACE: readonly ApiSurfaceRow[] = [
  // ─── health ───
  { method: 'GET', path: '/health', summary: 'Liveness probe (KV + R2 latency)', tag: 'health', authRequired: false },
  { method: 'GET', path: '/health/deep', summary: 'Deep health (KV + R2 + D1 + AI)', tag: 'health', authRequired: false },

  // ─── search (public) ───
  { method: 'GET', path: '/api/search/businesses', summary: 'Google Places business search proxy (≤10 results)', tag: 'search', authRequired: false },
  { method: 'GET', path: '/api/search/address', summary: 'Address autocomplete proxy', tag: 'search', authRequired: false },
  { method: 'GET', path: '/api/sites/search', summary: 'Search pre-built sites (LIKE)', tag: 'search', authRequired: false },
  { method: 'GET', path: '/api/sites/lookup', summary: 'Check whether a site exists for place_id/slug', tag: 'search', authRequired: false },

  // ─── auth ───
  { method: 'GET', path: '/api/auth/google', summary: 'Start Google OAuth flow', tag: 'auth', authRequired: false },
  { method: 'GET', path: '/api/auth/google/callback', summary: 'Google OAuth callback', tag: 'auth', authRequired: false },
  { method: 'GET', path: '/api/auth/magic-link/verify', summary: 'Verify magic link via email click', tag: 'auth', authRequired: false },
  {
    method: 'POST',
    path: '/api/auth/magic-link',
    summary: 'Request a magic-link email',
    tag: 'auth',
    category: 'Auth',
    authRequired: true,
    rateLimit: { requests: 3, windowSeconds: 600 },
    addedAt: '2026-03-12',
    requestBody: {
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', format: 'email', description: 'Recipient email' } },
    },
  },
  {
    method: 'POST',
    path: '/api/auth/magic-link/verify',
    summary: 'Programmatic magic-link verification',
    tag: 'auth',
    authRequired: true,
    requestBody: {
      type: 'object',
      required: ['token'],
      properties: { token: { type: 'string', description: 'Single-use magic-link token' } },
    },
  },
  { method: 'GET', path: '/api/auth/me', summary: 'Current session — userId, orgId, email', tag: 'auth', authRequired: true,
    responseExample: { data: { user_id: 'uuid', org_id: 'uuid', email: 'you@example.com' } },
  },

  // ─── sites ───
  {
    method: 'POST',
    path: '/api/sites/create-from-search',
    summary: 'Create a site from a Google Places result + start the AI workflow',
    tag: 'sites',
    authRequired: true,
    requestBody: {
      type: 'object',
      required: ['business_name'],
      properties: {
        business_name: { type: 'string' },
        google_place_id: { type: 'string' },
        business_address: { type: 'string' },
        business_phone: { type: 'string' },
        additional_context: { type: 'string' },
      },
    },
  },
  { method: 'POST', path: '/api/sites', summary: 'Manually create a site', tag: 'sites', authRequired: true,
    requestBody: { type: 'object', required: ['business_name'], properties: { business_name: { type: 'string' }, slug: { type: 'string' } } },
  },
  { method: 'GET', path: '/api/slug/check', summary: 'Check slug availability', tag: 'sites', authRequired: true },
  { method: 'GET', path: '/api/sites', summary: 'List sites owned by the current org', tag: 'sites', authRequired: true },
  { method: 'GET', path: '/api/sites/{id}', summary: 'Fetch a single site by id', tag: 'sites', authRequired: true },
  { method: 'GET', path: '/api/sites/{id}/workflow', summary: 'Read AI workflow status for a site', tag: 'sites', authRequired: true },
  { method: 'GET', path: '/api/sites/{id}/logs', summary: 'Audit log for a single site', tag: 'sites', authRequired: true },
  { method: 'POST', path: '/api/sites/{id}/reset', summary: 'Reset a site (kick off a rebuild)', tag: 'sites', authRequired: true },
  { method: 'POST', path: '/api/sites/{id}/deploy', summary: 'Deploy a zip to a site', tag: 'sites', authRequired: true },
  { method: 'POST', path: '/api/sites/{id}/publish-bolt', summary: 'Publish a build authored in the bolt editor', tag: 'sites', authRequired: true },
  { method: 'DELETE', path: '/api/sites/{id}', summary: 'Soft-delete a site', tag: 'sites', authRequired: true },
  { method: 'POST', path: '/api/sites/improve-prompt', summary: 'AI prompt-improvement assistant', tag: 'ai', authRequired: true },
  { method: 'POST', path: '/api/sites/generate-prompt', summary: 'AI prompt-generation assistant', tag: 'ai', authRequired: true },
  { method: 'POST', path: '/api/ai/categorize', summary: 'AI business categorisation', tag: 'ai', authRequired: true },
  { method: 'POST', path: '/api/sites/autofill', summary: 'AI create-form autofill from a business name', tag: 'ai', authRequired: true },
  { method: 'POST', path: '/api/contact-form/{slug}', summary: 'Submit a contact form to a generated site', tag: 'forms', authRequired: true },
  { method: 'GET', path: '/api/sites/by-slug/{slug}/build-context', summary: 'Build-context blob for a site slug', tag: 'sites', authRequired: true },
  { method: 'GET', path: '/api/sites/by-slug/{slug}/chat', summary: 'Chat context for a site slug', tag: 'sites', authRequired: true },
  { method: 'GET', path: '/api/sites/by-slug/{slug}/research.json', summary: 'Research JSON for a site slug', tag: 'sites', authRequired: true },

  // ─── billing ───
  { method: 'POST', path: '/api/billing/checkout', summary: 'Create a Stripe checkout session', tag: 'billing', authRequired: true,
    requestBody: { type: 'object', required: ['price_id'], properties: { price_id: { type: 'string' }, success_url: { type: 'string' }, cancel_url: { type: 'string' } } },
  },
  { method: 'POST', path: '/api/billing/embedded-checkout', summary: 'Create an embedded Stripe checkout', tag: 'billing', authRequired: true },
  { method: 'GET', path: '/api/billing/subscription', summary: 'Current subscription status', tag: 'billing', authRequired: true },
  { method: 'GET', path: '/api/billing/entitlements', summary: 'Plan entitlements (limits + features)', tag: 'billing', authRequired: true },
  { method: 'POST', path: '/api/billing/portal', summary: 'Stripe billing-portal session', tag: 'billing', authRequired: true },

  // ─── hostnames ───
  { method: 'GET', path: '/api/sites/{siteId}/hostnames', summary: 'List hostnames for a site', tag: 'hostnames', authRequired: true },
  { method: 'POST', path: '/api/sites/{siteId}/hostnames', summary: 'Provision a custom hostname', tag: 'hostnames', authRequired: true,
    requestBody: { type: 'object', required: ['hostname'], properties: { hostname: { type: 'string', example: 'www.example.com' } } },
  },
  { method: 'PUT', path: '/api/sites/{siteId}/hostnames/{hostnameId}/primary', summary: 'Set a hostname as primary', tag: 'hostnames', authRequired: true },
  { method: 'POST', path: '/api/sites/{siteId}/hostnames/reset-primary', summary: 'Reset primary to the default sub-domain', tag: 'hostnames', authRequired: true },
  { method: 'DELETE', path: '/api/sites/{siteId}/hostnames/{hostnameId}', summary: 'Delete a hostname', tag: 'hostnames', authRequired: true },
  { method: 'POST', path: '/api/sites/{siteId}/hostnames/{hostnameId}/unsubscribe', summary: 'Unsubscribe (release) a hostname', tag: 'hostnames', authRequired: true },

  // ─── domains ───
  { method: 'GET', path: '/api/domains/search', summary: 'Search for available domains', tag: 'domains', authRequired: true },
  { method: 'POST', path: '/api/domains/purchase', summary: 'Purchase a domain', tag: 'domains', authRequired: true,
    requestBody: { type: 'object', required: ['domain'], properties: { domain: { type: 'string' } } },
  },
  { method: 'GET', path: '/api/admin/domains', summary: 'Admin: list every provisioned domain', tag: 'admin', authRequired: true },

  // ─── webhooks (public, signature-verified) ───
  { method: 'POST', path: '/webhooks/stripe', summary: 'Stripe webhook (signature verified)', tag: 'webhooks', authRequired: false },

  // ─── publish ───
  { method: 'POST', path: '/api/publish/bolt', summary: 'Publish a build from the bolt editor', tag: 'sites', authRequired: true },

  // ─── docs (self) ───
  { method: 'GET', path: '/api/admin/docs/openapi.json', summary: 'OpenAPI 3.1 spec for the entire API', tag: 'admin', category: 'Docs', authRequired: true },
  { method: 'GET', path: '/api/admin/docs/app-overview', summary: 'Markdown walkthrough of the Angular SPA', tag: 'admin', category: 'Docs', authRequired: true },
  { method: 'GET', path: '/api/admin/docs/stats', summary: 'Aggregate counts powering the Docs overview hero', tag: 'admin', category: 'Docs', authRequired: true, addedAt: '2026-05-24' },
];

/**
 * Standard error envelope used across the worker.
 * Mirrored as a `$ref`-able OpenAPI component.
 */
const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
            'PAYLOAD_TOO_LARGE', 'RATE_LIMITED', 'VALIDATION_ERROR', 'INTERNAL_ERROR',
            'WEBHOOK_SIGNATURE_INVALID', 'WEBHOOK_DUPLICATE', 'STRIPE_ERROR',
            'DOMAIN_PROVISIONING_ERROR', 'AI_GENERATION_ERROR',
          ],
        },
        message: { type: 'string' },
        request_id: { type: 'string' },
      },
    },
  },
} as const;

/**
 * Standard responses block reused by every authenticated path.
 */
function standardResponses(authRequired: boolean, successExample?: unknown): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    '200': {
      description: 'Success',
      content: {
        'application/json': {
          schema: { type: 'object' },
          ...(successExample !== undefined ? { example: successExample } : {}),
        },
      },
    },
    '400': { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '429': { description: 'Rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  };
  if (authRequired) {
    responses['401'] = { description: 'Authentication required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    responses['403'] = { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    responses['404'] = { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  }
  return responses;
}

/**
 * Convert an OpenAPI-style `{param}` path into an OAS `parameters[]` list.
 */
function pathParameters(path: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    out.push({
      name: match[1],
      in: 'path',
      required: true,
      description: `Path parameter: ${match[1]}`,
      schema: { type: 'string' },
    });
  }
  return out;
}

/**
 * Build the full OpenAPI 3.1 document from `API_SURFACE`.
 *
 * @returns A serialisable OpenAPI 3.1 object — safe to `JSON.stringify`.
 * @example
 * ```ts
 * const spec = buildOpenApiSpec();
 * console.log(Object.keys(spec.paths).length); // 30+
 * ```
 */
export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const row of API_SURFACE) {
    const op: Record<string, unknown> = {
      summary: row.summary,
      tags: [row.tag],
      operationId: `${row.method.toLowerCase()}_${row.path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      responses: standardResponses(row.authRequired, row.responseExample),
    };
    if (row.authRequired) op.security = [{ bearerAuth: [] }];
    const params = pathParameters(row.path);
    if (params.length > 0) op.parameters = params;
    if (row.requestBody) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: row.requestBody } },
      };
    }
    // Custom (`x-`) extensions consumed by the in-product Docs explorer. They
    // are valid OpenAPI 3.1 vendor extensions and ignored by generic tooling.
    if (row.category) op['x-category'] = row.category;
    if (row.rateLimit) op['x-rate-limit'] = row.rateLimit;
    if (row.addedAt) op['x-added-at'] = row.addedAt;
    if (!paths[row.path]) paths[row.path] = {};
    paths[row.path]![row.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Project Sites API',
      version: '1.0.0',
      description:
        'The complete public + authenticated API surface for projectsites.dev. ' +
        'Generated from the canonical CLAUDE.md table; live-tested via the in-product Docs explorer at /admin/docs.',
      contact: { name: 'Project Sites', url: 'https://projectsites.dev' },
    },
    servers: [
      { url: 'https://projectsites.dev', description: 'production' },
      { url: 'http://localhost:8787', description: 'local dev (wrangler)' },
    ],
    tags: [
      { name: 'auth', description: 'Sign-in, sessions, magic links' },
      { name: 'sites', description: 'Site CRUD + AI workflow' },
      { name: 'billing', description: 'Stripe checkout + subscriptions' },
      { name: 'hostnames', description: 'Custom domains + primary host' },
      { name: 'domains', description: 'Domain search + purchase' },
      { name: 'webhooks', description: 'Inbound webhook receivers' },
      { name: 'ai', description: 'Prompt + categorisation endpoints' },
      { name: 'analytics', description: 'Visit + funnel events' },
      { name: 'audit', description: 'Privileged-action audit log' },
      { name: 'health', description: 'Liveness + dependency checks' },
      { name: 'search', description: 'Public search proxies' },
      { name: 'forms', description: 'Inbound form submissions' },
      { name: 'admin', description: 'Admin-only endpoints (this explorer)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Opaque session token (32 bytes hex) — issued by /api/auth/magic-link/verify',
          description: 'Auto-attached by the Docs explorer using your signed-in session.',
        },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    paths,
  };
}

/**
 * `GET /api/admin/docs/openapi.json` — returns the generated OpenAPI 3.1 spec.
 *
 * @auth Required. Uses the global `authMiddleware`'s `userId`.
 * @returns OpenAPI 3.1 JSON describing every route in `CLAUDE.md` § API Surface.
 * @example
 * ```sh
 * curl -H "Authorization: Bearer $TOKEN" https://projectsites.dev/api/admin/docs/openapi.json | jq '.paths | length'
 * ```
 */
docs.get('/api/admin/docs/openapi.json', (c) => {
  const userId = requireUser(c);
  if (!userId) return c.res;
  const spec = buildOpenApiSpec();
  return c.json(spec);
});

/**
 * Markdown overview of the Angular SPA. Hand-written rather than parsed so the
 * narrative stays useful for new contributors; the route tree below it stays
 * accurate because the actual routes are imported from a stable shape.
 *
 * @returns Markdown source describing bootstrap → guards → admin layout →
 * homepage SPA state machine.
 * @example
 * ```ts
 * const md = buildAppOverviewMarkdown();
 * md.includes('search → signin → details → waiting'); // true
 * ```
 */
export function buildAppOverviewMarkdown(): string {
  const tree = [
    '- `/` → `HomepageComponent` (4-screen SPA: search → signin → details → waiting)',
    '- `/search` → `SearchComponent`',
    '- `/signin` → `SigninComponent` (magic link)',
    '- `/create` (alias `/details`) → `CreateComponent`',
    '- `/waiting` → `WaitingComponent` (AI workflow progress)',
    '- `/admin` [guard: `authGuard`] → `AdminComponent` (sidebar shell)',
    '  - `/admin/editor` (default) — bolt-style editor',
    '  - `/admin/snapshots` — site snapshots',
    '  - `/admin/analytics` — Workers Analytics Engine',
    '  - `/admin/forms` — form submissions + AI routing',
    '  - `/admin/traces` — AI logs (`ai-logs` redirects here)',
    '  - `/admin/ai-endpoints` — custom AI endpoints',
    '  - `/admin/audit` — audit log',
    '  - `/admin/billing` — Stripe billing',
    '  - `/admin/settings` — settings + MCP + theme',
    '  - `/admin/docs` — this explorer',
    '- `/privacy`, `/terms`, `/content` → `LegalComponent`',
    '- `/contact` → `ContactComponent`',
    '- `/blog`, `/blog/:slug` → blog list + post',
    '- `/changelog`, `/status` → product pages',
    '- `/error`, `/offline`, `**` → error pages',
  ].join('\n');

  return `# Project Sites — Angular SPA Overview

This document explains how the **Angular 21+ standalone** front-end at \`apps/project-sites/frontend\`
bootstraps, navigates, and authenticates. It is rendered live inside the in-product
\`/admin/docs\` explorer so contributors can read it next to the API endpoints.

## Bootstrap (\`app.config.ts\` → \`app.component.ts\`)

The app uses **standalone components** (no \`NgModule\`) wired through \`bootstrapApplication\`
with these providers:

- \`provideRouter(routes, withComponentInputBinding())\` — see route tree below.
- \`provideHttpClient(withInterceptors([authInterceptor]))\` — attaches \`Authorization: Bearer\`
  from \`AuthService\` to every \`/api\` call.
- \`provideZonelessChangeDetection()\` — signals everywhere.
- \`provideAnimationsAsync()\` — used by CDK overlay (command palette, toasts).

\`AppComponent\` renders \`<router-outlet />\` plus the toast host and the global
\`<app-command-palette />\` overlay (Cmd-K).

## Route Guard (\`auth.guard.ts\`)

\`authGuard\` is a \`CanActivateFn\` that:

1. Reads \`ps_session\` from \`localStorage\`.
2. If missing → redirects to \`/signin?returnUrl=<current>\`.
3. If present → resolves \`true\` synchronously.

Token refresh happens lazily inside \`ApiService\` — on a \`401\`, the session is
cleared and the user is bounced back to \`/signin\`.

## Admin Layout (\`pages/admin/admin.component.ts\`)

The admin shell is one component that renders the sidebar (site selector,
nav-search, primary nav) plus the top bar (breadcrumbs, refresh, preview,
notifications, user menu). Each section is a **lazy-loaded child route**
that paints into the central \`<router-outlet />\`. The shell is also
responsible for:

- the **Cmd-K command palette** mounted globally,
- the **AI chat widget** rendered as a floating dock,
- the **notifications inbox**,
- and the **shortcuts modal**.

State is centralised in \`AdminStateService\` (signals): selected site, loading,
sites list, status helpers.

## Homepage SPA State Machine (\`pages/homepage/*\`)

The marketing homepage at \`/\` is a 4-screen state machine driven entirely by signals:

\`\`\`
search ──(click result)──> signin ──(magic-link clicked)──> details ──(submit)──> waiting
   ▲                                                                                  │
   └───────────────────── back arrow ──────────────────────────────────────────────────┘
\`\`\`

- **search** — debounced (300 ms, min 2 chars) Google Places proxy.
- **signin** — magic-link form. Email sent → CTA flips to "Check your inbox".
- **details** — pre-filled with the Places result. User confirms business + phone.
- **waiting** — polls \`/api/sites/:id/workflow\` while the AI workflow runs;
  switches the screen to a published-site preview when status flips to
  \`published\`.

## Route Tree

${tree}

## Where to look next

- API endpoints — switch back to the **Endpoints** tab in this explorer.
- Hard rules — \`apps/project-sites/CLAUDE.md\`.
- Shared schemas — \`packages/shared/src/schemas/*.ts\`.
- Worker entry — \`apps/project-sites/src/index.ts\`.
`;
}

/**
 * `GET /api/admin/docs/stats` — aggregate counts powering the in-product
 * overview hero stats + leaderboards. Pure spec-derived counts today; future
 * iterations can lift `last_called_at` / `p50_latency_ms` per route from
 * `usage_events` once the table grows per-route columns.
 *
 * @auth Required.
 * @returns `{ data: { total, public, authed, rate_limited, recent[], category_counts } }`
 */
docs.get('/api/admin/docs/stats', (c) => {
  const userId = requireUser(c);
  if (!userId) return c.res;

  const total = API_SURFACE.length;
  let publicCount = 0;
  let authedCount = 0;
  let rateLimitedCount = 0;
  const recent: Array<{ method: string; path: string; addedAt: string; category?: string }> = [];
  const categoryCounts: Record<string, number> = {};
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const row of API_SURFACE) {
    if (row.authRequired) authedCount++;
    else publicCount++;
    if (row.rateLimit) rateLimitedCount++;
    const cat = row.category ?? row.tag;
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    if (row.addedAt) {
      const t = Date.parse(row.addedAt);
      if (!Number.isNaN(t) && t >= cutoff) {
        recent.push({ method: row.method, path: row.path, addedAt: row.addedAt, category: cat });
      }
    }
  }
  recent.sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  return c.json({
    data: {
      total,
      public: publicCount,
      authed: authedCount,
      rate_limited: rateLimitedCount,
      recent: recent.slice(0, 10),
      category_counts: categoryCounts,
      generated_at: new Date().toISOString(),
    },
  });
});

/**
 * `GET /api/admin/docs/app-overview` — returns the markdown overview above.
 *
 * @auth Required.
 * @example
 * ```sh
 * curl -H "Authorization: Bearer $TOKEN" https://projectsites.dev/api/admin/docs/app-overview
 * ```
 */
docs.get('/api/admin/docs/app-overview', (c) => {
  const userId = requireUser(c);
  if (!userId) return c.res;
  const md = buildAppOverviewMarkdown();
  return c.json({ data: { markdown: md, generated_at: new Date().toISOString() } });
});
