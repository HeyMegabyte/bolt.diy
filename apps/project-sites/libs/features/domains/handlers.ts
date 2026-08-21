/**
 * @module libs/features/domains/handlers
 *
 * @description
 * Hono routes for the domains feature — availability search, AI suggestions,
 * Stripe-checkout purchase, and direct CF-Registrar registration.
 *
 * | Method | Path                              | Auth   | Purpose                          |
 * | ------ | --------------------------------- | ------ | -------------------------------- |
 * | GET    | /api/domains/search-enrich        | public | RDAP + CF pricing + AI pitch     |
 * | GET    | /api/domains/search               | public | RDAP-backed legacy search shim   |
 * | POST   | /api/domains/purchase             | orgId  | Stripe checkout ($15/yr sub)     |
 * | POST   | /api/domains/register             | orgId  | Direct CF Registrar + bind       |
 * | GET    | /api/domains/suggest              | orgId  | AI domain suggestions (cached)   |
 * | POST   | /api/domains/suggest/refine       | orgId  | Refine suggestions w/ feedback   |
 * | GET    | /api/admin/profile/:site_id/context | orgId | Debug: resolved ProfileContext |
 *
 * Extracted verbatim from the `api.ts` monolith (route-decomposition
 * installment 1). Every request body/query is validated through
 * {@link ./schemas} at the boundary (zod-everywhere) — the former
 * `/register` `as {…}` cast is now `DomainRegisterSchema`. Business logic lives
 * in `src/services/*` (cf_registrar, rdap_availability, domain_suggester,
 * profile_context, domains); handlers stay thin. Thrown `badRequest` /
 * `unauthorized` / `notFound` are caught by the app-level error handler.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { badRequest, unauthorized, notFound, pickSafeRedirect, DOMAINS } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOwnedSite } from '../../../src/services/site_ownership.js';
import {
  buildTldPriceMap,
  porkbunFallback,
  registerDomain as cfRegisterDomain,
} from '../../../src/services/cf_registrar.js';
import { checkBatch as rdapCheckBatch } from '../../../src/services/rdap_availability.js';
import { suggestDomains, type DomainSuggestion } from '../../../src/services/domain_suggester.js';
import { gatherProfileContext } from '../../../src/services/profile_context.js';
import { dbQueryOne } from '../../../src/services/db.js';
import * as domainService from '../../../src/services/domains.js';
import * as auditService from '../../../src/services/audit.js';
import {
  DomainPurchaseSchema,
  DomainRegisterSchema,
  suggestQuerySchema,
  suggestRefineSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const domains = new Hono<AppContext>();

// ─── Domain Search Enrich (RDAP + CF Registrar pricing + Workers AI reasoning) ─
domains.get('/api/domains/search-enrich', async (c) => {
  const query = (c.req.query('q') || '').trim().toLowerCase().slice(0, 63);
  const business = (c.req.query('business') || '').trim().slice(0, 80);
  if (query.length < 2) {
    return c.json({ results: [] });
  }

  // Strip anything that isn't a-z/0-9/dash/dot.
  const sanitised = query.replace(/[^a-z0-9.-]/g, '');
  if (!sanitised || sanitised.length < 2) return c.json({ results: [] });

  // Literal `foo.tld` mode vs TLD fan-out mode.
  const TOP_TLDS = ['com', 'app', 'io', 'dev', 'co', 'ai', 'org', 'net', 'me', 'xyz'];
  const isLiteral = /^[a-z0-9-]+\.[a-z0-9-]+$/.test(sanitised);
  const candidates: string[] = isLiteral
    ? [sanitised]
    : TOP_TLDS.map((tld) => `${sanitised.replace(/\./g, '')}.${tld}`);

  // Fan out availability + pricing in parallel.
  const [rdapResults, tldMap] = await Promise.all([
    rdapCheckBatch(c.env, candidates),
    buildTldPriceMap(c.env),
  ]);

  type Row = {
    domain: string;
    tld: string;
    available: boolean;
    status: 'available' | 'taken' | 'unknown';
    price_usd_yr: number | null;
    can_register_inline: boolean;
    fallback_url: string | null;
  };
  const rows: Row[] = candidates.map((domain, i) => {
    const probe = rdapResults[i];
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    const priceRow = tldMap.get(tld);
    const price = priceRow?.registration_price_usd_yr ?? null;
    const cfCarries = !!priceRow?.can_register;
    return {
      domain,
      tld,
      available: probe?.available ?? false,
      status: probe?.status ?? 'unknown',
      price_usd_yr: price != null ? Math.round(price) : null,
      can_register_inline: cfCarries && probe?.available === true,
      fallback_url: cfCarries ? null : porkbunFallback(domain),
    };
  });

  // Deterministic fallback reason + pitch — cinematic-punchline voiced.
  const fallback = (r: Row): { reason: string; pitch: string } => {
    const tldNote: Record<string, string> = {
      com: 'Universal trust signal; safest pick.',
      ai: 'Premium .ai TLD; AI-brand resonance.',
      dev: 'Developer-coded; signals craft.',
      app: 'App-store adjacency; mobile cue.',
      io: 'Tech-startup vernacular; punchy.',
      co: 'Short company tag; modern shorthand.',
      org: 'Mission-driven; nonprofit trust.',
      net: 'Infrastructure cue; legacy weight.',
      me: 'Personal-brand cue; portfolio-ready.',
      xyz: 'Web3/modern cue; stands out in search.',
    };
    const note = tldNote[r.tld] || 'Distinctive TLD; stands out in search.';
    const priceTail = r.price_usd_yr ? `$${r.price_usd_yr}/yr.` : 'Pricing on register.';
    return {
      reason: `Matches ${business || query} + memorable .${r.tld}.`.slice(0, 80),
      pitch: `${note} ${priceTail}`.slice(0, 120),
    };
  };

  // Workers AI single-shot — batch all rows into ONE call.
  const aiBatch: Record<string, { reason: string; pitch: string }> = {};
  try {
    const prompt = `You are a domain-naming concierge for a website builder. For each candidate below, return ONE line per domain in the exact shape:
DOMAIN|||REASON|||PITCH

REASON must be <=80 chars, persona-voiced, cinematic-punchline style — say WHY this domain fits "${business || query}".
PITCH must be <=120 chars — TLD value + price + emotional hook. Example: "Premium .ai TLD; AI brand resonance; $69/yr."

Never repeat the literal domain inside REASON or PITCH. Never use the words "great" or "perfect" or "amazing". Be specific.

Candidates:
${rows.map((r) => `- ${r.domain} (.${r.tld}, ${r.status}, ${r.price_usd_yr != null ? `$${r.price_usd_yr}/yr` : 'price tbd'})`).join('\n')}`;

    const aiRes = (await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content:
            'You write tight, specific domain pitches. Always respond in the requested format. No preamble.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 600,
    } as never)) as { response?: string };

    const text = aiRes?.response || '';
    for (const line of text.split('\n')) {
      const [dom, reason, pitch] = line.split('|||').map((s) => (s || '').trim());
      if (dom && reason && pitch) {
        aiBatch[dom.toLowerCase()] = {
          reason: reason.slice(0, 80),
          pitch: pitch.slice(0, 120),
        };
      }
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'domain_search_enrich',
        message: 'Workers AI failed, using deterministic fallback',
        error: String(err),
      }),
    );
  }

  const enriched = rows.map((r) => {
    const ai = aiBatch[r.domain.toLowerCase()] || fallback(r);
    return {
      domain: r.domain,
      available: r.available,
      status: r.status,
      reason: ai.reason,
      pitch: ai.pitch,
      price_usd_yr: r.price_usd_yr,
      can_register_inline: r.can_register_inline,
      fallback_url: r.fallback_url ?? undefined,
    };
  });

  return c.json({ results: enriched });
});

// ─── Domain Search (legacy compat — RDAP-backed) ─────────────
domains.get('/api/domains/search', async (c) => {
  const query = c.req.query('q');
  if (!query || query.trim().length < 2 || query.trim().length > 63) {
    return c.json({ data: [] });
  }
  const sanitised = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '');
  if (!sanitised) return c.json({ data: [] });

  const TOP_TLDS = ['com', 'app', 'io', 'dev', 'co', 'ai', 'org', 'net', 'me', 'xyz'];
  const isLiteral = /^[a-z0-9-]+\.[a-z0-9-]+$/.test(sanitised);
  const candidates = isLiteral
    ? [sanitised]
    : TOP_TLDS.map((tld) => `${sanitised.replace(/\./g, '')}.${tld}`);

  const [rdapResults, tldMap] = await Promise.all([
    rdapCheckBatch(c.env, candidates),
    buildTldPriceMap(c.env),
  ]);

  const data = candidates.map((domain, i) => {
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    const usd = tldMap.get(tld)?.registration_price_usd_yr ?? 0;
    const probe = rdapResults[i];
    return {
      domain,
      available: probe?.available ?? false,
      // Surface the RDAP status so callers can distinguish a genuinely-registered
      // domain (`taken`) from one whose availability check FAILED (`unknown`).
      status: probe?.status ?? 'unknown',
      price: Math.round((usd || 0) * 100),
      zone: tld,
      path: '',
    };
  });

  // Honest degradation: if EVERY candidate's check failed (RDAP fully down),
  // carry a stable _error so callers show "temporarily unavailable" instead of a
  // misleading "all taken". A partial outage still returns per-item `status`.
  if (data.length > 0 && data.every((d) => d.status === 'unknown')) {
    return c.json({
      data,
      _error: {
        code: 'SEARCH_PROVIDER_UNAVAILABLE',
        status: 503,
        message: 'Domain availability lookup (RDAP) is temporarily unavailable',
      },
    });
  }

  return c.json({ data });
});

// ─── Domain Purchase (Stripe subscription) ───────────────────
domains.post('/api/domains/purchase', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  // Zod boundary: malformed JSON → clean 400 (not an unhandled 500), and the
  // client-supplied redirect URLs MUST be https (no `javascript:`/`data:`
  // scheme injection into Stripe's hosted-checkout return URL).
  const parsed = DomainPurchaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw badRequest('domain and site_id are required; success_url/cancel_url must be https URLs');
  }
  const body = parsed.data;

  // Verify site ownership (also fetch the slug to build the redirect allowlist).
  const site = await requireOwnedSite<{ id: string; org_id: string; slug: string }>(
    c.env,
    orgId,
    body.site_id,
    'id, org_id, slug',
  );

  // Clamp the Stripe redirect URLs to the site's OWN domains + the platform host
  // (open-redirect / phishing guard). Graceful: an off-domain/missing URL falls
  // back to a safe default, never errors.
  const allowedHosts = new Set<string>([DOMAINS.SITES_BASE, `${site.slug}${DOMAINS.SITES_SUFFIX}`]);
  const hns = await c.env.DB.prepare(
    'SELECT hostname FROM hostnames WHERE site_id = ? AND deleted_at IS NULL',
  )
    .bind(site.id)
    .all<{ hostname: string }>()
    .catch(() => ({ results: [] as { hostname: string }[] }));
  for (const r of hns.results ?? []) allowedHosts.add(String(r.hostname).toLowerCase());
  const siteUrl = `https://${site.slug}${DOMAINS.SITES_SUFFIX}`;
  const safeSuccessUrl = pickSafeRedirect(
    body.success_url,
    `${siteUrl}/?domain_purchase=success`,
    allowedHosts,
  );
  const safeCancelUrl = pickSafeRedirect(body.cancel_url, siteUrl, allowedHosts);

  // Create a Stripe checkout for domain subscription
  const userId = c.get('userId') || '';
  const user = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ?',
    [userId],
  );

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(c.env.STRIPE_SECRET_KEY + ':')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'subscription',
      success_url: safeSuccessUrl,
      cancel_url: safeCancelUrl,
      customer_email: user?.email || '',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][recurring][interval]': 'year',
      'line_items[0][price_data][unit_amount]': '1500', // $15/yr default
      'line_items[0][price_data][product_data][name]': `Domain: ${body.domain}`,
      'line_items[0][price_data][product_data][description]': `Annual domain registration for ${body.domain}`,
      'line_items[0][quantity]': '1',
      'metadata[org_id]': orgId,
      'metadata[site_id]': body.site_id,
      'metadata[domain]': body.domain,
      'metadata[type]': 'domain_purchase',
    }),
  });

  if (!stripeRes.ok) {
    const errData = await stripeRes.text();
    throw badRequest('Failed to create checkout: ' + errData);
  }

  const session = (await stripeRes.json()) as { url: string; id: string };

  // Audit: domain purchase checkout initiated
  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'domain.purchase_initiated',
      message: `Domain purchase started for '${body.domain}' — Stripe checkout session created`,
      target_type: 'domain',
      target_id: body.site_id,
      metadata_json: {
        domain: body.domain,
        site_id: body.site_id,
        stripe_session_id: session.id,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({
    data: {
      checkout_url: session.url,
      session_id: session.id,
    },
  });
});

// ─── Domain Registrar (direct CF Registrar via global-key auth) ────
domains.post('/api/domains/register', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  // Zod boundary (was an `as {…}` cast): trims + lowercases the domain and
  // shape-validates the site id. Malformed body → 400, never an unhandled 500.
  const parsed = DomainRegisterSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('domain and site_id are required');
  const { domain, site_id: siteId } = parsed.data;

  // Verify site ownership (404 never 403 — fires 30-36 protocol).
  const site = await requireOwnedSite<{ id: string; org_id: string }>(
    c.env,
    orgId,
    siteId,
    'id, org_id',
  );

  // Pull contact info from the authenticated user — CF Registrar requires a
  // full WHOIS contact even with privacy on (the privacy flag swaps in the
  // registrar's proxy contact for the public WHOIS while the real contact stays
  // with CF).
  const userId = c.get('userId');
  const user = userId
    ? await dbQueryOne<{ email: string; display_name: string | null; phone: string | null }>(
        c.env.DB,
        'SELECT email, display_name, phone FROM users WHERE id = ? AND deleted_at IS NULL',
        [userId],
      )
    : null;

  const userName = (user?.display_name || 'Site Owner').trim();
  const nameParts = userName.split(/\s+/);
  const firstName = nameParts[0] || 'Site';
  const lastName = nameParts.slice(1).join(' ') || 'Owner';

  const accountId = '84fa0d1b16ff8086dd958c468ce7fd59';
  const purchaseId = `pur_${crypto.randomUUID()}`;

  const result = await cfRegisterDomain(c.env, {
    domain,
    account_id: accountId,
    contact: {
      first_name: firstName,
      last_name: lastName,
      email: user?.email || 'hey@projectsites.dev',
      phone: user?.phone || '+1.5555551212',
      organization: 'ProjectSites',
      address: '1 Infinite Loop',
      city: 'Newark',
      state: 'NJ',
      zip: '07102',
      country: 'US',
    },
  });

  if (!result.ok) {
    if (result.error === 'TLD_NOT_SUPPORTED') {
      return c.json(
        {
          error: {
            code: 'tld_not_supported_by_cf',
            message: result.message ?? "CF Registrar doesn't carry this TLD.",
            fallback_url: result.fallback_url,
          },
        },
        424,
      );
    }
    if (result.error === 'CF_AUTH_MISSING') {
      return c.json(
        {
          error: {
            code: 'registrar_not_configured',
            message: result.message ?? 'CF auth missing.',
            unblock_url: 'https://dash.cloudflare.com/profile/api-tokens',
          },
        },
        424,
      );
    }
    throw badRequest(result.message ?? 'Registration failed.');
  }

  // Bind to site via the existing hostnames service so CF for SaaS provisioning
  // + SSL kick off automatically. Best-effort — register already succeeded so we
  // don't unwind.
  let sslStatus: 'pending' | 'failed' = 'pending';
  let hostnameId: string | null = null;
  try {
    await domainService.provisionCustomDomain(c.env.DB, c.env, {
      org_id: orgId,
      site_id: siteId,
      hostname: domain,
    });
    const row = await dbQueryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM hostnames WHERE hostname = ? AND deleted_at IS NULL',
      [domain],
    );
    hostnameId = row?.id ?? null;
  } catch (provErr) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'domain_register',
        message: 'hostname provisioning failed after register',
        error: String(provErr),
      }),
    );
    sslStatus = 'failed';
  }

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'domain.registered',
      message: `Domain '${domain}' registered via CF Registrar and bound to site '${siteId}'`,
      target_type: 'domain',
      target_id: siteId,
      metadata_json: {
        domain,
        site_id: siteId,
        hostname_id: hostnameId,
        purchase_id: purchaseId,
        transaction_id: result.transaction_id ?? null,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({
    data: {
      purchase_id: purchaseId,
      domain,
      hostname_id: hostnameId,
      ssl_status: sslStatus,
      transaction_id: result.transaction_id ?? null,
    },
  });
});

// ─── AI Domain Suggester (dropdown-fill endpoint) ───────────
domains.get('/api/domains/suggest', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const parsed = suggestQuerySchema.parse({
    site_id: c.req.query('site_id'),
    count: c.req.query('count'),
    query: c.req.query('query'),
    refresh: c.req.query('refresh'),
  });

  // Verify ownership before any AI spend (404 never 403 — fires 30-36 protocol).
  await requireOwnedSite<{ id: string }>(c.env, orgId, parsed.site_id);

  const count = parsed.count ?? 10;
  const cacheKey = `domain_suggest:${parsed.site_id}:${count}`;
  const wantRefresh = parsed.refresh === 'true' || Boolean(parsed.query);

  if (!wantRefresh) {
    try {
      const cached = await c.env.CACHE_KV.get(cacheKey, 'json');
      if (cached && typeof cached === 'object' && 'suggestions' in (cached as object)) {
        return c.json(cached);
      }
    } catch {
      // KV miss is non-fatal.
    }
  }

  const suggestions = await suggestDomains(c.env, {
    siteId: parsed.site_id,
    query: parsed.query,
    count,
  });

  const ctx = await gatherProfileContext(c.env, parsed.site_id);
  const contextSummary = ctx
    ? [
        ctx.business_name,
        ctx.business_type,
        ctx.location,
        ctx.target_audience ? `for ${ctx.target_audience}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 200)
    : '';

  const payload = {
    suggestions,
    context_summary: contextSummary,
    generated_at: new Date().toISOString(),
  };

  // 5-min cache — best-effort, never blocks the response.
  try {
    await c.env.CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 });
  } catch {
    // non-fatal
  }

  return c.json(payload);
});

domains.post('/api/domains/suggest/refine', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  // Malformed body → ZodError 400 (suggestRefineSchema required fields), not 500.
  const body = await c.req.json().catch(() => ({}));
  const parsed = suggestRefineSchema.parse(body);

  // Canonical org-ownership guard (404 never 403 — fires 30-36 protocol).
  await requireOwnedSite<{ id: string }>(c.env, orgId, parsed.site_id);

  const count = parsed.count ?? 10;

  const suggestions: DomainSuggestion[] = await suggestDomains(c.env, {
    siteId: parsed.site_id,
    feedback: parsed.feedback,
    excludeDomains: parsed.exclude_domains,
    count,
  });

  const ctx = await gatherProfileContext(c.env, parsed.site_id);
  const contextSummary = ctx
    ? [ctx.business_name, ctx.business_type, ctx.location].filter(Boolean).join(' · ').slice(0, 200)
    : '';

  const payload = {
    suggestions,
    context_summary: contextSummary,
    generated_at: new Date().toISOString(),
  };

  // Evict the GET cache so subsequent default opens see the refined set.
  try {
    await c.env.CACHE_KV.delete(`domain_suggest:${parsed.site_id}:${count}`);
  } catch {
    // non-fatal
  }

  return c.json(payload);
});

/**
 * Debug endpoint — return the full `ProfileContext` for a site. Same-org
 * ownership enforced (mirrors the rest of the `/api/admin/*` surface). Powers
 * the dashboard's "why these suggestions?" affordance.
 */
domains.get('/api/admin/profile/:site_id/context', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('site_id');
  if (!siteId || !/^[0-9a-f-]{36}$/i.test(siteId)) {
    throw badRequest('site_id must be a UUID');
  }

  // Canonical org-ownership guard (404 never 403 — fires 30-36 protocol).
  await requireOwnedSite<{ id: string }>(c.env, orgId, siteId);

  const context = await gatherProfileContext(c.env, siteId);
  if (!context) throw notFound('Site has no resolvable profile');

  return c.json({ context });
});
