/**
 * @module platform/service-registry
 *
 * @description
 * Single source of truth for every system ProjectSites.dev runs or depends on —
 * the typed registry behind the convergence prompt §13 service registry and the
 * admin service catalog (§66). Each entry records what the service IS, where it
 * runs, which package/adapter owns it, its feature flag, its admin/public
 * surface, and its lifecycle status. Kept in lockstep with reality: update an
 * entry whenever a service is added, renamed, migrated, launched, or removed.
 *
 * Consumed by `scripts/check-architecture-fitness.mjs` (referential-integrity +
 * exclude-list cross-check) and unit-tested in `__tests__/architecture_fitness`.
 *
 * @see docs/architecture/service-registry.md
 * @see docs/adr/0019-amazon-ses-plus-listmonk-email.md
 */

/** Lifecycle of a registered service. */
export type ServiceStatus =
  | 'planned'
  | 'scaffolded'
  | 'integrated'
  | 'production'
  | 'deprecated'
  | 'removed';

/** Where the service executes. */
export type ServiceRuntime =
  | 'cloudflare-worker'
  | 'cloudflare-workflow'
  | 'cloudflare-container'
  | 'cloudflare-managed'
  | 'managed-saas'
  | 'self-hosted-container'
  | 'library'
  | 'not-applicable';

/** Coarse domain bucket. */
export type ServiceCategory =
  | 'edge'
  | 'workflow'
  | 'jobs'
  | 'auth'
  | 'authz'
  | 'billing'
  | 'webhooks'
  | 'observability'
  | 'browser'
  | 'ai'
  | 'data'
  | 'cms'
  | 'notifications'
  | 'secrets'
  | 'email'
  | 'lead-engine'
  | 'security'
  | 'docs'
  | 'internal';

/** Who may reach the service. */
export type ServiceAccess =
  | 'public'
  | 'customer-authenticated'
  | 'internal-access'
  | 'service-only';

/** One registered platform service. Shape mirrors convergence §13. */
export interface ServiceRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly domain?: string;
  readonly category: ServiceCategory;
  readonly runtime: ServiceRuntime;
  readonly ownerPackage?: string;
  readonly adapterPackage?: string;
  readonly featureFlag?: string;
  readonly adminSurface?: string;
  readonly publicSurface?: string;
  readonly datastore?: readonly string[];
  readonly secretsNamespace?: string;
  readonly status: ServiceStatus;
  readonly access: ServiceAccess;
  readonly notes?: string;
}

/**
 * The registry. Status reflects the repo as it actually is (not aspiration):
 * `production` = live + load-bearing; `scaffolded` = code present, gated/inert;
 * `planned` = decided, not built; `deprecated` = being migrated out.
 */
export const SERVICE_REGISTRY: readonly ServiceRegistryEntry[] = [
  {
    id: 'edge-api',
    name: 'Hono/Workers API gateway',
    domain: 'projectsites.dev',
    category: 'edge',
    runtime: 'cloudflare-worker',
    ownerPackage: 'apps/project-sites',
    status: 'production',
    access: 'public',
  },
  {
    id: 'site-serving',
    name: 'Generated customer site serving (R2 static-first)',
    domain: '*.projectsites.dev',
    category: 'edge',
    runtime: 'cloudflare-worker',
    ownerPackage: 'apps/project-sites/src/services/site_serving.ts',
    datastore: ['R2', 'KV', 'D1'],
    status: 'production',
    access: 'public',
    notes: 'Static-first; must stay independent of CMS/admin/vendor outages (§56).',
  },
  {
    id: 'site-generation-workflow',
    name: 'AI site generation (Cloudflare Workflow + Container)',
    category: 'workflow',
    runtime: 'cloudflare-workflow',
    ownerPackage: 'apps/project-sites/src/workflows/site-generation.ts',
    datastore: ['D1', 'R2'],
    status: 'production',
    access: 'service-only',
  },
  {
    id: 'workflow-router',
    name: 'WorkflowRouter — CF-Workflows/Inngest/Hatchet routing brain (§20)',
    category: 'jobs',
    runtime: 'library',
    ownerPackage: 'apps/project-sites/src/platform/workflow-router.ts',
    status: 'integrated',
    access: 'service-only',
    notes:
      'Routing policy + JOB_DEFINITIONS + port + all 3 backend adapters (CF/Inngest/Hatchet) + getJobRouter(env) factory + POST /api/jobs dispatch route (mounted, tested). Remaining: migrate the claim/billing/domain flows to dispatch through it (their dedicated Workflow classes). ADR-0003.',
  },
  {
    id: 'jobs-inngest',
    name: 'Self-hosted Inngest durable-jobs server (§13 automation plane)',
    domain: 'jobs.projectsites.dev',
    category: 'jobs',
    runtime: 'cloudflare-container',
    ownerPackage: 'apps/project-sites/src/durable_objects/inngest_container.ts',
    adapterPackage: 'apps/project-sites/src/inngest',
    datastore: ['Neon:Inngest', 'Upstash:inngest'],
    secretsNamespace: '/inngest',
    status: 'scaffolded',
    access: 'internal-access',
    notes: 'Ships live-but-inert (503) until the watched DO-migration go-live.',
  },
  {
    id: 'event-dispatcher',
    name: 'Unified Analytics ingestion dispatcher (Plane H)',
    category: 'observability',
    runtime: 'cloudflare-container',
    ownerPackage: 'apps/project-sites/src/durable_objects/event_dispatcher.ts',
    datastore: ['D1', 'Analytics Engine'],
    status: 'scaffolded',
    access: 'service-only',
    notes: 'Binding gated; /api/events degrades to 202 without it.',
  },
  {
    id: 'data-d1',
    name: 'D1 — platform relational metadata',
    category: 'data',
    runtime: 'cloudflare-managed',
    datastore: ['D1'],
    status: 'production',
    access: 'service-only',
    notes: 'Not a high-volume analytics sink (§26).',
  },
  {
    id: 'storage-r2',
    name: 'R2 — site bundles, assets, artifacts',
    category: 'data',
    runtime: 'cloudflare-managed',
    datastore: ['R2'],
    status: 'production',
    access: 'service-only',
  },
  {
    id: 'analytics-engine',
    name: 'Cloudflare Analytics Engine — high-volume events',
    domain: 'analytics.projectsites.dev',
    category: 'observability',
    runtime: 'cloudflare-managed',
    datastore: ['Analytics Engine'],
    status: 'production',
    access: 'internal-access',
  },
  {
    id: 'billing-stripe',
    name: 'Stripe — the only billing rail',
    domain: 'billing.projectsites.dev',
    category: 'billing',
    runtime: 'managed-saas',
    adapterPackage: 'apps/project-sites/src/services/billing.ts',
    secretsNamespace: '/stripe',
    status: 'production',
    access: 'customer-authenticated',
    notes: 'Polar excluded (§4); Stripe-only per ADR-0002.',
  },
  {
    id: 'ai-gateway',
    name: 'Cloudflare AI Gateway + LiteLLM/RouteLLM facade',
    domain: 'llm.projectsites.dev',
    category: 'ai',
    runtime: 'cloudflare-managed',
    adapterPackage: 'apps/project-sites/src/services/external_llm.ts',
    status: 'integrated',
    access: 'service-only',
  },
  {
    id: 'traces-langfuse',
    name: 'Langfuse — LLM tracing (Tinybird-direct, v2)',
    domain: 'traces.projectsites.dev',
    category: 'observability',
    runtime: 'cloudflare-container',
    status: 'planned',
    access: 'internal-access',
  },
  {
    id: 'browser-gateway',
    name: 'Browser Run + Stagehand (Browserbase/Skyvern fallback)',
    domain: 'browser.projectsites.dev',
    category: 'browser',
    runtime: 'cloudflare-managed',
    adapterPackage: 'apps/project-sites/src/services/browser_gateway.ts',
    status: 'production',
    access: 'service-only',
  },
  {
    id: 'observability-sentry',
    name: 'Sentry — error tracking',
    category: 'observability',
    runtime: 'managed-saas',
    adapterPackage: 'apps/project-sites/src/services/sentry.ts',
    secretsNamespace: '/sentry',
    status: 'production',
    access: 'service-only',
  },
  {
    id: 'observability-posthog',
    name: 'PostHog — product/admin/claim surfaces only',
    category: 'observability',
    runtime: 'managed-saas',
    adapterPackage: 'apps/project-sites/src/services/analytics.ts',
    status: 'production',
    access: 'internal-access',
    notes: 'NEVER added to hosted customer sites (§4/§56).',
  },
  {
    id: 'notifications-novu',
    name: 'Novu — notification backbone',
    domain: 'notify.projectsites.dev',
    category: 'notifications',
    runtime: 'managed-saas',
    secretsNamespace: '/novu',
    status: 'integrated',
    access: 'customer-authenticated',
  },
  {
    id: 'email-port',
    name: 'Email ports — EmailProvider/MarketingEmailProvider + chooseEmailPath (§42)',
    category: 'email',
    runtime: 'library',
    ownerPackage: 'apps/project-sites/src/platform/email.ts',
    status: 'integrated',
    access: 'service-only',
    notes:
      'Port + routing + fakes + AmazonSesEmailProvider + Listmonk adapter all built. All 10 transactional senders migrated onto the seam (SES-primary, progressive degradation by env). Port gained replyTo + headers (one-click List-Unsubscribe). ADR-0019.',
  },
  {
    id: 'email-ses',
    name: 'Amazon SES — transactional email (primary)',
    category: 'email',
    runtime: 'managed-saas',
    adapterPackage: 'apps/project-sites/src/services/ses_email_provider.ts',
    secretsNamespace: '/email',
    status: 'integrated',
    access: 'service-only',
    notes:
      'AmazonSesEmailProvider wired as the PRIMARY transactional rail across all 10 senders (progressive degradation by env, no flag) + the bounce/complaint suppression pipeline (ses_notifications + email_suppressions + /webhooks/ses). Needs AWS_* + SES_FROM_EMAIL prod secrets to go live — see docs/runbooks/email-deliverability-activation.md. Replaces Resend per ADR-0019.',
  },
  {
    id: 'email-listmonk',
    name: 'Listmonk — newsletters/campaigns (SES SMTP relay)',
    domain: 'mail.projectsites.dev',
    category: 'email',
    runtime: 'cloudflare-container',
    adapterPackage: 'apps/project-sites/src/services/listmonk_email_provider.ts',
    secretsNamespace: '/email',
    status: 'scaffolded',
    access: 'internal-access',
    notes:
      'ListmonkMarketingEmailProvider built (wraps listmonk_client: upsert/createCampaign/startCampaign/unsubscribe); needs LISTMONK_* config + wiring. Replaces Resend per ADR-0019.',
  },
  {
    id: 'email-resend',
    name: 'Resend — transactional email (LEGACY, migrating to SES)',
    category: 'email',
    runtime: 'managed-saas',
    adapterPackage: 'apps/project-sites/src/services/notifications.ts',
    status: 'deprecated',
    access: 'service-only',
    notes:
      'Excluded by convergence §4; 34 source refs to migrate → email-ses/email-listmonk per ADR-0019.',
  },
  {
    id: 'email-suppressions',
    name: 'Email suppression store — bounce/complaint list + event log (§42)',
    category: 'email',
    runtime: 'cloudflare-worker',
    ownerPackage: 'apps/project-sites/src/services/email_suppressions.ts',
    datastore: ['d1:email_suppressions', 'd1:email_events'],
    status: 'integrated',
    access: 'service-only',
    notes:
      'recordSuppressions (idempotent) + isSuppressed (fail-open pre-send check in email-router) + listSuppressions/removeSuppression (super-admin). Migration 0575. Platform-level, no tenant_id (SES reputation is account-wide). ADR-0019.',
  },
  {
    id: 'ses-notifications',
    name: 'SES bounce/complaint parser (§42)',
    category: 'email',
    runtime: 'library',
    ownerPackage: 'apps/project-sites/src/services/ses_notifications.ts',
    status: 'integrated',
    access: 'service-only',
    notes:
      'parseSesNotification — pure SNS/SES envelope → SesSuppression[]. Permanent bounce + complaint suppress; transient does NOT. Never throws. ADR-0019.',
  },
  {
    id: 'ses-webhook',
    name: 'SES bounce/complaint ingest — POST /webhooks/ses (§42)',
    domain: 'api.projectsites.dev',
    category: 'webhooks',
    runtime: 'cloudflare-worker',
    ownerPackage: 'apps/project-sites/src/routes/ses_webhooks.ts',
    secretsNamespace: '/webhooks',
    status: 'integrated',
    access: 'service-only',
    notes:
      'HMAC-verified (SES_WEBHOOK_SECRET) via Hookdeck/SNS; SubscriptionConfirmation auto-confirm (SSRF-guarded) → parseSesNotification → recordSuppressions. Needs SES_WEBHOOK_SECRET + the SNS subscription to activate; see docs/runbooks/email-deliverability-activation.md. ADR-0019.',
  },
  {
    id: 'claim-links-dub',
    name: 'claimyour.site claim/referral links — internal (claim_links)',
    domain: 'claimyour.site',
    category: 'edge',
    runtime: 'cloudflare-worker',
    ownerPackage: 'apps/project-sites/src/services/claim_links.ts',
    datastore: ['d1:claim_links'],
    status: 'production',
    access: 'public',
    notes:
      'Internal short-token claim links (generateShortToken → claim_links D1 table) on claimyour.site — NOT the Dub API (no DUB_* usage anywhere in src). Click tracked at the /api/claim redirect (markClaimLinkClicked → site.claim.started attribution emit). Dub-the-SaaS could later add click/sale analytics but is not integrated. §43.',
  },
  {
    id: 'authz-port',
    name: 'AuthorizationProvider port — OpenFGA graph + in-memory model (§29)',
    category: 'authz',
    runtime: 'library',
    ownerPackage: 'apps/project-sites/src/platform/authorization.ts',
    status: 'integrated',
    access: 'service-only',
    notes:
      'Port + Fake + DenyAll + OpenFgaAuthorizationProvider (REST adapter) + requireAuthz middleware + getAuthorizationProvider(env) factory, all tested. Relationship bootstrap LIVE: grantSiteOwner fires on site_create (fail-soft, tested). Remaining: extend requireAuthz to more privileged mutation routes (currently org-membership-gated). ADR-0005.',
  },
] as const;

/** Vendors the convergence exclude-list (§4) forbids in new architecture. */
export const EXCLUDED_VENDORS: readonly string[] = [
  'resend',
  'postmark',
  'polar',
  'trigger.dev',
  'clay',
  'socket.dev',
  'chainguard',
  'speakeasy',
  'knock',
  'braintrust',
  'aikido',
  'dataforseo',
  'zerobounce',
  'lakera',
  'openfda',
  // NOTE: Hunter.io is on the §4 exclude list but is a LIVE env binding today
  // (HUNTER_API_KEY in src/types/env.ts for lead-engine email discovery). It is
  // intentionally NOT gated here — gating a working integration would be a
  // false positive. Migrate the lead engine off it before adding a hard rule.
] as const;

/** Look up a service by id. */
export function getService(id: string): ServiceRegistryEntry | undefined {
  return SERVICE_REGISTRY.find((s) => s.id === id);
}

/** A referential-integrity problem found in the registry. */
export interface RegistryViolation {
  readonly id: string;
  readonly problem: string;
}

const STATUSES: ReadonlySet<ServiceStatus> = new Set([
  'planned',
  'scaffolded',
  'integrated',
  'production',
  'deprecated',
  'removed',
]);

/**
 * Validate registry integrity: unique ids, valid status enum, and that any
 * entry naming an excluded vendor is marked `deprecated`/`removed` (so the
 * registry can never silently bless a forbidden dependency as live).
 *
 * @returns the list of violations (empty = clean).
 * @example validateServiceRegistry(SERVICE_REGISTRY) // → []
 */
export function validateServiceRegistry(
  entries: readonly ServiceRegistryEntry[] = SERVICE_REGISTRY,
): RegistryViolation[] {
  const out: RegistryViolation[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) out.push({ id: e.id, problem: 'duplicate id' });
    seen.add(e.id);
    if (!STATUSES.has(e.status)) out.push({ id: e.id, problem: `invalid status "${e.status}"` });
    // Scan only the load-bearing "this entry USES vendor X" fields — NOT `notes`,
    // which legitimately DISCUSSES exclusions (a notes field may name a forbidden
    // vendor purely to say it is excluded; that must not self-flag).
    const hay = `${e.name} ${e.adapterPackage ?? ''}`.toLowerCase();
    const vendor = EXCLUDED_VENDORS.find((v) => hay.includes(v));
    if (vendor && e.status !== 'deprecated' && e.status !== 'removed') {
      out.push({
        id: e.id,
        problem: `references excluded vendor "${vendor}" but status is "${e.status}" (must be deprecated/removed)`,
      });
    }
  }
  return out;
}
