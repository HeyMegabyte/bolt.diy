/**
 * dify.projectsites.dev — Cloudflare Worker router.
 *
 * Replaces nginx. Routes:
 *   - /api/*, /console/api/*, /v1/*, /files/* → Dify API (Fly.io)
 *   - /e/* (plugin endpoints), /plugin/*              → Dify API (Fly.io)
 *   - /health                                         → Dify API health
 *   - Everything else                                 → Dify Web (Fly.io Next.js)
 *
 * Backing services:
 *   - Neon Postgres (DATABASE_URL)
 *   - Upstash Redis (REDIS_URL)
 *   - Weaviate Cloud (VECTOR_STORE=weaviate)
 *   - R2 file storage (STORAGE_TYPE=s3)
 */

interface Env {
  DIFY_API_ORIGIN: string;  // e.g. https://dify.fly.dev or https://dify-api.internal
  DIFY_WEB_ORIGIN: string;  // e.g. https://dify-web.fly.dev
}

const API_PATH_PREFIXES = [
  '/api/',
  '/console/api/',
  '/v1/',
  '/files/',
  '/e/',
  '/plugin/',
  '/health',
  '/version',
];

function isApiPath(pathname: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check at edge
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const apiHealth = await fetch(`${env.DIFY_API_ORIGIN}/health`, {
          method: 'GET',
          headers: { 'User-Agent': 'cf-worker-health/1.0' },
        });
        const healthy = apiHealth.ok;
        return new Response(
          JSON.stringify({ status: healthy ? 'ok' : 'degraded', api: apiHealth.status }),
          {
            status: healthy ? 200 : 502,
            headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
          },
        );
      } catch {
        return new Response(JSON.stringify({ status: 'down' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
        });
      }
    }

    const target = isApiPath(url.pathname) ? env.DIFY_API_ORIGIN : env.DIFY_WEB_ORIGIN;

    // Rewrite / to /apps for Dify web (root redirects to apps list)
    if (url.pathname === '/' && target === env.DIFY_WEB_ORIGIN) {
      url.pathname = '/apps';
    }

    const proxyUrl = new URL(url.pathname + url.search, target);

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', url.hostname);
    headers.set('X-Forwarded-Proto', 'https');
    headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');

    // Strip CF-specific headers
    headers.delete('CF-Connecting-IP');
    headers.delete('CF-IPCountry');
    headers.delete('CF-Ray');
    headers.delete('CF-Visitor');

    const proxyReq = new Request(proxyUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });

    const response = await fetch(proxyReq);

    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      responseHeaders.set(key, value);
    }
    // Allow Dify's CSP; don't overwrite
    responseHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
