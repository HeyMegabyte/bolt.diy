/**
 * @module routes/livekit_webhooks
 * @description Public, LiveKit-signature-verified webhook receiver for the voice
 * receptionist (ADR `docs/decisions/voice-architecture.md` — LiveKit amendment).
 *
 * | Path                 | Method | Purpose                                            |
 * | -------------------- | ------ | -------------------------------------------------- |
 * | `/webhooks/livekit`  | POST   | LiveKit Cloud room/egress lifecycle events → D1     |
 *
 * NOT the call-audio path — this receives lifecycle/egress events only
 * (`room_started`, `room_finished`, `participant_*`, `egress_*`, `ingress_*`).
 *
 * ## Verification
 * LiveKit signs each delivery with an HS256 JWT in the `Authorization` header
 * (no `Bearer` prefix). The JWT carries `iss` = API key and `sha256` = the
 * standard-base64 SHA-256 of the raw request body. We:
 *   1. verify the JWT signature + expiry against `LIVEKIT_API_SECRET`,
 *   2. assert `iss` === `LIVEKIT_API_KEY`,
 *   3. recompute the body SHA-256 and assert it matches the `sha256` claim.
 * Any failure → `403`. This makes the event un-forgeable without the secret.
 *
 * Idempotent on the LiveKit `event.id` via the shared `webhook_events` table
 * (provider `'livekit'`). Dark by default: when `LIVEKIT_API_KEY` /
 * `LIVEKIT_API_SECRET` are unset the route returns `404` (never leaks existence).
 *
 * Recording → R2 and transcript → `conversations` wiring lands in later voice
 * slices (the agent supplies the room↔site mapping); this receiver verifies,
 * de-dupes, persists the event, and acks.
 *
 * @packageDocumentation
 */

import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../types/env.js';

import { verifyHs256 } from '../lib/jwt.js';
import {
  checkWebhookIdempotency,
  markWebhookProcessed,
  storeWebhookEvent,
} from '../services/webhook.js';

export const livekitWebhookRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * LiveKit `WebhookEvent` — the fields we read are validated; the rest is allowed
 * through (vendor payloads evolve, and the JWT already proves authenticity).
 */
const LiveKitWebhookEventSchema = z
  .object({
    createdAt: z.union([z.number(), z.string()]).optional(),
    egressInfo: z
      .object({ egressId: z.string().optional(), status: z.string().optional() })
      .passthrough()
      .optional(),
    event: z.string().min(1),
    id: z.string().min(1),
    participant: z.object({ identity: z.string().optional() }).passthrough().optional(),
    room: z
      .object({ name: z.string().optional(), sid: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Standard-base64 SHA-256 of `text` — matches LiveKit's `sha256` JWT claim. */
async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function forbidden(c: Context<{ Bindings: Env; Variables: Variables }>, reason: string) {
  return c.json({ error: { code: 'FORBIDDEN', message: reason } }, 403);
}

/**
 * `POST /webhooks/livekit` — verify + de-dupe + persist a LiveKit lifecycle event.
 *
 * @remarks
 * Returns `404` when LiveKit creds are unset (feature dark), `403` on any
 * signature/body-hash failure, `400` on an unparseable body, and `200`
 * `{ received: true }` once the event is stored (or `{ duplicate: true }` on a
 * replay). Always reads the raw body exactly once so the hash matches LiveKit's.
 *
 * @throws Never throws — JSON parse + verification failures map to typed status codes.
 */
livekitWebhookRoutes.post('/webhooks/livekit', async (c) => {
  const { LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = c.env;

  // Dark until configured — 404 (never 403) so we don't leak that the route exists.
  if (!apiKey || !apiSecret) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const authHeader = c.req.header('authorization') ?? c.req.header('Authorization') ?? '';
  const rawBody = await c.req.text();

  if (!authHeader) return forbidden(c, 'Missing signature');

  const claims = await verifyHs256(authHeader, apiSecret);
  if (!claims) return forbidden(c, 'Invalid signature');
  if (claims.iss !== apiKey) return forbidden(c, 'Issuer mismatch');

  const expectedHash = await sha256Base64(rawBody);
  if (typeof claims.sha256 !== 'string' || claims.sha256 !== expectedHash) {
    return forbidden(c, 'Body hash mismatch');
  }

  // Body is authenticated; parse + validate the shape.
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = LiveKitWebhookEventSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Unexpected event shape' } }, 400);
  }
  const event = parsed.data;

  // Idempotent on the LiveKit event id.
  const dupe = await checkWebhookIdempotency(c.env.DB, 'livekit', event.id);
  if (dupe.isDuplicate) {
    return c.json({ duplicate: true, received: true }, 200);
  }

  const stored = await storeWebhookEvent(c.env.DB, {
    event_id: event.id,
    event_type: event.event,
    payload_hash: expectedHash,
    provider: 'livekit',
  });
  // `dbInsert` RETURNS `{error}` (never throws). A UNIQUE(provider,event_id) violation means a
  // CONCURRENT delivery already claimed this event → ack as duplicate WITHOUT reprocessing;
  // any other store error → 500 so LiveKit RETRIES (never silently drop). Same swallowed-error
  // class as the Stripe route — kept consistent so the future recording/transcript side-effects
  // can't double-fire.
  if (stored.error) {
    if (/UNIQUE constraint failed/i.test(stored.error)) {
      return c.json({ duplicate: true, received: true }, 200);
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to store webhook event' } },
      500,
    );
  }
  const storedId = stored.id;

  // Structured log (console.warn per project no-console rule). Recording→R2 +
  // transcript→conversations wiring follows in the recording slice.
  console.warn(
    JSON.stringify({
      egress_status: event.egressInfo?.status,
      event: event.event,
      event_id: event.id,
      level: 'info',
      msg: 'livekit.webhook',
      room: event.room?.name,
      service: 'livekit_webhooks',
      ts: Date.now(),
    }),
  );

  if (storedId) await markWebhookProcessed(c.env.DB, storedId, 'processed');

  return c.json({ received: true }, 200);
});
