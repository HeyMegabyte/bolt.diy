/**
 * Public intake routes (no auth required)
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  intakeRequestSchema,
  ValidationError,
  RateLimitError,
  slugify,
  generateUuid,
  DOMAINS,
} from '@project-sites/shared';

export const intakeRoutes = new Hono<AppEnv>();

// Submit intake form
intakeRoutes.post('/', async (c) => {
  // Rate limit by IP
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const rateLimitKey = `rate:intake:${ip}`;

  const currentCount = await c.env.CACHE_KV.get(rateLimitKey);
  if (currentCount && parseInt(currentCount) >= 10) {
    throw new RateLimitError('Too many intake requests', 60);
  }

  // Increment rate limit counter
  await c.env.CACHE_KV.put(
    rateLimitKey,
    String((parseInt(currentCount || '0') + 1)),
    { expirationTtl: 60 }
  );

  // Validate Turnstile token
  const body = await c.req.json();
  const result = intakeRequestSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  // Verify Turnstile token
  const turnstileResponse = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: c.env.CF_API_TOKEN, // Use a dedicated Turnstile secret in production
        response: result.data.turnstile_token,
        remoteip: ip,
      }),
    }
  );

  const turnstileResult = await turnstileResponse.json() as { success: boolean };
  if (!turnstileResult.success) {
    throw new ValidationError('Turnstile verification failed');
  }

  const db = c.get('db');
  const siteId = generateUuid();
  const orgId = generateUuid();

  // Generate unique slug
  let baseSlug = slugify(result.data.business_name);
  let slug = baseSlug;
  let suffix = 1;

  while (true) {
    const { data: existing } = await db
      .from('sites')
      .select('id')
      .eq('slug', slug)
      .single();

    if (!existing) break;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  // Create anonymous org
  const { error: orgError } = await db
    .from('orgs')
    .insert({
      id: orgId,
      name: result.data.business_name,
      slug: slug,
    });

  if (orgError) throw orgError;

  // Create site
  const { data: site, error: siteError } = await db
    .from('sites')
    .insert({
      id: siteId,
      org_id: orgId,
      slug,
      business_name: result.data.business_name,
      business_email: result.data.business_email,
      business_phone: result.data.business_phone,
      business_address: result.data.business_address,
      website_url: result.data.website_url,
    })
    .select()
    .single();

  if (siteError) throw siteError;

  // Queue site generation workflow
  await c.env.WORKFLOW_QUEUE.send({
    type: 'site_generation',
    payload: {
      org_id: orgId,
      site_id: siteId,
      business_name: result.data.business_name,
      business_email: result.data.business_email,
      business_phone: result.data.business_phone,
      business_address: result.data.business_address,
    },
    metadata: {
      request_id: c.get('request_id'),
      trace_id: c.get('trace_id'),
      org_id: orgId,
      attempt: 1,
      max_attempts: 3,
      scheduled_at: new Date().toISOString(),
    },
  });

  const previewUrl = `https://${slug}.${DOMAINS.SITES_BASE}`;
  const claimUrl = `https://${DOMAINS.CLAIM_DOMAIN}/${slug}`;

  return c.json({
    success: true,
    data: {
      site_id: siteId,
      slug,
      preview_url: previewUrl,
      claim_url: claimUrl,
      estimated_ready_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
    request_id: c.get('request_id'),
  }, 201);
});

// Check site status (polling endpoint)
intakeRoutes.get('/status/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.get('db');

  const { data: site, error } = await db
    .from('sites')
    .select('id, slug, business_name, last_published_at, lighthouse_score, r2_path')
    .eq('slug', slug)
    .single();

  if (error || !site) {
    return c.json({
      success: true,
      data: {
        status: 'not_found',
      },
      request_id: c.get('request_id'),
    });
  }

  const isReady = !!site.r2_path && !!site.last_published_at;

  return c.json({
    success: true,
    data: {
      status: isReady ? 'ready' : 'generating',
      site_id: site.id,
      slug: site.slug,
      business_name: site.business_name,
      lighthouse_score: site.lighthouse_score,
      published_at: site.last_published_at,
      preview_url: `https://${slug}.${DOMAINS.SITES_BASE}`,
    },
    request_id: c.get('request_id'),
  });
});
