/**
 * automation.projectsites.dev/auth/sso — SSO Bridge (Better Auth → Active Pieces)
 *
 * Handles the JWT token exchange between ProjectSites Better Auth sessions
 * and Active Pieces managed auth. User signs into ProjectSites → clicks
 * "Automation" → this endpoint validates the session, mints a JWT, and
 * redirects to Active Pieces with the token.
 *
 * Architecture: CF Worker route on the existing automation proxy Worker.
 * Active Pieces receives the JWT and creates/updates its local user session.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

interface Env {
  BETTER_AUTH_URL: string;          // https://auth.projectsites.dev
  BETTER_AUTH_SECRET: string;       // shared secret for JWT signing
  ACTIVE_PIECES_URL: string;        // https://automation.projectsites.dev (Fly origin)
  ACTIVE_PIECES_JWT_SECRET: string; // secret Active Pieces uses to verify our JWTs
  FLY_APP_ORIGIN: string;           // Fly machine origin for non-SSO proxying
}

const ssoQuerySchema = z.object({
  redirect: z.string().optional().default('/'),
  token: z.string().optional(), // ProjectSites session token (alternative to cookie)
});

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /auth/sso — Exchange ProjectSites session for Active Pieces JWT.
 *
 * Accepts the ProjectSites session (via cookie or ?token= query param),
 * validates it against Better Auth, then mints a short-lived JWT that
 * Active Pieces accepts via its managed-JWT auth provider.
 *
 * Returns 302 to Active Pieces with the JWT as a query parameter.
 * Active Pieces reads ?jwt=..., validates the signature, and creates
 * or updates the corresponding user session.
 */
app.post('/auth/sso', zValidator('query', ssoQuerySchema), async (c) => {
  const { redirect, token: queryToken } = c.req.valid('query');

  // 1. Extract session token from cookie or query param
  const cookieToken = c.req.header('Cookie')
    ?.split(';')
    .find(c => c.trim().startsWith('ps_session='))
    ?.split('=')[1];

  const sessionToken = queryToken ?? cookieToken;
  if (!sessionToken) {
    return c.json({ error: 'no_session', message: 'No ProjectSites session found. Sign in first.' }, 401);
  }

  // 2. Validate session against Better Auth
  const verifyRes = await fetch(`${c.env.BETTER_AUTH_URL}/api/auth/verify-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${c.env.BETTER_AUTH_SECRET}`,
    },
    body: JSON.stringify({ token: sessionToken }),
  });

  if (!verifyRes.ok) {
    return c.json({ error: 'invalid_session', message: 'ProjectSites session expired or invalid.' }, 401);
  }

  const session = await verifyRes.json() as {
    user: { id: string; email: string; name?: string; orgId?: string };
  };

  // 3. Build Active Pieces JWT claims
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name ?? session.user.email.split('@')[0],
    // Active Pieces uses platformId + externalId for managed auth identity
    platformId: 'projectsites',
    externalId: session.user.id,
    // Map ProjectSites org to Active Pieces project
    organizationId: session.user.orgId,
    iat: now,
    exp: now + 3600, // 1h — matches ProjectSites session TTL
    iss: 'projectsites',
    aud: 'activepieces',
  };

  // 4. Sign JWT using Web Crypto (Workers-native, zero dependencies)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(c.env.ACTIVE_PIECES_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const header = encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encoder.encode(JSON.stringify(jwtPayload));
  const headerB64 = btoa(String.fromCharCode(...new Uint8Array(header)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(String.fromCharCode(...new Uint8Array(payload)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: 'HMAC' },
    key,
    encoder.encode(signingInput),
  );
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${signatureB64}`;

  // 5. Redirect to Active Pieces with JWT
  const apUrl = new URL('/authenticate', c.env.ACTIVE_PIECES_URL);
  apUrl.searchParams.set('jwt', jwt);
  apUrl.searchParams.set('redirect', redirect);

  return c.redirect(apUrl.toString(), 302);
});

/**
 * GET /auth/sso/callback — Active Pieces calls this to validate the JWT
 * and retrieve user profile after initial token exchange.
 *
 * This endpoint is called by Active Pieces' managed-JWT auth provider
 * during the authentication flow. It verifies the JWT signature and
 * returns the user profile.
 */
app.get('/auth/sso/callback', async (c) => {
  const authHeader = c.req.header('Authorization');
  const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!jwt) {
    return c.json({ error: 'missing_token' }, 401);
  }

  try {
    // Verify JWT signature
    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(c.env.ACTIVE_PIECES_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sigBytes = Uint8Array.from(
      atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0),
    );

    const valid = await crypto.subtle.verify(
      { name: 'HMAC' },
      key,
      sigBytes,
      encoder.encode(`${headerB64}.${payloadB64}`),
    );

    if (!valid) {
      return c.json({ error: 'invalid_token' }, 401);
    }

    // Decode and return user profile
    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(payloadJson);

    // Check expiration
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
      return c.json({ error: 'token_expired' }, 401);
    }

    return c.json({
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      platformId: claims.platformId,
      externalId: claims.externalId,
      organizationId: claims.organizationId,
    });
  } catch {
    return c.json({ error: 'invalid_token_format' }, 401);
  }
});

export default app;
export { app };
