/**
 * anything.projectsites.dev — Proxy to AnythingLLM on Fly.io.
 *
 * The main worker's *.projectsites.dev/* wildcard prevents direct DNS changes.
 * This worker acts as a reverse proxy to the Fly.io deployment.
 * CF handles TLS termination; this worker forwards to Fly's internal URL.
 */
interface Env {
  FLY_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const flyUrl = env.FLY_URL || 'https://projectsites-anythingllm.fly.dev';
    const target = new URL(url.pathname + url.search, flyUrl);

    // Forward the request to Fly.io, preserving method, headers, and body
    const proxyReq = new Request(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });

    try {
      const response = await fetch(proxyReq);
      // Return response mostly as-is, but add security headers
      const newHeaders = new Headers(response.headers);
      newHeaders.set('X-Forwarded-Host', url.hostname);
      newHeaders.set('X-Proxy-By', 'projectsites-anythingllm-v2');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response('AnythingLLM is starting up. Please try again in a moment.', {
        status: 503,
        headers: { 'Retry-After': '30', 'Content-Type': 'text/plain' },
      });
    }
  },
};
