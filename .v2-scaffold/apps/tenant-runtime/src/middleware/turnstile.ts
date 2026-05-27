/**
 * Cloudflare Turnstile verification — invisible/managed mode.
 *
 * @remarks
 *  Pass `cf-turnstile-response` as a body field OR `cf-turnstile-response`
 *  header. If `TURNSTILE_SECRET_KEY` is unset, middleware no-ops (dev mode).
 *
 * @throws TurnstileFailedError when siteverify returns success:false.
 *
 * @example
 *   app.post('/api/contact', turnstile(), contactHandler);
 */
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../env';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
}

export function turnstile(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const secret = c.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      // Dev/staging fallback — Turnstile not yet provisioned. Log + continue.
      console.warn('turnstile: secret missing, skipping verification', {
        tenant: c.env.TENANT_SLUG,
      });
      return next();
    }
    const headerToken = c.req.header('cf-turnstile-response');
    const body = await safeParseJson(c.req.raw.clone());
    const bodyToken = typeof body === 'object' && body && 'cf-turnstile-response' in body
      ? String((body as Record<string, unknown>)['cf-turnstile-response'] ?? '')
      : '';
    const token = headerToken || bodyToken;
    if (!token) {
      throw new HTTPException(400, { message: 'Turnstile token missing' });
    }
    const remoteip = c.req.header('cf-connecting-ip') ?? undefined;
    const form = new FormData();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteip) form.set('remoteip', remoteip);
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const json = (await res.json()) as SiteverifyResponse;
    if (!json.success) {
      throw new HTTPException(403, {
        message: `Turnstile rejected: ${(json['error-codes'] ?? []).join(',') || 'unknown'}`,
      });
    }
    await next();
  };
}

async function safeParseJson(req: Request): Promise<unknown> {
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    return await req.json();
  } catch {
    return null;
  }
}
