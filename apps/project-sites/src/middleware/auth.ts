/**
 * Authentication middleware
 * Validates session tokens and populates auth context
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';
import { hashToken, type AuthContext } from '@project-sites/shared';

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Get token from Authorization header or cookie
  let token: string | undefined;

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Check cookie
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      token = cookies['session_token'];
    }
  }

  // If no token, continue without auth
  if (!token) {
    await next();
    return;
  }

  try {
    const db = c.get('db');
    const tokenHash = await hashToken(token);

    // Look up session
    const { data: session, error } = await db
      .from('sessions')
      .select(`
        id,
        user_id,
        expires_at,
        revoked_at,
        users (
          id,
          email,
          phone,
          display_name,
          avatar_url
        ),
        memberships (
          org_id,
          role,
          billing_admin,
          orgs (
            id,
            name
          )
        )
      `)
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !session) {
      // Invalid or expired session
      await next();
      return;
    }

    // Get primary membership (first org)
    const membership = session.memberships?.[0];

    // Build auth context
    const authContext: AuthContext = {
      user_id: session.user_id,
      org_id: membership?.org_id,
      role: membership?.role,
      billing_admin: membership?.billing_admin,
    };

    c.set('auth', authContext);
    if (membership?.org_id) {
      c.set('org_id', membership.org_id);
    }

    // Update last active timestamp (don't wait)
    db.from('sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', session.id)
      .then(() => {});

  } catch (error) {
    console.error('Auth middleware error:', error);
  }

  await next();
};

/**
 * Middleware to extract org_id from path params
 */
export const orgFromPathMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const orgId = c.req.param('org_id');
  if (orgId) {
    c.set('org_id', orgId);
  }
  await next();
};
