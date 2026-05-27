/**
 * Cloudflare Turnstile verifier. Routes that opt in pass through this middleware;
 * the token is read from `cf-turnstile-response` header OR `turnstile_token` body field.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

export const turnstileMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (c.env.ENVIRONMENT !== 'production') return next();

  const token = await readTurnstileToken(c);
  if (!token) {
    throw new AppError(ErrorCode.FORBIDDEN, 'turnstile token required');
  }

  const body = new URLSearchParams({
    secret: c.env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip:
      c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '',
  });

  const result = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body },
  );
  const data = (await result.json()) as TurnstileResponse;
  if (!data.success) {
    throw new AppError(ErrorCode.FORBIDDEN, 'turnstile verification failed', {
      codes: data['error-codes'],
    });
  }

  return next();
};

async function readTurnstileToken(c: Context<HonoEnv>): Promise<string | null> {
  const header = c.req.header('cf-turnstile-response');
  if (header) return header;
  try {
    const body = (await c.req.raw.clone().json()) as { turnstile_token?: string };
    return body.turnstile_token ?? null;
  } catch {
    return null;
  }
}
