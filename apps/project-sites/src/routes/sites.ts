/**
 * Site routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  createSiteInputSchema,
  updateSiteInputSchema,
  paginationInputSchema,
  ValidationError,
  NotFoundError,
  requireOrg,
  requireSiteAccess,
  PERMISSIONS,
  slugify,
  generateUuid,
  type RequestContext,
} from '@project-sites/shared';

export const siteRoutes = new Hono<AppEnv>();

// List sites for org
siteRoutes.get('/', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireOrg(ctx);
  const db = c.get('db');

  const pagination = paginationInputSchema.parse({
    page: Number(c.req.query('page')) || 1,
    limit: Number(c.req.query('limit')) || 20,
  });

  const offset = (pagination.page - 1) * pagination.limit;

  // Get total count
  const { count } = await db
    .from('sites')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', auth.org_id)
    .is('deleted_at', null);

  // Get sites
  const { data: sites, error } = await db
    .from('sites')
    .select('*')
    .eq('org_id', auth.org_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pagination.limit - 1);

  if (error) throw error;

  return c.json({
    success: true,
    data: {
      sites,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pagination.limit),
        hasMore: offset + pagination.limit < (count || 0),
      },
    },
    request_id: c.get('request_id'),
  });
});

// Create site
siteRoutes.post('/', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireOrg(ctx);

  const body = await c.req.json();
  const result = createSiteInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const db = c.get('db');
  const siteId = generateUuid();
  const slug = result.data.slug || slugify(result.data.business_name);

  // Check slug uniqueness
  const { data: existing } = await db
    .from('sites')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single();

  if (existing) {
    throw new ValidationError('Slug already in use', { slug });
  }

  const { data: site, error } = await db
    .from('sites')
    .insert({
      id: siteId,
      org_id: auth.org_id,
      slug,
      business_name: result.data.business_name,
      business_email: result.data.business_email,
      business_phone: result.data.business_phone,
      business_address: result.data.business_address,
      website_url: result.data.website_url,
    })
    .select()
    .single();

  if (error) throw error;

  // TODO: Queue site generation workflow

  return c.json({
    success: true,
    data: { site },
    request_id: c.get('request_id'),
  }, 201);
});

// Get site
siteRoutes.get('/:site_id', async (c) => {
  const siteId = c.req.param('site_id');
  const db = c.get('db');

  // Get site
  const { data: site, error } = await db
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .is('deleted_at', null)
    .single();

  if (error || !site) {
    throw new NotFoundError('Site');
  }

  // Check access
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.SITE_READ, site.org_id);

  // Get hostnames
  const { data: hostnames } = await db
    .from('hostnames')
    .select('*')
    .eq('site_id', siteId)
    .is('deleted_at', null);

  // Get subscription
  const { data: subscription } = await db
    .from('subscriptions')
    .select('*')
    .eq('org_id', site.org_id)
    .is('ended_at', null)
    .single();

  return c.json({
    success: true,
    data: {
      site,
      hostnames: hostnames || [],
      subscription,
    },
    request_id: c.get('request_id'),
  });
});

// Update site
siteRoutes.patch('/:site_id', async (c) => {
  const siteId = c.req.param('site_id');
  const db = c.get('db');

  // Get site first to check org_id
  const { data: existingSite } = await db
    .from('sites')
    .select('org_id')
    .eq('id', siteId)
    .single();

  if (!existingSite) {
    throw new NotFoundError('Site');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.SITE_UPDATE, existingSite.org_id);

  const body = await c.req.json();
  const result = updateSiteInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const { data: site, error } = await db
    .from('sites')
    .update({
      ...result.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', siteId)
    .select()
    .single();

  if (error) throw error;

  return c.json({
    success: true,
    data: { site },
    request_id: c.get('request_id'),
  });
});

// Delete site (soft delete)
siteRoutes.delete('/:site_id', async (c) => {
  const siteId = c.req.param('site_id');
  const db = c.get('db');

  // Get site first to check org_id
  const { data: existingSite } = await db
    .from('sites')
    .select('org_id')
    .eq('id', siteId)
    .single();

  if (!existingSite) {
    throw new NotFoundError('Site');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.SITE_DELETE, existingSite.org_id);

  const { error } = await db
    .from('sites')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', siteId);

  if (error) throw error;

  return c.json({
    success: true,
    data: { message: 'Site deleted' },
    request_id: c.get('request_id'),
  });
});

// Get site by slug (public)
siteRoutes.get('/by-slug/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.get('db');

  const { data: site, error } = await db
    .from('sites')
    .select('id, slug, business_name, last_published_at')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single();

  if (error || !site) {
    throw new NotFoundError('Site');
  }

  return c.json({
    success: true,
    data: { site },
    request_id: c.get('request_id'),
  });
});
