/**
 * Contact-form submission. Persists to D1, emails via Resend.
 *
 * @remarks
 *  Turnstile-gated. Returns 202 on success. Resend failures are logged but
 *  do not fail the request — the submission is already persisted.
 *
 * @example
 *   curl -X POST https://acme.projectsites.dev/api/contact \
 *     -H 'content-type: application/json' \
 *     -d '{"name":"Jane","email":"jane@acme.com","subject":"hi","message":"hello","cf-turnstile-response":"..."}'
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppContext } from '../env';
import { turnstile } from '../middleware/turnstile';
import { insertContactSubmission } from '../services/tenant-db';

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  subject: z.string().min(1).max(200).default('Inbound contact'),
  message: z.string().min(1).max(5000),
  // Honeypot field — bots fill it, humans don't see it.
  website: z.string().max(0).optional(),
});

const app = new Hono<AppContext>();

app.post('/', turnstile(), zValidator('json', contactSchema), async (c) => {
  const body = c.req.valid('json');
  if (body.website) {
    // Honeypot triggered — pretend success without persisting.
    return c.json({ ok: true, id: 'spam-suppressed' }, 202);
  }
  const ip = c.req.header('cf-connecting-ip') ?? undefined;
  const { id } = await insertContactSubmission(c.env.SITE_DB, {
    name: body.name,
    email: body.email,
    subject: body.subject,
    message: body.message,
    source: c.req.header('referer') ?? 'direct',
    ip,
  });

  // Email via Resend when configured. Never block the response on email.
  c.executionCtx.waitUntil(
    deliverContactEmail(c.env, { id, ...body }).catch((err) => {
      console.warn('contact email failed', {
        requestId: c.var.requestId,
        tenant: c.env.TENANT_SLUG,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
  );

  return c.json({ ok: true, id }, 202);
});

async function deliverContactEmail(
  env: AppContext['Bindings'],
  body: { id: string; name: string; email: string; subject: string; message: string },
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM_EMAIL,
      to: [env.CONTACT_FROM_EMAIL],
      reply_to: body.email,
      subject: `[${env.TENANT_NAME}] ${body.subject}`,
      text: `From: ${body.name} <${body.email}>\nID: ${body.id}\n\n${body.message}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

export default app;
