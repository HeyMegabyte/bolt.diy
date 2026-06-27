/**
 * @module index
 * @description Main entry point for the Project Sites Cloudflare Worker.
 *
 * Configures global middleware, mounts route modules, handles the
 * catch-all site-serving logic, and exports the Workers fetch/queue/scheduled
 * handlers.
 *
 * ## Middleware Stack (applied to every request)
 *
 * | Order | Middleware          | Purpose                              |
 * | ----- | ------------------- | ------------------------------------ |
 * | 1     | `requestId`         | Generate `X-Request-ID` header       |
 * | 2     | `payloadLimit`      | Reject oversized request bodies      |
 * | 3     | `securityHeaders`   | Set CSP, HSTS, X-Frame-Options       |
 * | 4     | `cors` (API only)   | CORS for `/api/*` endpoints          |
 * | 5     | `errorHandler`      | Catch + format errors as JSON        |
 *
 * ## Routing Priority
 *
 * 1. Health check (`/health`)
 * 2. Search routes (`/api/search/*`, `/api/sites/lookup`, `/api/sites/search`)
 * 3. API routes (`/api/*`) — includes `/api/sites/:id` param routes
 * 4. Webhook routes (`/webhooks/*`)
 * 5. Catch-all: marketing site or subdomain site serving
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types/env.js';
import { requestIdMiddleware } from './middleware/request_id.js';
import { requestLogger } from './lib/log.js';
import { notFoundHtml } from './lib/not_found_page.js';
import { llmLandingPage } from './lib/llm_landing_page.js';
import { resolveSystemService, systemServiceLanding } from './lib/system_service_landing.js';
import { errorHandler } from './middleware/error_handler.js';
import { payloadLimitMiddleware } from './middleware/payload_limit.js';
import { securityHeadersMiddleware } from './middleware/security_headers.js';
import { authMiddleware } from './middleware/auth.js';
import { health } from './routes/health.js';
import { api } from './routes/api.js';
import { authIdp } from './routes/auth_idp.js'; // /api/auth/:provider/login + /callback — Better Auth (default) + WorkOS (enterprise) IdP, ships dark
import { search } from './routes/search.js';
import { featureE2e } from './routes/feature_e2e.js';
import { visionQa } from './routes/vision_qa.js';
import { browserService } from './routes/browser_service.js'; // browser.projectsites.dev /v1/browser/* (CF-first browser abstraction)
import { inngestApp } from './inngest/serve.js'; // jobs./events.projectsites.dev + /api/inngest serve (§13 automation plane; inert until watched deploy)
import { createJobsRoutes } from './routes/jobs.js'; // POST /api/jobs dispatch seam (§20 WorkflowRouter)
import { concierge } from './routes/concierge.js';
import { pageAudio } from './routes/page_audio.js';
import { storefront } from './routes/storefront.js';
import { agenticCommerce } from './routes/agentic_commerce.js';
import { aiActions } from './routes/ai_actions.js';
import { adminLeads } from './routes/admin_leads.js';
import { adminOutbox } from './routes/admin_outbox.js';
import { adminFunnel } from './routes/admin_funnel.js';
import { adminAnalytics } from './routes/admin_analytics.js';
import { maybeCompleteClaimBuild } from './services/claim_build_callback.js';
import { claimRoutes } from './routes/claim.js';
import { i18n } from './routes/i18n.js';
import { webhooks } from './routes/webhooks.js';
import { sesWebhooks } from './routes/ses_webhooks.js';
import { assets } from './routes/assets.js';
import { forms } from './routes/forms.js';
import { analyticsRoutes } from './routes/analytics.js';
import { aiAdmin } from './routes/ai_admin.js';
import { aiEndpointsPublic } from './routes/ai_endpoints_public.js';
import { mcpOauth } from './routes/mcp_oauth.js';
import { envVarsRoutes } from './routes/env_vars.js';
import { docs } from './routes/docs.js';
import { autofill } from './routes/autofill.js';
import { bolt } from './routes/bolt_admin.js';
import { editorChats } from './routes/editor_chats.js';
import { collabRoutes } from './routes/collab.js';
import { openapiRoutes } from './routes/openapi.js';
import { apps as appsRoutes } from './routes/apps.js';
import { snapshotQuality } from './routes/snapshot_quality.js';
import { dashboard } from './routes/dashboard.js';
import { socialRoutes } from './routes/social.js';
import { socialOauthRoutes } from './routes/social_oauth.js';
import { pulseAnalytics, runHourlyPulseAnalyticsCron } from './routes/pulse_analytics.js';
import { voiceRoutes } from './routes/voice.js';
import { voiceWebhookRoutes } from './routes/voice_webhooks.js';
import { domainPurchase } from './routes/domain_purchase.js';
import { domainStack } from './routes/domain_stack.js';
import { superAdmin } from './routes/super_admin.js';
import { wallet as walletRoutes } from './routes/wallet.js';
import { agency } from './routes/agency.js';
import { billingAddons } from './routes/billing_addons.js';
import { agents } from './routes/agents.js';
import { templates as templatesRoutes } from './routes/templates.js';
import { mcpSite } from './routes/mcp_site.js';
import { siteBranchesApp } from './routes/site_branches.js';
import { experiments } from './routes/experiments.js';
import { mediaRoutes } from './routes/media.js';
import { publicRoutes } from './routes/public.js';
import { pseoRoutes } from './routes/pseo.js';
import { pseoMatrixV2Routes } from './routes/pseo_matrix_v2.js';
import features from './routes/features.js';
import { inbox } from './routes/inbox.js';
import { copilot } from './routes/copilot.js';
import { siteDetailTabs } from './routes/site_detail_tabs.js';
import { siteDna } from './routes/site_dna.js';
import { emailDeliverabilityRoutes } from './routes/email_deliverability.js';
import { reviewPublic } from './routes/review_public.js';
import { reviewLinks } from './routes/review_links.js';
import { webhooksAdmin } from './routes/webhooks_admin.js';
import { seoAutopilot } from './routes/seo_autopilot.js';
// ── Marketplace + Creator Economy (IDEAS-50 #39/#40/#41/#42)
// Feature modules (libs/features/*) — ideas #33, #34, #36, #46
import { tokenBurnMeter } from '../libs/features/token_burn_meter/handlers.js'; // #13 per-tenant token-burn meter + budget killswitch (flag: token_burn_meter)
import { siteAnalytics } from '../libs/features/site_analytics/handlers.js'; // owner-facing per-site analytics summary (flag: site_analytics)
import { visitorEvents } from '../libs/features/visitor_events_core/handlers.js'; // public pageview/event beacon ingest (flag: visitor_events_core)
import { recordPageviewFromRequest } from '../libs/features/visitor_events_core/service.js'; // edge-recorded per-request pageview (no flag — core site analytics)
import { emailMarketing } from '../libs/features/email_marketing/handlers.js'; // real campaign send to consented audience (flag: email_marketing)
// IDEAS-50 wave 3 — GEO + reputation + growth
import { searchSubmit } from '../libs/features/search_submit/handlers.js'; // #3 IndexNow + Bing/Google submit on publish (flag: search_engine_submit)
import { gbpAssist } from '../libs/features/gbp_assist/handlers.js'; // #9 Google Business Profile setup + optimizer (flag: gbp_assist)
import { abuseTakedown } from '../libs/features/abuse_takedown/handlers.js'; // abuse + takedown intake (flag: abuse_takedown)
import { platformMcp } from '../libs/features/platform_mcp/handlers.js'; // platform MCP server for Claude Code etc. (flag: platform_mcp)
import { oauthProvider } from '../libs/features/mcp_oauth_provider/handlers.js'; // OAuth 2.1 AS for MCP one-click connect (flag: mcp_oauth_provider)
import { prodReadinessScore } from '../libs/features/prod_readiness_score/handlers.js'; // GET /api/sites/:siteId/readiness — 0-100 readiness score (flag: prod_readiness_score)
import { cmsContent } from '../libs/features/cms_content/handlers.js'; // GET /api/cms/blog.json + POST /api/cms/revalidate — Payload CMS bridge (flag: cms_content)
import { deployButtons } from '../libs/features/deploy_buttons/handlers.js'; // GET /api/deploy-buttons/:siteId — deploy buttons + "Hosted on" badge (flag: deploy_buttons)
import { visitorDsar } from '../libs/features/visitor_dsar/handlers.js'; // POST /api/sites/:siteId/dsar — GDPR data-subject export/delete (flag: visitor_dsar)
import { onboardingCopilot } from '../libs/features/onboarding_copilot/handlers.js'; // /api/onboarding/{checklist,dismiss} — PLG activation checklist (flag: onboarding_copilot)
import { auditTrailExport } from '../libs/features/audit_trail_export/handlers.js'; // GET /api/audit/export — filterable audit-log JSON/CSV export (flag: audit_trail_export)
import { modelRegistry } from '../libs/features/model_registry/handlers.js'; // GET /v1/models — OpenAI-compatible model/provider alias catalog (flag: model_registry)
// ── 40-list build wave (Brian-selected, 2026-06-17) — see apps/project-sites/TODO.md ──
import { paymentsRail } from '../libs/features/payments_rail/handlers.js'; // unified Square+Stripe seam (flag: payments_rail)
import { storefrontEcommerce } from '../libs/features/storefront_ecommerce/handlers.js'; // native storefront (flag: storefront_ecommerce)
import { nativeBookingEngine } from '../libs/features/native_booking_engine/handlers.js'; // booking/availability (flag: native_booking_engine)
import { creditWalletRollover } from '../libs/features/credit_wallet_rollover/handlers.js'; // wallet rollover+promo (flag: credit_wallet_rollover)
import { referralLoop } from '../libs/features/referral_loop/handlers.js'; // refer-a-friend (flag: referral_loop)
import { aiConciergeWidget } from '../libs/features/ai_concierge_widget/handlers.js'; // visitor-facing concierge (flag: ai_concierge_widget)
import { siteSemanticSearch } from '../libs/features/site_semantic_search/handlers.js'; // per-site RAG search (flag: site_semantic_search)
import { edgePersonalization } from '../libs/features/edge_personalization/handlers.js'; // no-PII hero/CTA swap (flag: edge_personalization)
import { promptStudio } from '../libs/features/prompt_studio/handlers.js'; // prompt versioning surface (flag: prompt_studio)
import { aiGatewayGuardrails } from '../libs/features/ai_gateway_guardrails/handlers.js'; // Llama Guard middleware (flag: ai_gateway_guardrails)
import { visualPointEdit } from '../libs/features/visual_point_edit/handlers.js'; // point-and-click AI edit (flag: visual_point_edit)
import { wireframePlanning } from '../libs/features/wireframe_planning/handlers.js'; // pre-gen wireframe plan (flag: wireframe_planning)
import { urlCloneSeedRouter } from '../libs/features/url_clone_seed/handlers.js'; // paste-URL seed (flag: url_clone_seed)
import { cmdkAiActionsRouter } from '../libs/features/cmdk_ai_actions/handlers.js'; // Cmd+K AI actions (flag: cmdk_ai_actions)
import { aeoPass } from '../libs/features/aeo_pass/handlers.js'; // answer-engine optimization (flag: aeo_pass)
import { statusPageLive } from '../libs/features/status_page_live/handlers.js'; // live status feed (flag: status_page_live)
import { siteThumbnailGrid } from '../libs/features/site_thumbnail_grid/handlers.js'; // browser-rendered thumbnails (flag: site_thumbnail_grid)
import { observabilityGateway } from '../libs/features/observability_gateway/handlers.js'; // POST /monitoring/:provider — customer-site Sentry/PostHog gateway (flag: observability_gateway)
import { proxyToContainer } from './services/container_dispatcher.js';
import { resolveAppHost } from './services/app_host_resolver.js';
import { resolveSite, serveSiteFromR2 } from './services/site_serving.js';
import { dbQueryOne, dbUpdate } from './services/db.js';
import { registerAllPrompts } from './services/ai_workflows.js';
import { DOMAINS, escapeHtml } from '@project-sites/shared';
import { parseEnv } from './lib/env.js';
export { SiteGenerationWorkflow } from './workflows/site-generation.js';
export { DriveSyncWorkflow } from './workflows/drive-sync.js';
export { ImageGenerationWorkflow } from './workflows/image-generation.js';
export { SnapshotQualityWorkflow } from './workflows/snapshot-quality.js';
export { SocialPublishWorkflow } from './workflows/social-publish.js';
export { PseoGenerationWorkflow } from './workflows/pseo-generation-workflow.js';
export { SiteBuilderContainer } from './container.js';
export { TraceHub, ActivityHub } from './durable_objects/trace_hub.js';
export { AppRuntimeContainer } from './durable_objects/app_runtime.js';
// Pulse Inbox deprecated 2026-05-25 — 410-stub class kept so the existing
// `v_conversation_hub` DO migration tag in Cloudflare's history stays valid.
//
// TODO Wave 3 deletion (safe after 2026-08-01):
//   1. Confirm no live DO instances remain (check CF dashboard → Durable Objects →
//      conversation_hub namespace object count = 0).
//   2. Remove this export line.
//   3. Delete `src/durable_objects/conversation_hub.ts`.
//   4. Remove the `v_conversation_hub` entry from wrangler.toml [[durable_objects.bindings]].
//   Rationale: the 410-stub keeps the Cloudflare Workers migration history valid so
//   redeployment doesn't fail with "unknown class" for the historical DO namespace.
//   Once all instances are drained the stub is safe to remove entirely.
export { ConversationHub } from './durable_objects/conversation_hub.js';
// CollabRoomDO (PartyServer + Yjs) — exported so CF knows the class for the
// COLLAB_ROOM binding. INERT until the wrangler.toml block is uncommented
// (watched one-way-door DO migration). Feature: collab_editing.
export { CollabRoomDO } from './durable_objects/collab_room.js';
export { EventDispatcher } from './durable_objects/event_dispatcher.js';
// jobs./events.projectsites.dev — self-hosted Inngest server container (§13).
export { InngestContainer } from './durable_objects/inngest_container.js';
// survey.projectsites.dev — self-hosted Formbricks survey container (dedicated DO).
export { FormbricksContainer } from './durable_objects/formbricks_container.js';
// sign.projectsites.dev — self-hosted Documenso e-signature container (dedicated DO).
export { DocumensoContainer } from './durable_objects/documenso_container.js';
export {
  UmamiContainer,
  OutlineContainer,
  N8nContainer,
  VaultwardenContainer,
  UptimeKumaContainer,
  NocodbContainer,
  ListmonkContainer,
  MemosContainer,
  PocketbaseContainer,
  OpenWebuiContainer,
} from './durable_objects/app_runtime_subclasses.js';

// Register all prompt definitions at module load
registerAllPrompts();

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Global Middleware ───────────────────────────────────────

// Env validation — runs before any route logic.
// parseEnv throws ZodError on missing required secrets → errorHandler returns 500.
app.use('*', async (c, next) => {
  parseEnv(c.env as unknown as Record<string, unknown>);
  await next();
});

// editor.projectsites.dev → proxy EVERYTHING (incl. /api/*) to the bolt-diy
// Pages app. MUST run before the /api route mounts + authMiddleware below, else
// the worker's own projectsites.dev /api routing pre-empts
// editor.projectsites.dev/api/* and returns the worker's 404 — which crashed
// the bolt editor's /api/models fetch (undefined.length in react-toastify).
// Host-gated: non-editor hosts fall straight through, so projectsites.dev
// routing is completely unaffected. (Was a late fallback after the /api mounts;
// hoisted round 145.)
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname !== DOMAINS.BOLT_BASE) return next();
  // Embed-only gate: bolt.diy is an INTERNAL admin tool embedded as an iframe in
  // projectsites.dev/admin — it must not be a publicly-usable destination
  // (AI-credit + WebContainer compute abuse). CF Access can't gate an iframe
  // (its login page sets X-Frame-Options), so we gate here: block a DIRECT
  // top-level navigation (and cross-site top-level loads). The admin iframe
  // (sec-fetch-dest=iframe, same-site), every same-origin sub-request
  // (assets/api/HMR/WebContainer), and old UAs without Sec-Fetch all pass.
  const sfDest = c.req.header('sec-fetch-dest');
  const sfSite = c.req.header('sec-fetch-site');
  if (sfDest === 'document' && (sfSite === 'none' || sfSite === 'cross-site')) {
    return c.html(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProjectSites Editor</title><body style="margin:0;font:16px/1.5 system-ui,sans-serif;background:#0a0a1a;color:#e6e6e6;display:grid;place-items:center;min-height:100vh"><main style="text-align:center;max-width:34rem;padding:2rem"><h1 style="color:#64ffda;font-size:1.6rem;margin:0 0 .5rem">Open the editor from your dashboard</h1><p style="opacity:.8;margin:0 0 1.5rem">The ProjectSites editor runs inside the admin dashboard, not as a standalone page.</p><a href="https://projectsites.dev/admin" style="display:inline-block;padding:.7rem 1.4rem;border-radius:10px;background:#64ffda;color:#0a0a1a;font-weight:600;text-decoration:none">Open the dashboard →</a></main>',
      403,
    );
  }
  const pagesRes = await fetch(`https://bolt-diy-8jf.pages.dev${url.pathname}${url.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
  });
  const res = new Response(pagesRes.body, { status: pagesRes.status, headers: pagesRes.headers });
  // Cross-origin isolation required for SharedArrayBuffer (WebContainers)
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  res.headers.set('Origin-Agent-Cluster', '?1');
  // CORS so the editor can talk to projectsites.dev API
  res.headers.set('Access-Control-Allow-Origin', `https://${DOMAINS.BOLT_BASE}`);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  // CSP that lets bolt.diy embed the WebContainer preview iframe AND lets
  // projectsites.dev/admin embed bolt.diy itself (Pages' default frame-src
  // 'none' + X-Frame-Options: DENY would blank the preview + break the embed).
  res.headers.delete('X-Frame-Options');
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // static.cloudflareinsights.com: CF Web Analytics auto-injects its beacon
      // at the edge; without it here the editor logs a CSP violation every load.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.webcontainer-api.io https://*.local-credentialless.webcontainer-api.io https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https: wss: blob:",
      // Bare https://stackblitz.com is required because app/root.tsx sets
      // WEBCONTAINER_API_IFRAME_URL = "https://stackblitz.com" (no subdomain),
      // which `*.stackblitz.com` does NOT match → framing was blocked.
      "frame-src 'self' blob: https://*.webcontainer-api.io https://*.local-credentialless.webcontainer-api.io https://stackblitz.com https://*.stackblitz.com https://challenges.cloudflare.com",
      "child-src 'self' blob: https://*.webcontainer-api.io https://*.local-credentialless.webcontainer-api.io",
      "worker-src 'self' blob:",
      "frame-ancestors 'self' https://projectsites.dev https://*.projectsites.dev https://bolt-diy-8jf.pages.dev https://bolt.megabyte.space",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https:",
    ].join('; '),
  );
  return res;
});

// Request ID on every request
app.use('*', requestIdMiddleware);

// Structured per-request access log (item #50)
app.use('*', requestLogger);

// Payload size limit
app.use('*', payloadLimitMiddleware);

// Security headers
app.use('*', securityHeadersMiddleware);

// Public forms ingest must accept ANY origin (custom domains post here too).
// Server-side origin allow-list inside the handler is the real security check.
app.use(
  '/api/v1/forms/submit',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Site-Slug'],
    maxAge: 86400,
  }),
);

// Permissive CORS for *.projectsites.dev on ALL routes (sites loaded in iframes, cross-subdomain requests)
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '';
      const allowed = [
        `https://${DOMAINS.SITES_BASE}`,
        `https://${DOMAINS.BOLT_BASE}`,
        'http://localhost:3000',
        'http://localhost:4200',
        'http://localhost:4300',
        'http://localhost:5173',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow any subdomain of projectsites.dev
      if (origin.endsWith(DOMAINS.SITES_SUFFIX)) return origin;
      // Allow any *.projectsites.dev origin (including deeply nested subdomains)
      if (origin.endsWith(`.${DOMAINS.SITES_BASE}`)) return origin;
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  }),
);

// Rate limiting on sensitive endpoints (config + applier in one module)
import { applyRateLimits } from './middleware/rate_limit.js';

// ─── Per-IP rate limits (single source: middleware/rate_limit.ts) ──────
// Every throttled surface (auth, public cost endpoints, bolt-AI, SSE polls)
// is declared in RATE_LIMIT_RULES + applied here in one loop. Add new budgets
// THERE so the limiter config + its test never drift. See applyRateLimits().
applyRateLimits(app);

// Auth middleware for API routes (sets userId/orgId if valid session)
app.use('/api/*', authMiddleware);

// Global error handler
app.onError(errorHandler);

// Accessible 404 for explicit `c.notFound()` calls (e.g. flag-gated routes
// like /changelog when its flag is off). The catch-all `app.all('*')` already
// serves a branded 404 for unmatched routes, but `c.notFound()` bypasses it and
// would otherwise emit Hono's bare text/plain 404 (no <title>, no <html lang> —
// fails axe document-title + html-has-lang). This gives every notFound a small
// accessible HTML page with a distinguishable (underlined) home link.
app.notFound((c) => c.html(notFoundHtml(), 404));

// ─── Mount Routes ────────────────────────────────────────────

app.route('/', health);
app.route('/', bolt); // Bolt admin: chat-state mirror, transcribe, vision OCR, prompt suggestions
app.route('/', editorChats); // Native Angular editor chat persistence + LLM stream proxy
app.route('/', collabRoutes); // /api/sites/:id/collab WS gateway → CollabRoomDO (collab_editing flag; 503 inert until COLLAB_ROOM bound)
app.route('/', openapiRoutes); // GET /api/openapi.json — Zod-derived OpenAPI 3.1 spec (zod-to-openapi + hono-openapi describeRoute)
app.route('/', authIdp); // /api/auth/:provider/login + /callback — Better Auth (default) + WorkOS (enterprise); 404s dark when BETTER_AUTH_*/WORKOS_* unset
app.route('/', search); // Must come before api so /api/sites/search wins over /api/sites/:id
app.route('/', featureE2e); // /api/feature-e2e/:key/run + /runs/:id — Browser Rendering E2E check runner
app.route('/', visionQa); // /api/vision-qa — Browser Rendering screenshot + Workers AI vision critique (flag: editor_vision_qa)
app.route('/', concierge); // /api/sites/:id/concierge — "Ask my site" RAG concierge (flag: ai_concierge_widget)
app.route('/', pageAudio); // /api/sites/:id/page-audio — TTS page narration → R2 (flag: page_audio)
app.route('/', storefront); // /api/sites/:id/products[/:productId] — product catalog CRUD (flag: storefront_ecommerce)
app.route('/', agenticCommerce); // /api/sites/:id/commerce/feed — agent-readable product feed (flag: agentic_commerce)
app.route('/', aiActions); // /api/ai-actions/payment-command — safety-gated AI payment-command (flag: ai_payment_command)
app.route('/', adminLeads); // /api/admin/leads/scan — Super-Admin lead scanner (flag: lead_scanner)
app.route('/', adminOutbox); // /api/admin/outbox — Super-Admin event-bus DLQ observability (read-only)
app.route('/', adminFunnel); // /api/admin/activation-funnel — Super-Admin revenue-funnel rollup (Tinybird, read-only)
app.route('/', adminAnalytics); // /api/admin/analytics/* — Super-Admin events-daily + publishes-by-source + claims-by-source rollups (Tinybird, read-only)
app.route('/', claimRoutes); // /api/claim/:shortlink — claimyour.site funnel: resolve→click→session START→redirect /create
app.route('/', i18n); // /api/sites/:id/i18n/* — AI translation + hreflang (flag: i18n_localization)
app.route('/', autofill); // POST /api/sites/autofill — must come before api so it wins over /api/sites/:id
app.route('/', assets); // Asset uploads + build-assets listing
app.route('/', forms); // Public form ingest + auth-gated submissions/integrations CRUD
app.route('/', analyticsRoutes); // Unified Analytics ingestion: POST /api/events (202 fast-ack) + /api/analytics-debug (Plane H)
app.route('/', aiEndpointsPublic); // Public /api/ai/:slug/:endpoint dispatcher
app.route('/', mcpOauth); // MCP OAuth start + callback (MailChimp/Stripe/Resend/HubSpot)
app.route('/', envVarsRoutes); // /api/env-vars — per-org/site/MCP customizable env vars for AI + MCP dispatch
app.route('/', aiAdmin); // Form submissions, AI logs, chat, endpoints, credits, alerts, team
app.route('/', docs); // Interactive API explorer (OpenAPI + Angular overview)
app.route('/', appsRoutes); // /admin/apps tab — catalog + per-org app_instances CRUD
app.route('/', snapshotQuality); // /api/sites/:siteId/snapshots/:snapshotId/{capture,metrics,screenshot.png} — must precede `api` so the param order matches first
app.route('/', siteDetailTabs); // /api/sites/:siteId/{logs/tail,snapshots/:id/rollback,sql/exec,integrations} — must precede `api` so the param order matches first
app.route('/', siteDna); // /api/site-dna/:siteId/{feedback,preferences,history} — #7 Site DNA Taste Graph
app.route('/', dashboard); // /api/dashboard/chat (SSE) + /api/calendar/* — Perplexity-like dashboard surface
app.route('/', pulseAnalytics); // /api/social/analytics/aggregate — must precede social catch-alls
app.route('/', socialOauthRoutes); // /api/social/:platform/{connect,callback,paste} — Pulse Social OAuth
app.route('/', socialRoutes); // /api/social/{accounts,posts}/* — Pulse Social CRUD; must precede `api`
app.route('/', voiceRoutes); // /api/voice/* — AI Voice + SMS Agent (numbers, vanity, calls, messages, settings)
app.route('/', voiceWebhookRoutes); // /webhooks/voice/* + /webhooks/sms/* + /internal/voice/* — Twilio webhook + media stream bridge
app.route('/', domainPurchase); // Wallet-charged /api/domains/purchase + /api/billing/checkout/{wallet,topup} + /api/billing/wallet — must precede `api` so the wallet-aware purchase route wins over the legacy hosted-checkout route
app.route('/', domainStack); // Domain Stack Wizard: POST /api/domains/:hostname/stack + GET /api/domains/:hostname/stack-status (flag: domain_stack_wizard)
app.route('/', superAdmin); // /api/super-admin/* — cost-factor controls + wallet ops + 100-feature ops (is_super_admin=1 guarded)
app.route('/', walletRoutes); // /api/wallet/* — customer-facing wallet read/subscribe/topup (additive aliases over domain_purchase /api/billing/wallet)
app.route('/', agency); // /api/agency/* — white-label / agency surface (Pro-gated, manages child orgs + brand overrides + Stripe Connect)
app.route('/', billingAddons); // /api/billing/addons/*, /api/billing/checkout/topup, /api/billing/usage/*, /api/billing/invoices/*, /api/billing/subscription/cancel, /api/agency/stripe-connect/onboard, /api/affiliates/payouts
app.route('/', agents); // /api/(sites/:siteId/agents|agents/:id)/* — AI Agents (per-site autonomous maintenance, Pro-gated)
app.route('/', templatesRoutes); // /api/templates + /api/sites/:siteId/install-template — templates marketplace
app.route('/', inbox); // /api/inbox/* — Unified Visitor Inbox (flag: unified_inbox)
app.route('/', copilot); // /api/sites/:slug/copilot/* + /sites/:slug/copilot.js — Multimodal Copilot (flag: multimodal_copilot)
app.route('/', features); // Feature endpoints (every /api/* path flag-gated via isFlagOn) + public discovery surfaces (llms.txt, /accessibility, /.well-known/mcp, /api/openapi.json). Must precede mcpSite so marketing-root /.well-known/mcp wins.
app.route('/', platformMcp); // GET+POST /api/mcp — platform MCP (flag: platform_mcp). MUST precede mcpSite: mcpSite's POST /:slug/mcp matches /api/mcp (slug='api') and would shadow the platform MCP's POST handler.
app.route('/', mcpSite); // /{slug}/.well-known/* + /{slug}/mcp + /api/sites/:siteId/mcp/* — MCP per-site server
app.route('/', siteBranchesApp); // /api/sites/:siteId/branches — branch-style site previews (#27)
app.route('/', experiments); // /_ps/{i,c,e,predict} + /api/sites/:siteId/experiments — Thompson-sampling A/B + predictive prerender
app.route('/', mediaRoutes); // /api/media/* — unified media library (uploads, stock, AI gen, send-to-bolt)
app.route('/', publicRoutes); // /changelog.json + /feed.xml + /api/public/{roadmap,integrations} — distribution flywheel surfaces; must precede the catch-all so the marketing worker never tries to resolve a site for these paths
app.route('/api/pseo', pseoRoutes); // pSEO Matrix Builder — feature #17: service×city×intent×season generator
app.route('/api/sites', pseoMatrixV2Routes); // pSEO v2 (#29) — /api/sites/:id/pseo/v2/* — user-tasks + 40% unique-data floor
app.route('/api/seo', seoAutopilot); // SEO/GEO Autopilot — idea #23: AI title/meta/JSON-LD/answer-block drafts per route
// libs/features/* — viral + billing + audit-chain modules (ideas #33, #34, #36, #46)
app.route('/', tokenBurnMeter); // /api/usage/budget + /api/admin/usage/budget — #13 per-tenant token-burn meter + budget killswitch (flag: token_burn_meter)
app.route('/', siteAnalytics); // /api/sites/:siteId/analytics — owner analytics summary (flag: site_analytics). Must precede `api` so the :siteId/analytics suffix wins.
app.route('/', visitorEvents); // POST /api/v1/events — public beacon ingest (flag: visitor_events_core)
app.route('/', emailMarketing); // /api/marketing/campaigns/:id/{recipients,send} + /api/marketing/unsubscribe — real campaign send (flag: email_marketing)
app.route('/', emailDeliverabilityRoutes); // /api/sites/:siteId/deliverability — SPF/DKIM/DMARC score + fixes (flag: email_deliverability_wizard)
app.route('/', reviewPublic); // GET/POST /api/review/:id{,/decision} — public reviewer approve/reject (flag: approval_workflow, scoped to review's org)
app.route('/', reviewLinks); // GET/POST /api/sites/:siteId/review-links — admin create/list review links (flag: approval_workflow, assertSiteOwned)
app.route('/', webhooksAdmin); // /api/sites/:siteId/webhooks — outbound webhook subscription CRUD (flag: outbound_webhooks)
// ── IDEAS-50 wave 3 mounts — must precede `api` so :id/* suffixes + /r/:code + /gallery win
app.route('/', searchSubmit); // /api/sites/:id/search-submit + /{key}.txt IndexNow verify — #3 (flag: search_engine_submit)
app.route('/', gbpAssist); // /api/sites/:id/gbp/* — #9 Google Business Profile assist (flag: gbp_assist)
app.route('/', abuseTakedown); // /api/abuse/* — abuse + takedown intake (flag: abuse_takedown)
app.route('/', oauthProvider); // OAuth 2.1 AS: /.well-known/oauth-authorization-server + /oauth/{register,authorize,token} (flag: mcp_oauth_provider)
app.route('/', prodReadinessScore); // GET /api/sites/:siteId/readiness (flag: prod_readiness_score) — must precede `api`
app.route('/', cmsContent); // GET /api/cms/blog.json + POST /api/cms/revalidate (flag: cms_content) — must precede `api`
app.route('/api/deploy-buttons', deployButtons); // GET /api/deploy-buttons/:siteId (flag: deploy_buttons)
app.route('/', visitorDsar); // POST /api/sites/:siteId/dsar (flag: visitor_dsar) — must precede `api`
app.route('/api/onboarding', onboardingCopilot); // /api/onboarding/{checklist,dismiss} (flag: onboarding_copilot)
app.route('/api/audit/export', auditTrailExport); // GET /api/audit/export (flag: audit_trail_export)
app.route('/', modelRegistry); // GET /v1/models — OpenAI-compatible alias catalog (flag: model_registry) — must precede the site-serving catch-all
app.route('/', browserService); // POST /v1/browser/* — product browser-automation abstraction (browser.projectsites.dev); routes CF→Stagehand→Browserbase-fallback, never Skyvern in product paths — must precede the catch-all
// System-service status page at the bare root `/` — registered BEFORE inngestApp
// so `jobs.projectsites.dev/` returns the branded 200 status page instead of the
// Inngest inert 503. Only matches exact path `/`, so `/api/inngest` (and every
// other `/api/*`, `/v1/*` path on these hosts) still routes to its real handler.
app.get('/', async (c, next) => {
  const svc = resolveSystemService((c.req.header('host') ?? '').toLowerCase());
  return svc ? c.html(systemServiceLanding(svc)) : next();
});
app.route('/', inngestApp); // jobs./events.projectsites.dev → InngestContainer DO + /api/inngest serve handler (§13); degrades to 503 until the watched deploy binds INNGEST_CONTAINER — must precede the catch-all
// survey.projectsites.dev → self-hosted Formbricks container (dedicated DO).
// Proxies the FULL host (all methods/paths) to FORMBRICKS_CONTAINER; degrades to
// 503 until the watched deploy binds it. Must precede the site-serving catch-all.
app.all('*', async (c, next) => {
  const hostname = (c.req.header('host') ?? '').toLowerCase();
  if (hostname !== `survey.${DOMAINS.SITES_BASE}`) return next();
  const binding = c.env.FORMBRICKS_CONTAINER;
  if (!binding) {
    return c.json({ error: 'Formbricks is provisioning; not yet available.' }, 503);
  }
  return binding.get(binding.idFromName('formbricks-singleton')).fetch(c.req.raw);
});
// sign.projectsites.dev → self-hosted Documenso container (dedicated DO).
// Proxies the FULL host to DOCUMENSO_CONTAINER; degrades to 503 until the watched
// deploy binds it. Must precede the site-serving catch-all.
app.all('*', async (c, next) => {
  const hostname = (c.req.header('host') ?? '').toLowerCase();
  if (hostname !== `sign.${DOMAINS.SITES_BASE}`) return next();
  const binding = c.env.DOCUMENSO_CONTAINER;
  if (!binding) {
    return c.json({ error: 'Documenso is provisioning; not yet available.' }, 503);
  }
  return binding.get(binding.idFromName('documenso-singleton')).fetch(c.req.raw);
});
app.route('/', createJobsRoutes()); // POST /api/jobs + GET /api/jobs/:id/status — authed WorkflowRouter dispatch seam (§20); routes to CF Workflows/Inngest/Hatchet via getJobRouter(env)
app.route('/', observabilityGateway); // POST /monitoring/:provider — customer-site Sentry/PostHog gateway (flag: observability_gateway) — must precede the catch-all

// ── 40-list build wave (Brian-selected, 2026-06-17) — all flag-gated → 404 when off ──
app.route('/', paymentsRail); // /api/payments/* (flag: payments_rail)
app.route('/', storefrontEcommerce); // /api/storefront/* (flag: storefront_ecommerce)
app.route('/', nativeBookingEngine); // /api/booking/* (flag: native_booking_engine)
app.route('/', creditWalletRollover); // /api/credits/* (flag: credit_wallet_rollover)
app.route('/', referralLoop); // /api/referrals/* (flag: referral_loop)
app.route('/', aiConciergeWidget); // /api/concierge/* (flag: ai_concierge_widget)
app.route('/', siteSemanticSearch); // /api/site-search/* (flag: site_semantic_search)
app.route('/', edgePersonalization); // /api/personalize/* (flag: edge_personalization)
app.route('/', promptStudio); // /api/prompt-studio/* (flag: prompt_studio)
app.route('/', aiGatewayGuardrails); // /api/guardrails/* (flag: ai_gateway_guardrails)
app.route('/', visualPointEdit); // /api/editor/point-edit (flag: visual_point_edit)
app.route('/', wireframePlanning); // /api/wireframe/* (flag: wireframe_planning)
app.route('/', urlCloneSeedRouter); // /api/clone/seed (flag: url_clone_seed)
app.route('/', cmdkAiActionsRouter); // /api/cmdk/resolve (flag: cmdk_ai_actions)
app.route('/', aeoPass); // /api/aeo/* (flag: aeo_pass)
app.route('/', statusPageLive); // /api/status/* (flag: status_page_live)
app.route('/', siteThumbnailGrid); // /api/thumbnails/* (flag: site_thumbnail_grid)

app.route('/', api);
app.route('/', webhooks);
app.route('/', sesWebhooks); // POST /webhooks/ses — SES bounce/complaint → suppression list (§42/ADR-0019)

// ─── Public status page (item #100) ─────────────────────────
// Self-hosted status page served on every hostname so customers can hit
// /status on the marketing root OR their custom-domain.com/status and see
// live dependency health. Polls /health/deep on the same origin every 30s.
app.get('/status', async (c) => {
  const hostname = c.req.header('host') ?? '';
  if (
    hostname === DOMAINS.SITES_BASE ||
    hostname === `www.${DOMAINS.SITES_BASE}` ||
    hostname.startsWith('localhost')
  ) {
    try {
      const r2 = await c.env.SITES_BUCKET.get('marketing/status.html');
      if (r2) {
        return new Response(await r2.text(), {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60' },
        });
      }
    } catch {
      // fall through to inline below
    }
  }
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status · Project Sites</title><meta name="color-scheme" content="dark"><link rel="icon" href="/favicon.ico"><style>:root{--bg:#060610;--accent:#00e5ff;--text:#e2e8f0;--text-muted:#94a3b8;--card:rgba(255,255,255,0.03);--border:rgba(0,229,255,0.18);--green:#22c55e;--amber:#f59e0b;--red:#ef4444}*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh}.wrap{max-width:760px;margin:0 auto;padding:56px 24px 80px}.eyebrow{font-size:12px;letter-spacing:2px;color:var(--accent);text-transform:uppercase;font-weight:600}h1{font-size:36px;margin:8px 0 6px;font-weight:700}.summary{font-size:16px;color:var(--text-muted);margin-bottom:28px}.live-pill{display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);color:var(--green);font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:1px}.live-pill::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.4)}50%{box-shadow:0 0 0 6px rgba(34,197,94,0)}}.status-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px}.status-pill[data-state='up']{background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);color:var(--green)}.status-pill[data-state='degraded']{background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:var(--amber)}.status-pill[data-state='down']{background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);color:var(--red)}.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 24px;margin-bottom:14px}.row{display:flex;align-items:center;justify-content:space-between;gap:16px}.row+.row{margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.05)}.row .label{font-weight:600;font-size:15px}.row .sub{font-size:12px;color:var(--text-muted);margin-top:2px}footer{margin-top:36px;font-size:12px;color:var(--text-muted);text-align:center}footer a{color:var(--accent);text-decoration:underline}.hero-status{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}</style></head><body><main class="wrap"><div class="eyebrow">System status</div><h1 id="overall-headline">All systems operational</h1><p class="summary" id="summary-text">Live data refreshed every 30 seconds.</p><div class="hero-status"><span class="live-pill">Live</span><span id="last-checked" style="font-size:12px;color:var(--text-muted)"></span></div><section class="card"><div class="row"><div><div class="label">D1 (database)</div><div class="sub" id="d1-sub">Primary relational store</div></div><span class="status-pill" data-state="up" id="d1-pill">UP</span></div><div class="row"><div><div class="label">KV (cache)</div><div class="sub" id="kv-sub">Host resolution + prompt store</div></div><span class="status-pill" data-state="up" id="kv-pill">UP</span></div><div class="row"><div><div class="label">R2 (object storage)</div><div class="sub" id="r2-sub">Static site bucket</div></div><span class="status-pill" data-state="up" id="r2-pill">UP</span></div><div class="row"><div><div class="label">AI (Workers AI)</div><div class="sub" id="ai-sub">LLM inference binding</div></div><span class="status-pill" data-state="up" id="ai-pill">UP</span></div></section><footer>Powered by Cloudflare Workers · auto-refresh every 30s · <a href="/health/deep">/health/deep JSON</a></footer></main><script>const STATE_LABEL={up:'UP',degraded:'DEGRADED',down:'DOWN'};async function refresh(){try{const res=await fetch('/health/deep',{cache:'no-store'});const data=await res.json();const checks=data.checks||{};const components=['d1','kv','r2','ai'];let worst='up';for(const c of components){const check=checks[c];let state='up';if(!check)state='down';else if(check.status==='error')state='down';else if(check.status==='degraded')state='degraded';const pill=document.getElementById(c+'-pill');if(pill){pill.dataset.state=state;pill.textContent=STATE_LABEL[state]}if(state==='down')worst='down';else if(state==='degraded'&&worst==='up')worst='degraded'}const head=document.getElementById('overall-headline');const summary=document.getElementById('summary-text');if(worst==='up'){head.textContent='All systems operational';summary.textContent='Every monitored dependency is responding within budget.'}else if(worst==='degraded'){head.textContent='Partial degradation';summary.textContent='One or more dependencies are responding slowly.'}else{head.textContent='Active incident';summary.textContent='One or more dependencies are unreachable. We are investigating.'}document.getElementById('last-checked').textContent='Last checked '+new Date().toLocaleTimeString()}catch(err){document.getElementById('overall-headline').textContent='Status unavailable'}}refresh();setInterval(refresh,30000);</script></body></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60' },
  });
});

// Diagnostic: round-trip the container with a static index.html. Proves
// container can boot → write file → upload R2 → return, without Claude Code.
app.post('/api/diag/container-minimal', async (c) => {
  const secret = c.req.header('x-test-secret') || '';
  if (!secret || secret !== (c.env.CF_API_TOKEN || '').slice(0, 12)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!c.env.SITE_BUILDER) return c.json({ error: 'SITE_BUILDER not configured' }, 500);
  const slug = ((await c.req.json().catch(() => ({}))) as { slug?: string }).slug || 'minimal-test';
  const id = c.env.SITE_BUILDER.idFromName(`${slug}-build-test`);
  const stub = c.env.SITE_BUILDER.get(id);
  const t0 = Date.now();
  const res = await stub.fetch('http://container/build-minimal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      envVars: {
        CF_API_TOKEN: c.env.CF_API_TOKEN || '',
        CF_ACCOUNT_ID: '84fa0d1b16ff8086dd958c468ce7fd59',
        R2_BUCKET_NAME: 'project-sites-production',
        SITE_SLUG: slug,
        SITE_VERSION: `v-${Date.now()}`,
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json({ workerElapsedMs: Date.now() - t0, ...data });
});

// Container→worker build status callback (HMAC-protected, KV-backed).
// Container POSTs status updates here. Worker writes to CACHE_KV at key
// `build:{jobId}` so the workflow can poll KV instead of the container.
// State survives container replacement.
app.post('/api/internal/build-status', async (c) => {
  const secret = c.env.INTERNAL_BUILD_SECRET;
  if (!secret) return c.json({ error: 'callback not configured' }, 500);
  const sig = c.req.header('x-build-sig') || '';
  const body = await c.req.text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  const expected = Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (sig !== expected) return c.json({ error: 'invalid signature' }, 401);
  let payload: { jobId?: string; status?: string; step?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: 'bad json' }, 400);
  }
  const jobId = payload.jobId;
  if (!jobId || typeof jobId !== 'string') return c.json({ error: 'missing jobId' }, 400);
  const record = JSON.stringify({ ...payload, lastUpdate: Date.now() });
  await c.env.CACHE_KV.put(`build:${jobId}`, record, { expirationTtl: 3600 });

  // If this is a claim-originated build that just finished/failed, flip its claim
  // session (building → completed | failed) + email the owner. No-op for normal
  // builds (jobId == siteId has no claim session) and for non-terminal statuses.
  // Best-effort + backgrounded so the email send never slows the callback.
  let ec: ExecutionContext | undefined;
  try {
    ec = c.executionCtx;
  } catch {
    ec = undefined;
  }
  // #24 — claim-build finalize is deploy/claim-critical; a silent `.catch(() => {})`
  // hid failures (a finished build that never flips the claim session / never emails
  // the owner).
  const finalize = maybeCompleteClaimBuild(c.env, jobId, payload.status ?? '').catch((e) => {
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'build_status_finalize',
        job_id: jobId,
        status: payload.status ?? null,
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  });
  if (ec) ec.waitUntil(finalize);
  else await finalize;

  return c.json({ ok: true });
});

/**
 * Render a branded interstitial for `*.app.projectsites.dev` when the
 * underlying container is not in a `running` state. Kept inline because
 * the worker already ships ~80 KB of static HTML for the 404 page and the
 * App-tab shell is small enough to colocate.
 */
function renderAppShellHtml(
  state: 'booting' | 'crashed' | 'stopped' | 'not-found',
  data: { sub: string; slug?: string; err?: string; id?: string },
): string {
  const titles: Record<typeof state, string> = {
    booting: 'Booting your app',
    crashed: 'App crashed',
    stopped: 'App is stopped',
    'not-found': 'App not found',
  };
  // Escape every request/container-derived field — this page is served as HTML
  // and `sub` (from the Host header, NOT DNS-validated at the HTTP layer),
  // `err` (container output), `slug`, and `id` could otherwise reflect markup.
  const safeSub = escapeHtml(data.sub);
  const safeSlug = escapeHtml(data.slug ?? '—');
  const safeErr = escapeHtml(data.err ?? 'Unknown error');
  const safeId = escapeHtml(data.id ?? '');
  const bodies: Record<typeof state, string> = {
    booting: 'Your container is provisioning. This page refreshes automatically every 3 seconds.',
    crashed: `${safeErr} — open the admin to inspect logs and restart.`,
    stopped: 'The container is stopped. Restart it from the admin dashboard.',
    'not-found': `No app instance with subdomain "${safeSub}".`,
  };
  const cta =
    state === 'not-found'
      ? '<a class="btn" href="https://projectsites.dev/admin/apps">Browse apps</a>'
      : `<a class="btn" href="https://projectsites.dev/admin/apps/${safeId}">Open admin</a>`;
  const title = titles[state];
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ProjectSites</title><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Fira+Code:wght@400&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#e0e0e0;font-family:'Space Grotesk',sans-serif;padding:2rem}.box{max-width:560px;text-align:center}h1{font-size:2.2rem;background:linear-gradient(135deg,#00ffc8,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#00ffc8;animation:pulse 1.4s ease-in-out infinite;margin-right:.5rem;vertical-align:middle}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}p{color:#8892a4;font-size:1.05rem;line-height:1.5;margin-bottom:2rem}.btn{display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00ffc8,#7c3aed);color:#0a0a0f;font-weight:600;border-radius:50px;text-decoration:none}.meta{margin-top:2rem;font-family:'Fira Code',monospace;font-size:.75rem;color:#4a9;background:rgba(0,255,200,.05);border:1px solid rgba(0,255,200,.1);padding:1rem;border-radius:8px;text-align:left}</style></head><body><div class="box"><h1>${state === 'booting' ? '<span class="dot"></span>' : ''}${title}</h1><p>${bodies[state]}</p>${cta}<div class="meta">app: ${safeSlug}<br>subdomain: ${safeSub}<br>state: ${state}</div></div></body></html>`;
}

// ─── LLM Gateway landing ─────────────────────────────────────
// `llm.projectsites.dev/` exposes the OpenAI-compatible `/v1/*` API, but the
// bare root used to fall through to the site-serving catch-all and 404. Serve a
// "what is this + how to use it" landing for the gateway host; every other host
// falls through unchanged to the marketing/site-serving catch-all below.
app.get('/', async (c, next) => {
  const hostname = (c.req.header('host') ?? '').toLowerCase();
  if (hostname === `llm.${DOMAINS.SITES_BASE}`) {
    return c.html(llmLandingPage());
  }
  // System-service subdomains (api/auth/billing/analytics/notify/browser/traces/
  // jobs/app) are registry labels for bindings/SaaS/internal services — they have
  // no root page and otherwise fall through to the site-serving 404. Serve an
  // honest branded 200 status page at their root; real surfaces (/api/*, vendor
  // dashboards, bindings) are unaffected since this only matches GET `/`.
  const svc = resolveSystemService(hostname);
  if (svc) {
    return c.html(systemServiceLanding(svc));
  }
  return next();
});

// ─── Site Serving (catch-all for subdomain routing) ──────────

app.all('*', async (c) => {
  const hostname = c.req.header('host') ?? '';
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Serve the marketing site homepage for the base domain
  if (
    hostname === DOMAINS.SITES_BASE ||
    hostname === `www.${DOMAINS.SITES_BASE}` ||
    hostname.startsWith('localhost')
  ) {
    // /contact redirects to the contact section, which lives on /search
    // (#contact-section is rendered by SearchComponent, not the homepage —
    // redirecting to /#contact-section landed on a non-existent anchor).
    if (path === '/contact') {
      return Response.redirect(`https://${DOMAINS.SITES_BASE}/search#contact-section`, 301);
    }

    // Angular SPA handles all routes — serve index.html for non-file paths
    const hasExtension = path.includes('.') && !path.endsWith('/');
    const marketingPath = hasExtension ? `marketing${path}` : 'marketing/index.html';
    const marketingAsset = await c.env.SITES_BUCKET.get(marketingPath);

    if (marketingAsset) {
      const resolvedPath = marketingAsset.key;
      const ext = resolvedPath.split('.').pop()?.toLowerCase() ?? 'html';
      const mimeTypes: Record<string, string> = {
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        xml: 'application/xml',
        webmanifest: 'application/manifest+json',
        txt: 'text/plain',
        woff2: 'font/woff2',
      };

      // For HTML, inject runtime env vars (PostHog key, Stripe publishable
      // key) so the SPA shell can read them from meta tags before first paint.
      if (ext === 'html') {
        let html = await marketingAsset.text();
        const phKey = c.env.POSTHOG_API_KEY ?? 'none';
        const stripePk = c.env.STRIPE_PUBLISHABLE_KEY ?? '';

        // ALL-STAR items #15 + #20 + #21 injection block.
        // #15 Speculation Rules: prerender same-origin nav, prefetch external on hover.
        // #20 Structured-data autopilot: Organization + WebSite emitted on every marketing route.
        // #21 Quotable answer block: 40-60 word AI-search-extractable lead paragraph; visually
        //     hidden but available to crawlers + screen readers (sr-only pattern).
        const speculationRules = `<script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/admin/*"}},{"not":{"href_matches":"/api/*"}}]},"eagerness":"moderate"}],"prefetch":[{"where":{"href_matches":"/*"},"eagerness":"conservative"}]}</script>`;
        // Per-route WebPage + BreadcrumbList (was hardcoded to the homepage on
        // EVERY route — inaccurate on /privacy, /blog, etc.). `path` (url.pathname)
        // is the requested route; derive an accurate page url + breadcrumb trail
        // server-side so non-JS crawlers get route-correct structured data. The
        // Angular client re-confirms the same values post-hydration (idempotent).
        const cleanPath = path === '/' ? '/' : path.replace(/\/+$/, '');
        const pageUrl =
          cleanPath === '/' ? 'https://projectsites.dev/' : `https://projectsites.dev${cleanPath}`;
        const seg = cleanPath === '/' ? '' : (cleanPath.split('/').filter(Boolean).pop() ?? '');
        const segName = seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
        const pageName = seg
          ? `${segName} | Project Sites`
          : 'Project Sites — AI Website Builder on Cloudflare';
        const crumbItems = seg
          ? [
              { name: 'Home', item: 'https://projectsites.dev/' },
              { name: segName, item: pageUrl },
            ]
          : [{ name: 'Home', item: 'https://projectsites.dev/' }];
        const jsonLd = `<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              '@id': 'https://projectsites.dev/#org',
              name: 'Project Sites',
              url: 'https://projectsites.dev/',
              logo: 'https://projectsites.dev/logo.svg',
              email: 'hey@projectsites.dev',
              sameAs: ['https://github.com/HeyMegabyte/projectsites.dev'],
            },
            {
              '@type': 'WebSite',
              '@id': 'https://projectsites.dev/#site',
              url: 'https://projectsites.dev/',
              name: 'Project Sites',
              publisher: { '@id': 'https://projectsites.dev/#org' },
              inLanguage: 'en-US',
              potentialAction: {
                '@type': 'SearchAction',
                target: 'https://projectsites.dev/?q={search_term_string}',
                'query-input': 'required name=search_term_string',
              },
            },
            {
              '@type': 'WebPage',
              '@id': `${pageUrl}#webpage`,
              url: pageUrl,
              name: pageName,
              ...(seg
                ? {}
                : {
                    description:
                      'AI-generated websites for small business in under 15 minutes. Multi-model router, axe-core publish gate, Core Web Vitals publish gate, GEO + AI search built-in.',
                  }),
              isPartOf: { '@id': 'https://projectsites.dev/#site' },
              about: { '@id': 'https://projectsites.dev/#org' },
            },
            {
              '@type': 'BreadcrumbList',
              '@id': `${pageUrl}#breadcrumb`,
              itemListElement: crumbItems.map((crumb, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: crumb.name,
                item: crumb.item,
              })),
            },
          ],
        })}</script>`;
        const quotable = `<div data-quotable style="position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">Project Sites builds and deploys complete AI-generated websites for small business in under 15 minutes on Cloudflare Workers. Customers pick the AI model per prompt (Claude Opus 4.7, Sonnet 4.6, Workers AI Llama 3.3 70B FP8, GPT-5). Every publish runs an axe-core accessibility gate at six viewports and a Lighthouse Core Web Vitals gate, blocking deploys that fail WCAG 2.2 AA or LCP under 2.5 seconds.</div>`;

        html = html.replace(
          '</head>',
          `<meta name="x-posthog-key" content="${phKey}">\n<meta name="x-stripe-pk" content="${stripePk}">\n${speculationRules}\n${jsonLd}\n</head>`,
        );
        html = html.replace('<body>', `<body>\n${quotable}\n`);

        return new Response(html, {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=60',
            // Cross-origin isolation for WebContainers in embedded bolt.diy editor
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Origin-Agent-Cluster': '?1',
            // ALL-STAR #15 hint to CDN/CDN-aware clients
            Link: '<https://projectsites.dev/>; rel="prerender"',
          },
        });
      }

      return new Response(marketingAsset.body, {
        headers: {
          'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Final fallback: return JSON info when no static assets deployed at all
    return c.json(
      {
        name: 'Project Sites',
        tagline: 'Your website\u2014handled. Finally.',
        version: '0.1.0',
        homepage: 'Deploy the marketing site to R2 at marketing/index.html',
      },
      200,
    );
  }

  // template.projectsites.dev → proxy to Cloudflare Pages (gallery of applied examples)
  if (hostname === 'template.projectsites.dev') {
    const pagesUrl = `https://template-projectsites-dev.pages.dev${path}${url.search}`;
    const pagesRes = await fetch(pagesUrl, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
    });
    return new Response(pagesRes.body, {
      status: pagesRes.status,
      headers: pagesRes.headers,
    });
  }

  // (editor.projectsites.dev → bolt-diy Pages proxy hoisted to early middleware
  // near the top of the pipeline — see the `app.use('*', ...)` host-gated proxy,
  // round 145 — so editor /api/* paths proxy too instead of being pre-empted by
  // the worker's own /api routing.)

  // ─── Apps tab — *.app.projectsites.dev → AppRuntime container DO ──
  // Hostnames of the form `{subdomain}.app.projectsites.dev` resolve to
  // a row in `app_instances` and proxy the request to its container DO.
  // Match `{subdomain}.app.projectsites.dev`. Wildcard SAN `*.app.projectsites.dev`
  // must be provisioned via CF Advanced Certificate Manager (or a custom-
  // hostname rule) since the existing Universal SSL only covers the
  // single-level `*.projectsites.dev`. Track via RECS.md.
  // Serve an app instance by its subdomain. Used by BOTH the platform suffix
  // (`{sub}.app.projectsites.dev`) AND a custom CNAME resolved via the Phase-1
  // host-map (`app.theirdomain.com` → instance), so the two paths share one body.
  const serveAppBySubdomain = async (sub: string): Promise<Response> => {
    const inst = await dbQueryOne<{
      id: string;
      status: string;
      do_instance_id: string | null;
      last_error: string | null;
      app_slug: string;
    }>(
      c.env.DB,
      `SELECT id, status, do_instance_id, last_error, app_slug FROM app_instances
         WHERE subdomain = ? AND deleted_at IS NULL`,
      [sub],
    );
    if (!inst) {
      return new Response(renderAppShellHtml('not-found', { sub }), {
        status: 404,
        headers: { 'Content-Type': 'text/html;charset=utf-8' },
      });
    }
    if (inst.status === 'provisioning' || inst.status === 'starting') {
      return new Response(renderAppShellHtml('booting', { sub, slug: inst.app_slug }), {
        status: 202,
        headers: {
          'Content-Type': 'text/html;charset=utf-8',
          'Cache-Control': 'no-store',
          Refresh: '3',
        },
      });
    }
    if (inst.status === 'error' || inst.status === 'crashed') {
      return new Response(
        renderAppShellHtml('crashed', {
          sub,
          slug: inst.app_slug,
          err: inst.last_error ?? 'unknown',
          id: inst.id,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
        },
      );
    }
    if (inst.status === 'stopped' || inst.status === 'destroyed') {
      return new Response(
        renderAppShellHtml('stopped', { sub, slug: inst.app_slug, id: inst.id }),
        {
          status: 503,
          headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
        },
      );
    }
    return proxyToContainer(c.env, inst.do_instance_id ?? inst.id, c.req.raw, inst.app_slug);
  };

  if (hostname.endsWith('.app.projectsites.dev') && hostname !== '.app.projectsites.dev') {
    return serveAppBySubdomain(hostname.slice(0, -'.app.projectsites.dev'.length));
  }

  // Resolve the site from hostname using D1
  const site = await resolveSite(c.env, c.env.DB, hostname);

  if (!site) {
    // Phase 1b (scale-to-zero routing): a hostname that matched no site may be a
    // custom app CNAME (`app.theirdomain.com → projectsites.dev`). Consult the
    // host-map; if it maps to an instance, serve it. Only runs AFTER resolveSite
    // misses, so normal site traffic pays no extra KV read.
    const appHost = await resolveAppHost(c.env, hostname);
    if (appHost) {
      return serveAppBySubdomain(appHost.subdomain);
    }

    const reqId = c.get('requestId') || 'unknown';
    const errorHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found | ProjectSites</title><link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#e0e0e0;font-family:'Space Grotesk',sans-serif;overflow:hidden}@keyframes glitch{0%,100%{transform:translate(0)}20%{transform:translate(-2px,2px)}40%{transform:translate(2px,-2px)}60%{transform:translate(-1px,-1px)}80%{transform:translate(1px,1px)}}@keyframes scanline{0%{top:-100%}100%{top:100%}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}.container{text-align:center;max-width:600px;padding:2rem;position:relative;z-index:1}.bg{position:fixed;inset:0;background:linear-gradient(-45deg,#0a0a0f,#0d1117,#0a1628,#0f0a1e);background-size:400% 400%;animation:gradient 8s ease infinite}.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(0,255,200,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,.03) 1px,transparent 1px);background-size:60px 60px}.scanline{position:fixed;width:100%;height:4px;background:linear-gradient(90deg,transparent,rgba(0,255,200,.08),transparent);animation:scanline 4s linear infinite;z-index:0}.code{font-size:8rem;font-weight:700;background:linear-gradient(135deg,#00ffc8,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:float 3s ease-in-out infinite;line-height:1}.msg{font-size:1.5rem;color:#8892a4;margin:1rem 0 2rem;animation:pulse 3s ease-in-out infinite}.btn{display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#00ffc8,#00d4ff);color:#0a0a0f;font-weight:600;border-radius:50px;text-decoration:none;transition:all .3s;font-family:inherit}.btn:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(0,255,200,.3)}.debug{margin-top:3rem;text-align:left;background:rgba(0,255,200,.04);border:1px solid rgba(0,255,200,.1);border-radius:12px;padding:1.5rem;font-family:'Fira Code',monospace;font-size:.75rem;color:#4a9;line-height:1.8}.debug-title{color:#00ffc8;font-size:.85rem;margin-bottom:.5rem;font-weight:500}.debug span{color:#667}</style></head><body><div class="bg"></div><div class="grid"></div><div class="scanline"></div><div class="container"><div class="code">404</div><p class="msg">This site doesn't exist yet</p><a class="btn" href="https://projectsites.dev/create">Build it with AI</a><div class="debug"><div class="debug-title">// debug info</div><span>hostname:</span> ${hostname}<br><span>request_id:</span> ${reqId}<br><span>timestamp:</span> ${new Date().toISOString()}<br><span>resolved:</span> null<br><span>edge:</span> ${c.req.header('cf-ray') || 'unknown'}<br><span>colo:</span> ${(c.req.raw as any).cf?.colo || 'unknown'}</div></div></body></html>`;
    return new Response(errorHtml, {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  }

  // (Removed: a dead `?chat` branch that returned raw JSON
  // ("Chat overlay - authentication required") to any visitor who appended
  // `?chat` — an unfinished stub nothing linked to or consumed. Unknown query
  // params now fall through to normal site serving. A real on-site chat overlay,
  // if ever built, belongs behind a feature flag as an injected frontend widget,
  // not a JSON branch on the serving path.)

  // Record an anonymous edge pageview (Cloudflare-native, fire-and-forget) so
  // visitor navigations surface in the per-site analytics dashboard. Never
  // blocks or fails serving — see recordPageviewFromRequest.
  c.executionCtx.waitUntil(
    recordPageviewFromRequest(c.env, { orgId: site.org_id, siteId: site.site_id }, c.req.raw, path),
  );

  // Serve static site from R2
  return serveSiteFromR2(c.env, site, path);
});

// ─── Queue Consumer ──────────────────────────────────────────

export default {
  fetch: app.fetch,

  /**
   * Queue consumer handler for workflow jobs.
   *
   * Processes queued `generate_site` jobs by running the v2 AI workflow,
   * uploading results to R2, and updating the site record in D1.
   */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const payload = message.body as Record<string, unknown>;
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'queue',
            message: `Processing job: ${payload.job_name}`,
            site_id: payload.site_id,
          }),
        );

        if (payload.job_name === 'generate_site') {
          const { runSiteGenerationWorkflowV2 } = await import('./services/ai_workflows.js');

          const result = await runSiteGenerationWorkflowV2(env, {
            businessName: String(payload.business_name ?? ''),
            businessAddress: payload.business_address
              ? String(payload.business_address)
              : undefined,
            businessPhone: payload.business_phone ? String(payload.business_phone) : undefined,
            googlePlaceId: payload.google_place_id ? String(payload.google_place_id) : undefined,
            additionalContext: payload.additional_context
              ? String(payload.additional_context)
              : undefined,
          });

          // Upload generated files to R2
          const siteId = String(payload.site_id);
          const slug = String(payload.slug ?? payload.business_name ?? 'site')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const version = new Date().toISOString().replace(/[:.]/g, '-');

          // Upload main page, privacy page, and terms page in parallel
          await Promise.all([
            env.SITES_BUCKET.put(`sites/${slug}/${version}/index.html`, result.html, {
              httpMetadata: { contentType: 'text/html' },
            }),
            env.SITES_BUCKET.put(`sites/${slug}/${version}/privacy.html`, result.privacyHtml, {
              httpMetadata: { contentType: 'text/html' },
            }),
            env.SITES_BUCKET.put(`sites/${slug}/${version}/terms.html`, result.termsHtml, {
              httpMetadata: { contentType: 'text/html' },
            }),
            // Store research data as JSON for future rebuilds
            env.SITES_BUCKET.put(
              `sites/${slug}/${version}/research.json`,
              JSON.stringify(result.research, null, 2),
              { httpMetadata: { contentType: 'application/json' } },
            ),
          ]);

          // Update site record in D1
          await dbUpdate(
            env.DB,
            'sites',
            {
              status: 'published',
              current_build_version: version,
            },
            'id = ?',
            [siteId],
          );

          console.warn(
            JSON.stringify({
              level: 'info',
              service: 'queue',
              message: `Site generated and published`,
              site_id: siteId,
              slug,
              version,
              quality_score: result.quality.overall,
              pages_uploaded: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
            }),
          );
        }

        message.ack();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            service: 'queue',
            message: err instanceof Error ? err.message : 'Job processing failed',
          }),
        );
        message.retry();
      }
    }
  },

  /**
   * Scheduled handler for periodic tasks (cron triggers).
   *
   * Runs:
   * - Verify pending custom hostnames via Cloudflare API
   * - Log results for observability
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.warn(
      JSON.stringify({
        level: 'info',
        service: 'cron',
        message: 'Scheduled task triggered',
        trigger: _event.cron,
      }),
    );

    try {
      const { verifyPendingHostnames } = await import('./services/domains.js');
      const result = await verifyPendingHostnames(env.DB, env);

      console.warn(
        JSON.stringify({
          level: 'info',
          service: 'cron',
          message: 'Hostname verification complete',
          verified: result.verified,
          failed: result.failed,
        }),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'cron',
          message: 'Hostname verification failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Unstick stuck builds — any site in 'building' status for > 30 minutes gets marked as 'error'
    try {
      const { dbQuery, dbExecute } = await import('./services/db.js');
      const stuckSites = await dbQuery<{ id: string; slug: string; business_name: string }>(
        env.DB,
        `SELECT id, slug, business_name FROM sites
         WHERE status IN ('building', 'queued', 'generating', 'imaging', 'uploading')
         AND updated_at < datetime('now', '-30 minutes')
         AND deleted_at IS NULL`,
        [],
      );

      if (stuckSites.data.length > 0) {
        for (const site of stuckSites.data) {
          await dbExecute(
            env.DB,
            `UPDATE sites SET status = 'error', updated_at = datetime('now') WHERE id = ?`,
            [site.id],
          );
          console.warn(
            JSON.stringify({
              level: 'warn',
              service: 'cron',
              message: 'Unstuck build',
              siteId: site.id,
              slug: site.slug,
              businessName: site.business_name,
            }),
          );
        }
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: `Unstuck ${stuckSites.data.length} builds`,
          }),
        );
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'cron',
          message: 'Stuck build scanner failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // AN5 — once daily, roll up yesterday's visitor_events into analytics_daily so
    // owner analytics answers "last N days" in O(days) rows. Idempotent UPSERT, so a
    // missed/replayed day self-heals on the next run. Runs only on the daily 06:00 UTC trigger.
    if (_event.cron === '0 6 * * *') {
      try {
        const { rollupAnalyticsDaily } = await import('./services/analytics_rollup.js');
        const r = await rollupAnalyticsDaily(env);
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: 'Analytics daily rollup complete',
            day: r.day,
            changes: r.changes,
            error: r.error,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Analytics daily rollup failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Every 5 min — drain the event_bus outbox to its backends (Tinybird analytics
    // + Hatchet orchestration). Env-gated adapters no-op when unconfigured, so this
    // is safe on a fresh deploy. Off the hot path (cron only). Idempotent + FIFO
    // with a dead-letter gate (see event_bus.nextOutboxAction). Repurposes the
    // former no-op */5 slot.
    if (_event.cron === '*/5 * * * *') {
      try {
        const { drainOutbox, assessDrainHealth } = await import('./services/outbox_dispatch.js');
        const summary = await drainOutbox(env);
        if (summary.read > 0) {
          // Escalate failures / backlog to warn so they surface above the info noise
          // (events failing dispatch head toward the dead-letter gate silently otherwise).
          const health = assessDrainHealth(summary);
          console.warn(
            JSON.stringify({
              level: health.level,
              service: 'cron',
              message: `Outbox drained — ${health.message}`,
              read: summary.read,
              dispatched: summary.dispatched,
              failed: summary.failed,
            }),
          );
          // Dead-lettering = silent loss of golden-path events from analytics +
          // orchestration. Log failures (not mere backlog, which is
          // transient under load).
          if (health.hasFailures) {
            console.warn(
              JSON.stringify({
                level: 'warn',
                service: 'cron_outbox',
                message: 'Outbox events failing dispatch (heading to dead-letter)',
                read: summary.read,
                dispatched: summary.dispatched,
                failed: summary.failed,
              }),
            );
          }
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Outbox drain failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Monday 14:00 UTC (9 AM ET) — weekly summary digest emails (#96).
    // Idempotent per (org, ISO week) — safe to retry/replay.
    if (_event.cron === '0 14 * * 1') {
      try {
        const { sendWeeklyDigestsForAllOrgs } = await import('./services/weekly_digest.js');
        const result = await sendWeeklyDigestsForAllOrgs(env);
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: 'Weekly digest dispatched',
            ...result,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Weekly digest cron failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Daily 06:00 UTC — backfill snapshot quality metrics for any snapshot
    // newer than 7 days that's still missing its metrics row. Caps at 50
    // per run so a backlog never melts Browser Rendering quota.
    if (_event.cron === '0 6 * * *') {
      try {
        const { runSnapshotMetricsBackfillCron } = await import('./workflows/snapshot-quality.js');
        const result = await runSnapshotMetricsBackfillCron(env);
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: 'Snapshot metrics backfill complete',
            ...result,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Snapshot metrics backfill failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      // Table hygiene: prune delivered (dispatched) outbox rows older than 30
      // days so event_bus.outbox_events doesn't grow unbounded. Pending + failed
      // rows are never touched. Own try/catch so a prune failure can't block the
      // snapshot backfill above (or vice-versa).
      try {
        const { pruneDispatchedOutbox } = await import('./services/event_bus.js');
        const { deleted } = await pruneDispatchedOutbox(env, 30);
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: 'Outbox retention prune complete',
            deleted,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Outbox retention prune failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Hourly: re-pull every connected Google Drive folder for AI chat context.
    // Soft-fails per site so one failure cannot block the rest.
    if (_event.cron === '0 * * * *' || _event.cron === '0 0 * * *') {
      try {
        const { syncAllSites } = await import('./services/ai_drive_sync.js');
        const results = await syncAllSites(env, env.DB);
        const summary = results.reduce(
          (acc, r) => {
            acc.total += 1;
            if (r.ok) acc.ok += 1;
            else acc.failed += 1;
            return acc;
          },
          { total: 0, ok: 0, failed: 0 },
        );
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: 'Drive sync complete',
            ...summary,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Drive sync failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Every minute: Pulse Social Auto-Pilot sweep. Picks orgs whose
    // auto-pilot is enabled and past due, generates one draft per target
    // network, and bumps next_run_at by cadence_hours. Drafts only — the
    // user reviews + publishes manually (safety rail). Capped at 10
    // orgs/run so a backlog never burns the LLM budget.
    if (_event.cron === '* * * * *') {
      try {
        const { runAutoPilotIfDue } = await import('./services/social_auto_pilot.js');
        const result = await runAutoPilotIfDue(env, 10);
        if (result.orgs_scanned > 0) {
          console.warn(
            JSON.stringify({
              level: 'info',
              service: 'cron',
              message: 'Pulse Social auto-pilot sweep',
              ...result,
            }),
          );
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Pulse Social auto-pilot sweep failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Every minute: Pulse Social due-post sweep. Picks up any post in
    // status='scheduled' with scheduled_at in [NOW-10min, NOW] and fires the
    // SocialPublishWorkflow. The lower bound prevents replays after long
    // worker outages. Capped at 25 posts/run.
    if (_event.cron === '* * * * *') {
      try {
        const { dbQuery, dbUpdate } = await import('./services/db.js');
        const lower = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const upper = new Date().toISOString();
        const { data: due } = await dbQuery<{ id: string }>(
          env.DB,
          `SELECT id FROM pulse_posts
            WHERE deleted_at IS NULL AND status = 'scheduled'
              AND scheduled_at <= ? AND scheduled_at > ?
            ORDER BY scheduled_at ASC LIMIT 25`,
          [upper, lower],
        );
        const wfBinding = (
          env as unknown as {
            SOCIAL_PUBLISH_WORKFLOW?: {
              create: (opts: { id: string; params: { post_id: string } }) => Promise<unknown>;
            };
          }
        ).SOCIAL_PUBLISH_WORKFLOW;
        let fired = 0;
        for (const p of due) {
          // Optimistically flip → publishing so the next sweep skips this row.
          const { changes } = await dbUpdate(
            env.DB,
            'pulse_posts',
            { status: 'publishing' },
            "id = ? AND status = 'scheduled'",
            [p.id],
          );
          if (changes === 0) continue;
          if (wfBinding) {
            await wfBinding
              .create({ id: `social-publish-${p.id}-${Date.now()}`, params: { post_id: p.id } })
              .catch((err: unknown) => {
                console.warn(
                  JSON.stringify({
                    level: 'warn',
                    service: 'cron',
                    message: 'social_publish_create_failed',
                    post_id: p.id,
                    error: err instanceof Error ? err.message : String(err),
                  }),
                );
              });
          }
          fired++;
        }
        if (fired > 0) {
          console.warn(
            JSON.stringify({
              level: 'info',
              service: 'cron',
              message: 'Pulse Social due-post sweep',
              fired,
              scanned: due.length,
            }),
          );
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Pulse Social sweep failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Hourly: Pulse Social analytics snapshot pull. For every social_publishes
    // row that succeeded in the last 30 days, hit the platform's metrics
    // endpoint and write a fresh social_analytics_snapshots row. Capped at
    // 200/run so a backlog never melts platform rate limits.
    if (_event.cron === '0 * * * *') {
      try {
        const result = await runHourlyPulseAnalyticsCron(env);
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'cron',
            message: 'Pulse Social analytics snapshot',
            ...result,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'cron',
            message: 'Pulse Social analytics cron failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  },
};
