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
import { z } from 'zod';
import type { Env } from '../types/env';
import { DOMAINS } from '@project-sites/shared';
import { assertSiteOwned } from '../services/site_ownership.js';
import { createReviewLink } from '../services/review_approval.js';
import * as F from '../services/features.js';
import * as B from '../services/brilliant.js';
import * as BB from '../services/big_bets.js';
import * as IDE from '../services/ide_sandbox.js';
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

/** Body for POST /api/approval/link — site_id required (org comes from auth). */
const ApprovalLinkBody = z
  .object({ site_id: z.string().min(1), ttl_days: z.number().int().min(1).max(90).optional() })
  .strip();

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

// ─── Site Features (Layer 2 — owner-facing, plan-aware control plane) ──────
//
// Distinct from the System-Administrator flag surface above: these are the
// SITE-scoped features a site owner enables for THEIR hosted site (e.g. when
// projectsites hosts megabyte.space, the owner turns on Online Booking for that
// site). Plan-aware — entitlement gates which features the owner can enable.
//
// State persists in `site_feature_overrides` (tenant-scoped flag overrides).
// The owner's plan comes from the subscription on their org. Falls back to a
// safe read-only view when the table/sub aren't present so the surface never
// hard-errors during rollout.

/** Catalog of owner-facing features → the registry flag + required plan tier. */
const SITE_FEATURE_CATALOG: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  requiredPlan: 'free' | 'pro' | 'business' | 'enterprise';
  isAddon: boolean;
  category: string;
}> = [
  { key: 'native_booking_engine', name: 'Online Booking', description: 'Let visitors book appointments with availability, deposits, and reminders — right on your site.', requiredPlan: 'pro', isAddon: false, category: 'Sell' },
  { key: 'donations_engine', name: 'Donations', description: 'Accept one-time and recurring gifts with a beautiful donate page.', requiredPlan: 'free', isAddon: false, category: 'Sell' },
  { key: 'newsletter_engine', name: 'Newsletter', description: 'Collect subscribers and send branded campaigns from your own domain.', requiredPlan: 'pro', isAddon: false, category: 'Grow' },
  { key: 'ecommerce_engine', name: 'Online Store', description: 'Full product catalog, cart, and checkout backed by a real commerce engine.', requiredPlan: 'business', isAddon: false, category: 'Sell' },
  { key: 'membership_paywall', name: 'Members & Paywall', description: 'Gate premium pages behind paid membership tiers.', requiredPlan: 'business', isAddon: false, category: 'Sell' },
  { key: 'enterprise_sso', name: 'Single Sign-On (SSO)', description: 'SAML / OIDC login for your whole team via Okta, Azure AD, or Auth0.', requiredPlan: 'enterprise', isAddon: false, category: 'Trust' },
  { key: 'brand_voice_clone', name: 'AI Voice Clone', description: 'A branded AI voice for podcasts, tours, and phone greetings.', requiredPlan: 'enterprise', isAddon: true, category: 'Grow' },
  { key: 'site_mcp_server', name: 'AI Assistant Access', description: 'Make your site queryable by Siri, Claude, and ChatGPT.', requiredPlan: 'business', isAddon: false, category: 'Grow' },
];

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };

/** Read the caller's org plan tier (best-effort; defaults to 'free'). */
async function readOrgPlan(c: Context<{ Bindings: Env }>, orgId: string | undefined): Promise<'free' | 'pro' | 'business' | 'enterprise'> {
  if (!orgId) return 'free';
  try {
    const row = await c.env.DB.prepare(
      `SELECT plan FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(orgId)
      .first<{ plan: string | null }>();
    const plan = (row?.plan ?? 'free').toLowerCase();
    return plan === 'pro' || plan === 'business' || plan === 'enterprise' ? plan : 'free';
  } catch {
    return 'free';
  }
}

/** Read tenant-scoped enable/preview state for a site's features. */
async function readSiteFeatureState(c: Context<{ Bindings: Env }>, siteId: string | undefined): Promise<Record<string, { enabled: boolean; preview: boolean }>> {
  const out: Record<string, { enabled: boolean; preview: boolean }> = {};
  if (!siteId) return out;
  try {
    const rows = await c.env.DB.prepare(
      `SELECT flag_key, value_json FROM flag_overrides WHERE scope = 'tenant' AND scope_id = ? AND deleted_at IS NULL`,
    )
      .bind(siteId)
      .all<{ flag_key: string; value_json: string }>();
    for (const r of rows.results ?? []) {
      try {
        const v = JSON.parse(r.value_json) as { enabled?: boolean; preview?: boolean };
        out[r.flag_key] = { enabled: !!v.enabled, preview: !!v.preview };
      } catch {
        /* skip malformed override */
      }
    }
  } catch {
    /* table absent during rollout — empty state */
  }
  return out;
}

/**
 * `GET /api/site-features` — owner-facing feature catalog with per-feature
 * entitlement + enable/preview state for the caller's selected site.
 */
features.get('/api/site-features', async (c) => {
  const orgId = (c as unknown as { get(k: string): string | undefined }).get('orgId') ?? c.req.query('org_id') ?? undefined;
  const siteId = c.req.query('site_id') ?? undefined;
  const plan = await readOrgPlan(c, orgId);
  const state = await readSiteFeatureState(c, siteId);
  const featureList = SITE_FEATURE_CATALOG.map((f) => {
    const entitled = PLAN_RANK[plan] >= PLAN_RANK[f.requiredPlan]
      ? 'available'
      : f.isAddon
        ? 'addon-required'
        : 'upgrade-required';
    const s = state[f.key] ?? { enabled: false, preview: false };
    return { ...f, entitled, enabled: s.enabled, preview: s.preview };
  });
  return c.json({ features: featureList, plan });
});

const siteFeatureToggleSchema = z.object({
  site_id: z.string().min(1),
  enabled: z.boolean().optional(),
  preview: z.boolean().optional(),
});

/**
 * `POST /api/site-features/:key` — owner enables/disables a site feature for
 * THEIR site. Entitlement-checked server-side (free→404 the gated feature is
 * never exposed; an under-entitled enable is rejected 403). Tenant-scoped.
 */
features.post('/api/site-features/:key', async (c) => {
  const key = c.req.param('key');
  const def = SITE_FEATURE_CATALOG.find((f) => f.key === key);
  if (!def) return c.json({ error: 'not_found' }, 404);
  const parsed = siteFeatureToggleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'validation_error', details: parsed.error.flatten() }, 400);
  const body = parsed.data;

  const orgId = (c as unknown as { get(k: string): string | undefined }).get('orgId') ?? undefined;
  // Tenant isolation — never let a caller mutate a site they don't own. 404
  // (never 403) so site existence doesn't leak.
  if (!(await assertSiteOwned(c.env, orgId, body.site_id))) {
    return c.json({ error: 'not_found' }, 404);
  }
  const plan = await readOrgPlan(c, orgId);
  const entitled = PLAN_RANK[plan] >= PLAN_RANK[def.requiredPlan];
  if (body.enabled && !entitled) {
    return c.json({ error: 'upgrade_required', required_plan: def.requiredPlan }, 403);
  }

  const value = JSON.stringify({ enabled: !!body.enabled, preview: !!body.preview });
  try {
    await c.env.DB.prepare(
      `INSERT INTO flag_overrides (scope, scope_id, flag_key, value_json, updated_at)
         VALUES ('tenant', ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET
         value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP, deleted_at = NULL`,
    )
      .bind(body.site_id, key, value)
      .run();
  } catch {
    /* best-effort during rollout; the override table is created by migration 0500 */
  }
  return c.json({ ok: true, key, enabled: !!body.enabled, preview: !!body.preview });
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

// Approval workflow — owned, auth + ownership-guarded (NO demo defaults).
// The agency org is the caller's authed session org (set by the auth
// middleware), never a client-supplied value; the site must belong to it.
features.post('/api/approval/link', requireFlag('approval_workflow'), async (c) => {
  const orgId = (c as unknown as { get(k: string): string | undefined }).get('orgId');
  const userId = (c as unknown as { get(k: string): string | undefined }).get('userId');
  if (!userId || !orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  const parsed = ApprovalLinkBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'site_id is required' } }, 400);
  }
  const siteId = parsed.data.site_id;
  // Ownership gate: 404 (never 403) on a foreign/missing site — don't leak.
  if (!(await assertSiteOwned(c.env, orgId, siteId))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const ttlMs = parsed.data.ttl_days ? parsed.data.ttl_days * 86_400_000 : undefined;
  const res = await createReviewLink(c.env, orgId, siteId, ttlMs ? { ttlMs } : {});
  if (!res.ok) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: res.error ?? 'Could not create review link' } }, 500);
  }
  // Preserve the legacy response shape (signed_url/token/expires_at) for existing callers.
  return c.json({ ok: true, signed_url: `https://projectsites.dev${res.url}`, token: res.id, expires_at: res.expiresAt });
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

// ── 30 big-bet features — semantic per-feature endpoints ──────────────

const json = async (c: { req: { json: () => Promise<unknown> } }) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

// A1 Visual editor
features.post('/api/visual-editor/save', requireFlag('visual_editor_drag_drop'), async (c) => {
  const b = await json(c) as { site_id?: string; layout?: unknown; breakpoint?: string };
  return c.json(await BB.visualEditorSave(c.env, { siteId: b.site_id ?? 'demo-site', layout: b.layout ?? { sections: [] }, breakpoint: b.breakpoint }));
});

// A2 Ecommerce
features.get('/api/ecommerce/products/:siteId', requireFlag('ecommerce_engine'), async (c) => c.json({ products: await BB.ecommerceListProducts(c.env, c.req.param('siteId')) }));
features.post('/api/ecommerce/orders', requireFlag('ecommerce_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; email?: string; cents?: number };
  return c.json(await BB.ecommerceCreateOrder(c.env, { siteId: b.site_id ?? 'demo-site', email: b.email ?? 'guest@demo.com', cents: b.cents ?? 1000 }));
});

// A3 Booking
features.get('/api/booking/slots/:siteId', requireFlag('native_booking_engine'), async (c) => c.json({ slots: await BB.bookingListSlots(c.env, c.req.param('siteId')) }));
features.post('/api/booking/reserve', requireFlag('native_booking_engine'), async (c) => {
  const b = await json(c) as { slot_id?: string; email?: string };
  return c.json(await BB.bookingReserve(c.env, { slotId: b.slot_id ?? 's0', email: b.email ?? 'guest@demo.com' }));
});

// A4 LMS
features.post('/api/lms/courses', requireFlag('lms_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; title?: string; modules?: unknown[]; price_cents?: number };
  return c.json(await BB.lmsCreateCourse(c.env, { siteId: b.site_id ?? 'demo-site', title: b.title ?? 'New Course', modules: b.modules ?? [], priceCents: b.price_cents }));
});
features.get('/api/lms/courses/:siteId', requireFlag('lms_engine'), async (c) => c.json({ courses: await BB.lmsListCourses(c.env, c.req.param('siteId')) }));

// A5 Community
features.post('/api/community/topics', requireFlag('community_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; title?: string; body?: string; author_email?: string };
  return c.json(await BB.communityCreateTopic(c.env, { siteId: b.site_id ?? 'demo-site', title: b.title ?? 'New topic', body: b.body ?? '', authorEmail: b.author_email ?? 'guest@demo.com' }));
});
features.get('/api/community/topics/:siteId', requireFlag('community_engine'), async (c) => c.json({ topics: await BB.communityListTopics(c.env, c.req.param('siteId')) }));

// A6 Newsletter
features.post('/api/newsletter/campaigns', requireFlag('newsletter_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; subject?: string; body_html?: string; segment?: string };
  return c.json(await BB.newsletterCreateCampaign(c.env, { siteId: b.site_id ?? 'demo-site', subject: b.subject ?? 'Test', bodyHtml: b.body_html ?? '<p>Hello</p>', segment: b.segment }));
});
features.post('/api/newsletter/subscribe', requireFlag('newsletter_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; email?: string; segment?: string };
  return c.json(await BB.newsletterSubscribe(c.env, { siteId: b.site_id ?? 'demo-site', email: b.email ?? 'sub@demo.com', segment: b.segment }));
});

// A7 Membership
features.post('/api/membership/tiers', requireFlag('membership_paywall'), async (c) => {
  const b = await json(c) as { site_id?: string; name?: string; price_cents?: number; perks?: string[] };
  return c.json(await BB.membershipCreateTier(c.env, { siteId: b.site_id ?? 'demo-site', name: b.name ?? 'Bronze', priceCents: b.price_cents ?? 500, perks: b.perks ?? ['Member newsletter'] }));
});
features.get('/api/membership/tiers/:siteId', requireFlag('membership_paywall'), async (c) => c.json({ tiers: await BB.membershipListTiers(c.env, c.req.param('siteId')) }));

// A8 Donations
features.post('/api/donations/campaigns', requireFlag('donations_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; name?: string; goal_cents?: number; ends_at?: string };
  return c.json(await BB.donationCreateCampaign(c.env, { siteId: b.site_id ?? 'demo-site', name: b.name ?? 'Holiday Fund', goalCents: b.goal_cents ?? 100000, endsAt: b.ends_at }));
});
features.post('/api/donations/process', requireFlag('donations_engine'), async (c) => {
  const b = await json(c) as { campaign_id?: string; email?: string; amount_cents?: number; recurring?: boolean };
  return c.json(await BB.donationProcess(c.env, { campaignId: b.campaign_id ?? 'demo-camp', email: b.email ?? 'donor@demo.com', amountCents: b.amount_cents ?? 2500, recurring: b.recurring }));
});

// B9 Mobile admin
features.post('/api/mobile/register', requireFlag('native_mobile_admin'), async (c) => {
  const b = await json(c) as { user_id?: string; platform?: 'ios' | 'android'; device_id?: string; push_token?: string; app_version?: string };
  return c.json(await BB.mobileRegisterDevice(c.env, { userId: b.user_id ?? 'demo-user', platform: b.platform ?? 'ios', deviceId: b.device_id ?? 'demo-device', pushToken: b.push_token ?? 'demo-token', appVersion: b.app_version ?? '0.1.0' }));
});

// B10 Desktop admin
features.get('/api/desktop/info', requireFlag('native_desktop_admin'), (c) => c.json(BB.desktopAppInfo()));

// B11 Browser extension
features.get('/api/extension/info', requireFlag('browser_extension'), (c) => c.json(BB.browserExtensionInfo()));

// B12 Chat-ops bot
features.post('/api/chatops/connect', requireFlag('chat_ops_bot'), async (c) => {
  const b = await json(c) as { org_id?: string; platform?: 'slack' | 'teams' | 'discord'; webhook_url?: string; workspace_name?: string };
  return c.json(await BB.chatopsConnect(c.env, { orgId: b.org_id ?? 'demo-org', platform: b.platform ?? 'slack', webhookUrl: b.webhook_url ?? 'https://hooks.slack.com/test', workspaceName: b.workspace_name }));
});

// C13 SOC 2
features.get('/api/soc2/controls', requireFlag('soc2_program'), (c) => c.json({ controls: BB.soc2Controls() }));

// C14 HIPAA
features.post('/api/hipaa/baa', requireFlag('hipaa_variant'), async (c) => {
  const b = await json(c) as { customer_org_id?: string; business_name?: string };
  return c.json(await BB.hipaaSignBaa(c.env, { customerOrgId: b.customer_org_id ?? 'demo-org', businessName: b.business_name ?? 'Demo Health' }));
});

// C15 PCI tokenize
features.post('/api/pci/tokenize', requireFlag('pci_dss_l1'), async (c) => {
  const b = await json(c) as { customer_id?: string; last4?: string; brand?: string };
  return c.json(await BB.pciTokenize(c.env, { customerId: b.customer_id ?? 'cus_demo', last4: b.last4 ?? '4242', brand: b.brand ?? 'visa' }));
});

// C16 Enterprise SSO
features.post('/api/sso/connect', requireFlag('enterprise_sso'), async (c) => {
  const b = await json(c) as { org_id?: string; protocol?: 'saml' | 'oidc'; idp_metadata_url?: string; idp_entity_id?: string };
  return c.json(await BB.ssoConnect(c.env, { orgId: b.org_id ?? 'demo-org', protocol: b.protocol ?? 'saml', idpMetadataUrl: b.idp_metadata_url ?? 'https://demo.okta.com/metadata', idpEntityId: b.idp_entity_id ?? 'https://demo.okta.com' }));
});

// D17 Multi-region D1
features.get('/api/d1/replication-status', requireFlag('d1_multi_region'), (c) => c.json(BB.d1ReplicationStatus()));

// D18 BYO Cloudflare
features.post('/api/byo-cloudflare/connect', requireFlag('byo_cloudflare'), async (c) => {
  const b = await json(c) as { org_id?: string; cf_account_id?: string };
  return c.json(await BB.byoCloudflareConnect(c.env, { orgId: b.org_id ?? 'demo-org', cfAccountId: b.cf_account_id ?? 'demo-account-id' }));
});

// D19 Worker marketplace
features.get('/api/worker-marketplace', requireFlag('worker_marketplace'), async (c) => c.json({ listings: await BB.workerMarketplaceList(c.env) }));

// D20 Domain reseller
features.get('/api/domain-reseller/search', requireFlag('domain_reseller'), async (c) => c.json(await BB.domainResellerSearch(c.env, c.req.query('q') ?? 'projectsites')));

// E21 Voice clone
features.post('/api/voice-clones', requireFlag('brand_voice_clone'), async (c) => {
  const b = await json(c) as { org_id?: string; name?: string; sample_r2_keys?: string[] };
  return c.json(await BB.voiceCloneCreate(c.env, { orgId: b.org_id ?? 'demo-org', name: b.name ?? 'Brand Voice', sampleR2Keys: b.sample_r2_keys ?? [] }));
});

// E22 AI agent marketplace
features.get('/api/ai-agent-marketplace', requireFlag('ai_agent_marketplace'), async (c) => c.json({ listings: await BB.aiAgentMarketplaceList(c.env) }));

// E23 Site copilot
features.post('/api/site-copilot/index/:siteId', requireFlag('customer_site_copilot'), async (c) => c.json(await BB.siteCopilotIndex(c.env, { siteId: c.req.param('siteId') })));

// E24 AI video courses
features.post('/api/ai-video-courses', requireFlag('ai_video_courses'), async (c) => {
  const b = await json(c) as { site_id?: string; title?: string; outline?: string };
  return c.json(await BB.aiVideoCourseGenerate(c.env, { siteId: b.site_id ?? 'demo-site', title: b.title ?? 'Demo Course', outline: b.outline ?? '1. Intro\n2. Setup\n3. First steps' }));
});

// E25 AI A/B experiments
features.post('/api/ai-ab-experiments', requireFlag('ai_ab_test_generator'), async (c) => {
  const b = await json(c) as { site_id?: string; goal?: string; variant_count?: number };
  return c.json(await BB.aiAbExperimentStart(c.env, { siteId: b.site_id ?? 'demo-site', goal: b.goal ?? 'increase bookings', variantCount: b.variant_count }));
});

// F26 SMS marketing
features.post('/api/sms-campaigns', requireFlag('sms_marketing'), async (c) => {
  const b = await json(c) as { site_id?: string; name?: string; body?: string; segment?: string };
  return c.json(await BB.smsCampaignCreate(c.env, { siteId: b.site_id ?? 'demo-site', name: b.name ?? 'Flash sale', body: b.body ?? 'Save 20% today only', segment: b.segment }));
});

// F27 Affiliates
features.post('/api/affiliates', requireFlag('affiliate_program'), async (c) => {
  const b = await json(c) as { org_id?: string; email?: string; commission_pct?: number };
  return c.json(await BB.affiliateCreate(c.env, { orgId: b.org_id ?? 'demo-org', email: b.email ?? 'partner@demo.com', commissionPct: b.commission_pct }));
});

// F28 Loyalty
features.post('/api/loyalty/programs', requireFlag('loyalty_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; name?: string; points_per_dollar?: number };
  return c.json(await BB.loyaltyProgramCreate(c.env, { siteId: b.site_id ?? 'demo-site', name: b.name ?? 'Rewards', pointsPerDollar: b.points_per_dollar }));
});

// F29 CRM
features.get('/api/crm/deals/:siteId', requireFlag('crm_engine'), async (c) => c.json({ deals: await BB.crmListDeals(c.env, c.req.param('siteId')) }));
features.post('/api/crm/deals', requireFlag('crm_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; customer_name?: string; email?: string; value_cents?: number; stage?: string };
  return c.json(await BB.crmCreateDeal(c.env, { siteId: b.site_id ?? 'demo-site', customerName: b.customer_name ?? 'Demo Co', email: b.email, valueCents: b.value_cents ?? 5000, stage: b.stage }));
});

// F30 CDP
features.post('/api/cdp/profiles', requireFlag('cdp_engine'), async (c) => {
  const b = await json(c) as { site_id?: string; email?: string; phone?: string; traits?: Record<string, unknown> };
  return c.json(await BB.cdpUpsertProfile(c.env, { siteId: b.site_id ?? 'demo-site', email: b.email, phone: b.phone, traits: b.traits }));
});
features.post('/api/cdp/events', requireFlag('cdp_engine'), async (c) => {
  const b = await json(c) as { profile_id?: string; site_id?: string; source?: string; kind?: string; payload?: unknown };
  return c.json(await BB.cdpTrackEvent(c.env, { profileId: b.profile_id, siteId: b.site_id ?? 'demo-site', source: b.source ?? 'web', kind: b.kind ?? 'page_view', payload: b.payload ?? {} }));
});

// ── 3 NEW: IDE Sandbox + multi-agent + progressive skeleton ──────────

features.post('/api/ide-sandbox/spin-up', requireFlag('ide_sandbox'), async (c) => {
  const b = await json(c) as { site_id?: string; user_id?: string };
  return c.json(await IDE.spinUpSandbox(c.env, { siteId: b.site_id ?? 'demo-site', userId: b.user_id ?? 'demo-user' }));
});
features.get('/api/ide-sandbox/status/:sandboxId', requireFlag('ide_sandbox'), async (c) => c.json(await IDE.getSandboxStatus(c.env, c.req.param('sandboxId'))));
features.post('/api/ide-sandbox/destroy/:sandboxId', requireFlag('ide_sandbox'), async (c) => c.json(await IDE.destroySandbox(c.env, c.req.param('sandboxId'))));

features.post('/api/multi-agent/start', requireFlag('multi_agent_concurrent'), async (c) => {
  const b = await json(c) as { site_id?: string; agents?: string[]; prompt?: string };
  return c.json(await IDE.startMultiAgentRun(c.env, { siteId: b.site_id ?? 'demo-site', agents: b.agents ?? ['design', 'copy', 'seo', 'a11y'], prompt: b.prompt ?? 'Build a landing page for an artisan bakery' }));
});
features.get('/api/multi-agent/runs/:siteId', requireFlag('multi_agent_concurrent'), async (c) => c.json({ runs: await IDE.listMultiAgentRuns(c.env, c.req.param('siteId')) }));
features.get('/api/multi-agent/run/:runId', requireFlag('multi_agent_concurrent'), async (c) => c.json(await IDE.getMultiAgentRunDetail(c.env, c.req.param('runId'))));

features.post('/api/progressive-build/publish-skeleton/:siteId', requireFlag('progressive_skeleton_build'), async (c) => c.json(await IDE.publishSkeleton(c.env, c.req.param('siteId'))));
features.get('/api/progressive-build/stream/:siteId', requireFlag('progressive_skeleton_build'), async (c) => c.json(await IDE.getBuildStream(c.env, c.req.param('siteId'))));

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
