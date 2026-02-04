/**
 * Hostname (custom domain) routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  createHostnameInputSchema,
  hostnameSchema,
  ValidationError,
  NotFoundError,
  requireOrg,
  requireSiteAccess,
  requireCustomDomains,
  PERMISSIONS,
  generateUuid,
  type RequestContext,
  type EntitlementContext,
} from '@project-sites/shared';
import { DomainsService } from '../services/domains.js';

export const hostnameRoutes = new Hono<AppEnv>();

// List hostnames for a site
hostnameRoutes.get('/sites/:site_id/hostnames', async (c) => {
  const siteId = c.req.param('site_id');
  const db = c.get('db');

  // Get site to check org
  const { data: site } = await db
    .from('sites')
    .select('org_id')
    .eq('id', siteId)
    .single();

  if (!site) {
    throw new NotFoundError('Site');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.HOSTNAME_READ, site.org_id);

  const { data: hostnames, error } = await db
    .from('hostnames')
    .select('*')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return c.json({
    success: true,
    data: { hostnames: hostnames || [] },
    request_id: c.get('request_id'),
  });
});

// Add hostname to a site
hostnameRoutes.post('/sites/:site_id/hostnames', async (c) => {
  const siteId = c.req.param('site_id');
  const db = c.get('db');

  // Get site to check org
  const { data: site } = await db
    .from('sites')
    .select('org_id, slug')
    .eq('id', siteId)
    .single();

  if (!site) {
    throw new NotFoundError('Site');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.HOSTNAME_CREATE, site.org_id);

  // Check entitlements
  const { data: subscription } = await db
    .from('subscriptions')
    .select('state')
    .eq('org_id', site.org_id)
    .is('ended_at', null)
    .single();

  const entitlementCtx: EntitlementContext = {
    org_id: site.org_id,
    subscription: subscription ? { state: subscription.state } : undefined,
  };

  // Count existing hostnames
  const { count: hostnameCount } = await db
    .from('hostnames')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .is('deleted_at', null);

  requireCustomDomains(entitlementCtx, hostnameCount || 0);

  // Validate input
  const body = await c.req.json();
  const hostnameResult = hostnameSchema.safeParse(body.hostname);

  if (!hostnameResult.success) {
    throw new ValidationError('Invalid hostname', { errors: hostnameResult.error.errors });
  }

  const hostname = hostnameResult.data;

  // Check if hostname already exists
  const { data: existingHostname } = await db
    .from('hostnames')
    .select('id')
    .eq('hostname', hostname)
    .is('deleted_at', null)
    .single();

  if (existingHostname) {
    throw new ValidationError('Hostname already in use');
  }

  // Create hostname record
  const hostnameId = generateUuid();
  const { data: newHostname, error: insertError } = await db
    .from('hostnames')
    .insert({
      id: hostnameId,
      org_id: site.org_id,
      site_id: siteId,
      hostname,
      state: 'pending',
      is_free_domain: false,
    })
    .select()
    .single();

  if (insertError) throw insertError;

  // Provision via Cloudflare for SaaS
  const domainsService = new DomainsService(c);
  try {
    await domainsService.provisionCustomDomain({
      org_id: site.org_id,
      site_id: siteId,
      hostname,
    });
  } catch (error) {
    // Log error but don't fail - will be retried by scheduled job
    console.error('Failed to provision hostname:', error);
  }

  return c.json({
    success: true,
    data: { hostname: newHostname },
    request_id: c.get('request_id'),
  }, 201);
});

// Get hostname status
hostnameRoutes.get('/hostnames/:hostname_id', async (c) => {
  const hostnameId = c.req.param('hostname_id');
  const db = c.get('db');

  const { data: hostname, error } = await db
    .from('hostnames')
    .select('*')
    .eq('id', hostnameId)
    .is('deleted_at', null)
    .single();

  if (error || !hostname) {
    throw new NotFoundError('Hostname');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.HOSTNAME_READ, hostname.org_id);

  return c.json({
    success: true,
    data: { hostname },
    request_id: c.get('request_id'),
  });
});

// Verify hostname (check DNS)
hostnameRoutes.post('/hostnames/:hostname_id/verify', async (c) => {
  const hostnameId = c.req.param('hostname_id');
  const db = c.get('db');

  const { data: hostname, error } = await db
    .from('hostnames')
    .select('*')
    .eq('id', hostnameId)
    .is('deleted_at', null)
    .single();

  if (error || !hostname) {
    throw new NotFoundError('Hostname');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.HOSTNAME_READ, hostname.org_id);

  const domainsService = new DomainsService(c);
  const status = await domainsService.verifyHostname({ hostname: hostname.hostname });

  // Update status in DB
  await db
    .from('hostnames')
    .update({
      state: status.active ? 'active' : 'pending',
      ssl_status: status.ssl_status,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', hostnameId);

  return c.json({
    success: true,
    data: {
      active: status.active,
      ssl_status: status.ssl_status,
      verification_errors: status.errors,
    },
    request_id: c.get('request_id'),
  });
});

// Delete hostname
hostnameRoutes.delete('/hostnames/:hostname_id', async (c) => {
  const hostnameId = c.req.param('hostname_id');
  const db = c.get('db');

  const { data: hostname, error } = await db
    .from('hostnames')
    .select('*')
    .eq('id', hostnameId)
    .is('deleted_at', null)
    .single();

  if (error || !hostname) {
    throw new NotFoundError('Hostname');
  }

  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireSiteAccess(ctx, PERMISSIONS.HOSTNAME_DELETE, hostname.org_id);

  // Delete from Cloudflare
  const domainsService = new DomainsService(c);
  try {
    await domainsService.deprovisionHostname({ hostname: hostname.hostname });
  } catch (error) {
    console.error('Failed to deprovision hostname:', error);
  }

  // Soft delete in DB
  await db
    .from('hostnames')
    .update({
      state: 'deleted',
      deleted_at: new Date().toISOString(),
    })
    .eq('id', hostnameId);

  return c.json({
    success: true,
    data: { message: 'Hostname deleted' },
    request_id: c.get('request_id'),
  });
});
