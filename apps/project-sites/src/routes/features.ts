/**
 * Feature endpoints — flag-gated per [[feature-flags]] SUPREME rule.
 *
 * Two surfaces live here:
 *
 *   1. **Public discovery routes** (no flag gate — stable registry flag) —
 *      `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/accessibility`,
 *      `/.well-known/mcp`, `/.well-known/oauth-protected-resource`,
 *      `/api/openapi.json`, `/api/cli/version`.
 *
 *   2. **Feature API endpoints** — every endpoint behind a registry flag via
 *      `requireFlag(flagKey)` middleware. Off → 404 (never 403; don't leak
 *      feature existence). On → handler runs. Semantic per-feature paths only —
 *      no umbrella prefixes.
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { Env } from '../types/env';
import { DOMAINS } from '@project-sites/shared';
import * as F from '../services/features.js';
import * as B from '../services/brilliant.js';
import { isFlagOn, resolveFlag, FLAG_REGISTRY } from '../modules/feature_flags/services.js';
import { listFlags } from '../modules/feature_flags/registry.js';
import { FLAG_DOCS, getDocs } from '../modules/feature_flags/docs.js';

const features = new Hono<{ Bindings: Env }>();

features.use('*', async (c, next) => {
  const hostname = c.req.header('host') ?? '';
  const isMarketingRoot =
    hostname === DOMAINS.SITES_BASE ||
    hostname === `www.${DOMAINS.SITES_BASE}` ||
    hostname.startsWith('localhost') ||
    hostname.endsWith('.workers.dev');
  if (!isMarketingRoot) return next();
  return next();
});

function requireFlag(flagKey: string) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const scope = {
      orgId: c.req.header('x-org-id') ?? c.req.query('org_id'),
      siteId: c.req.header('x-site-id') ?? c.req.query('site_id'),
      userId: c.req.header('x-user-id'),
      anonId: c.req.header('cf-ray'),
    };
    const on = await isFlagOn(c.env, flagKey, scope);
    if (!on) return c.json({ error: 'not_found' }, 404);
    return next();
  };
}

// ─── Public discovery (stable flags default-on) ──────────────────────

features.get('/llms.txt', () => {
  const body = `# Project Sites — projectsites.dev

> Your website—handled. Finally. Projectsites.dev generates and hosts
> AI-built websites for small businesses on Cloudflare Workers.

## Highest-priority routes for AI search engines

- [/](https://projectsites.dev/): Marketing homepage with quotable answer block.
- [/pricing](https://projectsites.dev/#pricing): Free, Pro ($25/mo), Business ($100/mo).
- [/features](https://projectsites.dev/#features): Multi-model AI router + axe-core + Lighthouse publish gates.
- [/accessibility](https://projectsites.dev/accessibility): WCAG 2.2 AA conformance + IRS §44 explainer.
- [/.well-known/mcp](https://projectsites.dev/.well-known/mcp): Model Context Protocol server discovery.
- [/api/openapi.json](https://projectsites.dev/api/openapi.json): Public REST API spec.
- [/api/feature-flags](https://projectsites.dev/api/feature-flags): Live feature-flag registry.

## Site policy for AI crawlers

- Allow: GPTBot, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Google-Extended, CCBot.
- All routes public; no login wall on content pages.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

features.get('/llms-full.txt', () => {
  const body = `# Project Sites — Full Content Snapshot

## What Project Sites does

Project Sites is an AI website builder for solo founders and small agencies. Customers describe their business in plain English and Project Sites generates a complete site — homepage, services, contact, pricing — deployed to Cloudflare Workers under their chosen domain in under 15 minutes.

## Differentiators

1. Multi-model AI router (Opus 4.7 / Sonnet 4.6 / Workers AI Llama 3.3 70B FP8 / GPT-5).
2. One-click Supabase + Neon DB provisioning.
3. Accessibility-first publishing — axe-core publish gate at 6 viewports.
4. Core Web Vitals publish gate — LCP < 2.5s, INP < 200ms, CLS < 0.1.
5. GEO / AI search built-in — JSON-LD autopilot + per-site llms.txt.

## Pricing

- Free — 1 site, projectsites.dev subdomain.
- Pro $25/month — 10 sites, custom domains, publish gates.
- Business $100/month — unlimited, agency tier, white-label.
- Usage — AI tokens metered via Stripe Meters at $0.10/1M.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

features.get('/robots.txt', () => {
  const body = `User-agent: GPTBot
Allow: /
Disallow: /admin
Disallow: /api

User-agent: ClaudeBot
Allow: /
Disallow: /admin
Disallow: /api

User-agent: Claude-User
Allow: /
Disallow: /admin
Disallow: /api

User-agent: Claude-SearchBot
Allow: /
Disallow: /admin
Disallow: /api

User-agent: PerplexityBot
Allow: /
Disallow: /admin
Disallow: /api

User-agent: Google-Extended
Allow: /
Disallow: /admin
Disallow: /api

User-agent: CCBot
Allow: /
Disallow: /admin
Disallow: /api

User-agent: Bytespider
Disallow: /

User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/private

Sitemap: https://projectsites.dev/sitemap.xml
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

features.get('/accessibility', () => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Project Sites accessibility statement — WCAG 2.2 AA conformance, ADA Title II readiness, IRS Section 44 tax credit.">
<meta name="color-scheme" content="dark light">
<title>Accessibility Statement | Project Sites</title>
<link rel="canonical" href="https://projectsites.dev/accessibility">
<style>:root{color-scheme:dark light;--bg:#060610;--ink:#f4f4ff;--accent:#00e5ff}body{background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:4rem auto;padding:0 1.25rem}h1{font-size:clamp(2rem,4vw,3rem);line-height:1.1;margin-bottom:1rem}h2{font-size:1.5rem;margin-top:2.5rem;color:var(--accent)}a{color:var(--accent)}ul{padding-left:1.25rem}.skip-link{position:absolute;left:-9999px;top:0;padding:.5rem 1rem;background:var(--accent);color:var(--bg)}.skip-link:focus{left:0}*:focus-visible{outline:2px solid var(--accent);outline-offset:3px}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<main id="main">
<h1>Accessibility Statement</h1>
<p data-quotable>Project Sites builds every website to meet WCAG 2.2 Level AA. The publish flow blocks deploys when axe-core finds violations at any of six viewports (375, 390, 768, 1024, 1280, 1920 pixels). If you find an accessibility barrier on a site we generated, email <a href="mailto:accessibility@projectsites.dev">accessibility@projectsites.dev</a> and we fix it within 5 business days.</p>
<h2>Standards we follow</h2>
<ul>
<li><a href="https://www.w3.org/WAI/WCAG22/quickref/">WCAG 2.2 Level AA</a> — conformance target for every published site.</li>
<li><a href="https://www.ada.gov/resources/2024-03-08-web-rule/">ADA Title II — April 2027 deadline</a>.</li>
<li><a href="https://www.section508.gov/manage/laws-and-policies/">Section 508</a>.</li>
</ul>
<h2>IRS Section 44 — Disabled Access Credit</h2>
<p>Small businesses (gross receipts under $1,000,000 or fewer than 30 full-time employees) may be eligible to claim up to <strong>$5,000 per year</strong> via <a href="https://www.irs.gov/forms-pubs/about-form-8826">IRS Form 8826</a>.</p>
<h2>Contact</h2>
<p>Email <a href="mailto:accessibility@projectsites.dev">accessibility@projectsites.dev</a>.</p>
</main>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
});

features.get('/.well-known/mcp', (c) =>
  c.json({
    name: 'projectsites.dev',
    version: '0.1.0',
    description: 'Model Context Protocol server for Project Sites — manage AI-generated websites from Claude, Cursor, or any MCP client.',
    capabilities: { tools: { listChanged: false } },
    tools: [
      { name: 'list_sites', description: 'List all sites owned by the authenticated user', input_schema: { type: 'object', properties: {} } },
      { name: 'create_site', description: 'Create a new site from a prompt + business profile', input_schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, industry: { type: 'string' }, city: { type: 'string' } } } },
      { name: 'deploy_site', description: 'Publish a site (runs CWV + axe gates)', input_schema: { type: 'object', required: ['site_id'], properties: { site_id: { type: 'string' } } } },
      { name: 'get_site_metrics', description: 'CWV + axe + visitor analytics for a site', input_schema: { type: 'object', required: ['site_id'], properties: { site_id: { type: 'string' } } } },
      { name: 'regenerate_section', description: 'Regenerate a section via the AI pipeline', input_schema: { type: 'object', required: ['site_id', 'section'], properties: { site_id: { type: 'string' }, section: { type: 'string', enum: ['hero', 'features', 'pricing', 'faq', 'cta'] } } } },
    ],
    transport: { type: 'sse', endpoint: 'https://projectsites.dev/api/mcp/sse' },
    authorization_server: 'https://projectsites.dev/.well-known/oauth-protected-resource',
  }),
);

features.get('/.well-known/oauth-protected-resource', (c) =>
  c.json({
    resource: 'https://projectsites.dev',
    authorization_servers: ['https://projectsites.dev/oauth'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://projectsites.dev/docs/mcp',
    scopes_supported: ['sites:read', 'sites:write', 'sites:publish', 'metrics:read'],
  }),
);

features.get('/api/openapi.json', (c) =>
  c.json(
    {
      openapi: '3.1.0',
      info: { title: 'Project Sites API', version: '0.1.0', description: 'Public REST API. Bearer-token authentication.', contact: { email: 'api@projectsites.dev' }, license: { name: 'Commercial', url: 'https://projectsites.dev/terms' } },
      servers: [{ url: 'https://projectsites.dev', description: 'Production' }],
      components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' } } },
      security: [{ BearerAuth: [] }],
      paths: {
        '/api/v1/sites': { get: { summary: 'List sites', responses: { 200: { description: 'OK' }, 401: { description: 'Unauthorized' } } } },
        '/api/v1/sites/{id}/deploy': { post: { summary: 'Publish a site (runs CWV + axe gates)', responses: { 202: { description: 'Queued' }, 412: { description: 'Publish-gate violations' } } } },
      },
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  ),
);

features.get('/api/cli/version', (c) => c.json({ version: '0.1.0', install: 'npx projectsites@latest', commands: ['init', 'deploy', 'preview', 'logs'], minimum_node: '18.18.0' }));

// ─── Feature-flag admin surface (always available; needed to read state) ──

features.get('/api/feature-flags', (c) => {
  const flags = listFlags().map((f) => ({ ...f, has_docs: f.key in FLAG_DOCS }));
  return c.json({ flags, count: flags.length });
});

features.get('/api/feature-flags/:key', async (c) => {
  const key = c.req.param('key');
  const def = FLAG_REGISTRY[key];
  if (!def) return c.json({ error: 'unknown_flag' }, 404);
  const state = await resolveFlag(c.env, key, { orgId: c.req.query('org_id'), siteId: c.req.query('site_id'), userId: c.req.query('user_id') });
  return c.json({ definition: def, resolved: state, docs: getDocs(key) ?? null });
});

// ─── Semantic per-feature endpoints (every endpoint flag-gated) ──────

// Multi-model router
features.get('/api/models', requireFlag('multi_model_router'), (c) => c.json({ models: F.listModels() }));
features.get('/api/models/cost', requireFlag('multi_model_router'), (c) => {
  const model = (c.req.query('model') ?? 'claude-sonnet-4-6') as F.ModelId;
  const input = Number(c.req.query('input_tokens') ?? 1000);
  const output = Number(c.req.query('output_tokens') ?? 500);
  return c.json(F.estimatePromptCost(model, input, output));
});

// DB provisioning
features.get('/api/db-providers', requireFlag('db_provisioning'), (c) => c.json({ providers: F.listDbProviders() }));
features.post('/api/db-providers/provision', requireFlag('db_provisioning'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; site_id?: string; provider?: string };
  return c.json(await F.provisionDatabase(c.env, { orgId: body.org_id ?? 'demo-org', siteId: body.site_id ?? 'demo-site', provider: body.provider === 'supabase' ? 'supabase' : 'neon' }));
});

// SOC 2 audit chain
features.post('/api/audit/append', requireFlag('audit_hash_chain'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; actor?: string; action?: string; payload?: unknown };
  return c.json(await F.appendAudit(c.env, { orgId: body.org_id ?? 'demo-org', actor: body.actor ?? 'system', action: body.action ?? 'unknown', payload: body.payload ?? {} }));
});
features.get('/api/audit/verify/:orgId', requireFlag('audit_hash_chain'), async (c) => c.json(await F.verifyAuditChain(c.env, c.req.param('orgId'))));

// GitHub sync
features.get('/api/integrations/github/connect', requireFlag('github_sync'), (c) => c.json(F.githubConnectUrl(c.env)));
features.get('/api/integrations/github/status', requireFlag('github_sync'), (c) => c.json({ connected: false, connect_url: F.githubConnectUrl(c.env).url }));

// Token-burn meter
features.get('/api/usage/burn', requireFlag('token_burn_meter'), async (c) => c.json(await F.getMonthlyBurn(c.env, c.req.query('org_id') ?? 'demo-org')));
features.post('/api/usage/record', requireFlag('token_burn_meter'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; model?: F.ModelId; input_tokens?: number; output_tokens?: number };
  return c.json(await F.recordTokenEvent(c.env, { orgId: body.org_id ?? 'demo-org', model: body.model ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast', inputTokens: body.input_tokens ?? 0, outputTokens: body.output_tokens ?? 0 }));
});

// Snapshot rollback (avoids collision with existing /api/sites/:id/snapshots/:snapshotId)
features.get('/api/snapshots/by-site/:siteId', requireFlag('snapshot_rollback'), async (c) => c.json({ snapshots: await F.listSnapshots(c.env, c.req.param('siteId')) }));
features.post('/api/snapshots/by-site/:siteId', requireFlag('snapshot_rollback'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { label?: string; diff_summary?: string };
  return c.json(await F.createSnapshot(c.env, { siteId: c.req.param('siteId'), label: body.label ?? 'manual', diffSummary: body.diff_summary ?? 'manual snapshot' }));
});
features.post('/api/snapshots/by-site/:siteId/revert/:snapshotId', requireFlag('snapshot_rollback'), async (c) =>
  c.json(await F.revertToSnapshot(c.env, { siteId: c.req.param('siteId'), snapshotId: c.req.param('snapshotId') })),
);

// Template marketplace (sibling to existing /api/templates)
features.get('/api/marketplace/templates', requireFlag('template_marketplace'), (c) => {
  const industry = c.req.query('industry') ?? undefined;
  return c.json({ templates: F.listTemplates(industry ? { industry } : undefined) });
});
features.get('/api/marketplace/templates/:id', requireFlag('template_marketplace'), (c) => {
  const tpl = F.listTemplates().find((t) => t.id === c.req.param('id'));
  return tpl ? c.json(tpl) : c.json({ error: 'not_found' }, 404);
});

// WfP dispatch
features.get('/api/dispatch/sites/:siteId', requireFlag('wfp_dispatch'), (c) => {
  const data = F.dispatchMetadata(c.env, c.req.param('siteId'));
  c.header('x-dispatch-namespace', data.namespace);
  c.header('x-user-worker', data.user_worker);
  return c.json(data);
});

// Egress control
features.get('/api/egress/rules', requireFlag('egress_control'), async (c) => c.json({ rules: await F.listEgressRules(c.env, c.req.query('org_id') ?? 'demo-org') }));
features.post('/api/egress/rules', requireFlag('egress_control'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; pattern?: string; action?: 'block' | 'allow_log' | 'rewrite' };
  return c.json(await F.addEgressRule(c.env, { orgId: body.org_id ?? 'demo-org', pattern: body.pattern ?? '*.example.com', action: body.action ?? 'block' }));
});

// Agency tier extensions (sibling to existing /api/agency/clients)
features.get('/api/agency/invoices', requireFlag('agency_tier'), (c) => c.json({ invoices: F.listAgencyInvoices() }));
features.get('/api/agency/cost-attribution', requireFlag('cost_attribution'), async (c) =>
  c.json(await F.getCostBreakdown(c.env, c.req.query('org_id') ?? 'demo-org', Number(c.req.query('period_days') ?? 30))),
);

// White-label admin branding
features.get('/api/branding', requireFlag('whitelabel_admin'), async (c) => c.json(await F.getBranding(c.env, c.req.header('host') ?? 'projectsites.dev')));

// CWV publish gate
features.post('/api/cwv/gate/:siteId', requireFlag('cwv_publish_gate'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { urls?: string[] };
  return c.json(await F.runCwvGate(c.env, c.req.param('siteId'), body.urls ?? ['/']));
});

// RUM telemetry
features.post('/api/rum/ingest', requireFlag('rum_telemetry'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { site_id?: string; route?: string; lcp?: number; cls?: number; inp?: number; loaf?: unknown; user_agent_hash?: string };
  return c.json(await F.ingestRumEvent(c.env, { siteId: body.site_id ?? 'demo-site', route: body.route ?? '/', lcp: body.lcp, cls: body.cls, inp: body.inp, loaf: body.loaf, uaHash: body.user_agent_hash }));
});

// Critical CSS
features.post('/api/critical-css', requireFlag('critical_css_inline'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { html?: string };
  return c.json(F.extractCriticalCss(body.html ?? '<style>body{margin:0}</style>'));
});

// Image triplet
features.post('/api/image-pipeline/triplet', requireFlag('image_triplet_pipeline'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { r2_key?: string };
  return c.json(F.imageTripletPlan(body.r2_key ?? 'media/demo/hero.png'));
});

// Speed Score
features.get('/api/speed-score/:siteId', requireFlag('speed_score_widget'), async (c) => c.json(await F.computeSpeedScore(c.env, c.req.param('siteId'))));

// GEO visibility
features.get('/api/geo/queries', requireFlag('geo_visibility_tracker'), async (c) => c.json({ queries: await F.listGeoQueries(c.env, c.req.query('org_id') ?? 'demo-org') }));
features.post('/api/geo/queries', requireFlag('geo_visibility_tracker'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; query?: string };
  return c.json(await F.addGeoQuery(c.env, body.org_id ?? 'demo-org', body.query ?? 'best plumber in newark nj'));
});

// Cornerstone auto-refresh
features.get('/api/cornerstone/by-site/:siteId', requireFlag('cornerstone_autorefresh'), async (c) => c.json({ cornerstones: await F.listCornerstones(c.env, c.req.param('siteId')) }));
features.post('/api/cornerstone/by-site/:siteId/refresh', requireFlag('cornerstone_autorefresh'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { route?: string };
  return c.json(await F.triggerCornerstoneRefresh(c.env, { siteId: c.req.param('siteId'), route: body.route ?? '/' }));
});

// axe publish gate
features.post('/api/axe/gate/:siteId', requireFlag('axe_publish_gate'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { urls?: string[] };
  return c.json(await F.runAxeGate(c.env, c.req.param('siteId'), body.urls ?? ['/']));
});

// AI alt-text
features.post('/api/alt-text', requireFlag('ai_alt_text'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { image_url?: string; context?: string };
  return c.json(F.generateAiAltText(c.env, body.image_url ?? '', body.context));
});

// WCAG 2.2 wizard
features.get('/api/wcag22/wizard', requireFlag('wcag22_wizard'), (c) => c.json({ checklist: F.wcag22Wizard() }));

// OKLCH contrast
features.post('/api/contrast/check', requireFlag('oklch_contrast_lift'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { fg?: string; bg?: string };
  return c.json(F.checkContrast(body.fg ?? '#ffffff', body.bg ?? '#000000'));
});
features.post('/api/contrast/lift', requireFlag('oklch_contrast_lift'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  return c.json(F.liftOklchToken(body.token ?? '#888888'));
});

// Section overlay
features.get('/api/overlay/by-site/:siteId/sections', requireFlag('section_overlay'), (c) => c.json({ sections: F.getSectionMap(c.req.param('siteId')) }));

// Approval workflow
features.post('/api/approval/link', requireFlag('approval_workflow'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { site_id?: string; agency_org_id?: string };
  return c.json(await F.createReviewLink(c.env, { siteId: body.site_id ?? 'demo-site', agencyOrgId: body.agency_org_id ?? 'demo-agency' }));
});

// Stripe Meters
features.post('/api/meters/event', requireFlag('stripe_meters'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { customer_id?: string; event_name?: string; value?: number; identifier?: string };
  return c.json(await F.reportMeterEvent(c.env, { customerId: body.customer_id ?? 'cus_demo', eventName: body.event_name ?? 'ai_tokens', value: body.value ?? 1000, identifier: body.identifier ?? `evt_${Date.now()}` }));
});

// Upsell campaigns
features.get('/api/campaigns', requireFlag('upsell_campaign_month3'), (c) => c.json({ campaigns: F.listUpsellCampaigns() }));

// Referrals
features.get('/api/referrals/code', requireFlag('referral_credits'), async (c) => c.json(await F.generateReferralCode(c.env, c.req.query('user_id') ?? 'demo-user')));

// Cost breakdown
features.get('/api/costs/breakdown', requireFlag('cost_attribution'), async (c) =>
  c.json(await F.getCostBreakdown(c.env, c.req.query('org_id') ?? 'demo-org', Number(c.req.query('period_days') ?? 30))),
);

// OTLP
features.post('/api/otlp/span', requireFlag('otlp_unified_events'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { trace_id?: string; span_id?: string; name?: string; duration_ms?: number; status?: string };
  return c.json(await F.emitOtlpSpan(c.env, { traceId: body.trace_id ?? crypto.randomUUID().replace(/-/g, ''), spanId: body.span_id ?? crypto.randomUUID().slice(0, 16), name: body.name ?? 'unnamed.span', durationMs: body.duration_ms ?? 0, status: body.status === 'error' ? 'error' : 'ok' }));
});

// Per-tenant Sentry
features.get('/api/sentry/issues', requireFlag('tenant_sentry_releases'), (c) => c.json({ issues: F.listSentryIssues(c.req.query('org_id') ?? 'demo-org') }));
features.post('/api/sentry/token', requireFlag('tenant_sentry_releases'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string };
  return c.json(await F.generateSentryToken(c.env, body.org_id ?? 'demo-org'));
});

// SLO tracker
features.get('/api/slo', requireFlag('slo_tracker'), async (c) => c.json({ slos: await F.listSlos(c.env, c.req.query('org_id') ?? 'demo-org') }));
features.post('/api/slo', requireFlag('slo_tracker'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; route?: string; availability?: number; p99_latency_ms?: number };
  return c.json(await F.defineSlo(c.env, { orgId: body.org_id ?? 'demo-org', route: body.route ?? '/', availability: body.availability ?? 99.9, p99LatencyMs: body.p99_latency_ms ?? 500 }));
});

// Media generation (under /api/gen to avoid /api/media collision)
features.post('/api/gen/veo/preview-cost', requireFlag('veo_hero_loop'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { duration_s?: number; tier?: 'fast' | 'standard' | 'pro' };
  return c.json(F.previewVeoCost(body.duration_s ?? 8, body.tier ?? 'fast'));
});
features.post('/api/gen/veo', requireFlag('veo_hero_loop'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; prompt?: string; duration_s?: number; tier?: 'fast' | 'standard' | 'pro' };
  return c.json(await F.generateVeoLoop(c.env, { orgId: body.org_id ?? 'demo-org', prompt: body.prompt ?? 'Slow dolly across bakery counter', durationS: body.duration_s ?? 8, tier: body.tier ?? 'fast' }));
});
features.post('/api/gen/podcast', requireFlag('page_podcast'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; page_content?: string; voice_style?: string };
  return c.json(await F.generatePodcast(c.env, { orgId: body.org_id ?? 'demo-org', pageContent: body.page_content ?? 'About this page', voiceStyle: body.voice_style }));
});
features.post('/api/gen/brand-kit', requireFlag('logo_regenerator'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { org_id?: string; prompt?: string; palette?: string[] };
  return c.json(await F.generateBrandKit(c.env, { orgId: body.org_id ?? 'demo-org', prompt: body.prompt ?? 'A bold geometric monogram', palette: body.palette }));
});

// Locale detect
features.get('/api/locale/detect', requireFlag('i18n_auto_locale'), (c) =>
  c.json(F.detectLocales({ city: c.req.query('city'), state: c.req.query('state'), country: c.req.query('country') ?? 'US' })),
);

// PWA manifest
features.get('/api/pwa/manifest', requireFlag('pwa_manifest_full'), (c) => c.json(F.getPwaManifest(c.env, c.req.query('org_id') ?? 'demo-org')));

// Web push
features.post('/api/push/subscribe', requireFlag('web_push'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { user_id?: string; endpoint?: string; p256dh?: string; auth?: string };
  return c.json(await F.subscribePush(c.env, { userId: body.user_id ?? 'demo-user', endpoint: body.endpoint ?? 'https://fcm.googleapis.com/test', p256dh: body.p256dh ?? '', auth: body.auth ?? '' }));
});

// Auto-changelog
features.post('/api/changelog/generate', requireFlag('auto_changelog'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { commits?: Array<{ sha: string; message: string; author: string; date: string }> };
  return c.json(await F.generateAutoChangelog(c.env, body.commits ?? [{ sha: 'abc1234', message: 'feat: ship features rollout', author: 'projectsites', date: new Date().toISOString() }]));
});

// ── 10 brilliant — semantic per-feature endpoints ────────────────────

// #1 Site-as-MCP-server
features.get('/api/sites/:siteId/mcp/discovery', requireFlag('site_mcp_server'), async (c) =>
  c.json(await B.buildSiteMcpManifest(c.env, c.req.param('siteId'))),
);
features.post('/api/sites/:siteId/mcp/discovery', requireFlag('site_mcp_server'), async (c) =>
  c.json(await B.buildSiteMcpManifest(c.env, c.req.param('siteId'))),
);

// #2 Cold-tier auto-thaw
features.get('/api/cold-tier/status/:siteId', requireFlag('cold_tier_thaw'), async (c) =>
  c.json(await B.getColdTierState(c.env, c.req.param('siteId'))),
);
features.post('/api/cold-tier/archive/:siteId', requireFlag('cold_tier_thaw'), async (c) =>
  c.json(await B.archiveSiteToColdTier(c.env, c.req.param('siteId'))),
);
features.post('/api/cold-tier/thaw/:siteId', requireFlag('cold_tier_thaw'), async (c) =>
  c.json(await B.thawSiteFromColdTier(c.env, c.req.param('siteId'))),
);

// #3 AI auto-router
features.post('/api/router/pick', requireFlag('ai_auto_router'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { prompt?: string; org_id?: string };
  return c.json(await B.autoRoutePrompt(c.env, { prompt: body.prompt ?? 'demo prompt', orgId: body.org_id }));
});
features.get('/api/router/stats', requireFlag('ai_auto_router'), async (c) => c.json(await B.getRouterStats(c.env, c.req.query('org_id') ?? 'demo-org')));

// #4 Ghost routes
features.get('/api/ghost-routes/list/:siteId', requireFlag('ghost_routes'), async (c) => c.json({ routes: await B.listGhostRoutes(c.env, c.req.param('siteId')) }));
features.post('/api/ghost-routes/preview', requireFlag('ghost_routes'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { site_id?: string; path?: string };
  return c.json(await B.previewGhostRoute(c.env, { siteId: body.site_id ?? 'demo-site', path: body.path ?? '/pricing' }));
});

// #5 Speed-compare widget
features.post('/api/speed-compare', requireFlag('speed_compare_widget'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { customer_site?: string; competitor_url?: string };
  return c.json(await B.runSpeedCompare(c.env, { customerSite: body.customer_site ?? 'demo-site.projectsites.dev', competitorUrl: body.competitor_url ?? 'https://example.com' }));
});

// #6 Auto-gen static files
features.get('/api/auto-files/list/:siteId', requireFlag('auto_gen_static_files'), async (c) => c.json(await B.listAutoGenFiles(c.env, c.req.param('siteId'))));
features.post('/api/auto-files/regenerate/:siteId/:filename{.+}', requireFlag('auto_gen_static_files'), async (c) =>
  c.json(await B.regenerateAutoGenFile(c.env, { siteId: c.req.param('siteId'), filename: c.req.param('filename') })),
);

// #7 Hallucination guard
features.post('/api/hallucination-check', requireFlag('hallucination_guard'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { site_id?: string; page_route?: string; text?: string };
  return c.json(await B.checkHallucination(c.env, { siteId: body.site_id ?? 'demo-site', pageRoute: body.page_route ?? '/', text: body.text ?? '' }));
});
features.get('/api/hallucination-flags/:siteId', requireFlag('hallucination_guard'), async (c) => c.json({ flags: await B.listHallucinationFlags(c.env, c.req.param('siteId')) }));

// #8 Visitor recognition
features.post('/api/visitor/recognize', requireFlag('visitor_recognition'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { site_id?: string; anon_id?: string; source?: string; city?: string; country?: string };
  return c.json(await B.recognizeVisitor(c.env, { siteId: body.site_id ?? 'demo-site', anonId: body.anon_id ?? crypto.randomUUID(), source: body.source, city: body.city, country: body.country }));
});
features.get('/api/visitor/personalize/:siteId', requireFlag('visitor_recognition'), async (c) =>
  c.json(await B.getPersonalizedHero(c.env, { siteId: c.req.param('siteId'), anonId: c.req.query('anon_id') ?? 'unknown' })),
);

// #9 FAQ-from-tickets
features.post('/api/faq-builder/from-tickets', requireFlag('faq_from_tickets'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { site_id?: string; tickets?: Array<{ id: string; body: string }> };
  return c.json(await B.clusterTicketsIntoFaq(c.env, { siteId: body.site_id ?? 'demo-site', tickets: body.tickets ?? [{ id: 't1', body: 'Do you ship internationally?' }, { id: 't2', body: 'How do I cancel?' }, { id: 't3', body: 'Do you ship outside US?' }] }));
});
features.get('/api/faq-builder/draft/:siteId', requireFlag('faq_from_tickets'), async (c) => c.json({ drafts: await B.listFaqDrafts(c.env, c.req.param('siteId')) }));

// #10 Competitor monitor → counter-ship
features.post('/api/competitor-monitor/scan/:orgId', requireFlag('competitor_monitor'), async (c) =>
  c.json(await B.scanCompetitors(c.env, c.req.param('orgId'))),
);
features.get('/api/competitor-monitor/list/:orgId', requireFlag('competitor_monitor'), async (c) => c.json({ alerts: await B.listCompetitorAlerts(c.env, c.req.param('orgId')) }));

export default features;
