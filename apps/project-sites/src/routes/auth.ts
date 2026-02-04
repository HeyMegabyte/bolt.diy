/**
 * Authentication routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  createMagicLinkInputSchema,
  verifyMagicLinkInputSchema,
  createPhoneOtpInputSchema,
  verifyPhoneOtpInputSchema,
  ValidationError,
  AuthError,
  requireAuth,
  type RequestContext,
} from '@project-sites/shared';
import { AuthService } from '../services/auth.js';

export const authRoutes = new Hono<AppEnv>();

// Magic link request
authRoutes.post('/magic-link', async (c) => {
  const body = await c.req.json();
  const result = createMagicLinkInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const authService = new AuthService(c);
  const response = await authService.createMagicLink(result.data.email);

  return c.json({
    success: true,
    data: { message: 'Magic link sent to your email' },
    request_id: c.get('request_id'),
  });
});

// Magic link verification
authRoutes.get('/magic-link/verify', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    throw new ValidationError('Token is required');
  }

  const authService = new AuthService(c);
  const session = await authService.verifyMagicLink(token);

  // Set session cookie
  c.header(
    'Set-Cookie',
    `session_token=${session.session_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  );

  // Redirect to success URL or return JSON
  const redirectUrl = c.req.query('redirect');
  if (redirectUrl) {
    return c.redirect(redirectUrl);
  }

  return c.json({
    success: true,
    data: session,
    request_id: c.get('request_id'),
  });
});

// Phone OTP request
authRoutes.post('/otp/send', async (c) => {
  const body = await c.req.json();
  const result = createPhoneOtpInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const authService = new AuthService(c);
  await authService.createPhoneOtp(result.data.phone);

  return c.json({
    success: true,
    data: { message: 'OTP sent to your phone' },
    request_id: c.get('request_id'),
  });
});

// Phone OTP verification
authRoutes.post('/otp/verify', async (c) => {
  const body = await c.req.json();
  const result = verifyPhoneOtpInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const authService = new AuthService(c);
  const session = await authService.verifyPhoneOtp(result.data.phone, result.data.code);

  // Set session cookie
  c.header(
    'Set-Cookie',
    `session_token=${session.session_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  );

  return c.json({
    success: true,
    data: session,
    request_id: c.get('request_id'),
  });
});

// Google OAuth initiation
authRoutes.get('/google', async (c) => {
  const redirectUrl = c.req.query('redirect') || 'https://sites.megabyte.space';

  const authService = new AuthService(c);
  const authUrl = await authService.createGoogleOAuthUrl(redirectUrl);

  return c.json({
    success: true,
    data: { auth_url: authUrl },
    request_id: c.get('request_id'),
  });
});

// Google OAuth callback
authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    throw new ValidationError('Missing code or state');
  }

  const authService = new AuthService(c);
  const { session, redirect_uri } = await authService.handleGoogleCallback(code, state);

  // Set session cookie
  c.header(
    'Set-Cookie',
    `session_token=${session.session_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  );

  return c.redirect(redirect_uri);
});

// Get current session
authRoutes.get('/session', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
    ip_address: c.req.header('CF-Connecting-IP'),
    user_agent: c.req.header('User-Agent'),
  };

  const auth = requireAuth(ctx);

  const db = c.get('db');
  const { data: user, error } = await db
    .from('users')
    .select('id, email, phone, display_name, avatar_url, email_verified, phone_verified')
    .eq('id', auth.user_id)
    .single();

  if (error || !user) {
    throw new AuthError('User not found');
  }

  return c.json({
    success: true,
    data: {
      user,
      org_id: auth.org_id,
      role: auth.role,
    },
    request_id: c.get('request_id'),
  });
});

// List user sessions
authRoutes.get('/sessions', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireAuth(ctx);

  const authService = new AuthService(c);
  const sessions = await authService.getUserSessions(auth.user_id);

  return c.json({
    success: true,
    data: { sessions },
    request_id: c.get('request_id'),
  });
});

// Revoke a session
authRoutes.delete('/sessions/:session_id', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireAuth(ctx);
  const sessionId = c.req.param('session_id');

  const authService = new AuthService(c);
  await authService.revokeSession(sessionId, auth.user_id);

  return c.json({
    success: true,
    data: { message: 'Session revoked' },
    request_id: c.get('request_id'),
  });
});

// Logout (revoke current session)
authRoutes.post('/logout', async (c) => {
  // Clear session cookie
  c.header(
    'Set-Cookie',
    'session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );

  return c.json({
    success: true,
    data: { message: 'Logged out' },
    request_id: c.get('request_id'),
  });
});
