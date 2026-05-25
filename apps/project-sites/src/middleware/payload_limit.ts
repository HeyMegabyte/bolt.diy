/**
 * @module middleware/payload_limit
 * @description Payload-size enforcement for the Project Sites Worker.
 *
 * Rejects requests whose `content-length` header exceeds the per-route cap
 * before any handler body executes. Upload routes get a 100 MB ceiling;
 * everything else uses {@link DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES}. The
 * bolt.diy editor origin bypasses the check entirely because its traffic
 * is proxied through Cloudflare Pages, which enforces its own ceiling.
 *
 * @packageDocumentation
 */

import type { MiddlewareHandler } from 'hono';
import { DEFAULT_CAPS, payloadTooLarge } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';

/** 100 MB limit for upload endpoints (ZIP deploys, bolt publish). */
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** Paths that allow the larger upload limit. */
const UPLOAD_PATHS = ['/api/publish/bolt', '/api/sites/'];

/**
 * Enforce max request payload size.
 *
 * @remarks
 * Upload endpoints (`/api/publish/bolt`, `/api/sites/:id/deploy`,
 * `/api/assets/upload`, `/api/media/upload`, `*\/publish-bolt`) get a
 * larger limit (100 MB) to support ZIP file uploads. All other endpoints
 * use {@link DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES}. The bolt editor
 * hostname is exempt because its requests are proxied to Cloudflare Pages
 * which applies its own size limits.
 *
 * @throws 413 PAYLOAD_TOO_LARGE when `content-length` exceeds the cap.
 *
 * @example
 * ```ts
 * app.use('/api/*', payloadLimitMiddleware);
 * ```
 */
export const payloadLimitMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const contentLength = c.req.header('content-length');

  if (contentLength) {
    const size = Number(contentLength);
    const url = new URL(c.req.url);
    const hostname = url.hostname;

    // Skip payload limit for bolt editor (editor.projectsites.dev) — proxied to Pages
    if (hostname === 'editor.projectsites.dev' || hostname.endsWith('.bolt-diy-8jf.pages.dev')) {
      await next();
      return;
    }

    const isUpload =
      (UPLOAD_PATHS.some((p) => url.pathname.startsWith(p)) &&
        (url.pathname.endsWith('/deploy') || url.pathname === '/api/publish/bolt')) ||
      url.pathname === '/api/assets/upload' ||
      url.pathname === '/api/media/upload' ||
      url.pathname.endsWith('/publish-bolt');
    const maxBytes = isUpload ? UPLOAD_MAX_BYTES : DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES;

    if (!Number.isNaN(size) && size > maxBytes) {
      throw payloadTooLarge(`Request body exceeds maximum size of ${maxBytes} bytes`);
    }
  }

  await next();
};
