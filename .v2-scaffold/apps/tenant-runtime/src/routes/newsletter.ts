/**
 * Newsletter signup — Resend Audiences integration with D1 mirror.
 *
 * @remarks
 *  Stores the subscriber in tenant D1 (locale-aware), then attempts to add
 *  the contact to Resend Audiences if `RESEND_API_KEY` is configured. The
 *  D1 row is the source of truth; Resend is a side channel.
 *
 * @example
 *   POST /api/newsletter { "email": "jane@x.com" }
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppContext } from '../env';
import { turnstile } from '../middleware/turnstile';
import { upsertNewsletterSubscriber } from '../services/tenant-db';

const subscribeSchema = z.object({
  email: z.string().email().max(254),
  locale: z.string().min(2).max(10).optional(),
});

const app = new Hono<AppContext>();

app.post('/', turnstile(), zValidator('json', subscribeSchema), async (c) => {
  const body = c.req.valid('json');
  const locale = body.locale ?? c.var.locale;
  await upsertNewsletterSubscriber(c.env.SITE_DB, body.email, locale);

  if (c.env.RESEND_API_KEY) {
    c.executionCtx.waitUntil(
      addToResendAudience(c.env.RESEND_API_KEY, body.email, c.env.TENANT_SLUG).catch((err) => {
        console.warn('newsletter resend sync failed', {
          requestId: c.var.requestId,
          tenant: c.env.TENANT_SLUG,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    );
  }
  return c.json({ ok: true }, 202);
});

async function addToResendAudience(apiKey: string, email: string, tenantSlug: string): Promise<void> {
  // Audience id pattern: one Resend audience per tenant slug. Created by control-plane on tenant signup.
  const audienceId = `tenant-${tenantSlug}`;
  const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, unsubscribed: false }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

export default app;
