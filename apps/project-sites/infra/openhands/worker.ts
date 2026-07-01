/**
 * OpenHands Worker — Cloudflare front door for openhands.projectsites.dev.
 *
 * Serves a branded login page (200 OK) when unauthenticated, manages sessions
 * in Cloudflare KV, and proxies authenticated traffic to the OpenHands origin
 * (Fly.io). Injects X-ProjectSites-Origin-Secret so the origin rejects
 * unauthenticated direct requests.
 */

interface Env {
  OPENHANDS_SESSIONS: KVNamespace;
  OPENHANDS_ADMIN_PASSWORD: string;
  OPENHANDS_SESSION_SECRET: string;
  OPENHANDS_ORIGIN_URL: string;
  OPENHANDS_ORIGIN_SECRET: string;
}

interface Session {
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const LOGIN_RATE_WINDOW_SECONDS = 300; // 5 minutes
const LOGIN_MAX_ATTEMPTS = 10;

// ── Crypto helpers ──────────────────────────────────────────────────────────

async function signSession(sessionId: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret).slice(0, 32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sessionId));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifySessionSig(
  sessionId: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  const expected = await signSession(sessionId, secret);
  return timingSafeEqual(expected, sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Session management ──────────────────────────────────────────────────────

async function getSession(
  request: Request,
  env: Env,
): Promise<{ sessionId: string; session: Session } | null> {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/openhands_session=([^;]+)/);
  if (!match) return null;

  const parts = match[1].split('.');
  if (parts.length !== 2) return null;
  const [sessionId, sig] = parts;

  if (!(await verifySessionSig(sessionId, sig, env.OPENHANDS_SESSION_SECRET))) {
    return null;
  }

  const raw = await env.OPENHANDS_SESSIONS.get(sessionId);
  if (!raw) return null;

  const session: Session = JSON.parse(raw);
  if (Date.now() > session.expiresAt) {
    await env.OPENHANDS_SESSIONS.delete(sessionId);
    return null;
  }

  return { sessionId, session };
}

async function createSession(env: Env): Promise<string> {
  const sessionId = generateSessionId();
  const session: Session = {
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  await env.OPENHANDS_SESSIONS.put(sessionId, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  const sig = await signSession(sessionId, env.OPENHANDS_SESSION_SECRET);
  return `${sessionId}.${sig}`;
}

// ── Rate limiting ───────────────────────────────────────────────────────────

async function checkLoginRateLimit(
  request: Request,
  env: Env,
): Promise<boolean> {
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
  const key = `rate:login:${ip}`;
  const current = await env.OPENHANDS_SESSIONS.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= LOGIN_MAX_ATTEMPTS) return false;
  // Increment with window expiration
  await env.OPENHANDS_SESSIONS.put(key, String(count + 1), {
    expirationTtl: LOGIN_RATE_WINDOW_SECONDS,
  });
  return true;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>OpenHands — ProjectSites.dev</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  display:flex;align-items:center;justify-content:center;
  font-family:"Sora","Space Grotesk",system-ui,-apple-system,sans-serif;
  background:#060610;color:#e0e0e0;
}
.login-card{
  width:100%;max-width:400px;padding:40px 32px;
  background:rgba(255,255,255,0.04);border:1px solid rgba(0,229,255,0.12);
  border-radius:22px;backdrop-filter:blur(12px);
}
.login-card h1{
  font-size:clamp(1.4rem,3vw,1.8rem);font-weight:700;margin-bottom:6px;
  background:linear-gradient(135deg,#00E5FF,#7C3AED);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;background-clip:text;
}
.login-card .subtitle{
  font-size:0.85rem;color:rgba(255,255,255,0.5);margin-bottom:28px;
}
.login-card label{
  display:block;font-size:0.8rem;text-transform:uppercase;
  letter-spacing:0.08em;color:rgba(255,255,255,0.6);margin-bottom:8px;
}
.login-card input{
  width:100%;padding:12px 16px;background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.12);border-radius:12px;
  color:#fff;font-size:1rem;font-family:inherit;outline:none;
  transition:border-color .2s;
}
.login-card input:focus{border-color:#00E5FF}
.login-card button{
  width:100%;margin-top:20px;padding:12px 24px;
  background:linear-gradient(135deg,#00E5FF,#7C3AED);color:#060610;
  border:none;border-radius:12px;font-size:1rem;font-weight:600;
  cursor:pointer;font-family:inherit;transition:opacity .2s;
}
.login-card button:hover{opacity:0.9}
.login-card .error{
  margin-top:12px;padding:10px 14px;background:rgba(255,80,80,0.12);
  border:1px solid rgba(255,80,80,0.25);border-radius:10px;
  font-size:0.85rem;color:#ff6b6b;display:none;
}
.login-card .error.visible{display:block}
.login-card .footer-text{
  margin-top:24px;font-size:0.75rem;color:rgba(255,255,255,0.35);
  text-align:center;
}
</style>
</head>
<body>
<div class="login-card">
  <h1>OpenHands</h1>
  <p class="subtitle">ProjectSites internal coding-agent console</p>
  <form method="get" action="/authenticate" id="login-form">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" autofocus required>
    <button type="submit">Log in</button>
    <div class="error" id="error"></div>
  </form>
  <p class="footer-text">Authorized ProjectSites operators only &middot; All agent actions are logged</p>
</div>
<script>
const form=document.getElementById('login-form');
const err=document.getElementById('error');
form.addEventListener('submit',async(e)=>{
  e.preventDefault();
  err.classList.remove('visible');
  const pw=document.getElementById('password').value;
  const res=await fetch('/authenticate?password='+encodeURIComponent(pw),{
    method:'GET',
    redirect:'manual'
  });
  if(res.redirected){
    window.location.href=res.headers.get('Location')||'/';
  }else{
    const t=await res.text();
    err.textContent=t||'Login failed';
    err.classList.add('visible');
  }
});
</script>
</body>
</html>`;

const LOGOUT_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Logged out — OpenHands</title>
<style>
body{
  display:flex;align-items:center;justify-content:center;min-height:100vh;
  font-family:"Sora","Space Grotesk",system-ui,sans-serif;
  background:#060610;color:#e0e0e0;
}
.card{
  text-align:center;padding:40px;
}
.card h1{font-size:1.4rem;margin-bottom:12px}
.card a{color:#00E5FF;text-decoration:none}
.card a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <h1>Logged out</h1>
  <p><a href="/">Log in again</a></p>
</div>
</body>
</html>`;

// ── Security headers ────────────────────────────────────────────────────────

function securityHeaders(originUrl: string): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'camera=(),microphone=(),geolocation=(),interest-cohort=()',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy':
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' ws: wss:; " +
      "media-src 'self'; " +
      "worker-src 'self' blob:; " +
      "frame-src 'self'; " +
      `form-action 'self' ${originUrl}; ` +
      "base-uri 'self'; " +
      "object-src 'none'",
  };
}

function setSecurityHeaders(response: Response, env: Env): Response {
  const headers = securityHeaders(env.OPENHANDS_ORIGIN_URL);
  const resp = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) {
    resp.headers.set(k, v);
  }
  return resp;
}

// ── Proxy ────────────────────────────────────────────────────────────────────

async function proxyToOrigin(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const originUrl = new URL(env.OPENHANDS_ORIGIN_URL);
  const targetUrl = new URL(url.pathname + url.search, originUrl);

  // Clone headers, remove host/cookie, add origin secret
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cookie');
  headers.set('X-ProjectSites-Origin-Secret', env.OPENHANDS_ORIGIN_SECRET);
  headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');
  headers.set('X-Forwarded-Proto', 'https');

  // Handle WebSocket upgrade
  const upgrade = request.headers.get('Upgrade') || '';
  if (upgrade.toLowerCase() === 'websocket') {
    // Pass through WebSocket upgrade
    headers.set('Connection', 'Upgrade');
    headers.set('Upgrade', 'websocket');
  }

  const fetchInit: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  // Forward body for non-GET/HEAD requests
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    fetchInit.body = request.body;
    // @ts-expect-error - duplex is needed for streaming bodies
    fetchInit.duplex = 'half';
  }

  const originResp = await fetch(targetUrl.toString(), fetchInit);

  // Build response, rewriting origin URL references in HTML
  const contentType = originResp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    let html = await originResp.text();
    // Rewrite origin references
    html = html.replace(
      new RegExp(originUrl.origin, 'g'),
      `https://${url.host}`,
    );
    html = html.replace(
      new RegExp(originUrl.host, 'g'),
      url.host,
    );
    const resp = new Response(html, originResp);
    resp.headers.delete('content-security-policy');
    return resp;
  }

  const resp = new Response(originResp.body, originResp);
  // Remove origin CSP so Worker CSP applies
  resp.headers.delete('content-security-policy');
  resp.headers.delete('set-cookie');
  return resp;
}

// ── Main handler ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // GET /healthz
    if (url.pathname === '/healthz') {
      let originReachable = false;
      let originStatus = 0;
      try {
        const originUrl = new URL('/health', env.OPENHANDS_ORIGIN_URL);
        const res = await fetch(originUrl.toString(), {
          headers: { 'X-ProjectSites-Origin-Secret': env.OPENHANDS_ORIGIN_SECRET },
          signal: AbortSignal.timeout(5000),
        });
        originReachable = res.ok;
        originStatus = res.status;
      } catch {
        // origin unreachable
      }

      return new Response(
        JSON.stringify({
          ok: true,
          timestamp: new Date().toISOString(),
          worker: 'openhands-proxy',
          origin: {
            reachable: originReachable,
            status: originStatus,
          },
          version: '1.0.0',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // GET /logout or POST /logout
    if (url.pathname === '/logout') {
      const session = await getSession(request, env);
      if (session) {
        await env.OPENHANDS_SESSIONS.delete(session.sessionId);
      }
      const resp = new Response(LOGOUT_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie':
            'openhands_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
        },
      });
      return setSecurityHeaders(resp, env);
    }

    // GET /authenticate?password=... (WAF blocks POST, so encode in query string)
    if ((url.pathname === '/authenticate' || url.pathname === '/login') && method === 'GET') {
      const password = url.searchParams.get('password') || '';

      if (!password) {
        // Password not provided — redirect to login page
        return Response.redirect('/', 302);
      }

      // Rate limit check
      if (!(await checkLoginRateLimit(request, env))) {
        return new Response('Too many login attempts. Try again later.', {
          status: 429,
        });
      }

      if (password !== env.OPENHANDS_ADMIN_PASSWORD) {
        return new Response('Invalid password', { status: 401 });
      }

      const cookieValue = await createSession(env);
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': `openhands_session=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}; Path=/`,
        },
      });
    }

    // GET / — login page or proxy
    if (url.pathname === '/') {
      const session = await getSession(request, env);
      if (!session) {
        const resp = new Response(LOGIN_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
        return setSecurityHeaders(resp, env);
      }
      const proxyResp = await proxyToOrigin(request, env);
      return setSecurityHeaders(proxyResp, env);
    }

    // All other routes: auth required
    const session = await getSession(request, env);
    if (!session) {
      // API requests get 401, page requests get redirect to login
      if (
        request.headers.get('Accept')?.includes('application/json') ||
        url.pathname.startsWith('/api/')
      ) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Redirect to login preserving path for page requests
      const loginUrl = new URL('/', request.url);
      return Response.redirect(loginUrl.toString(), 302);
    }

    // Authenticated: proxy
    const proxyResp = await proxyToOrigin(request, env);
    return setSecurityHeaders(proxyResp, env);
  },
};
