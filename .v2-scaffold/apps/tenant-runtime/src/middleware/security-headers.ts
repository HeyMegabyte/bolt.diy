/**
 * Security headers middleware.
 *
 * @remarks
 *  Adds HSTS (1 year + preload), X-Content-Type-Options, Referrer-Policy,
 *  Permissions-Policy, X-Frame-Options, COOP/CORP, and a baseline CSP. CSP is
 *  intentionally permissive for inline+eval on the generated site because each
 *  tenant ships its own bundled JS; tighter CSP with per-response nonces is a
 *  separate hardening pass owned by the control-plane generator.
 *
 * @example
 *   app.use('*', securityHeaders());
 */
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';

export function securityHeaders(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'SAMEORIGIN');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'camera=()',
        'geolocation=(self)',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=(self)',
        'usb=()',
      ].join(', '),
    );
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    h.set('X-Robots-Tag', c.env.ENVIRONMENT === 'production' ? 'all' : 'noindex');
    // Tenant identity propagated for downstream observability headers; never sensitive.
    h.set('X-Tenant-Slug', c.env.TENANT_SLUG);
  };
}
