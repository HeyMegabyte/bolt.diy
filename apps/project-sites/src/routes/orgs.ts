/**
 * Organization routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  createOrgInputSchema,
  updateOrgInputSchema,
  createInviteInputSchema,
  updateMembershipInputSchema,
  ValidationError,
  NotFoundError,
  requireAuth,
  requireOrg,
  requireRole,
  requirePermission,
  ROLES,
  PERMISSIONS,
  slugify,
  type RequestContext,
} from '@project-sites/shared';
import { generateUuid } from '@project-sites/shared';

export const orgRoutes = new Hono<AppEnv>();

// List user's organizations
orgRoutes.get('/', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireAuth(ctx);
  const db = c.get('db');

  const { data: memberships, error } = await db
    .from('memberships')
    .select(`
      role,
      billing_admin,
      orgs (
        id,
        name,
        slug,
        created_at,
        updated_at
      )
    `)
    .eq('user_id', auth.user_id)
    .is('deleted_at', null);

  if (error) throw error;

  const orgs = memberships?.map((m) => ({
    ...m.orgs,
    role: m.role,
    billing_admin: m.billing_admin,
  })) || [];

  return c.json({
    success: true,
    data: { orgs },
    request_id: c.get('request_id'),
  });
});

// Create organization
orgRoutes.post('/', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireAuth(ctx);
  const body = await c.req.json();
  const result = createOrgInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const db = c.get('db');
  const orgId = generateUuid();
  const slug = result.data.slug || slugify(result.data.name);

  // Create org
  const { data: org, error: orgError } = await db
    .from('orgs')
    .insert({
      id: orgId,
      name: result.data.name,
      slug,
    })
    .select()
    .single();

  if (orgError) throw orgError;

  // Create owner membership
  const { error: membershipError } = await db
    .from('memberships')
    .insert({
      id: generateUuid(),
      org_id: orgId,
      user_id: auth.user_id,
      role: ROLES.OWNER,
      billing_admin: true,
    });

  if (membershipError) throw membershipError;

  return c.json({
    success: true,
    data: { org },
    request_id: c.get('request_id'),
  }, 201);
});

// Get organization
orgRoutes.get('/:org_id', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  requireAuth(ctx);
  const orgId = c.req.param('org_id');
  const db = c.get('db');

  const { data: org, error } = await db
    .from('orgs')
    .select('*')
    .eq('id', orgId)
    .is('deleted_at', null)
    .single();

  if (error || !org) {
    throw new NotFoundError('Organization');
  }

  // Get subscription
  const { data: subscription } = await db
    .from('subscriptions')
    .select('*')
    .eq('org_id', orgId)
    .is('ended_at', null)
    .single();

  return c.json({
    success: true,
    data: { org, subscription },
    request_id: c.get('request_id'),
  });
});

// Update organization
orgRoutes.patch('/:org_id', async (c) => {
  const orgId = c.req.param('org_id');
  const ctx: RequestContext = {
    auth: { ...c.get('auth')!, org_id: orgId },
    request_id: c.get('request_id'),
  };

  requirePermission(ctx, PERMISSIONS.ORG_UPDATE);

  const body = await c.req.json();
  const result = updateOrgInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const db = c.get('db');

  const { data: org, error } = await db
    .from('orgs')
    .update({
      ...result.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId)
    .select()
    .single();

  if (error) throw error;

  return c.json({
    success: true,
    data: { org },
    request_id: c.get('request_id'),
  });
});

// List organization members
orgRoutes.get('/:org_id/members', async (c) => {
  const orgId = c.req.param('org_id');
  const ctx: RequestContext = {
    auth: { ...c.get('auth')!, org_id: orgId },
    request_id: c.get('request_id'),
  };

  requirePermission(ctx, PERMISSIONS.ORG_READ);
  const db = c.get('db');

  const { data: members, error } = await db
    .from('memberships')
    .select(`
      id,
      role,
      billing_admin,
      created_at,
      users (
        id,
        email,
        display_name,
        avatar_url
      )
    `)
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (error) throw error;

  return c.json({
    success: true,
    data: { members },
    request_id: c.get('request_id'),
  });
});

// Update member role
orgRoutes.patch('/:org_id/members/:member_id', async (c) => {
  const orgId = c.req.param('org_id');
  const memberId = c.req.param('member_id');
  const ctx: RequestContext = {
    auth: { ...c.get('auth')!, org_id: orgId },
    request_id: c.get('request_id'),
  };

  requireRole(ctx, ROLES.ADMIN);

  const body = await c.req.json();
  const result = updateMembershipInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const db = c.get('db');

  const { data: membership, error } = await db
    .from('memberships')
    .update({
      ...result.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', memberId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) throw error;

  return c.json({
    success: true,
    data: { membership },
    request_id: c.get('request_id'),
  });
});

// Remove member
orgRoutes.delete('/:org_id/members/:member_id', async (c) => {
  const orgId = c.req.param('org_id');
  const memberId = c.req.param('member_id');
  const ctx: RequestContext = {
    auth: { ...c.get('auth')!, org_id: orgId },
    request_id: c.get('request_id'),
  };

  requireRole(ctx, ROLES.ADMIN);
  const db = c.get('db');

  const { error } = await db
    .from('memberships')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', memberId)
    .eq('org_id', orgId);

  if (error) throw error;

  return c.json({
    success: true,
    data: { message: 'Member removed' },
    request_id: c.get('request_id'),
  });
});

// Create invite
orgRoutes.post('/:org_id/invites', async (c) => {
  const orgId = c.req.param('org_id');
  const ctx: RequestContext = {
    auth: { ...c.get('auth')!, org_id: orgId },
    request_id: c.get('request_id'),
  };

  requirePermission(ctx, PERMISSIONS.ORG_INVITE);

  const body = await c.req.json();
  const result = createInviteInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const db = c.get('db');
  const inviteId = generateUuid();
  const token = generateUuid();

  const { data: invite, error } = await db
    .from('invites')
    .insert({
      id: inviteId,
      org_id: orgId,
      email: result.data.email,
      role: result.data.role,
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // TODO: Send invite email via SendGrid

  return c.json({
    success: true,
    data: { invite },
    request_id: c.get('request_id'),
  }, 201);
});
