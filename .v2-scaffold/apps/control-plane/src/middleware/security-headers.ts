/**
 * Security headers for the API surface. CSP is intentionally tight — the API
 * never returns HTML. CORS is handled separately in `index.ts`.
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';

export const securityHeadersMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'no-referrer');
  h.set(
    'permissions-policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  );
  h.set('cross-origin-opener-policy', 'same-origin');
  h.set('cross-origin-resource-policy', 'same-origin');
  h.set(
    'content-security-policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
};
