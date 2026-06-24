/**
 * @module routes/ses_webhooks
 *
 * @description
 * Inbound SES bounce/complaint webhook (§42/ADR-0019, layer 3 of the suppression
 * pipeline). SES publishes to SNS; Hookdeck (or SNS directly) forwards the event
 * here HMAC-signed with `SES_WEBHOOK_SECRET`. We verify the signature, auto-confirm
 * the SNS subscription handshake (SSRF-guarded), then run
 * {@link parseSesNotification} → {@link recordSuppressions} so hard-bounced /
 * complained addresses are never emailed again.
 *
 * Security: HMAC-verified (timing-safe) — an UNVERIFIED webhook would let anyone
 * suppress arbitrary addresses (a denial-of-email attack), so a missing/invalid
 * signature is rejected before any work. Always 200 on a verified, processed
 * message so the sender does not retry a success.
 *
 * @see services/ses_notifications.ts
 * @see services/email_suppressions.ts
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { verifyHmacSignature } from '../services/webhook.js';
import { parseSesNotification } from '../services/ses_notifications.js';
import { recordSuppressions } from '../services/email_suppressions.js';

export const sesWebhooks = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Only SNS-hosted confirmation URLs are fetched (SSRF guard). */
const SNS_SUBSCRIBE_HOST = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//;

sesWebhooks.post('/webhooks/ses', async (c) => {
  const secret = c.env.SES_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'ses_webhook_not_configured' }, 503);

  const raw = await c.req.text();
  const signature = c.req.header('x-hookdeck-signature') ?? c.req.header('x-signature') ?? '';
  const verified = await verifyHmacSignature(raw, signature, secret);
  if (!verified.valid) return c.json({ error: 'invalid_signature' }, 401);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const env = body as Record<string, unknown>;

  // SNS subscription handshake — confirm by GETting the SubscribeURL, but ONLY
  // when it is an SNS-hosted https URL (never fetch an attacker-supplied URL).
  if (env['Type'] === 'SubscriptionConfirmation') {
    const url = typeof env['SubscribeURL'] === 'string' ? env['SubscribeURL'] : '';
    if (!SNS_SUBSCRIBE_HOST.test(url)) {
      return c.json({ error: 'untrusted_subscribe_url' }, 400);
    }
    await fetch(url).catch(() => {});
    return c.json({ status: 'subscription_confirmed' }, 200);
  }

  // Notification → suppressions. recordSuppressions is idempotent (INSERT OR
  // IGNORE per email), so a replayed SNS delivery is safe.
  const suppressions = parseSesNotification(body);
  const result = suppressions.length
    ? await recordSuppressions(c.env.DB, suppressions)
    : { suppressed: 0 };

  return c.json({ status: 'ok', parsed: suppressions.length, suppressed: result.suppressed }, 200);
});
