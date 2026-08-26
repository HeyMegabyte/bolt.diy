/**
 * @module routes/search
 * @description Public search and site-creation routes for the homepage SPA.
 *
 * Screen 1 (Search)   → GET  /api/search/businesses      → Google Places proxy
 * Screen 1 (Lookup)   → GET  /api/sites/lookup            → check existing site by place_id/slug
 * Screen 3 (Create)   → POST /api/sites/create-from-search → create site + enqueue AI workflow
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import {
  badRequest,
  unauthorized,
  sanitizeHtml,
  stripHtml,
  pickSafeRedirect,
  DOMAINS,
} from '@project-sites/shared';

// Re-exported for callers (and tests) that import it from this module rather
// than from @project-sites/shared.
export { pickSafeRedirect };

import { dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { sanitizeLikeTerm } from '../services/like_pattern.js';
import { writeAuditLog } from '../services/audit.js';
import { runObservedWorkersAI } from '../lib/workers_ai.js';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

// Google Places search (GET /api/search/businesses + GET /api/search/address —
// business text-search + address autocomplete, KV-cached, honest-empty degradation)
// moved to `libs/features/places_search/handlers.ts` (route-decomposition installment
// 25). The GooglePlace/GooglePlacesResponse + Autocomplete* interfaces moved with them;
// `badRequest` stays (still used by lookup/create-from-search/prompt routes here).

// ─── Site Search (pre-built) ─────────────────────────────────

interface SiteSearchRow {
  id: string;
  slug: string;
  business_name: string;
  business_address: string | null;
  google_place_id: string | null;
  status: string;
  current_build_version: string | null;
}

search.get('/api/sites/search', async (c) => {
  const q = c.req.query('q');

  if (!q || q.trim().length < 2) {
    return c.json({ data: [] });
  }

  // Bound query length, and strip the user's own %/_ wildcards so they match
  // literally — otherwise a wildcard-heavy term crashes the query (`LIKE pattern
  // too complex`, swallowed → lying-empty) and matches wrong rows.
  const bounded = q.trim().slice(0, 100);
  const searchTerm = `%${sanitizeLikeTerm(bounded)}%`;
  // Exclude LYING-PUBLISHED rows: a `status='published'` site with a NULL
  // `current_build_version` is not a real, viewable site — its subdomain serves
  // the branded 503 ("the last build didn't finish"). Such rows (e.g. e2e/mock
  // seed stubs) otherwise leak into this PUBLIC "pre-built sites" discovery search
  // and present a fake/dead business as an existing site. Non-published rows
  // (building/draft/error — also null-build) still surface (a build-in-progress is
  // legitimately discoverable); real published sites (with a build) still surface.
  const { data } = await dbQuery<SiteSearchRow>(
    c.env.DB,
    "SELECT id, slug, business_name, business_address, google_place_id, status, current_build_version FROM sites WHERE business_name LIKE ? AND deleted_at IS NULL AND (status != 'published' OR current_build_version IS NOT NULL) ORDER BY CASE WHEN status = 'published' THEN 0 WHEN status = 'building' THEN 1 ELSE 2 END, created_at DESC LIMIT 5",
    [searchTerm],
  );

  return c.json({
    data: data.map((site) => ({
      site_id: site.id,
      slug: site.slug,
      business_name: site.business_name,
      business_address: site.business_address,
      google_place_id: site.google_place_id,
      status: site.status,
      has_build: site.current_build_version !== null,
    })),
  });
});

// ─── Command-palette search (⌘K smart results) ──────────────
// Powers the full-screen ⌘K "Smart results" group: static admin-route catalog +
// the caller's own sites (by name) + best-effort AutoRAG enrichment over indexed
// content. AutoRAG is optional — when the instance isn't configured the handler
// still returns catalog + site matches.

interface CommandResult {
  id: string;
  label: string;
  icon: string;
  route?: string;
  url?: string;
  detail?: string;
}

const ADMIN_COMMAND_CATALOG: ReadonlyArray<CommandResult> = [
  { id: 'cs-dashboard', label: 'Dashboard', icon: 'dashboard', route: '/admin', detail: 'Admin' },
  // 'Sites' → the dashboard IS the sites hub. This is a SINGLE-SITE admin: there
  // is deliberately NO bare `/admin/sites` list route (only `/admin/sites/:id`),
  // so `/admin/sites` resolves to the admin 404. Point at `/admin` instead.
  { id: 'cs-sites', label: 'Sites', icon: 'dashboard', route: '/admin', detail: 'Admin' },
  { id: 'cs-editor', label: 'Editor', icon: 'edit', route: '/admin/editor', detail: 'Admin' },
  // No 'Media library' command — there is no `/admin/media` route or media library
  // UI in this SPA (the `/api/media/*` worker surface has no admin page), so
  // advertising it dead-ended ⌘K users on the admin 404. Restore only when a real
  // `/admin/media` route ships.
  {
    id: 'cs-analytics',
    label: 'Analytics',
    icon: 'status',
    route: '/admin/analytics',
    detail: 'Admin',
  },
  { id: 'cs-forms', label: 'Forms', icon: 'document', route: '/admin/forms', detail: 'Admin' },
  { id: 'cs-seo', label: 'SEO', icon: 'search', route: '/admin/seo', detail: 'Admin' },
  { id: 'cs-social', label: 'Social', icon: 'changelog', route: '/admin/social', detail: 'Admin' },
  { id: 'cs-apps', label: 'Apps', icon: 'plus', route: '/admin/apps', detail: 'Admin' },
  { id: 'cs-domains', label: 'Domains', icon: 'lock', route: '/admin/domains', detail: 'Admin' },
  { id: 'cs-billing', label: 'Billing', icon: 'billing', route: '/admin/billing', detail: 'Admin' },
  {
    id: 'cs-feature-flags',
    label: 'Feature Flags',
    icon: 'settings',
    route: '/admin/feature-flags',
    detail: 'Admin',
  },
  {
    id: 'cs-features',
    label: 'Features',
    icon: 'sparkle',
    route: '/admin/site-features',
    detail: 'Admin',
  },
  {
    id: 'cs-settings',
    label: 'Settings',
    icon: 'settings',
    route: '/admin/settings',
    detail: 'Admin',
  },
  { id: 'cs-docs', label: 'API Docs', icon: 'document', route: '/admin/docs', detail: 'Admin' },
  { id: 'cs-status', label: 'System Status', icon: 'status', route: '/status', detail: 'Public' },
];

/** Case-insensitive substring match on label or route. Exported for unit tests. */
export function matchCommandCatalog(q: string, limit = 6): CommandResult[] {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  return ADMIN_COMMAND_CATALOG.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(term) || (cmd.route ?? '').toLowerCase().includes(term),
  ).slice(0, limit);
}

search.get('/api/search/command', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const bounded = q.slice(0, 100);
  const results: CommandResult[] = [...matchCommandCatalog(bounded)];

  // The caller's own sites by name → jump straight to that site in the admin.
  const orgId = c.get('orgId');
  if (orgId) {
    try {
      const { data } = await dbQuery<{ id: string; slug: string; business_name: string }>(
        c.env.DB,
        'SELECT id, slug, business_name FROM sites WHERE org_id = ? AND business_name LIKE ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5',
        [orgId, `%${sanitizeLikeTerm(bounded)}%`],
      );
      for (const s of data) {
        results.push({
          id: `cs-site-${s.id}`,
          label: s.business_name || s.slug,
          icon: 'dashboard',
          route: `/admin?site=${encodeURIComponent(s.id)}`,
          detail: 'Your site',
        });
      }
    } catch {
      /* site search is best-effort */
    }
  }

  // Best-effort AutoRAG enrichment over indexed content (skipped when unconfigured).
  try {
    const ai = c.env.AI as unknown as {
      autorag?: (name: string) => {
        search: (opts: { query: string }) => Promise<{
          data?: Array<{ filename?: string; attributes?: Record<string, unknown> }>;
        }>;
      };
    };
    if (ai?.autorag) {
      const rag = await ai.autorag('projectsites-rag').search({ query: bounded });
      for (const d of (rag?.data ?? []).slice(0, 4)) {
        const title = String(d.attributes?.['title'] ?? d.filename ?? 'Result');
        const url = d.attributes?.['url'] ? String(d.attributes['url']) : undefined;
        results.push({
          id: `cs-rag-${title}`,
          label: title,
          icon: 'sparkle',
          url,
          detail: 'AI · AutoRAG',
        });
      }
    }
  } catch {
    /* AutoRAG optional */
  }

  return c.json({ results: results.slice(0, 14) });
});

// ─── Site Lookup ────────────────────────────────────────────

interface SiteRow {
  id: string;
  slug: string;
  status: string;
  current_build_version: string | null;
}

search.get('/api/sites/lookup', async (c) => {
  const placeId = c.req.query('place_id');
  const slug = c.req.query('slug');

  if (!placeId && !slug) {
    throw badRequest('Missing required query parameter: place_id or slug');
  }

  let site: SiteRow | null;

  if (placeId) {
    site = await dbQueryOne<SiteRow>(
      c.env.DB,
      'SELECT id, slug, status, current_build_version FROM sites WHERE google_place_id = ? AND deleted_at IS NULL',
      [placeId],
    );
  } else {
    site = await dbQueryOne<SiteRow>(
      c.env.DB,
      'SELECT id, slug, status, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug!],
    );
  }

  if (!site) {
    return c.json({ data: { exists: false } });
  }

  return c.json({
    data: {
      exists: true,
      site_id: site.id,
      slug: site.slug,
      status: site.status,
      has_build: site.current_build_version !== null,
    },
  });
});

// ─── Create Site from Search ────────────────────────────────

/** Nested business object sent by the homepage SPA (v2 payload format). */
interface BusinessPayload {
  name: string;
  address?: string;
  place_id?: string;
  phone?: string;
  website?: string;
  types?: string[];
}

/**
 * Request body for POST /api/sites/create-from-search. Supports two payload
 * formats for backward compatibility:
 * - v1 (flat):   `{ business_name, business_address, google_place_id, additional_context }`
 * - v2 (nested): `{ mode, business: {...}, additional_context }`
 */
interface CreateFromSearchBody {
  /** @deprecated Use `business.name` instead */
  business_name?: string;
  /** @deprecated Use `business.address` instead */
  business_address?: string;
  /** @deprecated Use `business.place_id` instead */
  google_place_id?: string;
  additional_context?: string;
  business?: BusinessPayload;
  /** Creation mode: 'business' or 'custom' */
  mode?: string;
}

search.post('/api/sites/create-from-search', async (c) => {
  const orgId = c.get('orgId');

  if (!orgId) {
    throw unauthorized('Must be authenticated');
  }

  // Check build limits (1 free, then $50/mo per site).
  const { checkBuildLimit, resolveActiveOrgPlan } = await import('../services/build_limits.js');
  const plan = await resolveActiveOrgPlan(c.env.DB, orgId);
  const limitCheck = await checkBuildLimit(c.env.DB, orgId, plan);
  if (!limitCheck.allowed) {
    c.executionCtx.waitUntil(
      writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: c.get('userId') ?? null,
        action: 'build_limit.exceeded',
        message: `Build limit reached for org '${orgId}' (used ${limitCheck.used}/${limitCheck.limit} on '${plan ?? 'free'}' plan)`,
        target_type: 'org',
        target_id: orgId,
        metadata_json: {
          used: limitCheck.used,
          limit: limitCheck.limit,
          plan: plan ?? 'free',
        },
        request_id: c.get('requestId'),
      }),
    );
    return c.json(
      {
        error: {
          code: 'BUILD_LIMIT_REACHED',
          message: `You've used ${limitCheck.used} of ${limitCheck.limit} ${limitCheck.limit === 1 ? 'site' : 'sites'}. ${limitCheck.limit === 1 ? 'Free accounts include 1 site — add more for $50/month per site.' : 'Contact support to raise your site ceiling.'}`,
        },
      },
      403,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as CreateFromSearchBody;

  // Normalize both v1 (flat) and v2 (nested business object) payload formats.
  const mode = body.mode ?? null;
  const businessName =
    body.business?.name || body.business_name || (mode === 'custom' ? 'Custom Website' : null);
  const businessAddress = body.business?.address || body.business_address;
  const googlePlaceId = body.business?.place_id || body.google_place_id;
  const businessPhone = body.business?.phone ?? null;

  if (!businessName || businessName.trim().length === 0) {
    throw badRequest('Missing required field: business_name (or business.name)');
  }

  if (businessName.length > 200) {
    throw badRequest('Business name must be 200 characters or fewer');
  }

  const additionalContext = body.additional_context
    ? sanitizeHtml(String(body.additional_context).slice(0, 5000))
    : null;

  if (businessAddress && String(businessAddress).length > 500) {
    throw badRequest('Business address must be 500 characters or fewer');
  }

  const sanitizedName = stripHtml(businessName).trim();
  if (!sanitizedName) {
    throw badRequest('Business name cannot be empty after sanitization');
  }

  if (mode) {
    console.warn(`[create-from-search] mode=${mode}, business=${sanitizedName}`);
  }

  const baseSlug = await generateSmartSlug(c.env, sanitizedName, businessAddress);

  // Ensure slug uniqueness across D1 (sites table) + R2 published content.
  const slug = await ensureUniqueSlug(c.env, baseSlug);

  const siteId = crypto.randomUUID();

  const site = {
    id: siteId,
    org_id: orgId,
    slug,
    business_name: sanitizedName,
    business_phone: businessPhone,
    business_email: null,
    business_address: businessAddress ?? null,
    google_place_id: googlePlaceId ?? null,
    bolt_chat_id: null,
    current_build_version: null,
    status: 'building',
    lighthouse_score: null,
    lighthouse_last_run: null,
    deleted_at: null,
  };

  const result = await dbInsert(c.env.DB, 'sites', site);

  if (result.error) {
    throw badRequest(`Failed to create site: ${result.error}`);
  }

  let workflowInstanceId: string | null = null;
  if (c.env.SITE_WORKFLOW) {
    const instance = await c.env.SITE_WORKFLOW.create({
      id: siteId,
      params: {
        siteId,
        slug,
        businessName: sanitizedName,
        businessAddress: businessAddress ?? undefined,
        businessPhone: businessPhone ?? undefined,
        businessCategory: body.business?.types?.[0] ?? undefined,
        googlePlaceId: googlePlaceId ?? undefined,
        additionalContext: additionalContext ?? undefined,
        uploadId: (body as Record<string, unknown>).upload_id as string | undefined,
        orgId: orgId,
      },
    });
    workflowInstanceId = instance.id;
  } else if (c.env.QUEUE) {
    // Fallback to queue when the workflow binding is unavailable. The message MUST
    // carry the SAME authoritative fields SITE_WORKFLOW.create receives — most
    // critically the unique `slug` (from ensureUniqueSlug, may carry a `-N` suffix).
    // The queue consumer uploads the build to `sites/${slug}/${version}/…`; if `slug`
    // is omitted it recomputes one from business_name → a DIFFERENT prefix than the
    // serving path resolves by the D1 `sites.slug` → the "published" site 404s.
    // Address + phone feed V2 research; dropping them silently degrades the site.
    await c.env.QUEUE.send({
      job_name: 'generate_site',
      site_id: siteId,
      slug,
      business_name: sanitizedName,
      business_address: businessAddress ?? null,
      business_phone: businessPhone ?? null,
      google_place_id: googlePlaceId ?? null,
      additional_context: additionalContext,
    });
  }

  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.created_from_search',
    message: `Site '${slug}' created from search for '${sanitizedName}'`,
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      business_name: sanitizedName,
      slug,
      google_place_id: googlePlaceId ?? null,
      business_address: businessAddress ?? null,
      mode,
    },
    request_id: c.get('requestId'),
  });

  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'workflow.queued',
    message: `AI build pipeline queued for '${slug}' — research, generate, and deploy`,
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      business_name: sanitizedName,
      slug,
      workflow_instance_id: workflowInstanceId ?? null,
      has_additional_context: !!additionalContext,
    },
    request_id: c.get('requestId'),
  });

  // Log anticipated build phases so the Logs modal shows pipeline stages.
  const buildPhases = [
    {
      action: 'workflow.phase.research',
      message: `Build phase 1 (research) queued for '${slug}'`,
    },
    {
      action: 'workflow.phase.generation',
      message: `Build phase 2 (AI generation) queued for '${slug}'`,
    },
    {
      action: 'workflow.phase.deployment',
      message: `Build phase 3 (CDN deploy + publish) queued for '${slug}'`,
    },
  ];
  for (const phase of buildPhases) {
    await writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: phase.action,
      message: phase.message,
      target_type: 'site',
      target_id: siteId,
      metadata_json: {
        slug,
        workflow_instance_id: workflowInstanceId ?? null,
      },
      request_id: c.get('requestId'),
    }).catch(() => {});
  }

  return c.json(
    {
      data: {
        site_id: siteId,
        slug,
        status: 'building',
        workflow_instance_id: workflowInstanceId,
      },
    },
    201,
  );
});

// ─── Improve Prompt with AI ─────────────────────────────────
search.post('/api/sites/improve-prompt', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : '';
  const businessAddress =
    typeof body.business_address === 'string' ? body.business_address.trim() : '';

  if (text.length > 5000) {
    throw badRequest('Text must not exceed 5000 characters');
  }

  let systemPrompt: string;
  let userPrompt: string;

  if (!text) {
    // No text provided — generate a template with placeholders.
    systemPrompt =
      'You are a professional website copywriter and business consultant. ' +
      'Generate a comprehensive business profile template for a small business portfolio website. ' +
      'Use placeholders in [BRACKETS] for information the business owner needs to fill in. ' +
      'Include sections for: business description, services/products offered, business hours, ' +
      'contact information (phone, email, physical address), about the owner/team, ' +
      'and any unique selling points. Make it professional and ready to customize. ' +
      'Return ONLY the template text, nothing else.';

    userPrompt =
      'Generate a business profile template with placeholders for a small business website.';
    if (businessName) {
      userPrompt += '\n\nBusiness name: ' + businessName;
    }
    if (businessAddress) {
      userPrompt += '\nBusiness address: ' + businessAddress;
    }
  } else {
    systemPrompt =
      'You are a professional website copywriter and business consultant. ' +
      'Your job is to take rough notes about a business and improve them into clear, well-structured ' +
      'information that would help an AI build a great website. ' +
      'Fix grammar, spelling, and formatting. Organize the information logically. ' +
      'Where information seems missing or incomplete, insert placeholders in [BRACKETS] and ' +
      'add a brief comment about what should go there. ' +
      'Keep the same general meaning but make it professional and comprehensive. ' +
      'Return ONLY the improved text, nothing else.';

    userPrompt = 'Here is the rough text to improve:\n\n' + text;
    if (businessName) {
      userPrompt += '\n\nBusiness name: ' + businessName;
    }
    if (businessAddress) {
      userPrompt += '\nBusiness address: ' + businessAddress;
    }
  }

  try {
    const ai = c.env.AI;
    if (!ai) {
      // Fallback: static template if AI binding not available.
      const fallbackText =
        text ||
        (businessName ? businessName + ' — ' : '[Business Name] — ') +
          'Welcome to our business!\n\n' +
          '[Brief description of what your business does]\n\n' +
          'Services:\n- [Service 1]\n- [Service 2]\n- [Service 3]\n\n' +
          'Hours: [Mon-Fri 9AM-5PM]\n' +
          'Phone: [Your phone number]\n' +
          'Email: [Your email address]\n' +
          'Address: ' +
          (businessAddress || '[Your business address]');
      return c.json({ data: { improved_text: fallbackText } });
    }

    const result = await runObservedWorkersAI(
      c.env,
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      },
      {
        distinctId: c.get('orgId') ?? c.get('userId') ?? 'anon',
        promptId: 'ai_improve_prompt',
        traceId: c.get('requestId'),
      },
    );

    const improved =
      typeof result === 'object' && result !== null && 'response' in result
        ? String((result as { response: string }).response).trim()
        : text;

    return c.json({ data: { improved_text: improved || text } });
  } catch {
    // On AI failure, return original text rather than error.
    return c.json({ data: { improved_text: text } });
  }
});

// ─── Generate Expert Prompt (OpenAI Research → bolt.diy Prompt) ──

search.post('/api/sites/generate-prompt', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('orgId');

  if (!userId || !orgId) {
    throw unauthorized('Authentication required');
  }

  const body = await c.req.json().catch(() => ({}));
  const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : '';
  const businessAddress =
    typeof body.business_address === 'string' ? body.business_address.trim() : '';
  const businessPhone = typeof body.business_phone === 'string' ? body.business_phone.trim() : '';
  const googlePlaceId = typeof body.google_place_id === 'string' ? body.google_place_id.trim() : '';
  const additionalContext =
    typeof body.additional_context === 'string' ? body.additional_context.trim() : '';
  const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';

  if (!businessName) {
    throw badRequest('business_name is required');
  }

  if (!c.env.OPENAI_API_KEY) {
    throw badRequest('OpenAI API key is not configured. Cannot run research pipeline.');
  }

  const { researchAndFormulatePrompt } = await import('../services/openai_research.js');

  const result = await researchAndFormulatePrompt(c.env, {
    businessName,
    businessAddress: businessAddress || undefined,
    businessPhone: businessPhone || undefined,
    googlePlaceId: googlePlaceId || undefined,
    additionalContext: additionalContext || undefined,
  });

  // If a site ID was provided, store the research data in R2.
  if (siteId) {
    const site = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
      c.env.DB,
      'SELECT slug, current_build_version FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
      [siteId, orgId],
    );

    if (site) {
      const version = site.current_build_version || new Date().toISOString().replace(/[:.]/g, '-');
      await c.env.SITES_BUCKET.put(
        `sites/${site.slug}/${version}/research.json`,
        JSON.stringify(
          {
            profile: result.profile,
            brand: result.brand,
            sellingPoints: result.sellingPoints,
            social: result.social,
          },
          null,
          2,
        ),
        { httpMetadata: { contentType: 'application/json' } },
      );
    }
  }

  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'research.generate_prompt',
    message: `Generated AI research prompt for '${businessName}'`,
    target_type: 'site',
    target_id: siteId || null,
    metadata_json: { business_name: businessName, model: c.env.RESEARCH_MODEL || 'o3-mini' },
  }).catch(() => {
    /* best-effort */
  });

  return c.json({
    data: {
      prompt: result.expertPrompt,
      research: {
        profile: result.profile,
        brand: result.brand,
        sellingPoints: result.sellingPoints,
        social: result.social,
      },
    },
  });
});

// ─── Slug Uniqueness Helper ──────────────────────────────────

/**
 * Generate a smart, AI-calculated slug that is the shortest meaningful
 * representation of the business name + location differentiator.
 *
 * Examples:
 * - "Trader Joe's" at "3056 NJ-10, Denville, NJ" → "trader-joes-denville"
 * - "When Doody Calls - Pooper Scoopers" → "when-doody-calls"
 * - "Vito's Mens Salon" → "vitos-mens-salon"
 *
 * Falls back to simple slugification if AI is unavailable.
 */
async function generateSmartSlug(
  env: Env,
  businessName: string,
  address?: string,
): Promise<string> {
  const simpleSlug =
    businessName
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63) || `site-${Date.now().toString(36)}`;

  try {
    const result = await env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct-fp8' as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: 'system',
            content: `Generate the shortest, simplest URL slug for a business website. Rules:
- Output ONLY the slug, nothing else. No explanation.
- Use lowercase letters, numbers, and hyphens only.
- Remove possessives ('s → s), articles (the, a, an), and filler words.
- For chain businesses (Trader Joe's, McDonald's, Starbucks), include a location differentiator (neighborhood or city name).
- For unique businesses, just use the core business name (2-4 words max).
- Remove subtitles/taglines after dashes unless they ARE the brand name.
- Maximum 40 characters, prefer under 25.

Examples:
"Trader Joe's" at "3056 NJ-10, Denville, NJ 07834" → trader-joes-denville
"Trader Joe's - Hell's Kitchen" at "435 W 42nd St, NY" → trader-joes-hells-kitchen
"When Doody Calls - Pooper Scoopers" at "Dallas, TX" → when-doody-calls
"Vito's Mens Salon" at "74 N Beverwyck Rd, Lake Hiawatha, NJ" → vitos-mens-salon
"The White House" at "1600 Pennsylvania Ave, DC" → the-white-house
"McDonald's" at "789 Broadway, New York, NY" → mcdonalds-broadway-nyc`,
          },
          {
            role: 'user',
            content: `Business: "${businessName}"${address ? `\nAddress: "${address}"` : ''}`,
          },
        ],
        max_tokens: 50,
      },
    );

    const response = ((result as { response?: string }).response ?? '').trim();
    const aiSlug = response
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);

    if (aiSlug && aiSlug.length >= 3 && aiSlug.length <= 63 && /^[a-z0-9]/.test(aiSlug)) {
      return aiSlug;
    }
  } catch {
    // AI unavailable — fall through to simple slug.
  }

  return simpleSlug;
}

/**
 * Ensure the slug is unique across D1 and R2. Appends an incrementing suffix
 * (-2, -3, …) if taken; falls back to a random suffix after 10 attempts.
 */
async function ensureUniqueSlug(env: Env, slug: string): Promise<string> {
  let candidate = slug;

  for (let attempt = 0; attempt < 10; attempt++) {
    // Include deleted rows — the unique constraint spans all rows.
    const existingInDb = await dbQueryOne<{ id: string }>(
      env.DB,
      'SELECT id FROM sites WHERE slug = ?',
      [candidate],
    );

    if (!existingInDb) {
      // Also check R2 for orphaned content.
      const manifestInR2 = await env.SITES_BUCKET.get(`sites/${candidate}/_manifest.json`);
      if (!manifestInR2) {
        return candidate;
      }
    }

    candidate = `${slug}-${attempt + 2}`;
  }

  return `${slug}-${Date.now().toString(36).slice(-4)}`;
}

/** AI-powered business categorization into one of the predefined categories. */
search.post('/api/ai/categorize', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name: string;
    address?: string;
    types?: string[];
  };
  if (!body.name) {
    return c.json({ data: { category: '' } });
  }

  const categories = [
    'Restaurant / Café',
    'Salon / Barbershop',
    'Legal / Law Firm',
    'Medical / Healthcare',
    'Retail / Shop',
    'Technology / SaaS',
    'Construction / Home Services',
    'Fitness / Gym',
    'Real Estate',
    'Photography / Creative',
    'Automotive',
    'Education / Tutoring',
    'Financial / Accounting',
    'Other',
  ];

  try {
    const prompt = `Classify this business into exactly one category. Respond with ONLY the category name, nothing else.

Business: "${body.name}"${body.address ? ` at ${body.address}` : ''}${body.types?.length ? ` (types: ${body.types.join(', ')})` : ''}

Categories: ${categories.join(', ')}

Category:`;

    const result = (await runObservedWorkersAI(
      c.env,
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 30,
        temperature: 0,
      },
      {
        distinctId: c.get('orgId') ?? c.get('userId') ?? 'anon',
        promptId: 'ai_categorize',
        traceId: c.get('requestId'),
      },
    )) as { response?: string };

    const raw = (result.response || '').trim();
    const matched =
      categories.find((cat) => raw.includes(cat)) ||
      categories.find((cat) => raw.toLowerCase().includes(cat.toLowerCase().split(' / ')[0])) ||
      '';

    return c.json({ data: { category: matched } });
  } catch (err) {
    console.warn('[ai/categorize] AI call failed:', err);
    return c.json({ data: { category: '' } });
  }
});

// Public form-ingest endpoints (POST /api/contact-form/:slug + POST
// /api/newsletter/subscribe — generated-site contact leads → contacts +
// form_submissions + SES/SendGrid/Resend + bell, and native double-opt-in
// newsletter subscribe) moved to `libs/features/contact_newsletter/handlers.ts`
// (route-decomposition installment 23). Their exclusive deps (contactFormSchema +
// escapeHtml from shared, getEmailProvider from email-router) moved with them.

/**
 * Site preview — serves the site's index.html from R2 directly. Used by the admin
 * panel to show previews without triggering CF challenges.
 */
search.get('/api/sites/:slug/preview', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) return c.text('Missing slug', 400);

  try {
    const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);
    if (!manifest) {
      return c.text('Site not found', 404);
    }
    const manifestData = (await manifest.json()) as { current_version?: string };
    const version = manifestData.current_version;
    if (!version) return c.text('No published version', 404);

    const html = await c.env.SITES_BUCKET.get(`sites/${slug}/${version}/index.html`);
    if (!html) return c.text('HTML not found', 404);

    let content = await html.text();
    // Inject base tag so relative URLs resolve correctly.
    content = content.replace(
      '<head>',
      `<head><base href="https://${slug}${DOMAINS.SITES_SUFFIX}/">`,
    );

    return new Response(content, {
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        'X-Frame-Options': 'ALLOWALL',
      },
    });
  } catch {
    return c.text('Preview error', 500);
  }
});

const TRANSPARENT_PIXEL = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

// Domain availability (GET /api/domains/availability — public WhoisXML + RDAP-fallback
// check across popular TLDs + variations, KV-cached) FOLDED into
// `libs/features/domains/handlers.ts` (route-decomposition installment 24), which already
// owns the rest of `/api/domains/*`.

// ── Conversion Checkout (public, creates Stripe session) ───────────
search.post('/api/conversion/checkout', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    slug?: string;
    domain?: string;
    email?: string;
  };

  if (!body.slug) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing slug' } }, 400);
  }

  const { dbQueryOne } = await import('../services/db.js');
  const site = await dbQueryOne<{
    id: string;
    slug: string;
    org_id: string;
    business_name: string;
  }>(
    c.env.DB,
    'SELECT id, slug, org_id, business_name FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [body.slug],
  );
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  try {
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set('line_items[0][price_data][unit_amount]', '5000');
    params.set(
      'line_items[0][price_data][product_data][name]',
      `${site.business_name} Website — Pro Plan`,
    );
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Custom domain, AI editing, analytics, priority support`,
    );
    params.set('line_items[0][quantity]', '1');
    params.set('metadata[site_id]', site.id);
    params.set('metadata[slug]', site.slug);
    params.set('metadata[org_id]', site.org_id);
    params.set('metadata[domain]', body.domain || '');
    params.set('metadata[source]', 'conversion-flow');
    params.set('success_url', `https://${site.slug}${DOMAINS.SITES_SUFFIX}/?upgraded=1`);
    params.set('cancel_url', `https://${site.slug}${DOMAINS.SITES_SUFFIX}/`);
    if (body.email) params.set('customer_email', body.email);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!stripeRes.ok) {
      const errText = await stripeRes.text();
      console.warn('[conversion-checkout] Stripe error:', errText);
      return c.json({ error: { code: 'STRIPE_ERROR', message: 'Checkout creation failed' } }, 500);
    }

    const session = (await stripeRes.json()) as { url: string };
    return c.json({ data: { checkout_url: session.url } });
  } catch (err) {
    console.warn('[conversion-checkout] Error:', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Checkout creation failed' } }, 500);
  }
});

// Public + admin per-site D1 data-table API (GET /api/public-data/:table +
// GET/PUT/DELETE /api/sites/:siteId/data[/:table[/:rowId]] — the site_data key→JSON
// row store, with the ALLOWED_PUBLIC_TABLES whitelist + the ownsSiteData IDOR guard)
// moved to `libs/features/site_data_api/handlers.ts` (route-decomposition installment
// 21 — first search.ts extraction). Mounted before `search` + `api` in index.ts.

// Build-container callback endpoints (PUT /api/container-upload/*, POST
// /api/container-query, GET /api/container-script — R2 upload + parameterized D1
// query + build-server script, all shared-secret auth via containerAuthorized)
// moved to `libs/features/container_proxy/handlers.ts` (route-decomposition
// installment 22). The containerAuthorized helper + its timingSafeEqual import
// moved with them.

export { search };
