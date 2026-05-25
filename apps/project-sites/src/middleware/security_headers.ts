/**
 * Security-headers middleware for the Project Sites Cloudflare Worker.
 *
 * Sets standard security headers (HSTS, nosniff, referrer policy) on all
 * responses. CSP is intentionally permissive — this is a SaaS platform that
 * embeds iframes, loads user-uploaded images, generates blob URLs for
 * previews, and integrates many third-party services.
 *
 * @module security_headers
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { DOMAINS } from '@project-sites/shared';

/**
 * Attach HSTS, MIME-sniffing protection, referrer, Permissions-Policy and
 * a context-aware Content-Security-Policy to every response.
 *
 * @remarks
 * Three rendering modes resolved from the hostname + pathname:
 * - **bolt editor** (`editor.projectsites.dev`) — standalone mode keeps
 *   cross-origin isolation (COOP + COEP + Origin-Agent-Cluster) so
 *   WebContainers can use `SharedArrayBuffer`; embedded mode drops COOP
 *   so `postMessage` to the parent admin shell continues to work.
 * - **served sites** (any subdomain other than the editor) — permissive
 *   CSP so AI-generated HTML can load arbitrary fonts, scripts, iframes.
 * - **dashboard / marketing** — permissive CSP for inline scripts +
 *   third-party SDKs (Stripe, PostHog, GTM, Transloadit) but locks
 *   `frame-ancestors` to the projectsites.dev family.
 *
 * Runs `next()` first then attaches headers on the outgoing response so
 * the handler can override individual headers if it needs to.
 *
 * @example
 * ```ts
 * app.use('*', securityHeadersMiddleware);
 * ```
 */
export const securityHeadersMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  await next();

  const url = new URL(c.req.url);
  const hostname = url.hostname;

  const isDashboard = hostname === DOMAINS.SITES_BASE || hostname === 'localhost';
  const isBoltEditor = hostname === DOMAINS.BOLT_BASE;
  const isServedSite = !isDashboard && !isBoltEditor && !url.pathname.startsWith('/api/');

  // ── Universal headers ──────────────────────────────────────
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  /*
   * Permissions-Policy
   *  - microphone / camera / display-capture: allowed on the bolt.diy editor
   *    surface AND on the admin shell that embeds it, so the chat input's
   *    voice-input (Whisper) feature and any future video/screen-share
   *    workflows can call getUserMedia / getDisplayMedia.
   *  - autoplay: needed by the embedded preview iframe so AI-generated sites
   *    can render <video autoplay> hero loops without user-gesture friction.
   *  - geolocation: only the admin origin (the create-site wizard's
   *    geo-prompt for local business lookups).
   *  - Everything else: empty allowlist = blocked.
   */
  c.header(
    'Permissions-Policy',
    [
      `microphone=(self "https://${DOMAINS.SITES_BASE}" "https://${DOMAINS.BOLT_BASE}")`,
      `camera=(self "https://${DOMAINS.SITES_BASE}" "https://${DOMAINS.BOLT_BASE}")`,
      `display-capture=(self "https://${DOMAINS.SITES_BASE}" "https://${DOMAINS.BOLT_BASE}")`,
      `autoplay=(self "https://${DOMAINS.SITES_BASE}" "https://${DOMAINS.BOLT_BASE}")`,
      `geolocation=(self)`,
    ].join(', '),
  );

  // ── bolt.diy editor ────────────────────────────────────────
  if (isBoltEditor) {
    const isBoltEmbedded = url.searchParams.has('embedded');

    if (isBoltEmbedded) {
      // Embedded: allow framing from projectsites.dev, no COOP (breaks postMessage)
      c.header(
        'Content-Security-Policy',
        `frame-ancestors 'self' https://${DOMAINS.SITES_BASE} https://*.${DOMAINS.SITES_BASE}`,
      );
    } else {
      // Standalone: cross-origin isolation for WebContainers
      c.header('Cross-Origin-Opener-Policy', 'same-origin');
      c.header('Cross-Origin-Embedder-Policy', 'credentialless');
      c.header('Origin-Agent-Cluster', '?1');
      // No CSP — bolt.diy needs full access (WASM, eval, workers, etc.)
    }
    return;
  }

  // ── Served sites ({slug}.projectsites.dev) ─────────────────
  if (isServedSite) {
    // User-generated sites: permissive CSP, allow framing everywhere
    c.header('Cross-Origin-Embedder-Policy', 'credentialless');
    c.header('Cross-Origin-Resource-Policy', 'cross-origin');
    c.header(
      'Content-Security-Policy',
      [
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
        'img-src * data: blob:',
        'frame-ancestors *',
        "object-src 'none'",
      ].join('; '),
    );
    return;
  }

  // ── Dashboard / Marketing (projectsites.dev) ───────────────
  // Permissive CSP — the dashboard uses blob URLs for image previews,
  // embeds bolt.diy in iframes, loads images from R2/CDN, and integrates
  // Stripe, PostHog, Google Analytics, Transloadit, etc.
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
      "style-src 'self' 'unsafe-inline' https: blob:",
      'img-src * data: blob:',
      "font-src 'self' https: data:",
      'connect-src * data: blob:',
      'media-src * data: blob:',
      "worker-src 'self' blob:",
      "child-src 'self' blob: https:",
      'frame-src *',
      "frame-ancestors 'self' https://*.projectsites.dev",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
};
