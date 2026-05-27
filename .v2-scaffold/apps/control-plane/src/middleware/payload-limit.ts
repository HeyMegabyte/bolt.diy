/**
 * Payload-limit middleware. Rejects bodies exceeding `maxBytes` (default 1 MiB
 * for /api/*, 8 MiB for /webhooks/*). Webhook payloads can be large (Stripe ships
 * substantial event objects), so callers may override.
 */

import type { MiddlewareHandler } from 'hono';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB

export function payloadLimit(maxBytes: number = DEFAULT_MAX_BYTES): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE' || method === 'OPTIONS') {
      return next();
    }
    const lengthHeader = c.req.header('content-length');
    if (lengthHeader) {
      const length = parseInt(lengthHeader, 10);
      if (Number.isFinite(length) && length > maxBytes) {
        throw new AppError(
          ErrorCode.PAYLOAD_TOO_LARGE,
          `payload exceeds ${maxBytes} bytes`,
          { max_bytes: maxBytes, received: length },
        );
      }
    }
    return next();
  };
}
