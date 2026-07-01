/**
 * teable.projectsites.dev → Fly.io proxy.
 *
 * CF Containers couldn't start the 3.45GB Teable image (container crashed before
 * port 3000 opened). The app now runs on Fly.io (projectsites-teable.fly.dev),
 * and this Worker proxies all requests there. Health checks verify the Fly app
 * is responding before reporting ready.
 *
 * @remarks
 * Fly app: projectsites-teable.fly.dev (ewr, shared-cpu-4x, 4GB)
 * Data plane: Neon Postgres (projectsites_teable), Upstash Redis ×2, R2 (pending)
 *
 * The Teable DurableObject class is kept as a no-op stub because CF requires
 * the class to exist for the existing DO migration. It was used by the old
 * Container-based deployment which is now retired.
 */
import { DurableObject } from 'cloudflare:workers';

export class Teable extends DurableObject {
  // No-op stub — the app runs on Fly.io now.
  // This class exists only to satisfy the CF DO migration dependency.
}

interface Env {
  FLY_ORIGIN?: string;
}

const FLY_ORIGIN = 'https://projectsites-teable.fly.dev';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const flyOrigin = env.FLY_ORIGIN || FLY_ORIGIN;

    // /_health — verify Fly app is reachable
    if (url.pathname === '/_health') {
      try {
        const res = await fetch(`${flyOrigin}/`, {
          method: 'GET',
          headers: { 'User-Agent': 'projectsites-teable-health/1.0' },
        });
        return new Response(
          JSON.stringify({
            status: res.ok ? 'ok' : 'degraded',
            service: 'teable',
            runtime: 'fly.io',
            origin: flyOrigin,
            upstream_status: res.status,
          }),
          {
            status: res.ok ? 200 : 503,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ status: 'error', message: 'Fly upstream unreachable' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // /_ready — verify login page returns 200 from Fly
    if (url.pathname === '/_ready') {
      try {
        const res = await fetch(`${flyOrigin}/`, {
          method: 'GET',
          headers: { 'User-Agent': 'projectsites-teable-ready/1.0' },
        });
        const ready = res.status === 200;
        return new Response(
          JSON.stringify({
            status: ready ? 'ready' : 'not_ready',
            http_status: res.status,
          }),
          {
            status: ready ? 200 : 503,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ status: 'error', message: String(e) }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Proxy everything else to Fly.io
    const flyUrl = new URL(url.pathname + url.search, flyOrigin);

    const response = await fetch(flyUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });

    // Add security headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
