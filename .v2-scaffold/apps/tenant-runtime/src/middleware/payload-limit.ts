/**
 * Reject oversized payloads early.
 *
 * @remarks
 *  Cloudflare Workers enforce a 100 MB request body cap; tenant sites have no
 *  legitimate use for anything close to that. We cap at 1 MB by default to
 *  keep abuse cheap.
 */
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../env';

const DEFAULT_LIMIT_BYTES = 1_048_576; // 1 MiB

export function payloadLimit(limitBytes = DEFAULT_LIMIT_BYTES): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const length = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(length) && length > limitBytes) {
      throw new HTTPException(413, { message: `Payload exceeds ${limitBytes} bytes` });
    }
    await next();
  };
}
